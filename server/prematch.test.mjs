import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openQueue} from './collector.mjs';
import {atomicAsset,readAsset} from './collected-feed.mjs';
import {matchForm,nextRounds,recentPattern,scopesFor,standingContext,teamHistory} from './prematch.mjs';
import {refreshPrematch} from './prematch-worker.mjs';
import {aiSettings,selectGames} from './prematch-ai.mjs';
import {createBsdClient} from './bsd.mjs';

test('BSD current season exposes the season ID used for fixtures for nested and flat responses',async()=>{
  const season={id:1058,name:'Premier League 26/27',year:2026};
  for (const payload of [{league_id:1,season},season]) {
    const client=createBsdClient('test',async url=>{
      if (url.pathname==='/api/v2/leagues/1/season/') return Response.json(payload);
      assert.equal(url.pathname,'/api/events/');
      assert.equal(url.searchParams.get('league'),'1');
      assert.equal(url.searchParams.get('season'),'1058');
      return Response.json({results:[{id:209653}],next:null});
    });
    const current=await client.season(1);
    assert.deepEqual(current,season);
    assert.deepEqual(await client.seasonFixtures(1,current.id),[{id:209653}]);
  }
  const missing=createBsdClient('test',async()=>Response.json({id:1,season:null}));
  await assert.rejects(missing.season(1),/BSD 赛季 ID 无效 1/);
});

test('season fixtures follow the BSD offset while its page parameter stays constant',async()=>{
  const offsets=[];
  const client=createBsdClient('test',async url=>{
    assert.equal(url.searchParams.get('season'),'1058');
    assert.equal(url.searchParams.get('league'),'1');
    const offset=Number(url.searchParams.get('offset'));
    offsets.push(offset);
    return Response.json({results:[{id:offset+1}],next:offset===2?null:
      'https://sports.bzzoiro.com/api/events/?league=1&limit=1&offset='+(offset+1)+'&page=1&season=1058'});
  });
  assert.deepEqual(await client.seasonFixtures(1,1058),[{id:1},{id:2},{id:3}]);
  assert.deepEqual(offsets,[0,1,2]);
});

test('future rounds exclude unfinished prior rounds, retain both legs and span long breaks',()=>{
  const g=(id,round,kickoff,status='upcoming',extra={})=>({id:String(id),league:'cl',season:1,stage:'league',round,kickoff,status,home:'A',away:'B',...extra});
  const rows=[g(1,1,9,'finished'),g(2,1,40),g(3,2,50),g(4,3,150)];
  assert.deepEqual(nextRounds(rows,10).map(r=>r.round),[2,3]);
  const legs=[g(5,'Semifinal',40,'upcoming',{stage:'semi'}),g(6,'Semifinal',100,'upcoming',{stage:'semi',home:'B',away:'A',previousLegId:5})];
  assert.deepEqual(nextRounds(legs,10).map(r=>r.leg),[1,2]);
});
test('facts for the editor reflect only regulation play and distinguish incomplete xG',()=>{
  const s={type:'miss',home:true,xg:.2,min:46,period:1};
  const result=matchForm({shotmap:[s,{...s,min:80,period:2,home:false,sit:'penalty',xg:.78},{...s,type:'goal',gtype:'own'},{...s,period:3}]});
  assert.deepEqual(result.map(x=>[x.shots,x.npxg]),[[1,.2],[1,0]]);
  assert.equal(result[0].chances[2],1);
  assert.equal(matchForm({shotmap:[{...s,xg:null}]}),null);
  assert.equal(matchForm({shotmap:[{...s,period:5}]}),null);
  assert.equal(standingContext([{id:1,position:1,points:28},{id:2,position:18,points:9,zone:'relegation'}],'',1).pointsAboveFirstRelegationPlace,19);
});
test('recent patterns use only available regulation shot maps in the last six matches',t=>{
  const db=openQueue(':memory:');t.after(()=>db.close());
  const add=db.prepare('INSERT INTO games(id,phase,fixture,facts,first_at,fetched_at) VALUES (?,\'done\',?,?,?,?)');
  const facts=JSON.stringify({shotmap:[
    {home:true,min:5,xg:.2},{home:true,min:79,xg:.25},{home:false,min:78,xg:.4}
  ]});
  for (let id=1;id<=8;id++) {
    const fixture={home:'A',away:'B',league:1,kickoff:id,status:'finished',replacedBy:id===8?'9':null};
    add.run(id,JSON.stringify(fixture),id===5?null:facts,id,id===6?100:id);
  }
  const recent=teamHistory(db,10).get('pl/A');
  assert.equal(recent.length,6);
  assert.deepEqual(recent.map(g=>!!g.for),[true,false,false,true,true,true]);
  assert.deepEqual(recentPattern(recent),{samples:4,twoSided:4,bothHalves:4,lateThreatFor:4,lateThreatAgainst:4});
});
test('a mixed matchday has independent all-competition and single-competition pools',()=>{
  const kickoff=Date.parse('2026-11-25T01:00:00+08:00');
  const pl={id:'1',league:'pl',kickoff}, cl={id:'2',league:'cl',kickoff};
  const scopes=scopesFor([{key:'pl-12',games:[pl]}],[cl]);
  assert.deepEqual(scopes.get('date/2026-11-25'),[pl,cl]);
  assert.deepEqual(scopes.get('date/2026-11-25/cl'),[cl]);
});
test('Sol uses the Responses endpoint and rejects invented or repeated fixtures',async()=>{
  const cfg=aiSettings({OPENAI_API_KEY:'test'}),ctx={games:[{id:'1'},{id:'2'}]};
  const f=picks=>async(url,options)=>{
    assert.equal(url.pathname,'/v1/responses');
    const body = JSON.parse(options.body);
    assert.equal(body.model,'gpt-6.2-sol');
    assert.equal(body.text.format.type,'json_object');
    assert.equal(body.input[0].role,'user');
    assert.match(body.input[0].content[0].text,/\bJSON\b/);
    assert.deepEqual(JSON.parse(body.input[0].content[1].text),ctx);
    return {ok:true,json:async()=>({output:[{content:[{type:'output_text',text:JSON.stringify({picks})}]}]})};
  };
  const p=id=>({id,reason:'有持续的进攻机会',reasonEn:'Both sides repeatedly create chances.'});
  assert.deepEqual(await selectGames(cfg,ctx,f([])),[]);
  assert.deepEqual(await selectGames(cfg,ctx,f([p('2')])),[p('2')]);
  assert.equal((await selectGames(cfg,ctx,f([p('1'),p('2')]))).length,2);
  await assert.rejects(selectGames(cfg,ctx,f([p('1'),p('1')])));
  await assert.rejects(selectGames(cfg,ctx,f([p('1'),p('3')])));
  await assert.rejects(selectGames(cfg,ctx,f([{id:'1',reason:'缺少译文'}])));
});
test('collector publishes two complete rounds and caches distinct by-date and by-round Sol selections',async t=>{
  const db=openQueue(':memory:');t.after(()=>db.close());
  const dir=await mkdtemp(join(tmpdir(),'r90-preview-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  await atomicAsset(dir,'collected-index',{fixtures:[],days:{}});
  const now=Date.now(),day=86400000;
  const past={kickoff:now-day,home:'A',away:'B',round:1,status:'finished',league:1};
  db.prepare('INSERT INTO games(id,phase,fixture,facts,first_at) VALUES (1,?,?,?,?)').run('done',JSON.stringify(past),
    JSON.stringify({shotmap:[{min:5,home:true,xg:.5,type:'save'}],odds_home:1.1}),now-day/2);
  const event=(id,round,dt)=>({id,league:{id:1},season:{id:1},home_team:'A',away_team:'B',home_team_obj:{id:4},away_team_obj:{id:5},
    status:'notstarted',round_number:round,event_date:new Date(dt).toISOString()});
  const fixtures=[event(2,2,now+2*day),event(3,3,now+23*day),
    {...event(4,2,now+2*day),away_team:'Unknown'}];
  const client={season:async l=>({id:l}),seasonFixtures:async l=>l===1?fixtures:[],standings:async()=>({standings:[]}),
    event:async()=>({unavailable_players:{home:[{name:'X',status:'doubtful'}],away:[]}}),teamFixtures:async()=>[]};
  let called=0;
  const ask=async(settings,ctx)=>{
    called++; assert.doesNotMatch(JSON.stringify(ctx),/rating|odds|recommendation/i);
    assert.equal(ctx.teams['pl/A'].recent[0].for.shots,1);
    assert.equal(ctx.teams['pl/A'].pattern.samples,1);
    assert.ok(ctx.games.every(g=>g.away!=='Unknown'));
    assert.equal(ctx.games[0].unavailable.players.home[0].status,'doubtful');
    return [{id:ctx.games[0].id,reason:'双方的进攻机会值得关注',reasonEn:'Both teams create dangerous chances.'}];
  };
  const options={dir,now,ai:{model:'gpt-6.2-sol'},ask,modelLimit:10};
  const base={teams:[],fixtures:[]};
  const first=await refreshPrematch(db,base,client,options);
  assert.deepEqual([first.rounds,first.picks,called],[2,4,4]);
  const index=await readAsset(dir,'collected-index'),feed=await readAsset(dir,index.prematchFile);
  assert.equal(feed.rounds[1].games[0].id,'3');
  assert.deepEqual(feed.picks['round/'+feed.rounds[0].key].ids,['2','4']);
  assert.doesNotMatch(JSON.stringify(feed),/doubtful|odds_home/);
  await refreshPrematch(db,base,client,{...options,now:now+30000});
  assert.equal(called,4);
  assert.equal((await readAsset(dir,'collected-index')).prematchFile,index.prematchFile);
});
