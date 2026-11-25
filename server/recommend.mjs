import {validScore} from './shot-profile.mjs';
import {matchStyles} from './style-tags.mjs';
import {publicMatchDetail} from './match-detail.mjs';

export const ruleVersion = 'rate90-1.2.0';
const weights = Object.freeze({threat:25, tempo:15, continuity:20, exchanges:15, highlights:10, suspense:15});
const sum = values => values.reduce((a, b) => a + b, 0);
const scaled = (value, full) => Math.min(1, Math.max(0, value / full));
const isCount = value => Number.isSafeInteger(value) && value >= 0;
const counts = (values, size) => Array.isArray(values) && values.length === size && values.every(isCount);

function hasProcess(match) {
  const {shotsByWindow:shots, chancesByWindow:chances, chanceSides:sides, xg90} = match;
  if (!counts(shots, 6) || !counts(chances, 6) || !counts(sides, 2)) return false;
  const n = sum(shots);
  return n > 0 && n === match.xgCount && Number.isFinite(xg90) && xg90 >= 0 && xg90 <= n &&
    chances.every((v, i) => v <= shots[i]) && sum(sides) === sum(chances);
}

function longestQuietRun(windows) {
  let run = 0, longest = 0;
  for (const n of windows) {
    run = n === 0 ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  return longest;
}

function highlights(match, chanceCount) {
  const detail = match.shotEvidence;
  if (isCount(detail?.highlightCount)) {
    // A difficult shot and its save are one highlight. Placement can increase its value by up to 25%.
    const lifts = isCount(detail.executionLifts) ? Math.min(detail.executionLifts, detail.highlightCount) : 0;
    const units = detail.highlightCount + 0.25 * lifts;
    return {value:scaled(units, 6), method:'shot-outcomes', count:detail.highlightCount};
  }
  if (validScore(match.score90) && isCount(match.difficultSaves) && match.xgotCount > 0) {
    const observed = Math.min(chanceCount, sum(match.score90) + match.difficultSaves);
    return {value:scaled(observed, 6), method:'recorded-goals-and-saves', count:observed};
  }
  return {value:scaled(chanceCount, 12), method:'chance-volume-proxy', count:null};
}

function suspense(match, chanceCount, lateCount, detailed) {
  const activity = scaled(chanceCount, 4);
  const late = scaled(lateCount, 3);
  const timeline = match.shotEvidence?.timeline;
  if (timeline && [timeline.closeMinutes, timeline.lateCloseMinutes, timeline.equalizers,
    timeline.leadReversals, timeline.lateSwingGoals].every(isCount) &&
    timeline.closeMinutes <= 90 && timeline.lateCloseMinutes <= Math.min(15, timeline.closeMinutes)) {
    const turns = scaled(timeline.equalizers + timeline.leadReversals, 3);
    const lateThreat = late * timeline.lateCloseMinutes / 15;
    const unanswered = match.shotEvidence.responses?.unansweredMinutes ?? 0;
    const value = 0.65 * Math.max(0, timeline.closeMinutes - unanswered) / 90 +
      0.35 * Math.max(turns, scaled(timeline.lateSwingGoals, 1), lateThreat);
    return {value:activity * value, method:'verified-goal-timeline'};
  }
  if (validScore(match.score90) && sum(match.score90) === 0) {
    return {value:activity * (0.65 + 0.35 * late), method:'goalless-scoreline'};
  }
  if (!validScore(match.score90)) return {value:activity * late, method:detailed ? 'unverified-score' : 'late-chances-only'};
  const margin = Math.abs(match.score90[0] - match.score90[1]);
  return {value:activity * (0.65 * (1 - scaled(margin, 4)) + 0.35 * late), method:detailed ? 'final-margin-only' : 'final-margin-and-late-chances'};
}

function chanceSignals(match, scenario, shotCount) {
  const chanceCount = sum(scenario.windows), smallerSide = Math.min(...scenario.sides);
  const balance = chanceCount ? 2 * smallerSide / chanceCount : 0;
  const exchanges = isCount(scenario.contested) ? 0.7 * balance + 0.3 * scaled(scenario.contested, 3) : balance;
  const swings = match.shotEvidence?.pressure?.swings;
  const attackExchange = isCount(swings) ? 0.8 * exchanges + 0.2 * scaled(swings, 5) : exchanges;
  const moments = highlights(match, chanceCount);
  const drama = suspense(match, chanceCount, scenario.lateThreats, scenario.longestGap != null);
  return {
    tempo:0.55 * scaled(shotCount, 32) + 0.45 * scaled(chanceCount, 10),
    continuity:scenario.continuity,
    exchanges:scaled(smallerSide, 3) * attackExchange,
    highlights:moments.value, suspense:drama.value
  };
}

export function rateMatch(match) {
  if (!hasProcess(match)) return {rating:null, recommendation:'资料不足', analysis:null};
  const {shotsByWindow:shots, chancesByWindow:chances, chanceSides:sides, xg90} = match;
  const shotCount = sum(shots), chanceCount = sum(chances);
  const evidence = match.shotEvidence;
  const penaltyXg = evidence?.penaltyXg;
  const discount = Number.isFinite(penaltyXg) && penaltyXg >= 0 && penaltyXg <= xg90 ? penaltyXg * 0.5 : 0;
  const threatXg = xg90 - discount;
  const quiet = longestQuietRun(chances);
  // Archived summaries predate the shot clock and contain only six window totals.
  const scenarios = evidence?.scenarios ?? [{share:1, windows:chances, sides, contested:evidence?.contestedWindows,
    lateThreats:chances[5], continuity:0.6 * sum(chances.map(v => Math.min(2, v))) / 12 + 0.4 * (1 - quiet / 6)}];
  const signals = {threat:0.7 * scaled(threatXg, 4) + 0.3 * scaled(threatXg / shotCount, 0.18),
    tempo:0, continuity:0, exchanges:0, highlights:0, suspense:0};
  let weightedChances = 0, longestGap = 0, lateThreats = 0;
  for (const scenario of scenarios) {
    const values = chanceSignals(match, scenario, shotCount);
    for (const [key, value] of Object.entries(values)) signals[key] += scenario.share * value;
    weightedChances += scenario.share * sum(scenario.windows);
    longestGap += scenario.share * (scenario.longestGap ?? 0);
    lateThreats += scenario.share * scenario.lateThreats;
  }
  const responses = evidence?.responses;
  if (responses?.unansweredMinutes) signals.exchanges *= 1 - 0.5 * responses.unansweredMinutes / 90;
  // Recovering a multi-goal deficit is also evidence of an exchange, even
  // when it takes the teams different halves to answer each other.
  if (responses?.recoveredDeficit >= 2) {
    const repeated = responses.bothEqualized || responses.lateCounter;
    signals.exchanges = Math.max(signals.exchanges, repeated ? 1 : 0.8);
  }
  const moments = highlights(match, chanceCount);
  const drama = suspense(match, weightedChances, lateThreats, Boolean(evidence?.scenarios));
  // Integer tenths on the 100-point scale make rounding reproducible, including ties.
  const components = {};
  let tenths = 0;
  for (const [key, weight] of Object.entries(weights)) {
    const earned = Math.round(10 * weight * signals[key]);
    tenths += earned;
    components[key] = {weight, points:earned / 10};
  }
  const rating = Math.round(tenths / 10) / 10;
  const recommendation = rating >= 8 ? '看全场' : rating >= 4.5 || evidence?.highlightSequence ? '看集锦' : '可跳过';
  return {rating, recommendation, analysis:{
    components, shotCount, chanceCount, weightedChanceCount:Number(weightedChances.toFixed(3)),
    longestGapMinutes:evidence?.scenarios ? Number(longestGap.toFixed(2)) : null,
    lateResultChances:evidence?.scenarios && evidence.timeline ? Number(lateThreats.toFixed(3)) : null,
    threatXg:Number(threatXg.toFixed(3)), activeWindows:chances.filter(v => v > 0).length,
    longestQuietWindows:quiet, lateChances:chances[5], xgPerShot:Number((xg90 / shotCount).toFixed(3)),
    highlightCount:moments.count, highlightMethod:moments.method, suspenseMethod:drama.method,
    exchangesMethod:isCount(evidence?.pressure?.swings) ? 'pressure-and-chances' : isCount(evidence?.contestedWindows) ? 'within-window-and-totals' : 'chance-totals'
  }};
}

export function formatFeed(feed, includeDetails = false) {
  const {matches, ...meta} = feed;
  const rated = matches.map(match => ({match, ...rateMatch(match)}));
  rated.sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1) ||
    a.match.kickoff.localeCompare(b.match.kickoff) || a.match.id.localeCompare(b.match.id));
  return {...meta, ruleVersion, matches:rated.map(({match, rating, recommendation}, index) => {
    const {id, stage, kickoff, home, away} = match;
    const card = {id, stage, kickoff, home, away, rating, recommendation, viewing:matchStyles(match, rating), topPick:index === 0 && recommendation === '看全场'};
    return includeDetails ? {...card, details:publicMatchDetail(match)} : card;
  })};
}
