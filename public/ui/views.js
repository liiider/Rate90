(() => {
'use strict';
const {leagues,recommendations,roundName,dateLabel,snapshotDate,dayOffset,escapeHtml:e,matchKey}=window.Rate90.catalog;
const {action,icon,hero,heroIcon,logo,heading,empty,matchRow,miniCard,chips,crest}=window.Rate90.components;

const leagueChoices=[['all','全部'],...Object.entries(leagues).map(([id,l])=>[id,l.short])];
const dataNote='<p class="note">赛季参考快照 · 2026年11月22日 · 评分来自 MustWatch90</p>';
const grid=ms=>'<div class="grid">'+ms.map(miniCard).join('')+'</div>';
function list(ms,state){return '<div class="match-list">'+ms.map((m,i)=>matchRow(m,i,{...state,details:state.details.get(matchKey(m))})).join('')+'</div>'}
function changeControls(current,back,next,dates=false){
  const middle=dates?'<input class="date-input" aria-label="选择看球日" id="match-date" type="date" value="'+e(current)+'">':'<span class="round-pill">'+e(current)+'</span>';
  return '<div class="controls">'+action(dates?'':'上一轮','previous',{symbol:'left',disabled:!back,title:dates?'前一天':'上一轮'})+middle+action(dates?'':'下一轮','next',{symbol:'right',disabled:!next,title:dates?'后一天':'下一轮'})+'</div>';
}
function dailyView(s){
  const l=s.route.league,date=s.route.date, feed=s.feed, subject=l==='all'?'五大联赛与欧冠':leagues[l].name;
  let html=hero(dateLabel(date),'北京时间 · '+subject,l==='all'?heroIcon(icon('moon')):logo(l),changeControls(date,true,true,true));
  html+='<div class="filter-box">'+chips('赛事',leagueChoices,l,'dailyLeague')+'</div>';
  if(!feed){return html+(s.loading?'<p class="notice" role="status">正在读取当日比赛…</p>':empty(location.protocol==='file:'?'离线预览收录了 11 月 5 日和 11 月 22 日的比赛。':'该比赛日的数据暂时无法更新。',action('重新加载','refresh')+' '+action('查看 11月22日联调样本','sample')))}
  const matches=s.daily.filter(m=>l==='all'||m.league===l);
  const info=feed.cached?'上次成功数据':feed.mode==='sample'?'BSD 联调样本 · 非完整赛程':'BSD 已同步';
  const time=feed.updatedAt?new Intl.DateTimeFormat('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'Asia/Shanghai'}).format(new Date(feed.updatedAt)):'';
  html+='<div class="filter-bar"><span>'+e(info)+(time?' · '+e(time):'')+(feed.partial?' · 部分场次资料不足':'')+'</span><span class="tail">'+matches.length+' 场比赛</span></div>';
  if(!matches.length)return html+empty('这个比赛日'+(l==='all'?'':leagues[l].short)+'没有已收录的完赛场次。',action('查看其他日期','dateFocus')+' '+action('查看联调样本','sample'));
  const pick=matches.find(m=>m.topPick)||matches.find(m=>m.recommendation==='看全场'||m.recommendation==='看集锦'), classified=matches.filter(m=>m!==pick&&m.recommendation!=='资料不足'), incomplete=matches.filter(m=>m!==pick&&m.recommendation==='资料不足');
  if(pick)html+=matchRow(pick,0,{...s,details:s.details.get(matchKey(pick))},true);
  if(classified.length)html+=heading(pick?'其余比赛':'回看建议','按推荐顺序')+list(classified,s);
  if(incomplete.length)html+=heading('资料不足',incomplete.length+' 场')+list(incomplete,s);
  return html;
}
function roundView(s){
  const {league,round}=s.route,l=leagues[league],all=s.catalog.archive.filter(m=>m.league===league),rounds=[...new Set(all.map(m=>m.round))];
  const inRound=all.filter(m=>m.round===round),filtered=inRound.filter(m=>s.min===0||m.rating!==null&&m.rating>=s.min);
  return hero(l.name,l.region+' · 2026/27 赛季',logo(league),changeControls(roundName(league,round),rounds.includes(round-1),rounds.includes(round+1)))+
    '<div class="filter-bar"><label for="minimum">最低评分</label><input id="minimum" type="range" min="0" max="10" step=".5" value="'+s.min+'"><output for="minimum">'+s.min+'</output><span class="tail">'+filtered.length+' / '+inRound.length+' 场</span></div>'+
    heading('本轮赛事','回看评分 / 10')+(filtered.length?list(filtered,s):empty('没有达到当前评分的比赛。',action('清除筛选','clearMin')))+dataNote;
}
function topView(s){
  const filt=s.top, all=s.catalog.archive, until=snapshotDate;
  const latest={};for(const id of Object.keys(leagues))latest[id]=Math.max(...all.filter(m=>m.league===id&&m.rating!==null).map(m=>m.round));
  const q=filt.query.trim().toLowerCase();
  const ms=all.filter(m=>m.rating!==null&&(filt.league==='all'||filt.league===m.league)&&m.rating>=filt.min&&
    (filt.period==='round'?m.round===latest[m.league]:filt.period==='all'||(m.date>=dayOffset(until,-Number(filt.period))&&m.date<=until))&&
    (!q||[m.home.zh,m.away.zh,m.home.en,m.away.en].some(n=>n.toLowerCase().includes(q)))).sort((a,b)=>b.rating-a.rating||b.date.localeCompare(a.date));
  return hero('精选比赛','在收录的比赛周中比较回看评分',heroIcon('⭐'))+
    '<div class="filter-box">'+chips('赛事',leagueChoices,filt.league,'topLeague')+chips('时段',[['round','最近比赛周'],['1','近两日'],['7','近一周'],['30','近一月'],['all','全部收录']],filt.period,'period')+
    chips('评分',[['0','不限'],['5','5+'],['6','6+'],['7','7+'],['8','8+']],String(filt.min),'topMin')+
    '<label class="filter-line"><span>球队</span><input id="top-query" class="text-input" type="search" value="'+e(filt.query)+'" placeholder="输入中文或英文队名"></label></div>'+
    heading('推荐榜',ms.length+' 场')+(ms.length?grid(ms):empty('没有符合条件的比赛。',action('重置筛选','resetTop')))+dataNote;
}
function seasonView(s){
  const {league,view}=s.route,l=leagues[league],stats=view==='stats';
  let html=hero(l.name+(stats?' · 统计':' · 积分榜'),l.region+' · 2026/27 赛季',logo(league));
  if(!s.showSeason)return html+empty('此页包含球队赛果与赛季排名。',action(stats?'查看赛事统计':'查看积分榜','showSeason',{symbol:'eye',cls:'btn accent'}));
  if(!s.table)return html+empty(s.tableError?'赛季数据读取失败。':'正在读取积分榜…',s.tableError?action('重试','showSeason'):'');
  const entries=s.table[league];
  if(!stats)return html+heading('联赛积分榜',entries.length+' 支球队')+'<div class="table-wrap"><table><thead><tr>'+['排名','球队','积分','场次','胜','平','负','进球','失球','净胜'].map(t=>'<th>'+t+'</th>').join('')+'</tr></thead><tbody>'+entries.map((r,i)=>{const t=s.catalog.team(r.team);return '<tr><td>'+(i+1)+'</td><td>'+action(crest(t,'tiny')+e(t.zh),'team',{value:t.id,cls:'table-team'})+'</td><td><b>'+r.points+'</b></td>'+[r.played,r.won,r.drawn,r.lost,r.goalsFor,r.goalsAgainst,r.goalsFor-r.goalsAgainst].map(v=>'<td>'+v+'</td>').join('')+'</tr>'}).join('')+'</tbody></table></div>'+dataNote;
  const total=k=>entries.reduce((n,r)=>n+r[k],0),played=total('played')/2,goals=total('goalsFor');
  const numbers=[['赛季总进球',goals],['场均进球',(goals/played).toFixed(2)],['已赛场次',played],['参赛球队',entries.length],['已分胜负',total('won')],['平局场次',total('drawn')/2]];
  const ranks=[...entries].sort((a,b)=>b.goalsFor-a.goalsFor).slice(0,8);
  return html+heading('赛事统计')+'<div class="stats-grid">'+numbers.map(([k,v])=>'<div class="stat"><small>'+k+'</small><strong>'+v+'</strong></div>').join('')+'</div>'+heading('球队进球榜')+'<div class="box">'+ranks.map(r=>'<div class="rank-bar"><span>'+e(s.catalog.team(r.team).zh)+'</span><i style="width:'+Math.round(r.goalsFor/ranks[0].goalsFor*100)+'%"></i><b>'+r.goalsFor+'</b></div>').join('')+'</div>'+dataNote;
}
function archiveView(s){
  const id=s.route.league,all=s.catalog.archive.filter(m=>m.league===id),rounds=[...new Set(all.map(m=>m.round))].sort((a,b)=>b-a);
  return hero('历史轮次',leagues[id].name+' · 2026/27 赛季',logo(id))+heading('已收录轮次')+'<div class="grid">'+rounds.map(n=>{const games=all.filter(m=>m.round===n),dates=games.map(m=>m.date).sort();return action('<b>'+roundName(id,n)+'</b><small>'+dates[0]+' 至 '+dates.at(-1)+' · '+games.length+' 场</small>','round',{value:n,cls:'archive-item'})}).join('')+'</div>'+dataNote;
}
function favoriteView(s){
  let html=hero('我的收藏','保存在当前浏览器',heroIcon('♥'));
  const teams=[...s.favTeams].map(id=>s.catalog.team(id));
  html+=heading('关注的球队',teams.length+' 支');
  if(teams.length)html+='<div class="chip-row">'+teams.map(t=>action(crest(t,'tiny')+e(t.zh),'team',{value:t.id,cls:'chip'})).join('')+'</div>';
  else html+=empty('点击比赛行里球队旁的星标，即可关注球队。');
  const saved=[...s.favMatches.values()];
  html+=heading('收藏的比赛',saved.length+' 场')+(saved.length?grid(saved):empty('在单场详情里点击「收藏比赛」，即可加入片单。'));
  const related=s.allMatches().filter(m=>s.favTeams.has(m.home.id)||s.favTeams.has(m.away.id));
  const unique=[...new Map(related.map(m=>[m.id,m])).values()].sort((a,b)=>b.date.localeCompare(a.date));
  if(teams.length)html+=heading('关注球队的赛程',unique.length+' 场')+(unique.length?grid(unique):empty('已载入的日期和轮次中暂时没有这些球队的比赛。'));
  return html;
}
window.Rate90.views = {dailyView, roundView, topView, seasonView, archiveView, favoriteView};
})();
