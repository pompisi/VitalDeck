// an ORIGINAL pixel-art operative sprite (no Bethesda assets) — a grid of squares
// forming a humanoid, tinted by readiness (green=recovered, amber=fair, red=
// strained). flanked by limb-indicator callouts for the headline vitals. the
// chest heart pixel pulses at the actual heart rate and shifts color by HR.
import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedProps,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { G, Rect } from 'react-native-svg';
import { colors, font, fonts, scoreColor } from '../theme';

const AnimatedG = Animated.createAnimatedComponent(G);
const CELL = 9;

// the sprite. '@' = head, '#' = body/limbs, ' '/'.' = empty. 13 cols x 16 rows.
const SPRITE = [
  '....@@@@@....',
  '...@@@@@@@...',
  '...@@@@@@@...',
  '....@@@@@....',
  '......#......',
  '..#########..',
  '#.#########.#',
  '#.#########.#',
  '#.#########.#',
  '..#########..',
  '...#######...',
  '...##...##...',
  '...##...##...',
  '...##...##...',
  '...##...##...',
  '..###...###..',
];
const COLS = 13;
const ROWS = SPRITE.length;

// heart pixels (a small plus) at the chest — placed viewer-right of center, i.e.
// the person's left, where a real heart sits.
const HEART_CELLS: [number, number][] = [[8, 6], [7, 7], [8, 7], [9, 7], [8, 8]];

const fmt = (v: number | null | undefined, digits = 0): string => {
  if (v == null || Number.isNaN(v)) return '--';
  return digits > 0 ? v.toFixed(digits) : String(Math.round(v));
};

const hrColor = (hr: number | null | undefined): string => {
  if (hr == null || Number.isNaN(hr)) return colors.textDim;
  if (hr <= 60) return colors.good;
  if (hr <= 75) return colors.warn;
  return colors.bad;
};

const heartPeriod = (hr: number | null | undefined): number => {
  const bpm = hr && hr > 30 ? hr : 60;
  return Math.max(600, Math.min(1400, 60000 / bpm));
};

function Callout({
  label, value, unit, digits = 0, side,
}: {
  label: string; value: number | null | undefined; unit: string; digits?: number; side: 'left' | 'right';
}) {
  const dash = <View style={styles.dash} />;
  return (
    <View style={[styles.callout, side === 'left' ? styles.alignR : styles.alignL]}>
      <Text style={styles.calLabel}>{label}</Text>
      <View style={styles.calValueRow}>
        {side === 'right' ? dash : null}
        <Text style={styles.calValue}>{fmt(value, digits)}</Text>
        {side === 'left' ? dash : null}
      </View>
      <Text style={styles.calUnit}>{unit}</Text>
    </View>
  );
}

export default function StatusFigure({
  readiness, hr, hrv, temp, spo2,
}: {
  readiness: number | null | undefined;
  hr: number | null | undefined;
  hrv: number | null | undefined;
  temp: number | null | undefined;
  spo2: number | null | undefined;
}) {
  const tint = scoreColor(readiness);
  const heartFill = hrColor(hr);
  const period = heartPeriod(hr);

  const beat = useSharedValue(0);
  useEffect(() => {
    beat.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 130, easing: Easing.out(Easing.quad) }),
        withTiming(0, { duration: Math.max(period - 130, 220), easing: Easing.in(Easing.quad) }),
      ),
      -1,
      false,
    );
  }, [beat, period]);
  const heartProps = useAnimatedProps(() => ({ opacity: 0.5 + beat.value * 0.5 }));

  // build the body pixels from the sprite grid
  const pixels: React.ReactNode[] = [];
  for (let r = 0; r < ROWS; r++) {
    const row = SPRITE[r];
    for (let c = 0; c < COLS; c++) {
      const ch = row[c];
      if (ch !== '@' && ch !== '#') continue;
      pixels.push(
        <Rect
          key={`${r}-${c}`}
          x={c * CELL}
          y={r * CELL}
          width={CELL - 1}
          height={CELL - 1}
          fill={tint}
          fillOpacity={ch === '@' ? 1 : 0.85}
        />,
      );
    }
  }

  return (
    <View style={styles.row}>
      <View style={styles.col}>
        <Callout label="HEART" value={hr} unit="BPM" side="left" />
        <Callout label="TEMP" value={temp} unit="°C" digits={1} side="left" />
      </View>

      <Svg width={118} height={145} viewBox={`0 0 ${COLS * CELL} ${ROWS * CELL}`}>
        {pixels}
        <AnimatedG animatedProps={heartProps}>
          {HEART_CELLS.map(([c, r]) => (
            <Rect
              key={`h-${r}-${c}`}
              x={c * CELL}
              y={r * CELL}
              width={CELL - 1}
              height={CELL - 1}
              fill={heartFill}
            />
          ))}
        </AnimatedG>
      </Svg>

      <View style={styles.col}>
        <Callout label="HRV" value={hrv} unit="MS" side="right" />
        <Callout label="SpO2" value={spo2} unit="%" side="right" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  col: { flex: 1, justifyContent: 'space-around', height: 190, gap: 28 },
  callout: {},
  alignL: { alignItems: 'flex-start' },
  alignR: { alignItems: 'flex-end' },
  calLabel: { color: colors.textDim, fontFamily: fonts.mono, fontSize: font.tiny, letterSpacing: 1 },
  calValueRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  calValue: { color: colors.text, fontFamily: fonts.display, fontSize: 34, lineHeight: 36 },
  calUnit: { color: colors.textFaint, fontFamily: fonts.mono, fontSize: font.tiny },
  dash: { width: 16, height: 2, backgroundColor: colors.textDim },
});
