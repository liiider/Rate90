import test from 'node:test';
import assert from 'node:assert/strict';
import {incidentReasons, matchStyles} from './style-tags.mjs';

const tags = match => matchStyles(match).styleIds;
const eventTags = incidents => tags({incidentReasons:incidentReasons({incidents},false)});
const goal = {type:'goal',goal_type:'regular',minute:15,is_home:true,home_score:1,away_score:0,player_id:8};
test('ordinary totals alone give no reason; an end-to-end game needs credible chances for both sides',() => {
  assert.deepEqual(tags({styleStats:{crosses:[60,33],corners:[9,9]}}),[]);
  const m = {shotsByWindow:[4,4,4,4,4,4],chancesByWindow:[2,1,2,1,2,0],chanceSides:[4,4],xgCount:24,shotEvidence:{contestedWindows:2}};
  assert.deepEqual(tags(m),['end-to-end']);
  for(const change of [{chanceSides:[1,7]},{xgCount:23},{shotEvidence:{contestedWindows:1}}]) assert.deepEqual(tags({...m,...change}),[]);
});
test('elite opposition is frozen by season; familiar rivals are independently identified',() => {
  const m = {home:'Real Madrid',away:'FC Barcelona',kickoff:'2026-10-01'};
  assert.deepEqual(tags(m),['heavyweights','rivalry']);
  assert.deepEqual(tags({...m,kickoff:'2024-03-01'}),['rivalry']);
  assert.deepEqual(tags({...m,away:'Getafe'}),[]);
});
test('player-related reasons require distinct consequential events involving the same player',() => {
  assert.deepEqual(eventTags([goal,goal]),[]);
  assert.ok(incidentReasons({incidents:[{...goal,minute:87}],home_score:1,away_score:0},false).talisman);
  assert.ok(!incidentReasons({incidents:[{...goal,minute:87}],home_score:1,away_score:1},false).talisman);
  assert.deepEqual(eventTags([goal,{...goal,minute:82,away_score:2,home_score:2}]),['talisman']);
  assert.deepEqual(eventTags([goal,{type:'card',card_type:'yellow',minute:43,player_id:8}]),[]);
  assert.deepEqual(eventTags([goal,{type:'card',card_type:'red',minute:75,player_id:8}]),['flashpoint-player']);
});
test('a combination requires a sustained passing sequence and identifiable contributors',() => {
  const sequence = [1,2,3,4].map((player_id,i) => ({event:'pass',player_id,assist:i === 3}));
  assert.deepEqual(eventTags([{...goal,sequence}]),['team-move']);
  assert.deepEqual(eventTags([{...goal,sequence:sequence.slice(1)}]),[]);
  assert.deepEqual(eventTags([{...goal,period:3,sequence}]),[]);
});
test('an official panel finding is separate from a routine review or dissent',() => {
  const review={type:'varDecision',decision:'goalNotAwarded',minute:75,player_id:6};
  assert.deepEqual(eventTags([review]),['var-spotlight']);
  assert.deepEqual(eventTags([review,{type:'card',reason:'Dissent',minute:75,player_id:6}]),['var-spotlight']);
  assert.deepEqual(tags({id:'209572',incidentReasons:{'var-spotlight':true}}),['contested-call']);
  assert.deepEqual(eventTags([{...review,decision:'review'}]),[]);
});
