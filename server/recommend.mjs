const tiers = ['看全场', '看集锦', '可跳过', '资料不足'];
const sum = values => values.reduce((a, b) => a + b, 0);

function rate(match) {
  const {shotsByWindow: shots, chancesByWindow: chances, chanceSides: sides} = match;
  if (!shots || !chances || !sides || !Number.isFinite(match.xg90) ||
      match.xgCount !== sum(shots) || sum(shots) === 0 || sum(sides) !== sum(chances)) {
    return {tier:3, windows:0, balance:0, chances:0};
  }
  const windows = chances.filter(n => n > 0).length;
  const balance = Math.min(...sides);
  const total = sum(chances);
  const tier = (windows >= 5 && balance >= 2) ? 0 : total > 0 ? 1 : 2;
  return {tier, windows, balance, chances:total};
}

export function formatFeed(feed, reveal = false) {
  const {matches,...meta}=feed;
  const rated=matches.map(match=>({match,rating:rate(match)}));
  rated.sort((a,b)=>a.rating.tier-b.rating.tier || b.rating.windows-a.rating.windows ||
    b.rating.balance-a.rating.balance || b.rating.chances-a.rating.chances ||
    a.match.kickoff.localeCompare(b.match.kickoff) || a.match.id.localeCompare(b.match.id));
  const goalTotals=matches.filter(m=>Array.isArray(m.score90)).map(m=>sum(m.score90));
  return {...meta, ruleVersion:'trial-1', matches:rated.map(({match,rating},index)=>{
    const {id,stage,kickoff,home,away}=match;
    const recommendation=tiers[rating.tier];
    const card={id,stage,kickoff,home,away,recommendation,topPick:index===0 && rating.tier===0};
    if (!reveal) return card;
    const total=Array.isArray(match.score90)?sum(match.score90):null;
    const reason=rating.tier===3 ? '可用于分析的常规时间射门资料不足。' :
      '常规时间有 '+rating.chances+' 次关键机会，分布在 '+rating.windows+' 个 15 分钟时段，双方分别创造 '+
      match.chanceSides.join('、')+' 次。';
    return {...card,details:{...match,reason,processRank:rating.tier===3?null:index+1,
      goalsOnlyRank:total===null?null:1+goalTotals.filter(n=>n>total).length}};
  })};
}
