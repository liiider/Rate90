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

export function seedBackfill(db, ids) {
  const add = db.prepare("INSERT OR IGNORE INTO games(id,phase,due) VALUES (?,'backfill',0)");
  transaction(db,() => { for (const id of ids) add.run(id); });
}

function fixtureOf(event) {
  const kickoff = Date.parse(event.event_date);
  if (!Number.isSafeInteger(event.id) || !Number.isFinite(kickoff) || !LEAGUES.has(event.league?.id) ||
      !event.status || typeof event.home_team !== 'string' || typeof event.away_team !== 'string') {
    throw new Error('BSD 赛程缺少比赛 ID、开球时间、状态或球队');
  }
  const label = String(event.round_number ?? event.round ?? '').trim();
  const round = Number(label.match(/^(?:(?:round|matchday)\s+|(?:regular season|league phase)\s*-\s*)?(\d+)$/i)?.[1]);
  return {kickoff, league:event.league.id, home:event.home_team, away:event.away_team, status:event.status,
    round:Number.isInteger(round) && round > 0 ? round : null, replacedBy:event.replaced_by ?? null};
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
  if (reset || suspended) {
    const phase = suspended ? 'stopped' : fixture.status === 'finished' ? 'fetch' : 'check';
    const due = suspended ? null : Math.max(now, fixture.kickoff + firstCheck);
    db.prepare(`INSERT INTO games(id,fixture,phase,due) VALUES (?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET fixture=excluded.fixture, phase=excluded.phase, due=excluded.due,
        facts=NULL,first_at=NULL,fetched_at=NULL`).run(event.id,json,phase,due);
  } else {
    if (row.fixture !== json) db.prepare('UPDATE games SET fixture=? WHERE id=?').run(json,event.id);
    if (row.phase === 'check' && fixture.status === 'finished') {
      db.prepare("UPDATE games SET phase='fetch',due=? WHERE id=?").run(Math.max(now,fixture.kickoff+firstCheck),event.id);
    }
  }
}

const factKeys = ['id','league','event_date','home_team','away_team','home_score','away_score',
  'extra_time_score','penalty_shootout','shotmap','incidents','momentum'];

function saveDetail(db, event, row, now) {
  observe(db,event,now);
  if (event.status !== 'finished') {
    if (!stopped.has(event.status)) {
      db.prepare("UPDATE games SET phase='check',due=? WHERE id=?").run(Math.max(now+retry,Date.parse(event.event_date)+firstCheck),row.id);
    }
    return;
  }
  // A corrected kick-off can arrive in the detail response itself.
  if (now < Date.parse(event.event_date) + firstCheck) return;
  const facts = Object.fromEntries(factKeys.filter(key => key in event).map(key => [key,event[key]]));
  const valid = rateMatch(summarize(facts)).rating !== null;
  const current = db.prepare('SELECT * FROM games WHERE id=?').get(row.id);
  const keepOld = !valid && current.facts && rateMatch(summarize(JSON.parse(current.facts))).rating !== null;
  const first = current.first_at ?? now;
  let phase = 'done', due = null;
  if (!current.first_at && row.phase !== 'backfill') { phase = 'review'; due = first + review; }
  else if (!valid && row.phase !== 'last') { phase = 'last'; due = Math.max(now,first + DAY); }
  db.prepare('UPDATE games SET phase=?,due=?,facts=?,first_at=?,fetched_at=? WHERE id=?')
    .run(phase,due,keepOld ? current.facts : JSON.stringify(facts),first,keepOld ? current.fetched_at : now,row.id);
}

function calendarWindow(now) {
  const midnight = Math.floor((now + offset) / DAY) * DAY - offset;
  return {start:new Date(midnight-2*DAY),end:new Date(midnight+8*DAY),
    cycle:beijingDate(new Date(now-12*60*MINUTE))};
}

export async function tick(db, client, now = Date.now()) {
  const report = {calendars:0,statusBatches:0,details:0,errors:[]};
  const {start,end,cycle} = calendarWindow(now);
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
    if (!groups.has(key)) groups.set(key,{league:f.league,date,ids:[]});
    groups.get(key).ids.push(row.id);
  }
  for (const {league,date,ids} of groups.values()) {
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
            defer(db,id,Math.max(now+retry,Date.parse(event.event_date)+firstCheck));
          }
        } catch (error) { defer(db,id,now+retry); report.errors.push('状态 ' + id + ' ' + error.message); }
      }
    } catch (error) {
      for (const id of ids) defer(db,id,now+retry);
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
      if (row.phase === 'backfill' && error.status === 404) {
        db.prepare("UPDATE games SET phase='done',due=NULL WHERE id=?").run(row.id);
      } else defer(db,row.id,now+retry);
      report.errors.push('详情 ' + row.id + ' ' + error.message);
    }
  }
  return report;
}
