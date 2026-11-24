import {createHash, randomUUID} from 'node:crypto';
import {access, mkdir, readFile, rename, rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {beijingDate, LEAGUES, summarize} from './bsd.mjs';
import {getMeta} from './collector.mjs';
import {assetDirectory, prefix, readAsset} from './collected-feed.mjs';
import {formatFeed, rateMatch, ruleVersion} from './recommend.mjs';

const codes = {1:'pl',3:'ll',4:'sa',5:'bl',6:'l1',7:'cl'};
const viewDay = time => beijingDate(new Date(time + 12 * 3600000));
const teamKey = name => name.normalize('NFKC').trim().toLowerCase();
const sampleFile = new URL('../data/bsd-sample.json',import.meta.url);

export async function loadBaseline(dir = assetDirectory) {
  const [fixtures,teams,sample] = await Promise.all([readAsset(dir,'fixtures'),readAsset(dir,'teams'),
    readFile(sampleFile,'utf8').then(JSON.parse)]);
  const existing = new Set(sample.matches.map(m => m.id));
  const backfill = fixtures.filter(f => f.rating !== null && /^\d+$/.test(f.id) && !existing.has(f.id)).map(f => Number(f.id));
  return {fixtures,teams,sample,backfill};
}

async function atomicAsset(dir,name,data,immutable = false) {
  const path = join(dir,name+'.js'), text = prefix + JSON.stringify(data) + ';\n';
  try {
    if (immutable) { await access(path); return; }
    if (await readFile(path,'utf8') === text) return;
  } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const temp = path+'.'+randomUUID()+'.tmp';
  try { await writeFile(temp,text); await rename(temp,path); }
  finally { await rm(temp,{force:true}); }
}

export async function publishCollected(db,base,dir = assetDirectory) {
  const scans = [...LEAGUES.keys()].map(id => Number(getMeta(db,'calendar:'+id+':at')) || 0);
  const revision = ['viewing-v1', ruleVersion, getMeta(db,'revision') ?? '0', ...scans].join('/');
  try {
    if ((await readAsset(dir,'collected-index')).revision === revision) return;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const rows = db.prepare('SELECT id,fixture,facts,fetched_at,phase FROM games WHERE fixture IS NOT NULL ORDER BY id').all();
  if (!rows.length && !scans.some(Boolean)) return;
  const latest = rows.reduce((time,row) => Math.max(time,row.fetched_at ?? 0),Math.max(...scans));
  const updatedAt = new Date(latest).toISOString();
  const covered = new Set(db.prepare('SELECT day FROM calendar_days GROUP BY day HAVING COUNT(*)=? ORDER BY day')
    .all(LEAGUES.size).map(r => r.day));
  const index = {revision,updatedAt,coveredDays:[...covered],days:{},fixtures:[]};
  const teams = new Map(base.teams.map(t => [teamKey(t.en),t.id]));
  const byId = new Map(base.fixtures.map(m => [m.id,m]));
  const sampleById = new Map(base.sample.matches.map(m=>[m.id,m]));
  const dayGroups = new Map(), dayTimes = new Map();
  for (const row of rows) {
    const id = String(row.id), f = JSON.parse(row.fixture), league = codes[f.league];
    const home = teams.get(teamKey(f.home)) ?? f.home, away = teams.get(teamKey(f.away)) ?? f.away;
    const initial = byId.get(id);
    const date = beijingDate(new Date(f.kickoff));
    const placeholder = initial ?? base.fixtures.find(m => m.rating === null && m.league === league && m.home === home &&
      m.away === away && ((m.round === f.round && Math.abs(Date.parse(m.date)-f.kickoff) < 150*86400000) ||
        Math.abs(Date.parse(m.date)-f.kickoff) < 2*86400000));
    const day = viewDay(f.kickoff);
    const fixture = {id,league,round:f.round ?? placeholder?.round ?? 0,date,home:placeholder?.home ?? home,
      away:placeholder?.away ?? away,time:new Date(f.kickoff + 8*3600000).toISOString().slice(11,16),status:f.status,rating:null};
    if (placeholder && placeholder.id !== id) fixture.alias = placeholder.id;
    if (f.replacedBy) fixture.replacedBy = String(f.replacedBy);
    index.fixtures.push(fixture);
    if (f.status !== 'finished' || row.phase === 'stopped') continue;
    const sample = sampleById.get(id);
    const summary = row.facts ? summarize(JSON.parse(row.facts)) :
      {id,stage:LEAGUES.get(f.league),kickoff:new Date(f.kickoff).toISOString(),home:f.home,away:f.away,score90:null};
    const match = rateMatch(summary).rating === null && sample ? sample : summary;
    fixture.rating = rateMatch(match).rating;
    fixture.day = day;
    if (fixture.rating === null && row.phase === 'done') fixture.ratingFinal = true;
    if (!dayGroups.has(day)) dayGroups.set(day,new Map());
    dayGroups.get(day).set(id,match);
    dayTimes.set(day, Math.max(dayTimes.get(day) ?? 0, row.fetched_at ?? f.kickoff));
  }
  const indexedFixtures = new Map(index.fixtures.map(f => [f.id,f]));
  const observed = new Set(index.fixtures.map(f => f.id));
  for (const match of base.sample.matches) {
    if (observed.has(match.id)) continue;
    const at = Date.parse(match.kickoff), day = viewDay(at);
    if (!dayGroups.has(day) && covered.has(day)) dayGroups.set(day,new Map());
    dayGroups.get(day)?.set(match.id,match);
  }
  await mkdir(join(dir,'collected'),{recursive:true});
  for (const [day,group] of dayGroups) {
    const matches = [...group.values()];
    const stamp = dayTimes.get(day) ?? Date.parse(base.sample.capturedOn);
    const sampleOnly = !dayTimes.has(day);
    const feed = formatFeed({day,source:'BSD',mode:sampleOnly ? 'sample' : 'stored',sampleOnly,
      ...(sampleOnly ? {capturedOn:base.sample.capturedOn} : {}),updatedAt:new Date(stamp).toISOString(),
      partial:sampleOnly || !covered.has(day) || matches.some(m => rateMatch(m).rating === null),matches},true);
    const hash = createHash('sha256').update(JSON.stringify(feed)).digest('hex').slice(0,20);
    const file = 'collected/'+day+'-'+hash;
    await atomicAsset(dir,file,feed,true);
    const preview = {...feed, matches:feed.matches.map(({details,...card}) => card)};
    for (const card of preview.matches) {
      const fixture = indexedFixtures.get(card.id);
      if (fixture && card.viewing) Object.assign(fixture,{styles:card.viewing.styles,chances:card.viewing.chances});
    }
    const previewFile = file+'-preview';
    await atomicAsset(dir,previewFile,preview,true);
    index.days[day] = {file,previewFile};
  }
  index.ruleVersion = ruleVersion;
  await atomicAsset(dir,'collected-index',index);
}
