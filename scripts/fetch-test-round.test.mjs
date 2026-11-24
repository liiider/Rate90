import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fetchRounds,selectRounds} from './fetch-test-round.mjs';
import {assetDirectory,readAsset} from '../server/collected-feed.mjs';

test('this snapshot selects 66 fixtures belonging to six active rounds',async()=>{
  const rounds=selectRounds(await readAsset(assetDirectory,'fixtures'));
  assert.deepEqual(rounds.map(r=>r.round),[11,13,12,10,11,4]);
  assert.equal(rounds.flatMap(r=>r.matches).length,66);
});

test('full test export retains provider-only fields, matches scheduled fixtures and resumes successful completed games',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'rate90-round-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const fixture={league:'pl',round:11,date:'2026-11-22',home:'1',away:'2'};
  const teams=[{id:'1',en:'Home'},{id:'2',en:'Away'}];
  const raw={id:30,league:{id:1},home_team:'Home',away_team:'Away',status:'upcoming',
    home_score:0,away_score:0,event_date:'2026-11-22T14:00:00Z',vendor_specific:{lineups:['record']}};
  const finished={...raw,id:20,status:'finished',shotmap:[{min:10,home:true,xg:0.2,type:'miss'}]};
  const rounds=[{league:'pl',leagueId:1,round:11,matches:[{...fixture,id:'20'}, {...fixture,id:'pl-11-1-2'}]}];
  const requests=[];
  const client={list:async()=>[raw],event:async(id,full)=>{assert.equal(full,true);requests.push(id);return id===20?finished:raw;}};
  const first=await fetchRounds(client,rounds,teams,dir);
  assert.equal(first.complete,true);
  assert.deepEqual(first.rounds[0],{league:'pl',round:11,scheduled:2,raw:2,finished:1,rated:1});
  assert.deepEqual(JSON.parse(await readFile(join(dir,'events','20.json'),'utf8')),finished);
  const second=await fetchRounds(client,rounds,teams,dir);
  assert.deepEqual(requests,[20,30,30]);
  assert.equal(second.matches[1].coverage.rating,null);
});
