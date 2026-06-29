// display-unit helpers. the backend stores skin temperature in Celsius (around a
// 36.5C nominal); the owner is American, so every temp READOUT converts to
// Fahrenheit. storage/scoring stay in Celsius — this is presentation only.
export const cToF = (c: number | null | undefined): number | null =>
  c == null || Number.isNaN(c) ? null : (c * 9) / 5 + 32;
