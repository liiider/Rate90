import {atomicAsset,assetDirectory,optionalIndex} from './collected-feed.mjs';
import {LEAGUES,beijingDate} from './bsd.mjs';
import {DAY,codes,initPrematch,nextRounds,recentPattern,scheduleGame,scopesFor,signature,standingContext,tableRows,teamHistory} from './prematch.mjs';
import {aiSettings,promptVersion,selectGames} from './prematch-ai.mjs';

const nameKey = s => s.normalize('NFKC').trim().toLowerCase();
const shortDate=t=>new Date(t).toISOString().slice(0,10);
const asArray = v=>Array.isArray(v) ? v : [];
const statusFuture = s=>['upcoming','scheduled','notstarted','not_started'].includes(s);

function fromLocal(db,base) {
  const names=new Map(base.teams.map(t=>[t.id,t.en]));
  const map=new Map();
  const identity=g=>JSON.stringify([g.league,g.round,g.home,g.away]);
  for (const f of base.fixtures) {
    const kickoff=Date.parse(f.date+'T'+(f.time||'12:00')+':00+08:00');
    if (!f.round || !Number.isFinite(kickoff)) continue;
    const g={id:String(f.id),league:f.league,season:null,round:f.round,stage:typeof f.round==='number'?'league':String(f.round),
      home:names.get(f.home)||f.home,away:names.get(f.away)||f.away,kickoff,timeKnown:Boolean(f.time),status:f.status||(Number.isFinite(f.rating)?'finished':'scheduled')};
    map.set(identity(g),g);
  }
  for (const row of db.prepare('SELECT id,fixture FROM games WHERE fixture IS NOT NULL').iterate()) {
    const f=JSON.parse(row.fixture);
    if (!f.round || f.replacedBy) continue;
    const g={id:String(row.id),league:codes[f.league],season:null,stage:typeof f.round==='number'?'league':String(f.round),
      round:f.round,home:f.home,away:f.away,kickoff:f.kickoff,status:f.status};
    map.set(identity(g),g);
  }
  return [...map.values()];
}

function availability(raw) {
  if (!raw || typeof raw!=='object') return null;
  const rows=s=>asArray(raw[s]).filter(p=>typeof p?.name==='string').map(p=>({
    name:p.name,status:p.status??null,reason:p.reason??null,expectedReturn:p.expected_return??null
  }));
  return {home:rows('home'),away:rows('away')};
}
function scheduleLoad(rows,g) {
  if (!Array.isArray(rows)) return null;
  const lastWeek=g.kickoff-7*DAY, prior=rows.filter(f=>f.id!==g.id && f.kickoff<g.kickoff && !['postponed','unresolved','cancelled','canceled'].includes(f.status));
  const last=prior.sort((a,b)=>b.kickoff-a.kickoff)[0];
  return {hoursBetweenKickoffs:last?Math.round((g.kickoff-last.kickoff)/3600000):null,
    previous7Days:prior.filter(f=>f.kickoff>=lastWeek).length,
    next7Days:rows.filter(f=>f.kickoff>g.kickoff && f.kickoff<=g.kickoff+7*DAY && statusFuture(f.status)).length};
}

// Keep private source observations and exact model inputs on the collector. Publish only fixtures and approved fields.
export async function refreshPrematch(db,base,client,{now=Date.now(),dir=assetDirectory,ai=aiSettings(),ask=selectGames,
  enrichmentLimit=32,modelLimit=4,allowInference=Boolean(client)}={}) {
  initPrematch(db);
  const cached=db.prepare('SELECT observed,data FROM preview_sources WHERE key=? AND observed<=?');
  const save=db.prepare('INSERT OR REPLACE INTO preview_sources VALUES (?,?,?)');
  const read=k=>{const r=cached.get(k,now);return r?{at:r.observed,value:JSON.parse(r.data)}:null;};
  const errors=[];
  let quota=enrichmentLimit,paused=Number(read('retry:bsd')?.value)>now;
  async function source(key,ttl,load,limited=false) {
    const old=read(key);
    if (!client || paused || (old && now-old.at<ttl) || (limited && quota<=0) || Number(read('retry:'+key)?.value)>now) return old;
    if (limited) quota--;
    try {
      const value=await load(); const at=now;
      save.run(key,at,JSON.stringify(value));
      return {at,value};
    } catch(e) {
      const wait=Math.max(15*60000,e.retryAfterMs||0);
      save.run('retry:'+key,now,JSON.stringify(now+wait));
      if (e.status===429 || /网络请求失败/.test(e.message)) {paused=true;save.run('retry:bsd',now,JSON.stringify(now+wait));}
      errors.push(key+' '+e.message);return old;
    }
  }
  const local=fromLocal(db,base), rounds=[], extra=[], tables=new Map();
  for (const league of LEAGUES.keys()) {
    const code=codes[league];
    const season=await source('schedule:'+code,6*3600000,async()=>{
      const s=await client.season(league);
      if (!Number.isSafeInteger(s.id)) throw Error('赛季 ID 无效');
      const raw=await client.seasonFixtures(league,s.id);
      const games=raw.filter(e=>e.season?.id===s.id && !e.replaced_by).map(e=>scheduleGame(e,league)).filter(Boolean);
      if (raw.length && !games.length) throw Error('赛程格式异常');
      return {id:s.id,games};
    });
    const games=season?.value.games??local.filter(g=>g.league===code);
    const groups=nextRounds(games,now);
    const inRound=new Set(groups.flatMap(r=>r.games.map(g=>g.id)));
    const horizon=Math.max(now+7*DAY,...groups.flatMap(r=>r.games.map(g=>g.kickoff)));
    extra.push(...games.filter(g=>!inRound.has(g.id) && g.kickoff>now && g.kickoff<=horizon && statusFuture(g.status)));
    for (const group of groups) rounds.push({...group,source:season?'season':'local',observedAt:season?.at??null});
    if (season && groups.length) tables.set(code,await source('table:'+league+':'+season.value.id,6*3600000,
      async()=>tableRows(await client.standings(league,season.value.id))));
  }
  const history=teamHistory(db,now);
  const patterns=new Map([...history].map(([key,recent])=>[key,recentPattern(recent)]));
  const names=new Map(base.teams.map(t=>[nameKey(t.en),{id:t.id,zh:t.zh}]));
  const games=[...extra,...rounds.flatMap(r=>r.games)].sort((a,b)=>a.kickoff-b.kickoff);
  const last=games.at(-1)?.kickoff??now;
  const ext=new Map();
  for (const g of games) {
    const d= /^\d+$/.test(g.id) ? await source('detail:'+g.id,12*3600000,async()=>{
      const e=await client.event(Number(g.id),true);
      return {unavailable:availability(e.unavailable_players),homeId:e.home_team_obj?.id??null,awayId:e.away_team_obj?.id??null};
    },true):null;
    const calendar=[];
    for (const id of [g.homeId??d?.value.homeId,g.awayId??d?.value.awayId]) {
      const team=id ? await source('team:'+id+':'+shortDate(now)+':'+shortDate(last),DAY,async()=>{
        const events=await client.teamFixtures(id,shortDate(now-35*DAY),shortDate(last+8*DAY));
        return events.map(e=>({id:String(e.id),kickoff:Date.parse(e.event_date),status:e.status})).filter(e=>Number.isFinite(e.kickoff));
      },true):null;
      calendar.push(team ? {asOf:team.at,...scheduleLoad(team.value,g)}:null);
    }
    let firstLeg=null;
    if (g.stage!=='league' && /^\d+$/.test(g.id)) {
      const leg=await source('leg:'+g.id,DAY,async()=>{
        const id=g.previousLegId || (await client.legInfo(Number(g.id))).previous_leg_event_id;
        if (!id) return null;
        const first=await client.event(id);
        return first.status==='finished' && Date.parse(first.event_date)<now && [first.home_score,first.away_score].every(Number.isInteger)
          ? {home:first.home_team,away:first.away_team,score:[first.home_score,first.away_score]}:null;
      },true);
      firstLeg=leg?.value??null;
    }
    ext.set(g.id,{d,calendar,firstLeg});
  }
  const scopes=scopesFor(rounds,extra);
  const picks={}, modelName=ai?.model??'gpt-6.2-sol';
  let modelCalls=0;
  for (const [scope, fixtures] of scopes) {
    const teams={};
    const candidates=[];
    for (const g of fixtures) {
      const {calendar,d,firstLeg}=ext.get(g.id),table=tables.get(g.league);
      if (![g.home,g.away].every(name=>patterns.get(g.league+'/'+name)?.samples)) continue;
      for (const [name,id] of [[g.home,g.homeId],[g.away,g.awayId]]) {
        const key=g.league+'/'+name;
        teams[key]={name:names.get(nameKey(name))?.zh??name,recent:history.get(key),pattern:patterns.get(key),
          table:table?{asOf:table.at,standing:standingContext(table.value,name,id)}:null};
      }
      candidates.push({id:g.id,competition:g.league,round:g.round,home:g.home,away:g.away,kickoff:g.timeKnown===false?beijingDate(new Date(g.kickoff)):new Date(g.kickoff).toISOString(),
        calendar,firstLeg,unavailable:d?{asOf:d.at,players:d.value.unavailable}:null});
    }
    if (!candidates.length) continue;
    const context={promptVersion,games:candidates,teams};
    const fingerprint=signature([modelName,scope,context]);
    let prediction=db.prepare('SELECT created,result FROM preview_predictions WHERE scope=? AND fingerprint=? AND created<=?').get(scope,fingerprint,now);
    if (!prediction && allowInference && ai && modelCalls<modelLimit && (Number(read('retry:ai')?.value)||0)<=now) {
      modelCalls++;
      try {
        const input={asOf:new Date(now).toISOString(),...context};
        const result=await ask(ai,input);
        if (fixtures.some(g=>g.kickoff<=Math.max(now,Date.now())) && Math.abs(Date.now()-now)<DAY) continue;
        prediction={created:now,result:JSON.stringify(result)};
        db.prepare('INSERT OR IGNORE INTO preview_predictions VALUES (?,?,?,?,?,?)').run(scope,fingerprint,now,modelName,JSON.stringify(input),prediction.result);
      } catch(e) {
        save.run('retry:ai',now,JSON.stringify(now+15*60000));errors.push('AI 推荐 '+e.message);
      }
    }
    if (!prediction) {
      // A later source update may arrive while a replacement prediction is pending.
      const old=db.prepare(`SELECT created,result,context FROM preview_predictions WHERE scope=? AND model=?
        AND json_extract(context,'$.promptVersion')=? AND created<=? ORDER BY created DESC LIMIT 1`).get(scope,modelName,promptVersion,now);
      const lineup=games=>games.map(g=>[g.id,g.home,g.away,g.kickoff]);
      if (old && now-old.created<DAY && JSON.stringify(lineup(JSON.parse(old.context).games))===JSON.stringify(lineup(candidates))) prediction=old;
    }
    if (prediction) picks[scope]={at:prediction.created,ids:fixtures.map(g=>g.id),items:JSON.parse(prediction.result)};
  }
  const publicGame=g=>({
    id:g.id,league:g.league,round:g.round,kickoff:g.kickoff,timeKnown:g.timeKnown!==false,
    home:names.get(nameKey(g.home))??{id:g.home,zh:g.home},away:names.get(nameKey(g.away))??{id:g.away,zh:g.away}
  });
  const publicRounds=rounds.map(({games,...round})=>({...round,games:games.map(publicGame)}));
  const feed={version:1,model:modelName,rounds:publicRounds,extra:extra.map(publicGame),picks};
  const file='prematch-'+signature(feed).slice(0,20);
  await atomicAsset(dir,file,feed,true);
  const index=await optionalIndex(dir,'collected-index');
  if (index && index.prematchFile!==file) await atomicAsset(dir,'collected-index',{...index,prematchFile:file});

  return {rounds:rounds.length,games:games.length,picks:Object.keys(picks).length,errors,ai:ai?'configured':'unconfigured'};
}
