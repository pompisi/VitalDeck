# Phase 0 — capture real ring data via the snoop log (no adb required)

## When you'd do this
Daily data comes automatically from the **Oura API** — the Pi auto-syncs twice a day, you just
open the app. This snoop-log capture is the **occasional, subscription-free path** plus the
**one-time proof** that the reverse-engineered decoder actually works. It is **not** a daily
ritual, and it needs **no second phone, no root** (and no adb — Taildrop is enough).

> The wire-protocol decode is done by **open_ring** (GPLv3), which VitalDeck shells out to via
> subprocess; this repo's contribution is the capture/ingest/validate pipeline around it.

## 1. Turn on snoop logging (one-time, on your phone)
- Settings → About phone → Software information → tap **Build number** 7× (enables Developer
  options).
- Developer options → **Bluetooth HCI snoop log** → set to **Enabled / Full** (not "Filtered" —
  Filtered strips the payload bytes we need). This is just a toggle, not adb.
- Toggle **Bluetooth off then on** so logging starts.

## 2. Capture a night
- Wear the ring. Open the **Oura app** and let it sync the ring — that's what puts the ring's
  BLE traffic into the snoop log. The log is a **rolling buffer**, so export promptly after a
  sync (see below).

## 3. Export the log (no adb)
How you get the snoop log off the phone depends on the device:

- **Stock Android / Pixel:** `adb bugreport`, or Developer options → **Bug report** →
  **Interactive report**, bundles `btsnoop_hci.log` into the zip. Share that zip to the Pi.
- **Recent Samsung (One UI 7/8):** the standard bug report **does not** include the snoop log —
  use Samsung **SysDump** instead (`*#9900#` → run dumpstate → Copy to SD Card). The full,
  device-specific procedure (Auto Blocker caveat, where the `dumpState-*.zip` lands) is in
  **`docs/SAMSUNG_SNOOP_FINDING.md`** — follow that one on Samsung hardware.

Then get the resulting zip to the Pi. Easiest with **Taildrop** (no adb): in the Tailscale app,
**Send file → the Pi**. (Fallbacks: `adb pull` if you have it wired, Google Drive, or USB to a
PC then `scp`.)
- On the Pi, receive a Taildrop:
  ```bash
  mkdir -p ~/captures && tailscale file get ~/captures/
  ```

## 4. Decode + ingest (on the Pi)
```bash
cd ~/vitaldeck/backend && source .venv/bin/activate
python -m tools.ingest_zip ~/captures/dumpState-*.zip   # or bugreport-*.zip on stock Android
```
`ingest_zip` globs the zip for any `btsnoop` member (so a SysDump `dumpState` zip and a stock
`bugreport` zip work the same), then prints a **record-type histogram** — the smoke test: did
`open_ring replay` decode the ring's BLE? — then ingests + recomputes. Reload the app to see the
snoop-sourced day.

## 5. Validate against the API (the proof artifact)
```bash
# token from the gitignored env file on the Pi — never commit it
VITALDECK_OURA_TOKEN=... python -m tools.validate ~/captures/dumpState-*.zip
```
Writes `docs/VALIDATION.md`, comparing the decoded numbers to the official API for the same
night (HRV, resting HR, sleep stages, durations, SpO2, resp; skin temperature is omitted — the
API exposes a deviation, not an absolute). That table — "my clean-room decoder matches the
vendor API" — is the artifact that proves this is genuine reverse engineering, not an API
wrapper.

## If the smoke test fails (zero / garbage records)
- The snoop must have captured the **ring's** traffic: the Oura app has to sync the ring
  **after** snoop logging was turned on, and you must export **promptly** (the buffer rotates).
- On recent Samsung, a plain bug report **won't** contain the log at all — use the SysDump path
  in `docs/SAMSUNG_SNOOP_FINDING.md`.
- Confirm `open_ring` is present (it's a git submodule on the Pi):
  `ls ~/vitaldeck/backend/vendor/open_ring`.
- The capture may carry the log as a compressed **btsnooz** blob — the extractor handles both;
  if it finds neither, snoop logging probably wasn't enabled/active during the capture.
- This is the first real-world test of keyless `replay` on Ring-4 firmware; if it doesn't
  decode cleanly we adapt from what the histogram + errors show.
