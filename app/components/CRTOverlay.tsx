// the CRT illusion in one pointer-transparent layer above the app: hairline
// scanlines + a vignette that darkens the corners. pure svg, fully static — no
// global opacity flicker (that reads as annoying strobing, not phosphor life).
// a slow scan-sweep can be added later for subtle motion if wanted.
import React from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Svg, { Defs, Line, Pattern, RadialGradient, Rect, Stop } from 'react-native-svg';
import { colors } from '../theme';

export default function CRTOverlay() {
  const { width, height } = useWindowDimensions();

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
        <Defs>
          {/* a 1px dark line every 3px — the scanline grid */}
          <Pattern id="scan" width={width} height={3} patternUnits="userSpaceOnUse">
            <Line x1={0} y1={0.5} x2={width} y2={0.5} stroke={colors.scanline} strokeWidth={1} />
          </Pattern>
          {/* the corners fall off into the dead-tube dark */}
          <RadialGradient id="vig" cx="50%" cy="50%" r="75%">
            <Stop offset="55%" stopColor="#000000" stopOpacity={0} />
            <Stop offset="100%" stopColor="#000000" stopOpacity={0.55} />
          </RadialGradient>
        </Defs>
        <Rect x={0} y={0} width={width} height={height} fill="url(#scan)" />
        <Rect x={0} y={0} width={width} height={height} fill="url(#vig)" />
      </Svg>
    </View>
  );
}
