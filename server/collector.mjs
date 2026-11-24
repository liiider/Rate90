import {DatabaseSync} from 'node:sqlite';
import {beijingDate, dayBounds, LEAGUES, summarize} from './bsd.mjs';
import {rateMatch} from './recommend.mjs';

export const MINUTE = 60_000, DAY = 1440 * MINUTE;
const firstCheck = 125 * MINUTE, retry = 15 * MINUTE, review = 360 * MINUTE;
const stopped = new Set(['postponed','cancelled','canceled','abandoned','suspended','unresolved','awarded','walkover']);
const offset = 8 * 60 * MINUTE;

export function openQueue(filename) {
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS games (
      id INTEGER PRIMARY KEY, fixture TEXT, phase TEXT NOT NULL, due INTEGER,
      facts TEXT, first_at INTEGER, fetched_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS due_jobs ON games(phase,due);
    CREATE TABLE IF NOT EXISTS calendar_days (day TEXT, league INTEGER, PRIMARY KEY(day,league));
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TRIGGER IF NOT EXISTS fixture_added AFTER INSERT ON games WHEN NEW.fixture IS NOT NULL BEGIN
      INSERT INTO meta VALUES ('revision',1) ON CONFLICT(key) DO UPDATE SET value=value+1;
    END;
    CREATE TRIGGER IF NOT EXISTS fixture_changed AFTER UPDATE OF fixture,facts,fetched_at,phase ON games
      WHEN OLD.fixture IS NOT NEW.fixture OR OLD.facts IS NOT NEW.facts OR OLD.fetched_at IS NOT NEW.fetched_at
        OR ((OLD.phase='done') != (NEW.phase='done') AND NEW.fixture IS NOT NULL)
    BEGIN
      INSERT INTO meta VALUES ('revision',1) ON CONFLICT(key) DO UPDATE SET value=value+1;
    END;
  `);
  if (!db.prepare('PRAGMA table_info(games)').all().some(c => c.name === 'observed_at')) {
    transaction(db, () => {
      db.exec(`ALTER TABLE games ADD COLUMN observed_at INTEGER;
        UPDATE games SET observed_at=json_extract(fixture,'$.observedAt'), fixture=json_remove(fixture,'$.observedAt')
        WHERE json_type(fixture,'$.observedAt') IS NOT NULL`);
    });
  }
  if (!db.prepare('PRAGMA table_info(games)').all().some(c => c.name === 'styles_at')) {
    db.exec('ALTER TABLE games ADD COLUMN styles_at INTEGER');
  }
  if (getMeta(db,'migration:opening-lineups') !== '1') {
    transaction(db,() => {
      // Existing scores stay available while the bounded history queue fetches the added fields.
      db.exec(`UPDATE games SET phase='backfill',due=0
        WHERE phase='done' AND facts IS NOT NULL AND json_type(facts,'$.lineups') IS NULL`);
      setMeta(db,'migration:opening-lineups',1);
    });
  }
  return db;
}

export const getMeta = (db, key) => db.prepare('SELECT value FROM meta WHERE key=?').get(key)?.value;
export const setMeta = (db, key, value) => db.prepare('INSERT OR REPLACE INTO meta VALUES (?,?)').run(key, String(value));
const defer = (db, id, due) => db.prepare('UPDATE games SET due=? WHERE id=?').run(due,id);

function transaction(db, work) {
  db.exec('BEGIN IMMEDIATE');
  try { work(); db.exec('COMMIT'); }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}

export function seedBackfill(db, ids, publishedIds = []) {
  const add = db.prepare("INSERT OR IGNORE INTO games(id,phase,due) VALUES (?,'backfill',0)");
  const removePlaceholder = db.prepare("DELETE FROM games WHERE id=? AND phase='backfill' AND fixture IS NULL AND facts IS NULL");
  transaction(db,() => {
    for (const id of ids) add.run(id);
    for (const id of publishedIds) removePlaceholder.run(id);
  });
}

function fixtureOf(event) {
  const kickoff = Date.parse(event.event_date);
  if (!Number.isSafeInteger(event.id) || !Number.isFinite(kickoff) || !LEAGUES.has(event.league?.id) ||
      !event.status || typeof event.home_team !== 'string' || typeof event.away_team !== 'string') {
    throw new Error('BSD 赛程缺少比赛 ID、开球时间、状态或球队');
  }
  const numericRound = /^(?:(?:round|matchday)\s+|(?:regular season|league phase)\s*-\s*)?(\d+)$/i;
  const stage = String(event.round_name || event.round || '').trim();
  const label = stage && !numericRound.test(stage) ? stage : String(event.round_number ?? event.round ?? '').trim();
  const digits = numericRound.exec(label);
  const round = digits ? Number(digits[1]) : label;
  return {kickoff, league:event.league.id, home:event.home_team, away:event.away_team, status:event.status,
    round:round || null, replacedBy:event.replaced_by ?? null};
}

function observe(db, event, now) {
  const fixture = fixtureOf(event);
  const row = db.prepare('SELECT fixture,phase FROM games WHERE id=?').get(event.id);
  const old = row?.fixture && JSON.parse(row.fixture);
  if (old && !fixture.round) fixture.round = old.round;
  const changedTime = old && old.kickoff !== fixture.kickoff;
  const suspended = stopped.has(fixture.status);
  const reset = !old || changedTime || (row.phase === 'stopped' && !suspended) ||
    (old.status === 'finished' && fixture.status !== 'finished');
  const json = JSON.stringify(fixture);
  if (changedTime && old.status === 'finished' && fixture.status === 'finished' && !fixture.replacedBy &&
      old.home === fixture.home && old.away === fixture.away && old.league === fixture.league) {
    db.prepare("UPDATE games SET fixture=?,observed_at=?,phase='fetch',due=? WHERE id=?")
      .run(json,now,Math.max(now,fixture.kickoff+firstCheck),event.id);
    return;
  }
  if (reset || (suspended && row.phase !== 'stopped')) {
    const phase = suspended ? 'stopped' : fixture.status === 'finished' ? 'fetch' : 'check';
    const due = suspended ? null : Math.max(now, fixture.kickoff + firstCheck);
    db.prepare(`INSERT INTO games(id,fixture,observed_at,phase,due) VALUES (?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET fixture=excluded.fixture, observed_at=excluded.observed_at, phase=excluded.phase, due=excluded.due,
        facts=NULL,first_at=NULL,fetched_at=NULL,styles_at=NULL`).run(event.id,json,now,phase,due);
  } else {
    if (row.fixture !== json) db.prepare('UPDATE games SET fixture=?,observed_at=? WHERE id=?').run(json,now,event.id);
    else db.prepare('UPDATE games SET observed_at=? WHERE id=? AND observed_at IS NOT ?').run(now,event.id,now);
    if (row.phase === 'check' && fixture.status === 'finished') {
      db.prepare("UPDATE games SET phase='fetch',due=? WHERE id=?").run(Math.max(now,fixture.kickoff+firstCheck),event.id);
    }
  }
}

const detailKeys = ['lineups','home_coach','away_coach','live_stats'];
const factKeys = ['id','league','event_date','home_team','away_team','home_score','away_score','period',
  'extra_time_score','penalty_shootout','shotmap','incidents','momentum',...detailKeys];

function mergeKnown(previous,next) {
  if (next == null || next === '') return previous ?? next;
  if (!previous || typeof previous !== 'object' || typeof next !== 'object' ||
      Array.isArray(previous) || Array.isArray(next)) return next;
  return {...previous,...Object.fromEntries(Object.entries(next).map(([key,value]) =>
    [key,mergeKnown(previous[key],value)]))};
}

function samePlayer(a,b) {
  if (!a || !b) return false;
  if (a.player_id != null && b.player_id != null) return a.player_id === b.player_id;
  if (a.api_id != null && b.api_id != null) return a.api_id === b.api_id;
  return !!a.name && a.name === b.name;
}

function mergeRoster(previous,next,starters) {
  if (!Array.isArray(previous) || !previous.length) return Array.isArray(next) ? next : previous;
  if (!Array.isArray(next) || !next.length) return previous;
  if (starters && next.length < 11) {
    // A fragment cannot say which member of a complete starting XI was replaced.
    const known = previous.map(p => mergeKnown(p,next.find(q => samePlayer(p,q))));
    return [...known,...next.filter(p => !previous.some(q => samePlayer(p,q)))].slice(0,11);
  }
  return next.map(p => mergeKnown(previous.find(q => samePlayer(p,q)),p));
}

function mergeLineups(previous,next) {
  if (next?.confirmed !== true) return previous?.confirmed === true ? previous : next ?? previous;
  if (previous?.confirmed !== true) return next;
  const lineups = mergeKnown(previous,next);
  for (const side of ['home','away']) {
    if (!previous[side] || !next[side]) continue;
    lineups[side].players = mergeRoster(previous[side].players,next[side].players,true);
    lineups[side].substitutes = mergeRoster(previous[side].substitutes,next[side].substitutes,false);
  }
  return lineups;
}

function nextCheck(kickoff, now) {
  return Math.max(kickoff + firstCheck, now + (now - kickoff >= 2 * DAY ? DAY : retry));
}

function saveDetail(db, event, row, now) {
  observe(db,event,now);
  if (event.status !== 'finished') {
    if (!stopped.has(event.status)) {
      db.prepare("UPDATE games SET phase='check',due=? WHERE id=?").run(nextCheck(Date.parse(event.event_date),now),row.id);
    }
    return;
  }
  // A corrected kick-off can arrive in the detail response itself.
  if (now < Date.parse(event.event_date) + firstCheck) return;
  const facts = Object.fromEntries(factKeys.filter(key => key in event).map(key => [key,event[key]]));
  const current = db.prepare('SELECT * FROM games WHERE id=?').get(row.id);
  const previous = current.facts && JSON.parse(current.facts);
  const summary = summarize(facts);
  const valid = rateMatch(summary).rating !== null;
  const stylesAt = summary.styleStats || summary.shotEvidence ? now : current.styles_at;
  const keepOld = !valid && previous && rateMatch(summarize(previous)).rating !== null;
  const saved = keepOld ? {...previous} : {...facts};
  if (previous) {
    for (const key of detailKeys) {
      if (key in facts || key in previous) {
        saved[key] = key === 'lineups' ? mergeLineups(previous[key],facts[key]) : mergeKnown(previous[key],facts[key]);
      }
    }
  }
  const serialized = JSON.stringify(saved);
  const first = current.first_at ?? now;
  let phase = 'done', due = null;
  if (!current.first_at && row.phase !== 'backfill') { phase = 'review'; due = first + review; }
  else if (!valid && row.phase !== 'last') { phase = 'last'; due = Math.max(now,first + DAY); }
  db.prepare('UPDATE games SET phase=?,due=?,facts=?,first_at=?,fetched_at=?,styles_at=? WHERE id=?')
    .run(phase,due,serialized,first,keepOld ? current.fetched_at : now,stylesAt,row.id);
}

function calendarWindow(now) {
  const midnight = Math.floor((now + offset) / DAY) * DAY - offset;
  return {start:new Date(midnight-2*DAY),end:new Date(midnight+8*DAY),
    cycle:beijingDate(new Date(now-12*60*MINUTE))};
}

export async function tick(db, client, now = Date.now()) {
  const report = {calendars:0,statusBatches:0,details:0,errors:[]};
  const {start,end,cycle} = calendarWindow(now);
  if (Number(getMeta(db,'bsd:retryAt')) > now) return report;
  function pauseOnRateLimit(error) {
    if (error.status !== 429) return false;
    setMeta(db,'bsd:retryAt',now+Math.max(retry,error.retryAfterMs ?? 0));
    report.errors.push(error.message);
    return true;
  }
  const seen = new Map();
  const unavailable = new Set();
  for (const league of LEAGUES.keys()) {
    const key = 'calendar:' + league;
    if (getMeta(db,key) === cycle) continue;
    if (Number(getMeta(db,key+':retry')) > now) { unavailable.add(league); continue; }
    try {
      const events = await client.list(league,start,end);
      transaction(db,() => {
        for (const event of events) observe(db,event,now);
        setMeta(db,key,cycle);
        setMeta(db,key+':at',now);
        setMeta(db,key+':retry',0);
        const cover = db.prepare('INSERT OR IGNORE INTO calendar_days VALUES (?,?)');
        for (let at = +start; at <= +end; at += DAY) {
          const day = beijingDate(new Date(at)), [from,to] = dayBounds(day);
          if (+from >= +start && +to <= +end) cover.run(day,league);
        }
      });
      for (const event of events) seen.set(event.id,event);
      report.calendars++;
    } catch (error) {
      if (pauseOnRateLimit(error)) return report;
      setMeta(db,key+':retry',now+retry);
      unavailable.add(league);
      report.errors.push('赛程 ' + league + ' ' + error.message);
    }
  }

  const groups = new Map();
  for (const row of db.prepare("SELECT id,fixture FROM games WHERE phase='check' AND due<=?").all(now)) {
    const f = JSON.parse(row.fixture);
    const date = new Date(f.kickoff).toISOString().slice(0,10);
    const key = f.league + '/' + date;
    if (!groups.has(key)) groups.set(key,{league:f.league,date,kickoffs:new Map()});
    groups.get(key).kickoffs.set(row.id,f.kickoff);
  }
  for (const {league,date,kickoffs} of groups.values()) {
    const ids = [...kickoffs.keys()];
    try {
      if (ids.some(id => !seen.has(id))) {
        const from = new Date(date+'T00:00:00Z');
        const rows = await client.list(league,from,new Date(+from+DAY));
        for (const item of rows) seen.set(item.id,item);
        report.statusBatches++;
      }
      for (const id of ids) {
        // A missing listing may have moved to another day. The ID lookup follows that fixture.
        try {
          const event = seen.get(id) ?? await client.event(id);
          observe(db,event,now);
          if (!stopped.has(event.status) && event.status !== 'finished') {
            defer(db,id,nextCheck(Date.parse(event.event_date),now));
          }
        } catch (error) {
          if (pauseOnRateLimit(error)) return report;
          defer(db,id,nextCheck(kickoffs.get(id),now));
          report.errors.push('状态 ' + id + ' ' + error.message);
        }
      }
    } catch (error) {
      if (pauseOnRateLimit(error)) return report;
      for (const id of ids) defer(db,id,nextCheck(kickoffs.get(id),now));
      report.errors.push('状态 ' + league + ' ' + error.message);
    }
  }
  const due = db.prepare("SELECT * FROM games WHERE phase IN ('fetch','review','last') AND due<=? ORDER BY due,id").all(now);
  // Drain the historical snapshot in small batches behind current matches.
  if (unavailable.size !== LEAGUES.size) {
    due.push(...db.prepare("SELECT * FROM games WHERE phase='backfill' AND due<=? ORDER BY due,id LIMIT 8").all(now));
  }
  for (const row of due) {
    try {
      const event = await client.event(row.id,true);
      transaction(db,() => saveDetail(db,event,row,now));
      report.details++;
    }
    catch (error) {
      if (pauseOnRateLimit(error)) return report;
      if (row.phase === 'backfill' && error.status === 404) {
        db.prepare("UPDATE games SET phase='done',due=NULL WHERE id=?").run(row.id);
      } else defer(db,row.id,now+retry);
      report.errors.push('详情 ' + row.id + ' ' + error.message);
    }
  }
  return report;
}

// Completed fortnight windows and individual details survive an interrupted season import.
export async function collectSeason(db, client, {now = Date.now(), progress = () => {}} = {}) {
  const today = beijingDate(new Date(now));
  const year = Number(today.slice(0,4)) - Number(today.slice(5,7) < '07');
  const start = Date.parse(year + '-07-01T00:00:00+08:00');
  const end = Date.parse(today + 'T00:00:00+08:00') + DAY;
  const report = {season:year, through:today, calendars:0, details:0, errors:[]};
  const blockedUntil = Number(getMeta(db,'bsd:retryAt'));
  if (blockedUntil > now) {
    report.errors.push('BSD 限流至 ' + new Date(blockedUntil).toISOString());
    return report;
  }
  const coverage = db.prepare('INSERT OR IGNORE INTO calendar_days VALUES (?,?)');
  const observeDay = at => beijingDate(new Date(at));
  try {
    for (let from = start; from < end; from += 14 * DAY) {
      const to = Math.min(from + 14 * DAY,end);
      for (const league of LEAGUES.keys()) {
        const key = ['season',year,league,observeDay(from),observeDay(to)].join(':');
        if (to < end - 2 * DAY && getMeta(db,key)) continue;
        const events = await client.list(league,new Date(from),new Date(to));
        transaction(db,() => {
          for (const event of events) {
            if (event.season?.year == null || Number(event.season.year) === year) observe(db,event,now);
          }
          for (let at = from; at < to; at += DAY) {
            const day = observeDay(at), [a,b] = dayBounds(day);
            if (+a >= start && +b <= to) coverage.run(day,league);
          }
          if (to < end - 2 * DAY) setMeta(db,key,1);
        });
        report.calendars++;
      }
      progress('赛程已查到 ' + observeDay(to-1));
    }
    const jobs = db.prepare(`SELECT * FROM games WHERE json_extract(fixture,'$.kickoff') BETWEEN ? AND ?
      AND json_extract(fixture,'$.status')='finished' AND (facts IS NULL OR phase='backfill') ORDER BY id`).all(start,now);
    for (const row of jobs) {
      try {
        const event = await client.event(row.id,true);
        transaction(db,() => saveDetail(db,event,{...row,phase:now-Date.parse(event.event_date)>DAY ? 'backfill' : row.phase},now));
        report.details++;
        if (report.details % 25 === 0) progress('已采集比赛详情 ' + report.details + ' / ' + jobs.length);
      } catch (error) {
        if (error.status !== 404) throw error;
        report.errors.push('详情 ' + row.id + ' ' + error.message);
      }
    }
  } catch (error) {
    if (error.status === 429) setMeta(db,'bsd:retryAt',Date.now()+Math.max(retry,error.retryAfterMs ?? 0));
    report.errors.push(error.message);
  }
  return report;
}
