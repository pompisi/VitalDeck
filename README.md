# VitalDeck

A personal dashboard for your own Oura Ring data — built so the data stays yours.

VitalDeck pulls the Bluetooth traffic your phone *already exchanged* with the
ring out of the Android HCI snoop log, decodes it with the community
[`open_ring`](https://github.com/LogosIsLife/open_ring) driver, and turns it into
a local SQLite store, a custom readiness score, and a small Expo app. No Oura
subscription, no cloud account, no API keys, no rooting the phone.

It is a **batch** tool, not a live monitor: you sync the ring through the
official app, capture the snoop log, decode it, and ingest. The numbers land a
few minutes behind real time — which is exactly what a sleep/recovery dashboard
needs.

---

## Locked decisions

These are settled; the rest of the repo is built against them.

- **Passive snoop-log decode — no root, no keys.** We read a log Android can be
  told to write itself. The ring's AES auth key is only needed for *live* Tier-2
  connections we don't do.
- **Batch, not live.** Capture → decode → ingest on a cadence (manual or a
  nightly scheduler), not a streaming BLE connection.
- **Scores are computed on the phone/server, not the cloud.** The 0–100
  readiness number is *ours*, derived from raw signals with weights you can read
  in `config.py`. Every score is stored with its components so it stays
  explainable.
- **Raw records are the source of truth.** `raw_records` is the firehose; daily
  summaries, sleep sessions, and metrics are all derived projections you can
  always rebuild from it.
- **Local-first.** Everything is a SQLite file on a Raspberry Pi (or your dev
  box). No backend service, no accounts.
- **JavaScript/TypeScript app, Python backend.** Backend is Python 3.10+; the
  app is Expo + expo-router + TanStack Query.

See `docs/ARCHITECTURE.md` for the corrected facts behind these (what's real vs.
what the marketing/competitors claim).

---

## Architecture at a glance

```
  ┌─────────────┐   foreground sync    ┌──────────────┐
  │  Oura Ring  │ ───── BLE ─────────► │ Capture phone │  (Developer Options:
  └─────────────┘                      │  + Oura app   │   Bluetooth HCI snoop
                                       └──────┬───────┘   log = FULL)
                                              │ adb bugreport (over Tailscale)
                                              ▼
  ┌──────────────────────────── Raspberry Pi (backend/) ───────────────────────┐
  │                                                                             │
  │  ingest/pull_snoop.py   ──►  bugreport.zip ──► btsnoop bytes                │
  │        │                                                                    │
  │        ▼                                                                    │
  │  ingest/decode.py  ──► python -m driver.cli replay  (vendor/open_ring)      │
  │        │                                  │ JSONL on stdout                 │
  │        ▼                                  ▼                                 │
  │  records.normalize()  ──►  db/store.ingest_records()  ──►  raw_records      │
  │                                              │                              │
  │                                              ▼                              │
  │  summarize.rebuild_all()  ──►  daily_summaries + sleep_sessions             │
  │                                              │                              │
  │                                              ▼                              │
  │  metrics/baselines + readiness  ──►  metrics (custom 0–100 score)           │
  │                                              │                              │
  │                                              ▼                              │
  │                                   api/main.py (FastAPI)                     │
  └──────────────────────────────────────────────┬────────────────────────────┘
                                                  │ HTTP (LAN / Tailscale)
                                                  ▼
                                       app/ (Expo: Today, Trends,
                                             Sleep, Tags)
```

For dev, no hardware is needed: `tools/synth.py` fabricates a realistic month of
records and the whole pipeline runs end to end.

---

## Repo layout

```
vitaldeck/
├─ README.md                  ← you are here
├─ CONTRACTS.md               ← the spine: signatures, record shapes, ownership
├─ backend/
│  ├─ config.py               ← env-overridable paths + tunables
│  ├─ requirements.txt
│  ├─ vitaldeck/
│  │  ├─ records.py           ← envelope normalize + dedupe
│  │  ├─ summarize.py         ← raw_records → daily summaries + sleep sessions
│  │  ├─ db/
│  │  │  ├─ schema.sql        ← the local store
│  │  │  └─ store.py          ← connect / ingest / read-write helpers
│  │  ├─ metrics/
│  │  │  ├─ baselines.py      ← rolling 14/30-day personal baselines
│  │  │  └─ readiness.py      ← custom explainable 0–100 score
│  │  ├─ ingest/
│  │  │  ├─ pull_snoop.py     ← adb bugreport → btsnoop extraction
│  │  │  └─ decode.py         ← shells out to open_ring's replay
│  │  ├─ api/
│  │  │  ├─ main.py           ← FastAPI app (`app`)
│  │  │  └─ models.py
│  │  ├─ scheduler.py         ← optional nightly auto-sync
│  │  └─ vendor/open_ring/    ← git submodule (added on the Pi, not vendored here)
│  ├─ tools/
│  │  ├─ synth.py             ← deterministic synthetic data
│  │  └─ seed.py              ← end-to-end proof: generate → ingest → score
│  └─ tests/
├─ app/                       ← Expo + expo-router app
│  ├─ app/                    ← index / trends / sleep / tags screens
│  └─ lib/                    ← typed api client + types
└─ docs/
   ├─ SETUP.md                ← one-time Pi + phone setup
   ├─ PHASE0_RUNBOOK.md       ← capture → decode → validate loop
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

Prove the whole pipeline with synthetic data (no ring required):

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

Useful env vars (all optional — see `config.py`):

| var | meaning | default |
|-----|---------|---------|
| `VITALDECK_DB` | sqlite file path | `backend/vitaldeck.db` |
| `VITALDECK_OPEN_RING` | open_ring submodule dir | `backend/vendor/open_ring` |
| `VITALDECK_ADB_TARGET` | adb `host:port`/serial for live sync | `""` (dev → synthetic) |
| `VITALDECK_ADB_BIN` | adb binary | `adb` |
| `VITALDECK_CAPTURE_DIR` | bugreport/btsnoop scratch dir | `backend/captures` |
| `VITALDECK_UTC_OFFSET` | local-day rollover offset (hours) | `-5` |
| `VITALDECK_API_HOST` / `VITALDECK_API_PORT` | uvicorn bind | `0.0.0.0` / `8000` |

> When `VITALDECK_ADB_TARGET` is empty, `POST /sync` falls back to generating a
> synthetic day so the app is fully clickable without hardware.

### App

```bash
cd app
npm install          # heavy on OneDrive — run it on a real disk if you can
npx expo start
```

Point the app at your backend with `EXPO_PUBLIC_API_URL`
(e.g. `http://<pi-tailscale-name>:8000`); it falls back to
`http://localhost:8000`.

---

## What works today vs. what needs hardware

**Works today, no ring, no phone, no root:**

- The full backend pipeline on **synthetic data** — `tools/seed.py` /
  `tools/synth.py` fabricate a realistic month (circadian HR, nightly HRV/SpO2,
  sleep stages, plus a couple of injected "bad nights" so readiness visibly
  dips).
- SQLite store + idempotent ingest/dedupe.
- Daily summaries, sleep sessions, rolling baselines, and the custom readiness
  score.
- The FastAPI surface and the Expo app, end to end, against synthetic data.

**Needs hardware (an Oura Ring + a dedicated Android capture phone):**

- Real capture: enabling the Bluetooth HCI snoop log and pulling a bugreport
  (`ingest/pull_snoop.py`). See `docs/SETUP.md` + `docs/PHASE0_RUNBOOK.md`.
- Real decode: `open_ring`'s `driver.cli replay` against your actual btsnoop —
  the canonical type/field mapping is validated during Phase 0.

**Honest caveats:**

- `open_ring` is a community reverse-engineering effort. The decoded `type`
  strings and `data` fields in `CONTRACTS.md` are a *faithful stand-in*; a thin
  mapping layer renames to upstream's exact names once verified on real captures.
- On-ring **sleep staging** is decoded but its BLE format is RE-uncertain — we
  may compute our own hypnogram instead of trusting the ring's.
- The protocol can **break on an Oura firmware/app update**. Decode cross-checks
  (Phase 0 validation) are how we catch that.
- The HCI snoop log captures **every** Bluetooth device the phone talks to — use
  a dedicated capture phone, not your daily driver.
- **Validate during the free trial.** Oura's official Cloud API / Health Connect
  export only works while a membership is active. Cross-check decoded HR/HRV/temp
  against them *while you can* — both vanish when the trial lapses.

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
above, and the hardware reverse-engineering and validation — and I own and
maintain the result. The design rationale and a defend-it-yourself walkthrough
live in [`docs/WALKTHROUGH.md`](docs/WALKTHROUGH.md). Using AI tooling this way is
a deliberate part of how I work, not a substitute for understanding the system.

---

This is a personal-use, single-ring tool. It is not affiliated with or endorsed
by Ōura.
