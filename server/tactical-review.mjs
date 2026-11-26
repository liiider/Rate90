import {aiSettings, englishText, jsonInput, openaiRequest} from './prematch-ai.mjs';
import {editLaunchReview} from './collected-feed.mjs';

const sides = ['home','away'];
// Season 2026/27, rounds in scope when tactical coverage opened on 24 November.
const openingRounds = new Map([[1,11],[3,13],[4,12],[5,10],[6,11],[7,5]]);
export function tacticalFixture(f) {
  if (!openingRounds.has(f.league) || f.replacedBy || f.status !== 'finished' ||
      !Number.isFinite(f.kickoff) || f.kickoff < Date.parse('2026-07-01T00:00:00+08:00')) return false;
  if (f.kickoff >= Date.parse('2027-07-01T00:00:00+08:00')) return true;
  if (Number.isInteger(f.round)) return f.round >= openingRounds.get(f.league);
  return f.league === 7 && /knockout|play.?off|round of|final/i.test(f.round || '') &&
    f.kickoff >= Date.parse('2026-11-24T00:00:00+08:00');
}

export const tacticalPromptVersion = 'coach-review-3';
export const tacticalInstructions = `你为 Rate90 写赛后一队一篇的教练席复盘。读者是想看懂整场球的球迷。每队一次分析和评分，输出中英文两个版本，只评价 targetSide 的主帅。输入是比赛资料。
按时间让读者跟得上一条主线：这套首发准备怎样打，对方给这套打法出了什么题，主帅动了哪一处，后来有没有解决。先在心里选材，只发表有内容的节点。
赛前只用开场已知的双方阵型、首发和替补。选一组影响比赛的攻守对位，讲清本队得到什么、哪一处要有人照顾。把计划写成这套人选提供的选择。登记位置不能当作实际落位。
过程中，节点可以是一个持续暴露的问题、一处有时间依据的职责或阵型调整、一次决定性的换人，或一个验证效果的时段。找得到换位、改变压迫方式等明确事件时写进去；只有机会记录时，写哪条进攻线路反复形成、哪个区域守不住。按当时的比分、时间和场面选材。一次射门可以说明那个回合，连续回合才能支持持续变化。半场统计只描述相应半场，全场平均站位只供终场参考。
analysis 写实际发生的事。挑一两个能说明问题的事实，优先说明原方案为何遇阻、换了什么类型的人、替补在后续哪些回合真正起作用。不要替教练宣布内心意图。comment 是另一层：站在当时的教练席，你赞成还是质疑这一手，为什么这个选择值得，或教练为它付出了什么代价？给一个有比赛依据的判断；有更合适的具体选项再提。不要复述 analysis，也不用每条都说“我会”。点评优先写教练会不会动这一处、动了会保住什么或放掉什么。避免逐个指导球员怎么贴身、怎么转身。后来的得失只在相应的后续节点评价，给得分者、队友和对手各自应有的归因。
全文直接谈球。无法核实的命令、阵型、站位、因果和换人原因直接略过，也删掉解释为什么略过的句子。如果一个节点只剩换人名单或数据说明，就并入有价值的相邻节点或略去。保留球队真正的缺陷，例如“控球占优，却进不了禁区”。不要写数据免责声明。具体核对三件事：比分数组是[主,客]，逐球核对领先次数，没必要计数就直接写当时的比分；比较调整效果时，优先写替补本人参与的回合，并检查同样的问题或机会在换人前是否已经出现；有射门地点不等于知道持球队员受到了哪种压迫。球员参与一次或两次进球，写出他在这些回合的作用，别扩大成整段打法都已改善。助攻以进球事件的 assist 为准，只有配合链时就写参与了哪一步。同分钟若有多条记录，节点边界优先用正文实际讨论的那次换人或进球 ID。
终场 analysis 点出决定走势的变化。comment 明确哪项决定加分、哪个具体问题扣分，和顶层 score 对得上。按教练能影响的部分给 0–10 分。用球迷熟悉的中文名；每段一两句，少堆数字。
每个节点先写中文 analysis、comment，再写对应的英文 analysisEn、commentEn。英文像足球专栏编辑写的复盘，使用原始人名和球队英文名，准确保留中文判断、因果、比分及时间范围，两个语言版本不另行评分、不增加证据或结论。保持与中文相同的节点。
输出 JSON {"side":"home 或 away","nodes":[{"from":"证据ID","to":"证据ID","analysis":"…","comment":"…","analysisEn":"…","commentEn":"…"}],"score":8.0}。side 等于 targetSide。首节点 from/to 都是 XI，末节点都是 FT。中间节点从 evidence 选有时间的 ID，按时间先后，不重叠，单一时刻 from 等于 to。时间栏只写时间，由系统从 ID 生成。`;

const list = v => Array.isArray(v) ? v : [];
const sideOf = home => home === true ? 'home' : home === false ? 'away' : undefined;
const clockRank = (minute, added = 0) => minute * 1000 + added;
function position(value) {
  return Number.isFinite(value?.x) && Number.isFinite(value?.y) ? [value.x,value.y] : undefined;
}
function clock(minute, added) {
  if (!Number.isInteger(minute) || minute < 0 || minute > 120) return null;
  const extra = Number.isInteger(added) && added > 0 && added < 100 ? added : 0;
  return {time:minute + (extra ? '+' + extra : '') + '′',rank:clockRank(minute,extra)};
}

function phaseStats(period) {
  if (!period) return null;
  const keys=['ball_possession','final_third_entries','shots_inside_box','big_chances','expected_goals',
    'total_shots','long_balls','through_balls','crosses','clearances'];
  const result={};
  for (const side of sides) {
    const stats=Object.fromEntries(keys.filter(k=>period[side]?.[k]!=null).map(k=>[k,period[side][k]]));
    if (Object.keys(stats).length) result[side]=stats;
  }
  return Object.keys(result).length ? result : null;
}

export function buildTacticalContext(f, raw, targetSide, names = new Map()) {
  const namesById = new Map();
  const teams = {};
  for (const side of sides) {
    const team = raw.lineups?.confirmed === true ? raw.lineups[side] : null;
    const players = rows => list(rows).filter(p => p?.name).map(p => {
      if (p.player_id != null) namesById.set(p.player_id,p.name);
      return {name:p.name,role:p.specific_position ?? p.position};
    });
    teams[side] = {name:names.get(f[side]) || f[side],nameEn:f[side],coach:raw[side+'_coach']?.name,
      formation:team?.formation,starters:players(team?.players),bench:players(team?.substitutes)};
  }
  const evidence = [];
  for (const e of list(raw.incidents)) {
    if (!e || !['substitution','card','goal','penalty_missed','formation_change','position_change','tactical_change'].includes(e.type)) continue;
    const at = clock(e.minute,e.added_time);
    if (!at || !sideOf(e.is_home)) continue;
    const entry = {id:'E'+evidence.length,...at,side:sideOf(e.is_home),type:e.type,player:e.player,
      playerIn:e.player_in,playerOut:e.player_out,card:e.card_type,goalType:e.goal_type,assist:e.type==='goal' ? e.assist : undefined,
      score:e.type==='goal' ? [e.home_score,e.away_score] : undefined,
      formation:e.formation,position:e.new_position,description:e.description};
    if (e.type==='goal') entry.moves = list(e.sequence).map(p => ({action:p.event,player:p.player,position:position(p.pos),end:position(p.end)}));
    evidence.push(entry);
  }
  for (const s of list(raw.shotmap)) {
    if (!s || !sideOf(s.home) || /shoot.?out/i.test(s.sit || '') || s.period===5) continue;
    const at=clock(s.min,s.added);
    if (at) evidence.push({id:'S'+evidence.length,...at,side:sideOf(s.home),type:'shot',player:namesById.get(s.player_id),
      situation:s.sit,result:s.type,xg:Number.isFinite(s.xg)?Number(s.xg.toFixed(2)):undefined,
      position:position(s.pos)});
  }
  const half=phaseStats(raw.live_stats?.first_half);
  if (half) evidence.push({id:'HT',time:'中场',rank:clockRank(45,999),type:'first_half_stats',stats:half});
  evidence.sort((a,b)=>a.rank-b.rank);
  const averagePositions=Object.fromEntries(sides.map(side=>[side,list(raw.average_positions?.[side]).map(p=>({
    player:namesById.get(p.player_id) || p.name,position:position(p)}))]));
  return {targetSide,teams,evidence,fullTime:{averagePositions,secondHalf:phaseStats(raw.live_stats?.second_half),score:[raw.home_score,raw.away_score],extraTime:raw.extra_time_score,
    shootout:raw.penalty_shootout}};
}

// Keep checks about the available evidence out of published prose. Match
// editorial language specifically so a real weakness such as 无法推进 survives.
const editorialAside = /(?:不足以|不能|无法|难以|无从)(?:据此|就此|单独|直接|仅凭[^，。；]{1,10})?(?:证明|确认|断定|判定|推断|断言|认定)|(?:资料|数据|名单|记录|证据)(?:本身)?(?:还)?不足以|(?:资料|数据|名单|记录)(?:并未|未|没有)(?:交代|说明原因|提供站位)|(?:没有|缺少|缺乏)(?:足够|直接|明确|分段站位|连续回合)?证据/u;
function reviewParagraph(text) {
  // A semicolon can separate an observation from an unrelated editorial aside.
  const kept = (text.match(/[^。！？；]+[。！？；]?/gu) || []).filter(sentence => !editorialAside.test(sentence));
  return kept.join('').trim().replace(/；$/u,'。');
}

export function checkedReview(answer, context) {
  if (answer?.side !== context.targetSide || !Number.isFinite(answer.score) || answer.score<0 || answer.score>10 ||
      !Array.isArray(answer.nodes) || answer.nodes.length<3 || answer.nodes.length>24) throw Error('战术复盘格式无效');
  const byId = new Map(context.evidence.map(e=>[e.id,e]));
  byId.set('XI',{time:'赛前',rank:-1});
  byId.set('FT',{time:'终场',rank:Infinity});
  let last = -Infinity;
  const nodes = answer.nodes.map((node,i) => {
    const start = byId.get(node?.from), end = byId.get(node?.to);
    const endpoint = i===0 ? 'XI' : i===answer.nodes.length-1 ? 'FT' : null;
    if (!start || !end || start.rank<last || end.rank<start.rank ||
        (endpoint ? node.from!==endpoint || node.to!==endpoint : ['XI','FT'].includes(node.from) || ['XI','FT'].includes(node.to)) ||
        ![node.analysis,node.comment].every(s=>typeof s==='string' && s.trim() && s.length<=650)) throw Error('战术时间线或点评无效');
    const analysis = reviewParagraph(node.analysis);
    const comment = reviewParagraph(node.comment);
    if (!analysis || !comment || analysis===comment) throw Error('战术节点缺少独立分析或点评');
    if (!englishText(node.analysisEn,1600) || !englishText(node.commentEn,1600) ||
        node.analysisEn.trim()===node.commentEn.trim()) throw Error('战术节点缺少英文分析或点评');
    last=end.rank;
    return {time:start.rank===end.rank ? start.time : start.time+'–'+end.time,analysis,comment,
      analysisEn:node.analysisEn.trim(),commentEn:node.commentEn.trim()};
  });
  return {nodes,score:answer.score};
}

async function requestReview(ai, context, instructions) {
  const response=await openaiRequest(ai.url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(120000),
    headers:{'Content-Type':'application/json',Authorization:'Bearer '+ai.key},
    body:JSON.stringify({model:ai.model,store:false,reasoning:{effort:'low'},max_output_tokens:10000,
      instructions,input:jsonInput(context),text:{format:{type:'json_object'}}})},ai.socket);
  if (!response.ok) throw Error('AI HTTP '+response.status);
  const data=await response.json();
  const output=data.output?.flatMap(item=>item.content ?? []).filter(c=>c.type==='output_text').map(c=>c.text).join('');
  return {answer:JSON.parse(output || 'null'),usage:data.usage};
}

const askTactics = (ai, context) => requestReview(ai,context,tacticalInstructions);
const translateTactics = (ai, context) => requestReview(ai,context,`Translate each existing Chinese tactical review paragraph into natural football English. Preserve the published text's facts, scope, judgments, names, figures and chronological order. Use the provided English names where applicable. Return only JSON {"nodes":[{"analysisEn":"…","commentEn":"…"}]}, with one entry in exactly the same order for each input node. Do not alter the rating or add analysis.`);

export function translatedReview(review, answer) {
  if (!Array.isArray(answer?.nodes) || answer.nodes.length!==review.nodes?.length) throw Error('英文复盘节点数量异常');
  return {...review,nodes:review.nodes.map((node,i)=>{
    const {analysisEn,commentEn}=answer.nodes[i]??{};
    if (!englishText(analysisEn,1600) || !englishText(commentEn,1600) || analysisEn.trim()===commentEn.trim())
      throw Error('英文复盘内容无效');
    return {...node,analysisEn:analysisEn.trim(),commentEn:commentEn.trim()};
  })};
}

// The collector's process lock covers inference and publishing. Completed sides survive process restarts.
export async function generateTactics(db, base, {ai=aiSettings(),ask=askTactics,translate=translateTactics,now=Date.now(),limit=4,gameIds=null}={}) {
  const report={generated:0,translated:0,attempted:0,errors:[]};
  if (!ai) return {...report,ai:'unconfigured'};
  if (limit<=0) return report;
  const names=new Map(base.teams.map(t=>[t.en,t.zh]));
  const jobs=db.prepare(`SELECT g.id,g.fixture,g.phase,s.side FROM games g CROSS JOIN
      (SELECT 'home' AS side UNION ALL SELECT 'away') s
    LEFT JOIN tactical_reviews t ON t.game_id=g.id AND t.side=s.side
    WHERE g.facts IS NOT NULL AND g.phase NOT IN ('check','stopped','fetch','backfill')
      AND json_extract(g.fixture,'$.status')='finished' AND json_extract(g.fixture,'$.replacedBy') IS NULL
      AND json_extract(g.fixture,'$.kickoff')>=? AND t.result IS NULL AND COALESCE(t.retry_at,0)<=?
      ${gameIds === null ? '' : 'AND g.id IN (SELECT value FROM json_each(?))'}
    ORDER BY COALESCE(t.retry_at,0),json_extract(g.fixture,'$.kickoff'),g.id,s.side DESC`).all(
      Date.parse('2026-07-01T00:00:00+08:00'),now,...(gameIds === null ? [] : [JSON.stringify(gameIds)]));
  const facts=db.prepare('SELECT facts FROM games WHERE id=?');
  const claim=db.prepare(`INSERT INTO tactical_reviews(game_id,side,retry_at) VALUES(?,?,?)
    ON CONFLICT(game_id,side) DO UPDATE SET retry_at=excluded.retry_at WHERE result IS NULL AND retry_at<=?`);
  const finish=db.prepare(`UPDATE tactical_reviews SET result=?,model=?,prompt_version=?,usage=?,retry_at=0
    WHERE game_id=? AND side=? AND result IS NULL`);
  for (const job of jobs) {
    const f=JSON.parse(job.fixture);
    if (!tacticalFixture(f) || f.kickoff>=now) continue;
    const raw=JSON.parse(facts.get(job.id).facts);
    const context=buildTacticalContext(f,raw,job.side,names);
    if (!context.evidence.length || (!context.teams[job.side].starters.length && job.phase!=='done')) continue;
    if (!claim.run(job.id,job.side,now+15*60000,now).changes) continue;
    report.attempted++;
    try {
      const {answer,usage}=await ask(ai,context);
      const review=checkedReview(answer,context);
      finish.run(JSON.stringify(review),ai.model,tacticalPromptVersion,JSON.stringify(usage??null),job.id,job.side);
      report.generated++;
    } catch (error) {
      report.errors.push({id:job.id,side:job.side,error:error.message});
    }
    if (report.attempted>=limit) break;
  }
  // Upgrade previously published reviews in the same bounded background queue.
  // The original rating, node times and edited Chinese copy are kept verbatim.
  if (gameIds===null && report.attempted<limit) {
    const legacy=db.prepare(`SELECT t.game_id AS id,t.side,t.result,g.fixture,g.facts FROM tactical_reviews t
      JOIN games g ON g.id=t.game_id WHERE t.result IS NOT NULL AND t.retry_at<=? AND EXISTS (
        SELECT 1 FROM json_each(t.result,'$.nodes') n WHERE COALESCE(json_extract(n.value,'$.analysisEn'),'')=''
          OR COALESCE(json_extract(n.value,'$.commentEn'),'')='')
      ORDER BY t.retry_at,json_extract(g.fixture,'$.kickoff') DESC,t.game_id,t.side`).all(now);
    const claimTranslation=db.prepare(`UPDATE tactical_reviews SET retry_at=? WHERE game_id=? AND side=? AND result=? AND retry_at<=?`);
    const finishTranslation=db.prepare(`UPDATE tactical_reviews SET result=?,retry_at=0 WHERE game_id=? AND side=? AND result=?`);
    for (const job of legacy) {
      const f=JSON.parse(job.fixture);
      if (!tacticalFixture(f) || f.kickoff>=now) continue;
      if (!claimTranslation.run(now+15*60000,job.id,job.side,job.result,now).changes) continue;
      report.attempted++;
      try {
        const day=new Date(f.kickoff+20*3600000).toISOString().slice(0,10);
        const review=await editLaunchReview(JSON.parse(job.result),day);
        const {teams}=buildTacticalContext(f,JSON.parse(job.facts || '{}'),job.side,names);
        const {answer}=await translate(ai,{teams,targetSide:job.side,nodes:review.nodes.map(({time,analysis,comment})=>({time,analysis,comment}))});
        report.translated+=finishTranslation.run(JSON.stringify(translatedReview(review,answer)),job.id,job.side,job.result).changes;
      } catch (error) {
        report.errors.push({id:job.id,side:job.side,error:error.message});
      }
      if (report.attempted>=limit) break;
    }
  }
  return report;
}
