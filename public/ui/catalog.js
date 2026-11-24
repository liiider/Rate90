(() => {
'use strict';
window.Rate90 = {};
const snapshotDate = '2026-11-22';
const leagues = {
  cl: {name:'欧洲冠军联赛', short:'欧冠', region:'欧洲', image:'cl.svg', round:5},
  pl: {name:'英格兰超级联赛', short:'英超', region:'英格兰', image:'pl.svg', round:11},
  ll: {name:'西班牙甲级联赛', short:'西甲', region:'西班牙', image:'ll.svg', round:13},
  sa: {name:'意大利甲级联赛', short:'意甲', region:'意大利', image:'sa.svg', round:12},
  bl: {name:'德国甲级联赛', short:'德甲', region:'德国', image:'bl.svg', round:10},
  l1: {name:'法国甲级联赛', short:'法甲', region:'法国', image:'l1.png', round:11}
};
const pages = {
  night:['昨夜比赛','☾'], round:['本轮赛事','⚽'], top:['精选比赛','⭐'],
  table:['积分榜','🏆'], stats:['赛事统计','📊'], favorites:['我的收藏','♥'], archive:['历史轮次','▦']
};
const recommendations=['看全场','看集锦','可跳过','资料不足'];
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const beijingDay = () => new Date(Date.now()+8*3600000).toISOString().slice(0,10);
function dayOffset(date,days) {
  const d=new Date(date+'T12:00:00Z'); d.setUTCDate(d.getUTCDate()+days); return d.toISOString().slice(0,10);
}
function dateLabel(date) {
  return new Intl.DateTimeFormat('zh-CN',{month:'long',day:'numeric',weekday:'long',timeZone:'UTC'}).format(new Date(date+'T12:00:00Z'));
}
function asset(name){
  return new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    script.src='./ui/data/'+name+'.js';
    script.onload=()=>{const data=script.rate90Data;script.remove();if(data===undefined)reject(new Error('未读到数据'));else resolve(data)};
    script.onerror=()=>{script.remove();reject(new Error('数据文件读取失败'))};
    document.head.append(script);
  });
}
const sampleDays = ['2026-11-05','2026-11-22'];
function sampleFeed(day,reveal=false){
  if(!sampleDays.includes(day))throw Error('该日未收录离线样本');
  return asset('sample-'+day+(reveal?'-details':''));
}
async function json(url,signal) {
  const params=new URL(url,'http://localhost').searchParams;
  const day=params.get('date'),reveal=params.get('reveal')==='1';
  if(location.protocol==='file:')return sampleFeed(day,reveal);
  try{
    const res=await fetch(url,{signal,headers:{Accept:'application/json'}});
    if(!res.ok)throw new Error('HTTP '+res.status);
    return await res.json();
  }catch(error){
    if(!signal?.aborted&&params.get('source')==='sample')return sampleFeed(day,reveal);
    throw error;
  }
}
const readStore=(key,fallback)=>{try{return JSON.parse(localStorage.getItem('rate90.ui.'+key))??fallback}catch{return fallback}};
function writeStore(key,value){try{localStorage.setItem('rate90.ui.'+key,JSON.stringify(value))}catch{}}
async function loadCatalog() {
  const [teams,fixtures]=await Promise.all(['teams','fixtures'].map(name=>asset(name)));
  const byId=new Map(teams.map(t=>[t.id,t]));
  const byName=new Map(teams.flatMap(t=>[[t.en.toLowerCase(),t],[t.zh,t]]));
  function team(value) {
    return byId.get(value)||byName.get(String(value).toLowerCase())||{id:String(value),en:String(value),zh:String(value),crest:null};
  }
  const archive=fixtures.map(m=>({...m,home:team(m.home),away:team(m.away),origin:'archive'}));
  function daily(m,feed) {
    const league=Object.keys(leagues).find(k=>leagues[k].short===m.stage);
    return {...m,id:String(m.id),home:team(m.home),away:team(m.away),league,origin:'daily',day:feed.day,
      feedMode:feed.mode,date:new Date(Date.parse(m.kickoff)+8*3600000).toISOString().slice(0,10),
      time:new Intl.DateTimeFormat('zh-CN',{hour:'2-digit',minute:'2-digit',hourCycle:'h23',timeZone:'Asia/Shanghai'}).format(new Date(m.kickoff))};
  }
  return {teams,team,archive,daily};
}
function matchKey(m) { return m.origin==='daily'?'daily:'+m.day+':'+m.id:'archive:'+m.id; }
function feedPath(day,source,reveal=false) {
  const p=new URLSearchParams({date:day}); if(source==='sample')p.set('source','sample'); if(reveal)p.set('reveal','1'); return '/api/matches?'+p;
}
const roundName=(league,n)=>league==='cl'?'联赛阶段 · 第 '+n+' 轮':'第 '+n+' 轮';
window.Rate90.catalog = {sampleDays, sampleFeed, snapshotDate, leagues, pages, recommendations, escapeHtml, beijingDay, dayOffset, dateLabel, asset, json, readStore, writeStore, loadCatalog, matchKey, feedPath, roundName};
})();
