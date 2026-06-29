// root layout: wires the QueryClientProvider once for the whole app and lays
// out the four tabs (Today / Trends / Sleep / Tags) via expo-router Tabs.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Tabs } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { colors } from '../theme';

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

// tiny emoji tab icon so we don't pull in an icon font for v0
const tabIcon = (glyph: string) => () =>
  <Text style={{ fontSize: 18 }}>{glyph}</Text>;

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <StatusBar style="light" />
        <Tabs
          screenOptions={{
            headerStyle: { backgroundColor: colors.bg },
            headerTitleStyle: { color: colors.text },
            headerShadowVisible: false,
            sceneStyle: { backgroundColor: colors.bg },
            tabBarStyle: {
              backgroundColor: colors.surface,
              borderTopColor: colors.border,
            },
            tabBarActiveTintColor: colors.accent,
            tabBarInactiveTintColor: colors.textFaint,
          }}
        >
          <Tabs.Screen
            name="index"
            options={{ title: 'Today', tabBarIcon: tabIcon('☀️') }}
          />
          <Tabs.Screen
            name="trends"
            options={{ title: 'Trends', tabBarIcon: tabIcon('📈') }}
          />
          <Tabs.Screen
            name="sleep"
            options={{ title: 'Sleep', tabBarIcon: tabIcon('🌙') }}
          />
          <Tabs.Screen
            name="tags"
            options={{ title: 'Tags', tabBarIcon: tabIcon('🏷️') }}
          />
        </Tabs>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
