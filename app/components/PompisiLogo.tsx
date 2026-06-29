// Pompisi Studio brand mark: a command-prompt wordmark — "> POMPISI STUDIO" in the
// app's terminal font with a blinking block cursor. built in code (not a raster) so
// it scales, tints with the theme, and animates. `typeOn` types the name out
// character-by-character (used on the boot screen); the cursor always blinks.
// left-aligned inside a fixed-width box so the type-on grows rightward without the
// lockup shifting.
import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { colors, fonts, glow } from '../theme';

const WORD = 'POMPISI STUDIO';
const TYPE_MS = 75;

export default function PompisiLogo({
  typeOn = false,
  size = 32,
  tagline,
  onType,
  onComplete,
}: {
  typeOn?: boolean;
  size?: number;
  tagline?: string;
  onType?: () => void; // fired per character revealed (drives the typing blip)
  onComplete?: () => void; // fired once the name is fully typed
}) {
  const [n, setN] = useState(typeOn ? 0 : WORD.length);
  const blink = useSharedValue(1);

  // hold the latest callbacks in refs so the type-on interval below can run once
  // (on `typeOn`) without restarting when the parent re-renders
  const onTypeRef = useRef(onType);
  onTypeRef.current = onType;
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    blink.value = withRepeat(withTiming(0, { duration: 520, easing: Easing.linear }), -1, true);
  }, [blink]);

  useEffect(() => {
    if (!typeOn) return;
    let i = 0;
    const id = setInterval(() => {
      i += 1;
      setN(i);
      onTypeRef.current?.();
      if (i >= WORD.length) {
        clearInterval(id);
        onCompleteRef.current?.();
      }
    }, TYPE_MS);
    return () => clearInterval(id);
  }, [typeOn]);

  const cursorStyle = useAnimatedStyle(() => ({ opacity: blink.value }));
  const boxW = Math.round(size * 9.4);

  return (
    <View style={[styles.box, { width: boxW }]}>
      <View style={styles.line}>
        <Text style={[styles.prompt, { fontSize: size }]} numberOfLines={1}>
          {'> '}
        </Text>
        <Text style={[styles.word, { fontSize: size }]} numberOfLines={1}>
          {WORD.slice(0, n)}
        </Text>
        <Animated.View
          style={[
            styles.cursor,
            { width: Math.round(size * 0.5), height: Math.round(size * 0.78) },
            cursorStyle,
          ]}
        />
      </View>
      {tagline ? <Text style={styles.tag}>{tagline}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { alignItems: 'flex-start' },
  line: { flexDirection: 'row', alignItems: 'center' },
  prompt: { color: colors.textDim, fontFamily: fonts.mono, ...glow(colors.text, 6) },
  word: { color: colors.text, fontFamily: fonts.mono, ...glow(colors.text, 10) },
  cursor: { backgroundColor: colors.text, marginLeft: 3 },
  tag: {
    color: colors.textFaint,
    fontFamily: fonts.mono,
    fontSize: 12,
    letterSpacing: 3,
    marginTop: 6,
  },
});
