// the power-on sequence shown over everything on cold start. it runs in two phases
// with sound:
//   1. the Pompisi Studio brand mark types itself out, a blip per character.
//   2. when it finishes, VITALDECK fades in and the terminal boot log types out
//      line-by-line (blip + haptic each), a progress bar fills.
// then it WAITS on an "> INITIALIZE" button — it does not auto-dismiss.
// BULLETPROOF: wrapped in an error boundary (see _layout) so a render throw can't
// strand the UI; the log and the button are also started by safety timers in case a
// callback never fires. the character now lives on the STATUS screen.
import { setAudioModeAsync, useAudioPlayer } from 'expo-audio';
import * as Haptics from 'expo-haptics';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { getApiBaseUrl, isSoundEnabled } from '../lib/settings';
import { colors, font, fonts, glow, spacing } from '../theme';
import PompisiLogo from './PompisiLogo';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

const LINE_MS = 230; // per boot-log line
const READY_PAD = 250; // after the last line, before the button appears
const LOG_SAFETY_MS = 3200; // start the log even if the logo's onComplete never fires
const READY_FALLBACK_MS = 9000; // absolute backstop: reveal the button no matter what

export default function BootSequence({ onDone }: { onDone: () => void }) {
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
  const logStarted = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const charOpacity = useSharedValue(0);
  const charScale = useSharedValue(0.82);
  const appOpacity = useSharedValue(0);
  const progress = useSharedValue(0);
  const root = useSharedValue(1);
  const initOpacity = useSharedValue(0);
  const pulse = useSharedValue(0);

  const player = useAudioPlayer(require('../assets/blip.wav'));

  // audio-only blip (used for the per-character typing); honors the sound setting
  // and never throws into the UI
  const blip = useCallback(() => {
    if (!isSoundEnabled()) return;
    try {
      player.seekTo(0);
      player.play();
    } catch {
      // audio is cosmetic
    }
  }, [player]);

  // blip + a light haptic (used for each boot-log line)
  const cue = useCallback(() => {
    blip();
    try {
      Haptics.selectionAsync();
    } catch {
      // haptics unavailable on some devices
    }
  }, [blip]);

  const revealButton = useCallback(() => {
    setReady(true);
    initOpacity.value = withTiming(1, { duration: 400, easing: Easing.out(Easing.quad) });
    pulse.value = withRepeat(
      withTiming(1, { duration: 800, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );
  }, [initOpacity, pulse]);

  // phase 2: reveal VITALDECK + the boot log, then arm the INITIALIZE button
  const startLog = useCallback(() => {
    if (logStarted.current) return;
    logStarted.current = true;
    appOpacity.value = withTiming(1, { duration: 320, easing: Easing.out(Easing.quad) });
    progress.value = withTiming(1, {
      duration: lines.length * LINE_MS + 200,
      easing: Easing.linear,
    });
    lines.forEach((_, i) => {
      timers.current.push(
        setTimeout(() => {
          setVisible(i + 1);
          cue();
        }, i * LINE_MS),
      );
    });
    timers.current.push(setTimeout(revealButton, lines.length * LINE_MS + READY_PAD));
  }, [lines, cue, appOpacity, progress, revealButton]);

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
    blip();
    finish();
  }, [blip, finish]);

  useEffect(() => {
    try {
      setAudioModeAsync({ playsInSilentMode: true });
    } catch {
      // non-fatal
    }
    // phase 1: the logo's entrance; it types itself out (see PompisiLogo onType)
    charOpacity.value = withTiming(1, { duration: 500, easing: Easing.out(Easing.quad) });
    charScale.value = withTiming(1, { duration: 600, easing: Easing.out(Easing.back(1.4)) });

    // safety nets so the UI can never get stuck behind the overlay
    timers.current.push(setTimeout(startLog, LOG_SAFETY_MS));
    timers.current.push(setTimeout(revealButton, READY_FALLBACK_MS));

    return () => timers.current.forEach(clearTimeout);
    // run-once on mount; callbacks are stable for the boot's lifetime
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rootStyle = useAnimatedStyle(() => ({ opacity: root.value }));
  const logoStyle = useAnimatedStyle(() => ({
    opacity: charOpacity.value,
    transform: [{ scale: charScale.value }],
  }));
  const appStyle = useAnimatedStyle(() => ({ opacity: appOpacity.value }));
  const progStyle = useAnimatedStyle(() => ({ width: `${progress.value * 100}%` }));
  const initStyle = useAnimatedStyle(() => ({
    opacity: initOpacity.value,
    transform: [{ scale: 1 + pulse.value * 0.05 }],
  }));

  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.root, rootStyle]}>
      <View style={styles.stack} pointerEvents="none">
        <Animated.View style={[styles.logoWrap, logoStyle]}>
          <PompisiLogo typeOn size={32} onType={blip} onComplete={startLog} />
        </Animated.View>

        <Animated.View style={appStyle}>
          <Text style={styles.title}>VITALDECK</Text>
        </Animated.View>

        <Animated.View style={[styles.console, appStyle]}>
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
        </Animated.View>
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
  logoWrap: { marginBottom: spacing.lg },
  title: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: 56,
    letterSpacing: 4,
    marginTop: spacing.sm,
    textAlign: 'center',
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
