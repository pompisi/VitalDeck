# VitalDeck — one-time setup

Setting up the capture phone, the Raspberry Pi backend, and the link between
them. You do this once; after that the day-to-day loop lives in
`PHASE0_RUNBOOK.md`.

You need:

- An **Oura Ring** paired to the official Oura app.
- A **dedicated Android phone** for capture. Not your daily driver — the HCI
  snoop log records *every* Bluetooth device the phone talks to, so a clean phone
  keeps the capture small and private.
- A **Raspberry Pi** (or any always-on Linux box) to run the backend.
- **Tailscale** on both the phone and the Pi so adb can reach the phone from
  anywhere.

---

## 1. Capture phone — enable the snoop log

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

---

## 2. Pair adb over Tailscale

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

## 3. Pi backend — venv + deps

```bash
git clone <your-vitaldeck-remote> vitaldeck
cd vitaldeck/backend

python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

---

## 4. Add the open_ring submodule (on the Pi)

`open_ring` is the community driver `decode.py` shells out to. We add it as a
submodule **on the Pi**, not vendored from a dev machine, so the Pi always has
the exact upstream code.

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

## 5. Environment variables

Everything is env-overridable via `backend/config.py`. Set what differs from the
defaults — typically the adb target and your timezone offset. Example on the Pi:

```bash
export VITALDECK_ADB_TARGET="<phone-tailscale-ip>:<connect-port>"
export VITALDECK_ADB_BIN="adb"                 # or an absolute path to adb
export VITALDECK_OPEN_RING="$PWD/vendor/open_ring"
export VITALDECK_CAPTURE_DIR="$PWD/captures"
export VITALDECK_DB="$PWD/vitaldeck.db"
export VITALDECK_UTC_OFFSET="-5"               # your local UTC offset, hours
export VITALDECK_API_HOST="0.0.0.0"
export VITALDECK_API_PORT="8000"
```

Persist these in your shell profile or a systemd unit so the API and scheduler
inherit them.

| var | meaning | default |
|-----|---------|---------|
| `VITALDECK_DB` | sqlite file | `backend/vitaldeck.db` |
| `VITALDECK_OPEN_RING` | open_ring submodule dir | `backend/vendor/open_ring` |
| `VITALDECK_ADB_TARGET` | adb `host:port`/serial | `""` (empty → synthetic) |
| `VITALDECK_ADB_BIN` | adb binary | `adb` |
| `VITALDECK_CAPTURE_DIR` | bugreport/btsnoop scratch | `backend/captures` |
| `VITALDECK_UTC_OFFSET` | local-day rollover (hours) | `-5` |
| `VITALDECK_API_HOST` / `VITALDECK_API_PORT` | uvicorn bind | `0.0.0.0` / `8000` |

> Leaving `VITALDECK_ADB_TARGET` empty (the dev default) makes `POST /sync` fall
> back to synthetic data — handy while you're still wiring things up.

---

## 6. Smoke-test the backend

Before touching real captures, prove the pipeline with synthetic data:

```bash
cd backend
python -m tools.seed --days 30          # generate → ingest → summarize → score
uvicorn vitaldeck.api.main:app --host 0.0.0.0 --port 8000
```

Hit `http://<pi>:8000/health` and `http://<pi>:8000/summary/today`.

You're now set up. Go to **`PHASE0_RUNBOOK.md`** for the real capture loop.
