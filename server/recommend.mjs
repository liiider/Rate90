import {validScore} from './shot-profile.mjs';

export const ruleVersion = 'rate90-1.0.1';
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

function suspense(match, chances) {
  const activity = scaled(sum(chances), 4);
  const late = scaled(chances[5], 3);
  const timeline = match.shotEvidence?.timeline;
  if (timeline && [timeline.closeMinutes, timeline.lateCloseMinutes, timeline.equalizers,
    timeline.leadReversals, timeline.lateSwingGoals].every(isCount) &&
    timeline.closeMinutes <= 90 && timeline.lateCloseMinutes <= Math.min(15, timeline.closeMinutes)) {
    const turns = scaled(timeline.equalizers + timeline.leadReversals, 3);
    const lateThreat = late * timeline.lateCloseMinutes / 15;
    const value = 0.65 * timeline.closeMinutes / 90 +
      0.35 * Math.max(turns, scaled(timeline.lateSwingGoals, 1), lateThreat);
    return {value:activity * value, method:'verified-goal-timeline'};
  }
  if (validScore(match.score90) && sum(match.score90) === 0) {
    return {value:activity * (0.65 + 0.35 * late), method:'goalless-scoreline'};
  }
  if (!validScore(match.score90)) return {value:activity * late, method:'late-chances-only'};
  const margin = Math.abs(match.score90[0] - match.score90[1]);
  return {value:activity * (0.65 * (1 - scaled(margin, 4)) + 0.35 * late), method:'final-margin-and-late-chances'};
}

export function rateMatch(match) {
  if (!hasProcess(match)) return {rating:null, recommendation:'资料不足', analysis:null};
  const {shotsByWindow:shots, chancesByWindow:chances, chanceSides:sides, xg90} = match;
  const shotCount = sum(shots), chanceCount = sum(chances), smallerSide = Math.min(...sides);
  // Discount half the value of explicitly tagged penalties in the chance-creation dimension.
  const penaltyXg = match.shotEvidence?.penaltyXg;
  const discount = Number.isFinite(penaltyXg) && penaltyXg >= 0 && penaltyXg <= xg90 ? penaltyXg * 0.5 : 0;
  const threatXg = xg90 - discount;
  const quiet = longestQuietRun(chances);
  const balance = chanceCount ? 2 * smallerSide / chanceCount : 0;
  const contested = match.shotEvidence?.contestedWindows;
  const exchanges = isCount(contested) ? 0.7 * balance + 0.3 * scaled(contested, 3) : balance;
  const swings = match.shotEvidence?.pressure?.swings;
  const attackExchange = isCount(swings) ? 0.8 * exchanges + 0.2 * scaled(swings, 5) : exchanges;
  const moments = highlights(match, chanceCount);
  const drama = suspense(match, chances);
  const signals = {
    threat:0.7 * scaled(threatXg, 4) + 0.3 * scaled(threatXg / shotCount, 0.18),
    tempo:0.55 * scaled(shotCount, 32) + 0.45 * scaled(chanceCount, 10),
    continuity:0.6 * sum(chances.map(v => Math.min(2, v))) / 12 + 0.4 * (1 - quiet / 6),
    exchanges:scaled(smallerSide, 3) * attackExchange,
    highlights:moments.value,
    suspense:drama.value
  };
  // Integer tenths on the 100-point scale make rounding reproducible, including ties.
  const components = {};
  let tenths = 0;
  for (const [key, weight] of Object.entries(weights)) {
    const earned = Math.round(10 * weight * signals[key]);
    tenths += earned;
    components[key] = {weight, points:earned / 10};
  }
  const rating = Math.round(tenths / 10) / 10;
  const recommendation = rating >= 8 ? '看全场' : rating >= 4.5 ? '看集锦' : '可跳过';
  return {rating, recommendation, analysis:{
    components, shotCount, chanceCount, threatXg:Number(threatXg.toFixed(3)), activeWindows:chances.filter(v => v > 0).length,
    longestQuietWindows:quiet, lateChances:chances[5], xgPerShot:Number((xg90 / shotCount).toFixed(3)),
    highlightCount:moments.count, highlightMethod:moments.method, suspenseMethod:drama.method,
    exchangesMethod:isCount(swings) ? 'pressure-and-chances' : isCount(contested) ? 'within-window-and-totals' : 'chance-totals'
  }};
}

function viewingProfile(match) {
  const shots = counts(match.shotsByWindow, 6) ? sum(match.shotsByWindow) : null;
  const windows = counts(match.chancesByWindow, 6) ? match.chancesByWindow : null;
  const chances = windows ? sum(windows) : null;
  const pressure = match.pressureMinutes ?? null;
  if (shots === null && !pressure) return null;
  const styles = [];
  const sides = match.chanceSides;
  if (counts(sides, 2) && sum(sides) === chances && Math.min(...sides) >= 3 && Math.min(...sides) * 3 >= chances) styles.push('双向对攻');
  if (shots >= 30) styles.push('射门密集');
  if (windows && chances >= 6 && windows.filter(n => n > 0).length >= 5) styles.push('机会贯穿全场');
  if (chances >= 4 && Math.max(...windows) * 2 > chances) styles.push('机会集中');
  if (shots !== null && shots <= 18 && chances !== null && chances <= 5) styles.push('节奏舒缓');
  return {styles:styles.slice(0, 2), shots, chances, xg:Number.isFinite(match.xg90) ? match.xg90 : null,
    pressure, shotsByWindow:shots !== null ? match.shotsByWindow : null};
}

function reason(match, analysis) {
  if (!analysis) return '常规时间射门、机会归属或逐脚 xG 资料不足。';
  const {shotCount, chanceCount, activeWindows, lateChances} = analysis;
  const notes = [
    '常规时间 ' + shotCount + ' 脚射门，' + chanceCount + ' 次关键机会分布在 ' + activeWindows + ' 个时段。',
    '主客队分别创造 ' + match.chanceSides.join('、') + ' 次，最后 15 分钟有 ' + lateChances + ' 次。'
  ];
  if (match.difficultSaves > 0) notes.push('其中有 ' + match.difficultSaves + ' 次高难度扑救。');
  const timeline = match.shotEvidence?.timeline;
  if (analysis.suspenseMethod === 'verified-goal-timeline') notes.push('平局或仅差一球的时间为 ' + timeline.closeMinutes + ' 分钟。');
  return notes.join('');
}

export function formatFeed(feed, reveal = false) {
  const {matches, ...meta} = feed;
  const rated = matches.map(match => ({match, ...rateMatch(match)}));
  rated.sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1) ||
    a.match.kickoff.localeCompare(b.match.kickoff) || a.match.id.localeCompare(b.match.id));
  const goals = matches.filter(m => validScore(m.score90)).map(m => sum(m.score90));
  let processRank = null;
  return {...meta, ruleVersion, matches:rated.map(({match, rating, recommendation, analysis}, index) => {
    const {id, stage, kickoff, home, away} = match;
    const {pressureMinutes, ...evidence} = match;
    const card = {id, stage, kickoff, home, away, rating, recommendation, viewing:viewingProfile(match), topPick:index === 0 && recommendation === '看全场'};
    if (!reveal) return card;
    if (index === 0 || rating !== rated[index - 1].rating) processRank = index + 1;
    const total = validScore(match.score90) ? sum(match.score90) : null;
    return {...card, details:{...evidence, analysis, reason:reason(match, analysis), processRank:rating === null ? null : processRank,
      goalsOnlyRank:total === null ? null : 1 + goals.filter(n => n > total).length}};
  })};
}
