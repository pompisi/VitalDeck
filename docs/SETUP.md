# VitalDeck — one-time setup

Setting up the Raspberry Pi backend, the Expo app, and (optionally) the
capture phone. You do this once; after that the day-to-day loop lives in
`PHASE0_RUNBOOK.md`.

There are two ways VitalDeck gets real ring data:

- **Oura Cloud API (the default, active path).** The Pi pulls your nightly
  metrics — plus live-ish current heart rate — straight from the Oura cloud
  using a personal access token. No second phone, no adb, no snoop log. The Pi
  auto-syncs twice a day; you just open the app. **Most people only need this.**
- **Snoop log + open_ring (optional).** A subscription-free path that decodes
  the ring's own BLE traffic from a Bluetooth HCI snoop log on a capture phone.
  It's also the artifact that *validates* the decoder against the official API.
  This is occasional, not a daily ritual — see `PHASE0_RUNBOOK.md`.

You need:

- An **Oura Ring** paired to the official Oura app, and an **Oura account** you
  can mint a personal access token from (for the cloud path).
- A **Raspberry Pi** (or any always-on Linux box) to run the backend.
- **Tailscale** so the app on your phone can reach the Pi from anywhere.
- *(Optional, snoop path only)* a **dedicated Android phone** for capture (not
  your daily driver — the HCI snoop log records *every* Bluetooth device the
  phone talks to, so a clean phone keeps the capture small and private) and
  **Tailscale on the phone too** so adb can reach it.

---

## 1. Pi backend — venv + deps

```bash
git clone <your-vitaldeck-remote> vitaldeck
cd vitaldeck/backend

python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

---

## 2. Oura Cloud API — token (the default path)

Mint a **personal access token** from your Oura account and put it in a
secrets env file on the Pi (never commit it):

```bash
export VITALDECK_OURA_TOKEN="<your-oura-personal-access-token>"
```

When `VITALDECK_OURA_TOKEN` is set, `POST /sync` pulls from the Oura cloud
(sleep, readiness, SpO2, activity, heart rate) and the `GET /live` current-HR
readout in the app works. The twice-daily auto-sync also starts automatically.

You can stop here for the cloud path — skip ahead to **section 6 (environment
variables)** for the remaining knobs, then **section 7 (app config)** and
**section 8 (smoke-test)**. Sections 3–5 only apply to the optional snoop path.

---

## 3. (Optional) Capture phone — enable the snoop log

*Only needed for the subscription-free snoop path / decoder validation.*

### a. Unlock Developer Options

Settings → About phone → tap **Build number** seven times until it says you're a
developer.

### b. Enable USB / wireless debugging

Settings → System → **Developer options**:

- Turn on **Wireless debugging** (and **USB debugging** as a fallback).

### c. Enable the Bluetooth HCI snoop log — set it to FULL

Still in Developer options:

- Find **Bluetooth HCI snoop log** (sometimes under a "Networking" subsection).
- Set it to **Enabled / Full** — *not* "Filtered". Filtered mode strips the
  payload bytes we need.
- **Toggle Bluetooth off and back on** so the new logging mode takes effect.

> The snoop log is a **rolling buffer**. It overwrites the oldest packets once it
> fills, so you must capture *promptly* after a sync. See the runbook.

> Note: the day-to-day snoop capture in `PHASE0_RUNBOOK.md` uses a **bug report**
> over Tailscale and needs **no adb**. adb (section 4) is only for the
> live-pull (`VITALDECK_ADB_TARGET`) variant of the snoop path.

---

## 4. (Optional) Pair adb over Tailscale

*Only for the adb live-pull variant of the snoop path.*

Install Tailscale on the phone and the Pi; sign both into the same tailnet.

On the phone, in **Wireless debugging**, open **Pair device with pairing code** —
it shows an `IP:PORT` and a 6-digit code. From the Pi:

```bash
# pair once (uses the pairing IP:PORT + code from the phone)
adb pair <phone-tailscale-ip>:<pair-port>
# enter the 6-digit code when prompted

# then connect to the debugging IP:PORT shown on the main screen
adb connect <phone-tailscale-ip>:<connect-port>

adb devices   # should list the phone as "device"
```

The `IP:PORT` you `connect` to is what goes in `VITALDECK_ADB_TARGET`.

> Wireless-debugging ports change when the phone reboots or toggles the setting.
> If `adb devices` is empty, re-run `adb connect` (and re-pair if needed).

---

## 5. (Optional) Add the open_ring submodule (on the Pi)

*Only for the snoop path — the cloud path doesn't touch open_ring.*

`open_ring` is the community driver `decode.py` shells out to. The wire-protocol
reverse-engineering is open_ring's (GPLv3); VitalDeck uses it as a subprocess and
adds the data pipeline around it. We add it as a submodule **on the Pi**, not
vendored from a dev machine, so the Pi always has the exact upstream code.

```bash
# run from the repo root
git submodule add https://github.com/LogosIsLife/open_ring backend/vendor/open_ring
git submodule update --init --recursive
```

This lands at `backend/vendor/open_ring`, which is the default
`config.OPEN_RING_DIR`. Confirm the replay CLI is reachable:

```bash
cd backend/vendor/open_ring
python -m driver.cli --help
```

(Install open_ring's own deps per its README if it asks.)

---

## 6. Environment variables

Everything is env-overridable via `backend/vitaldeck/config.py`. Set what differs
from the defaults — for the cloud path that's typically just the Oura token and
your timezone offset. Example on the Pi:

```bash
# --- cloud path (default) ---
export VITALDECK_OURA_TOKEN="<your-oura-personal-access-token>"   # secret
export VITALDECK_UTC_OFFSET="-5"               # your local UTC offset, hours
export VITALDECK_DB="$PWD/vitaldeck.db"
export VITALDECK_API_HOST="0.0.0.0"
export VITALDECK_API_PORT="8000"

# --- snoop path only ---
export VITALDECK_ADB_TARGET="<phone-tailscale-ip>:<connect-port>"
export VITALDECK_ADB_BIN="adb"                 # or an absolute path to adb
export VITALDECK_OPEN_RING="$PWD/vendor/open_ring"
export VITALDECK_CAPTURE_DIR="$PWD/captures"
```

Persist these in your shell profile or a systemd unit so the API and scheduler
inherit them.

| var | meaning | default |
|-----|---------|---------|
| `VITALDECK_OURA_TOKEN` | Oura personal access token (secret); set it → `/sync` uses the cloud path | `""` |
| `VITALDECK_OURA_BASE` | Oura v2 API base | `https://api.ouraring.com/v2/usercollection` |
| `VITALDECK_OURA_TIMEOUT` | per-request timeout (s) | `20` |
| `VITALDECK_DB` | sqlite file | `backend/vitaldeck.db` |
| `VITALDECK_OPEN_RING` | open_ring submodule dir (snoop path) | `backend/vendor/open_ring` |
| `VITALDECK_ADB_TARGET` | adb `host:port`/serial (snoop live-pull) | `""` |
| `VITALDECK_ADB_BIN` | adb binary | `adb` |
| `VITALDECK_CAPTURE_DIR` | bugreport/btsnoop scratch | `backend/captures` |
| `VITALDECK_UTC_OFFSET` | local-day rollover (hours) | `-5` |
| `VITALDECK_API_HOST` / `VITALDECK_API_PORT` | uvicorn bind | `0.0.0.0` / `8000` |

> `POST /sync` picks its source by precedence: **Oura token** (cloud) if
> `VITALDECK_OURA_TOKEN` is set, else the **live snoop** path if
> `VITALDECK_ADB_TARGET` is set, else **synthetic** dev data. The twice-daily
> auto-sync runs whenever *either* the token or the adb target is configured;
> with neither set you're in synthetic/dev mode (handy while wiring things up).

---

## 7. App — point it at the Pi

The Expo app resolves its backend URL at runtime — there's **no hardcoded IP in
source**. Order of precedence: the in-app **SET** value (saved in the app) >
`app.config.js` `extra.apiUrl` (sourced from the gitignored `app/.env`) >
`EXPO_PUBLIC_API_URL` > empty.

For a build/OTA default, copy the example and set your Pi's URL (reachable over
Tailscale):

```bash
cd app
cp .env.example .env
# edit app/.env:
# VITALDECK_API_URL=http://<pi-over-tailscale>:8000
```

`app/.env` is gitignored, so the real address never lands in the public repo. You
can also leave it blank and just set the URL in-app on the **SET** tab on first
launch — that value persists and overrides the build default.

---

## 8. Smoke-test the backend

Before touching real captures, prove the pipeline with synthetic data:

```bash
cd backend
python -m tools.seed --days 30          # generate → ingest → summarize → score
uvicorn vitaldeck.api.main:app --host 0.0.0.0 --port 8000
```

Hit `http://<pi>:8000/health` and `http://<pi>:8000/summary/today`. With an Oura
token set, `POST /sync` then pulls real cloud data and `http://<pi>:8000/live`
returns current heart rate.

You're now set up. Go to **`PHASE0_RUNBOOK.md`** for the optional snoop-log
capture loop.
