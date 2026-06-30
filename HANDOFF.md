# VitalDeck — handoff / START HERE

Self-hosted Oura Ring 4 data app. Pulls your data (official Oura API now; a
reverse-engineered BLE snoop-log decoder is the subscription-free path), stores it
in SQLite on a Raspberry Pi, computes a custom explainable readiness score, serves
a FastAPI read API, shown in a Pip-Boy-style React Native / Expo app. Résumé piece:
systems integration + RE-protocol data engineering. SEPARATE from MangaStacked.

## Status — WORKING ✅
Live Oura data flows to the phone app over Tailscale; Pi auto-syncs the API twice
daily; Android APK installed; Pip-Boy green CRT UI (STATUS / TRENDS / SLEEP / LOG /
SET); OTA updates working; 78 backend tests green.

STATUS shows a **live-ish current heart rate**: `GET /live`
(`oura_api.live_heartrate` → Oura `/heartrate` time series) is the ONLY intraday
metric the Oura cloud exposes; the app polls it every 60s. HRV / SpO2 / temp / sleep
are nightly-only from the cloud — true real-time for those needs the BLE decoder
(parked, see VALIDATION TODO).

## Data-viz wave — "best of Oura, our way" (in progress, 2026-06-29)
Approved plan: `C:\Users\jango\.claude\plans\radiant-percolating-treehouse.md`.
Porting Oura's best visualizations into our CRT style, shipped in OTA drops. Done:
- **Backend** (live on Pi): `/sleep` sessions now carry `series` (overnight HR/HRV
  5-min curves + movement, from `series_json`) + `restless_periods` + `rem_latency_min`;
  new **GET /heartrate/day** (daytime HR curve, `/live`-style passthrough); `/summary`
  `metric` enriched server-side with `explanation` (biggest-drag) + `temp_flag`. New
  cols added via idempotent ALTER in `store.init_db` (CREATE-IF-NOT-EXISTS won't alter
  the Pi's existing db) — also add new cols to `store._SLEEP_COLS`/`_SUMMARY_COLS`.
- **App drop 1:** OVERNIGHT HR/HRV curve (SLEEP, HR/HRV toggle) + DAYTIME HEART RATE
  panel (STATUS), both via `app/components/MetricCurve.tsx` (SVG line+area).
- **App drop 2:** readiness detail screen `app/app/readiness.tsx` (ReadinessRing +
  contributor bars + `ExplainNote` "> WHY?"; tap STATUS "READINESS FACTORS" → it;
  hidden route via `<Tabs.Screen name="readiness" options={{href:null}}/>`). App
  VERSION now shows on boot + SETTINGS from `app/lib/version.ts` — bump `APP_VERSION`
  each drop; `buildTag()` auto-changes per OTA (from `expo-updates` updateId). Do NOT
  bump app.json `version` (it's tied to runtimeVersion → would break OTA delivery).
- **App drop 3 (APP_VERSION 0.4.0):** unified DAY-DETAIL route
  `app/app/day/[date].tsx` (hidden `day/[date]` route; reads `useLocalSearchParams` +
  `getSummary(date)`; `ReadinessRing` + `ContributorBars` + vitals grid + REST tile —
  one lens for any day) + `app/components/MonthCalendar.tsx` (6-week readiness heatmap,
  `scoreColor` dots from `/metrics`, tap → day route). Wired from STATUS (CONDITION
  block), SLEEP ("THAT DAY" panel + a HISTORY calendar). Pure frontend — no backend
  change. Extracted the readiness contributor bars into shared
  `app/components/ContributorBars.tsx` (used by readiness + day-detail). Dynamic
  `/day/{date}` pushes cast `as Href` (typed routes lag new routes — same gotcha).
  Shipped to `main` @ `784c600` + OTA'd (channel `preview`, runtime `0.1.0`, update
  group `a8eba72f`, v0.4.0 / buildTag `019f16c5`). Pure frontend — the Pi was untouched.
  An adversarial review pass gated the ship: calendar empty-day taps now disabled (no
  dead-end 404s), the day-screen 404 state drops RETRY (offers "pick another day"),
  and BACK falls back to `/` when there's no history.
  Follow-up fix (v0.4.1, OTA group `40a1cf1f`, commit `3d74728`): detail-screen BACK
  was snapping to STATUS — bottom-tab navigators default to `backBehavior:'firstRoute'`,
  so "back" always went to the first tab. Set `<Tabs backBehavior="history">` so BACK
  returns to the tab you came from (e.g. SLEEP, still scrolled to the calendar). NOTE
  for future pushed detail screens (sleep-detail, etc.): they're registered as hidden
  tabs, so the tab bar stays visible over them and back relies on this tab history. If
  we ever want true stack semantics (no tab bar on detail, back-to-exact-state), the
  idiomatic move is a root `<Stack>` with a `(tabs)` group — deferred (heavier refactor).

- **App drop 4 (APP_VERSION 0.5.0):** SLEEP-DETAIL upgrade. Backend
  `metrics/sleep.py` — our explainable SLEEP-QUALITY score (duration / efficiency /
  restfulness / timing, mirrors readiness; weights in `config.SLEEP_QUALITY_WEIGHTS`),
  attached per-session in `/sleep` **computed on read** (no schema/migration — the Pi
  only needs `git pull` + restart, no resync). Frontend: a movement lane in
  `Hypnogram` (oura `movement_30_sec`), a generic `components/BarBreakdown.tsx`, and on
  SLEEP a SLEEP QUALITY panel (score ring + REM-latency/restless/bedtime tiles +
  breakdown) + a SLEEP SCORE history strip (tap a night → day route). Adversarial
  review gated it (circular-mean `[0,1440)` fix, restfulness baseline nulled, timing
  note made a tz-agnostic deviation, movement trailing-column clamp). Honesty: the
  shown score is OURS, never oura's sleep score.
  Shipped: backend live on Pi (`git pull` + restart, no resync), frontend OTA group
  `a4d8570a` (v0.5.0 / buildTag `019f16eb`), `main` @ `9d8e5c5`. **Two live-data
  calibrations** caught by curling `/sleep` on the Pi (the code review couldn't see
  data scale): (1) oura `restless_periods` runs ~180-270/night (a count of ~30-sec
  restless epochs), so restfulness is scored as the *fraction of the night restless*
  (`restless/(inbed*2)`, 0.5=worst), not a flat count — the old `_RESTLESS_FULL=35`
  pinned it to 0 every night. (2) Bedtime regularity needs history: timing stays
  neutral ("building your usual-bedtime baseline") until ≥5 nights
  (`_MIN_NIGHTS_FOR_BEDTIME`); the Pi currently has only ~3 nights ingested.
  ⚠️ Observed while verifying: those 3 nights' bedtime_starts read 3:50 AM / 5:02 AM /
  9:51 AM (local) — unusually irregular; the per-day night-picker (`oura_api._night_rank`)
  may be grabbing nap/fragment records, OR the account's schedule really is irregular.
  Duration/efficiency are unaffected (full ~7h records); only timing cares. Worth a
  look when more nights are present (NOT a sleep-quality bug).

### Next in the wave (not yet built)
ACTIVITY tab (`app/app/activity.tsx`, 6th tab: score gauge + concentric rings +
contributor bars + steps/calories + daytime MET curve; needs `/daily_activity` column
mapping + a Pi resync);
vitals (SpO2 range, resp/resting-HR trends); stress/recovery (`/daily_stress`);
tags-on-trends; then the **live green⇄amber toggle** — the theme *foundation* was
deferred to bundle with the ~17-file `makeStyles`/`useMemo` migration (lower risk than
building it unused now). Charting toolkit (ChartPanel/LineChartCRT/BarBreakdown/GaugeArc)
to be extracted as those screens need it.

## Last session — 2026-06-29 (where we left off)
Big push, all shipped to `main` + OTA'd (channel `preview`, runtime `0.1.0`):
- Sleep stages: hypnogram fallback + staged-night picker (deployed + verified live).
- SET tab: editable/persisted backend URL (TEST/SAVE) + character picker + boot-sound toggle.
- Boot/power-on screen: INITIALIZE-gated, two-phase typing WITH sound; leads with the
  Pompisi Studio command-prompt logo; status ticker on STATUS.
- Characters: OPERATIVE + WIZARD (background-removed, baked phosphor-green); picker in SET.
- Temps in °F everywhere; STATUS header = live device clock (AM/PM).
- Live-ish current HR: `GET /live` polled every 60s + LiveBadge (verified ~73bpm live).
- Privacy: Pi URL pulled out of the public repo (gitignored `app/.env` → `app.config.js`
  `extra.apiUrl`; infra in `INFRA.local.md`). `npx tsc --noEmit` now exits 0.

### ⚠️ Known gotcha hit today
`extra.apiUrl` (app.config.js) did NOT reach the installed app over `eas update` — same
failure as `EXPO_PUBLIC_*`. The app fell back to '' → "NO LINK / invalid URL:
/summary/today". Workaround: the URL was entered in the SET tab (persisted, sticks). The
real value lives in `INFRA.local.md` / `app/.env`.

### Next up (pick any when you're back)
1. **Make the default URL ride OTA** so a fresh install auto-connects without typing it:
   bake `VITALDECK_API_URL` into the JS bundle (the bundle DOES propagate over OTA, unlike
   config `extra`), read from the gitignored `app/.env` at build time — still nothing in the repo.
2. **(optional) Scrub git history** — current files are clean, but old commits still contain
   the Pi IP. A history rewrite (force-push) would fully remove it; low urgency (Tailscale-private).
3. **Pompisi Studio asset pack** — standalone SVG/PNG logo for READMEs/icons/social (parked).
4. **Live green⇄amber theme toggle** — deferred; needs the dynamic-theming refactor (palettes
   ready in `theme.ts`, type now widened).
5. **BLE live decoder** — full real-time HRV/SpO2/temp; the parked VALIDATION centerpiece.

Session-end pointers: latest OTA = update group `fee62cca` (live HR), commit `90f6598`.
`main` is 1 commit ahead of that OTA — `7da502c` (tsc cleanup, cosmetic, no OTA needed).

## Where everything lives
- Local repo: `C:\Users\jango\OneDrive\Documents\App\vitaldeck` (git, branch `main`).
- GitHub (public): https://github.com/pompisi/VitalDeck
- On the Pi: `~/vitaldeck` (cloned from GitHub); systemd service `vitaldeck` on :8000.
- Docs: `README.md`, `docs/WALKTHROUGH.md` (interview-defense), `docs/ARCHITECTURE.md`,
  `docs/PHASE0_RUNBOOK.md`, `docs/SAMSUNG_SNOOP_FINDING.md`, `CONTRACTS.md`.

## Infra / access
- The Pi's Tailscale IP, SSH user/host, secrets path, and tailnet device addresses
  are kept OUT of this public repo. They live in `INFRA.local.md` (gitignored) and in
  Claude's cross-session memory. Tailscale must be ON for the app to reach the Pi.
- Service (on the Pi): `sudo systemctl {status|restart} vitaldeck`; logs
  `journalctl -u vitaldeck -f`. uvicorn :8000; auto-syncs the Oura API at 08:00 / 20:00.
- Oura token lives in a gitignored env file on the Pi (systemd EnvironmentFile, 0600).
  NEVER commit it. Revoke/rotate at cloud.ouraring.com.
- EAS: project `@pompisi/vitaldeck`, logged in as `pompisi`.

## How to ship a change (OTA — the daily workflow, NO rebuild)
App JS/UI changes ship instantly:
```
cd <repo>/app
npx eas-cli@latest update --branch preview --platform android --message "what changed"
```
Then on the phone: close + reopen the app TWICE (downloads in bg, applies on next
cold start). Installed APK is on channel `preview`, runtime `0.1.0`.
- The default backend URL is injected at build/OTA time from `app/.env`
  (`VITALDECK_API_URL`, gitignored) via `app/app.config.js` → `extra.apiUrl`, read in
  `app/lib/settings.ts`. It is NOT committed to the repo. Override per-device in the
  in-app SET tab. To repoint the Pi: edit `app/.env`, then `eas update`. (Don't rely
  on `EXPO_PUBLIC_API_URL` for OTA — it doesn't inline into `eas update` bundles.)

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
5. The store's `_row_to_dict` parses + RENAMES every `*_json` column, dropping the
   suffix: `stage_breakdown_json`→`stage_breakdown`, `stages_json`→`stages`,
   `components_json`→`components`, `data_json`→`data`. The API returns the stripped
   keys. STATUS once read `summary.stage_breakdown_json` (undefined → stages showed
   0) — read the stripped key. Same applies to any new `*_json` consumer.

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
