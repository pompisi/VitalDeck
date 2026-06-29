# Finding: capturing the Oura BLE snoop log on Samsung (no root)

> Status: **PARKED** for now — the Oura API is the working daily source. This is the
> documented path to produce the `docs/VALIDATION.md` proof artifact (decoder vs. API)
> when we revisit. No rooting required.

## The problem we hit
On a Galaxy S26 Ultra (One UI 7/8, Android 15/16), the standard no-root extraction
(`adb bugreport` → pull `btsnoop_hci.log`) **fails** — Samsung's dumpstate excludes the
Bluetooth snoop log. Confirmed firsthand:

- Full `adb bugreport` (43 MB, 437 files): no `btsnoop` / `btsnooz` (only static BT config XMLs).
- On-device Developer-options "Bug report" (shareable zip): also excludes it.
- `adb shell` reading `/data/log/bt/` and `/data/misc/bluetooth/logs/`: **Permission denied** (root-only).
- Not written to `/sdcard`; `settings get global bluetooth_btsnoop_log_mode` → null.

This differs from stock Android / Pixel, where `adb bugreport` bundles the log. The old
Galaxy-S10 / Android-10 "find it in the bugreport zip at `FS/data/log/bt/btsnoop_hci.log`"
guides no longer apply to recent One UI. (Discovering + documenting this is itself a small
reverse-engineering / platform-behavior finding.)

## The no-root solution: Samsung SysDump
Use **SysDump's dumpstate** — a *separate* collection path that **does** include the snoop log
and copies it to user-readable `/sdcard` — instead of `adb bugreport`:

1. Developer options → **Bluetooth HCI snoop log = Enabled**. Reproduce the BT activity (open
   the Oura app, let it sync the ring).
2. Settings → Security and privacy → **turn OFF Auto Blocker** (on Android 15+ it silently
   blocks the dialer code — the #1 reason `*#9900#` "does nothing").
3. **Stock Phone app → dial `*#9900#`** → the SysDump / debug menu opens.
4. **Run dumpstate/logcat** — do this within ~10 min of the activity (the buffer clears ~15 min).
5. **Copy to SD Card.**
6. Retrieve it (no root): the `dumpState…zip` lands in `/sdcard/log/` and contains
   `FS/data/log/bt/btsnoop_hci.log` (some builds also drop the snoop at `/sdcard/logs/bluetooth/`).
   Pull with `adb pull /sdcard/log/`, or just **My Files → share → Taildrop** to the Pi.
7. Decode + validate on the Pi (our existing tooling handles a dumpState zip the same as a
   bugreport — `extract_btsnoop` globs for the `btsnoop` member):
   ```bash
   python -m tools.ingest_zip ~/captures/dumpState-*.zip
   VITALDECK_OURA_TOKEN=... python -m tools.validate ~/captures/dumpState-*.zip
   ```

If a fresh SysDump copy genuinely contains no btsnoop, root would be the only remaining option
(retail S26 won't allow `adb root`) — but SysDump is the documented no-root method, so try it
before concluding "needs root."

## Sources
- https://calderonpale.com/2025/02/27/how-to-capture-bluetooth-traffic-on-a-samsung-s23/
- https://www.samsung.com/ae/b2b-faqs/samsung-knox/how-do-i-collect-dumpstate-logs-from-samsung-mobile-device/
- https://docs.samsungknox.com/admin/knox-platform-for-enterprise/troubleshoot/get-device-logs/ (One UI 8 + the Auto-Blocker caveat)
- https://medium.com/@charlie.d.anderson/how-to-get-the-bluetooth-host-controller-interface-logs-from-a-modern-android-phone-d23bde00b9fa (the old bugreport method — useful contrast; no longer works on new Samsung)
