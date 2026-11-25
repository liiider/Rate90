import {chanceFloorXg, chanceFullXg, chanceScenarios, sustainedPressureMinutes} from './chance-process.mjs';
import {hasExtraTime} from './style-stats.mjs';

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

function regulationClock(period, min, extraTime, added, second) {
  if (!count(min) || (period != null && period !== 1 && period !== 2)) return null;
  if (period == null && min > 90 && extraTime) return null;
  const half = period ?? (min <= 45 ? 1 : 2);
  const minute = half === 1 ? Math.min(min, 45) : Math.min(90, Math.max(46, min));
  return {half, minute, added:Math.max(count(added) ? added : 0, min - minute),
    second:count(second) ? second : null};
}

const byClock = (a, b) => a.half - b.half || a.minute - b.minute || a.added - b.added;

// Only use a reconstruction which accounts for every goal in the official score.
function scoreTimeline(goals, score90) {
  if (!validScore(score90) || goals.length !== sum(score90) || goals.some(g => g.side === null)) return null;
  goals.sort(byClock);
  for (let start = 0; start < goals.length;) {
    let end = start + 1;
    while (end < goals.length && byClock(goals[start], goals[end]) === 0) end++;
    const group = goals.slice(start, end);
    if (group.length > 1) {
      if (group.every(g => g.second != null) && new Set(group.map(g => g.second)).size === group.length) {
        group.sort((a, b) => a.second - b.second);
      } else if (group.every(g => validScore(g.score))) {
        group.sort((a, b) => sum(a.score) - sum(b.score));
      } else if (group.some(g => g.side !== group[0].side)) return null;
      goals.splice(start, group.length, ...group);
    }
    start = end;
  }
  const score = [0, 0];
  let lastMinute = 0, lastLeader = 0, closeMinutes = 0;
  let equalizers = 0, leadReversals = 0, lateSwingGoals = 0, lateCloseMinutes = 0;
  for (const goal of goals) {
    const before = score[0] - score[1];
    if (Math.abs(before) <= 1) {
      closeMinutes += goal.minute - lastMinute;
      lateCloseMinutes += Math.max(0, goal.minute - Math.max(75, lastMinute));
    }
    score[goal.side]++;
    if (validScore(goal.score) && goal.score.some((n, i) => n !== score[i])) return null;
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

function incidentGoalEvents(match, extraTime) {
  if (!Array.isArray(match.incidents) || !match.incidents.length) return null;
  const goals = [];
  for (const event of match.incidents) {
    if (event?.type !== 'goal' || [3, 4, 5].includes(event.period)) continue;
    const clock = regulationClock(event.period, event.minute, extraTime, event.added_time, event.period_second);
    if (!clock || typeof event.is_home !== 'boolean') return null;
    goals.push({...clock, side:Number(!event.is_home), score:[event.home_score, event.away_score]});
  }
  return goals;
}

// With minute-only clocks, grant the bonus only if every possible pre-shot
// score agrees that this side could equalize or take the lead.
function threatensResult(shot, goals) {
  if (shot.minute < 76 || !goals) return false;
  let margin = 0;
  const sameMinute = [];
  for (const goal of goals) {
    const order = byClock(goal, shot);
    if (order > 0) break;
    if (order === 0) sameMinute.push(goal);
    else margin += goal.side === shot.side ? 1 : -1;
  }
  const canChange = value => value === 0 || value === -1;
  if (!sameMinute.length) return canChange(margin);

  const possible = [];
  for (let i = 0; i <= sameMinute.length; i++) {
    const goal = sameMinute[i];
    if (shot.goal) {
      if (goal?.side === shot.side && (shot.second == null || goal.second == null || goal.second === shot.second)) possible.push(margin);
    } else {
      const before = sameMinute.slice(0, i), after = sameMinute.slice(i);
      if (shot.second == null || (before.every(g => g.second == null || g.second <= shot.second) &&
          after.every(g => g.second == null || g.second >= shot.second))) possible.push(margin);
    }
    if (goal) margin += goal.side === shot.side ? 1 : -1;
  }
  return possible.length > 0 && possible.every(canChange);
}

// The ordinary score clock measures 90 minutes, as does scoreTimeline.
// Each verified goal starts a new score state. Only the chasing side's
// opportunities can interrupt a spell spent waiting for a credible equalizer.
function scoreResponses(goals, chances, pressure) {
  if (!goals) return null;
  let margin = 0, previous = 0, peakLead = 0, recoveredDeficit = 0, unansweredMinutes = 0;
  const equalizers = new Set();
  const attacks = [new Set(), new Set()];
  for (const e of chances) attacks[e.side].add(e.minute);
  const trace = pressure?.values;
  for (const minute of sustainedPressureMinutes(trace, 0)) {
    attacks[trace[minute-1] > 0 ? 0 : 1].add(minute);
  }
  for (const goal of [...goals, {minute:90, side:null}]) {
    if (trace && Math.abs(margin) === 1) {
      const chasing = margin > 0 ? 1 : 0;
      let last = previous;
      for (let minute = previous + 1; minute < goal.minute; minute++) {
        if (trace[minute-1] != null && !attacks[chasing].has(minute)) continue;
        unansweredMinutes += Math.max(0, minute - last - 30);
        last = minute;
      }
      unansweredMinutes += Math.max(0, goal.minute - last - 30);
    }
    if (goal.side == null) break;
    margin += goal.side === 0 ? 1 : -1;
    if (margin === 0) {
      recoveredDeficit = Math.max(recoveredDeficit, peakLead);
      equalizers.add(goal.side);
      peakLead = 0;
    } else peakLead = Math.max(peakLead, Math.abs(margin));
    previous = goal.minute;
  }
  // A shot and its resulting goal are one event. Look for an opponent's
  // distinct clear chance before a goal that can change the result.
  const late = chances.filter(e => e.lateThreat);
  const lateCounter = late.some(goal => goal.goal && late.some(e =>
    e.clearAttempt && !e.goal && e.side !== goal.side && goal.elapsed > e.elapsed && goal.elapsed - e.elapsed <= 5));
  return {unansweredMinutes, recoveredDeficit, bothEqualized:equalizers.size === 2, lateCounter};
}

function hasHighlightSequence(clocks) {
  // Rebounds in the same minute count once; halftime separates sequences.
  for (const half of [1, 2]) {
    const minutes = [...new Set(clocks.filter(e => e.half === half).map(e => e.minute + e.added))].sort((a,b) => a-b);
    if (minutes.some((minute,i) => i >= 2 && minute - minutes[i-2] <= 10)) return true;
  }
  return false;
}

export function shotProfile(match, score90, pressure, extraTime = hasExtraTime(match)) {
  const missing = {shotsByWindow:null, chancesByWindow:null, chanceSides:null, xg90:null,
    xgCount:0, xgotCount:0, difficultSaves:0, extraShots:0, shotEvidence:null};
  if (!Array.isArray(match.shotmap) || !match.shotmap.length) return missing;
  const shots = Array(6).fill(0), chances = Array(6).fill(0), sides = [0, 0];
  const sideWindows = [Array(6).fill(0), Array(6).fill(0)];
  const goals = [], opportunities = [], highlightClocks = [], addedByHalf = [0, 0];
  let missingSide = false;
  let xg = 0, xgCount = 0, xgotCount = 0, extraShots = 0, difficultSaves = 0;
  let onTarget = 0, measuredOnTarget = 0, woodwork = 0, executionLifts = 0;
  let penaltyShots = 0, penaltyXg = 0, nonPenaltyBigChances = 0, blockedShots = 0;
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
    const clock = regulationClock(period, min, extraTime, shot.added_time ?? shot.added, shot.period_second);
    if (!clock) return missing;
    addedByHalf[clock.half-1] = Math.max(addedByHalf[clock.half-1], clock.added);
    const {minute} = clock;
    const bin = Math.floor(Math.max(0, minute - 1) / 15);
    const side = typeof home === 'boolean' ? Number(!home) : null;
    // BSD assigns own goals to the beneficiary. They change the score without an attacking shot.
    if (type === 'goal') {
      goals.push({...clock, side});
      highlightClocks.push(clock);
    }
    if (ownGoal) continue;
    const hasXg = validShotProbability(shot.xg), hasXgot = validShotProbability(shot.xgot);
    if (shot.sit === 'penalty') {
      penaltyShots++;
      if (hasXg) penaltyXg += shot.xg;
    }
    if (hasXg && shot.xg >= 0.30 && shot.sit !== 'penalty' && shot.gtype !== 'penalty' &&
        (typeof shot.sit === 'string' && shot.sit.length > 0 || shot.gtype === 'regular')) nonPenaltyBigChances++;
    if (type === 'block' || type === 'blocked-off-line') blockedShots++;
    const target = type === 'goal' || type === 'save';
    const hardSave = type === 'save' && hasXgot && shot.xgot >= 0.35;
    const proxySave = type === 'save' && !hasXgot && hasXg && shot.xg >= 0.35;
    const clearAttempt = hasXg && shot.xg >= 0.35 || hardSave || type === 'post';
    if (type !== 'goal' && clearAttempt) highlightClocks.push(clock);
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
    if (!['goal','save','post','block','blocked-off-line','miss'].includes(type)) unknownOutcomes++;
    if (target && hasXg && hasXgot && shot.xgot >= 0.35 && shot.xgot - shot.xg >= 0.25 - 1e-10) executionLifts++;
    const certainChance = type === 'goal' || type === 'post' || (hasXgot && shot.xgot >= 0.35);
    const cutoff = certainChance ? chanceFullXg : Math.min(chanceFullXg, hasXg ? shot.xg : 0);
    if (cutoff > chanceFloorXg) {
      if (side === null) missingSide = true;
      else opportunities.push({...clock, side, cutoff, clearAttempt, goal:type === 'goal'});
    }
    if (certainChance || (hasXg && shot.xg >= 0.15)) {
      chances[bin]++;
      if (side !== null) { sides[side]++; sideWindows[side][bin]++; }
    }
  }
  if (!sum(shots) && !goals.length) return {...missing, extraShots};
  const incidentGoals = incidentGoalEvents(match, extraTime);
  const incidentScore = incidentGoals && scoreTimeline(incidentGoals, score90);
  const timeline = incidentScore ?? (unknownOutcomes ? null : scoreTimeline(goals, score90));
  const verifiedGoals = incidentScore ? incidentGoals : timeline ? goals : null;
  for (const e of Array.isArray(match.incidents) ? match.incidents : []) {
    // BSD period markers sort last with added_time=999; only timed play and
    // announced stoppage time provide evidence of elapsed minutes.
    if (!e || e.type === 'period' || /shootout/i.test(e.type)) continue;
    const added = e.type === 'injuryTime' ? e.length : e.added_time;
    const clock = regulationClock(e.period, e.minute, extraTime, added);
    if (clock) addedByHalf[clock.half-1] = Math.max(addedByHalf[clock.half-1], clock.added);
  }
  for (const e of opportunities) {
    e.elapsed = e.minute + e.added + (e.half === 2 ? addedByHalf[0] : 0);
    e.lateThreat = threatensResult(e, verifiedGoals);
  }
  const duration = 90 + sum(addedByHalf);
  const responses = !missingSide && xgCount === sum(shots) ? scoreResponses(verifiedGoals, opportunities, pressure) : null;
  const scenarios = chanceScenarios(opportunities, duration, sustainedPressureMinutes(pressure?.values, addedByHalf[0]));
  return {
    shotsByWindow:shots, chancesByWindow:chances, chanceSides:missingSide ? null : sides,
    xg90:xgCount === sum(shots) ? Number(xg.toFixed(2)) : null,
    xgCount, xgotCount, difficultSaves, extraShots,
    shotEvidence:{
      responses, highlightSequence:hasHighlightSequence(highlightClocks),
      scenarios, onTarget, measuredOnTarget, woodwork, executionLifts, estimatedXg, unknownXgSource, proxySaves,
      penaltyShots, penaltyXg:Number(penaltyXg.toFixed(2)), nonPenaltyBigChances, blockedShots,
      contestedWindows:sideWindows[0].filter((n, i) => n > 0 && sideWindows[1][i] > 0).length,
      highlightCount:unknownOutcomes ? null : goals.length + woodwork + difficultSaves + proxySaves,
      pressure:pressure ? {minutes:pressure.minutes, swings:pressure.swings} : null,
      timeline:timeline ? {...timeline, source:incidentScore ? 'incidents' : 'shotmap'} : null
    }
  };
}
