const nonNegative = value => {
  if (typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value.trim())) value = Number(value);
  return Number.isFinite(value) && value >= 0 ? value : null;
};

const count = value => {
  const n = nonNegative(value);
  return Number.isSafeInteger(n) ? n : null;
};

function attempts(value) {
  if (typeof value !== 'string') return count(value);
  const ratio = /^(\d+)\s*\/\s*(\d+)(?:\s*\([\d.]+%\))?$/.exec(value.trim());
  if (!ratio) return count(value);
  const successful = count(ratio[1]), total = count(ratio[2]);
  return successful !== null && total !== null && successful <= total ? total : null;
}

function percent(value) {
  const n = nonNegative(typeof value === 'string' ? value.trim().replace(/%$/, '') : value);
  return n !== null && n <= 100 ? n : null;
}

function kilometers(value) {
  if (typeof value !== 'string') return nonNegative(value);
  const measurement = /^(\d+(?:\.\d+)?)\s*(km|m)$/i.exec(value.trim());
  if (!measurement) return null;
  return Number(measurement[1]) / (measurement[2].toLowerCase() === 'km' ? 1 : 1000);
}

const fields = {
  shots: side => count(side.total_shots),
  shotsOnTarget: side => count(side.shots_on_target),
  xg: side => nonNegative(side.expected_goals),
  distanceKm: side => kilometers(side.distance_covered),
  insideBox: side => count(side.shots_inside_box),
  outsideBox: side => count(side.shots_outside_box),
  crosses: side => attempts(side.crosses),
  longBalls: side => attempts(side.long_balls),
  passes: side => count(side.passes),
  dribbles: side => attempts(side.dribbles),
  tackles: side => attempts(side.total_tackles) ?? attempts(side.tackles),
  aerialDuels: side => attempts(side.aerial_duels),
  interceptions: side => count(side.interceptions),
  possession: side => percent(side.ball_possession),
  corners: side => count(side.corner_kicks),
  blockedShots: side => count(side.blocked_shots),
  clearances: side => count(side.clearances)
};

// BSD's full-match totals may include extra time. Its two regulation half tables can be added for counts.
export function hasExtraTime(match) {
  if (match.extra_time_score || match.penalty_shootout || /^(?:[345]T?|AET|ET[12]?|PEN|PENS|PSO)$/i.test(match.period ?? '')) return true;
  return [match.shotmap, match.incidents].some(events => Array.isArray(events) &&
    events.some(event => [3, 4, 5].includes(event?.period) || /shoot.?out/i.test(event?.sit ?? '')));
}

function regulationValue(stats, inExtraTime, name, read, side) {
  if (!inExtraTime) {
    const full = read(stats[side] ?? {});
    if (full !== null) return full;
  }
  const first = read(stats.first_half?.[side] ?? {});
  const second = read(stats.second_half?.[side] ?? {});
  if (first === null || second === null) return null;
  // The provider does not supply time in possession for weighting the two percentages.
  if (name === 'possession') return first === second ? first : null;
  return Number((first + second).toFixed(6));
}

export function regulationStats(match, inExtraTime = hasExtraTime(match)) {
  const stats = match.live_stats;
  if (!stats || typeof stats !== 'object') return null;
  const result = {};
  for (const [name, read] of Object.entries(fields)) {
    result[name] = ['home', 'away'].map(side => regulationValue(stats, inExtraTime, name, read, side));
  }
  // Both halves above a threshold prove dominance even when their precise time weights are unavailable.
  result.possessionFloor = ['home', 'away'].map((side, i) => {
    if (result.possession[i] !== null) return result.possession[i];
    const first = percent(stats.first_half?.[side]?.ball_possession);
    const second = percent(stats.second_half?.[side]?.ball_possession);
    return first === null || second === null ? null : Math.min(first, second);
  });
  return Object.values(result).some(pair => pair.some(Number.isFinite)) ? result : null;
}
