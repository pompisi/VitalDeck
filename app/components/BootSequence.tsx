// the power-on sequence shown over everything on cold start: the operative figure
// fades/scales in, a terminal boot log types out line-by-line with a haptic +
// audio blip each, and a progress bar fills. it then WAITS on an "> INITIALIZE"
// button — it does not auto-dismiss — so the user enters STATUS deliberately.
// it stays BULLETPROOF: wrapped in an error boundary (see _layout) so a render
// throw can't strand the UI, and the button is revealed by a timer that fires
// even if a line-reveal hiccups.
// character.png is a phosphor-green PNG, baked luminance-preserving from the
// white-on-transparent original kept at assets/character_src.png (so internal
// linework survives — a flat tintColor would flatten it to a green blob). to retheme
// (e.g. amber for the future toggle), re-bake from character_src.png.
import { setAudioModeAsync, useAudioPlayer } from 'expo-audio';
import * as Haptics from 'expo-haptics';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { getApiBaseUrl } from '../lib/settings';
import { colors, font, fonts, glow, spacing } from '../theme';

const AnimatedImage = Animated.createAnimatedComponent(Image);
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

const LINE_MS = 230; // per boot-log line
const START_MS = 350; // delay before the first line
const READY_PAD = 250; // after the last line, before the button appears
const READY_FALLBACK_MS = 8000; // belt-and-suspenders: reveal the button regardless

export default function BootSequence({ onDone }: { onDone: () => void }) {
  // boot log; the LINK line shows whatever the Pi url is currently set to
  const lines = useMemo(() => {
    let host = '---';
    try {
      host = getApiBaseUrl().replace(/^https?:\/\//, '');
    } catch {
      // keep the placeholder host
    }
    return [
      'VITALDECK OS  v0.1.0',
      'PHOSPHOR BIOS // (C) D.POMPA',
      'INITIALIZING SENSOR ARRAY......... OK',
      'MOUNTING DATA STORE............... OK',
      `LINK > ${host}`,
      'CALIBRATING BIOMETRICS............ OK',
      'SYSTEM READY',
    ];
  }, []);

  const [visible, setVisible] = useState(0);
  const [ready, setReady] = useState(false);
  const doneRef = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const charOpacity = useSharedValue(0);
  const charScale = useSharedValue(0.82);
  const progress = useSharedValue(0);
  const root = useSharedValue(1);
  const initOpacity = useSharedValue(0);
  const pulse = useSharedValue(0);

  // a short blip; if audio fails to load/play it must not affect the sequence
  const player = useAudioPlayer(require('../assets/blip.wav'));

  const cue = useCallback(() => {
    try {
      player.seekTo(0);
      player.play();
    } catch {
      // audio is cosmetic — ignore any failure
    }
    try {
      Haptics.selectionAsync();
    } catch {
      // haptics unavailable on some devices — ignore
    }
  }, [player]);

  const revealButton = useCallback(() => {
    setReady(true);
    initOpacity.value = withTiming(1, { duration: 400, easing: Easing.out(Easing.quad) });
    pulse.value = withRepeat(withTiming(1, { duration: 800, easing: Easing.inOut(Easing.quad) }), -1, true);
  }, [initOpacity, pulse]);

  const finish = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    timers.current.forEach(clearTimeout);
    root.value = withTiming(0, { duration: 320, easing: Easing.in(Easing.quad) });
    setTimeout(onDone, 340);
  }, [onDone, root]);

  const onInit = useCallback(() => {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch {
      // ignore
    }
    cue();
    finish();
  }, [cue, finish]);

  useEffect(() => {
    try {
      // let the blip sound even with the ringer switch silenced
      setAudioModeAsync({ playsInSilentMode: true });
    } catch {
      // non-fatal
    }

    charOpacity.value = withTiming(1, { duration: 550, easing: Easing.out(Easing.quad) });
    charScale.value = withTiming(1, { duration: 650, easing: Easing.out(Easing.back(1.4)) });
    progress.value = withTiming(1, {
      duration: lines.length * LINE_MS + 200,
      easing: Easing.linear,
    });

    lines.forEach((_, i) => {
      timers.current.push(
        setTimeout(() => {
          setVisible(i + 1);
          cue();
        }, START_MS + i * LINE_MS),
      );
    });

    // reveal the INITIALIZE button after the log finishes (and a fallback so it
    // always appears even if a line-reveal hiccups). NO auto-dismiss — the user
    // taps to enter.
    timers.current.push(setTimeout(revealButton, START_MS + lines.length * LINE_MS + READY_PAD));
    timers.current.push(setTimeout(revealButton, READY_FALLBACK_MS));

    return () => timers.current.forEach(clearTimeout);
    // run-once on mount; callbacks are stable for the boot's lifetime
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rootStyle = useAnimatedStyle(() => ({ opacity: root.value }));
  const charStyle = useAnimatedStyle(() => ({
    opacity: charOpacity.value,
    transform: [{ scale: charScale.value }],
  }));
  const progStyle = useAnimatedStyle(() => ({ width: `${progress.value * 100}%` }));
  const initStyle = useAnimatedStyle(() => ({
    opacity: initOpacity.value,
    transform: [{ scale: 1 + pulse.value * 0.05 }],
  }));

  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.root, rootStyle]}>
      <View style={styles.stack} pointerEvents="none">
        <AnimatedImage
          source={require('../assets/character.png')}
          resizeMode="contain"
          style={[styles.char, charStyle]}
        />
        <Text style={styles.title}>VITALDECK</Text>

        <View style={styles.console}>
          {lines.slice(0, visible).map((ln, i) => (
            <Text
              key={i}
              style={[styles.line, i === lines.length - 1 && styles.lineReady]}
              numberOfLines={1}
            >
              {`> ${ln}`}
            </Text>
          ))}
          <View style={styles.progressTrack}>
            <Animated.View style={[styles.progressFill, progStyle]} />
          </View>
        </View>
      </View>

      {ready ? (
        <AnimatedPressable style={[styles.initBtn, initStyle]} onPress={onInit}>
          <Text style={styles.initText}>{'> INITIALIZE'}</Text>
        </AnimatedPressable>
      ) : (
        <Text style={styles.loading} pointerEvents="none">
          BOOTING…
        </Text>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
    elevation: 100,
  },
  stack: { alignItems: 'center', width: '100%', paddingHorizontal: spacing.xl },
  char: { width: 240, height: 240 },
  title: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: 56,
    letterSpacing: 4,
    marginTop: spacing.sm,
    ...glow(colors.text, 16),
  },
  console: { width: '82%', marginTop: spacing.xl, minHeight: 150 },
  line: {
    color: colors.textDim,
    fontFamily: fonts.mono,
    fontSize: font.tiny,
    letterSpacing: 1,
    marginVertical: 1,
  },
  lineReady: { color: colors.text, ...glow(colors.text, 8) },
  progressTrack: {
    height: 8,
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: spacing.md,
    padding: 1,
  },
  progressFill: { height: '100%', backgroundColor: colors.text },
  initBtn: {
    position: 'absolute',
    bottom: 64,
    borderWidth: 1,
    borderColor: colors.text,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    backgroundColor: colors.surface,
    ...glow(colors.text, 12),
  },
  initText: {
    color: colors.text,
    fontFamily: fonts.mono,
    fontSize: font.body,
    letterSpacing: 2,
    ...glow(colors.text, 8),
  },
  loading: {
    position: 'absolute',
    bottom: 72,
    color: colors.textFaint,
    fontFamily: fonts.mono,
    fontSize: font.tiny,
    letterSpacing: 2,
  },
});
