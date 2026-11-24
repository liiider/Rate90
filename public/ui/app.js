(async () => {
'use strict';
const {beijingDay,dayOffset,escapeHtml:e,feedPath,asset,json,sampleFeed,sampleDays,leagues,loadCatalog,matchKey,pages,readStore,roundName,snapshotDate,writeStore}=window.Rate90.catalog;
const {action,club,crest,dialogTitle,empty,evidence,heroIcon,icon,logo,miniCard,navigation,ring,tier}=window.Rate90.components;
const {archiveView,dailyView,favoriteView,roundView,seasonView,topView}=window.Rate90.views;

const $=id=>document.getElementById(id);
const dialog=$('overlay');
const freshTop=()=>({league:'all',period:'round',min:6,query:''});
const localFile=location.protocol==='file:';
const routeParams=()=>new URLSearchParams(localFile?location.hash.slice(1):location.search);
function routeFromUrl(){
  const p=routeParams(),view=Object.hasOwn(pages,p.get('view'))?p.get('view'):'night';
  let league=p.get('league');
  if(!Object.hasOwn(leagues,league))league=view==='night'?'all':'pl';
  const requested=Number(p.get('round')),current=leagues[league]?.round||11;
  const round=Math.abs(requested-current)<=1?requested:current;
  const day=p.get('date'),valid=/^\d{4}-\d{2}-\d{2}$/.test(day||'')&&Number.isFinite(Date.parse(day))&&new Date(day).toISOString().startsWith(day);
  return {view,league,round,date:valid?day:location.protocol==='file:'?snapshotDate:beijingDay(),source:location.protocol==='file:'||p.get('source')==='sample'?'sample':'live',match:p.get('match')||''};
}
const s={route:routeFromUrl(),catalog:null,feed:null,daily:[],loading:false,min:0,top:freshTop(),table:null,tableError:false,showSeason:false,
 favTeams:new Set(readStore('teams',[])),favMatches:new Map(readStore('matches',[])),revealed:new Set(),details:new Map(),detailLoads:new Map(),theme:readStore('theme','dark'),
 allMatches(){return [...this.catalog.archive,...this.daily]}};
let controller,request=0,routeVersion=0,modal=null,archiveResults=null,archiveRequest=null;
function theme(){document.documentElement.dataset.theme=s.theme==='system'?(matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'):s.theme}
theme();matchMedia('(prefers-color-scheme: light)').addEventListener('change',theme);
const notify=text=>{$('notice').textContent=text};
const cacheKey=(r)=>'feed.'+r.date+'.'+r.source;
function safeFeed(feed,r){
  if(feed?.day!==r.date||!['live','sample'].includes(feed.mode)||!Array.isArray(feed.matches))throw Error('比赛日格式错误');
  const {day,mode,updatedAt,partial,capturedOn,ruleVersion,update}=feed;
  const matches=feed.matches.filter(m=>m&&m.id!=null&&m.home&&m.away&&Number.isFinite(Date.parse(m.kickoff))).map(m=>{
    const {id,home,away,stage,kickoff,recommendation,topPick}=m;
    return {id,home,away,stage,kickoff,recommendation,topPick};
  });
  return {day,mode,updatedAt,partial,capturedOn,ruleVersion,update,matches};
}
function acceptFeed(feed){s.feed=feed;s.daily=feed.matches.map(m=>s.catalog.daily(m,feed))}
async function loadDaily(){
  const r={...s.route},token=++request;controller?.abort();controller=new AbortController();
  s.loading=true;s.feed=null;s.daily=[];s.details.clear();s.revealed.clear();s.detailLoads.clear();
  const cached=readStore(cacheKey(r),null);
  if(cached){try{acceptFeed({...safeFeed(cached,r),cached:true})}catch{}}
  render();const timer=setTimeout(()=>controller?.abort(),45000);
  try{
    const feed=safeFeed(await json(feedPath(r.date,r.source),controller.signal),r);
    if(token!==request)return;
    if(!(r.source==='live'&&feed.mode==='sample'&&s.feed?.mode==='live')){
      acceptFeed(feed);writeStore(cacheKey(r),feed);
    }
  }catch{
    if(token!==request)return;
    if(!s.feed&&sampleDays.includes(r.date)){
      try{
        const feed=safeFeed(await sampleFeed(r.date),r);
        if(token===request)acceptFeed(feed);
      }catch{}
    }
  }
  finally{clearTimeout(timer);if(token===request){s.loading=false;render();openLinkedMatch()}}
}
function findMatch(key){return s.allMatches().find(m=>matchKey(m)===key)||s.favMatches.get(key)}
function pickList(){
  if(s.route.view==='night'&&s.daily.length)return s.daily.filter(m=>m.recommendation!=='资料不足').slice(0,5);
  return s.catalog.archive.filter(m=>m.rating!==null&&m.date>=dayOffset(snapshotDate,-3)&&m.date<=snapshotDate).sort((a,b)=>b.rating-a.rating||b.date.localeCompare(a.date)).slice(0,5);
}
function activeMatches(){
  if(s.route.view==='night')return s.daily.filter(m=>s.route.league==='all'||m.league===s.route.league);
  if(s.route.view==='round')return s.catalog.archive.filter(m=>m.league===s.route.league&&m.round===s.route.round&&(s.min===0||m.rating!==null&&m.rating>=s.min));
  return [];
}
function renderSides(){
  const picks=pickList(),daily=s.route.view==='night'&&s.daily.length>0,title=daily?'昨夜推荐':'精选比赛';
  $('side-picks').innerHTML='<h2>'+title+'</h2>'+picks.map(m=>action(crest(m.home,'tiny')+crest(m.away,'tiny')+'<span class="pick-names"><strong>'+e(m.home.zh+' 对 '+m.away.zh)+'</strong><small>'+e(leagues[m.league]?.short||m.stage)+'</small></span>'+(daily?tier(m.recommendation):ring(m.rating,'sm')),'details',{value:matchKey(m),cls:'side-pick'})).join('');
  $('mobile-highlights').innerHTML='<h2>'+title+'</h2><div class="mobile-tray">'+picks.map(m=>action(crest(m.home,'tiny')+(daily?tier(m.recommendation):ring(m.rating,'sm'))+crest(m.away,'tiny')+'<small>'+e(m.home.zh+' · '+m.away.zh)+'</small>','details',{value:matchKey(m),cls:'mobile-pick',title:m.home.zh+' 对 '+m.away.zh+'，比赛详情'})).join('')+'</div>';
  const {view,league}=s.route;
  const rows=[['当前页面',pages[view][0]],['赛事',leagues[league]?.short||'全部赛事'],['关注球队',s.favTeams.size+' 支'],['收藏比赛',s.favMatches.size+' 场']];
  $('side-context').innerHTML='<h2>当前视图</h2>'+rows.map(([k,v])=>'<div class="context-row"><span>'+k+'</span><b>'+e(v)+'</b></div>').join('');
}
function render(){
  if(!s.catalog)return;
  const {view,league}=s.route,l=leagues[league],daily=view==='night';
  const titles={night:'昨夜比赛，哪场值得回看？',round:'2026/27 赛季 · 无剧透足球回看指南',top:'精选比赛',table:l?.short+'积分榜',stats:l?.short+'赛事统计',archive:'历史比赛周',favorites:'我的收藏'};
  $('page-title').textContent=titles[view];document.title=pages[view][0]+' · Rate90 足球回看指南';
  $('subtitle').textContent=daily?'按北京时间收录已完赛场次，先选比赛，再看比分。':'欧冠与欧洲五大联赛 · 2026/27 赛季回看指南';
  $('leagues').innerHTML=Object.keys(leagues).map(k=>logo(k,true,k===league)).join('');
  $('nav').innerHTML=navigation(view);$('mobile-view').textContent=pages[view][0]+' ▴';$('content').classList.toggle('round-mode',view==='round');
  const source=daily?(s.loading?'同步中':s.feed?.cached?'本机缓存':s.feed?.mode==='live'?'已同步':s.feed?.mode==='sample'?'联调样本':'未同步'):'赛季快照';
  const toolbar='<span class="status '+(source==='已同步'?'live':'')+'"><i></i>'+source+'</span>'+action('搜索 <kbd>Ctrl K</kbd>','search',{symbol:'search'})+
    (daily?action('刷新','refresh',{symbol:'reload',disabled:s.loading}):'')+action('','settings',{symbol:'settings',cls:'icon-btn',title:'设置'});
  const revealable=activeMatches().filter(m=>m.origin!=='archive'||m.rating!==null);
  $('toolbar').innerHTML=toolbar+(revealable.length?action('全部揭晓','revealAll',{symbol:'eye',cls:'btn accent'})+action('全部隐藏','hideAll',{symbol:'lock'}):'');
  const renderView={night:dailyView,round:roundView,top:topView,table:seasonView,stats:seasonView,archive:archiveView,favorites:favoriteView};
  $('view').innerHTML=renderView[view](s);renderSides();
}
function go(changes,push=true){
  const p=routeParams(),newView=changes.view||s.route.view;
  p.set('view',newView);p.delete('match');
  if(changes.view&&changes.view!==s.route.view){p.delete('round');p.delete('league')}
  for(const [k,v] of Object.entries(changes)){if(v==null||v==='all')p.delete(k);else p.set(k,v)}
  if(newView!=='night'){p.delete('date');p.delete('source')}
  if(push)history.pushState(null,'',(localFile?'#':'?')+p.toString());
  const prior=s.route;s.route=routeFromUrl();routeVersion++;
  s.revealed.clear();s.details.clear();s.detailLoads.clear();s.showSeason=false;s.tableError=false;
  closeModal();
  if(s.route.view==='night'&&(prior.view!=='night'||s.route.date!==prior.date||s.route.source!==prior.source||!s.feed))loadDaily();
  else{if(s.route.view!=='night'){request++;controller?.abort();s.loading=false}render();openLinkedMatch()}
  if(prior.view!==s.route.view)window.scrollTo(0,0);
}
function openLinkedMatch(){
  if(!s.route.match||modal)return;
  const match=s.route.view==='night'?s.daily.find(m=>m.id===s.route.match):s.catalog.archive.find(m=>m.id===s.route.match);
  if(match)openModal('details',matchKey(match));
}
function show(html){$('dialog-body').innerHTML=html;dialog.setAttribute('aria-labelledby','dialog-title');if(!dialog.open)dialog.showModal()}
function closeModal(){modal=null;if(dialog.open)dialog.close()}
dialog.addEventListener('cancel',()=>{modal=null});dialog.addEventListener('click',ev=>{if(ev.target===dialog){const r=dialog.getBoundingClientRect();if(ev.clientX<r.left||ev.clientX>r.right||ev.clientY<r.top||ev.clientY>r.bottom)closeModal()}});
function openModal(type,key=''){modal={type,key};renderModal();if(type==='search')$('team-query')?.focus()}
function searchResults(query){
  const q=query.trim().toLowerCase();const matches=(q?s.catalog.teams.filter(t=>(t.zh+' '+t.en).toLowerCase().includes(q)):s.catalog.teams.filter(t=>s.favTeams.has(t.id))).slice(0,60);
  return matches.length?matches.map(t=>action(crest(t,'tiny')+'<b>'+e(t.zh)+'</b><small>'+e(t.en)+'</small>','team',{cls:'search-result',value:t.id})).join(''):empty(q?'没有找到这支球队。':'输入球队名称，查找已收录的赛程。');
}
function renderModal(){
  if(!modal)return;
  const {type,key}=modal;
  if(type==='navigation'){show(dialogTitle('页面导航')+'<nav class="navlist">'+navigation(s.route.view)+'</nav><div class="actions">'+action('搜索球队','search',{symbol:'search'})+action('设置','settings',{symbol:'settings'})+(activeMatches().length?action('全部揭晓','mobileReveal',{symbol:'eye'})+action('全部隐藏','mobileHide',{symbol:'lock'}):'')+'</div>');return}
  if(type==='search'){show(dialogTitle('搜索球队')+'<input class="text-input" id="team-query" type="search" placeholder="球队中文名或英文名" aria-label="球队中文名或英文名"><div id="search-results" class="search-list">'+searchResults('')+'</div>');return}
  if(type==='settings'){show(dialogTitle('显示设置')+'<label class="switch-line">外观<select id="theme-select">'+[['dark','深色'],['light','浅色'],['system','跟随系统']].map(([v,t])=>'<option value="'+v+'"'+(s.theme===v?' selected':'')+'>'+t+'</option>').join('')+'</select></label><p>比赛日使用北京时间。收藏与外观保存在当前设备。</p>');return}
  if(type==='about'){
    show(dialogTitle('关于 Rate90','足球回看指南')+'<div class="box"><h3>昨夜比赛</h3><p>每天北京时间中午 12 点划分看球日。Rate90 按关键机会在六个 15 分钟时段的分布及双方创造机会的情况，给出看全场、看集锦、可跳过或资料不足的建议。</p></div><div class="box"><h3>比赛周与评分</h3><p>参考快照收录欧冠和欧洲五大联赛各三个轮次。0–10 分引用 MustWatch90 的回看评分，快照采集于 2026 年 11 月 22 日。昨夜榜单使用 Rate90 的试算规则。</p></div><div class="actions"><a class="btn" href="https://mustwatch90.com/" target="_blank" rel="noreferrer">MustWatch90</a><a class="btn" href="https://sports.bzzoiro.com/" target="_blank" rel="noreferrer">BSD Sports</a><a class="btn" href="./world-cup-2022.html">2022 世界杯历史样本</a></div>');return;
  }
  if(type==='team'){
    const t=s.catalog.team(key),on=s.favTeams.has(key),matches=s.allMatches().filter(m=>m.home.id===key||m.away.id===key),unique=[...new Map(matches.map(m=>[m.id,m])).values()].sort((a,b)=>b.date.localeCompare(a.date));
    show(dialogTitle(t.zh,t.en)+'<div class="spread">'+crest(t,'big')+action(on?'已关注':'关注球队','star',{value:key,symbol:'star',cls:'btn '+(on?'accent':'')})+'</div><h3 class="section-title">已收录比赛</h3>'+(unique.length?'<div class="grid">'+unique.map(miniCard).join('')+'</div>':empty('暂时没有已载入的比赛。')));return;
  }
  const m=findMatch(key);if(!m){closeModal();return}
  const l=leagues[m.league],saved=s.favMatches.has(key),shown=s.revealed.has(key),details=s.details.get(key);
  const venue=m.league==='cl'?['爱奇艺','https://www.iqiyi.com/']:m.league==='bl'?['央视频','https://www.yangshipin.cn/']:['咪咕视频','https://www.miguvideo.com/'];
  const source=m.origin==='daily'?(m.feedMode==='sample'?'BSD 联调样本':'BSD 比赛数据'):'MustWatch90 赛季快照';
  const top=dialogTitle(m.home.zh+' 对 '+m.away.zh,(l?.short||m.stage||'足球')+' · '+(m.round?roundName(m.league,m.round)+' · ':'')+m.date+(m.time?' '+m.time+' 北京时间':''));
  const sides=[m.home,m.away].map(t=>'<div class="side">'+crest(t,'big')+'<b>'+e(t.zh)+'</b></div>');
  const center=m.origin==='archive'?ring(m.rating,'lg'):tier(m.recommendation);
  const recap='<div class="box duel">'+sides[0]+'<div class="duel-center">'+center+'<small>'+(m.origin==='archive'?'回看评分':'回看建议')+'</small></div>'+sides[1]+'</div>';
  const future=m.origin==='archive'&&m.rating===null;
  const watch=l?'<div class="box detail-grid"><div><h3>观看入口</h3><p>中国大陆 · '+venue[0]+'</p></div><a class="btn accent" href="'+venue[1]+'" target="_blank" rel="noreferrer">前往播放平台 '+icon('external')+'</a></div>':'';
  const err=s.detailLoads.get(key)==='error';
  const revealBox=future?'<div class="box"><p>快照记录时尚未开赛。</p></div>':shown&&details?evidence(m,details):'<div class="box detail-grid"><div><h3>赛况与比分</h3><p>'+(err?'本场数据读取失败，可以重试。':'比分与比赛经过已隐藏。')+'</p></div>'+action(s.detailLoads.get(key)==='loading'?'读取中…':err?'重试揭晓':'揭晓本场','reveal',{value:key,symbol:'eye',disabled:s.detailLoads.get(key)==='loading'})+'</div>';
  show(top+recap+watch+revealBox+'<div class="actions">'+action(saved?'已收藏比赛':'收藏比赛','saveMatch',{value:key,symbol:'bookmark',cls:'btn '+(saved?'accent':'')})+(localFile?'':action('复制比赛链接','share',{value:key,symbol:'external'}))+(shown?action('隐藏赛况','reveal',{value:key,symbol:'lock'}):'')+'</div><p class="note" style="margin-top:12px">'+e(source)+'</p><div id="share-feedback" role="status"></div>');
}
async function detailFor(m){
  if(m.origin==='archive'){
    if(!archiveResults){
      archiveRequest??=asset('results').finally(()=>{archiveRequest=null});
      archiveResults=await archiveRequest;
    }
    return {score90:archiveResults[m.id]||null};
  }
  const group=[m.day,m.feedMode].join('/');
  if(!detailRequests.has(group)){
    const pending=json(feedPath(m.day,m.feedMode,true),AbortSignal.timeout(45000)).then(feed=>{
      if(feed.day!==m.day||feed.mode!==m.feedMode)throw Error('数据来源已变更');
      return new Map(feed.matches.map(v=>[String(v.id),v.details]));
    }).finally(()=>detailRequests.delete(group));detailRequests.set(group,pending);
  }
  const data=(await detailRequests.get(group)).get(m.id);if(!data)throw Error('未找到该场详情');return data;
}
const detailRequests=new Map();
async function reveal(key,force=false){
  const m=findMatch(key);if(!m||m.origin==='archive'&&m.rating===null)return;
  if(!force&&s.revealed.has(key)){s.revealed.delete(key);render();renderModal();return}
  if(s.revealed.has(key)||s.detailLoads.get(key)==='loading')return;
  const version=routeVersion;s.detailLoads.set(key,'loading');if(modal?.key===key)renderModal();
  try{const data=s.details.get(key)||await detailFor(m);if(version!==routeVersion)return;s.details.set(key,data);s.revealed.add(key);s.detailLoads.delete(key)}
  catch{if(version!==routeVersion)return;s.detailLoads.set(key,'error');if(!modal)openModal('details',key)}
  if(version===routeVersion){render();renderModal()}
}
function navigateStep(delta){
  const r=s.route;if(r.view==='night')go({date:dayOffset(r.date,delta)});
  if(r.view==='round'&&s.catalog.archive.some(m=>m.league===r.league&&m.round===r.round+delta))go({round:r.round+delta});
}
async function share(m){
  const url=new URL(location.href);url.search='';url.hash='';url.searchParams.set('view',m.origin==='daily'?'night':'round');url.searchParams.set('match',m.id);
  if(m.origin==='daily'){url.searchParams.set('date',m.day);if(m.feedMode==='sample')url.searchParams.set('source','sample')}
  else{url.searchParams.set('league',m.league);url.searchParams.set('round',m.round)}
  try{await navigator.clipboard.writeText(url.href);if($('share-feedback'))$('share-feedback').textContent='已复制无剧透链接。'}
  catch{if($('share-feedback'))$('share-feedback').innerHTML='<label>无剧透链接<input class="text-input" readonly value="'+e(url.href)+'"></label>'}
}
document.addEventListener('click',async ev=>{
  const button=ev.target.closest('[data-act]'),row=ev.target.closest('[data-open]');
  if(!button){if(row)openModal('details',row.dataset.open);return}
  const {act,val}=button.dataset,r=s.route;
  switch(act){
    case 'view':go({view:val});break;
    case 'league':go({view:['archive','table','stats'].includes(r.view)?r.view:'round',league:val,round:null});break;
    case 'dailyLeague':go({league:val});break;
    case 'previous':navigateStep(-1);break;case 'next':navigateStep(1);break;
    case 'refresh':routeVersion++;await loadDaily();break;
    case 'sample':go({view:'night',date:snapshotDate,source:'sample',league:'all'});break;
    case 'dateFocus':$('match-date')?.focus();try{$('match-date')?.showPicker()}catch{}break;
    case 'clearMin':s.min=0;render();break;
    case 'search':case 'settings':case 'about':case 'navigation':openModal(act);break;
    case 'close':closeModal();break;
    case 'details':case 'team':openModal(act,val);break;
    case 'reveal':await reveal(val);break;
    case 'mobileReveal':closeModal();
    case 'revealAll':await Promise.all(activeMatches().map(m=>reveal(matchKey(m),true)));break;
    case 'mobileHide':closeModal();
    case 'hideAll':routeVersion++;s.detailLoads.clear();s.revealed.clear();render();break;
    case 'star':if(s.favTeams.has(val))s.favTeams.delete(val);else s.favTeams.add(val);writeStore('teams',[...s.favTeams]);render();renderModal();break;
    case 'saveMatch':{const m=findMatch(val);if(s.favMatches.has(val))s.favMatches.delete(val);else if(m)s.favMatches.set(val,m);writeStore('matches',[...s.favMatches]);render();renderModal();break}
    case 'share':{const m=findMatch(val);if(m)await share(m);break}
    case 'round':go({view:'round',league:r.league,round:Number(val)});break;
    case 'topLeague':s.top.league=val;render();break;case 'period':s.top.period=val;render();break;
    case 'topMin':s.top.min=Number(val);render();break;case 'resetTop':s.top=freshTop();render();break;
    case 'showSeason':s.showSeason=true;s.tableError=false;render();try{s.table??=await asset('standings')}catch{s.tableError=true}render();break;
  }
});
document.addEventListener('input',ev=>{
  const t=ev.target;if(t.id==='team-query')$('search-results').innerHTML=searchResults(t.value);
  if(t.id==='minimum'){s.min=Number(t.value);const list=document.createElement('div');list.innerHTML=roundView(s);const root=$('view');root.querySelector('output').textContent=s.min;root.querySelector('.tail').textContent=list.querySelector('.tail').textContent;
    root.querySelector('.match-list,.empty')?.replaceWith(list.querySelector('.match-list,.empty'));renderSides()}
  if(t.id==='top-query'){s.top.query=t.value;const caret=t.selectionStart;const box=document.createElement('div');box.innerHTML=topView(s);const old=$('view');old.querySelector('.section-title').replaceWith(box.querySelector('.section-title'));old.querySelector('.grid,.empty').replaceWith(box.querySelector('.grid,.empty'));if(caret!==null)t.setSelectionRange(caret,caret)}
});
document.addEventListener('change',ev=>{
  const t=ev.target;if(t.id==='match-date'&&t.value)go({date:t.value});
  if(t.id==='theme-select'){s.theme=t.value;writeStore('theme',s.theme);theme()}
});
document.addEventListener('keydown',ev=>{
  if((ev.ctrlKey||ev.metaKey)&&ev.key.toLowerCase()==='k'){ev.preventDefault();openModal('search');return}
  if(dialog.open||ev.altKey||ev.ctrlKey||ev.metaKey||['INPUT','TEXTAREA','SELECT','BUTTON'].includes(ev.target.tagName))return;
  if(['ArrowLeft','ArrowRight'].includes(ev.key)){ev.preventDefault();navigateStep(ev.key==='ArrowLeft'?-1:1)}
});
window.addEventListener('popstate',()=>go({},false));
try{s.catalog=await loadCatalog();if(s.route.view==='night')await loadDaily();else{render();openLinkedMatch()}}
catch{$('view').innerHTML=empty('页面资源读取失败。请通过 Rate90 本地服务打开并刷新。')}
})();
