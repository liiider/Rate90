import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import vm from 'node:vm';
import {openQueue, seedBackfill, tick, DAY, MINUTE} from './collector.mjs';
import {loadBaseline, publishCollected} from './publish-collected.mjs';
import {readAsset, storedFeed} from './collected-feed.mjs';
import {getFeed} from '../api/matches.mjs';

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

test('daily schedule follows Beijing noon; backfill is bounded, idempotent and covers the 83 reference games', async t => {
  const db=openQueue(':memory:'); t.after(()=>db.close());
  const base=await loadBaseline(); assert.equal(new Set(base.backfill).size,83);
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

test('published snapshot reaches API and static catalog; corrections are atomic and spoilers stay behind reveal', async t => {
  const db=openQueue(':memory:'); const dir=await mkdtemp(join(tmpdir(),'rate90-public-'));
  t.after(async()=>{db.close();await rm(dir,{recursive:true,force:true});});
  const client=vendor(game(1,{status:'finished',home_team:'Liverpool FC',away_team:'Aston Villa'}));
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
  url.searchParams.set('reveal','1');
  assert.deepEqual((await getFeed(url,null,offline,stored)).matches.find(m=>m.id==='1').details.score90,[0,0]);

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
  assert.deepEqual((await window.Rate90.catalog.loadMatchDetails(alias)).score90,[0,0]);
  client.events[0].home_score=1;
  client.events[0].shotmap.push({min:85,type:'goal',gtype:'own',home:true,xg:null,xgot:null});
  await tick(db,client,at(485));
  await publishCollected(db,base,dir);
  assert.notEqual((await readAsset(dir,'collected-index')).days[day].file, firstFile);
  assert.deepEqual((await readAsset(dir,firstFile)).matches.find(m=>m.id==='1').details.score90,[0,0]);
  const corrected=(await getFeed(url,null,offline,stored)).matches.find(m=>m.id==='1');
  assert.deepEqual(corrected.details.score90,[1,0]);
  assert.equal(corrected.details.xg90,0.5);
  assert.ok(Number.isFinite(corrected.rating));
  assets['collected-index']=await readAsset(dir,'collected-index');
  await window.Rate90.catalog.loadCatalog();
  const revealed=await window.Rate90.catalog.loadMatchDetails(alias);
  assert.equal(revealed.xg90,corrected.details.xg90);
  assert.deepEqual(revealed.score90,[1,0]);
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
