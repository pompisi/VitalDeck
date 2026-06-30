// a phosphor time-series curve (SVG): line + gradient area fill over a time window,
// with dim min/max reference lines and start/end time labels. nulls break the line
// (no fake zeros). used for the overnight HR/HRV curves and the daytime HR graph.
import { format } from 'date-fns';
import React from 'react';
import Svg, {
  Defs,
  Line,
  LinearGradient,
  Path,
  Polyline,
  Stop,
  Text as SvgText,
} from 'react-native-svg';
import { colors, fonts } from '../theme';

export type CurvePoint = { tsMs: number; value: number | null };

const hhmm = (ms: number): string => {
  try {
    return format(new Date(ms), 'h:mm a');
  } catch {
    return '';
  }
};

export default function MetricCurve({
  points,
  width,
  height = 150,
  tint = colors.text,
  startMs,
  endMs,
  gradId = 'mcgrad',
}: {
  points: CurvePoint[];
  width: number;
  height?: number;
  tint?: string;
  startMs?: number | null;
  endMs?: number | null;
  gradId?: string;
}) {
  const valid = points.filter((p) => p.value != null) as { tsMs: number; value: number }[];
  if (valid.length === 0 || width <= 0) return null;

  const padL = 36;
  const padR = 10;
  const padT = 10;
  const axisH = 16;
  const plotW = Math.max(1, width - padL - padR);
  const plotH = Math.max(1, height - padT - axisH);
  const x0 = padL;
  const yTop = padT;
  const yBot = padT + plotH;

  const tMin = startMs ?? Math.min(...valid.map((p) => p.tsMs));
  const tMax = endMs ?? Math.max(...valid.map((p) => p.tsMs));
  const tSpan = Math.max(1, tMax - tMin);
  const vMin = Math.min(...valid.map((p) => p.value));
  const vMax = Math.max(...valid.map((p) => p.value));
  const vPad = (vMax - vMin) * 0.1 || 1;
  const lo = vMin - vPad;
  const hi = vMax + vPad;
  const vSpan = Math.max(1, hi - lo);

  const X = (ms: number) => x0 + ((ms - tMin) / tSpan) * plotW;
  const Y = (v: number) => yBot - ((v - lo) / vSpan) * plotH;

  // split into contiguous non-null runs so gaps render as breaks
  const segs: { tsMs: number; value: number }[][] = [];
  let cur: { tsMs: number; value: number }[] = [];
  for (const p of points) {
    if (p.value == null) {
      if (cur.length) {
        segs.push(cur);
        cur = [];
      }
    } else {
      cur.push({ tsMs: p.tsMs, value: p.value });
    }
  }
  if (cur.length) segs.push(cur);

  return (
    <Svg width={width} height={height}>
      <Defs>
        <LinearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={tint} stopOpacity={0.28} />
          <Stop offset="1" stopColor={tint} stopOpacity={0.02} />
        </LinearGradient>
      </Defs>

      {/* min / max reference lines + labels */}
      <Line x1={x0} y1={Y(vMax)} x2={x0 + plotW} y2={Y(vMax)} stroke={colors.border} strokeWidth={0.5} />
      <Line x1={x0} y1={Y(vMin)} x2={x0 + plotW} y2={Y(vMin)} stroke={colors.border} strokeWidth={0.5} />
      <SvgText x={x0 - 6} y={Y(vMax) + 4} fontSize={9} fontFamily={fonts.mono} fill={colors.textFaint} textAnchor="end">
        {Math.round(vMax)}
      </SvgText>
      <SvgText x={x0 - 6} y={Y(vMin) + 4} fontSize={9} fontFamily={fonts.mono} fill={colors.textFaint} textAnchor="end">
        {Math.round(vMin)}
      </SvgText>

      {segs.map((seg, i) =>
        seg.length >= 2 ? (
          <Path
            key={`a${i}`}
            d={
              `M ${X(seg[0].tsMs)},${yBot} ` +
              seg.map((p) => `L ${X(p.tsMs)},${Y(p.value)} `).join('') +
              `L ${X(seg[seg.length - 1].tsMs)},${yBot} Z`
            }
            fill={`url(#${gradId})`}
          />
        ) : null,
      )}
      {segs.map((seg, i) =>
        seg.length >= 2 ? (
          <Polyline
            key={`l${i}`}
            points={seg.map((p) => `${X(p.tsMs)},${Y(p.value)}`).join(' ')}
            fill="none"
            stroke={tint}
            strokeWidth={2}
          />
        ) : null,
      )}

      <SvgText x={x0} y={height - 3} fontSize={9} fontFamily={fonts.mono} fill={colors.textFaint} textAnchor="start">
        {hhmm(tMin)}
      </SvgText>
      <SvgText x={x0 + plotW} y={height - 3} fontSize={9} fontFamily={fonts.mono} fill={colors.textFaint} textAnchor="end">
        {hhmm(tMax)}
      </SvgText>
    </Svg>
  );
}

// helper: expand a {t0_ms, interval_s, values} block into CurvePoints
export const seriesToPoints = (
  block: { t0_ms: number; interval_s: number; values: (number | null)[] } | null | undefined,
): CurvePoint[] => {
  if (!block || !Array.isArray(block.values)) return [];
  return block.values.map((v, i) => ({ tsMs: block.t0_ms + i * block.interval_s * 1000, value: v }));
};
