"""end-to-end-ish api tests — driving a TestClient over a temp db seeded by
running POST /sync in synthetic mode (no ADB_TARGET).

setting VITALDECK_DB to a throwaway file BEFORE anything imports config is the
trick here: config reads the env at import time, so we point it at a tmp path and
override store.config.DB_PATH for good measure, then import the app.
"""
from __future__ import annotations

import os
import tempfile
from pathlib import Path

import pytest

# pointing the db at a throwaway temp file before the package reads config.
# using a module-level temp dir so the path is stable across the import below.
_TMP_DIR = Path(tempfile.mkdtemp(prefix="vitaldeck-test-"))
_TMP_DB = _TMP_DIR / "test.db"
os.environ["VITALDECK_DB"] = str(_TMP_DB)
# making sure live mode is off so /sync takes the synthetic branch.
os.environ.pop("VITALDECK_ADB_TARGET", None)
os.environ["VITALDECK_ADB_TARGET"] = ""

from fastapi.testclient import TestClient  # noqa: E402

from vitaldeck import config  # noqa: E402
from vitaldeck.api.main import app  # noqa: E402

# belt-and-suspenders: config caches DB_PATH at import, so force it to the tmp db
config.DB_PATH = _TMP_DB


@pytest.fixture(scope="module")
def client() -> TestClient:
    """one client for the module, seeded once via a synthetic sync."""
    c = TestClient(app)
    # seeding: synthetic /sync builds raw_records + summaries + sleep + metrics.
    # running it a few times so trends/baselines have several days to chew on.
    for _ in range(3):
        resp = c.post("/sync")
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["mode"] == "synthetic"
        assert body["ok"] is True
    return c


def test_health(client: TestClient) -> None:
    resp = client.get("/health")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "ok"
    assert body["db"] is True
    # after seeding there should be a newest event timestamp
    assert "data_as_of" in body
    assert body["data_as_of"] is not None


def test_summary_today(client: TestClient) -> None:
    resp = client.get("/summary/today")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert "date" in body
    assert isinstance(body["summary"], dict)
    # metric may be present or null but the key must exist
    assert "metric" in body
    assert "data_as_of" in body
    # the summary dict should carry its date column
    assert body["summary"].get("date") == body["date"]


def test_trends_hrv(client: TestClient) -> None:
    resp = client.get("/trends", params={"metric": "hrv_rmssd"})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["metric"] == "hrv_rmssd"
    assert isinstance(body["points"], list)
    assert "baseline_14" in body
    assert "baseline_30" in body
    for pt in body["points"]:
        assert "date" in pt
        assert "value" in pt


def test_trends_readiness(client: TestClient) -> None:
    # readiness_custom is the special-cased metric pulling from the metrics table
    resp = client.get("/trends", params={"metric": "readiness_custom"})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["metric"] == "readiness_custom"
    assert isinstance(body["points"], list)


def test_trends_bad_metric(client: TestClient) -> None:
    resp = client.get("/trends", params={"metric": "not_a_metric"})
    assert resp.status_code == 400, resp.text


def test_sleep(client: TestClient) -> None:
    resp = client.get("/sleep", params={"days": 30})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert isinstance(body["sessions"], list)


def test_metrics(client: TestClient) -> None:
    resp = client.get("/metrics", params={"days": 30})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert isinstance(body["points"], list)
    for pt in body["points"]:
        assert "date" in pt
        assert "readiness_custom" in pt
        assert "components" in pt


def test_tags_roundtrip(client: TestClient) -> None:
    # POST -> the created tag
    created = client.post("/tags", json={"ts_ms": 1_700_000_000_000, "label": "late caffeine", "note": "espresso"})
    assert created.status_code == 200, created.text
    tag = created.json()
    assert tag["label"] == "late caffeine"
    tag_id = tag["id"]

    # GET -> the tag is listed
    listed = client.get("/tags")
    assert listed.status_code == 200, listed.text
    tags = listed.json()["tags"]
    assert any(t["id"] == tag_id for t in tags)

    # DELETE -> deleted true
    deleted = client.delete(f"/tags/{tag_id}")
    assert deleted.status_code == 200, deleted.text
    assert deleted.json()["deleted"] is True


def test_create_tag_null_id_is_500(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    # store.add_tag swallows sqlite errors and returns a null-id dict; the api
    # must surface that as a 500 instead of a 200 with id:null. forcing that
    # failure shape via monkeypatch on the store the endpoint actually imports.
    from vitaldeck.api import main as main_mod

    def _null_add_tag(conn, ts_ms, label, note=None):
        return {"id": None, "ts_ms": ts_ms, "label": label, "note": note, "created_at": None}

    monkeypatch.setattr(main_mod.store, "add_tag", _null_add_tag)
    resp = client.post("/tags", json={"ts_ms": 1_700_000_000_000, "label": "broken"})
    assert resp.status_code == 500, resp.text


def test_tags_negative_days_clamped(client: TestClient) -> None:
    # a negative days used to slip through to the store and silently return [].
    # with clamping (max(0, ...)) it lands on 0 — a window anchored at the newest
    # tag — so a freshly-added tag still comes back instead of vanishing.
    created = client.post("/tags", json={"ts_ms": 1_700_000_000_000, "label": "clamp probe"})
    assert created.status_code == 200, created.text

    neg = client.get("/tags", params={"days": -5})
    assert neg.status_code == 200, neg.text
    # the negative value must NOT be treated as "an empty window"
    assert len(neg.json()["tags"]) > 0
