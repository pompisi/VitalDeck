# Phase 0 runbook — capture, decode, validate

Phase 0 is the proof phase: capture a real snoop log, decode it with
`open_ring`, ingest it, and **cross-check the decoded numbers against Oura's own
official data while the free trial is still active**. Once the trial lapses, the
official comparison source is gone — so do this now.

Assumes `SETUP.md` is done: snoop log on FULL, adb paired over Tailscale, the
`open_ring` submodule present, env vars set.

---

## The capture loop

### 1. Sync the ring, then capture promptly

The snoop log is a **rolling buffer** — it overwrites old packets once full. So:

1. **Foreground the official Oura app** and let it sync the ring (open it, wait
   for the sync to complete). This is what makes the phone pull the ring's stored
   readings over BLE — those are the packets we want in the log.
2. **Capture immediately** after the sync finishes, before the buffer churns past
   them.

### 2. Pull a bugreport

From the Pi (with `VITALDECK_ADB_TARGET` set / `adb connect` live):

```bash
cd backend
adb -s "$VITALDECK_ADB_TARGET" bugreport captures/bugreport.zip
```

Or let VitalDeck do it (wraps adb defensively):

```python
from vitaldeck.ingest.pull_snoop import pull_and_extract
btsnoop_path = pull_and_extract()   # bugreport → extract btsnoop → returns the path
```

### 3. Extract the btsnoop log — the path varies, don't hard-code it

The snoop log lives in *different places* depending on Android version / OEM. A
bugreport zip may hold it at any of:

- `FS/data/misc/bluetooth/logs/btsnoop_hci.log`
- `FS/data/log/bt/btsnoop_hci.log`
- or **only** as an embedded **btsnooz** blob inside the main
  `bugreport-*.txt` (base64 + deflate-compressed).

`extract_btsnoop()` globs the zip for any `*btsnoop*` file and, failing that,
decodes the embedded btsnooz blob (`decode_btsnooz`: base64 → zlib-inflate →
btsnoop bytes). **Never hard-code one path** — let the extractor find it.

```python
from vitaldeck.ingest.pull_snoop import extract_btsnoop
from pathlib import Path
btsnoop_path = extract_btsnoop(Path("captures/bugreport.zip"))
```

### 4. Replay-decode with open_ring

`decode.py` shells out to open_ring's replay CLI and streams its JSONL through
the normalizer:

```bash
# what decode_capture runs under the hood (cwd = vendor/open_ring):
python -m driver.cli replay <path-to-btsnoop_hci.log>
```

```python
from vitaldeck.ingest.decode import decode_capture
records = list(decode_capture(btsnoop_path))   # normalized record dicts
```

A nonzero exit raises `DecodeError` with stderr attached — read it; a decode
failure usually means the capture missed the ring's packets (re-sync + re-capture)
or the protocol shifted (see cross-checks below).

### 5. Ingest + recompute

```python
from vitaldeck.db.store import connect, ingest_records
from vitaldeck.summarize import rebuild_all

conn = connect()
result = ingest_records(conn, records)     # idempotent — re-runs are safe
print(result)                              # {"ingested", "deduped", "by_type"}
rebuild_all(conn)                          # summaries + sleep sessions + metrics
```

Or just hit the API: `POST /sync` runs the whole pipeline (live mode when
`VITALDECK_ADB_TARGET` is set).

Ingest dedupes on `(t_event_ms, type, sess)`, so capturing overlapping
windows (yesterday + today) collapses cleanly — capture often, worry later.

---

## Free-month validation (do this while the trial is live)

The whole point of Phase 0 is **trust**: confirming our decoded values match
what Oura itself reports. Both of Oura's comparison sources only work with an
**active membership**, so validate during the free trial — they disappear when it
lapses.

For a few days, capture as above and compare VitalDeck's decoded values against:

- **Oura Cloud API** — pull the same day's `heartrate`, `daily_sleep` (HRV),
  and temperature deviation via your personal access token. Compare against our
  `heart_rate.bpm`, `hrv.rmssd_ms`, and `skin_temp.temp_c`.
- **Health Connect** — if you sync Oura → Health Connect, export HR / HRV / temp
  there and diff the same way.

What to check:

| our signal | compare against | expectation |
|------------|-----------------|-------------|
| `heart_rate.bpm` | Oura API heart-rate samples | timestamps + bpm line up |
| `hrv.rmssd_ms` | Oura nightly HRV | nightly mean within a few ms |
| `skin_temp.temp_c` | Oura temperature deviation | trend/deviation matches |
| `sleep_stage` | Oura hypnogram | **expect drift** — see note |

> **Sleep staging is RE-uncertain.** The on-ring hypnogram decode is the least
> trusted part of the protocol. If `sleep_stage` doesn't line up, that's known —
> we may compute our own stages from HR/HRV/motion instead of trusting the
> ring's. Don't block Phase 0 on it.

Record the diffs somewhere. A clean match across HR/HRV/temp is the green light
that the decode is faithful.

---

## When the protocol breaks

Oura ships firmware/app updates that can shift the BLE protocol. Symptoms:
`DecodeError`, a sudden drop in a record type's count, or values that stop
matching the official API during a validation run.

The defense is the cross-check itself: keep one validation capture in your back
pocket and re-run it after any big Oura update. If decode drifts, the
`open_ring` submodule is the place to patch (then bump the submodule), and the
mapping layer in the backend renames any changed `type`/field strings back to our
canonical names in `CONTRACTS.md`.

---

## Quick reference

```bash
# 1. open Oura app, let it sync the ring
# 2. pull + extract + decode + ingest + recompute, all at once:
cd backend
python - <<'PY'
from vitaldeck.ingest.pull_snoop import pull_and_extract
from vitaldeck.ingest.decode import decode_capture
from vitaldeck.db.store import connect, ingest_records
from vitaldeck.summarize import rebuild_all

snoop = pull_and_extract()
recs = list(decode_capture(snoop))
conn = connect()
print(ingest_records(conn, recs))
print(rebuild_all(conn))
PY
```
