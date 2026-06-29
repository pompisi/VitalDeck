// the live-HR status line under the STATUS figure: a blinking phosphor dot + "LIVE"
// with the reading time and today's HR range when the data is fresh; a steady, dim
// "RESTING · LAST NIGHT" when we're falling back to last night's resting HR.
import { format } from 'date-fns';
import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { colors, font, fonts, glow, spacing } from '../theme';

const fmtTime = (ms: number | null | undefined): string => {
  if (ms == null) return '';
  try {
    return format(new Date(ms), 'h:mm a').toUpperCase();
  } catch {
    return '';
  }
};

export default function LiveBadge({
  fresh,
  tsMs,
  dayMin,
  dayMax,
}: {
  fresh: boolean;
  tsMs: number | null | undefined;
  dayMin?: number | null;
  dayMax?: number | null;
}) {
  const blink = useSharedValue(1);
  useEffect(() => {
    if (fresh) {
      blink.value = withRepeat(
        withTiming(0.2, { duration: 850, easing: Easing.inOut(Easing.quad) }),
        -1,
        true,
      );
    } else {
      blink.value = 1;
    }
  }, [blink, fresh]);
  const dotStyle = useAnimatedStyle(() => ({ opacity: blink.value }));

  const t = fmtTime(tsMs);
  const range =
    fresh && dayMin != null && dayMax != null ? `  ·  ${dayMin}–${dayMax} TODAY` : '';

  return (
    <View style={styles.row}>
      <Animated.View style={[styles.dot, fresh ? styles.dotLive : styles.dotIdle, dotStyle]} />
      <Text style={[styles.txt, fresh && styles.txtLive]}>
        {fresh ? `LIVE${t ? `  ·  ${t}` : ''}${range}` : 'RESTING  ·  LAST NIGHT'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: spacing.sm,
  },
  dot: { width: 9, height: 9, borderRadius: 5 },
  dotLive: { backgroundColor: colors.good },
  dotIdle: { backgroundColor: colors.textFaint },
  txt: { color: colors.textDim, fontFamily: fonts.mono, fontSize: font.tiny, letterSpacing: 2 },
  txtLive: { color: colors.good, ...glow(colors.good, 6) },
});
