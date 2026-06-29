# VitalDeck — handoff / START HERE

Self-hosted Oura Ring 4 data app. Pulls your data (official Oura API now; a
reverse-engineered BLE snoop-log decoder is the subscription-free path), stores it
in SQLite on a Raspberry Pi, computes a custom explainable readiness score, serves
a FastAPI read API, shown in a Pip-Boy-style React Native / Expo app. Résumé piece:
systems integration + RE-protocol data engineering. SEPARATE from MangaStacked.

## Status — WORKING ✅
Live Oura data flows to the phone app over Tailscale; Pi auto-syncs the API twice
daily; Android APK installed; Pip-Boy green CRT UI (STATUS / TRENDS / SLEEP / LOG);
OTA updates working; 78 backend tests green.

## Where everything lives
- Local repo: `C:\Users\jango\OneDrive\Documents\App\vitaldeck` (git, branch `main`).
- GitHub (public): https://github.com/pompisi/VitalDeck
- On the Pi: `~/vitaldeck` (cloned from GitHub); systemd service `vitaldeck` on :8000.
- Docs: `README.md`, `docs/WALKTHROUGH.md` (interview-defense), `docs/ARCHITECTURE.md`,
  `docs/PHASE0_RUNBOOK.md`, `docs/SAMSUNG_SNOOP_FINDING.md`, `CONTRACTS.md`.

## Infra / access
- Pi: Tailscale `100.113.92.26`, host `raspberrypi`, user `pompisi` (passwordless sudo).
  SSH from any tailnet device: `ssh pompisi@100.113.92.26`. Dev PC `desktop1` =
  100.114.118.90. Phone `dereks-s26-ultra` = 100.82.223.127 (Tailscale must be ON for
  the app to reach the Pi).
- Service: `sudo systemctl {status|restart} vitaldeck`; logs `journalctl -u vitaldeck -f`.
  Auto-starts on boot; uvicorn :8000; auto-syncs the Oura API at 08:00 / 20:00.
- Oura token: `/home/pompisi/vitaldeck-secrets.env` (gitignored, 0600; systemd
  EnvironmentFile). NEVER commit it. Revoke/rotate at cloud.ouraring.com.
- EAS: project `@pompisi/vitaldeck`, logged in as `pompisi`.

## How to ship a change (OTA — the daily workflow, NO rebuild)
App JS/UI changes ship instantly:
```
cd <repo>/app
npx eas-cli@latest update --branch preview --platform android --message "what changed"
```
Then on the phone: close + reopen the app TWICE (downloads in bg, applies on next
cold start). Installed APK is on channel `preview`, runtime `0.1.0`.
- The Pi URL is HARDCODED as the default in `app/lib/api.ts`
  (`http://100.113.92.26:8000`). Do NOT rely on `EXPO_PUBLIC_API_URL` — it does NOT
  inline into `eas update` bundles (that cost us hours). If the Pi IP changes, edit
  that one line.

## When you MUST rebuild the APK (native/manifest changes only)
Only for new native deps, permissions, cleartext, icon — NOT for JS/UI.
```
cd <repo>/app
npx eas-cli@latest build -p android --profile preview --non-interactive --no-wait
```
~15-20 min. Install via the EXACT artifact URL from `eas build:list` — every build is
"v0.1.0 / versionCode 1", indistinguishable by name, easy to install the wrong one.
Native deps (skia, reanimated, gesture-handler, blur, haptics, audio, etc.) are
front-loaded, so most future work is OTA, not a rebuild.

## Git uploads
Public repo, branch `main`, creds via Git Credential Manager (pompisi):
```
git -C <repo> add -A
git -C <repo> commit -m "claude-code: <verb> <what>"
git -C <repo> push origin main
```
LICENSE = MIT (Derek Pompa) + credits open_ring (GPLv3, used via subprocess). README
carries an honest AI-assisted-dev disclosure.

## Gotchas already solved (don't repeat)
1. Standalone APK ignored `EXPO_PUBLIC_API_URL` → defaulted to localhost. Fixed by a
   hardcoded default in `lib/api.ts`.
2. Android release blocks cleartext http → "Network request failed". Fixed via the
   `expo-build-properties` plugin `{android:{usesCleartextTraffic:true}}` in app.json
   (the bare `android.usesCleartextTraffic` key is IGNORED — don't use it).
3. Samsung excludes the BT snoop log from `adb bugreport` and locks it behind root →
   no-root capture needs SysDump `*#9900#` (see `docs/SAMSUNG_SNOOP_FINDING.md`).
4. EAS builds are name-indistinguishable — install by exact artifact URL.

## TODO / planned / discussed
- [ ] **CHARACTER** — the pixel-art figure is scuffed and lost its arms; hand-coded
  pixel grids are limiting. Redo deliberately: clean **vector** figure, a **CC0 game
  sprite** (user picks → integrate as asset), or a **Skia** figure (skia is in the
  build). Use `/plan` + the visualize tool to mock options first. (File: `app/components/StatusFigure.tsx`.)
- [ ] **Sleep stages read 0** on STATUS — backend mapping fix in `ingest/oura_api.py`
  (API gave total/efficiency but not deep/rem/light for the trial nights; verify field
  names / data availability).
- [ ] **Snoop-log VALIDATION artifact** (decoder vs API, the RE centerpiece) — capture
  via SysDump (`docs/SAMSUNG_SNOOP_FINDING.md`) → `python -m tools.ingest_zip <zip>` +
  `python -m tools.validate <zip>` → `docs/VALIDATION.md`. Parked.
- [ ] **In-app SETTINGS** field for the API URL (so the Pi IP isn't hardcoded).
- [ ] **UI/feel polish**: boot sequence on launch, haptics + audio blips (deps already
  in), live green⇄amber theme toggle (both palettes already in `app/theme.ts`), a status
  ticker under the figure.
- [ ] **RetroDeck** (separate future project): Derek's Pi runs a kiosk "RetroDeck" he
  built (with some GPT help) — read its internal git/files on the Pi → upload as its own
  GitHub project; possibly integrate Oura/VitalDeck into it.
- [ ] **Résumé framing**: `docs/WALKTHROUGH.md` is the interview-defense guide; keep
  claims honest (open_ring did the protocol RE; your contribution is the integration /
  pipeline / full-stack / infra + the validation once captured).

## How to resume in a new chat
Open Claude Code pointed at `C:\Users\jango\OneDrive\Documents\App\vitaldeck`. My
cross-session memory (project-vitaldeck) auto-loads; say "read HANDOFF.md" and I'm
caught up. Keep MangaStacked (`...\manga-shelf-app\manga-shelf`) separate.
