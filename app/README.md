# VitalDeck — Expo app

The phone front-end for VitalDeck. Reads the FastAPI backend running on the Pi
and shows a custom readiness score, vitals, trends, sleep, and context tags.

## Stack

- Expo SDK ~54 + expo-router (file-based routes, tab nav)
- TanStack Query for all reads + the `POST /sync` mutation
- react-native-gifted-charts for the trends line chart
- react-native-svg for the readiness ring

## Run it

1. **Point the app at your backend.** The base URL comes from
   `EXPO_PUBLIC_API_URL`. In the field this is the Pi's Tailscale URL; on a dev
   box it falls back to `http://localhost:8000`.

   ```sh
   # macOS / Linux
   export EXPO_PUBLIC_API_URL="http://<pi-tailscale-name>:8000"

   # Windows PowerShell
   $env:EXPO_PUBLIC_API_URL = "http://<pi-tailscale-name>:8000"
   ```

   You can also drop it in an `.env` file at the app root:

   ```
   EXPO_PUBLIC_API_URL=http://<pi-tailscale-name>:8000
   ```

2. **Install deps** (do this once; it's heavy):

   ```sh
   npm install
   ```

3. **Start the dev server:**

   ```sh
   npx expo start
   ```

   Scan the QR with Expo Go (or press `a` / `i` for an emulator, `w` for web).

## Screens

- **Today** (`app/index.tsx`) — readiness ring + component breakdown, vitals
  grid (resting HR / HRV / skin temp / SpO2), last night's sleep, a "data as
  of" stamp, and a **Sync now** button that calls `POST /sync` then refetches.
- **Trends** (`app/trends.tsx`) — metric chips + a line chart with the 14d/30d
  baseline band drawn as reference lines.
- **Sleep** (`app/sleep.tsx`) — the latest session: proportional stage bar +
  deep/REM/light/awake minutes + efficiency/latency.
- **Tags** (`app/tags.tsx`) — list + add a tag; long-press to delete.

## Notes

- Every API call in `lib/api.ts` is wrapped so a sleeping Pi or wrong URL
  surfaces as an in-app error state, not a crash.
- `lib/types.ts` mirrors the JSON shapes in `CONTRACTS.md` §6 — keep them in
  sync if the backend response shapes change.
- In dev (no `ADB_TARGET` set on the backend) `Sync now` generates a synthetic
  day so the whole UI has data to render end-to-end.
