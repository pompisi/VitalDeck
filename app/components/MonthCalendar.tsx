// a 6-week readiness heatmap (Oura's "calendar", our way): a 7-wide grid of days,
// each a small phosphor block tinted by that day's readiness on the good/warn/bad
// ramp (from getMetrics — no new endpoint). taps push the unified day route. days
// with no score read dim; future days are ghosted and inert. the grid is anchored
// so the most recent data (or today) sits in the bottom row.
import { addDays, endOfWeek, format, isAfter, isSameDay, parseISO } from 'date-fns';
import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { MetricsPoint } from '../lib/types';
import { colors, font, fonts, scoreColor, spacing } from '../theme';

// column headers — weeks start on Sunday to match endOfWeek's default
const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

type Cell = { date: string; readiness: number | null; future: boolean; isToday: boolean };

export default function MonthCalendar({
  points,
  weeks = 6,
  onPick,
}: {
  points: MetricsPoint[];
  weeks?: number;
  onPick: (date: string) => void;
}) {
  const rows = useMemo<Cell[][]>(() => {
    // map each dated score; order-independent so we don't rely on the API's sort
    const byDate = new Map<string, number | null>();
    let latest = '';
    for (const p of points) {
      byDate.set(p.date, p.readiness_custom);
      if (p.date > latest) latest = p.date;
    }
    const today = new Date();
    const latestD = latest ? parseISO(latest) : today;
    // anchor on whichever is later so today's (possibly empty) cell stays visible
    const anchor = isAfter(today, latestD) ? today : latestD;
    const lastCol = endOfWeek(anchor, { weekStartsOn: 0 });
    const firstCol = addDays(lastCol, -(weeks * 7 - 1));

    const cells: Cell[] = [];
    for (let i = 0; i < weeks * 7; i++) {
      const d = addDays(firstCol, i);
      const key = format(d, 'yyyy-MM-dd');
      cells.push({
        date: key,
        readiness: byDate.has(key) ? byDate.get(key) ?? null : null,
        future: isAfter(d, today) && !isSameDay(d, today),
        isToday: isSameDay(d, today),
      });
    }
    const out: Cell[][] = [];
    for (let i = 0; i < cells.length; i += 7) out.push(cells.slice(i, i + 7));
    return out;
  }, [points, weeks]);

  return (
    <View>
      <View style={styles.dowRow}>
        {DOW.map((d, i) => (
          <Text key={i} style={styles.dow}>
            {d}
          </Text>
        ))}
      </View>
      {rows.map((row, ri) => (
        <View key={ri} style={styles.weekRow}>
          {row.map((c) => {
            const has = c.readiness != null;
            const tint = scoreColor(c.readiness);
            const dom = format(parseISO(c.date), 'd');
            return (
              <Pressable
                key={c.date}
                style={styles.cell}
                disabled={c.future || !has}
                onPress={() => onPick(c.date)}
              >
                <Text
                  style={[
                    styles.dom,
                    c.isToday && styles.domToday,
                    c.future && styles.domFuture,
                  ]}
                >
                  {dom}
                </Text>
                <View
                  style={[
                    styles.dot,
                    c.future
                      ? styles.dotFuture
                      : has
                        ? { backgroundColor: tint, borderColor: tint }
                        : styles.dotEmpty,
                    c.isToday && styles.dotToday,
                  ]}
                />
              </Pressable>
            );
          })}
        </View>
      ))}
      <Text style={styles.caption}>TAP A DAY FOR DETAIL · COLOR = READINESS</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  dowRow: { flexDirection: 'row', marginBottom: spacing.xs },
  dow: { flex: 1, textAlign: 'center', color: colors.textFaint, fontFamily: fonts.mono, fontSize: font.tiny, letterSpacing: 1 },
  weekRow: { flexDirection: 'row' },
  cell: { flex: 1, alignItems: 'center', paddingVertical: 5, gap: 4 },
  dom: { color: colors.textDim, fontFamily: fonts.mono, fontSize: font.tiny },
  domToday: { color: colors.text },
  domFuture: { color: colors.textFaint, opacity: 0.5 },
  dot: { width: 14, height: 14, borderWidth: 1 },
  dotEmpty: { backgroundColor: 'transparent', borderColor: colors.border },
  dotFuture: { backgroundColor: 'transparent', borderColor: colors.surfaceAlt },
  dotToday: { borderColor: colors.text },
  caption: { color: colors.textFaint, fontFamily: fonts.mono, fontSize: font.tiny, letterSpacing: 1, marginTop: spacing.sm, textAlign: 'center' },
});
