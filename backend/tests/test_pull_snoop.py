"""tests for the no-root btsnoop extraction paths: a real btsnoop file living in
a bugreport zip, and the embedded btsnooz base64+deflate round-trip."""
from __future__ import annotations

import base64
import io
import zipfile
import zlib

import pytest

from vitaldeck.ingest import decode, pull_snoop  # noqa: F401 — contract import check


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


def test_decode_btsnooz_round_trip():
    # round-tripping the inflate path: base64( header + zlib.compress(payload) )
    payload = b"btsnoop-record-stream-goes-here" * 4
    header = b"\x00\x00\x00\x00\x00\x00\x00\x00"  # the 8-byte AOSP header we skip
    blob = base64.b64encode(header + zlib.compress(payload)).decode("ascii")

    bugreport_text = (
        "some preamble\n"
        "--- BEGIN:BTSNOOP_LOG_SUMMARY\n"
        + blob
        + "\n--- END:BTSNOOP_LOG_SUMMARY\n"
    )

    out = pull_snoop.decode_btsnooz(bugreport_text)
    assert out == payload


def test_extract_btsnoop_via_embedded_btsnooz(tmp_path):
    # no btsnoop file member — only the embedded blob in the bugreport text
    payload = b"inflated-btsnoop-from-text"
    header = b"\x00" * pull_snoop._BTSNOOZ_HEADER_LEN
    blob = base64.b64encode(header + zlib.compress(payload)).decode("ascii")
    text = "BTSNOOP_LOG_SUMMARY\n" + blob + "\n"

    zip_path = tmp_path / "bugreport-embed.zip"
    with zipfile.ZipFile(zip_path, "w") as zf:
        zf.writestr("bugreport-embed.txt", text)

    out = pull_snoop.extract_btsnoop(zip_path, out_dir=tmp_path / "caps")
    assert out.read_bytes() == payload


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
