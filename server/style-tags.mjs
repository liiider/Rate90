export const styleLabels = Object.freeze({
  'heavyweights':'强强对话', 'rivalry':'宿敌相逢', 'talisman':'关键先生', 'flashpoint-player':'问题人物',
  'contested-call':'争议判决', 'var-spotlight':'判罚焦点', 'end-to-end':'疯狂对攻',
  'team-move':'流畅配合', 'keeper-show':'门将高光', 'late-drama':'尾声悬念', 'highlight-reel':'值得看集锦'
});

// UEFA 2025/26 quarter-finals, known before the 2026/27 season began.
// https://www.uefa.com/uefachampionsleague/news/02a3-202d9ac10d17-a37e1f50256a-1000--champions-league-quarter-final-ties-and-dates-confirmed/
const club = name => String(name || '').normalize('NFD').replace(/\p{M}/gu,'').toLowerCase()
  .replace(/\b(fc|afc|cf|de)\b/g,'').trim().replace(/\s+/g,' ');
// Plus the top two in each 2025/26 major domestic league (before any 2026/27 game).
const elite2026 = new Set(['Arsenal','Real Madrid','Barcelona','Atlético Madrid','Sporting CP','Bayern München','Bayern Munich','Paris Saint-Germain','Liverpool',
  'Manchester City','Inter','Napoli','Borussia Dortmund','RC Lens','Lens','SSC Napoli'].map(club));
const rivals = [
  ['Real Madrid','Barcelona'],['Real Madrid','Atlético Madrid'],['Sevilla','Real Betis'],
  ['Liverpool','Manchester United'],['Manchester United','Manchester City'],['Arsenal','Tottenham Hotspur'],
  ['AC Milan','Inter'],['AS Roma','Lazio'],['Borussia Dortmund','Bayern München'],['Paris Saint-Germain','Olympique de Marseille']
].map(pair => pair.map(club));

// The independent KMI panel found a material error in both of these Matchweek 4 fixtures.
// https://www.premierleague.com/en/news/4725955
const reviewedCalls = new Set(['209572','209573']);
const rulings = new Set(['penaltyNotAwarded','penaltyAwarded','goalNotAwarded','goalAwarded','cardUpgrade','redCardCancelled']);
const count = n => Number.isSafeInteger(n) && n >= 0;
const sum = values => values.reduce((a,b) => a+b,0);

export function incidentReasons(raw, extraTime) {
  const events = (Array.isArray(raw.incidents) ? raw.incidents : []).filter(ev => ev && count(ev.minute) &&
    (ev.period == null ? !extraTime || ev.minute <= 90 : [1,2].includes(ev.period)) && !/shootout/i.test(ev.type));
  const contributors = new Map(), mistakes = new Map(), seen = new Set();
  const reviews = events.filter(ev => ev.type === 'varDecision' && rulings.has(ev.decision));
  let move = false, decisivePlayer = false;
  for (const ev of events) {
    const key = [ev.type,ev.player_id,ev.minute,ev.added_time,ev.home_score,ev.away_score].join('/');
    if (seen.has(key)) continue;
    seen.add(key);
    if (ev.type === 'penalty_missed' || (ev.type === 'goal' && ev.goal_type === 'ownGoal') ||
        (ev.type === 'card' && ['red','yellowRed'].includes(ev.card_type))) {
      if (ev.player_id != null) mistakes.set(ev.player_id,(mistakes.get(ev.player_id) || 0)+1);
      continue;
    }
    if (ev.type !== 'goal' || !['regular','penalty'].includes(ev.goal_type)) continue;
    const chain = Array.isArray(ev.sequence) ? ev.sequence : [];
    const passes = [];
    for (const step of chain) {
      if (step?.event === 'pass' && step.player_id != null) passes.push(step.player_id);
      else if (!['ball-movement','goal','shot'].includes(step?.event)) passes.length = 0;
      if (ev.goal_type !== 'regular' || step?.assist !== true || passes.length < 4) continue;
      const participants = new Set(passes);
      const giveAndGo = passes.some((id,i) => i >= 2 && id === passes[i-2] && id !== passes[i-1]);
      if (participants.size >= 4 || (participants.size >= 3 && giveAndGo)) move = true;
    }
    if (typeof ev.is_home !== 'boolean' || !count(ev.home_score) || !count(ev.away_score)) continue;
    const margin = (ev.home_score-ev.away_score) * (ev.is_home ? 1 : -1);
    const critical = margin === 0 || margin === 1;
    if (!extraTime && ev.player_id != null && ev.minute >= 85 && margin === 1 &&
        ev.home_score === raw.home_score && ev.away_score === raw.away_score) decisivePlayer = true;
    const assistId = chain.find(step => step.event === 'pass' && step.assist)?.player_id;
    for (const id of new Set([ev.player_id,assistId])) {
      if (id == null) continue;
      const player = contributors.get(id) || {total:0,critical:0,late:false};
      player.total++;
      if (critical) { player.critical++; if (ev.minute >= 80) player.late = true; }
      contributors.set(id,player);
    }
  }
  return {
    'team-move':move,
    'talisman':decisivePlayer || [...contributors.values()].some(p => p.critical >= 2 || (p.late && p.total >= 2)),
    'flashpoint-player':[...mistakes].some(([id,n]) => n >= 2 || contributors.has(id)),
    'var-spotlight':reviews.length > 0
  };
}

export function matchStyles(match, rating) {
  const home = club(match.home), away = club(match.away);
  const date = String(match.kickoff || '').slice(0,10);
  const sides = match.chanceSides, windows = match.chancesByWindow, shots = match.shotsByWindow;
  const complete = Array.isArray(shots) && shots.length === 6 && shots.every(count) && sum(shots) === match.xgCount &&
    Array.isArray(windows) && windows.length === 6 && windows.every((n,i) => count(n) && n <= shots[i]) &&
    Array.isArray(sides) && sides.length === 2 && sides.every(count) && sum(sides) === sum(windows);
  const evidence = match.shotEvidence || {};
  const flags = {
    ...match.incidentReasons,
    'contested-call':reviewedCalls.has(String(match.id)),
    'var-spotlight':!reviewedCalls.has(String(match.id)) && match.incidentReasons?.['var-spotlight'],
    'heavyweights':date >= '2026-07-01' && date < '2027-07-01' && home !== away && elite2026.has(home) && elite2026.has(away),
    'rivalry':rivals.some(([a,b]) => (a === home && b === away) || (a === away && b === home)),
    'end-to-end':complete && sum(shots) >= 24 && Math.min(...sides) >= 4 && evidence.contestedWindows >= 2,
    'keeper-show':match.difficultSaves >= 3,
    'late-drama':evidence.timeline?.lateCloseMinutes >= 12 && complete && windows[5] >= 3,
    'highlight-reel':Number.isFinite(rating) && rating < 8 && evidence.highlightSequence === true
  };
  const styleIds = Object.keys(styleLabels).filter(id => flags[id]);
  return {styleIds,styles:styleIds.map(id => styleLabels[id])};
}
