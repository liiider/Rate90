import {createHash} from 'node:crypto';
import {mkdir, readFile, readdir, stat, unlink, utimes} from 'node:fs/promises';
import {join} from 'node:path';
import {beijingDate, LEAGUES, summarize} from './bsd.mjs';
import {DAY, getMeta} from './collector.mjs';
import {assetDirectory, atomicAsset, isFinishedFixture, optionalIndex, readAsset} from './collected-feed.mjs';
import {formatFeed, rateMatch, ruleVersion} from './recommend.mjs';

const codes = {1:'pl',3:'ll',4:'sa',5:'bl',6:'l1',7:'cl'};
const viewDay = time => beijingDate(new Date(time + 12 * 3600000));
const teamKey = name => name.normalize('NFKC').trim().toLowerCase();
const sampleFile = new URL('../data/bsd-sample.json',import.meta.url);

export async function loadBaseline(dir = assetDirectory) {
  const [fixtures,teams,sample,snapshot] = await Promise.all([readAsset(dir,'fixtures'),readAsset(dir,'teams'),
    readFile(sampleFile,'utf8').then(JSON.parse),optionalIndex(dir,'process-ratings')]);
  const existing = new Set(sample.matches.map(m => m.id));
  const publishedIds = (snapshot?.fixtures ?? []).filter(f => f.status === 'finished' &&
    Number.isFinite(snapshot.matches[f.id]?.rating) && snapshot.days?.[f.day]?.file).map(f => Number(f.id));
  for (const id of publishedIds) existing.add(String(id));
  const backfill = fixtures.filter(f => isFinishedFixture(f) && /^\d+$/.test(f.id) && !existing.has(f.id)).map(f => Number(f.id));
  return {fixtures,teams,sample,backfill,publishedIds};
}

export async function publishCollected(db,base,dir = assetDirectory) {
  const scans = [...LEAGUES.keys()].map(id => Number(getMeta(db,'calendar:'+id+':at')) || 0);
  const revision = ['round-reasons-v3', ruleVersion, getMeta(db,'revision') ?? '0', ...scans].join('/');
  const previous = await optionalIndex(dir,'collected-index');
  if (previous?.revision === revision) return;
  const rows = db.prepare('SELECT id,fixture,facts,fetched_at,observed_at,styles_at,phase FROM games WHERE fixture IS NOT NULL ORDER BY id').all();
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
    const placeholder = initial ?? base.fixtures.find(m => !/^\d+$/.test(m.id) && m.league === league && m.home === home &&
      m.away === away && ((m.round === f.round && Math.abs(Date.parse(m.date)-f.kickoff) < 150*86400000) ||
        Math.abs(Date.parse(m.date)-f.kickoff) < 2*86400000));
    const day = viewDay(f.kickoff);
    const fixture = {id,league,round:f.round ?? placeholder?.round ?? null,date,home:placeholder?.home ?? home,
      away:placeholder?.away ?? away,time:new Date(f.kickoff + 8*3600000).toISOString().slice(11,16),status:f.status,rating:null,
      observedAt:row.observed_at != null ? new Date(row.observed_at).toISOString() : null,
      capturedAt:row.fetched_at ? new Date(row.fetched_at).toISOString() : null};
    if (placeholder && placeholder.id !== id) fixture.alias = placeholder.id;
    if (f.replacedBy) fixture.replacedBy = String(f.replacedBy);
    index.fixtures.push(fixture);
    if (f.status !== 'finished' || row.phase === 'stopped') continue;
    const sample = sampleById.get(id);
    const summary = row.facts ? summarize(JSON.parse(row.facts)) :
      {id,stage:LEAGUES.get(f.league),kickoff:new Date(f.kickoff).toISOString(),home:f.home,away:f.away,score90:null};
    summary.kickoff = new Date(f.kickoff).toISOString();
    if (summary.styleStats || summary.shotEvidence) {
      fixture.stylesCapturedAt = row.styles_at != null ? new Date(row.styles_at).toISOString() : fixture.capturedAt;
    }
    const observedRating = rateMatch(summary).rating;
    if (observedRating === null) fixture.capturedAt = null;
    const match = observedRating === null && sample ? {
      ...sample,kickoff:summary.kickoff,incidentReasons:summary.incidentReasons,matchDetail:summary.matchDetail,styleStats:summary.styleStats
    } : summary;
    // Keep derived archive ratings out of the fresh-observation index.
    fixture.rating = observedRating;
    fixture.day = day;
    if (fixture.rating === null && !sample && row.phase === 'done') fixture.ratingFinal = true;
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
      if (fixture && card.viewing) Object.assign(fixture,{styles:card.viewing.styles,styleIds:card.viewing.styleIds});
    }
    const previewFile = file+'-preview';
    await atomicAsset(dir,previewFile,preview,true);
    index.days[day] = {file,previewFile};
  }
  index.ruleVersion = ruleVersion;
  const active = new Set(Object.values(index.days).flatMap(day => [day.file,day.previewFile]));
  const former = new Set(Object.values(previous?.days ?? {}).flatMap(day => [day.file,day.previewFile]));
  const folder = join(dir,'collected');
  const now = new Date();
  const expired = [];
  for (const entry of await readdir(folder,{withFileTypes:true})) {
    if (!entry.isFile() || !/^\d{4}-\d{2}-\d{2}-[0-9a-f]{20}(?:-preview)?\.js$/.test(entry.name)) continue;
    const key = 'collected/'+entry.name.slice(0,-3);
    if (active.has(key)) continue;
    const path = join(folder,entry.name);
    // Start the grace period when the last index reference is retired.
    if (former.has(key)) await utimes(path,now,now);
    else if (+now - (await stat(path)).mtimeMs >= 7*DAY) expired.push(path);
  }
  await atomicAsset(dir,'collected-index',index);
  for (const path of expired) await unlink(path);
}
