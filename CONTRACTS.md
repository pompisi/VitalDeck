# VitalDeck — build contracts (the spine)

Every module is built against the signatures and shapes below. Do not change a
signature without changing it here first. The foundational modules
(`config.py`, `vitaldeck/records.py`, `vitaldeck/db/schema.sql`) already exist —
import them, do not redefine them.

Conventions:
- Python 3.10+ (dev box runs 3.13). Modern style: type hints, `from __future__ import annotations`.
- Comments are lowercase, conversational, gerund-heavy ("pulling records since…"). Authorial voice.
- Defensive coding: wrap every `await`/call that hits SQLite, the filesystem, a
  subprocess, or the network in `try/except` with a non-crashing fallback.
- Tests use the venv python at:
  `C:\Users\jango\AppData\Local\Temp\claude\C--Users-jango-OneDrive-Documents-App-manga-shelf-app-manga-shelf\754da41b-a366-4470-839f-5eb57e29b5ae\scratchpad\vd-venv\Scripts\python.exe`
  Run from `backend/` with `VITALDECK_DB` pointed at a temp file. Import path: the package is `vitaldeck` under `backend/`, so run pytest with cwd=`backend`.

---

## 1. Decoded record shape (post-normalize)

`vitaldeck.records.normalize()` already returns:
```
{ "t_event_ms": int, "type": str, "sess": int, "ctr": int,
  "tag": Any|None, "rt": int|None, "raw_t": Any|None, "data": dict }
```
Dedupe key = `(t_event_ms, type, sess)`.

### Canonical record types + `data` fields (synth emits these; summarize consumes them)

This is a faithful stand-in for open_ring's decoded output. A future mapping
layer can rename to the exact upstream `type` strings; the whole backend keys off
these names so synth and summarize MUST match exactly.

| type            | data fields                              | cadence / notes |
|-----------------|------------------------------------------|-----------------|
| `heart_rate`    | `{ "bpm": int, "asleep": bool }`         | every ~5 min, day+night |
| `hrv`           | `{ "rmssd_ms": float }`                  | nightly, every ~5 min while asleep |
| `ibi`           | `{ "ibi_ms": int }`                      | sparse sample (high-volume in reality) |
| `skin_temp`     | `{ "temp_c": float }`                    | every ~10 min |
| `spo2`          | `{ "spo2_pct": float }`                  | nightly |
| `resp`          | `{ "rpm": float }`                       | nightly |
| `accel`         | `{ "acm": float }`                       | activity magnitude, daytime |
| `activity_met`  | `{ "met": float }`                       | MET bin, daytime |
| `sleep_stage`   | `{ "stage": "deep"|"light"|"rem"|"awake", "duration_s": int }` | on-ring hypnogram; RE-uncertain (flag in docs) |
| `battery`       | `{ "pct": int }`                         | occasional |

Day grouping: a record belongs to local day `floor((t_event_ms/1000 + offset)/86400)`
where `offset = config.LOCAL_UTC_OFFSET_HOURS*3600`. A sleep session's `date` is
the local date of its `end_ms`.

> The canonical record model above is the BLE/snoop ingest contract. The active
> data path today is the **Oura Cloud API** (`vitaldeck/ingest/oura_api.py`),
> which upserts `daily_summaries` + `sleep_sessions` directly and does NOT write
> `raw_records`. The snoop/replay path (`decode.py` + `pull_snoop.py`, §5) is the
> subscription-free alternative and is parked pending a captured validation
> artifact. The wire-protocol reverse-engineering is credited to open_ring
> (GPLv3, driven via subprocess); the contribution here is the systems
> integration, data pipeline, full-stack app, and infra.

---

## 2. `vitaldeck/db/store.py`  (owner: AGENT-DB)

```python
def connect(db_path=config.DB_PATH) -> sqlite3.Connection   # row_factory=Row, runs init_db, returns conn
def init_db(conn) -> None                                   # executes schema.sql (idempotent)

def start_sync_run(conn, source_capture: str | None) -> int
def finish_sync_run(conn, sync_run_id: int, status: str, ingested: int, deduped: int, notes: str | None = None) -> None

# idempotent: INSERT OR IGNORE on ux_raw_dedup. returns counts.
def ingest_records(conn, records: Iterable[dict], sync_run_id: int | None = None) -> dict
#   -> {"ingested": int, "deduped": int, "by_type": {type: int}}

def upsert_daily_summary(conn, summary: dict) -> None       # summary keyed by 'date'; UPSERT on date
def upsert_sleep_session(conn, session: dict) -> None       # UPSERT on (start_ms,end_ms)
def upsert_metric(conn, date: str, readiness_custom: float, components: dict, baselines: dict) -> None

# reads (each row -> plain dict; data_json/json columns parsed back to objects)
def get_daily_summary(conn, date: str) -> dict | None
def get_latest_daily_summary(conn) -> dict | None
def get_daily_summaries(conn, days: int) -> list[dict]      # most recent N, ascending date
def get_records(conn, type: str, since_ms: int | None = None, until_ms: int | None = None) -> list[dict]
def get_all_records(conn) -> list[dict]                     # for rebuild; each has parsed 'data'
def get_sleep_sessions(conn, days: int) -> list[dict]
def get_metric(conn, date: str) -> dict | None
def get_metrics(conn, days: int) -> list[dict]
def latest_event_ms(conn) -> int | None                    # max(t_event_ms) — drives "data as of"

# tags
def add_tag(conn, ts_ms: int, label: str, note: str | None = None) -> dict   # returns the created row
def list_tags(conn, days: int | None = None) -> list[dict]
def delete_tag(conn, tag_id: int) -> bool
```
Every read returns JSON-serializable dicts (parse `*_json` columns). All writes
`conn.commit()`.

---

## 3. `vitaldeck/summarize.py`  (owner: AGENT-METRICS)

Bridges raw_records -> daily_summaries + sleep_sessions.

```python
def summarize_records(records: list[dict]) -> dict
#   -> {"daily": list[daily_summary_dict], "sleep": list[sleep_session_dict]}
def rebuild_all(conn) -> dict
#   pulls store.get_all_records, summarizes, upserts daily+sleep, returns {"days": n, "sleep_sessions": n}
```
`daily_summary_dict` keys = daily_summaries columns (date, resting_hr, hr_min,
hr_max, hr_avg_day, hrv_rmssd, spo2_avg, resp_rate, temp_mean_c, sleep_min,
sleep_efficiency, sleep_latency_min, stage_breakdown_json (JSON str), steps,
met_high_min). `resting_hr` = ~5th percentile of asleep heart_rate that day.
Sleep sessions built from contiguous `sleep_stage` runs; efficiency =
asleep_min/(asleep_min+awake_min)*100; latency = start to first non-awake.

> `summarize.rebuild_all` is only run for the raw-record paths (synthetic / snoop
> replay / manual zip). The Oura-cloud path writes `daily_summaries` directly and
> is scored WITHOUT a rebuild (a rebuild would wipe them, since `raw_records` is
> empty under that path) — see §6 and `pipeline.score_only`.

---

## 4. `vitaldeck/metrics/baselines.py` + `readiness.py`  (owner: AGENT-METRICS)

```python
# baselines.py
def compute_baselines(summaries: list[dict], windows=config.BASELINE_WINDOWS) -> dict
#   -> {"hrv_rmssd": {"14": float|None, "30": float|None},
#       "resting_hr": {...}, "temp_mean_c": {...}, "n_days": int}
#   means over the most recent <window> summaries, skipping None values.

# readiness.py
def compute_readiness(today: dict, baselines: dict, weights=config.READINESS_WEIGHTS) -> dict
#   -> {"score": float (0-100), "components": {
#         "hrv":        {"value","baseline","subscore","weight","note"},
#         "resting_hr": {...}, "temp": {...}, "sleep": {...}},
#       "explanation": str}
#   subscores in [0,1]; score = round(100 * sum(weight*subscore)).
#   hrv: higher vs baseline better. rhr: lower better. temp: penalize |deviation|.
#   sleep: duration vs config.SLEEP_TARGET_MIN blended with efficiency.
#   robust to None baseline (subscore defaults 0.5, note="no baseline yet").
def temp_flag(today: dict, baselines: dict) -> dict
#   -> {"flagged": bool, "deviation": float|None, "note": str}  (|dev|>=0.35C -> flagged)
```

---

## 5. `vitaldeck/ingest/decode.py` + `pull_snoop.py`  (owner: AGENT-INGEST)

The subscription-free / passive-decode path. Parked pending a captured
validation artifact; the Oura Cloud path (`oura_api.py`, §6) is the active one.

```python
# decode.py
class DecodeError(RuntimeError): ...
def decode_capture(capture_path, open_ring_dir=config.OPEN_RING_DIR) -> Iterator[dict]
#   shells out: python -m driver.cli replay <capture_path>  (cwd=open_ring_dir)
#   streams stdout through records.parse_jsonl. raises DecodeError on nonzero exit (include stderr).
def decode_text(jsonl_text: str) -> Iterator[dict]   # parse-only helper for tests, no subprocess

# pull_snoop.py
class PullError(RuntimeError): ...
def pull_bugreport(adb_target=config.ADB_TARGET, out_dir=config.CAPTURE_DIR, adb_bin=config.ADB_BIN) -> Path
def extract_btsnoop(bugreport_zip: Path, out_dir=config.CAPTURE_DIR) -> Path
#   globs the zip for any '*btsnoop*' file; if only the embedded btsnooz blob exists
#   in the main bugreport-*.txt, decode it via decode_btsnooz().
def decode_btsnooz(bugreport_text: str) -> bytes      # base64 + (1 version byte + raw(v2)/zlib(v1) deflate)-inflate -> btsnoop bytes
def pull_and_extract(...) -> Path                      # convenience: bugreport then extract
```
All adb/zip/subprocess calls wrapped defensively; raise PullError with context.
Do NOT require root anywhere. Reference: AOSP btsnooz format = base64{ 1 version byte + raw(v2)/zlib(v1) deflate{ records } }.

### `vitaldeck/ingest/oura_api.py`  (the active ingest path)

Stdlib-only (urllib) pull of the Oura Cloud v2 API with a personal access token.
Maps `sleep`, `daily_readiness`, `daily_spo2`, `daily_activity` onto our
`daily_summaries` + `sleep_sessions` so the same baselines/readiness math runs
regardless of source. Sleep staging prefers the explicit `*_duration` fields and
falls back to the `sleep_phase_5_min` hypnogram when those are null.

```python
class OuraError(RuntimeError): ...
def fetch(token: str, days: int = 30) -> dict[str, list[dict]]    # sleep + daily_* rows
def build(payload) -> dict[str, list[dict]]                       # pure mapping -> {"daily":[...], "sleep":[...]}
def ingest_oura(conn, token: str, days: int = 30) -> dict         # fetch -> build -> upsert; -> {"ingested","deduped":0,"sleep_sessions"}

# live heart rate — the ONLY intraday metric the oura cloud exposes
def fetch_heartrate(token: str, hours: int = 6) -> list[dict]     # /heartrate time series
def summarize_heartrate(rows) -> dict                             # latest bpm (~2-min smoothed) + day_min/max/avg
def live_heartrate(token: str, window_hours: int = 6) -> dict     # fetch + summarize; raises OuraError on network failure
```

---

## 6. `vitaldeck/api/main.py` (+ `models.py`)  (owner: AGENT-API)

FastAPI app object name MUST be `app` (so `uvicorn vitaldeck.api.main:app` works).
Uses store + summarize + metrics + pipeline + oura_api. CORS open (personal
LAN/Tailscale). A lifespan hook starts the twice-daily auto-sync scheduler (no-op
in synthetic/dev).

| method/path            | response |
|------------------------|----------|
| `GET /health`          | `{"status":"ok","db":bool,"data_as_of":int|null}` (data_as_of = latest_event_ms, falling back to the newest sleep-session end_ms when there are no raw_records — i.e. the oura path) |
| `GET /live`            | `{"ok":bool,"bpm":int|null,"ts_ms":int|null,"source":str|null,"day_min":int|null,"day_max":int|null,"day_avg":int|null,"count":int|null,"error":str|null}` — current heart rate from the oura `/heartrate` series; the ONLY intraday metric. Always 200s; `bpm` is null with an `error` when no token / no recent sample. |
| `GET /heartrate/day?date=` | `{"ok":bool,"points":[{"ts_ms":int,"bpm":int}],"min":int|null,"max":int|null,"avg":int|null,"count":int|null,"error":str|null}` — one local day's daytime HR curve (5-min buckets, sleep samples excluded). date defaults to local today. Same always-200 passthrough shape as `/live`. |
| `GET /summary/today`   | `{"date":str,"summary":{...},"metric":{...}|null,"data_as_of":int|null}` (latest day). The `metric` is enriched server-side with `explanation` (the "biggest drag" line) and `temp_flag` `{flagged,deviation,note}`. |
| `GET /summary/{date}`  | same shape for a given YYYY-MM-DD (404 if absent) |
| `GET /trends?metric=&days=30` | `{"metric":str,"points":[{"date":str,"value":float|null}],"baseline_14":float|null,"baseline_30":float|null}` ; metric ∈ {hrv_rmssd,resting_hr,temp_mean_c,sleep_min,spo2_avg,readiness_custom} (400 on unknown; baseline band only for hrv_rmssd/resting_hr/temp_mean_c) |
| `GET /sleep?days=30`   | `{"sessions":[sleep_session_dict...]}` — each session also carries `stages` (hypnogram timeline), `series` `{hr,hrv,movement}` (overnight 5-min curves, from `series_json`), `restless_periods`, and `rem_latency_min`. |
| `GET /metrics?days=30` | `{"points":[{"date":str,"readiness_custom":float,"components":{...}}]}` |
| `GET /tags?days=`      | `{"tags":[{id,ts_ms,label,note,created_at}...]}` |
| `POST /tags`           | body `{ts_ms:int,label:str,note?:str}` -> created tag (500 if the insert fails) |
| `DELETE /tags/{id}`    | `{"deleted":bool}` |
| `POST /sync`           | runs the pipeline by source priority — **oura** if `config.OURA_TOKEN` is set (the active path), else **live** (adb/snoop) if `config.ADB_TARGET` is set, else **synthetic** (dev: fabricate one day via tools.synth). Returns `{"ok":bool,"ingested":int,"deduped":int,"data_as_of":int|null,"mode":"oura"|"live"|"synthetic","error":str|null}` (error present only on failure). |

After any raw ingest (synthetic / live), recompute via the shared `pipeline.recompute`
(summarize.rebuild_all -> baselines + readiness -> store.upsert_metric). The oura
path instead scores in place via `pipeline.score_only` (no rebuild, since
`raw_records` is empty there).

---

## 7. `tools/synth.py` + `tools/seed.py`  (owner: AGENT-SYNTH)

```python
# synth.py  — deterministic via seed (plain python random is fine here)
def generate(days: int = 30, seed: int = 42, end_ms: int | None = None) -> list[dict]
#   emits raw envelope dicts (pre-normalize: with t_event_ms, type, sess, ctr, data)
#   across ALL canonical types, with realistic circadian + sleep patterns and a
#   couple of injected "bad nights" (suppressed hrv + elevated rhr + temp bump)
#   so readiness visibly dips. end_ms defaults to a fixed constant (NOT now()).
def write_jsonl(path, days=30, seed=42) -> int   # writes generated records as JSONL, returns count

# seed.py  — CLI: python -m tools.seed [--days N] [--db PATH]
#   generate -> store.ingest_records -> summarize.rebuild_all -> recompute metrics
#   prints a table of the last few days' readiness. THIS is the end-to-end proof.
```
`end_ms` must be parameter-injected/constant, never wall-clock, so tests are
reproducible.

---

## 8. `app/` Expo (TypeScript)  (owner: AGENT-APP)

Stack: Expo SDK 54 + expo-router + TanStack Query + react-native-gifted-charts
(plus react-native-reanimated, react-native-svg, and expo-audio/expo-haptics/
expo-image for the boot sequence). CRT/phosphor "Pompisi Studio" theming.

`lib/api.ts` is the typed client matching §6 (includes `getLive()` for `GET /live`).
`lib/types.ts` mirrors the JSON shapes. `lib/settings.ts` holds runtime-editable
settings (API base url, STATUS character, sound) in AsyncStorage with a pub/sub so
views update live. `lib/characters.ts` defines the selectable STATUS character
(`operative` | `wizard`). `lib/units.ts` converts skin temperature to Fahrenheit
for display (storage/scoring stay Celsius).

Base URL resolution (NOT hardcoded — the real Pi address is never committed):
in-app SET value (AsyncStorage) > `app.config.js` `extra.apiUrl` (from the
gitignored `app/.env` `VITALDECK_API_URL`) > `EXPO_PUBLIC_API_URL` > `''` (empty,
which makes the SET tab prompt for one). Reached over Tailscale.

Screens (expo-router, `app/`) and tabs:
- `index.tsx` → **STATUS**: Pip-Boy-style home — selectable character figure with
  vitals, readiness/CONDITION bar, readiness-factors panel, last rest cycle,
  live-ish current HR + a LIVE badge, a device-local 12h clock, a scrolling status
  ticker, and a terminal-style SYNC command (POST /sync).
- `trends.tsx` → **TRENDS**: metric picker + line chart with baseline band.
- `sleep.tsx` → **SLEEP**: per-night explorer (day strip, hypnogram, overnight
  HR/HRV curve, stage breakdown) + a **HISTORY** `MonthCalendar` (6-week readiness
  heatmap) and a "THAT DAY → full detail" link, both pushing the day route.
- `tags.tsx` → **LOG**: tag list + add.
- `settings.tsx` → **SET**: API base url, STATUS character toggle, boot-sound toggle.
- Hidden detail routes (no tab; reached via `router.push`, registered
  `<Tabs.Screen … options={{href:null}}/>`):
  - `readiness.tsx` → **READINESS**: ring hero + condition word + biggest-drag
    explanation + temp flag + the four explainable contributors (`ContributorBars`).
  - `day/[date].tsx` → **DAY DETAIL**: one consistent per-day lens for any date —
    reads `useLocalSearchParams` + `getSummary(date)`, composes `ReadinessRing` +
    `ContributorBars` + a vitals grid + REST tile. Entry points: STATUS condition
    block, SLEEP "THAT DAY" panel + history calendar. No new endpoint
    (`/summary/{date}` already carries the enriched metric; the calendar dots come
    from `/metrics`). Dynamic pushes are cast `as Href` (typed routes lag new routes).
- Shared: `components/ContributorBars.tsx` (the four readiness contributor bars,
  used by both readiness + day-detail) and `components/MonthCalendar.tsx`
  (`scoreColor`-tinted day dots; `onPick(date)` → day route).
- `_layout.tsx`: QueryClientProvider + tab nav + an animated boot/power-on
  sequence (the "Pompisi Studio" command-prompt logo types on, then an INITIALIZE
  button) and a CRT scanline/vignette overlay.

Do NOT run npm install (heavy + OneDrive); just author correct source + package.json.

---

## 9. `docs/`  (owner: AGENT-DOCS)

`SETUP.md` (Pi + phone + open_ring submodule + venv + run), `PHASE0_RUNBOOK.md`
(enable snoop log -> adb bugreport -> extract btsnoop -> replay -> validate
against official API/Health Connect during the free month), `ARCHITECTURE.md`
(data flow + the corrected facts from the plan review: no-root/no-keys is real for
passive decode, batch-not-live, scores-on-phone-not-cloud, no Oura FDA AFib).

---

## File-ownership map (NO two agents write the same file)

- AGENT-DB: `backend/vitaldeck/db/store.py`, `backend/tests/test_store.py`
- AGENT-METRICS: `backend/vitaldeck/summarize.py`, `backend/vitaldeck/metrics/baselines.py`, `backend/vitaldeck/metrics/readiness.py`, `backend/tests/test_metrics.py`, `backend/tests/test_summarize.py`
- AGENT-INGEST: `backend/vitaldeck/ingest/decode.py`, `backend/vitaldeck/ingest/pull_snoop.py`, `backend/vitaldeck/ingest/oura_api.py`, `backend/tests/test_decode.py`, `backend/tests/test_pull_snoop.py`
- AGENT-API: `backend/vitaldeck/api/main.py`, `backend/vitaldeck/api/models.py`, `backend/vitaldeck/pipeline.py`, `backend/vitaldeck/scheduler.py`, `backend/tests/test_api.py`
- AGENT-SYNTH: `backend/tools/synth.py`, `backend/tools/seed.py`, `backend/tools/__init__.py`, `backend/tests/test_synth.py`
- AGENT-APP: everything under `app/`
- AGENT-DOCS: everything under `docs/`, plus top-level `README.md`

Already written (DO NOT recreate): `config.py`, `vitaldeck/__init__.py`,
`vitaldeck/records.py`, `vitaldeck/db/__init__.py`, `vitaldeck/db/schema.sql`,
`vitaldeck/ingest/__init__.py`, `vitaldeck/metrics/__init__.py`,
`vitaldeck/api/__init__.py`, `.gitignore`, `requirements.txt`, `CONTRACTS.md`.
