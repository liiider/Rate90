import {readFile, mkdir, writeFile, rename, stat, rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createBsdClient, summarize} from '../server/bsd.mjs';
import {isOwnGoal, validShotProbability} from '../server/shot-profile.mjs';
import {rateMatch, ruleVersion} from '../server/recommend.mjs';
import {assetDirectory, readAsset} from '../server/collected-feed.mjs';

const leagues = {pl:1,ll:3,sa:4,bl:5,l1:6,cl:7};
const day = 86400000;
const root = fileURLToPath(new URL('../data/round-tests/',import.meta.url));
const normalized = name => String(name ?? '').normalize('NFKC').toLowerCase().trim();
const hardFailure = error => ['ENOTFOUND','EAI_AGAIN','EACCES'].includes(error.cause?.cause?.code) ||
  [401,403,429].includes(error.status);

async function save(path, data) {
  const temporary = path+'.'+randomUUID()+'.tmp';
  try {
    await writeFile(temporary,JSON.stringify(data,null,2)+'\n');
    await rename(temporary,path);
  } finally { await rm(temporary,{force:true}); }
}

export function selectRounds(fixtures) {
  return Object.entries(leagues).map(([league,leagueId]) => {
    const round = Math.max(...fixtures.filter(f=>f.league===league && Number.isFinite(f.rating)).map(f=>f.round));
    const matches = fixtures.filter(f=>f.league===league && f.round===round);
    if (!matches.length) throw Error('没有可验证的轮次 '+league);
    return {league,leagueId,round,matches};
  });
}

function resolveId(f,events,teams) {
  if (/^\d+$/.test(f.id)) return Number(f.id);
  const candidates = events.filter(e =>
    (normalized(e.home_team) === normalized(teams.get(f.home)) && normalized(e.away_team) === normalized(teams.get(f.away))) ||
    (String(e.home_team_id) === f.home && String(e.away_team_id) === f.away));
  if (candidates.length === 1) return candidates[0].id;
  const sameRound = candidates.filter(e=>Number(e.round_number ?? e.round)===f.round);
  return sameRound.length === 1 ? sameRound[0].id : null;
}

function coverage(data) {
  const summary = summarize(data);
  return {shotRows:Array.isArray(data.shotmap) ? data.shotmap.length : null,
    regulationShots:summary.shotsByWindow?.reduce((a,b)=>a+b,0) ?? null,
    xg:summary.xgCount,xgot:summary.xgotCount,xg90:summary.xg90,
    incidents:Array.isArray(data.incidents) ? data.incidents.length : null,
    momentum:Array.isArray(data.momentum) ? data.momentum.length : null,
    rating:data.status==='finished' ? rateMatch(summary).rating : null};
}

export async function fetchRounds(client, rounds, teamRows, output) {
  await mkdir(join(output,'events'),{recursive:true});
  const teams = new Map(teamRows.map(t=>[t.id,t.en]));
  const manifest = {source:'BSD /api/events/{id}/?full=true',ruleVersion,startedAt:new Date().toISOString(),
    rounds:[],matches:[],errors:[]};
  let blocked;
  for (const {league,leagueId,round,matches} of rounds) {
    let events = [];
    if (!blocked) {
      const dates = matches.map(m=>Date.parse(m.date));
      try { events=await client.list(leagueId,new Date(Math.min(...dates)-day),new Date(Math.max(...dates)+2*day)); }
      catch (error) {
        manifest.errors.push({league,step:'list',message:error.message});
        if (hardFailure(error)) blocked=error.message;
      }
    }
    const used = new Set();
    for (const fixture of matches) {
      const id = resolveId(fixture,events,teams);
      const entry = {league,round,fixtureId:fixture.id,matchDate:fixture.date,home:teams.get(fixture.home),away:teams.get(fixture.away),
        eventId:id,status:null,file:null,coverage:null};
      manifest.matches.push(entry);
      if (!id) { entry.error=blocked ?? '赛程中未唯一匹配 BSD ID'; continue; }
      if (used.has(id)) { entry.error='重复场次 ID'; continue; }
      used.add(id);
      const file = 'events/'+id+'.json', path=join(output,file);
      let data, previous, fetchedAt;
      try {
        previous=JSON.parse(await readFile(path,'utf8'));
        if (previous.id!==id || previous.league?.id!==leagueId || !previous.status) throw Error('缓存场次不匹配');
        fetchedAt=(await stat(path)).mtime.toISOString();
      } catch (error) { if (error.code!=='ENOENT') manifest.errors.push({id,step:'cache',message:error.message}); previous=null; }
      // Resume completed captures. Revisit pending fixtures and incomplete shot coverage on every run.
      if (previous?.status==='finished' && coverage(previous).rating!==null) data=previous;
      if (!data && !blocked) {
        try {
          const next=await client.event(id,true);
          if (next.id!==id || next.league?.id!==leagueId || !next.status) throw Error('详情与赛程不匹配');
          await save(path,next);
          data=next;
          fetchedAt=new Date().toISOString();
        } catch (error) {
          entry.error=error.message;
          if (hardFailure(error)) blocked=error.message;
        }
      }
      data ??= previous;
      if (data) Object.assign(entry,{file,status:data.status,fetchedAt,coverage:coverage(data)});
      else entry.error ??= blocked ?? '未取得详情';
    }
    const rows = manifest.matches.filter(e=>e.league===league);
    manifest.rounds.push({league,round,scheduled:rows.length,raw:rows.filter(e=>e.file).length,
      finished:rows.filter(e=>e.status==='finished').length,rated:rows.filter(e=>e.coverage?.rating!=null).length});
  }
  manifest.finishedAt = new Date().toISOString();
  manifest.fullResponses = manifest.matches.filter(m=>m.file).length;
  manifest.complete = manifest.matches.every(m=>m.file && !m.error);
  await save(join(output,'manifest.json'),manifest);
  return manifest;
}

export async function verifyRound(dir) {
  const manifest=JSON.parse(await readFile(join(dir,'manifest.json'),'utf8'));
  const ids=new Set(), statusCounts={}, unrated=[];
  const byField=Object.fromEntries(['shotmap','incidents','momentum','xg_per_minute','lineups','live_stats','average_positions'].map(k=>[k,0]));
  const ratingChanges=[];
  let shots=0, xg=0, xgot=0, regulationShots=0, regulationShotsWithXg=0, rated=0, bytes=0;
  for (const entry of manifest.matches) {
    if (!entry.file || entry.error) throw Error('详情未完整取得 '+entry.fixtureId);
    const raw=await readFile(join(dir,entry.file)), event=JSON.parse(raw);
    if (event.id!==entry.eventId || ids.has(event.id) || event.league?.id!==leagues[entry.league] ||
        Number(event.round_number)!==entry.round || event.status!==entry.status) throw Error('比赛身份、轮次或状态不一致 '+entry.fixtureId);
    ids.add(event.id); bytes+=raw.length;
    statusCounts[event.status]=(statusCounts[event.status]??0)+1;
    if(event.status!=='finished') continue;
    const metrics=coverage(event);
    if(manifest.ruleVersion===ruleVersion && metrics.rating!==entry.coverage?.rating) throw Error('评分复算不一致 '+event.id);
    if (manifest.ruleVersion !== ruleVersion && metrics.rating !== entry.coverage?.rating) {
      ratingChanges.push({id:event.id,home:event.home_team,away:event.away_team,
        previousRating:entry.coverage?.rating ?? null,rating:metrics.rating,xg90:metrics.xg90});
    }
    regulationShots+=metrics.regulationShots ?? 0;
    regulationShotsWithXg+=metrics.xg;
    for(const field of Object.keys(byField)) if(event[field] && Object.keys(event[field]).length) byField[field]++;
    const attempts=event.shotmap??[];
    shots+=attempts.length;
    xg+=attempts.filter(s=>Number.isFinite(s.xg)).length;
    xgot+=attempts.filter(s=>Number.isFinite(s.xgot)).length;
    if(metrics.rating!==null) rated++;
    else unrated.push({id:event.id,home:event.home_team,away:event.away_team,
      shots:attempts.length,missingXg:attempts.filter(s=>!isOwnGoal(s) && !validShotProbability(s.xg)).map(s=>({type:s.type,gtype:s.gtype??null,minute:s.min}))});
  }
  const result={capturedAt:manifest.finishedAt,capturedRuleVersion:manifest.ruleVersion,ruleVersion,
    scheduled:manifest.matches.length,uniqueResponses:ids.size,bytes,statusCounts,finishedWithFields:byField,
    finishedShotRows:shots,withXg:xg,withXgot:xgot,regulationShots,regulationShotsWithXg,rated,unrated,ratingChanges};
  await save(join(dir,'coverage.json'),result);
  return result;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href===import.meta.url) {
  const [fixtures,teams] = await Promise.all(['fixtures','teams'].map(n=>readAsset(assetDirectory,n)));
  const rounds = selectRounds(fixtures);
  const base = join(root,rounds.map(r=>r.league+r.round).join('-'));
  if (process.argv.includes('--verify')) {
    console.log(JSON.stringify(await verifyRound(base),null,2));
  } else {
    const result = await fetchRounds(createBsdClient(process.env.BSD_API_TOKEN),rounds,teams,base);
    console.table(result.rounds);
    console.log('原始详情',result.fullResponses+'/'+result.matches.length,join(base,'manifest.json'));
    if (!result.complete) {
      console.error(result.errors[0]?.message || result.matches.find(m=>m.error)?.error);
      process.exitCode=1;
    }
    else await verifyRound(base);
  }
}
