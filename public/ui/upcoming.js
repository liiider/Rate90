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
      return games.length?[{scope:'date/'+route.date,games,span:cnDate(route.date)}]:[];
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
      const record=catalog.prematch.picks?.[section.scope];
      const validPicks=Boolean(record?.ids?.length===byId.size &&
        record.ids.every(id=>byId.has(id)) &&
        record.items.every(p=>byId.has(p.id)));
      const pickRank=new Map();
      if (validPicks) record.items.forEach((p,i)=>pickRank.set(p.id,i));

      const heading=(!merged && section.title)
        ? '<header class="round-heading preview-round">'+(section.league?leagueIcon(section.league,'heading-ic'):'')+
            '<h2>'+e(section.title)+'</h2>'+(section.span?'<span>'+e(section.span)+'</span>':'')+'</header>'
        : '';

      let picksHtml='';
      if (validPicks && record.items.length) {
        picksHtml='<section class="preview-picks" aria-label="AI 赛前推荐">'+
          '<div class="picks-head"><span class="picks-spark" aria-hidden="true">✦</span><h2>AI 赛前推荐</h2><span class="picks-sub">基于近期过程与对位精选</span></div>'+
          '<div class="picks-grid'+(record.items.length===1?' is-single':'')+'">'+
          record.items.map((p,i)=>{
            const g=byId.get(p.id), home=team(g.home), away=team(g.away), isTop=i===0;
            return '<article class="pick-card '+(isTop?'is-primary':'is-secondary')+'">'+
              (isTop?'<span class="card-glow pick-glow" aria-hidden="true"></span>':'')+
              '<div class="pick-top">'+
                '<span class="pick-rank'+(isTop?' is-primary':'')+'">'+(isTop?'首选焦点':'次选关注')+'</span>'+
                '<time class="pick-time">'+formatKickoff(g)+'</time>'+
              '</div>'+
              '<div class="pick-matchup">'+
                '<span class="side home"><span class="team-name">'+e(home.zh)+'</span>'+crest(home,isTop?'hero':'card')+'</span>'+
                '<span class="vs">vs</span>'+
                '<span class="side away">'+crest(away,isTop?'hero':'card')+'<span class="team-name">'+e(away.zh)+'</span></span>'+
              '</div>'+
              '<p class="pick-reason">'+e(p.reason)+'</p>'+
            '</article>';
          }).join('')+
        '</div></section>';
      }

      const listHtml='<div class="preview-list card-stack">'+section.games.map(g=>{
        const home=team(g.home), away=team(g.away);
        const rank=pickRank.get(g.id);
        const statusHtml=rank===0
          ? '<span class="preview-pick-badge is-primary">首选</span>'
          : rank===1
            ? '<span class="preview-pick-badge">次选</span>'
            : g.leg
              ? '<span class="preview-leg">'+(g.leg===1?'首回合':'次回合')+'</span>'
              : '<span class="preview-upcoming-tag">未开赛</span>';
        return '<article class="preview-row'+(rank===0?' is-pick-primary':rank===1?' is-pick-secondary':'')+'">'+
          '<div class="preview-time">'+(showLeagueIcon?leagueIcon(g.league,'card-ic'):'')+
            '<time class="time-val">'+formatKickoff(g)+'</time>'+
          '</div>'+
          '<span class="side home"><span class="team-name">'+e(home.zh)+'</span>'+crest(home,'card')+'</span>'+
          '<span class="vs">vs</span>'+
          '<span class="side away">'+crest(away,'card')+'<span class="team-name">'+e(away.zh)+'</span></span>'+
          '<div class="preview-status">'+statusHtml+'</div>'+
        '</article>';
      }).join('')+'</div>';

      return '<section class="round-group preview-group"'+(section.league?' data-league="'+e(section.league)+'"':'')+'>'+
        heading+picksHtml+listHtml+'</section>';
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
