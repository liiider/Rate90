(() => {
'use strict';
const {escapeHtml:e,leagues,pages,recommendations,matchKey,roundName}=window.Rate90.catalog;

const paths={
 search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
 reload:'<path d="M20 11a8 8 0 1 0-2 6M20 4v6h-6"/>',
 settings:'<path d="M4 6h9m4 0h3M4 12h3m4 0h9M4 18h10m4 0h2"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="16" cy="18" r="2"/>',
 eye:'<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
 lock:'<rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
 left:'<path d="m14 6-6 6 6 6"/>',right:'<path d="m10 6 6 6-6 6"/>',close:'<path d="m6 6 12 12M6 18 18 6"/>',
 moon:'<path d="M20.7 13.7A8.8 8.8 0 1 1 10.3 3.3a7.4 7.4 0 0 0 10.4 10.4Z"/>',
 bookmark:'<path d="M6 4h12v17l-6-4-6 4V4Z"/>',
 star:'<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.1-5.6-3-5.6 3 1.1-6.1L3 9.6l6.2-.9Z"/>',
 external:'<path d="M13 4h7v7m0-7L10 14m-1-9H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>',
 calendar:'<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v5m10-5v5M3 10h18"/>'
};
const icon=name=>'<svg class="ico" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'+(paths[name]||'')+'</svg>';
function action(label,act,opts={}) {
  const {value='',symbol='',cls='btn',disabled=false,title=''}=opts;
  return '<button type="button" class="'+cls+'" data-act="'+act+'" data-val="'+e(value)+'"'+(disabled?' disabled':'')+(title?' title="'+e(title)+'" aria-label="'+e(title)+'"':'')+'>'+iconIf(symbol)+label+'</button>';
}
const iconIf=s=>s?icon(s):'';
function logo(id,interactive=false,active=false){
  const l=leagues[id];if(!l)return '';
  const attrs=interactive?' type="button" data-act="league" data-val="'+id+'" aria-label="'+l.name+'" aria-pressed="'+active+'" title="'+l.name+'"':'';
  const tag=interactive?'button':'span';
  return '<'+tag+attrs+' class="league-logo '+id+(active?' active':'')+'"><img src="./ui/leagues/'+l.image+'" alt="'+(interactive?'':l.short)+'"></'+tag+'>';
}
function crest(team,size=''){
  return '<span class="crest '+size+'" aria-hidden="true">'+(team.crest?'<img src="./ui/crests/'+e(team.crest)+'" alt="">':e(team.zh.slice(0,2)))+'</span>';
}
function ring(value,size=''){
  const valid=Number.isFinite(value),color=!valid?'var(--muted)':value>=8?'var(--mint)':value>=6?'var(--cyan)':value>=4?'var(--gold)':'var(--muted)';
  return '<span class="ring '+size+'" style="--ring:'+color+';--pct:'+(valid?value*10:0)+'%" aria-label="'+(valid?'回看评分 '+value.toFixed(1):'暂无评分')+'">'+(valid?value.toFixed(1):'—')+'</span>';
}
const tier=t=>'<span class="tier t'+recommendations.indexOf(t)+'">'+e(t||'资料不足')+'</span>';
function navigation(view){return Object.entries(pages).map(([id,[name,symbol]])=>'<button type="button" class="navitem '+(id===view?'active':'')+'" data-act="view" data-val="'+id+'"'+(id===view?' aria-current="page"':'')+'><span class="sign" aria-hidden="true">'+symbol+'</span>'+name+'</button>').join('')}
function hero(title,sub,picture,controls=''){return '<section class="hero"><div class="hero-left">'+picture+'<div><h2>'+e(title)+'</h2><p>'+e(sub)+'</p></div></div>'+controls+'</section>'}
const heroIcon=content=>'<span class="hero-icon" aria-hidden="true">'+content+'</span>';
const heading=(title,meta='')=>'<h3 class="section-title">'+e(title)+(meta?'<small>'+e(meta)+'</small>':'')+'</h3>';
const empty=(message,extra='')=>'<div class="empty"><p>'+e(message)+'</p>'+extra+'</div>';
function club(team,favTeams,side){
  const on=favTeams.has(team.id), label=(on?'取消关注':'关注')+team.zh;
  return '<div class="club '+side+'">'+crest(team)+'<button type="button" class="fav '+(on?'on':'')+'" data-act="star" data-val="'+e(team.id)+'" aria-pressed="'+on+'" title="'+e(label)+'" aria-label="'+e(label)+'">★</button>'+action(e(team.zh),'team',{value:team.id,cls:'team',title:'查看'+team.zh+'的比赛'})+'</div>';
}
function matchRow(m,index,{favTeams,revealed,details},highlight=false){
  const key=matchKey(m), result=details?.score90, show=revealed.has(key), date=m.origin==='daily'?m.time:m.date;
  const upcoming=m.origin==='archive'&&m.rating===null;
  const timeLabel=m.origin==='daily'?(leagues[m.league]?.short||m.stage)+' · '+date:date;
  const middle=upcoming?'<span class="score-box"><small>'+e(date)+'</small><small>未开赛</small></span>':
    '<button type="button" class="score-box" data-act="reveal" data-val="'+e(key)+'" aria-label="'+(show?'隐藏':'揭晓')+e(m.home.zh+'对'+m.away.zh)+'的比分">'+
    (show?'<strong>'+e(Array.isArray(result)?result.join(' : '):'暂无')+'</strong>':icon('lock'))+'<small>'+e(timeLabel)+'</small></button>';
  const main='<article class="match" data-open="'+e(key)+'"><span class="ordinal">'+(index+1)+'</span>'+club(m.home,favTeams,'home')+middle+club(m.away,favTeams,'away')+
    action(m.origin==='archive'?ring(m.rating):tier(m.recommendation),'details',{cls:'badge-action',value:key,title:'比赛详情：'+m.home.zh+' 对 '+m.away.zh})+'</article>';
  return highlight?'<div class="featured"><div class="feature-tag">'+icon('star')+'首选 · '+e(leagues[m.league]?.short||m.stage)+'</div>'+main+'</div>':main;
}
function miniCard(m){const where=leagues[m.league]?.short||m.stage;return '<button type="button" class="mini-card" data-act="details" data-val="'+e(matchKey(m))+'"><span class="mini-head"><span class="eyebrow">'+e(where)+(m.round?' · '+roundName(m.league,m.round):'')+'</span>'+(m.origin==='archive'?ring(m.rating,'sm'):tier(m.recommendation))+'</span><span class="mini-teams"><span class="club">'+crest(m.home,'tiny')+e(m.home.zh)+'</span><i>VS</i><span class="club">'+e(m.away.zh)+crest(m.away,'tiny')+'</span></span><span class="meta">'+e(m.date)+(m.time?' · '+e(m.time)+' 北京时间':'')+'</span></button>'}
function chips(label,values,selected,act) {
  return '<div class="filter-line"><span>'+e(label)+'</span><div class="chip-row">'+values.map(([v,t])=>'<button type="button" class="chip '+(v===selected?'active':'')+'" aria-pressed="'+(v===selected)+'" data-act="'+act+'" data-val="'+e(v)+'">'+e(t)+'</button>').join('')+'</div></div>';
}
const dialogTitle=(title,context='')=>'<div class="dialog-title"><div><div class="eyebrow">'+e(context)+'</div><h2 id="dialog-title">'+e(title)+'</h2></div>'+action('','close',{cls:'icon-btn',symbol:'close',title:'关闭'})+'</div>';
function evidence(m,details){
  const score=Array.isArray(details.score90)?details.score90.join(' : '):'暂无比分';
  let out='<section class="box"><div class="detail-grid"><div><div class="eyebrow">'+(m.origin==='archive'?'全场比分':'常规时间比分')+'</div><div class="scoreline">'+e(score)+'</div></div></div>';
  if(details.reason)out+='<p>'+e(details.reason)+'</p>';
  if(Array.isArray(details.shotsByWindow)){const max=Math.max(1,...details.shotsByWindow);out+='<h3>每 15 分钟的射门</h3><div class="bars">'+details.shotsByWindow.map((n,i)=>'<div><small>'+e(n)+'</small><i style="height:'+Math.round(n/max*38)+'px"></i><small>'+(i*15+1)+'–'+(i+1)*15+'′</small></div>').join('')+'</div>'}
  if(Number.isFinite(details.xg90)) out+='<p>常规时间总 xG '+details.xg90.toFixed(2)+'</p>';
  return out+'</section>';
}
window.Rate90.components = {icon, action, logo, crest, ring, tier, navigation, hero, heroIcon, heading, empty, club, matchRow, miniCard, chips, dialogTitle, evidence};
})();
