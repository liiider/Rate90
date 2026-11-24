import {createHash} from 'node:crypto';
import {beijingDate, LEAGUES} from './bsd.mjs';
import {hasExtraTime} from './style-stats.mjs';
import {isOwnGoal, validShotProbability} from './shot-profile.mjs';

export const DAY = 86400000;
export const codes = {1:'pl',3:'ll',4:'sa',5:'bl',6:'l1',7:'cl'};
const upcoming = new Set(['scheduled','upcoming','notstarted','not_started']);
const nameOf = value => typeof value === 'string' ? value : value?.name;
const positiveId = value => Number.isSafeInteger(value) && value > 0 ? value : null;

export function scheduleGame(e, league) {
  const home = nameOf(e.home_team), away = nameOf(e.away_team);
  const kickoff = Date.parse(e.event_date);
  if (!positiveId(e.id) || e.league?.id !== league || !home || !away || !Number.isFinite(kickoff)) return null;
  const stage = String(e.stage || e.round_name || (league === 7 ? 'league-phase' : 'regular-season'));
  const flat = /^(regular.season|league.phase|group.stage|(?:round|matchday)\s+\d+)$/i.test(stage);
  const round = flat ? e.round_number : (e.round_name || e.stage_name || stage);
  if (!round) return null;
  return {id:String(e.id), league:codes[league], season:e.season?.id ?? null, stage:flat ? 'league' : stage,
    round, home, away, homeId:positiveId(e.home_team_obj?.id ?? e.home_team?.id),
    awayId:positiveId(e.away_team_obj?.id ?? e.away_team?.id), kickoff, status:e.status,
    previousLegId:positiveId(e.previous_leg_event_id)};
}

// A round in progress (or an old round with a rearranged fixture) is already the current/past round.
export function nextRounds(games, now) {
  const groups = new Map();
  for (const game of games) {
    const key = JSON.stringify([game.league,game.season,game.stage,game.round]);
    if (!groups.has(key)) groups.set(key,[]);
    groups.get(key).push(game);
  }
  const candidates = [];
  for (const [key, group] of groups) {
    const ordered = group.filter(g => !['cancelled','canceled','unresolved'].includes(g.status)).sort((a,b)=>a.kickoff-b.kickoff);
    const pairs = new Map();
    for (const game of ordered) {
      const pair = JSON.stringify([game.home,game.away].sort());
      if (!pairs.has(pair)) pairs.set(pair,[]);
      pairs.get(pair).push(game);
    }
    const twoLegs = ordered[0]?.stage !== 'league' && [...pairs.values()].some(p=>p.length===2);
    const legs = twoLegs ? [[],[]] : [[]];
    for (const pair of pairs.values()) for (const [index,game] of pair.entries()) {
      legs[twoLegs && (game.previousLegId || index>0) ? 1 : 0].push(game);
    }
    for (const [index,leg] of legs.entries()) {
      if (!leg.length || leg.some(g=>g.status==='finished' || (g.kickoff<=now && g.status!=='postponed'))) continue;
      const future = leg.filter(g=>g.kickoff>now && upcoming.has(g.status)).sort((a,b)=>a.kickoff-b.kickoff || a.id.localeCompare(b.id));
      if (future.length) candidates.push({key:key+'/'+index, round:future[0].round,leg:twoLegs ? index+1 : null,
        league:future[0].league, games:future});
    }
  }
  const counts = new Map();
  return candidates.sort((a,b)=>a.games[0].kickoff-b.games[0].kickoff).filter(group=>{
    const n=counts.get(group.league)||0; counts.set(group.league,n+1);return n<2;
  });
}

export function initPrematch(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS preview_sources (key TEXT PRIMARY KEY, observed INTEGER NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS preview_predictions (scope TEXT NOT NULL, fingerprint TEXT NOT NULL, created INTEGER NOT NULL,
      model TEXT NOT NULL, context TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY(scope,fingerprint));`);
}

export function matchForm(raw) {
  if (!Array.isArray(raw?.shotmap) || !raw.shotmap.length) return null;
  const extra = hasExtraTime(raw);
  const teams=[0,1].map(()=>({shots:0,npxg:0,chances:[0,0,0,0,0,0]}));
  for (const s of raw.shotmap) {
    if (!s) return null;
    if ([3,4,5].includes(s.period) || /shoot.?out/i.test(s.sit||'') || isOwnGoal(s)) continue;
    if (typeof s.home!=='boolean' || !Number.isInteger(s.min) || s.min<0 || !validShotProbability(s.xg) ||
       (extra && s.period==null && s.min>90)) return null;
    const side=teams[Number(!s.home)];
    const minute=s.period===1 ? Math.min(45,s.min) : s.period===2 ? Math.max(46,s.min) : s.min;
    side.shots++;
    if (s.sit!=='penalty' && s.gtype!=='penalty') side.npxg+=s.xg;
    if (s.type==='goal' || s.type==='post' || s.xg>=0.15 || (validShotProbability(s.xgot) && s.xgot>=0.35)) {
      side.chances[Math.min(5,Math.floor(Math.max(0,minute-1)/15))]++;
    }
  }
  for (const side of teams) side.npxg=Number(side.npxg.toFixed(2));
  return teams;
}

export function teamHistory(db, now) {
  const teams = new Map();
  const rows = db.prepare(`SELECT fixture,facts FROM games WHERE json_extract(fixture,'$.status')='finished'
    AND json_extract(fixture,'$.kickoff') < ? AND first_at <= ? AND facts IS NOT NULL
    ORDER BY json_extract(fixture,'$.kickoff') DESC,id DESC`).iterate(now,now);
  for (const row of rows) {
    const f=JSON.parse(row.fixture);
    const names=[f.home,f.away];
    const keys=names.map(name=>codes[f.league]+'/'+name);
    if (keys.every(k=>teams.get(k)?.length>=6)) continue;
    const stats=matchForm(JSON.parse(row.facts));
    for (let s=0;s<2;s++) {
      if (!teams.has(keys[s])) teams.set(keys[s],[]);
      const history=teams.get(keys[s]);
      if (history.length<6) history.push({date:beijingDate(new Date(f.kickoff)),opponent:names[1-s],
        venue:s===0?'home':'away',for:stats?.[s]??null,against:stats?.[1-s]??null});
    }
  }
  return teams;
}

export function tableRows(table) {
  return (Array.isArray(table?.standings) ? table.standings : []).map(r=>({
    id:r.team_id,team:r.team_name,position:r.position,points:r.pts??r.points,played:r.played,zone:r.zone?.type??null
  })).filter(r=>Number.isFinite(r.points));
}

export function standingContext(rows, name,id) {
  const team=rows.find(r=>(id && r.id===id) || r.team===name);
  if (!team) return null;
  const top=rows.find(r=>r.position===1);
  const relegation=rows.filter(r=>r.zone==='relegation').sort((a,b)=>a.position-b.position)[0];
  return {...team,pointsBehindLeader:top ? top.points-team.points : null,
    pointsAboveFirstRelegationPlace:relegation ? team.points-relegation.points : null};
}

export const signature = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const scopesFor = (rounds,extra=[]) => {
  const scopes=new Map(),days=new Map();
  for (const round of rounds) {
    scopes.set('round/'+round.key,round.games);
    for (const game of round.games) {
      const day=beijingDate(new Date(game.kickoff));
      if (!days.has(day)) days.set(day,[]);
      days.get(day).push(game);
    }
  }
  for (const game of extra) {
    const date=beijingDate(new Date(game.kickoff));
    if (!days.has(date)) days.set(date,[]);
    days.get(date).push(game);
  }
  for (const [day,games] of days) scopes.set('date/'+day,games);
  return scopes;
};
