(() => {
  'use strict';
  const {escapeHtml:e,leagues,cnDate,roundName}=window.Rate90.catalog;
  const {crest,leagueIcon}=window.Rate90.components;
  const stamp=t=>new Date(t+8*3600000).toISOString();
  const day=g=>stamp(g.kickoff).slice(0,10);
  const label=g=>roundName(g.league,g.round)+(g.leg?(g.leg===1?' · 首回合':' · 次回合'):'');
  const gameSpan=games=>{
    const dates=games.map(day).filter(Boolean).sort();
    if (!dates.length) return '';
    const first=cnDate(dates[0]), last=cnDate(dates.at(-1));
    return first===last ? first : first+' – '+last;
  };

  function sections(feed,route,now=Date.now()) {
    if (!feed) return [];
    const inLeague=g=>route.league==='all' || g.league===route.league;
    const rounds=feed.rounds.filter(inLeague);
    if (route.date) {
      const games=rounds.flatMap(r=>r.games.map(g=>({...g,leg:r.leg})))
        .concat((feed.extra||[]).filter(inLeague))
        .filter(g=>g.kickoff>now && day(g)===route.date)
        .sort((a,b)=>a.kickoff-b.kickoff || a.id.localeCompare(b.id));
      const scope='date/'+route.date;
      return games.length?[{scope:route.league==='all'?scope:scope+'/'+route.league,dayScope:scope,games,span:cnDate(route.date)}]:[];
    }
    const byLeague=new Map();
    for (const r of rounds) {
      if (!r.games.length || r.games.some(g=>g.kickoff<=now)) continue;
      if (!byLeague.has(r.league)) byLeague.set(r.league,[]);
      byLeague.get(r.league).push(r);
    }
    return [...byLeague.values()].map(list=>list[route.horizon-1]).filter(Boolean)
      .sort((a,b)=>a.games[0].kickoff-b.games[0].kickoff)
      .map(r=>{
        const games=r.games.map(g=>({...g,leg:r.leg}));
        return {
          scope:'round/'+r.key,
          league:r.league,
          roundLabel:label(r),
          title:leagues[r.league].short+' · '+label(r),
          span:gameSpan(games),
          games
        };
      });
  }

  function formatKickoff(g) {
    const d=cnDate(day(g));
    return g.timeKnown
      ? e(d)+' '+e(stamp(g.kickoff).slice(11,16))
      : e(d)+' <span class="time-tbd">待定</span>';
  }

  function view(catalog,sections,{merged=false,showLeagueIcon=false}={}) {
    if (!sections.length) return '<p class="state-card">暂无已公布的对阵。</p>';
    const team=t=>({...catalog.team(t.id),zh:t.zh});
    return sections.map(section=>{
      const byId=new Map(section.games.map(g=>[g.id,g]));
      const picks=catalog.prematch.picks;
      const record=picks?.[section.scope]??picks?.[section.dayScope];
      const validPicks=Boolean(Array.isArray(record?.ids) && record.ids.length===byId.size &&
        new Set(record.ids).size===byId.size &&
        record.ids.every(id=>byId.has(id)) &&
        Array.isArray(record.items) && record.items.every(p=>byId.has(p?.id) && typeof p.reason==='string'));
      const pickMap=new Map();
      if (validPicks) record.items.forEach((p,i)=>pickMap.set(p.id,{rank:i,reason:p.reason}));

      const ordered=validPicks && record.items.length
        ? [...record.items.map(p=>byId.get(p.id)), ...section.games.filter(g=>!pickMap.has(g.id))]
        : section.games;

      const heading=(!merged && section.title)
        ? '<header class="round-heading preview-round">'+(section.league?leagueIcon(section.league,'heading-ic'):'')+
            '<h2>'+e(section.title)+'</h2>'+(section.span?'<span>'+e(section.span)+'</span>':'')+'</header>'
        : '';

      const emptyNote=(validPicks && !record.items.length)
        ? '<p class="preview-empty-picks"><span class="picks-spark" aria-hidden="true">✦</span><span>AI 赛前评估 · 本轮暂无全场推荐</span></p>'
        : '';

      const listHtml='<div class="preview-list card-stack">'+ordered.map(g=>{
        const home=team(g.home), away=team(g.away);
        const pick=pickMap.get(g.id);
        const isPrimary=pick?.rank===0;
        const isSecondary=pick?.rank===1;
        const crestSize=isPrimary?'hero':'card';

        let statusHtml='';
        if (isPrimary) {
          statusHtml='<span class="ai-plaque is-primary" aria-label="AI 强烈推荐"><b>强烈推荐</b><small>✦ AI</small></span>';
        } else if (isSecondary) {
          statusHtml='<span class="ai-plaque is-secondary" aria-label="AI 值得一看"><b>值得一看</b><small>✦ AI</small></span>';
        } else if (g.leg) {
          statusHtml='<span class="preview-leg">'+(g.leg===1?'首回合':'次回合')+'</span>';
        } else {
          statusHtml='<span class="preview-upcoming-tag">未开赛</span>';
        }

        const reasonHtml=pick
          ? '<p class="preview-reason"><span class="preview-reason-tag">✦ AI</span><span class="pick-reason">'+e(pick.reason)+'</span></p>'
          : '';

        return '<article class="preview-row'+(pick?' pick-card':'')+(isPrimary?' is-pick-primary':isSecondary?' is-pick-secondary':'')+'">'+
          (isPrimary?'<span class="card-glow pick-glow" aria-hidden="true"></span>':'')+
          '<div class="preview-main">'+
            '<div class="preview-time">'+(showLeagueIcon?leagueIcon(g.league,'card-ic'):'')+
              '<time class="time-val">'+formatKickoff(g)+'</time>'+
            '</div>'+
            '<span class="side home"><span class="team-name">'+e(home.zh)+'</span>'+crest(home,crestSize)+'</span>'+
            '<span class="vs">vs</span>'+
            '<span class="side away">'+crest(away,crestSize)+'<span class="team-name">'+e(away.zh)+'</span></span>'+
            '<div class="preview-status">'+statusHtml+'</div>'+
          '</div>'+
          reasonHtml+
        '</article>';
      }).join('')+'</div>';

      return '<section class="round-group preview-group"'+(section.league?' data-league="'+e(section.league)+'"':'')+'>'+
        heading+emptyNote+listHtml+'</section>';
    }).join('');
  }
  function leagueRounds(feed,league,now=Date.now()) {
    if (!feed || league==='all') return [];
    return feed.rounds
      .filter(r=>r.league===league && r.games.length && !r.games.some(g=>g.kickoff<=now))
      .slice(0,2)
      .map(r=>({round:r.round,leg:r.leg,label:label(r),key:r.key}));
  }

  window.Rate90.upcoming={sections,view,day,leagueRounds};
})();
