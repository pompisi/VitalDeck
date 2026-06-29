// the sleep-stage timeline (hypnogram), Oura-style: four rows (AWAKE / REM / LIGHT
// / DEEP top→bottom), each segment drawn as a colored block whose width is its
// share of the night. data is the session's `stages` array ({stage, duration_s},
// run-length, ~5-min resolution from the cloud hypnogram). renders nothing when
// there's no timeline — the caller shows the stacked bar fallback instead.
import { format } from 'date-fns';
import React from 'react';
import Svg, { Line, Rect, Text as SvgText } from 'react-native-svg';
import { colors, fonts } from '../theme';
import type { SleepStage } from '../lib/types';

const ROW: Record<string, number> = { awake: 0, rem: 1, light: 2, deep: 3 };
const ROW_ORDER = ['AWAKE', 'REM', 'LIGHT', 'DEEP'];
const STAGE_COLOR: Record<string, string> = {
  deep: colors.sleep,
  rem: colors.hrv,
  light: colors.spo2,
  awake: colors.textFaint,
};

const hhmm = (ms: number | null | undefined): string => {
  if (ms == null) return '';
  try {
    return format(new Date(ms), 'h:mm a');
  } catch {
    return '';
  }
};

export default function Hypnogram({
  stages,
  width,
  startMs,
  endMs,
}: {
  stages: SleepStage[] | null | undefined;
  width: number;
  startMs?: number | null;
  endMs?: number | null;
}) {
  const segs = (stages ?? []).filter(
    (s) => s && typeof s.duration_s === 'number' && s.duration_s > 0 && s.stage in ROW,
  );
  const total = segs.reduce((a, s) => a + s.duration_s, 0);
  if (segs.length === 0 || total <= 0 || width <= 0) return null;

  const H = 156;
  const axisH = 18;
  const labelW = 46;
  const plotW = Math.max(1, width - labelW - 4);
  const rows = 4;
  const rowH = (H - axisH) / rows;
  const x0 = labelW;

  const grid = [];
  for (let r = 0; r <= rows; r++) {
    grid.push(
      <Line
        key={`g${r}`}
        x1={x0}
        y1={r * rowH}
        x2={x0 + plotW}
        y2={r * rowH}
        stroke={colors.border}
        strokeWidth={0.5}
      />,
    );
  }

  const rowLabels = ROW_ORDER.map((lbl, r) => (
    <SvgText
      key={lbl}
      x={labelW - 8}
      y={r * rowH + rowH / 2 + 4}
      fontSize={9}
      fontFamily={fonts.mono}
      fill={colors.textFaint}
      textAnchor="end"
    >
      {lbl}
    </SvgText>
  ));

  let cum = 0;
  const blocks = segs.map((s, i) => {
    const x = x0 + (cum / total) * plotW;
    const w = Math.max(1, (s.duration_s / total) * plotW);
    cum += s.duration_s;
    const row = ROW[s.stage];
    return (
      <Rect
        key={i}
        x={x}
        y={row * rowH + 2}
        width={w}
        height={rowH - 4}
        fill={STAGE_COLOR[s.stage] ?? colors.textFaint}
        rx={1}
      />
    );
  });

  return (
    <Svg width={width} height={H}>
      {grid}
      {blocks}
      {rowLabels}
      {startMs ? (
        <SvgText x={x0} y={H - 4} fontSize={9} fontFamily={fonts.mono} fill={colors.textFaint} textAnchor="start">
          {hhmm(startMs)}
        </SvgText>
      ) : null}
      {endMs ? (
        <SvgText x={x0 + plotW} y={H - 4} fontSize={9} fontFamily={fonts.mono} fill={colors.textFaint} textAnchor="end">
          {hhmm(endMs)}
        </SvgText>
      ) : null}
    </Svg>
  );
}
