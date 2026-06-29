# VitalDeck — architecture

How data moves from the ring to a number on the screen, the tables it lives in
along the way, and a set of corrected facts from the plan review so nobody builds
against a myth.

---

## Data flow

VitalDeck has two ways to get real data in, plus a synthetic mode for dev. The
ingest source is chosen at sync time by what's configured (see `run_sync()` in
`api/main.py`):

1. **Oura Cloud API (`mode: "oura"`) — the active path.** When `OURA_TOKEN` is
   set, `/sync` pulls the Oura v2 usercollection endpoints with a personal access
   token and writes the derived tables directly. This is the no-debugging,
   no-snoop-log path used while a membership/trial is active.
2. **BLE snoop decode (`mode: "live"`) — the subscription-free alternative,
   parked/validation.** Capture → decode → ingest from a Bluetooth HCI snoop log.
   The wire-protocol decode itself is **open_ring (GPLv3), invoked via
   subprocess** — VitalDeck does not reverse-engineer the protocol; it integrates
   open_ring into the pipeline.
3. **Synthetic (`mode: "synthetic"`) — dev fallback.** With no token and no ADB
   target, `/sync` fabricates one fresh day and runs it through the full pipeline.

```
                         ┌─ OURA_TOKEN set ─► oura_api.ingest_oura()  (mode: "oura", ACTIVE)
                         │      pulls v2: sleep, daily_readiness, daily_spo2, daily_activity
                         │      upserts daily_summaries + sleep_sessions DIRECTLY (no raw_records)
                         │      then pipeline.score_only()  ── readiness without a rebuild
/sync ── run_sync() ─────┤
                         │─ ADB_TARGET set ─► snoop decode    (mode: "live", parked/validation)
                         │      (see snoop pipeline below)
                         │
                         └─ neither ───────► tools.synth      (mode: "synthetic", dev)
                                rebuild + score the raw firehose
```

### Snoop decode path (subscription-free alternative)

```
Oura Ring ──BLE──► capture phone (Oura app sync, HCI snoop log = FULL)
   │
   │  adb bugreport (over Tailscale)
   ▼
pull_snoop.py ──► bugreport.zip ──► extract_btsnoop() ──► btsnoop_hci.log bytes
   │                                  (globs the zip; decodes embedded btsnooz
   │                                   blob if that's all there is)
   ▼
decode.py ──► python -m driver.cli replay  (cwd = vendor/open_ring — open_ring,
   │              └─ JSONL on stdout         GPLv3, the wire-protocol decoder)
   ▼
records.parse_jsonl + records.normalize()
   │   • keys every record on t_event_ms (ring event time, not phone receive time)
   │   • drops rt-misparses (rt >= 2^31)
   │   • dedupe key = (t_event_ms, type, sess)
   ▼
store.ingest_records()  ──INSERT OR IGNORE──►  raw_records   (source of truth)
   │
   ▼
summarize.rebuild_all()  (via pipeline.recompute)
   ├─ summarize_records() ──► daily_summaries   (per local day)
   └─                     ──► sleep_sessions     (contiguous sleep_stage runs)
   │
   ▼
metrics:  baselines.compute_baselines()  ──► rolling 14/30-day personal means
          readiness.compute_readiness()  ──► metrics (custom 0–100, explainable)
```

On the **snoop/synthetic paths**, everything downstream of `raw_records` is a
**derived projection**: wipe the summaries, sleep sessions, and metrics at any
time and `rebuild_all()` reconstructs them from the raw firehose. That's the
whole point of keeping the raw envelopes.

The **Oura path is different**: it has no `raw_records` to rebuild from — it
upserts `daily_summaries` + `sleep_sessions` directly and then runs `score_only`
(NOT `rebuild_all`, which would wipe the upserted rows). Either way the same
baselines/readiness math runs, so the score means the same thing no matter where
the data came from.

---

## HTTP surface

The read-mostly API the Expo app consumes (`api/main.py`, FastAPI, served over
LAN / Tailscale). Every endpoint opens a fresh per-request SQLite connection;
CORS is wide-open because it only ever runs on a personal net.

| method | path | purpose |
|--------|------|---------|
| GET | `/health` | liveness; reports `db` ok + newest `data_as_of` |
| GET | `/live` | current heart rate from the Oura `/heartrate` time series — the **only** intraday metric (hrv/spo2/temp/sleep are nightly). Returns `ok, bpm, ts_ms, source, day_min, day_max, day_avg, count`; always 200 (bpm null + `error` when no token / no recent sample) |
| GET | `/summary/today` | latest stored day + its readiness metric |
| GET | `/summary/{date}` | same shape for an explicit `YYYY-MM-DD` |
| GET | `/trends?metric&days` | one metric over time + its 14/30-day baseline band |
| GET | `/sleep?days` | recent sleep sessions |
| GET | `/metrics?days` | readiness score + per-component breakdown |
| GET | `/tags?days` | manual context tags |
| POST | `/tags` | create a tag |
| DELETE | `/tags/{id}` | delete a tag |
| POST | `/sync` | the one write path; returns `mode` = `oura` \| `live` \| `synthetic` |

Auto-sync runs twice daily via the scheduler (no-ops in synthetic/dev).

---

## Data model

All local SQLite (`db/schema.sql`). Tables:

### `raw_records` — the firehose / source of truth
One row per decoded event (snoop/synthetic paths only — the Oura path leaves this
empty). `data_json` holds the type-specific fields. A unique index on
`(t_event_ms, type, sess)` makes ingest idempotent: re-running on overlapping
captures collapses duplicates via `INSERT OR IGNORE`.

Canonical record types and their `data` fields (from `CONTRACTS.md` — synth emits
these, summarize consumes them):

| type | data | cadence |
|------|------|---------|
| `heart_rate` | `{bpm, asleep}` | ~5 min, day + night |
| `hrv` | `{rmssd_ms}` | nightly, ~5 min while asleep |
| `ibi` | `{ibi_ms}` | sparse sample |
| `skin_temp` | `{temp_c}` | ~10 min |
| `spo2` | `{spo2_pct}` | nightly |
| `resp` | `{rpm}` | nightly |
| `accel` | `{acm}` | daytime activity magnitude |
| `activity_met` | `{met}` | daytime MET bin |
| `sleep_stage` | `{stage, duration_s}` | on-ring hypnogram (RE-uncertain) |
| `battery` | `{pct}` | occasional |

Day grouping: a record's local day =
`floor((t_event_ms/1000 + offset)/86400)` where
`offset = LOCAL_UTC_OFFSET_HOURS * 3600`.

### `sync_runs` — provenance
One row per ingest attempt: when it ran, the source capture, status, and ingest /
dedupe counts. Lets you audit where any batch of records came from.

### `daily_summaries` — one row per local day
Derived per-day rollups: `resting_hr` (~5th percentile of asleep HR),
`hr_min/max/avg_day`, `hrv_rmssd`, `spo2_avg`, `resp_rate`, `temp_mean_c`,
`sleep_min`, `sleep_efficiency`, `sleep_latency_min`, `stage_breakdown_json`,
`steps`, `met_high_min`. Filled by `summarize` on the snoop/synthetic paths, or
upserted directly from the Oura mapping on the cloud path.

### `sleep_sessions` — one row per night
Built from contiguous `sleep_stage` runs. `date` = the local morning the session
*ended*. Efficiency = asleep / time-in-bed × 100; latency = start → first
non-awake stage. Per-stage minutes + the ordered hypnogram in `stages_json`. On
the Oura path the hypnogram comes from Oura's `sleep_phase_5_min` (with a fallback
to the explicit `*_duration` fields, or vice-versa).

### `metrics` — one row per day, the custom score
`readiness_custom` (0–100) plus `components_json` (the per-component subscores +
weights + notes) and `baselines_json` (the baselines snapshotted at compute
time). Storing the components keeps the number **explainable** — you can always
see *why* it dipped.

### `tags` — manual annotations
`{ts_ms, label, note, created_at}` — "late caffeine", "gym", "alcohol" — so you
can correlate behavior against the curves.

---

## The custom readiness score

Computed locally (`metrics/readiness.py`), never fetched from a cloud. Each
component produces a subscore in `[0, 1]`; the final score is
`round(100 * Σ(weight × subscore))` over the weights in `config.READINESS_WEIGHTS`
(hrv 0.40, resting_hr 0.25, temp 0.15, sleep 0.20).

- **HRV** — higher vs. baseline is better.
- **Resting HR** — lower vs. baseline is better.
- **Temp** — penalizes absolute deviation from baseline (a temp bump flags at
  `|dev| >= 0.35 °C`).
- **Sleep** — duration vs. `SLEEP_TARGET_MIN` (450) blended with efficiency.

Baselines are rolling means over the most recent 14 and 30 days, skipping `None`
values. With no baseline yet, a component defaults to a neutral 0.5 subscore and
says so in its note — the score degrades gracefully on a fresh install.

---

## The app

Expo / React Native (SDK 54) with `expo-router` file-based tabs; data fetching via
`@tanstack/react-query`; charts via `react-native-gifted-charts` /
`react-native-svg`; animations via `react-native-reanimated`. CRT phosphor styling
throughout, by Pompisi Studio.

- **Tabs:** STATUS (home — figure + vitals + condition bar + readiness factors +
  last rest + sync command), TRENDS, SLEEP, LOG (manual tags), SET (settings).
- **Live-ish HR** is polled from `/live` (~60s) and shown with a LIVE badge when
  fresh; it falls back to last night's resting HR otherwise.
- **Backend URL is not hardcoded.** It's resolved at runtime as: in-app SET value
  (AsyncStorage) > `app.config.js` `extra.apiUrl` (from the gitignored
  `app/.env` `VITALDECK_API_URL`) > `EXPO_PUBLIC_API_URL` > empty. The SET tab can
  re-point it (with a TEST that pings `/health`) without a rebuild. The real Pi
  address is never committed.
- **Presentation niceties:** an animated boot/power-on sequence, a selectable
  STATUS character (OPERATIVE or WIZARD), a live 12h device clock, a scrolling
  status ticker, a boot-sound toggle, and skin temperature shown in Fahrenheit
  (storage/scoring stay in Celsius — see `lib/units.ts`).

The backend runs as a FastAPI + SQLite (stdlib-only) service on a Raspberry Pi,
behind a systemd unit, reached over Tailscale.

---

## Corrected facts from the plan review

Setting the record straight on claims that floated around during planning, so the
build rests on what's actually true.

- **Passive snoop-log decode is genuinely no-root AND no-keys.** We read a log
  Android writes itself once Developer Options enables it. The ring's **AES auth
  key is only needed for live Tier-2 connections** (actively talking to the ring
  ourselves) — which VitalDeck does not do. Passive decode of already-exchanged
  traffic needs neither root nor any key. (The decode itself is open_ring, GPLv3.)

- **It's BATCH, not live.** Both real paths are capture/pull → ingest on a
  cadence. There is no streaming BLE connection; numbers land minutes behind,
  which is fine for sleep/recovery. (`/live` HR is only "as fresh as the ring's
  last upload to the Oura app" — still minutes, not a live feed.)

- **The 0–100 scores are computed on the PHONE/server, not the cloud.** Readiness
  is *our* composite, derived from raw signals with weights you can read and
  tune. It is not Oura's score and is not fetched from any service.

- **Oura has NO FDA-cleared AFib feature.** That capability belongs to
  *competitors* (e.g. certain smartwatches). Don't imply VitalDeck — or the Oura
  data it reads — does AFib detection.

- **On-ring sleep staging exists, but its BLE decode is RE-uncertain.** The ring
  computes a hypnogram, but open_ring's decode of it isn't fully trusted yet on
  the snoop path. We may compute our **own** sleep stages from HR/HRV/motion
  rather than relying on the ring's. Treat snoop-path `sleep_stage` as provisional.
  (On the Oura path, staging comes from Oura's own fields/hypnogram.)

- **The HCI snoop log captures ALL Bluetooth devices**, not just the ring — so
  use a **dedicated capture phone** to keep the log small and avoid logging
  unrelated devices' traffic.

- **The protocol can break on Oura updates.** Firmware/app changes can shift the
  BLE protocol the snoop path depends on. The Oura Cloud API path is used to
  cross-check the decode (validation against the official data) so drift is caught
  instead of silently corrupting data.

These also live, in short form, in the README's "Locked decisions" and the
"What works today vs. what needs hardware" sections.
