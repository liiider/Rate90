const sum = values => values.reduce((a, b) => a + b, 0);
export const validShotProbability = value => Number.isFinite(value) && value >= 0 && value <= 1;
export const isOwnGoal = shot => shot?.type === 'goal' && shot.gtype === 'own';
const count = value => Number.isSafeInteger(value) && value >= 0;
export const validScore = value => Array.isArray(value) && value.length === 2 && value.every(count);

// Aggregate only a well-covered 90-minute trace. Ignore isolated spikes and gaps between spells.
export function pressureProfile(trace) {
  if (!Array.isArray(trace)) return null;
  const seen = new Map();
  for (const point of trace) {
    if (!point || !count(point.m) || point.m < 1 || point.m > 90 || !Number.isFinite(point.v)) continue;
    if (seen.has(point.m) && seen.get(point.m) !== point.v) return null;
    seen.set(point.m, point.v);
  }
  if (seen.size < 72) return null;
  const floor = sum([...seen.values()].map(Math.abs)) / seen.size * 0.5;
  let previous = 0, swings = 0;
  for (let start = 1; start <= 90; start += 5) {
    const values = [];
    for (let m = start; m < start + 5; m++) if (seen.has(m)) values.push(seen.get(m));
    if (values.length < 3) return null;
    const mean = sum(values) / values.length;
    const direction = Math.abs(mean) >= floor ? Math.sign(mean) : 0;
    if (direction && previous && direction !== previous) swings++;
    previous = direction;
  }
  return {minutes:seen.size, swings, values:Array.from({length:90}, (_, i) => seen.get(i + 1) ?? null)};
}

function regulationClock(period, min, extraTime) {
  if (!count(min) || (period != null && period !== 1 && period !== 2)) return null;
  if (period == null && min > 90 && extraTime) return null;
  const half = period ?? (min <= 45 ? 1 : 2);
  const minute = half === 1 ? Math.min(min, 45) : Math.min(90, Math.max(46, min));
  return {half, min, minute};
}

// Only use a reconstruction which accounts for every goal in the official score.
function scoreTimeline(goals, score90) {
  if (!validScore(score90) || goals.length !== sum(score90) || goals.some(g => g.side === null)) return null;
  goals.sort((a, b) => a.half - b.half || a.min - b.min || (a.second ?? 0) - (b.second ?? 0));
  // Opposing goals in the same minute need a known order for every event in that minute.
  for (let start = 0; start < goals.length;) {
    let end = start + 1;
    while (end < goals.length && goals[end].half === goals[start].half && goals[end].min === goals[start].min) end++;
    const group = goals.slice(start, end);
    if (group.some(g => g.side !== group[0].side) && group.some(g => g.second == null)) return null;
    start = end;
  }
  const score = [0, 0];
  let lastMinute = 0, lastLeader = 0, closeMinutes = 0;
  let equalizers = 0, leadReversals = 0, lateSwingGoals = 0, lateCloseMinutes = 0;
  for (const [i, goal] of goals.entries()) {
    const prior = goals[i - 1];
    if (prior && prior.half === goal.half && prior.min === goal.min && prior.side !== goal.side &&
        prior.second === goal.second) return null;
    const before = score[0] - score[1];
    if (Math.abs(before) <= 1) {
      closeMinutes += goal.minute - lastMinute;
      lateCloseMinutes += Math.max(0, goal.minute - Math.max(75, lastMinute));
    }
    score[goal.side]++;
    const leader = Math.sign(score[0] - score[1]);
    if (leader === 0) equalizers++;
    if (leader && lastLeader && leader !== lastLeader) leadReversals++;
    if (goal.minute >= 76 && (before === 0 || leader === 0)) lateSwingGoals++;
    if (leader) lastLeader = leader;
    lastMinute = goal.minute;
  }
  if (score.some((n, i) => n !== score90[i])) return null;
  if (Math.abs(score[0] - score[1]) <= 1) {
    closeMinutes += 90 - lastMinute;
    lateCloseMinutes += 90 - Math.max(lastMinute, 75);
  }
  return {closeMinutes, lateCloseMinutes, equalizers, leadReversals, lateSwingGoals};
}

function incidentTimeline(match, score90) {
  if (!Array.isArray(match.incidents) || !match.incidents.length) return null;
  const goals = [];
  for (const event of match.incidents) {
    if (event?.type !== 'goal' || [3, 4, 5].includes(event.period)) continue;
    const clock = regulationClock(event.period, event.minute, match.extra_time_score || match.penalty_shootout);
    if (!clock || typeof event.is_home !== 'boolean') return null;
    goals.push({...clock, side:Number(!event.is_home), second:count(event.period_second) ? event.period_second : null});
  }
  return scoreTimeline(goals, score90);
}

export function shotProfile(match, score90, pressure) {
  const missing = {shotsByWindow:null, chancesByWindow:null, chanceSides:null, xg90:null,
    xgCount:0, xgotCount:0, difficultSaves:0, extraShots:0, shotEvidence:null};
  if (!Array.isArray(match.shotmap) || !match.shotmap.length) return missing;
  const shots = Array(6).fill(0), chances = Array(6).fill(0), sides = [0, 0];
  const sideWindows = [Array(6).fill(0), Array(6).fill(0)];
  const goals = [];
  let xg = 0, xgCount = 0, xgotCount = 0, extraShots = 0, difficultSaves = 0;
  let onTarget = 0, measuredOnTarget = 0, woodwork = 0, executionLifts = 0;
  let penaltyShots = 0, penaltyXg = 0;
  let estimatedXg = 0, unknownXgSource = 0, proxySaves = 0, unknownOutcomes = 0;
  for (const shot of match.shotmap) {
    if (!shot || typeof shot !== 'object') return missing;
    const {period, min, type, home} = shot;
    if (period === 5 || /shoot.?out/i.test(shot.sit || '')) continue;
    const ownGoal = isOwnGoal(shot);
    if (period === 3 || period === 4) {
      if (!ownGoal) extraShots++;
      continue;
    }
    const clock = regulationClock(period, min, match.extra_time_score || match.penalty_shootout);
    if (!clock) return missing;
    const {minute} = clock;
    const bin = Math.floor(Math.max(0, minute - 1) / 15);
    const side = typeof home === 'boolean' ? Number(!home) : null;
    // BSD assigns own goals to the beneficiary. They change the score without an attacking shot.
    if (type === 'goal') goals.push({...clock, side});
    if (ownGoal) continue;
    const hasXg = validShotProbability(shot.xg), hasXgot = validShotProbability(shot.xgot);
    if (shot.sit === 'penalty') {
      penaltyShots++;
      if (hasXg) penaltyXg += shot.xg;
    }
    const target = type === 'goal' || type === 'save';
    const hardSave = type === 'save' && hasXgot && shot.xgot >= 0.35;
    const proxySave = type === 'save' && !hasXgot && hasXg && shot.xg >= 0.35;
    shots[bin]++;
    if (hasXg) {
      xg += shot.xg;
      xgCount++;
      if (shot.xg_estimated === true) estimatedXg++;
      if (typeof shot.xg_estimated !== 'boolean') unknownXgSource++;
    }
    if (hasXgot) xgotCount++;
    if (target) onTarget++;
    if (target && hasXgot) measuredOnTarget++;
    if (hardSave) difficultSaves++;
    if (proxySave) proxySaves++;
    if (type === 'post') woodwork++;
    if (!['goal','save','post','block','miss'].includes(type)) unknownOutcomes++;
    if (target && hasXg && hasXgot && shot.xgot >= 0.35 && shot.xgot - shot.xg >= 0.25 - 1e-10) executionLifts++;
    if (type === 'goal' || type === 'post' || (hasXg && shot.xg >= 0.15) || (hasXgot && shot.xgot >= 0.35)) {
      chances[bin]++;
      if (side !== null) { sides[side]++; sideWindows[side][bin]++; }
    }
  }
  if (!sum(shots) && !goals.length) return {...missing, extraShots};
  const incidentGoals = incidentTimeline(match, score90);
  const timeline = incidentGoals ?? (unknownOutcomes ? null : scoreTimeline(goals, score90));
  return {
    shotsByWindow:shots, chancesByWindow:chances, chanceSides:sides,
    xg90:xgCount === sum(shots) ? Number(xg.toFixed(2)) : null,
    xgCount, xgotCount, difficultSaves, extraShots,
    shotEvidence:{
      onTarget, measuredOnTarget, woodwork, executionLifts, estimatedXg, unknownXgSource, proxySaves,
      penaltyShots, penaltyXg:Number(penaltyXg.toFixed(2)),
      contestedWindows:sideWindows[0].filter((n, i) => n > 0 && sideWindows[1][i] > 0).length,
      highlightCount:unknownOutcomes ? null : goals.length + woodwork + difficultSaves + proxySaves,
      pressure:pressure ? {minutes:pressure.minutes, swings:pressure.swings} : null,
      timeline:timeline ? {...timeline, source:incidentGoals ? 'incidents' : 'shotmap'} : null
    }
  };
}
