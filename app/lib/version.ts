// app version shown on the boot + settings screens. it lives in the JS bundle (not
// app.json `version`, which is tied to runtimeVersion / native builds — bumping that
// would stop OTA updates reaching the installed app). bump APP_VERSION on each drop;
// buildTag() changes automatically on every `eas update`, so the displayed version
// reflects each change even between manual bumps.
import * as Updates from 'expo-updates';

export const APP_VERSION = '0.3.0';

export function buildTag(): string {
  try {
    if (Updates.isEmbeddedLaunch) return 'base';
    const id = Updates.updateId;
    if (id) return id.replace(/-/g, '').slice(0, 8);
  } catch {
    // expo-updates unavailable (Expo Go / dev) — fall through
  }
  return 'dev';
}

// e.g. "0.3.0 · 019f169b"
export const versionLabel = (): string => `${APP_VERSION} · ${buildTag()}`;
