"""tests for the synthetic generator — coverage of every canonical type, the
raw-envelope shape, determinism, and the presence of injected bad nights.

these only touch tools.synth (no db / no sibling modules), so they run in
isolation while the rest of the spine is mid-build.
"""
from __future__ import annotations

from tools import synth

# the full canonical set from CONTRACTS §1 — synth must emit all of them.
CANONICAL_TYPES = {
    "heart_rate",
    "hrv",
    "ibi",
    "skin_temp",
    "spo2",
    "resp",
    "accel",
    "activity_met",
    "sleep_stage",
    "battery",
}


def test_generate_returns_records():
    recs = synth.generate(7)
    assert isinstance(recs, list)
    assert len(recs) > 0


def test_every_canonical_type_present():
    recs = synth.generate(7)
    seen = {r["type"] for r in recs}
    missing = CANONICAL_TYPES - seen
    assert not missing, f"missing canonical types: {missing}"


def test_envelope_shape():
    # every record is a pre-normalize envelope: t_event_ms + type + data (dict),
    # plus sess/ctr for the dedupe key.
    recs = synth.generate(5)
    for r in recs:
        assert isinstance(r, dict)
        assert "t_event_ms" in r and isinstance(r["t_event_ms"], int)
        assert "type" in r and isinstance(r["type"], str) and r["type"]
        assert "data" in r and isinstance(r["data"], dict)
        assert "sess" in r and isinstance(r["sess"], int)
        assert "ctr" in r and isinstance(r["ctr"], int)


def test_determinism_same_seed():
    a = synth.generate(7, seed=42)
    b = synth.generate(7, seed=42)
    assert a == b


def test_different_seed_differs():
    a = synth.generate(7, seed=1)
    b = synth.generate(7, seed=2)
    assert a != b


def test_end_ms_is_fixed_not_wallclock():
    # default end_ms must be the module constant, so two calls bracket-identical
    # without passing end_ms produce the same max timestamp.
    a = synth.generate(3)
    b = synth.generate(3)
    assert max(r["t_event_ms"] for r in a) == max(r["t_event_ms"] for r in b)
    # and that max sits within the fixed window anchor
    assert max(r["t_event_ms"] for r in a) <= synth.DEFAULT_END_MS


def test_end_ms_injectable():
    custom = synth.DEFAULT_END_MS - 5 * synth.MS_PER_DAY
    recs = synth.generate(3, end_ms=custom)
    assert max(r["t_event_ms"] for r in recs) <= custom


def test_bad_nights_exist():
    # bad nights suppress hrv ~25% + lift rhr ~8% + bump temp +0.5C. we detect
    # them by grouping nightly hrv by session and checking the spread of nightly
    # means is wide enough that at least one night is clearly suppressed.
    recs = synth.generate(14, seed=42)
    by_sess: dict[int, list[float]] = {}
    for r in recs:
        if r["type"] == "hrv":
            by_sess.setdefault(r["sess"], []).append(r["data"]["rmssd_ms"])

    assert by_sess, "expected nightly hrv samples grouped by session"
    nightly_means = sorted(sum(v) / len(v) for v in by_sess.values())
    # a suppressed night should sit well below the best night
    assert nightly_means[0] < nightly_means[-1] * 0.85, (
        f"expected a clearly suppressed bad night; means={nightly_means}"
    )


def test_sleep_stages_cover_all_stages():
    recs = synth.generate(7, seed=42)
    stages = {r["data"]["stage"] for r in recs if r["type"] == "sleep_stage"}
    # over a week we should see every hypnogram stage
    assert {"deep", "light", "rem", "awake"}.issubset(stages)


def test_heart_rate_has_asleep_and_awake():
    recs = synth.generate(5)
    asleep_flags = {r["data"]["asleep"] for r in recs if r["type"] == "heart_rate"}
    assert asleep_flags == {True, False}


def test_zero_days_is_empty():
    assert synth.generate(0) == []
