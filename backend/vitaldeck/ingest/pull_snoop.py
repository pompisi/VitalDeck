"""pulling the Bluetooth HCI snoop log off the phone and extracting the raw
btsnoop bytes — entirely no-root.

the phone's "Enable Bluetooth HCI snoop log" developer toggle records every BLE
packet. `adb bugreport` packages that log into a zip; depending on the device the
full btsnoop_hci.log is dropped in as a file, or only a compressed "btsnooz" blob
is embedded in the main bugreport text. we handle both, then hand the raw btsnoop
bytes to the replay decoder.

reference: AOSP btsnooz format = base64{ 8-byte header + zlib-deflate{ records } }.
"""
from __future__ import annotations

import base64
import fnmatch
import re
import subprocess
import zipfile
import zlib
from pathlib import Path

from .. import config


class PullError(RuntimeError):
    """raised when an adb/zip/file step in the pull-and-extract pipeline fails."""


# the marker that precedes the embedded base64 btsnooz blob in bugreport-*.txt.
# real bugreports label it a couple different ways across android versions, so we
# look for either spelling.
_BTSNOOZ_MARKERS = (
    "--- BEGIN:BTSNOOP_LOG_SUMMARY",
    "BTSNOOP_LOG_SUMMARY",
    "btsnooz",
)

# the AOSP btsnooz header is 8 bytes (a 4-byte magic + version/etc.) sitting in
# front of the zlib-deflated record stream.
_BTSNOOZ_HEADER_LEN = 8


def pull_bugreport(
    adb_target: str = config.ADB_TARGET,
    out_dir: str | Path = config.CAPTURE_DIR,
    adb_bin: str = config.ADB_BIN,
) -> Path:
    """running `adb bugreport` to drop a bugreport zip into out_dir, no root.

    when adb_target is empty we let adb pick its default device (the common
    single-device case); otherwise we pass `-s <target>`. returns the path adb
    actually wrote (adb names the zip itself, so we discover it by diffing the
    directory listing).
    """
    out_dir = Path(out_dir)
    try:
        out_dir.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        raise PullError(f"could not create capture dir {out_dir}: {exc}") from exc

    # snapshotting existing zips so we can tell which one adb just produced
    try:
        before = {p.name for p in out_dir.glob("*.zip")}
    except OSError:
        before = set()

    cmd = [adb_bin]
    if adb_target:
        cmd += ["-s", adb_target]
    # passing the dir; modern adb writes bugreport-*.zip into it on its own
    cmd += ["bugreport", str(out_dir)]

    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=600,  # bugreports are slow; giving it up to 10 min
        )
    except (OSError, ValueError) as exc:
        raise PullError(f"could not run adb {cmd!r}: {exc}") from exc
    except subprocess.TimeoutExpired as exc:
        raise PullError(f"adb bugreport timed out: {exc}") from exc

    if proc.returncode != 0:
        raise PullError(
            f"adb bugreport exited {proc.returncode}: "
            f"{(proc.stderr or '').strip() or '<no stderr>'}"
        )

    # finding the freshly written zip
    try:
        after = sorted(out_dir.glob("*.zip"), key=lambda p: p.stat().st_mtime)
    except OSError as exc:
        raise PullError(f"could not list {out_dir} for the bugreport zip: {exc}") from exc

    new_zips = [p for p in after if p.name not in before]
    candidate = new_zips[-1] if new_zips else (after[-1] if after else None)
    if candidate is None:
        raise PullError(f"adb bugreport produced no zip in {out_dir}")
    return candidate


def extract_btsnoop(
    bugreport_zip: str | Path,
    out_dir: str | Path = config.CAPTURE_DIR,
) -> Path:
    """pulling the raw btsnoop bytes out of a bugreport zip and writing them out.

    first preference: any member whose name contains 'btsnoop' (the full log is
    dropped in directly on most devices). failing that, we read the main
    bugreport-*.txt, find the embedded btsnooz blob, decode it via
    decode_btsnooz, and write the inflated btsnoop bytes. returns the written
    capture path.
    """
    bugreport_zip = Path(bugreport_zip)
    out_dir = Path(out_dir)
    try:
        out_dir.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        raise PullError(f"could not create capture dir {out_dir}: {exc}") from exc

    try:
        zf = zipfile.ZipFile(bugreport_zip)
    except (OSError, zipfile.BadZipFile) as exc:
        raise PullError(f"could not open bugreport zip {bugreport_zip}: {exc}") from exc

    with zf:
        try:
            names = zf.namelist()
        except (OSError, zipfile.BadZipFile) as exc:
            raise PullError(f"could not list {bugreport_zip}: {exc}") from exc

        # path 1: a real btsnoop file is sitting in the zip
        snoop_members = [n for n in names if "btsnoop" in n.lower()]
        if snoop_members:
            member = snoop_members[0]
            try:
                raw = zf.read(member)
            except (OSError, zipfile.BadZipFile, RuntimeError) as exc:
                raise PullError(f"could not read {member} from {bugreport_zip}: {exc}") from exc
            out_path = out_dir / "btsnoop_hci.log"
            return _write_bytes(out_path, raw)

        # path 2: only the embedded btsnooz blob exists in the main bugreport text
        txt_members = [
            n for n in names
            if fnmatch.fnmatch(Path(n).name.lower(), "bugreport-*.txt")
        ]
        # falling back to any .txt if the canonical name isn't present
        if not txt_members:
            txt_members = [n for n in names if n.lower().endswith(".txt")]

        for member in txt_members:
            try:
                text = zf.read(member).decode("utf-8", errors="replace")
            except (OSError, zipfile.BadZipFile, RuntimeError) as exc:
                # skipping a member we can't read instead of aborting the search
                continue
            try:
                raw = decode_btsnooz(text)
            except PullError:
                # this text didn't carry a btsnooz blob; trying the next member
                continue
            out_path = out_dir / "btsnoop_hci.log"
            return _write_bytes(out_path, raw)

    raise PullError(
        f"no btsnoop file or embedded btsnooz blob found in {bugreport_zip}"
    )


def decode_btsnooz(bugreport_text: str) -> bytes:
    """decoding the embedded btsnooz blob into raw btsnoop bytes.

    locating the base64 block after the btsnooz / BTSNOOP_LOG_SUMMARY marker,
    base64-decoding it, then zlib-inflating the body that follows the 8-byte
    AOSP header. returns the reconstructed btsnoop byte stream.
    """
    # finding where the blob starts: the first marker present in the text
    start = -1
    for marker in _BTSNOOZ_MARKERS:
        idx = bugreport_text.find(marker)
        if idx != -1:
            start = idx + len(marker)
            break
    if start == -1:
        raise PullError("no btsnooz marker found in bugreport text")

    # the base64 payload runs from the marker to the next blank line / end marker.
    # we pull every base64-looking line and concatenate them.
    tail = bugreport_text[start:]
    b64_lines: list[str] = []
    for line in tail.splitlines():
        stripped = line.strip()
        if not stripped:
            # a blank line ends the block once we've started collecting
            if b64_lines:
                break
            continue
        if stripped.startswith("---") or stripped.startswith("BTSNOOP_LOG_SUMMARY"):
            # hit a trailing END marker — stop if we already have data
            if b64_lines:
                break
            continue
        # only keeping lines that are entirely valid base64 alphabet
        if re.fullmatch(r"[A-Za-z0-9+/=\s]+", stripped) and stripped:
            b64_lines.append(stripped)
        elif b64_lines:
            # a non-base64 line after the block started means we're past it
            break

    b64_blob = "".join(b64_lines)
    if not b64_blob:
        raise PullError("found a btsnooz marker but no base64 payload after it")

    try:
        decoded = base64.b64decode(b64_blob, validate=False)
    except (ValueError, TypeError) as exc:
        raise PullError(f"btsnooz base64 decode failed: {exc}") from exc

    if len(decoded) < _BTSNOOZ_HEADER_LEN:
        raise PullError(
            f"btsnooz payload too short ({len(decoded)} bytes) for an 8-byte header"
        )

    # inflating the deflate stream that sits after the 8-byte header
    body = decoded[_BTSNOOZ_HEADER_LEN:]
    try:
        return zlib.decompress(body)
    except zlib.error as exc:
        raise PullError(f"btsnooz zlib inflate failed: {exc}") from exc


def pull_and_extract(
    adb_target: str = config.ADB_TARGET,
    out_dir: str | Path = config.CAPTURE_DIR,
    adb_bin: str = config.ADB_BIN,
) -> Path:
    """convenience: pulling a fresh bugreport then extracting its btsnoop bytes."""
    zip_path = pull_bugreport(adb_target=adb_target, out_dir=out_dir, adb_bin=adb_bin)
    return extract_btsnoop(zip_path, out_dir=out_dir)


def _write_bytes(out_path: Path, raw: bytes) -> Path:
    """writing raw bytes to out_path, wrapping the fs error as a PullError."""
    try:
        out_path.write_bytes(raw)
    except OSError as exc:
        raise PullError(f"could not write btsnoop to {out_path}: {exc}") from exc
    return out_path
