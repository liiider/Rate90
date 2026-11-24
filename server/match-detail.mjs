const statKeys = ['shots','shotsOnTarget','xg','possession','crosses','tackles','distanceKm'];
const cardTypes = new Set(['yellow','yellowRed','red']);
const text = value => typeof value === 'string' && value.trim() ? value.trim() : null;
const number = value => Number.isFinite(value) ? value : null;
const count = value => Number.isSafeInteger(value) && value >= 0;

function players(list) {
  if (!Array.isArray(list)) return [];
  return list.filter(player => text(player?.name)).map(player => {
    const shirt = player.jersey_number ?? player.number;
    return {name:player.name.trim(),number:text(shirt) ?? (count(shirt) ? String(shirt) : null),
      position:text(player.specific_position) ?? text(player.position),captain:player.captain === true};
  });
}

function lineupSide(side,coach) {
  return {formation:text(side?.formation),coach:text(coach),
    players:players(side?.players),substitutes:players(side?.substitutes)};
}

function matchStats(fields) {
  return Object.fromEntries(statKeys.map(key => [key,{
    home:number(fields?.[key]?.[0] ?? fields?.[key]?.home),
    away:number(fields?.[key]?.[1] ?? fields?.[key]?.away)
  }]));
}

// A partial trace is still drawable. A missing or conflicting minute has no bar.
function pressureSeries(trace) {
  if (!Array.isArray(trace)) return null;
  const minutes = new Map();
  for (const point of trace) {
    if (!Number.isInteger(point?.m) || point.m < 1 || point.m > 90 || !Number.isFinite(point.v)) continue;
    if (minutes.has(point.m) && minutes.get(point.m) !== point.v) minutes.set(point.m,null);
    else minutes.set(point.m,point.v);
  }
  return [...minutes.values()].some(Number.isFinite)
    ? Array.from({length:90},(_,i) => minutes.get(i+1) ?? null) : null;
}

function matchEvents(incidents,extraTime = false) {
  if (!Array.isArray(incidents)) return null;
  const events = [];
  for (const e of incidents) {
    if (!e || !count(e.minute)) continue;
    if (e.period != null && e.period !== 1 && e.period !== 2) continue;
    if (e.period == null && e.minute > 90 && extraTime) continue;
    const side = typeof e.is_home === 'boolean' ? (e.is_home ? 'home' : 'away') : e.side;
    if (side !== 'home' && side !== 'away') continue;
    const added = e.added_time ?? e.addedTime;
    const clock = {side,minute:e.minute,addedTime:count(added) ? added : null};
    const playerIn = text(e.player_in ?? e.playerIn), playerOut = text(e.player_out ?? e.playerOut);
    const card = e.card_type ?? e.card;
    if (e.type === 'substitution' && playerIn && playerOut) {
      events.push({type:'substitution',...clock,playerIn,playerOut});
    } else if (e.type === 'card' && cardTypes.has(card) && text(e.player)) {
      events.push({type:'card',...clock,card,player:e.player.trim()});
    }
  }
  return events.sort((a,b) => a.minute-b.minute || (a.addedTime ?? 0)-(b.addedTime ?? 0));
}

export function projectMatchDetail(raw, stats, pressure, extraTime) {
  const lineups = raw.lineups;
  return {
    lineups:lineups?.confirmed === true ? {
      home:lineupSide(lineups.home,raw.home_coach?.name),away:lineupSide(lineups.away,raw.away_coach?.name)
    } : null,
    stats:matchStats(stats),pressure:pressure ?? pressureSeries(raw.momentum),
    events:matchEvents(raw.incidents,extraTime)
  };
}

// Re-project per-day files too: hosts may serve a pre-upgrade snapshot while their queue backfills.
export function storedMatchDetail(detail, legacyPressure) {
  const lineups = detail?.lineups, trace = detail?.pressure ?? legacyPressure;
  return {
    lineups:lineups && lineups.confirmed !== false ? {
      home:lineupSide(lineups.home,lineups.home?.coach),away:lineupSide(lineups.away,lineups.away?.coach)
    } : null,
    stats:matchStats(detail?.stats),
    pressure:Array.isArray(trace) && trace.length === 90 && trace.some(Number.isFinite) ? trace.map(number) : null,
    events:matchEvents(detail?.events)
  };
}

export function publicMatchDetail(match) {
  // The twelve archived summaries predate the tactical feed and have no side-by-side values.
  return match.matchDetail ?? {
    lineups:null,stats:matchStats(null),pressure:match.pressureMinutes ?? null,events:null
  };
}
