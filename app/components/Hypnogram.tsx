// the sleep-stage timeline (hypnogram), Oura-style: four rows (AWAKE / REM / LIGHT
// / DEEP top→bottom), each segment drawn as a colored block whose width is its
// share of the night. data is the session's `stages` array ({stage, duration_s},
// run-length, ~5-min resolution from the cloud hypnogram). when a `movement` string
// (oura's 30-sec movement_30_sec) is passed, a fifth MOVE lane is drawn beneath,
// a mini-seismograph of how much you stirred. renders nothing when there's no
// timeline — the caller shows the stacked bar fallback instead.
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
// oura movement_30_sec levels (1 calm … 4 active) → relative lane height
const MOVE_LEVEL: Record<string, number> = { '1': 0.2, '2': 0.45, '3': 0.72, '4': 1 };

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
  movement,
}: {
  stages: SleepStage[] | null | undefined;
  width: number;
  startMs?: number | null;
  endMs?: number | null;
  movement?: string | null;
}) {
  const segs = (stages ?? []).filter(
    (s) => s && typeof s.duration_s === 'number' && s.duration_s > 0 && s.stage in ROW,
  );
  const total = segs.reduce((a, s) => a + s.duration_s, 0);
  if (segs.length === 0 || total <= 0 || width <= 0) return null;

  const moveStr = typeof movement === 'string' ? movement : '';
  const hasMove = /[1-4]/.test(moveStr);

  const axisH = 18;
  const labelW = 46;
  const rowH = 34;
  const rows = hasMove ? 5 : 4;
  const H = rows * rowH + axisH;
  const plotW = Math.max(1, width - labelW - 4);
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

  const labels = hasMove ? [...ROW_ORDER, 'MOVE'] : ROW_ORDER;
  const rowLabels = labels.map((lbl, r) => (
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

  // movement lane: aggregate the 30-sec string into ≤180 columns (max level per
  // bucket so a brief jolt isn't averaged away), mapped across the same time width.
  const moveRects = [];
  if (hasMove) {
    const len = moveStr.length;
    const maxCols = Math.min(len, 180);
    const stride = Math.max(1, Math.ceil(len / maxCols));
    const laneTop = 4 * rowH + 3;
    const laneH = rowH - 6;
    const colW = Math.max(1, (stride / len) * plotW);
    for (let i = 0; i < len; i += stride) {
      let lvl = 0;
      for (let j = i; j < Math.min(i + stride, len); j++) {
        lvl = Math.max(lvl, MOVE_LEVEL[moveStr[j]] ?? 0);
      }
      if (lvl <= 0) continue;
      const x = x0 + (i / len) * plotW;
      const h = Math.max(1, laneH * lvl);
      moveRects.push(
        <Rect
          key={`m${i}`}
          x={x}
          y={laneTop + (laneH - h)}
          // clamp the trailing partial bucket so it never overruns the plot's right edge
          width={Math.min(colW, x0 + plotW - x)}
          height={h}
          fill={colors.rhr}
          opacity={0.35 + 0.5 * lvl}
          rx={0.5}
        />,
      );
    }
  }

  return (
    <Svg width={width} height={H}>
      {grid}
      {blocks}
      {moveRects}
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
