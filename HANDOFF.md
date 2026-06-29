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
- [x] **CHARACTER** — DONE 2026-06-29. GPT-generated original waving atomic-age
  technician, baked phosphor-green (luminance-preserving) into
  `app/assets/character.png` (white-on-transparent original kept at
  `app/assets/character_src.png` for a future amber re-bake). Shown on the
  STATUS centerpiece (`app/components/StatusFigure.tsx` — vitals callouts, static).
  The STATUS figure is USER-SELECTABLE (SETTINGS → FIGURE): OPERATIVE (the
  long-curly-hair "you" version) or WIZARD, mapped in `app/lib/characters.ts`
  (default operative). Add a skin = drop a baked PNG + one map entry. Backgrounds
  are removed by flood/mask-BFS keying (the GPT exports bake the checkerboard in as
  opaque gray; white outline/fill is the barrier). `*_src.png` = white-on-transparent
  originals for re-tinting.
  NOTE: the GPT export was actually fully opaque (checkerboard painted in as gray
  pixels); the bake flood-keys that out from the borders before tinting (see the
  re-bake history). The boot/power-on screen now leads with the **Pompisi Studio**
  brand mark (`app/components/PompisiLogo.tsx` — a typed-on `> POMPISI STUDIO`
  command-prompt wordmark in Share Tech Mono) instead of the character, then
  VITALDECK, then the boot log; it WAITS for an `> INITIALIZE` tap (no auto-dismiss).
  The boot plays in two phases with sound: the logo types out (blip per char), then
  VITALDECK + the boot log type out (blip + haptic per line).
- [ ] **Pompisi Studio brand expansion** (eventual) — the in-app mark is
  `app/components/PompisiLogo.tsx` (the typed `> POMPISI STUDIO` wordmark). Make a
  portable ASSET PACK from it: standalone SVG/PNG (light + dark, with/without the
  optional tagline) for GitHub READMEs, app icons, social — and reuse the mark across
  MangaStacked / RetroDeck for one consistent studio identity. Brand notes also saved
  to cross-session memory (pompisi-studio-brand).
- [x] **Sleep stages read 0** on STATUS — FIXED in
  `backend/vitaldeck/ingest/oura_api.py`. Field names were already correct; the
  night-picker now prefers records that actually have staging, and a
  `sleep_phase_5_min` hypnogram fallback (1=deep 2=light 3=rem 4=awake, 5min/char)
  derives deep/rem/light/awake — and finally populates `stages_json` — when the
  explicit `*_duration` fields come back null. Tests added in
  `backend/tests/test_oura_api.py`. DEPLOYED + VERIFIED LIVE 2026-06-29 (Pi pulled,
  restarted, `/sync` re-ingested): current nights show real stages
  (e.g. 06-28 deep86/rem118/light196) and `stages_json` is now populated
  (`has_stages` 0→1). The original "reads 0" was an earlier trial night; the Oura
  API now returns full durations + hypnograms. ⚠️ Still: a night with NEITHER
  durations NOR a hypnogram is unrecoverable via the API.
- [ ] **Snoop-log VALIDATION artifact** (decoder vs API, the RE centerpiece) — capture
  via SysDump (`docs/SAMSUNG_SNOOP_FINDING.md`) → `python -m tools.ingest_zip <zip>` +
  `python -m tools.validate <zip>` → `docs/VALIDATION.md`. Parked.
- [x] **In-app SETTINGS** — DONE. New `SET` tab (`app/app/settings.tsx`) edits,
  TEST-pings (`/health` + latency), and persists the backend URL via
  `app/lib/settings.ts` (AsyncStorage). `app/lib/api.ts` now resolves the base url
  at call time (in-app value > `EXPO_PUBLIC_API_URL` > hardcoded Pi default), so the
  Pi IP is repointable without a rebuild. Also a FIGURE character picker and a BOOT
  SOUND on/off toggle — both persisted and live (pub/sub via `useSyncExternalStore`
  in `app/lib/settings.ts`).
- [~] **UI/feel polish**: boot sequence ✓, haptics ✓ + audio blip ✓
  (`app/assets/blip.wav`, played in BootSequence), status ticker ✓
  (`app/components/Ticker.tsx`, under the STATUS figure). Skin temp shown in °F
  everywhere (`app/lib/units.ts`; storage/scoring stay in C). DEFERRED: the live
  green⇄amber toggle — every screen bakes the palette into `StyleSheet.create` at
  module load, so it needs a dynamic-theming refactor (~8 files). Both palettes are
  already in `app/theme.ts`; do the toggle as its own on-device-verified change.
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
