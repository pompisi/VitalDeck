# VitalDeck — Expo app

The phone front-end for VitalDeck. Reads the FastAPI backend running on the Pi
and shows a custom readiness score, vitals, trends, sleep, and context tags — all
wrapped in a green-phosphor CRT / pip-boy interface. Built by **Pompisi Studio**.

## Stack

- Expo SDK ~54 + expo-router (file-based routes, tab nav)
- TanStack Query for all reads + the `POST /sync` mutation
- react-native-gifted-charts for the trends line chart
- react-native-svg + react-native-reanimated for the animated UI (boot screen,
  status ticker, CRT overlay)
- AsyncStorage for runtime settings; expo-audio + expo-haptics for the boot cues

## Run it

1. **Point the app at your backend.** The base URL is resolved at runtime, in
   this order:

   1. the value saved in the in-app **SET** tab (persisted in AsyncStorage),
   2. `extra.apiUrl` from `app.config.js`, injected from the **gitignored**
      `VITALDECK_API_URL` in `app/.env` (so the real Pi address is never
      committed to the public repo),
   3. `EXPO_PUBLIC_API_URL`,
   4. empty — in which case the SET tab prompts you for one on first launch.

   The simplest setup is to copy the example env file and fill in your backend
   (e.g. the Pi's URL over Tailscale):

   ```sh
   cp .env.example .env
   # then edit app/.env:
   # VITALDECK_API_URL=<your-backend-base-url>
   ```

   You can also point or repoint the app at a different backend **without a
   rebuild** straight from the in-app SET tab (TEST pings `/health`, SAVE
   persists + refetches, RESET reverts to the baked-in default).

2. **Install deps** (do this once; it's heavy):

   ```sh
   npm install
   ```

3. **Start the dev server:**

   ```sh
   npx expo start
   ```

   Scan the QR with Expo Go (or press `a` / `i` for an emulator, `w` for web).

## Boot screen

On every cold start an animated power-on sequence plays over the app: the
"Pompisi Studio" command-prompt logo types itself out character-by-character,
then `VITALDECK` fades in and a terminal boot log types out line-by-line behind a
progress bar. It then waits on an `> INITIALIZE` button (it does not
auto-dismiss). A boot/UI sound plays unless you turn it off in SET.

## Screens

Five tabs: **STATUS**, **TRENDS**, **SLEEP**, **LOG**, **SET**.

- **STATUS** (`app/index.tsx`) — the home screen. A live device clock in the
  header, a **selectable pixel-art figure** (OPERATIVE or WIZARD, chosen in SET)
  with vitals pinned around it, a **live-ish current heart rate** + a **LIVE**
  badge (polled from `GET /live`, the only intraday metric the Oura cloud
  exposes), a scrolling status ticker, an HP-style **CONDITION** bar, a
  **READINESS FACTORS** panel (HRV / resting HR / skin temp / sleep subscores),
  a **LAST REST CYCLE** panel, and a terminal-style **`> SYNC SENSORS`** command
  that calls `POST /sync` then refetches. Skin temperature is shown in
  Fahrenheit (storage/scoring stay Celsius).
- **TRENDS** (`app/trends.tsx`) — metric chips + a phosphor line chart of the
  last 30 days, framed by the 14d/30d personal baselines drawn as reference
  lines.
- **SLEEP** (`app/sleep.tsx`) — the latest session featured up top (total time,
  efficiency/latency, a stacked stage bar + per-stage legend), then prior nights
  as compact rows.
- **LOG** (`app/tags.tsx`) — list + add context tags (late caffeine, gym,
  alcohol…); long-press an entry to delete it.
- **SET** (`app/settings.tsx`) — edit / TEST / SAVE / RESET the backend URL,
  pick the STATUS character, toggle the boot sound, and a read-only system panel
  (app version, default URL, theme).

## Notes

- Every API call in `lib/api.ts` is wrapped so a sleeping Pi or wrong URL
  surfaces as an in-app error state, not a crash.
- `lib/types.ts` mirrors the JSON shapes in `CONTRACTS.md` §6 — keep them in
  sync if the backend response shapes change.
- The backend picks its sync mode by what's configured (`backend/.../api/main.py`):
  an Oura cloud token → `mode: "oura"` (the active real-data path), else an
  `ADB_TARGET` → `mode: "live"` (the reverse-engineered BLE/snoop path), else
  → `mode: "synthetic"`. In dev (none configured) `SYNC SENSORS` generates a
  synthetic day so the whole UI has data to render end-to-end.
