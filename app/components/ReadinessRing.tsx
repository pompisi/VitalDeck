// the readiness "ring" — an svg progress arc with the 0-100 score in the
// middle, colored on the good/warn/bad ramp. drawing it with react-native-svg
// keeps it crisp at any size.
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { colors, font, scoreColor } from '../theme';

interface Props {
  score: number | null | undefined;
  size?: number;
  strokeWidth?: number;
  // a short caption under the number, e.g. "Readiness"
  caption?: string;
}

export default function ReadinessRing({
  score,
  size = 200,
  strokeWidth = 16,
  caption = 'Readiness',
}: Props) {
  const has = score != null && !Number.isNaN(score as number);
  // clamping to the drawable 0-100 range so a stray value can't overshoot the arc
  const pct = has ? Math.max(0, Math.min(100, score as number)) : 0;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - pct / 100);
  const color = scoreColor(has ? pct : null);

  return (
    <View style={[styles.wrap, { width: size, height: size }]}>
      <Svg width={size} height={size}>
        {/* the dim track behind the progress arc */}
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={colors.surfaceAlt}
          strokeWidth={strokeWidth}
          fill="none"
        />
        {/* the score arc, rotated -90deg so it fills from the top */}
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={dashOffset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <View style={styles.center} pointerEvents="none">
        <Text style={[styles.score, { color }]}>
          {has ? Math.round(pct) : '—'}
        </Text>
        <Text style={styles.caption}>{caption}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  score: {
    fontSize: font.hero,
    fontWeight: '900',
    lineHeight: font.hero + 4,
  },
  caption: {
    color: colors.textDim,
    fontSize: font.small,
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginTop: 2,
  },
});
