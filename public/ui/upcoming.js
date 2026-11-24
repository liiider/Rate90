(() => {
  'use strict';
  const {escapeHtml:e,leagues,cnDate,roundName}=window.Rate90.catalog;
  const {crest,leagueIcon}=window.Rate90.components;
  const stamp=t=>new Date(t+8*3600000).toISOString();
  const day=g=>stamp(g.kickoff).slice(0,10);
  const label=g=>roundName(g.league,g.round)+(g.leg?(g.leg===1?' · 首回合':' · 次回合'):'');

  function sections(feed,route,now=Date.now()) {
    if (!feed) return [];
    const inLeague=g=>route.league==='all' || g.league===route.league;
    const rounds=feed.rounds.filter(inLeague);
    if (route.date) {
      const games=rounds.flatMap(r=>r.games.map(g=>({...g,leg:r.leg})))
        .concat((feed.extra||[]).filter(inLeague))
        .filter(g=>g.kickoff>now && day(g)===route.date)
        .sort((a,b)=>a.kickoff-b.kickoff || a.id.localeCompare(b.id));
      return games.length?[{scope:'date/'+route.date,games}]:[];
    }
    const byLeague=new Map();
    for (const r of rounds) {
      if (!r.games.length || r.games.some(g=>g.kickoff<=now)) continue;
      if (!byLeague.has(r.league)) byLeague.set(r.league,[]);
      byLeague.get(r.league).push(r);
    }
    return [...byLeague.values()].map(list=>list[route.horizon-1]).filter(Boolean)
      .sort((a,b)=>a.games[0].kickoff-b.games[0].kickoff)
      .map(r=>({scope:'round/'+r.key,title:leagues[r.league].short+' · '+label(r),
        games:r.games.map(g=>({...g,leg:r.leg}))}));
  }

  function view(catalog,sections) {
    if (!sections.length) return '<p class="state-card">暂无已公布的对阵。</p>';
    const team=t=>({...catalog.team(t.id),zh:t.zh});
    return sections.map(section=>{
      const byId=new Map(section.games.map(g=>[g.id,g]));
      const record=catalog.prematch.picks?.[section.scope];
      let html=section.title?'<h2 class="preview-round">'+e(section.title)+'</h2>':'';
      if (record?.ids?.length===byId.size && record.ids.every(id=>byId.has(id)) && record.items.every(p=>byId.has(p.id))) {
        html+='<section class="preview-picks"><h2>AI 赛前推荐</h2>'+record.items.map((p,i)=>{
          const g=byId.get(p.id);
          return '<div><strong>'+(i?'次选':'首选')+' · '+e(g.home.zh)+' vs '+e(g.away.zh)+'</strong><p>'+e(p.reason)+'</p></div>';
        }).join('')+'</section>';
      }
      return html+'<div class="preview-list">'+section.games.map(g=>{
        const home=team(g.home),away=team(g.away);
        return '<article class="preview-row"><div class="preview-meta">'+leagueIcon(g.league,'heading-ic')+
          '<span>'+e(leagues[g.league].short)+' · '+e(label(g))+'</span></div><div class="preview-sides"><span>'+crest(home,'card')+e(home.zh)+
          '</span><small>vs</small><span>'+crest(away,'card')+e(away.zh)+'</span></div><time>'+e(cnDate(day(g)))+' '+
          (g.timeKnown?stamp(g.kickoff).slice(11,16):'时间待定')+'</time></article>';
      }).join('')+'</div>';
    }).join('');
  }
  window.Rate90.upcoming={sections,view,day};
})();
