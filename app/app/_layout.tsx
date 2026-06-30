// root layout: loads the CRT fonts, makes the mono face the app-wide default,
// wires the QueryClient, lays out the four tabs with vector icons (no emoji),
// and drops the CRT scanline/vignette/flicker overlay on top of everything.
import { Ionicons } from '@expo/vector-icons';
import { ShareTechMono_400Regular } from '@expo-google-fonts/share-tech-mono';
import { useFonts, VT323_400Regular } from '@expo-google-fonts/vt323';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Tabs } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import BootSequence from '../components/BootSequence';
import CRTOverlay from '../components/CRTOverlay';
import { loadSettings } from '../lib/settings';
import { colors, fonts } from '../theme';

// one client for the session. retry once — the Pi is on Tailscale and a single
// flaky request shouldn't spin forever; staleTime keeps tab-switches snappy.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});

// applying the mono face + amber as the default for every <Text>, so we don't
// have to thread fontFamily through every stylesheet in the app. explicit screen
// styles still win since they merge after this base.
const T = Text as unknown as { defaultProps?: { style?: unknown } };
T.defaultProps = T.defaultProps ?? {};
T.defaultProps.style = [{ fontFamily: fonts.mono, color: colors.text }, T.defaultProps.style];

const tabIcon =
  (name: keyof typeof Ionicons.glyphMap) =>
  ({ color, size }: { color: string; size: number }) =>
    <Ionicons name={name} size={size ?? 22} color={color} />;

// the boot overlay gates the whole UI, so any render-time throw inside it (audio,
// image decode, native hiccup) must NOT brick launch — fall straight through to the
// app instead. onError dismisses the overlay; getDerivedStateFromError renders null.
class BootBoundary extends React.Component<
  { onError: () => void; children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onError();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export default function RootLayout() {
  const [loaded, error] = useFonts({ VT323_400Regular, ShareTechMono_400Regular });

  // hydrate runtime settings (the saved API url) once, before any screen queries
  // fire, so the fetch wrapper resolves the right base url on its first request.
  const [settingsReady, setSettingsReady] = useState(false);
  useEffect(() => {
    loadSettings().finally(() => setSettingsReady(true));
  }, []);

  // the power-on sequence shows over the app on every cold start until it dismisses
  const [booting, setBooting] = useState(true);

  // hold on the dead-tube background until fonts + settings are in — but never
  // brick the app if a font fails to load
  if ((!loaded && !error) || !settingsReady) {
    return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
  }

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <StatusBar style="light" />
        <View style={{ flex: 1, backgroundColor: colors.bg }}>
          <Tabs
            screenOptions={{
              headerShown: false,
              headerStyle: { backgroundColor: colors.bg },
              headerTitleStyle: {
                color: colors.text,
                fontFamily: fonts.display,
                fontSize: 28,
              },
              headerShadowVisible: false,
              sceneStyle: { backgroundColor: colors.bg },
              tabBarStyle: {
                backgroundColor: colors.surface,
                borderTopColor: colors.border,
                borderTopWidth: 1,
              },
              tabBarActiveTintColor: colors.text,
              tabBarInactiveTintColor: colors.textFaint,
              tabBarLabelStyle: { fontFamily: fonts.mono, fontSize: 11, letterSpacing: 1 },
            }}
          >
            <Tabs.Screen
              name="index"
              options={{ title: 'STATUS', tabBarIcon: tabIcon('pulse'), headerShown: false }}
            />
            <Tabs.Screen
              name="trends"
              options={{ title: 'TRENDS', tabBarIcon: tabIcon('stats-chart') }}
            />
            <Tabs.Screen
              name="sleep"
              options={{ title: 'SLEEP', tabBarIcon: tabIcon('moon') }}
            />
            <Tabs.Screen
              name="tags"
              options={{ title: 'LOG', tabBarIcon: tabIcon('pricetags') }}
            />
            <Tabs.Screen
              name="settings"
              options={{ title: 'SET', tabBarIcon: tabIcon('settings') }}
            />
            {/* detail routes — reachable via router.push, hidden from the tab bar */}
            <Tabs.Screen name="readiness" options={{ href: null }} />
            <Tabs.Screen name="day/[date]" options={{ href: null }} />
          </Tabs>
          {/* scanlines sit above the boot overlay too, so the CRT look is unbroken */}
          {booting ? (
            <BootBoundary onError={() => setBooting(false)}>
              <BootSequence onDone={() => setBooting(false)} />
            </BootBoundary>
          ) : null}
          <CRTOverlay />
        </View>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
