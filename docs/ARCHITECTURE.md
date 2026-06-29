# VitalDeck — architecture

How data moves from the ring to a number on the screen, the tables it lives in
along the way, and a set of corrected facts from the plan review so nobody builds
against a myth.

---

## Data flow

```
Oura Ring ──BLE──► capture phone (Oura app sync, HCI snoop log = FULL)
   │
   │  adb bugreport (over Tailscale)
   ▼
pull_snoop.py ──► bugreport.zip ──► extract_btsnoop() ──► btsnoop_hci.log bytes
   │                                  (globs the zip; decodes embedded btsnooz
   │                                   blob if that's all there is)
   ▼
decode.py ──► python -m driver.cli replay  (cwd = vendor/open_ring)
   │              └─ JSONL on stdout
   ▼
records.parse_jsonl + records.normalize()
   │   • keys every record on t_event_ms (ring event time, not phone receive time)
   │   • drops rt-misparses (rt >= 2^31)
   │   • dedupe key = (t_event_ms, type, sess)
   ▼
store.ingest_records()  ──INSERT OR IGNORE──►  raw_records   (source of truth)
   │
   ▼
summarize.rebuild_all()
   ├─ summarize_records() ──► daily_summaries   (per local day)
   └─                     ──► sleep_sessions     (contiguous sleep_stage runs)
   │
   ▼
metrics:  baselines.compute_baselines()  ──► rolling 14/30-day personal means
          readiness.compute_readiness()  ──► metrics (custom 0–100, explainable)
   │
   ▼
api/main.py (FastAPI)  ──HTTP (LAN/Tailscale)──►  app/  (Today / Trends / Sleep / Tags)
```

Everything downstream of `raw_records` is a **derived projection**. Wipe the
summaries, sleep sessions, and metrics at any time and `rebuild_all()`
reconstructs them from the raw firehose. That's the whole point of keeping the
raw envelopes.

---

## Data model

All local SQLite (`db/schema.sql`). Tables:

### `raw_records` — the firehose / source of truth
One row per decoded event. `data_json` holds the type-specific fields. A unique
index on `(t_event_ms, type, sess)` makes ingest idempotent: re-running on
overlapping captures collapses duplicates via `INSERT OR IGNORE`.

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
`steps`, `met_high_min`.

### `sleep_sessions` — one row per night
Built from contiguous `sleep_stage` runs. `date` = the local morning the session
*ended*. Efficiency = asleep / time-in-bed × 100; latency = start → first
non-awake stage. Per-stage minutes + the ordered hypnogram in `stages_json`.

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

## Corrected facts from the plan review

Setting the record straight on claims that floated around during planning, so the
build rests on what's actually true.

- **Passive snoop-log decode is genuinely no-root AND no-keys.** We read a log
  Android writes itself once Developer Options enables it. The ring's **AES auth
  key is only needed for live Tier-2 connections** (actively talking to the ring
  ourselves) — which VitalDeck does not do. Passive decode of already-exchanged
  traffic needs neither root nor any key.

- **It's BATCH, not live.** The pipeline is capture → decode → ingest on a
  cadence. There is no streaming BLE connection and no real-time feed; numbers
  land minutes behind, which is fine for sleep/recovery.

- **The 0–100 scores are computed on the PHONE/server, not the cloud.** Readiness
  is *our* composite, derived from raw signals with weights you can read and
  tune. It is not Oura's score and is not fetched from any service.

- **Oura has NO FDA-cleared AFib feature.** That capability belongs to
  *competitors* (e.g. certain smartwatches). Don't imply VitalDeck — or the Oura
  data it reads — does AFib detection.

- **On-ring sleep staging exists, but its BLE decode is RE-uncertain.** The ring
  computes a hypnogram, but our reverse-engineered decode of it isn't fully
  trusted yet. We may compute our **own** sleep stages from HR/HRV/motion rather
  than relying on the ring's. Treat `sleep_stage` as provisional.

- **The HCI snoop log captures ALL Bluetooth devices**, not just the ring — so
  use a **dedicated capture phone** to keep the log small and avoid logging
  unrelated devices' traffic.

- **The protocol can break on Oura updates.** Firmware/app changes can shift the
  BLE protocol. We add **decode cross-checks** (Phase 0 validation against the
  official API during the free trial) so drift is caught instead of silently
  corrupting data.

These also live, in short form, in the README's "Locked decisions" and the
"What works today vs. what needs hardware" sections.
