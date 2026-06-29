"""tests for the parse-only path of decode — no subprocess, so these stay fast
and hermetic. the real replay shell-out is covered by integration on the Pi.

one exception: a focused subprocess test that proves a chatty stderr can't
deadlock the stdout streaming loop (we stand up a throwaway fake driver.cli)."""
from __future__ import annotations

import json
import sys

import pytest

from vitaldeck.ingest import decode, pull_snoop  # noqa: F401 — contract import check


def test_decode_text_parses_good_lines():
    # two well-formed records on their own lines
    rec_a = {"t_event_ms": 1000, "type": "heart_rate", "data": {"bpm": 58, "asleep": True}}
    rec_b = {"t_event_ms": 2000, "type": "hrv", "data": {"rmssd_ms": 42.0}}
    text = json.dumps(rec_a) + "\n" + json.dumps(rec_b) + "\n"

    out = list(decode.decode_text(text))

    assert len(out) == 2
    assert out[0]["type"] == "heart_rate"
    assert out[1]["data"]["rmssd_ms"] == 42.0


def test_decode_text_skips_malformed_lines():
    # a good line, a truncated/garbage line, a blank line, then another good line
    good_1 = json.dumps({"t_event_ms": 10, "type": "spo2", "data": {"spo2_pct": 97.0}})
    good_2 = json.dumps({"t_event_ms": 20, "type": "resp", "data": {"rpm": 14.0}})
    text = "\n".join([good_1, "{not valid json", "", "   ", good_2])

    out = list(decode.decode_text(text))

    # the two malformed/blank lines are dropped, the two good ones survive
    assert len(out) == 2
    assert [r["type"] for r in out] == ["spo2", "resp"]


def test_decode_text_empty_input():
    assert list(decode.decode_text("")) == []


def test_decode_error_is_runtimeerror():
    # the contract pins DecodeError as a RuntimeError subclass
    assert issubclass(decode.DecodeError, RuntimeError)


def _make_fake_driver(root, stderr_bytes: int, n_records: int) -> None:
    # standing up a throwaway `driver.cli` package under <root> that decode_capture
    # can shell out to via `python -m driver.cli replay <path>`. it floods stderr
    # with > stderr_bytes of text and prints n_records JSONL lines to stdout.
    pkg = root / "driver"
    pkg.mkdir(parents=True, exist_ok=True)
    (pkg / "__init__.py").write_text("", encoding="utf-8")
    (pkg / "cli.py").write_text(
        "import sys\n"
        "def main():\n"
        f"    chunk = 'x' * {stderr_bytes}\n"
        "    sys.stderr.write(chunk)\n"
        "    sys.stderr.flush()\n"
        f"    for i in range({n_records}):\n"
        "        sys.stdout.write('{\"t_event_ms\": %d, \"type\": \"heart_rate\", \"data\": {\"bpm\": 60, \"asleep\": false}}\\n' % i)\n"
        "    sys.stdout.flush()\n"
        "    sys.stderr.write(chunk)\n"
        "    sys.stderr.flush()\n"
        "if __name__ == '__main__':\n"
        "    main()\n",
        encoding="utf-8",
    )


def test_decode_capture_large_stderr_does_not_hang(tmp_path):
    # a replay that dumps way more than the ~64KB pipe buffer to stderr must NOT
    # deadlock the stdout streaming loop — the concurrent stderr drain handles it.
    # if the fix regressed, this test would hang (and the suite would time out).
    _make_fake_driver(tmp_path, stderr_bytes=200_000, n_records=5)

    capture = tmp_path / "fake.snoop"
    capture.write_bytes(b"ignored-by-fake-driver")

    out = list(decode.decode_capture(capture, open_ring_dir=tmp_path))

    assert len(out) == 5
    assert all(r["type"] == "heart_rate" for r in out)
