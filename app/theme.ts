// pip-boy CRT palettes. two phosphor variants — green (the classic Fallout look,
// default) and amber — kept as named palettes so the in-app toggle can flip
// between them. every screen pulls its colors from these token NAMES.

const green = {
  bg: '#02110a',          // near-black, green tint (the dead CRT)
  surface: '#06200f',     // panel glass
  surfaceAlt: '#0a2c16',  // raised panel
  border: '#1f7a43',      // dim phosphor rule
  text: '#2bff88',        // phosphor green — the main glow
  textDim: '#1faf5e',     // recessed green
  textFaint: '#15703f',   // ghosted green
  accent: '#7dffb0',      // bright highlight
  good: '#5dffa0',        // high readiness
  warn: '#ffe066',        // amber-yellow (middling)
  bad: '#ff6b5a',         // red (low / strain)
  hrv: '#7dffb0',
  rhr: '#ff8a6a',
  temp: '#ffd16a',
  spo2: '#5de0ff',
  sleep: '#9bff7a',
  band: 'rgba(43,255,136,0.14)',
  scanline: 'rgba(0,0,0,0.32)',
  glow: 'rgba(43,255,136,0.55)',
} as const;

const amber = {
  bg: '#0a0701',
  surface: '#140d02',
  surfaceAlt: '#1d1404',
  border: '#6b5214',
  text: '#ffb642',
  textDim: '#b9852a',
  textFaint: '#7a5c1d',
  accent: '#ffc864',
  good: '#b9e84f',
  warn: '#ffb642',
  bad: '#ff6a3d',
  hrv: '#ffd479',
  rhr: '#ff7a4d',
  temp: '#ffa23c',
  spo2: '#86e0b0',
  sleep: '#d8b24a',
  band: 'rgba(255,182,66,0.14)',
  scanline: 'rgba(0,0,0,0.32)',
  glow: 'rgba(255,182,66,0.55)',
} as const;

export type PaletteName = 'green' | 'amber';
export const palettes: Record<PaletteName, typeof green> = { green, amber };

// the active palette. green by default (classic Fallout); the ThemeProvider
// swaps this for a live toggle in the next pass. screens still read `colors`.
export const colors = green;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

// sharp corners read more "terminal" than rounded; keep radii tight
export const radius = {
  sm: 2,
  md: 4,
  lg: 6,
  pill: 999,
} as const;

// VT323 + Share Tech Mono render small per point, so the scale runs larger
export const font = {
  hero: 84,
  title: 26,
  big: 40,
  body: 17,
  small: 15,
  tiny: 13,
} as const;

export const fonts = {
  display: 'VT323_400Regular',
  mono: 'ShareTechMono_400Regular',
} as const;

// mapping a 0-100 readiness/subscore onto the good/warn/bad ramp
export const scoreColor = (score: number | null | undefined): string => {
  if (score == null || Number.isNaN(score)) return colors.textFaint;
  if (score >= 75) return colors.good;
  if (score >= 50) return colors.warn;
  return colors.bad;
};

// a reusable phosphor text-glow — the cheap, Expo-Go-friendly look
export const glow = (color: string = colors.text, radius = 8) => ({
  textShadowColor: color,
  textShadowOffset: { width: 0, height: 0 },
  textShadowRadius: radius,
});
