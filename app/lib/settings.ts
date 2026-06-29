// runtime-editable app settings, persisted with AsyncStorage, with a tiny pub/sub
// so React views update live when a setting changes. covers: the API base url (the
// Pi), the chosen STATUS character, and whether boot/UI sound plays. values are
// hydrated once at startup into in-memory caches so reads are synchronous.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';
import type { CharacterKey } from './characters';

const KEY_API_URL = 'vitaldeck.apiUrl';
const KEY_CHARACTER = 'vitaldeck.character';
const KEY_SOUND = 'vitaldeck.sound';

// in-app value > EXPO_PUBLIC_API_URL > the Pi's Tailscale url baked in as default
export const DEFAULT_API_URL =
  process.env.EXPO_PUBLIC_API_URL ?? 'http://100.113.92.26:8000';

const DEFAULT_CHARACTER: CharacterKey = 'operative';
const KNOWN_CHARACTERS: readonly string[] = ['operative', 'wizard'];

let currentApiUrl: string = DEFAULT_API_URL;
let currentCharacter: CharacterKey = DEFAULT_CHARACTER;
let soundEnabled = true;
let loaded = false;

// --- pub/sub: lets useSyncExternalStore re-render subscribers on change ---
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

// trim and drop any trailing slashes so callers can always append `/path`
const normalize = (raw: string): string => raw.trim().replace(/\/+$/, '');

export const getApiBaseUrl = (): string => currentApiUrl;
export const getCharacter = (): CharacterKey => currentCharacter;
export const isSoundEnabled = (): boolean => soundEnabled;
export const isSettingsLoaded = (): boolean => loaded;

export const useCharacter = (): CharacterKey => useSyncExternalStore(subscribe, getCharacter);
export const useSoundEnabled = (): boolean => useSyncExternalStore(subscribe, isSoundEnabled);

// hydrate every setting from storage once at app start. never throws — a miss/failure
// just leaves defaults so launch can't brick.
export async function loadSettings(): Promise<void> {
  try {
    const [url, ch, snd] = await Promise.all([
      AsyncStorage.getItem(KEY_API_URL),
      AsyncStorage.getItem(KEY_CHARACTER),
      AsyncStorage.getItem(KEY_SOUND),
    ]);
    if (url && url.trim()) currentApiUrl = normalize(url);
    if (ch && KNOWN_CHARACTERS.includes(ch)) currentCharacter = ch as CharacterKey;
    if (snd === '0') soundEnabled = false;
  } catch {
    // storage unavailable -> keep defaults
  } finally {
    loaded = true;
    emit();
  }
}

// persist a new base url (empty -> revert to default). returns the value applied.
export async function setApiBaseUrl(url: string): Promise<string> {
  const next = normalize(url) || DEFAULT_API_URL;
  currentApiUrl = next;
  emit();
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

export async function setCharacter(key: CharacterKey): Promise<void> {
  currentCharacter = key;
  emit();
  try {
    await AsyncStorage.setItem(KEY_CHARACTER, key);
  } catch {
    // in-memory value still applies this session
  }
}

export async function setSoundEnabled(on: boolean): Promise<void> {
  soundEnabled = on;
  emit();
  try {
    await AsyncStorage.setItem(KEY_SOUND, on ? '1' : '0');
  } catch {
    // in-memory value still applies this session
  }
}
