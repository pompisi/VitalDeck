// runtime-editable app settings, persisted with AsyncStorage. today this is just
// the API base url (the Pi), so the hardcoded default in api.ts is no longer the
// only way to point the app somewhere else (TODO 4). the value is hydrated once at
// startup into an in-memory cache so the fetch wrapper can read it synchronously.
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY_API_URL = 'vitaldeck.apiUrl';

// the baked-in fallback (the Pi on Tailscale) plus an env override, mirroring the
// old BASE_URL precedence. an in-app value, when set, wins over both of these.
export const DEFAULT_API_URL =
  process.env.EXPO_PUBLIC_API_URL ?? 'http://100.113.92.26:8000';

let currentApiUrl: string = DEFAULT_API_URL;
let loaded = false;

// trim and drop any trailing slashes so callers can always append `/path`
const normalize = (raw: string): string => raw.trim().replace(/\/+$/, '');

// the synchronous read the fetch wrapper uses on every request
export const getApiBaseUrl = (): string => currentApiUrl;

export const isSettingsLoaded = (): boolean => loaded;

// hydrate the cache from storage exactly once at app start. never throws — a
// storage miss/failure just leaves the default in place so launch can't brick.
export async function loadSettings(): Promise<void> {
  try {
    const stored = await AsyncStorage.getItem(KEY_API_URL);
    if (stored && stored.trim()) currentApiUrl = normalize(stored);
  } catch {
    // storage unavailable -> keep the default
  } finally {
    loaded = true;
  }
}

// persist a new base url (empty -> revert to default). returns the value applied.
export async function setApiBaseUrl(url: string): Promise<string> {
  const next = normalize(url) || DEFAULT_API_URL;
  currentApiUrl = next;
  try {
    if (next === DEFAULT_API_URL) {
      await AsyncStorage.removeItem(KEY_API_URL);
    } else {
      await AsyncStorage.setItem(KEY_API_URL, next);
    }
  } catch {
    // best-effort persist; the in-memory value still applies this session
  }
  return next;
}

export async function resetApiBaseUrl(): Promise<string> {
  return setApiBaseUrl(DEFAULT_API_URL);
}
