// a small dark palette + spacing/radius tokens; everything visual pulls from
// here so the screens stay consistent and easy to retune in one place
export const colors = {
  bg: '#0b0f14',
  surface: '#141b24',
  surfaceAlt: '#1c2733',
  border: '#243140',
  text: '#e8eef5',
  textDim: '#9bb0c4',
  textFaint: '#5e7388',
  accent: '#4dd0e1',
  good: '#5bd99a',
  warn: '#f5c451',
  bad: '#ef6b6b',
  // per-metric tints reused across cards + charts
  hrv: '#7c9cf0',
  rhr: '#ef6b6b',
  temp: '#f5a05b',
  spo2: '#4dd0e1',
  sleep: '#a78bfa',
  band: 'rgba(124,156,240,0.14)',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 18,
  pill: 999,
} as const;

export const font = {
  hero: 56,
  title: 22,
  big: 30,
  body: 15,
  small: 13,
  tiny: 11,
} as const;

// mapping a 0-100 readiness/subscore onto the good/warn/bad ramp
export const scoreColor = (score: number | null | undefined): string => {
  if (score == null || Number.isNaN(score)) return colors.textFaint;
  if (score >= 75) return colors.good;
  if (score >= 50) return colors.warn;
  return colors.bad;
};
