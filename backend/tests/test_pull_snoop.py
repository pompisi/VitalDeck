"""tests for the no-root btsnoop extraction paths: a real btsnoop file living in
a bugreport zip, and the embedded btsnooz base64+deflate round-trip."""
from __future__ import annotations

import base64
import zipfile
import zlib

import pytest

from vitaldeck.ingest import decode, pull_snoop  # noqa: F401 — contract import check


def _raw_deflate(payload: bytes) -> bytes:
    # building a RAW deflate stream (no zlib wrapper), the way AOSP btsnooz v2 does
    co = zlib.compressobj(wbits=-zlib.MAX_WBITS)
    return co.compress(payload) + co.flush()


def _btsnooz_blob(payload: bytes, version: int = 2) -> str:
    # 1 version byte + deflated body: raw deflate for v2, a zlib stream for v1
    body = _raw_deflate(payload) if version == 2 else zlib.compress(payload)
    return base64.b64encode(bytes([version]) + body).decode("ascii")


def test_extract_btsnoop_finds_file_member(tmp_path):
    # building a tiny zip that carries a fake btsnoop_hci.log
    payload = b"\x00fake-btsnoop-bytes\x01"
    zip_path = tmp_path / "bugreport-test.zip"
    with zipfile.ZipFile(zip_path, "w") as zf:
        zf.writestr("FS/data/misc/bluetooth/logs/btsnoop_hci.log", payload)
        zf.writestr("bugreport-test.txt", "nothing useful here\n")

    out = pull_snoop.extract_btsnoop(zip_path, out_dir=tmp_path / "caps")

    assert out.exists()
    assert out.read_bytes() == payload


def test_decode_btsnooz_round_trip_v2():
    # round-tripping the real v2 inflate path: base64( version byte + raw deflate )
    payload = b"btsnoop-record-stream-goes-here" * 4
    blob = _btsnooz_blob(payload, version=2)

    bugreport_text = (
        "some preamble\n"
        "--- BEGIN:BTSNOOP_LOG_SUMMARY\n"
        + blob
        + "\n--- END:BTSNOOP_LOG_SUMMARY\n"
    )

    out = pull_snoop.decode_btsnooz(bugreport_text)
    assert out == payload


def test_decode_btsnooz_round_trip_v1_zlib():
    # version 1 wraps the records in a full zlib stream instead of raw deflate
    payload = b"v1-zlib-wrapped-records" * 3
    blob = _btsnooz_blob(payload, version=1)

    bugreport_text = "BTSNOOP_LOG_SUMMARY\n" + blob + "\n"

    out = pull_snoop.decode_btsnooz(bugreport_text)
    assert out == payload


def test_decode_btsnooz_trailing_same_line_text():
    # the marker often has trailing text on the SAME line (a byte count, a colon),
    # which must not get glued onto the front of the base64 blob
    payload = b"records-after-a-noisy-marker-line" * 2
    blob = _btsnooz_blob(payload, version=2)

    bugreport_text = (
        "BTSNOOP_LOG_SUMMARY (4096 bytes captured):  some junk here\n"
        + blob
        + "\n"
    )

    out = pull_snoop.decode_btsnooz(bugreport_text)
    assert out == payload


def test_extract_btsnoop_via_embedded_btsnooz(tmp_path):
    # no btsnoop file member — only the embedded blob in the bugreport text
    payload = b"inflated-btsnoop-from-text"
    blob = _btsnooz_blob(payload, version=2)
    text = "BTSNOOP_LOG_SUMMARY\n" + blob + "\n"

    zip_path = tmp_path / "bugreport-embed.zip"
    with zipfile.ZipFile(zip_path, "w") as zf:
        zf.writestr("bugreport-embed.txt", text)

    out = pull_snoop.extract_btsnoop(zip_path, out_dir=tmp_path / "caps")
    assert out.read_bytes() == payload


def test_extract_btsnoop_prefers_live_log_over_last(tmp_path):
    # both the live log and a stale '.last' rotation are present; we must always
    # pick the live one regardless of which was written into the zip first
    live = b"\x00LIVE-btsnoop-bytes\x01"
    stale = b"\x00STALE-rotated-bytes\x01"

    # insertion order: stale FIRST so a naive members[0] would grab the wrong one
    zip_path = tmp_path / "bugreport-rotated.zip"
    with zipfile.ZipFile(zip_path, "w") as zf:
        zf.writestr("FS/data/misc/bluetooth/logs/btsnoop_hci.log.last", stale)
        zf.writestr("FS/data/misc/bluetooth/logs/btsnoop_hci.log", live)

    out = pull_snoop.extract_btsnoop(zip_path, out_dir=tmp_path / "caps")
    assert out.read_bytes() == live

    # and the reverse insertion order picks the same live log
    zip_path2 = tmp_path / "bugreport-rotated2.zip"
    with zipfile.ZipFile(zip_path2, "w") as zf:
        zf.writestr("FS/data/misc/bluetooth/logs/btsnoop_hci.log", live)
        zf.writestr("FS/data/misc/bluetooth/logs/btsnoop_hci.log.last", stale)

    out2 = pull_snoop.extract_btsnoop(zip_path2, out_dir=tmp_path / "caps2")
    assert out2.read_bytes() == live


def test_decode_btsnooz_missing_marker_raises():
    with pytest.raises(pull_snoop.PullError):
        pull_snoop.decode_btsnooz("just a plain bugreport with no snoop blob\n")


def test_extract_btsnoop_nothing_found_raises(tmp_path):
    zip_path = tmp_path / "empty.zip"
    with zipfile.ZipFile(zip_path, "w") as zf:
        zf.writestr("bugreport-empty.txt", "no snoop here\n")
    with pytest.raises(pull_snoop.PullError):
        pull_snoop.extract_btsnoop(zip_path, out_dir=tmp_path / "caps")


def test_pull_error_is_runtimeerror():
    assert issubclass(pull_snoop.PullError, RuntimeError)
