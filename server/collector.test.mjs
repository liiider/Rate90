import test from 'node:test';
import assert from 'node:assert/strict';
import {access, mkdtemp, readFile, rm, utimes} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import vm from 'node:vm';
import {collectSeason, openQueue, seedBackfill, tick, DAY, MINUTE} from './collector.mjs';
import {loadBaseline, publishCollected} from './publish-collected.mjs';
import {atomicAsset, readAsset, storedFeed} from './collected-feed.mjs';
import {getFeed} from './matches-api.mjs';

const kickoff = Date.parse('2026-11-21T19:00:00Z'); // Beijing 03:00
const game = (id = 1, fields = {}) => ({id,league:{id:1},event_date:new Date(kickoff).toISOString(),
  status:'upcoming',home_team:'Home',away_team:'Away',round_number:11,home_score:0,away_score:0,
  shotmap:[{min:10,type:'miss',home:true,xg:0.2},{min:75,type:'save',home:false,xg:0.3,xgot:0.5}],...fields});
const getRow = (db,id=1) => db.prepare('SELECT * FROM games WHERE id=?').get(id);
const at = m => kickoff + m * MINUTE;
function vendor(...events) {
  return {
    events, calls:[],
    async list(league,start,end) {
      this.calls.push({league,start:+start,end:+end});
      return this.events.filter(e => e.league.id === league && Date.parse(e.event_date)>=+start && Date.parse(e.event_date)<+end);
    },
    async event(id,full=false) {
      this.calls.push({id,full});
      const event = this.events.find(e=>e.id===id);
      if (!event) throw Object.assign(Error('missing'),{status:404});
      return event;
    }
  };
}

test('Beijing 03:00 kickoff: no polling before 05:05, one batched poll at 05:05, next at 05:20', async t => {
  const db = openQueue(':memory:'); t.after(()=>db.close());
  const client = vendor(game(),game(2));
  await tick(db,client,at(-60));
  assert.equal(client.calls.length,6);
  assert.equal(getRow(db).due,at(125));
  client.events.forEach(e => {e.status='live';});
  client.calls.length=0;
  await tick(db,client,at(125)-1);
  assert.equal(client.calls.length,0);
  await tick(db,client,at(125));
  assert.equal(client.calls.length,1);
  assert.equal(getRow(db).due,at(140));
  client.events.forEach(e => {e.status='finished';});
  await tick(db,client,at(140)-1);
  assert.equal(client.calls.length,1);
  await tick(db,client,at(140));
  assert.equal(client.calls.filter(c=>c.full).length,2);
  assert.equal(getRow(db).due,at(140+360));
  await tick(db,client,at(140));
  assert.equal(client.calls.filter(c=>c.full).length,2);
});

test('kickoff changes rearm the 125-minute delay; postponement stops polling, replacement has its own job', async t => {
  const db=openQueue(':memory:'); t.after(()=>db.close());
  const client=vendor(game());
  await tick(db,client,at(-1));
  client.events[0].event_date = new Date(at(2000)).toISOString();
  await tick(db,client,at(125));
  assert.equal(getRow(db).due,at(2125));
  client.events[0].status='postponed';
  client.events[0].replaced_by=2;
  client.events.push(game(2,{event_date:new Date(at(2050)).toISOString()}));
  await tick(db,client,at(1440)); // next daily calendar
  assert.equal(getRow(db).phase,'stopped');
  assert.equal(getRow(db).due,null);
  assert.equal(getRow(db,2).due,at(2175));
  await tick(db,client,at(2125));
  assert.equal(client.calls.filter(c=>c.full).length,0);
});

test('persistent tasks survive restart, refresh after six hours and retry missing facts after 24 hours', async t => {
  const root=await mkdtemp(join(tmpdir(),'rate90-restart-'));
  const path=join(root,'queue.sqlite');
  let db=openQueue(path);
  t.after(async()=>{ db.close(); await rm(root,{recursive:true,force:true}); });
  const client=vendor(game(1,{status:'finished',shotmap:[]}));
  await tick(db,client,at(124));
  assert.equal(client.calls.filter(c=>c.full).length,0);
  await tick(db,client,at(125));
  assert.equal(getRow(db).phase,'review');
  db.close(); db=openQueue(path);
  await tick(db,client,at(485)-1);
  assert.equal(client.calls.filter(c=>c.full).length,1);
  await tick(db,client,at(485));
  assert.equal(getRow(db).phase,'last');
  assert.equal(getRow(db).due,at(125)+DAY);
  client.events[0].shotmap=game().shotmap;
  await tick(db,client,at(125)+DAY);
  assert.equal(getRow(db).phase,'done');
  assert.equal(getRow(db).due,null);
  assert.equal(JSON.parse(getRow(db).facts).shotmap.length,2);
});

test('a failed or incomplete correction preserves a previously rated result', async t => {
  const db=openQueue(':memory:'); t.after(()=>db.close());
  const client=vendor(game(1,{status:'finished'}));
  await tick(db,client,at(125));
  const saved=getRow(db).facts;
  const lookup=client.event;
  client.event=async()=>{throw Error('offline');};
  const error=await tick(db,client,at(485));
  assert.equal(error.errors.length,1);
  assert.equal(getRow(db).due,at(500));
  client.event=lookup;client.events[0].shotmap=[];
  await tick(db,client,at(500));
  assert.equal(getRow(db).facts,saved);
  assert.equal(getRow(db).phase,'last');
});

test('six-hour corrections retain confirmed lineups and missing side statistics, and accept measured zero', async t => {
  const db = openQueue(':memory:'); t.after(() => db.close());
  const lineup = {confirmed:true,home:{formation:'4-3-3',players:Array.from({length:11},(_,n) =>
    ({name:'Starter '+n,player_id:n+1,jersey_number:String(n+1),captain:n===0})),substitutes:[{name:'Sub'}]},
    away:{formation:'4-4-2',players:[{name:'Away starter'}]}};
  const stats = {home:{distance_covered:'110 km',total_shots:12},away:{distance_covered:'113 km',total_shots:3},
    first_half:{home:{total_shots:4},away:{total_shots:2}}};
  const client = vendor(game(1,{status:'finished',lineups:lineup,live_stats:stats}),
    game(2,{status:'finished',lineups:{...lineup,confirmed:false}}));
  await tick(db,client,at(125));
  client.events[0].lineups = {confirmed:true,home:{formation:'4-2-3-1',players:[{player_id:1,jersey_number:'7',captain:false}]}};
  client.events[0].live_stats = {home:{total_shots:0,distance_covered:null},first_half:{away:{total_shots:0}}};
  client.events[1].lineups = {confirmed:true,home:{formation:'3-5-2'}};
  await tick(db,client,at(485));
  const facts = JSON.parse(getRow(db,1).facts);
  assert.equal(facts.lineups.home.formation,'4-2-3-1');
  assert.equal(facts.lineups.home.players.length,11);
  assert.deepEqual(facts.lineups.home.players[0],{name:'Starter 0',player_id:1,jersey_number:'7',captain:false});
  assert.deepEqual(facts.lineups.home.substitutes,lineup.home.substitutes);
  assert.deepEqual(facts.lineups.away,lineup.away);
  assert.deepEqual(facts.live_stats.home,{distance_covered:'110 km',total_shots:0});
  assert.deepEqual(facts.live_stats.away,stats.away);
  assert.deepEqual(facts.live_stats.first_half,{home:{total_shots:4},away:{total_shots:0}});
  assert.deepEqual(JSON.parse(getRow(db,2).facts).lineups,{confirmed:true,home:{formation:'3-5-2'}});
});

test('daily schedule follows Beijing noon and only queues history missing from published rounds', async t => {
  const db=openQueue(':memory:'); t.after(()=>db.close());
  const base=await loadBaseline();
  const fixed = new Set(base.sample.matches.map(match => match.id));
  const original = base.fixtures.filter(f => f.status === 'finished' && !fixed.has(f.id)).map(f => Number(f.id));
  const complete = new Set(base.publishedIds);
  assert.deepEqual(base.backfill,original.filter(id => !complete.has(id)));
  assert.ok(base.backfill.length < original.length);
  const old = {event_date:new Date(kickoff-30*DAY).toISOString(),status:'finished'};
  const ids=base.backfill.slice(0,9), client=vendor(...ids.map(id=>game(id,old)));
  seedBackfill(db,ids);seedBackfill(db,ids);
  const noon=Date.parse('2026-11-22T04:00:00Z');
  await tick(db,client,noon-1);
  assert.equal(client.calls.filter(c=>c.full).length,8);
  assert.equal(client.calls.filter(c=>c.league).length,6);
  await tick(db,client,noon);
  assert.equal(client.calls.filter(c=>c.full).length,9);
  assert.equal(client.calls.filter(c=>c.league).length,12);
  const last = client.calls.filter(c=>c.league).at(-1);
  assert.equal(last.start, Date.parse('2026-11-19T16:00:00Z'));
  assert.equal(last.end, Date.parse('2026-11-29T16:00:00Z'));
  seedBackfill(db,ids);
  await tick(db,client,noon+1);
  assert.equal(client.calls.filter(c=>c.full).length,9);
});

test('reopening an older queue removes only already published placeholders and preserves real jobs', async t => {
  const dir = await mkdtemp(join(tmpdir(),'rate90-backfill-'));
  const path = join(dir,'queue.sqlite');
  let db = openQueue(path);
  t.after(async () => { db.close(); await rm(dir,{recursive:true,force:true}); });
  seedBackfill(db,[1,2,3,4]);
  db.prepare("UPDATE games SET phase='done',fixture=?,facts=? WHERE id=2").run('{"status":"finished"}','{"id":2}');
  db.prepare("UPDATE games SET phase='review',fixture=?,due=1234 WHERE id=3").run('{"status":"finished"}');
  db.prepare("DELETE FROM meta WHERE key='migration:opening-lineups'").run();
  db.close(); db = openQueue(path);
  seedBackfill(db,[4],[1,2,3]);
  seedBackfill(db,[4],[1,2,3]);
  assert.equal(getRow(db,1),undefined);
  assert.equal(getRow(db,2).phase,'backfill');
  assert.equal(getRow(db,2).facts,'{"id":2}');
  assert.equal(getRow(db,3).due,1234);
  assert.equal(getRow(db,4).phase,'backfill');
});

test('published tactical details reach API and static catalog; corrections leave older snapshots intact', async t => {
  const db=openQueue(':memory:'); const dir=await mkdtemp(join(tmpdir(),'rate90-public-'));
  t.after(async()=>{db.close();await rm(dir,{recursive:true,force:true});});
  const client=vendor(game(1,{status:'finished',home_team:'Liverpool FC',away_team:'Aston Villa',
    home_coach:{name:'Coach H',preferred_formation:'3-4-3'},
    lineups:{confirmed:true,home:{formation:'4-3-3',players:[
      {name:'Player',jersey_number:'9',captain:true,position:'F',rating:9.1,goals:1,red_card:true}
    ]},away:{formation:'4-4-2',players:[]}},
    live_stats:{home:{shots_on_target:0},away:{}},
    incidents:[{type:'goal',minute:25,is_home:true,home_score:1,away_score:0}]
  }));
  const base=await loadBaseline();
  const alias='pl-11-1-3';
  base.fixtures=[{id:alias,league:'pl',round:11,date:'2026-11-22',home:'1',away:'3',rating:null}];
  await tick(db,client,at(125));
  await publishCollected(db,base,dir);
  const manifest=await readAsset(dir,'collected-index');
  const day='2026-11-22', firstFile=manifest.days[day].file;
  const publicRow=manifest.fixtures.find(f=>f.id==='1');
  assert.equal(publicRow.alias,alias);
  assert.ok(!('score90' in publicRow));
  const url=new URL('http://localhost/api/matches?date='+day);
  const offline=()=>assert.fail('default API must never call BSD');
  const stored=(day,reveal)=>storedFeed(day,reveal,dir);
  const plain=await getFeed(url,null,offline,stored);
  assert.equal(plain.mode,'stored');
  assert.equal(plain.matches.find(m=>m.id==='1').rating,publicRow.rating);
  assert.ok(plain.matches.every(m=>!('details' in m) && !('score90' in m)));
  url.searchParams.set('details','1');
  const first = (await getFeed(url,null,offline,stored)).matches.find(m=>m.id==='1').details;
  assert.deepEqual(first.stats.shotsOnTarget,{home:0,away:null});
  assert.equal(first.lineups.home.formation,'4-3-3');
  assert.equal(first.lineups.home.coach,'Coach H');
  assert.deepEqual(first.lineups.home.players,[{name:'Player',number:'9',position:'F',captain:true}]);
  assert.deepEqual(first.events,[]);
  assert.ok(!('score90' in first));

  const assets = {teams:base.teams, fixtures:base.fixtures, 'process-ratings':{matches:{}}, 'collected-index':manifest,results:{}};
  const window={}, document={createElement:()=>({remove(){}}),head:{async append(script) {
    const name=script.src.slice('./ui/data/'.length,-3);
    script.rate90Data=assets[name] ?? await readAsset(dir,name); script.onload();
  }}};
  vm.runInNewContext(await readFile(new URL('../public/ui/catalog.js',import.meta.url),'utf8'),{window,document});
  const catalog=await window.Rate90.catalog.loadCatalog();
  assert.equal(catalog.matches.length,1);
  assert.equal(catalog.byId.get(alias).rating,publicRow.rating);
  assert.equal(catalog.byId.get('1').home.zh,'利物浦');
  assert.equal((await window.Rate90.catalog.loadMatchDetails(alias)).lineups.home.coach,'Coach H');
  client.events[0].home_score=1;
  client.events[0].shotmap.push({min:85,type:'goal',gtype:'own',home:true,xg:null,xgot:null});
  delete client.events[0].lineups;
  client.events[0].live_stats.home.shots_on_target=1;
  await tick(db,client,at(485));
  await publishCollected(db,base,dir);
  assert.notEqual((await readAsset(dir,'collected-index')).days[day].file, firstFile);
  assert.equal((await readAsset(dir,firstFile)).matches.find(m=>m.id==='1').details.stats.shotsOnTarget.home,0);
  url.searchParams.delete('details');
  url.searchParams.set('reveal','1'); // Compatible with clients that request the old detail parameter.
  const corrected=(await getFeed(url,null,offline,stored)).matches.find(m=>m.id==='1');
  assert.deepEqual(corrected.details.stats.shotsOnTarget,{home:1,away:null});
  assert.equal(corrected.details.lineups.home.players[0].name,'Player');
  assert.ok(!('score90' in corrected.details));
  assert.ok(Number.isFinite(corrected.rating));
  assets['collected-index']=await readAsset(dir,'collected-index');
  await window.Rate90.catalog.loadCatalog();
  const details=await window.Rate90.catalog.loadMatchDetails(alias);
  assert.equal(details.stats.shotsOnTarget.home,1);
  assert.ok(!('score90' in details));
});

test('a failed calendar page leaves no partial schedule and retries only the affected league', async t => {
  const db=openQueue(':memory:'); t.after(()=>db.close());
  const client=vendor(game(),game(2,{home_team:null}));
  const failed=await tick(db,client,at(-40));
  assert.equal(failed.calendars,5);
  assert.equal(failed.errors.length,1);
  assert.equal(getRow(db),undefined);
  client.events[1].home_team='Recovered';
  client.calls.length=0;
  await tick(db,client,at(-26));
  assert.equal(client.calls.length,0);
  await tick(db,client,at(-25));
  assert.deepEqual(client.calls.map(c=>c.league),[1]);
  assert.equal(getRow(db,2).due,at(125));
});

test('an empty day stays known after the discovery window rolls forward', async t => {
  const db=openQueue(':memory:'), dir=await mkdtemp(join(tmpdir(),'rate90-calendar-'));
  t.after(async()=>{db.close();await rm(dir,{recursive:true,force:true});});
  const base={teams:[],fixtures:[],sample:{capturedOn:'2026-11-22',matches:[]}};
  const client=vendor();
  await tick(db,client,kickoff);
  await tick(db,client,kickoff+20*DAY);
  await publishCollected(db,base,dir);
  const feed=await storedFeed('2026-11-22',false,dir);
  assert.deepEqual(feed.matches,[]);
  assert.equal(feed.partial,false);
  assert.equal(await storedFeed('2026-01-01',false,dir),null);
});

test('archive and stored days merge by ID and age, with legacy data sanitized on every API path', async t => {
  const dir = await mkdtemp(join(tmpdir(),'rate90-merge-'));
  t.after(() => rm(dir,{recursive:true,force:true}));
  const day = '2026-11-22', old = '2026-11-22T05:00:00Z', fresh = '2026-11-22T11:50:44Z';
  const legacyCard = {id:'42',stage:'英超',kickoff:old,home:'Home',away:'Away',rating:5,
    viewing:{styles:['双向对攻'],pressure:Array(90).fill(0)},details:{score90:[3,0],goalsOnlyRank:1}};
  const archivedCard = {...legacyCard,rating:6.6,details:{lineups:{
    home:{formation:'4-3-3',coach:'Coach',players:[{name:'Player',number:'8',goals:1}]},away:{}
  },events:[{type:'goal',minute:42,side:'home'},{type:'card',card:'red',player:'X',minute:47,side:'away'}]}};
  await atomicAsset(dir,'legacy',{mode:'sample',sampleOnly:true,updatedAt:old,matches:[legacyCard,{...legacyCard,id:'43'}]});
  await atomicAsset(dir,'round',{mode:'stored',sampleOnly:false,partial:true,updatedAt:fresh,matches:[archivedCard]});
  const fixture = {id:'42',status:'finished',day};
  const collected = {days:{[day]:{file:'legacy'}},fixtures:[fixture],coveredDays:[day]};
  await atomicAsset(dir,'collected-index',collected);
  await atomicAsset(dir,'process-ratings',{days:{[day]:{file:'round'}},fixtures:[{...fixture,capturedAt:fresh}]});
  const stored = (d,details) => storedFeed(d,details,dir);
  const url = new URL('http://localhost/api/matches?date='+day+'&reveal=1');
  const merged = await getFeed(url,null,null,stored);
  assert.equal(merged.mode,'stored');
  assert.equal(merged.sampleOnly,false);
  assert.equal(merged.updatedAt,new Date(fresh).toISOString());
  assert.deepEqual(merged.matches.map(card => card.id),['42','43']);
  const [first,second] = merged.matches;
  assert.equal(first.rating,6.6);
  assert.deepEqual(first.viewing,{styles:[],styleIds:[]});
  assert.equal(first.details.lineups.home.players[0].name,'Player');
  assert.ok(!('goals' in first.details.lineups.home.players[0]));
  assert.deepEqual(first.details.events.map(event => event.type),['card']);
  assert.ok(!('score90' in second.details));
  assert.deepEqual(second.details.pressure,Array(90).fill(0));
  url.searchParams.set('source','live');
  const fallback = await getFeed(url,null,async () => { throw Error('offline'); },stored);
  assert.equal(fallback.update,'upstream-unavailable');
  assert.deepEqual(fallback.matches,merged.matches);
  collected.fixtures[0] = {...fixture,status:'postponed',observedAt:'2026-11-23T01:00:00Z'};
  await atomicAsset(dir,'collected-index',collected);
  assert.deepEqual((await stored(day,false)).matches.map(card => card.id),['43']);
});

test('finished kickoff corrections preserve facts and move the published card to the new viewing day', async t => {
  const dir=await mkdtemp(join(tmpdir(),'rate90-corrected-'));
  const db=openQueue(':memory:'); t.after(async()=>{db.close();await rm(dir,{recursive:true,force:true});});
  const client=vendor(game(1,{status:'finished',event_date:'2026-11-21T03:59:00Z'}));
  const base={teams:[],fixtures:[],sample:{capturedOn:'2026-11-21',matches:[]}};
  await tick(db,client,kickoff);
  const before=getRow(db).facts;
  client.events[0].event_date='2026-11-21T04:01:00Z';
  client.event=async()=>{throw Error('offline');};
  await tick(db,client,kickoff+DAY);
  assert.equal(getRow(db).facts,before);
  await publishCollected(db,base,dir);
  const [card]=(await storedFeed('2026-11-22',false,dir)).matches;
  assert.ok(Number.isFinite(card.rating));
  assert.equal(card.kickoff,'2026-11-21T04:01:00.000Z');
  assert.equal((await storedFeed('2026-11-21',false,dir)).matches.length,0);
});

test('stalled matches switch to daily checks and resume when the provider marks them finished', async t => {
  const db=openQueue(':memory:');t.after(()=>db.close());
  const client=vendor(game());
  await tick(db,client,kickoff);
  await tick(db,client,kickoff+2*DAY);
  assert.equal(getRow(db).due,kickoff+3*DAY);
  const revision=db.prepare("select value from meta where key='revision'").get().value;
  await tick(db,client,kickoff+3*DAY);
  assert.equal(db.prepare("select value from meta where key='revision'").get().value,revision);
  client.events[0].status='finished';
  await tick(db,client,kickoff+4*DAY);
  assert.ok(getRow(db).facts);
});

test('vendor rate limits pause all work across ticks until Retry-After expires', async t => {
  const db=openQueue(':memory:');t.after(()=>db.close());
  let calls=0;
  const client={list:async()=>{calls++;throw Object.assign(Error('BSD HTTP 429'),{status:429,retryAfterMs:2*DAY});}};
  await tick(db,client,kickoff);
  await tick(db,client,kickoff+DAY);
  assert.equal(calls,1);
  await tick(db,client,kickoff+2*DAY);
  assert.equal(calls,2);
});

test('retiring a snapshot preserves a grace period; cleanup retains files referenced by the current index', async t => {
  const dir=await mkdtemp(join(tmpdir(),'rate90-retention-'));
  const db=openQueue(':memory:');t.after(async()=>{db.close();await rm(dir,{recursive:true,force:true});});
  const base={teams:[],fixtures:[],sample:{capturedOn:'2026-11-22',matches:[]}};
  const client=vendor(game(1,{status:'finished',round:'Round of 16',round_number:1}));
  await tick(db,client,at(125));await publishCollected(db,base,dir);
  const index=await readAsset(dir,'collected-index');
  assert.equal(index.fixtures[0].round,'Round of 16');
  const file=join(dir,Object.values(index.days)[0].file+'.js'), ancient=new Date(0);
  await utimes(file,ancient,ancient);
  await tick(db,client,at(485));await publishCollected(db,base,dir);
  await access(file);
  const archive=await readAsset(dir,'collected-index');
  const current=join(dir,Object.values(archive.days)[0].file+'.js');
  assert.notEqual(current,file);
  await utimes(file,ancient,ancient);await utimes(current,ancient,ancient);
  await tick(db,client,kickoff+2*DAY);await publishCollected(db,base,dir);
  await assert.rejects(access(file),{code:'ENOENT'});
  await access(current);
});

test('season import resumes after an interrupted detail, preserving windows, phases and league stage names', async () => {
  const db = openQueue(':memory:');
  const now = Date.parse('2026-07-24T02:00:00Z'), at = '2026-07-08T12:00:00Z';
  const game = {id:3,event_date:at,league:{id:7},season:{year:2026},status:'finished',
    home_team:'A',away_team:'B',round_name:'Qualification Round 1',round_number:1};
  const calls = [];
  let offline = true;
  const client = {
    list:async (league,from,to) => {
      calls.push([league,+from,+to]);
      return league === 7 && +from <= Date.parse(at) && Date.parse(at) < +to ? [game] : [];
    },
    event:async () => { if (offline) throw Error('offline'); return game; }
  };
  try {
    const first = await collectSeason(db,client,{now});
    assert.deepEqual(first.errors,['offline']);
    assert.equal(calls.length,12);
    assert.ok(calls.every(([,from,to]) => from >= Date.parse('2026-07-01T00:00:00+08:00') && to <= Date.parse('2026-07-25T00:00:00+08:00')));
    offline = false;
    const second = await collectSeason(db,client,{now});
    assert.equal(second.calendars,6);
    assert.equal(second.details,1);
    assert.equal(JSON.parse(db.prepare('select fixture from games').get().fixture).round,'Qualification Round 1');
    assert.equal((await collectSeason(db,client,{now})).details,0);
  } finally { db.close(); }
});
