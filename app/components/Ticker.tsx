// a continuously scrolling phosphor status ticker (the strip under the STATUS
// figure). renders the content twice end-to-end and translates left by exactly one
// copy's width, looping seamlessly. width is measured at layout so it adapts to
// whatever items it's given.
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { colors, font, fonts, spacing } from '../theme';

const SEP = '     •     ';

export default function Ticker({ items }: { items: string[] }) {
  const [w, setW] = useState(0);
  const x = useSharedValue(0);

  const text = items.join(SEP) + SEP;

  useEffect(() => {
    if (w <= 0) return;
    x.value = 0;
    // ~18ms per px keeps the scroll readable regardless of content length
    x.value = withRepeat(
      withTiming(-w, { duration: Math.max(4000, Math.round(w * 18)), easing: Easing.linear }),
      -1,
      false,
    );
    return () => cancelAnimation(x);
  }, [w, x]);

  const style = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));

  return (
    <View style={styles.wrap}>
      <Animated.View style={[styles.row, style]}>
        <Text
          style={styles.text}
          numberOfLines={1}
          onLayout={(e) => setW(e.nativeEvent.layout.width)}
        >
          {text}
        </Text>
        <Text style={styles.text} numberOfLines={1}>
          {text}
        </Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    height: 24,
    overflow: 'hidden',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    marginTop: spacing.md,
  },
  row: { flexDirection: 'row' },
  text: {
    color: colors.textDim,
    fontFamily: fonts.mono,
    fontSize: font.tiny,
    letterSpacing: 1,
  },
});
