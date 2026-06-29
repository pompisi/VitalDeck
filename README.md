# VitalDeck

A personal dashboard for your own Oura Ring data — built so the data stays yours.
A *Pompisi Studio* project.

VitalDeck pulls your Oura Ring metrics into a **local** SQLite store, computes a
custom readiness score on your own hardware, and renders it in a small Expo app
with a CRT/Pip-Boy look. It runs two ways:

- **Oura Cloud API (the active path).** With a personal access token it pulls
  sleep, readiness, SpO2, activity, and the intraday heart-rate series straight
  from Oura's v2 API — no debugging, no snoop log. This is what the app talks to
  today, and it's the only path that gives a **live-ish current heart rate**.
- **Passive snoop-log decode (subscription-free, parked for validation).** Pull
  the Bluetooth traffic your phone *already exchanged* with the ring out of the
  Android HCI snoop log and decode it with the community
  [`open_ring`](https://github.com/LogosIsLife/open_ring) driver. No root, no
  keys, no Oura subscription. This path stays in validation until it's
  cross-checked against the cloud data.

Either way the data lands in the same local store and runs through the same
baselines/readiness math. It's a **batch** tool at heart — nightly metrics
(HRV/SpO2/temp/sleep) update once a day — with one live exception: current heart
rate, the only metric Oura exposes intraday.

---

## Locked decisions

These are settled; the rest of the repo is built against them.

- **Your data, on your box.** Whether it comes from the Oura Cloud API or a
  decoded snoop log, everything is written to a local SQLite file on a Raspberry
  Pi (or your dev box). No third-party dashboard, no account on someone else's
  server.
- **Two ingest paths, one pipeline.** Cloud-API and snoop-log ingest both feed
  the same summaries, baselines, and readiness score, so the analysis doesn't
  care where the bytes came from.
- **Batch core, one live readout.** Nightly metrics sweep on a cadence
  (twice-daily auto-sync, or manual). Current heart rate is the lone intraday
  signal, surfaced via a dedicated `/live` endpoint.
- **Scores are computed on the phone/server, not the cloud.** The 0–100
  readiness number is *ours*, derived from raw signals with weights you can read
  in `vitaldeck/config.py`. Every score is stored with its components so it
  stays explainable.
- **Raw records are the source of truth (snoop path).** `raw_records` is the
  firehose; daily summaries, sleep sessions, and metrics are derived projections
  you can always rebuild from it. (The cloud-API path upserts summaries
  directly, since Oura already aggregates them — so it scores without a rebuild.)
- **JavaScript/TypeScript app, Python backend.** Backend is Python 3.10+; the
  app is Expo + expo-router + TanStack Query.

See `docs/ARCHITECTURE.md` for the corrected facts behind these (what's real vs.
what the marketing/competitors claim).

---

## Architecture at a glance

```
  ┌──────────────────────────── two ways in ───────────────────────────────────┐
  │                                                                             │
  │  A) Oura Cloud API (active)            B) Snoop-log decode (parked/validate)│
  │     personal access token                 foreground sync → HCI snoop log   │
  │     ingest/oura_api.py                     ingest/pull_snoop.py (adb)        │
  │     /sleep,/daily_readiness,               → btsnoop bytes                   │
  │     /daily_spo2,/daily_activity,           ingest/decode.py → open_ring      │
  │     /heartrate (intraday HR)               (vendor/open_ring) → JSONL        │
  └───────────────┬─────────────────────────────────────┬───────────────────────┘
                  │ upsert summaries + sleep             │ records → raw_records
                  ▼                                      ▼  → rebuild summaries
  ┌──────────────────────────── Raspberry Pi (backend/) ───────────────────────┐
  │  db/store.py (SQLite)  ──►  metrics/baselines + readiness (custom 0–100)    │
  │                                              │                              │
  │                                              ▼                              │
  │                                   api/main.py (FastAPI)                     │
  │   /health /live /summary /trends /sleep /metrics /tags /sync               │
  └──────────────────────────────────────────────┬────────────────────────────┘
                                                  │ HTTP (LAN / Tailscale)
                                                  ▼
                                  app/ (Expo: STATUS, TRENDS,
                                        SLEEP, LOG, SET)
```

For dev, no hardware or token is needed: `tools/synth.py` fabricates a realistic
month of records and the whole pipeline runs end to end (and `POST /sync` falls
back to generating one synthetic day).

---

## Repo layout

```
vitaldeck/
├─ README.md                  ← you are here
├─ CONTRACTS.md               ← the spine: signatures, record shapes, ownership
├─ backend/
│  ├─ requirements.txt
│  ├─ vitaldeck/
│  │  ├─ config.py            ← env-overridable paths + tunables (token, weights…)
│  │  ├─ records.py           ← envelope normalize + dedupe
│  │  ├─ summarize.py         ← raw_records → daily summaries + sleep sessions
│  │  ├─ pipeline.py          ← shared recompute/score (api + scheduler reuse it)
│  │  ├─ scheduler.py         ← twice-daily auto-sync (no-ops in dev)
│  │  ├─ db/
│  │  │  ├─ schema.sql        ← the local store
│  │  │  └─ store.py          ← connect / ingest / read-write helpers
│  │  ├─ metrics/
│  │  │  ├─ baselines.py      ← rolling 14/30-day personal baselines
│  │  │  └─ readiness.py      ← custom explainable 0–100 score
│  │  ├─ ingest/
│  │  │  ├─ oura_api.py       ← Oura Cloud API pull (active path) + live HR
│  │  │  ├─ pull_snoop.py     ← adb bugreport → btsnoop extraction
│  │  │  └─ decode.py         ← shells out to open_ring's replay
│  │  ├─ api/
│  │  │  ├─ main.py           ← FastAPI app (`app`)
│  │  │  └─ models.py
│  │  └─ vendor/open_ring/    ← git submodule (added on the Pi, not vendored here)
│  ├─ tools/
│  │  ├─ synth.py             ← deterministic synthetic data
│  │  ├─ seed.py              ← end-to-end proof: generate → ingest → score
│  │  ├─ ingest_zip.py        ← ingest a saved bugreport zip
│  │  └─ validate.py          ← cross-check decoded signals during validation
│  └─ tests/
├─ app/                       ← Expo + expo-router app
│  ├─ app/                    ← index(STATUS) / trends / sleep / tags(LOG) / settings(SET)
│  └─ lib/                    ← typed api client, settings, characters, units, types
└─ docs/
   ├─ SETUP.md                ← one-time Pi + phone setup
   ├─ PHASE0_RUNBOOK.md       ← capture → decode → validate loop
   ├─ SAMSUNG_SNOOP_FINDING.md← capture-device notes
   ├─ WALKTHROUGH.md          ← design rationale + defend-it-yourself walkthrough
   └─ ARCHITECTURE.md         ← data flow + corrected facts
```

---

## Quickstart

### Backend

The dev box runs Python 3.13; anything 3.10+ is fine. All commands run from
`backend/`.

```bash
cd backend

# one-time: virtualenv + deps
python -m venv .venv
# Windows
.venv\Scripts\activate
# macOS / Linux / Pi
source .venv/bin/activate

pip install -r requirements.txt
```

Prove the whole pipeline with synthetic data (no ring, no token required):

```bash
# generate a month of records → ingest → summarize → score,
# then print the last few days' readiness
python -m tools.seed --days 30
```

Run the API:

```bash
# the app object is vitaldeck.api.main:app
uvicorn vitaldeck.api.main:app --host 0.0.0.0 --port 8000
```

Then hit `http://localhost:8000/health` and `http://localhost:8000/summary/today`.

**HTTP surface** (`vitaldeck/api/main.py`):

| method | path | purpose |
|--------|------|---------|
| GET | `/health` | liveness + newest-event timestamp |
| GET | `/live` | live-ish current heart rate (+ today's HR min/max/avg) — the only intraday metric; always 200, `bpm` null when unavailable |
| GET | `/summary/today` · `/summary/{date}` | a day's summary + its readiness metric |
| GET | `/trends?metric&days` | one metric over time + its 14/30-day baseline band |
| GET | `/sleep?days` · `/metrics?days` | recent sleep sessions · readiness + per-component breakdown |
| GET/POST | `/tags` · DELETE `/tags/{id}` | manual context tags (caffeine, gym, alcohol…) |
| POST | `/sync` | the one write path; returns `mode`: `oura` / `live` / `synthetic` |

`POST /sync` picks its source by what's configured, in this order: an Oura token
(`oura`) → an adb target for the snoop path (`live`) → otherwise a fabricated
synthetic day (`synthetic`). When a real source is configured, a background job
also auto-syncs twice daily.

Useful env vars (all optional — see `vitaldeck/config.py`):

| var | meaning | default |
|-----|---------|---------|
| `VITALDECK_OURA_TOKEN` | Oura personal access token; when set, `/sync` uses the cloud path first | `""` |
| `VITALDECK_OURA_BASE` | Oura v2 API base | `https://api.ouraring.com/v2/usercollection` |
| `VITALDECK_OURA_TIMEOUT` | per-request timeout (seconds) | `20` |
| `VITALDECK_DB` | sqlite file path | `backend/vitaldeck.db` |
| `VITALDECK_OPEN_RING` | open_ring submodule dir | `backend/vendor/open_ring` |
| `VITALDECK_ADB_TARGET` | adb `host:port`/serial for the snoop path | `""` (dev → synthetic) |
| `VITALDECK_ADB_BIN` | adb binary | `adb` |
| `VITALDECK_CAPTURE_DIR` | bugreport/btsnoop scratch dir | `backend/captures` |
| `VITALDECK_UTC_OFFSET` | local-day rollover offset (hours) | `-5` |
| `VITALDECK_API_HOST` / `VITALDECK_API_PORT` | uvicorn bind | `0.0.0.0` / `8000` |

> With neither an Oura token nor an `VITALDECK_ADB_TARGET` set, `POST /sync`
> falls back to generating a synthetic day so the app is fully clickable without
> hardware or a subscription.

### App

```bash
cd app
npm install          # heavy on OneDrive — run it on a real disk if you can
npx expo start
```

Point the app at your backend by setting `VITALDECK_API_URL` in `app/.env`
(gitignored — copy `app/.env.example`). It rides into builds/OTA via
`app.config.js` (`extra.apiUrl`). The resolved base URL is, in order: the in-app
**SET** tab value (persisted) → `extra.apiUrl` → `EXPO_PUBLIC_API_URL` → empty.
There is no hardcoded address in the repo; if nothing is configured, the SET tab
prompts you for one. The real Pi address is reached over Tailscale and is never
committed.

The app has five tabs — **STATUS** (vitals + live HR + readiness), **TRENDS**,
**SLEEP**, **LOG** (context tags), and **SET** (backend URL, STATUS character,
boot-sound toggle). A few touches worth calling out:

- An animated boot/power-on screen (the Pompisi Studio command-prompt logo types
  on, then an INITIALIZE handoff into the app).
- A selectable STATUS character (OPERATIVE or WIZARD, chosen in SET).
- Live-ish current heart rate with a **LIVE** badge and a live device clock.
- Skin temperature shown in Fahrenheit (storage and scoring stay Celsius).

---

## What works today vs. what needs hardware

**Works today, no ring, no phone, no token:**

- The full backend pipeline on **synthetic data** — `tools/seed.py` /
  `tools/synth.py` fabricate a realistic month (circadian HR, nightly HRV/SpO2,
  sleep stages, plus a couple of injected "bad nights" so readiness visibly
  dips).
- SQLite store + idempotent ingest/dedupe.
- Daily summaries, sleep sessions, rolling baselines, and the custom readiness
  score.
- The FastAPI surface and the Expo app, end to end, against synthetic data.

**Works today with a token (no phone, no root):**

- Real data via the **Oura Cloud API** while a membership/trial is active —
  sleep, readiness, SpO2, activity, and the intraday heart-rate series that backs
  the live HR readout (`ingest/oura_api.py`).

**Needs hardware (an Oura Ring + a dedicated Android capture phone):**

- The subscription-free **snoop-log path**: enabling the Bluetooth HCI snoop log
  and pulling a bugreport (`ingest/pull_snoop.py`), then decoding with
  `open_ring`'s `driver.cli replay` against your actual btsnoop. See
  `docs/SETUP.md` + `docs/PHASE0_RUNBOOK.md`.

**Honest caveats:**

- `open_ring` is a community reverse-engineering effort. The decoded `type`
  strings and `data` fields in `CONTRACTS.md` are a *faithful stand-in*; a thin
  mapping layer renames to upstream's exact names once verified on real captures.
- On-ring **sleep staging** is decoded but its BLE format is RE-uncertain — on
  the cloud path we derive a hypnogram from `sleep_phase_5_min` when explicit
  stage durations are missing.
- The snoop protocol can **break on an Oura firmware/app update**. Decode
  cross-checks (Phase 0 validation) are how we catch that.
- The HCI snoop log captures **every** Bluetooth device the phone talks to — use
  a dedicated capture phone, not your daily driver.
- **Validate during the free trial.** The Oura Cloud API (and the official
  Health Connect export) only work while a membership is active. Cross-check
  decoded HR/HRV/temp against them *while you can* — both vanish when the trial
  lapses, at which point the snoop-log path is what's left.

## Credits & licensing

VitalDeck's own code is released under the [MIT License](LICENSE).

The Bluetooth protocol decoding is **not** mine — it's the work of the community
[`open_ring`](https://github.com/LogosIsLife/open_ring) project (GPLv3). VitalDeck
invokes it as a **subprocess** (`python -m driver.cli replay`) and consumes its
JSONL output; it does not import or link `open_ring`'s code, so the two stay at
arm's length. `open_ring` isn't vendored here — it's cloned into
`backend/vendor/open_ring` at setup time. All credit for the reverse-engineered
Oura Ring 4 BLE protocol goes to its authors.

## Development notes

This project was built with AI-assisted development (Claude Code). I drove the
architecture and engineering decisions, the research behind the locked decisions
above, the systems integration and data pipeline, the full-stack app, and the
infrastructure — and I own and maintain the result. The wire-protocol
reverse-engineering is credited to `open_ring` (see above); my own contribution
is everything around it, including the validation work that cross-checks the
decode against the cloud data. The design rationale and a defend-it-yourself
walkthrough live in [`docs/WALKTHROUGH.md`](docs/WALKTHROUGH.md). Using AI
tooling this way is a deliberate part of how I work, not a substitute for
understanding the system.

---

This is a personal-use, single-ring tool. It is not affiliated with or endorsed
by Ōura.
