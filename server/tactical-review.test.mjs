import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openQueue} from './collector.mjs';
import {publishCollected} from './publish-collected.mjs';
import {atomicAsset,readAsset,storedFeed} from './collected-feed.mjs';
import {buildTacticalContext,checkedReview,generateTactics,tacticalFixture} from './tactical-review.mjs';
import {roundIds,publishRoundReviews} from '../scripts/backfill-tactics-round.mjs';

const kickoff=Date.parse('2026-11-21T15:00:00Z'), now=kickoff+86400000;
const fixture={home:'A',away:'B',league:1,round:11,kickoff,status:'finished'};
const side=name=>({formation:'4-3-3',players:[{name,position:'F',player_id:name==='A1'?1:2,rating:9.0}]});
const facts={id:12,league:{id:1},home_team:'A',away_team:'B',event_date:new Date(kickoff).toISOString(),
  home_score:1,away_score:0,lineups:{confirmed:true,home:side('A1'),away:side('B1')},incidents:[
    {minute:55,is_home:true,type:'position_change',player:'A1',new_position:'LW'},
    {minute:90,added_time:3,is_home:true,type:'goal',home_score:1,away_score:0,player:'A1'}],
  shotmap:[{min:64,home:true,player_id:1,xg:0.25,sit:'regular',pos:{x:16,y:30}}]};
const base={teams:[],fixtures:[],sample:{matches:[]}};
function answer(ctx) {
  return {side:ctx.targetSide,score:7.5,nodes:['XI','E0','FT'].map(id=>({
    from:id,to:id,analysis:ctx.targetSide+' analysis',comment:'教练点评'}))};
}
test('tactical reviews send the JSON instruction and match data in a Responses user message',async t=>{
  const db=openQueue(':memory:');t.after(()=>db.close());
  db.prepare("INSERT INTO games(id,fixture,facts,phase,fetched_at) VALUES(?,?,?,'done',?)")
    .run(12,JSON.stringify(fixture),JSON.stringify(facts),now);
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    const {input,text}=JSON.parse(options.body);
    assert.equal(text.format.type,'json_object');
    assert.equal(input[0].role,'user');
    assert.match(input[0].content[0].text,/\bJSON\b/);
    const ctx=JSON.parse(input[0].content[1].text);
    return Response.json({output:[{content:[{type:'output_text',text:JSON.stringify(answer(ctx))}]}]});
  });
  const report=await generateTactics(db,base,{ai:{model:'test',key:'test',url:'https://example.invalid/v1/responses'},now,limit:1});
  assert.deepEqual(report.errors,[]);
  assert.equal(report.generated,1);
});
test('rollout includes completed games of launch rounds and excludes older rounds even when postponed',()=>{
  for (const [league,round] of [[1,11],[3,13],[4,12],[5,10],[6,11],[7,5]]) {
    assert.ok(tacticalFixture({...fixture,league,round}));
    assert.equal(tacticalFixture({...fixture,league,round:round-1,kickoff:now+86400000}),false);
  }
  assert.ok(tacticalFixture({...fixture,league:7,round:'Quarter-finals',kickoff:Date.parse('2027-04-01')}));
  assert.ok(tacticalFixture({...fixture,round:1,kickoff:Date.parse('2027-08-01')}));
  for (const override of [{replacedBy:2},{status:'live'},{kickoff:Date.parse('2025-12-01')}])
    assert.equal(tacticalFixture({...fixture,...override}),false);
});
test('position changes and time ranges require timed evidence; hindsight fields stay out of the starting roster',()=>{
  const ctx=buildTacticalContext(fixture,facts,'home');
  assert.equal(ctx.teams.home.starters[0].rating,undefined);
  assert.deepEqual(ctx.evidence.map(e=>e.time),['55′','64′','90+3′']);
  assert.equal(ctx.evidence[0].position,'LW');
  const data=answer(ctx);
  data.nodes[1].to='S2';
  assert.equal(checkedReview(data,ctx).nodes[1].time,'55′–64′');
  assert.throws(()=>checkedReview({...data,side:'away'},ctx));
  data.nodes[1].from='made-up';assert.throws(()=>checkedReview(data,ctx));
});
test('manual rollout selects just the six published rounds and leaves unfinished European games for later',()=>{
  const row = {id:'12',league:'pl',round:11,date:'2026-11-22',status:'finished',day:'2026-11-22'};
  const fixtures = [row,...[
    {id:'13',round:12},{id:'14',round:10},{id:'15',league:'cl',round:4},
    {id:'16',league:'cl',round:5,status:'notstarted'},{id:'17',date:'2027-11-22'},
    {id:'18',replacedBy:'25'},{id:'19',league:'cl',round:5},{id:'20',day:null},
    {id:'21',league:'ll',round:13},{id:'22',league:'sa',round:12},
    {id:'23',league:'bl',round:10},{id:'24',league:'l1',round:11}
  ].map(fields=>({...row,...fields}))];
  assert.deepEqual([...roundIds(fixtures)],[12,19,21,22,23,24]);
});
test('a standalone backfill skips other eligible games and only patches selected detail cards',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'rate90-manual-tactics-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const db=openQueue(':memory:');t.after(()=>db.close());
  const insert=db.prepare("INSERT INTO games(id,fixture,facts,phase,fetched_at) VALUES(?,?,?,'done',?)");
  for(const id of [12,13]) insert.run(id,JSON.stringify(fixture),JSON.stringify({...facts,id}),now);
  await publishCollected(db,base,dir);
  const initial=await readAsset(dir,'collected-index'), day='2026-11-22';
  const before=await readAsset(dir,initial.days[day].file);
  const preview=await readAsset(dir,initial.days[day].previewFile);
  const options={now,gameIds:[12],ai:{model:'mock'},ask:async(_,ctx)=>({answer:answer(ctx)})};
  assert.equal((await generateTactics(db,base,options)).generated,2);
  assert.equal((await generateTactics(db,base,options)).attempted,0);
  assert.equal((await generateTactics(db,base,{...options,gameIds:[]})).attempted,0);
  assert.equal(db.prepare('SELECT count(*) AS n FROM tactical_reviews WHERE game_id=13').get().n,0);
  delete initial.fixtures.find(f=>f.id==='12').tacticalCoverage;
  await atomicAsset(dir,'collected-index',initial);
  assert.equal(await publishRoundReviews(db,dir,new Set([12])),2);
  const after=await readAsset(dir,'collected-index'), updated=await readAsset(dir,after.days[day].file);
  assert.equal(after.fixtures.find(f=>f.id==='12').tacticalCoverage,true);
  assert.deepEqual(updated.matches.find(m=>m.id==='13'),before.matches.find(m=>m.id==='13'));
  assert.deepEqual(await readAsset(dir,after.days[day].previewFile),preview);
  assert.equal(updated.matches.find(m=>m.id==='12').details.tactics.away.score,7.5);
  db.prepare('DELETE FROM tactical_reviews WHERE game_id=12').run();
  assert.equal(await publishRoundReviews(db,dir,new Set([12])),2);
  assert.deepEqual(await readAsset(dir,'collected-index'),after);
});
test('side generation survives a failure and restart; only confirmed results appear in detail assets',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'rate90-tactics-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const path=join(dir,'queue.sqlite');let db=openQueue(path);t.after(()=>db.close());
  const insert=db.prepare("INSERT INTO games(id,fixture,facts,phase,fetched_at) VALUES(?,?,?,'done',?)");
  for (const [id,overrides] of [[12,{}],[13,{round:10}],[14,{status:'live'}]]) {
    insert.run(id,JSON.stringify({...fixture,...overrides}),JSON.stringify({...facts,id}),now);
  }
  let failAway=true;
  const calls=[];
  const options={now,ai:{model:'mock'},ask:async(ai,ctx)=>{
    calls.push(ctx.targetSide);
    if (ctx.targetSide==='away' && failAway) throw Error('timeout');
    return {answer:answer(ctx),usage:{input_tokens:500,output_tokens:200}};
  }};
  assert.equal((await generateTactics(db,base,options)).generated,1);
  await publishCollected(db,base,dir);
  const partial=await storedFeed('2026-11-22',true,dir);
  const details=partial.matches.find(m=>m.id==='12').details;
  assert.equal(details.tactics.home.score,7.5);assert.equal(details.tactics.away,null);
  assert.equal(partial.matches.find(m=>m.id==='13').details.tactics,undefined);
  const index=await readAsset(dir,'collected-index');
  const publicPreview=await readAsset(dir,index.days['2026-11-22'].previewFile);
  assert.ok(!JSON.stringify(publicPreview).includes('教练点评'));
  db.close();db=openQueue(path);failAway=false;
  assert.equal((await generateTactics(db,base,options)).attempted,0);
  options.now+=16*60000;
  assert.equal((await generateTactics(db,base,options)).generated,1);
  assert.equal((await generateTactics(db,base,options)).attempted,0);
  assert.deepEqual(calls,['home','away','away']);
  await publishCollected(db,base,dir);
  const updated=(await storedFeed('2026-11-22',true,dir)).matches.find(m=>m.id==='12');
  assert.equal(updated.details.tactics.away.nodes[0].analysis,'away analysis');
  assert.ok(!(await storedFeed('2026-11-22',false,dir)).matches.some(m=>m.details));
});
