# Phase 0 — capture real ring data via the snoop log (no adb)

## When you'd do this
Daily data comes automatically from the **Oura API** — the Pi auto-syncs twice a day, you just
open the app. This snoop-log capture is the **occasional, subscription-free path** plus the
**one-time proof** that the reverse-engineered decoder actually works. It is **not** a daily
ritual, and it needs **no adb, no second phone, no Auto Blocker change, no root.**

## 1. Turn on snoop logging (one-time, on your phone)
- Settings → About phone → Software information → tap **Build number** 7× (enables Developer
  options).
- Developer options → **Bluetooth HCI snoop log** → set to **Enabled** (the full log, not
  "Filtered"). This is just a toggle — *not* adb, so Auto Blocker doesn't gate it.
- Toggle **Bluetooth off then on** so logging starts.

## 2. Capture a night
- Wear the ring. Open the **Oura app** and let it sync the ring — that's what puts the ring's
  BLE traffic into the snoop log.

## 3. Export the log (no adb)
- Developer options → **Bug report** → **Interactive report** → wait → tap the notification to
  **Share**.
- Share the zip to the Pi via **Tailscale**: in the Tailscale app, **Send file → raspberrypi**.
  (Fallbacks: Google Drive, or USB to a PC then `scp`.)
- On the Pi, receive it:
  ```bash
  mkdir -p ~/captures && tailscale file get ~/captures/
  ```

## 4. Decode + ingest (on the Pi)
```bash
cd ~/vitaldeck/backend && source .venv/bin/activate
python -m tools.ingest_zip ~/captures/bugreport-*.zip
```
This prints a **record-type histogram** — the smoke test: did `open_ring replay` decode the
ring's BLE? — then ingests + recomputes. Reload the app to see the snoop-sourced day.

## 5. Validate against the API (the proof artifact)
```bash
VITALDECK_OURA_TOKEN=$(grep -oP 'VITALDECK_OURA_TOKEN=\K.*' ~/vitaldeck-secrets.env) \
  python -m tools.validate ~/captures/bugreport-*.zip
```
Writes `docs/VALIDATION.md`, comparing the decoded numbers to the official API for the same
night (HRV, resting HR, sleep stages, durations, SpO2, resp). That table — "my clean-room
decoder matches the vendor API" — is the artifact that proves this is genuine reverse
engineering, not an API wrapper.

## If the smoke test fails (zero / garbage records)
- The snoop must have captured the **ring's** traffic: the Oura app has to sync the ring
  **after** snoop logging was turned on.
- Confirm `open_ring` is vendored: `ls ~/vitaldeck/backend/vendor/open_ring`.
- The capture may carry the log as a compressed **btsnooz** blob — the extractor handles both;
  if it finds neither, snoop logging probably wasn't enabled/active during the bug report.
- This is the first real-world test of keyless `replay` on Ring-4 firmware; if it doesn't
  decode cleanly we adapt from what the histogram + errors show.
