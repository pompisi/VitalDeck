"""tests for the parse-only path of decode — no subprocess, so these stay fast
and hermetic. the real replay shell-out is covered by integration on the Pi."""
from __future__ import annotations

import json

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
