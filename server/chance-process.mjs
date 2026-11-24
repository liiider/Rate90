export const chanceFloorXg = 0.10, chanceFullXg = 0.20;

// Average over possible xG cutoffs in [0.10, 0.20]. At a cutoff only the
// observed shot xGs can change the answer, so these intervals are exact.
export function chanceScenarios(events, duration, pressureMinutes) {
  const boundaries = [...new Set([chanceFloorXg, chanceFullXg, ...events.map(e => e.cutoff)])].sort((a, b) => a - b);
  const ordered = [...events].sort((a, b) => a.elapsed - b.elapsed);
  const scenarios = [];
  for (let i = 1; i < boundaries.length; i++) {
    const cutoff = boundaries[i];
    const windows = Array(6).fill(0), sides = [0, 0], sideMasks = Array(6).fill(0);
    let previous = 0, longestGap = 0, lateThreats = 0;
    const intervals = [];
    for (const e of ordered) {
      if (e.cutoff < cutoff) continue;
      const bin = Math.floor((Math.max(1, e.minute) - 1) / 15);
      windows[bin]++;
      sides[e.side]++;
      sideMasks[bin] |= 1 << e.side;
      longestGap = Math.max(longestGap, e.elapsed - previous);
      previous = e.elapsed;
      const start = Math.max(1, e.elapsed - 5), end = Math.min(duration, e.elapsed + 5);
      const last = intervals.at(-1);
      if (last && start <= last.end + 1) last.end = Math.max(last.end, end);
      else intervals.push({start, end});
      if (e.lateThreat) lateThreats++;
    }
    longestGap = Math.max(longestGap, duration - previous);
    // A sustained press only gives partial credit during otherwise quiet minutes.
    // A long gap still counts in full in the longest-gap term.
    let activeMinutes = intervals.reduce((total, span) => total + span.end - span.start + 1, 0);
    for (const minute of pressureMinutes) {
      if (!intervals.some(span => minute >= span.start && minute <= span.end)) activeMinutes += 0.25;
    }
    scenarios.push({share:(cutoff - boundaries[i-1]) / (chanceFullXg - chanceFloorXg), windows, sides,
      contested:sideMasks.filter(mask => mask === 3).length, lateThreats, longestGap,
      continuity:0.6 * activeMinutes / duration + 0.4 * (1 - longestGap / duration)});
  }
  return scenarios;
}

export function sustainedPressureMinutes(series, firstHalfAdded) {
  const minutes = new Set();
  let run = 0, direction = 0;
  for (let minute = 1; minute <= (series?.length ?? 0); minute++) {
    const value = series[minute-1];
    const side = Math.abs(value) >= 40 ? Math.sign(value) : 0;
    run = side && side === direction && minute !== 46 ? run + 1 : Number(side !== 0);
    direction = side;
    if (run < 3) continue;
    const elapsed = minute + (minute > 45 ? firstHalfAdded : 0);
    for (let t = elapsed - 2; t <= elapsed; t++) minutes.add(t);
  }
  return minutes;
}
