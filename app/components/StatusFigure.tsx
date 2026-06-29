// an ORIGINAL pip-boy-style operative figure (no bethesda assets). a schematic
// humanoid silhouette whose color tracks readiness (green = recovered, amber =
// fair, red = strained), flanked by limb-indicator callouts for the headline
// vitals. the chest heart node pulses at the actual heart rate and shifts color
// by HR threshold (calm green -> elevated red).
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
import Svg, { Circle, Line, Path } from 'react-native-svg';
import { colors, font, fonts, scoreColor } from '../theme';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const fmt = (v: number | null | undefined, digits = 0): string => {
  if (v == null || Number.isNaN(v)) return '--';
  return digits > 0 ? v.toFixed(digits) : String(Math.round(v));
};

// heart node color by (resting) heart rate — lower is calmer. tweak freely.
const hrColor = (hr: number | null | undefined): string => {
  if (hr == null || Number.isNaN(hr)) return colors.textDim;
  if (hr <= 60) return colors.good; // calm
  if (hr <= 75) return colors.warn; // elevated
  return colors.bad; // high
};

// one on-screen beat per heartbeat, clamped so extremes stay watchable
const heartPeriod = (hr: number | null | undefined): number => {
  const bpm = hr && hr > 30 ? hr : 60;
  return Math.max(600, Math.min(1400, 60000 / bpm));
};

function Callout({
  label,
  value,
  unit,
  digits = 0,
  side,
}: {
  label: string;
  value: number | null | undefined;
  unit: string;
  digits?: number;
  side: 'left' | 'right';
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
  readiness,
  hr,
  hrv,
  temp,
  spo2,
}: {
  readiness: number | null | undefined;
  hr: number | null | undefined;
  hrv: number | null | undefined;
  temp: number | null | undefined;
  spo2: number | null | undefined;
}) {
  const tint = scoreColor(readiness);
  const fill = colors.surfaceAlt;
  const heartFill = hrColor(hr);
  const period = heartPeriod(hr);

  // 0 at rest, spikes to 1 on the beat then eases back — a real-ish cardiac pulse
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

  const heartProps = useAnimatedProps(() => ({
    r: 5 + beat.value * 3,
    opacity: 0.5 + beat.value * 0.5,
  }));

  return (
    <View style={styles.row}>
      <View style={styles.col}>
        <Callout label="HEART" value={hr} unit="BPM" side="left" />
        <Callout label="TEMP" value={temp} unit="°C" digits={1} side="left" />
      </View>

      <Svg width={132} height={230} viewBox="0 0 160 250">
        <Circle cx={80} cy={30} r={20} stroke={tint} strokeWidth={3} fill={fill} />
        <Line x1={80} y1={49} x2={80} y2={66} stroke={tint} strokeWidth={9} strokeLinecap="round" />
        <Path
          d="M52 66 L108 66 L98 152 L62 152 Z"
          stroke={tint}
          strokeWidth={3}
          fill={fill}
          strokeLinejoin="round"
        />
        <Line x1={56} y1={72} x2={36} y2={150} stroke={tint} strokeWidth={11} strokeLinecap="round" />
        <Line x1={104} y1={72} x2={124} y2={150} stroke={tint} strokeWidth={11} strokeLinecap="round" />
        <Line x1={71} y1={150} x2={64} y2={242} stroke={tint} strokeWidth={13} strokeLinecap="round" />
        <Line x1={89} y1={150} x2={96} y2={242} stroke={tint} strokeWidth={13} strokeLinecap="round" />
        {/* the beating heart node — anatomically on the person's left, which
            reads as the RIGHT of center from our front-on view */}
        <AnimatedCircle cx={92} cy={96} animatedProps={heartProps} fill={heartFill} />
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
  col: { flex: 1, justifyContent: 'space-around', height: 200, gap: 28 },
  callout: {},
  alignL: { alignItems: 'flex-start' },
  alignR: { alignItems: 'flex-end' },
  calLabel: { color: colors.textDim, fontFamily: fonts.mono, fontSize: font.tiny, letterSpacing: 1 },
  calValueRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  calValue: { color: colors.text, fontFamily: fonts.display, fontSize: 34, lineHeight: 36 },
  calUnit: { color: colors.textFaint, fontFamily: fonts.mono, fontSize: font.tiny },
  dash: { width: 16, height: 2, backgroundColor: colors.textDim },
});
