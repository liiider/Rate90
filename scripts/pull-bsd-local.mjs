import {createHash} from 'node:crypto';
import {mkdir, readFile, readdir} from 'node:fs/promises';
import {dirname} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {setTimeout as pause} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import {createBsdClient, LEAGUES} from '../server/bsd.mjs';
import {DAY, nextRounds, scheduleGame} from '../server/prematch.mjs';

const database = process.env.RATE90_BSD_ARCHIVE || fileURLToPath(new URL('../data/collector/bsd-raw.sqlite',import.meta.url));
const incremental = process.argv.includes('--incremental');
await mkdir(dirname(database),{recursive:true});
const db = new DatabaseSync(database);
db.exec(`PRAGMA busy_timeout=5000;
  CREATE TABLE IF NOT EXISTS bodies(hash TEXT PRIMARY KEY, json TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS captures(path TEXT NOT NULL, observed_at INTEGER NOT NULL, hash TEXT NOT NULL,
    PRIMARY KEY(path,observed_at));
  CREATE TABLE IF NOT EXISTS throttle(id INTEGER PRIMARY KEY, until_ms INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS archive_meta(key TEXT PRIMARY KEY, value INTEGER NOT NULL);`);
const insertBody = db.prepare('INSERT OR IGNORE INTO bodies VALUES (?,?)');
const insertCapture = db.prepare('INSERT OR IGNORE INTO captures VALUES (?,?,?)');
const latest = db.prepare('SELECT observed_at,json FROM captures JOIN bodies USING(hash) WHERE path=? ORDER BY observed_at DESC LIMIT 1');
const key = process.env.BSD_API_TOKEN;
const origin = 'https://sports.bzzoiro.com';
let downloaded = 0;

function save(path,observed,text) {
  const hash = createHash('sha256').update(text).digest('hex');
  db.exec('BEGIN IMMEDIATE');
  try {
    insertBody.run(hash,text);
    insertCapture.run(path,observed,hash);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

async function seed() {
  const samples = new URL('../data/round-tests/',import.meta.url);
  let folders;
  try { folders = await readdir(samples,{withFileTypes:true}); }
  catch (e) { if (e.code==='ENOENT') return; throw e; }
  for (const folder of folders.filter(f=>f.isDirectory())) {
    const dir = new URL(encodeURIComponent(folder.name)+'/',samples);
    let manifest;
    try { manifest = JSON.parse(await readFile(new URL('manifest.json',dir),'utf8')); }
    catch (e) { if (e.code==='ENOENT') continue; throw e; }
    if (manifest.source!=='BSD /api/events/{id}/?full=true') continue;
    for (const m of manifest.matches) {
      const at = Date.parse(m.fetchedAt);
      if (!Number.isSafeInteger(m.eventId) || m.file!=='events/'+m.eventId+'.json' || !Number.isFinite(at)) continue;
      const raw = await readFile(new URL(m.file,dir),'utf8');
      if (JSON.parse(raw).id!==m.eventId) throw Error('归档比赛 ID 不符 '+m.eventId);
      save('/api/events/'+m.eventId+'/?full=true',at,raw);
    }
  }
}

const finishedIds = new Set();
const historical = new Map();
async function archivedFetch(url,init) {
  if (url.origin!==origin) throw Error('无效的 BSD 来源');
  const path = url.pathname+url.search;
  const hit = latest.get(path);
  const id = url.pathname.match(/^\/api\/(?:v2\/)?events\/(\d+)\//)?.[1];
  // Reread changing prematch facts; old finished matches can be reused across interrupted backfills.
  const kickoff = historical.get(Number(id));
  const settled = incremental && hit && kickoff && hit.observed_at >= kickoff + DAY;
  const ttl = settled ? Infinity : kickoff ? 7*DAY : 3600000;
  if (hit && Date.now()-hit.observed_at<ttl) {
    const staleStatus = finishedIds.has(Number(id)) && url.searchParams.get('full')==='true' && JSON.parse(hit.json).status!=='finished';
    if (!staleStatus) return new Response(hit.json);
  }
  const until = db.prepare('SELECT until_ms FROM throttle WHERE id=1').get()?.until_ms;
  if (until>Date.now()) return new Response(null,{status:429,headers:{'retry-after':String(Math.ceil((until-Date.now())/1000))}});
  await pause(300);
  const response = await fetch(url,init);
  if (response.status===429) {
    const header = response.headers.get('retry-after');
    const next = /^\d+$/.test(header ?? '') ? Date.now()+Number(header)*1000 : Date.parse(header);
    db.prepare('INSERT OR REPLACE INTO throttle VALUES (1,?)').run(Math.max(Date.now()+900000,Number.isFinite(next)?next:0));
  }
  if (!response.ok) return response;
  const text = await response.text();
  JSON.parse(text);
  save(path,Date.now(),text);
  if (++downloaded%50===0) console.log('本次已拉取 '+downloaded+' 份 BSD 响应');
  return new Response(text);
}

async function resource(id,name) {
  const url = new URL('/api/v2/events/'+id+'/'+name+'/',origin);
  const response = await archivedFetch(url,{headers:{Authorization:'Token '+key,Accept:'application/json'},
    redirect:'error',signal:AbortSignal.timeout(20000)});
  if (response.status===404) return null;
  if (!response.ok) throw Error('BSD HTTP '+response.status+' '+url.pathname);
  return response.json();
}

async function collect(since) {
  const client = createBsdClient(key,archivedFetch);
  const now = Date.now(), upcoming = [], finished = [], teams = new Set();
  for (const league of LEAGUES.keys()) {
    const season = await client.season(league);
    const rows = [];
    if (incremental) {
      const end = Math.floor(now/DAY)*DAY + 22*DAY;
      for (let from=Math.floor(since/DAY)*DAY-2*DAY; from<end; from+=14*DAY) {
        rows.push(...await client.list(league,new Date(from),new Date(Math.min(from+14*DAY,end))));
      }
    } else {
      rows.push(...await client.seasonFixtures(league,season.id));
    }
    const games = rows.filter(r=>(incremental || r.season?.id===season.id) && !r.replaced_by);
    if (!incremental && !games.length) throw Error('BSD 赛季赛程为空 '+league);
    await client.standings(league,season.id);
    const rounds = nextRounds(games.map(g=>scheduleGame(g,league)).filter(Boolean),now);
    const ids = new Set(rounds.flatMap(r=>r.games.map(g=>Number(g.id))));
    for (const g of games) {
      const kickoff = Date.parse(g.event_date);
      if (g.status==='finished') {
        finished.push(g);
        finishedIds.add(g.id);
        if (kickoff < now-2*DAY) historical.set(g.id,kickoff);
      } else if (ids.has(g.id) || (kickoff>now && kickoff<=now+7*DAY &&
        ['upcoming','notstarted','scheduled','not_started'].includes(g.status))) upcoming.push(g);
    }
  }
  let last = now;
  for (const g of upcoming.sort((a,b)=>Date.parse(a.event_date)-Date.parse(b.event_date))) {
    const d = await client.event(g.id,true);
    for (const team of [d.home_team_obj?.id,d.away_team_obj?.id]) if (Number.isSafeInteger(team)) teams.add(team);
    last = Math.max(last,Date.parse(g.event_date));
    await client.legInfo(g.id);
    await resource(g.id,'lineups');
  }
  const day = value=>new Date(value).toISOString().slice(0,10);
  for (const team of teams) await client.teamFixtures(team,day(now-35*DAY),day(last+8*DAY));
  for (const g of finished.sort((a,b)=>Date.parse(b.event_date)-Date.parse(a.event_date))) {
    const event = await client.event(g.id,true);
    const availability = await resource(g.id,'availability');
    if (availability?.available?.player_stats) await resource(g.id,'player-stats');
    if (event.lineups && availability?.available?.heatmaps!==false) await resource(g.id,'heatmaps');
  }
  console.log('本轮覆盖已完赛 '+finished.length+' 场，近期对阵 '+upcoming.length+' 场。');
}

try {
  const started = Date.now();
  const checkpoint = db.prepare("INSERT OR REPLACE INTO archive_meta VALUES ('last_success',?)");
  let since;
  if (incremental) {
    since = db.prepare("SELECT value FROM archive_meta WHERE key='last_success'").get()?.value;
    if (!since) throw Error('增量采集缺少全量基线，请先导入全量归档');
  } else await seed();
  await collect(since);
  checkpoint.run(started);
} catch (e) {
  console.error(e.message, e.cause?.code || '');
  process.exitCode = 1;
} finally {
  const {n} = db.prepare('SELECT count(*) AS n FROM captures').get();
  console.log('本次下载 '+downloaded+' 份，原始响应归档共 '+n+' 条。');
  db.close();
}
