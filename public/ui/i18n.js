(() => {
  'use strict';

  const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const LEAGUES_I18N = {
    all: { zh: { name: '全部赛事', short: '全部赛事' }, en: { name: 'All Competitions', short: 'All Leagues' } },
    cl: { zh: { name: '欧洲冠军联赛', short: '欧冠' }, en: { name: 'UEFA Champions League', short: 'Champions League' } },
    pl: { zh: { name: '英格兰超级联赛', short: '英超' }, en: { name: 'Premier League', short: 'Premier League' } },
    ll: { zh: { name: '西班牙甲级联赛', short: '西甲' }, en: { name: 'La Liga', short: 'La Liga' } },
    sa: { zh: { name: '意大利甲级联赛', short: '意甲' }, en: { name: 'Serie A', short: 'Serie A' } },
    bl: { zh: { name: '德国甲级联赛', short: '德甲' }, en: { name: 'Bundesliga', short: 'Bundesliga' } },
    l1: { zh: { name: '法国甲级联赛', short: '法甲' }, en: { name: 'Ligue 1', short: 'Ligue 1' } }
  };

  const STYLE_I18N = {
    'heavyweights': {
      zh: ['强强对话', '两队上赛季均进入欧冠八强或五大联赛前二。'],
      en: ['Heavyweight Clash', 'Both sides reached the UCL quarter-finals or finished top two in a top-five league last season.']
    },
    'rivalry': {
      zh: ['宿敌对决', '这对老对手又碰面了。'],
      en: ['Rivalry', 'Two historic rivals meet again.']
    },
    'talisman': {
      zh: ['球星闪耀', '有一名球员在决定比赛走向的时刻格外抢眼。'],
      en: ['Matchwinner', 'One standout player shaped the decisive moments.']
    },
    'flashpoint-player': {
      zh: ['焦点人物', '一名球员在多个改变局面的瞬间成为焦点，表现起伏很大。'],
      en: ['Flashpoint Player', 'One player sat at the heart of multiple game-changing moments.']
    },
    'contested-call': {
      zh: ['争议判罚', '赛后独立裁判评议认定，本场有关键判罚出错。'],
      en: ['Contested Call', 'Post-match independent review flagged a key officiating error.']
    },
    'var-spotlight': {
      zh: ['VAR 介入', '一次涉及进球、点球或红牌的复核值得回看。'],
      en: ['VAR Spotlight', 'A pivotal review involving a goal, penalty, or red card is worth rewatching.']
    },
    'end-to-end': {
      zh: ['对攻大战', '双方在多个时段互有攻势，都能把球打到危险区域。'],
      en: ['End-to-End', 'Both teams traded sustained attacking waves into dangerous areas.']
    },
    'team-move': {
      zh: ['团队配合', '留意多人连续传递打穿防线的那次配合。'],
      en: ['Team Move', 'Watch for a flowing multi-pass combination cutting open the defense.']
    },
    'keeper-show': {
      zh: ['门神发挥', '高难度扑救接连出现，门线上的表现值得看。'],
      en: ['Keeper Show', 'A string of top-drawer saves made goalkeeping a highlight.']
    },
    'late-drama': {
      zh: ['尾声悬念', '比赛进入尾声时局面依然紧，门前还有连续机会。'],
      en: ['Late Drama', 'The match stayed razor-tight late on with chances right to the wire.']
    },
    'highlight-reel': {
      zh: ['名场面频出', '短时间内连续出现值得回看的镜头。'],
      en: ['Highlight Reel', 'A rapid burst of replay-worthy moments packed into a short spell.']
    }
  };

  const STRINGS = {
    zh: {
      skip: '跳到比赛列表',
      brandAria: 'Rate90 首页',
      brandTag: '只看精彩足球',
      leagueFilterAria: '联赛筛选',
      leagueListAria: '赛事列表',
      loadingRatings: '正在载入比赛评分…',
      loadError: '比赛数据加载失败，请刷新页面重试。',
      footerAria: '页脚',
      about: '关于 Rate90',
      method: '评分方法',
      aboutBody: 'Rate90 是一份无剧透的足球回看指南，收录欧冠和五大联赛。选一轮比赛，看评分和推荐理由，再决定今晚看哪场。',
      methodBody: 'Rate90 不按最终比分或球队名气打分，而是依据全场过程数据从六个量化维度加权计分，满分 10 分。',
      langBtnLabel: 'EN',
      langSwitchTitle: 'Switch to English',
      langSwitchAria: '切换为英文',
      langSwitched: '已切换为中文',
      themeAria: '切换明暗主题',
      themeToLight: '切换浅色主题',
      themeToDark: '切换深色主题',
      close: '关闭',
      done: '确定',
      noRating: '暂无评分',
      ratingAria: '评分 {score}',
      matchTagsAria: '比赛标签',
      matchVs: '{home} 对 {away}',
      currentRound: '当前轮次',
      allRounds: '全部轮次',
      upcomingRound: '即将开赛',
      followingRound: '后续赛程',
      notStarted: '未开赛',
      futureSchedule: '未来赛程',
      unplayedCount: '{count} 场未开赛',
      pickDate: '选择日期',
      byDate: '按日期',
      currentRoundsMulti: '当期各轮',
      roundJump: '轮次跳转',
      prevRound: '前一轮',
      prevRoundTitle: '上一轮',
      nextRound: '后一轮',
      nextRoundTitle: '下一轮',
      pickRound: '选择轮次',
      dateJump: '日期跳转',
      pickMatchDate: '选择比赛日期',
      previewLoadError: '赛程读取失败。',
      retryLoad: '重新读取',
      loadingSchedule: '正在读取未来赛程…',
      noSchedule: '暂无对应赛程。',
      seasonFmt: '{span} 赛季',
      calPrevMonth: '上个月',
      calNextMonth: '下个月',
      calMonthTitle: '{year}年 {month}月',
      calWeekdays: ['一', '二', '三', '四', '五', '六', '日'],
      calTierFuture: '未来赛程',
      calTierHigh: '含 8.0+ 高分比赛',
      calTierRated: '有已评分比赛',
      calTierScheduled: '有赛程，暂无评分',
      calTierRest: '无比赛日',
      calLegendRated: '已评',
      calLegendFuture: '未来',
      calClear: '清除',
      noFixtures: '暂无已公布的对阵。',
      emptyPicks: 'AI 赛前评估 · 本轮暂无全场推荐',
      mustWatch: '强烈推荐',
      worthWatching: '值得一看',
      aiMustWatchAria: 'AI 强烈推荐',
      aiWorthWatchingAria: 'AI 值得一看',
      leg1: '首回合',
      leg2: '次回合',
      tbd: '待定',
      tabLineups: '首发阵容',
      tabSubstitutes: '替补阵容',
      tabStats: '比赛数据',
      tabEvents: '比赛动态',
      tabTactics: '战术分析',
      detailTabsAria: '比赛详情',
      noRoster: '暂无名单',
      noBench: '暂无替补名单',
      noLineups: '暂无首发阵容',
      shirtNumber: '球衣号码',
      captain: '队长',
      formationSr: '开场阵型 ',
      coachPrefix: '教练 ',
      regularTime: '常规时间',
      statsTableAria: '常规时间技术统计',
      statShots: '射门',
      statShotsOnTarget: '射正',
      statXg: '预期进球',
      statPossession: '控球率',
      statCrosses: '传中尝试',
      statTackles: '抢断尝试',
      statDistanceKm: '跑动距离',
      momentumTitle: '逐分钟攻势',
      momentumEven: '均势',
      momentumAria: '常规时间攻势，上方为{home}，下方为{away}',
      cardYellow: '黄牌',
      cardYellowRed: '两黄变一红',
      cardRed: '红牌',
      subIn: '换上',
      subOut: '换下',
      subSr: '换人 ',
      noEvents: '暂无事件资料',
      noSubsOrCards: '无换人及出牌记录',
      halftime: '中场',
      coachBenchAria: '教练席',
      coachRating: '教练评分',
      coachRatingAria: '教练评分 {score} / 10',
      homeManager: '主队主帅',
      awayManager: '客队主帅',
      tacticsNotReady: '本队战术分析尚未生成',
      tacticsNone: '本场暂无战术分析',
      tacticsEmptySub: '赛后完整事件与站位数据齐备后将自动生成 {team} 教练席复盘',
      tacticsReviewAria: '{team}战术复盘',
      tacticalXI: '首发',
      tacticalSummary: '总结',
      aiNote: '✦ AI 点评',
      peekTitle: '真的要偷看一眼吗？',
      peekDesc: '仅解锁本场的{tab}。',
      peekCancel: '还是算了',
      peekConfirm: '偷看一眼',
      noDetails: '暂无本场详细资料',
      noStats: '暂无技术统计',
      loadingDetails: '正在读取本场资料…',
      detailsLoadError: '详细资料读取失败。',
      copiedLink: '已复制无剧透比赛链接。',
      roundTbd: '轮次待定'
    },
    en: {
      skip: 'Skip to matches',
      brandAria: 'Rate90 Home',
      brandTag: 'Watch Only Great Football',
      leagueFilterAria: 'Competition filter',
      leagueListAria: 'Competitions',
      loadingRatings: 'Loading match ratings…',
      loadError: 'Failed to load match data. Please refresh and try again.',
      footerAria: 'Footer',
      about: 'About Rate90',
      method: 'Rating Method',
      aboutBody: 'Rate90 is a spoiler-free football replay guide covering the Champions League and Europe\'s top five leagues. Pick a round, check ratings and tags, and choose tonight\'s match.',
      methodBody: 'Rate90 never rates by final scoreline or club reputation. Every match is scored out of 10 from six weighted quantitative dimensions measured across the full 90 minutes.',
      langBtnLabel: '中文',
      langSwitchTitle: '切换为中文',
      langSwitchAria: 'Switch to Chinese',
      langSwitched: 'Switched to English',
      themeAria: 'Toggle color theme',
      themeToLight: 'Switch to light theme',
      themeToDark: 'Switch to dark theme',
      close: 'Close',
      done: 'Done',
      noRating: 'Not yet rated',
      ratingAria: 'Rating {score}',
      matchTagsAria: 'Match tags',
      matchVs: '{home} vs {away}',
      currentRound: 'Latest Round',
      allRounds: 'All Rounds',
      upcomingRound: 'Upcoming',
      followingRound: 'Next Round',
      notStarted: 'Upcoming',
      futureSchedule: 'Upcoming Fixtures',
      unplayedCount: '{count} upcoming',
      pickDate: 'Pick Date',
      byDate: 'By Date',
      currentRoundsMulti: 'Current Rounds',
      roundJump: 'Jump to round',
      prevRound: 'Previous round',
      prevRoundTitle: 'Previous round',
      nextRound: 'Next round',
      nextRoundTitle: 'Next round',
      pickRound: 'Select round',
      dateJump: 'Jump to date',
      pickMatchDate: 'Select match date',
      previewLoadError: 'Failed to load fixtures.',
      retryLoad: 'Retry',
      loadingSchedule: 'Loading upcoming fixtures…',
      noSchedule: 'No fixtures available for this selection.',
      seasonFmt: '{span} Season',
      calPrevMonth: 'Previous month',
      calNextMonth: 'Next month',
      calMonthTitle: '{monthName} {year}',
      calWeekdays: ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'],
      calTierFuture: 'Upcoming fixtures',
      calTierHigh: 'Includes 8.0+ match',
      calTierRated: 'Rated matches',
      calTierScheduled: 'Scheduled, unrated',
      calTierRest: 'No matches',
      calLegendRated: 'Rated',
      calLegendFuture: 'Upcoming',
      calClear: 'Clear',
      noFixtures: 'No fixtures announced yet.',
      emptyPicks: 'AI Pre-Match · No full-match picks this round',
      mustWatch: 'Must Watch',
      worthWatching: 'Worth It',
      aiMustWatchAria: 'AI Must Watch',
      aiWorthWatchingAria: 'AI Worth Watching',
      leg1: '1st Leg',
      leg2: '2nd Leg',
      tbd: 'TBD',
      tabLineups: 'Lineups',
      tabSubstitutes: 'Bench',
      tabStats: 'Stats',
      tabEvents: 'Timeline',
      tabTactics: 'Tactics',
      detailTabsAria: 'Match details',
      noRoster: 'No squad data',
      noBench: 'No substitutes available',
      noLineups: 'No starting lineups available',
      shirtNumber: 'Shirt number',
      captain: 'Captain',
      formationSr: 'Formation ',
      coachPrefix: 'Coach ',
      regularTime: '90 Min',
      statsTableAria: 'Regular-time match statistics',
      statShots: 'Shots',
      statShotsOnTarget: 'On Target',
      statXg: 'Expected Goals',
      statPossession: 'Possession',
      statCrosses: 'Crosses',
      statTackles: 'Tackles',
      statDistanceKm: 'Distance',
      momentumTitle: 'Momentum',
      momentumEven: 'Even',
      momentumAria: 'Regular-time momentum, {home} above, {away} below',
      cardYellow: 'Yellow Card',
      cardYellowRed: 'Second Yellow',
      cardRed: 'Red Card',
      subIn: 'Sub On',
      subOut: 'Sub Off',
      subSr: 'Substitution ',
      noEvents: 'No match events available',
      noSubsOrCards: 'No substitutions or cards recorded',
      halftime: 'HT',
      coachBenchAria: 'Dugout',
      coachRating: 'Coach',
      coachRatingAria: 'Coach rating {score} / 10',
      homeManager: 'Home Manager',
      awayManager: 'Away Manager',
      tacticsNotReady: 'Tactical review not yet generated',
      tacticsNone: 'No tactical analysis for this match',
      tacticsEmptySub: 'Dugout review for {team} will be generated once full post-match event and tracking data is ready.',
      tacticsReviewAria: '{team} tactical review',
      tacticalXI: 'XI',
      tacticalSummary: 'Summary',
      aiNote: '✦ AI Note',
      peekTitle: 'Sure you want a peek?',
      peekDesc: 'Unlocks {tab} for this match only.',
      peekCancel: 'Never mind',
      peekConfirm: 'Take a peek',
      noDetails: 'No detailed data available for this match',
      noStats: 'No statistics available',
      loadingDetails: 'Loading match details…',
      detailsLoadError: 'Failed to load match details.',
      copiedLink: 'Spoiler-free match link copied.',
      roundTbd: 'Round TBD'
    }
  };

  // Complete 184-coach Chinese translation dictionary covering all competitions in dataset
  const COACH_ZH = {
    'Aaron Danks': '亚伦·丹克斯',
    'Adolf Hütter': '阿道夫·许特尔',
    'Adrian Gula': '阿德里安·古拉',
    'Alberto Aquilani': '阿尔贝托·阿奎拉尼',
    'Alberto Gilardino': '阿尔贝托·吉拉迪诺',
    'Alexander Blessin': '亚历山大·布莱辛',
    'Alexandre Dujeux': '亚历山大·迪热',
    'Andoni Iraola': '安多尼·伊劳拉',
    'Andrei Demchenko': '安德烈·杰姆琴科',
    'Antonio Hidalgo': '安东尼奥·伊达尔戈',
    'Arda Turan': '阿尔达·图兰',
    'Augusto Daniel Portela da Silva': '奥古斯托·波尔特拉',
    'Benat San Jose': '贝尼亚特·圣何塞',
    'Brian Priske': '布莱恩·普里斯克',
    'Bruno Genesio': '布鲁诺·热内西奥',
    'Carles Martínez': '卡莱斯·马丁内斯',
    'Carlos Corberán': '卡洛斯·科贝兰',
    'Carlos Cuesta': '卡洛斯·奎斯塔',
    'Carlos Vicens': '卡洛斯·维森斯',
    'Cesc Fàbregas': '塞斯克·法布雷加斯',
    'Christian Ilzer': '克里斯蒂安·伊尔泽',
    'Claudio Giráldez': '克劳迪奥·希拉尔德斯',
    'Craig Harrison': '克雷格·哈里森',
    'Cristian Chivu': '克里斯蒂安·齐沃',
    'Cristian Fabbiani': '克里斯蒂安·法比亚尼',
    'Daniel Farke': '丹尼尔·法尔克',
    'Daniel Thioune': '丹尼尔·蒂乌内',
    'Daniele De Rossi': '达尼埃莱·德罗西',
    'Danilo Girolomoni': '达尼洛·吉罗洛莫尼',
    'David Hubert': '大卫·于贝尔',
    'David Moyes': '大卫·莫耶斯',
    'Davide Ancelotti': '达维德·安切洛蒂',
    'Davide Nicola': '达维德·尼科拉',
    'Dejan Stanković': '德扬·斯坦科维奇',
    'Dick Schreuder': '迪克·施罗德',
    'Didier Digard': '迪迪埃·迪加尔',
    'Diego Simeone': '迭戈·西蒙尼',
    'Dietmar Kuhbauer': '迪特马尔·屈鲍尔',
    'Dino Toppmoller': '迪诺·托普默勒',
    'Dirk Kuijt': '德克·库伊特',
    'Domenico Tedesco': '多梅尼科·特德斯科',
    'Eder Sarabia': '埃德尔·萨拉维亚',
    'Edin Terzić': '埃丁·泰尔齐奇',
    'Efraín Juárez': '埃弗拉因·华雷斯',
    'Enzo Maresca': '恩佐·马雷斯卡',
    'Eugen Polanski': '欧根·波兰斯基',
    'Eusebio Di Francesco': '欧塞比奥·迪弗朗切斯科',
    'Fabian Hurzeler': '法比安·许尔策勒',
    'Fabio Grosso': '法比奥·格罗索',
    'Fabio Ingolitsch': '法比奥·因戈利奇',
    'Fabio Pisacane': '法比奥·皮萨卡内',
    'Felip Ortiz': '费利普·奥尔蒂斯',
    'Filipe Coelho': '菲利佩·科埃略',
    'Filipe Luís': '菲利佩·路易斯',
    'Filipp Sokolinskiy': '菲利普·索科林斯基',
    'Francesco Farioli': '弗朗切斯科·法廖利',
    'Franck Haise': '弗兰克·艾斯',
    'Frank Lampard': '弗兰克·兰帕德',
    'Gary Haveron': '加里·哈弗伦',
    'Gary O\'Neil': '加里·奥尼尔',
    'Gennaro Gattuso': '詹纳罗·加图索',
    'Gian Luca Privitelli': '吉安·卢卡·普里维泰利',
    'Gian Piero Gasperini': '吉安·皮耶罗·加斯佩里尼',
    'Gian-Luca Privitelli': '吉安·卢卡·普里维泰利',
    'Giovanni Stroppa': '乔瓦尼·斯特罗帕',
    'Giovanni van Bronckhorst': '乔瓦尼·范布隆克霍斯特',
    'Hans-Dieter Flick': '汉斯-迪特·弗里克',
    'Henning Berg': '亨宁·贝格',
    'Hugo Oliveira': '乌戈·奥利维拉',
    'Ignazio Abate': '伊尼亚齐奥·阿巴特',
    'Ivan Jurić': '伊万·尤里奇',
    'Ivan Leko': '伊万·莱科',
    'Iñigo Pérez': '伊尼戈·佩雷斯',
    'Jagoba Arrasate': '哈戈巴·阿拉萨特',
    'Jair Karam': '雅伊尔·卡拉姆',
    'Jakob Poulsen': '雅各布·波尔森',
    'Jan Moritz Lichte': '扬·莫里茨·利希特',
    'Javier Aguirre': '哈维尔·阿吉雷',
    'Jens Askou': '延斯·阿斯科',
    'Jindřich Trpišovský': '因德日赫·特尔皮绍夫斯基',
    'Jorge Maciel': '若热·马西埃尔',
    'Jose Luis Mendilibar': '何塞·路易斯·门迪利巴',
    'José Alberto López': '何塞·阿尔贝托·洛佩斯',
    'José Bordalás': '何塞·博达拉斯',
    'José Mourinho': '何塞·穆里尼奥',
    'Juan Bezares': '胡安·贝萨雷斯',
    'Juan Funes': '胡安·富内斯',
    'Juan Manuel Pavon Dominguez': '胡安·曼努埃尔·帕翁',
    'Julian Schuster': '尤利安·舒斯特',
    'Julien Lachuer': '朱利安·拉许埃尔',
    'Julio Velazquez': '胡里奥·贝拉斯克斯',
    'Karl Marius Aksum': '卡尔·马里乌斯·阿克苏姆',
    'Keith Andrews': '基思·安德鲁斯',
    'Kjetil Knutsen': '谢蒂尔·克努森',
    'Konstantin Vassiljev': '康斯坦丁·瓦西里耶夫',
    'Kosta Runjaic': '科斯塔·伦亚伊奇',
    'Liam Rosenior': '利亚姆·罗森尼尔',
    'Luciano Spalletti': '卢西亚诺·斯帕莱蒂',
    'Luis Enrique': '路易斯·恩里克',
    'Luis Garcia': '路易斯·加西亚',
    'Luis Miguel Ramis': '路易斯·米格尔·拉米斯',
    'Luís Castro': '路易斯·卡斯特罗',
    'Magnus Powell': '马格努斯·鲍威尔',
    'Magomed Adiev': '马戈梅德·阿季耶夫',
    'Manolo Gonzalez': '马诺洛·冈萨雷斯',
    'Manuel Baum': '曼努埃尔·鲍姆',
    'Manuel Jorge Da Silva Cruz': '曼努埃尔·克鲁斯',
    'Manuel Pellegrini': '曼努埃尔·佩莱格里尼',
    'Manuel Tulipa': '曼努埃尔·图利帕',
    'Marco Rose': '马可·罗泽',
    'Mario Kovačević': '马里奥·科瓦切维奇',
    'Marko Nikolić': '马尔科·尼科利奇',
    'Martin Anselmi': '马丁·安塞尔米',
    'Martin O\'Neill': '马丁·奥尼尔',
    'Martín Demichelis': '马丁·德米凯利斯',
    'Massimiliano Allegri': '马西米利亚诺·阿莱格里',
    'Massimiliano Alvini': '马西米利亚诺·阿尔维尼',
    'Matthias Jaissle': '马蒂亚斯·雅伊斯勒',
    'Mauricio Pochettino': '毛里西奥·波切蒂诺',
    'Maurizio Sarri': '毛里齐奥·萨里',
    'Mauro Lustrinelli': '毛罗·卢斯特里内利',
    'Merlin Polzin': '梅林·波尔钦',
    'Michael Carrick': '迈克尔·卡里克',
    'Michal Gasparik': '米哈尔·加什帕里克',
    'Miika Nuutinen': '米卡·努蒂宁',
    'Mikel Arteta': '米克尔·阿尔特塔',
    'Milorad Peković': '米洛拉德·佩科维奇',
    'Miron Muslić': '米龙·穆斯利奇',
    'Morten Jensen': '莫滕·延森',
    'Nevil Dede': '内维尔·德德',
    'Niels Frederiksen': '尼尔斯·弗雷德里克森',
    'Niko Kovač': '尼科·科瓦奇',
    'Okan Buruk': '奥坎·布鲁克',
    'Oliver Glasner': '奥利弗·格拉斯纳',
    'Olivier Pantaloni': '奥利维耶·潘塔洛尼',
    'Paolo Vanoli': '保罗·瓦诺利',
    'Paolo Zanetti': '保罗·扎内蒂',
    'Patrick Videira': '帕特里克·维代拉',
    'Paulo Fonseca': '保罗·丰塞卡',
    'Pellegrino Matarazzo': '佩莱格里诺·马塔拉佐',
    'Peter Bosz': '彼得·博斯',
    'Pierre Sage': '皮埃尔·萨热',
    'Quique Sánchez Flores': '基克·桑切斯·弗洛雷斯',
    'Rafael Urazbakhtin': '拉斐尔·乌拉兹巴赫京',
    'Raffaele Palladino': '拉斐尔·帕拉迪诺',
    'Ralf Kettemann': '拉尔夫·克特曼',
    'Ran Kozuch': '兰·科祖赫',
    'Ran Kozuk': '兰·科祖赫',
    'René Wagner': '勒内·瓦格纳',
    'Roberto D\'Aversa': '罗伯托·达维尔萨',
    'Roberto De Zerbi': '罗伯托·德泽尔比',
    'Rui Borges': '鲁伊·博尔热斯',
    'Régis Le Bris': '雷吉斯·勒布里斯',
    'Rúben Amorim': '鲁本·阿莫林',
    'Sebastian Hoeneß': '塞巴斯蒂安·赫内斯',
    'Sergej Jakirović': '谢尔盖·亚基罗维奇',
    'Shota Makharadze': '肖塔·马哈拉泽',
    'Solvi Geir': '索尔维·盖尔',
    'Stephane Dumont': '斯特凡·迪蒙',
    'Stephane Gilli': '斯特凡·吉利',
    'Stephen Bradley': '斯蒂芬·布拉德利',
    'Thomas Frank': '托马斯·弗兰克',
    'Tiago Fernandes': '蒂亚戈·费尔南德斯',
    'Unai Emery': '乌奈·埃梅里',
    'Urs Fischer': '乌尔斯·菲舍尔',
    'Valdas Dambrauskas': '瓦尔达斯·丹布劳斯卡斯',
    'Valérien Ismaël': '瓦莱里安·伊斯梅尔',
    'Vincent Kompany': '文森特·孔帕尼',
    'Vincent Wagner': '文森特·瓦格纳',
    'Vinko Marinović': '温科·马里诺维奇',
    'Vitor Matos': '维托尔·马托斯',
    'Vítor Campelos': '维托尔·坎佩洛斯',
    'Vítor José Joaquim Pereira': '维托尔·佩雷拉',
    'Will Still': '威尔·斯蒂尔',
    'Wouter Vrancken': '沃特·弗兰肯',
    'Xabi Alonso': '哈维·阿隆索',
    'Yannick Cahuzac': '亚尼克·卡于扎克',
    'Yaya Toure': '亚亚·图雷',
    'Yaya Touré': '亚亚·图雷',
    'Zekirija Ramadani': '泽基里亚·拉马达尼',
    'Álvaro Arbeloa': '阿尔瓦罗·阿韦洛亚',
    'Óscar Sánchez': '奥斯卡·桑切斯',
    'İsmail Kartal': '伊斯梅尔·卡尔塔尔',
    'Željko Sopić': '热利科·索皮奇',
    'Carlo Ancelotti': '卡洛·安切洛蒂',
    'Pep Guardiola': '佩普·瓜迪奥拉',
    'Arne Slot': '阿尔内·斯洛特',
    'Simone Inzaghi': '西蒙尼·因扎吉',
    'Antonio Conte': '安东尼奥·孔蒂',
    'Matías Almeyda': '马蒂亚斯·阿尔梅达'
  };

  // Populated on demand from ./ui/data/players-zh.js (100% coverage of all 4,400+ players)
  const PLAYER_ZH = {};

  function normName(str) {
    return String(str || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[´`'’]/g, "'")
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  const COACH_NORM = new Map();
  for (const [en, zh] of Object.entries(COACH_ZH)) {
    COACH_NORM.set(normName(en), zh);
  }

  const PLAYER_NORM = new Map();

  function registerPlayers(map) {
    if (!map || typeof map !== 'object') return;
    for (const [en, zh] of Object.entries(map)) {
      if (!en || !zh) continue;
      PLAYER_ZH[en] = zh;
      PLAYER_NORM.set(normName(en), zh);
    }
  }

  function readLang() {
    try {
      const raw = localStorage.getItem('rate90.v2.lang');
      const parsed = raw === null ? 'zh' : JSON.parse(raw);
      return parsed === 'en' ? 'en' : 'zh';
    } catch {
      return 'zh';
    }
  }

  let currentLang = readLang();

  function applyHtmlLang(lang) {
    if (typeof document !== 'undefined' && document.documentElement) {
      document.documentElement.lang = lang === 'en' ? 'en' : 'zh-CN';
    }
  }

  applyHtmlLang(currentLang);

  function getLang() {
    return currentLang;
  }

  function setLang(lang) {
    currentLang = lang === 'en' ? 'en' : 'zh';
    try {
      localStorage.setItem('rate90.v2.lang', JSON.stringify(currentLang));
    } catch {}
    applyHtmlLang(currentLang);
    return currentLang;
  }

  function t(key, vars) {
    const dict = STRINGS[currentLang] || STRINGS.zh;
    let val = Object.hasOwn(dict, key) ? dict[key] : STRINGS.zh[key];
    if (typeof val !== 'string') return val ?? key;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        val = val.replaceAll('{' + k + '}', String(v ?? ''));
      }
    }
    return val;
  }

  function leagueName(id, form = 'short') {
    const entry = LEAGUES_I18N[id];
    if (!entry) return String(id || '');
    const pack = entry[currentLang] || entry.zh;
    return pack[form] || pack.short;
  }

  function teamName(team) {
    if (!team) return '';
    if (typeof team === 'string') return team;
    return currentLang === 'en' ? (team.en || team.zh || '') : (team.zh || team.en || '');
  }

  function formatDate(date) {
    if (!date || date.length < 10) return date || '';
    const m = Number(date.slice(5, 7));
    const d = Number(date.slice(8, 10));
    if (!m || !d) return date;
    if (currentLang === 'en') return (MONTHS_EN[m - 1] || m) + ' ' + d;
    return m + '月' + d + '日';
  }

  function formatSpan(matches) {
    const dates = matches.map(m => m.date).filter(Boolean).sort();
    if (!dates.length) return '';
    const first = formatDate(dates[0]);
    const last = formatDate(dates[dates.length - 1]);
    return first === last ? first : first + ' – ' + last;
  }

  function formatMonthYear(year, monthIndex) {
    if (currentLang === 'en') return (MONTHS_EN[monthIndex] || '') + ' ' + year;
    return year + '年 ' + (monthIndex + 1) + '月';
  }

  function formatRound(league, round) {
    if (typeof round === 'number' && round > 0) {
      if (currentLang === 'en') {
        return (league === 'cl' ? 'League MD ' : 'Matchday ') + round;
      }
      return (league === 'cl' ? '联赛阶段 ' : '') + '第 ' + round + ' 轮';
    }
    const key = String(round || '').toLowerCase();
    const qualifier = /^qualification round (\d+)$/.exec(key);
    if (currentLang === 'en') {
      const enLabels = {
        'round of 16': 'Round of 16',
        'quarter-finals': 'Quarter-Finals',
        'semi-finals': 'Semi-Finals',
        'final': 'Final',
        'knockout phase play-offs': 'Knockout Play-Offs',
        'playoff round': 'Play-Off Round',
        '轮次待定': 'Round TBD'
      };
      if (qualifier) return 'Qualifying Rd ' + qualifier[1];
      return Object.hasOwn(enLabels, key) ? enLabels[key] : (round || 'Round TBD');
    }
    const zhLabels = {
      'round of 16': '1/8 决赛',
      'quarter-finals': '1/4 决赛',
      'semi-finals': '半决赛',
      'final': '决赛',
      'knockout phase play-offs': '淘汰赛附加赛'
    };
    if (qualifier) return '资格赛第 ' + qualifier[1] + ' 轮';
    if (key === 'playoff round') return '资格赛附加赛';
    return Object.hasOwn(zhLabels, key) ? zhLabels[key] : (round || '轮次待定');
  }

  function styleLabel(id, zhFallback) {
    const item = STYLE_I18N[id];
    if (!item) return zhFallback || id;
    if (currentLang === 'en') return item.en[0];
    return zhFallback || item.zh[0];
  }

  function styleDesc(id) {
    const item = STYLE_I18N[id];
    if (!item) return '';
    return currentLang === 'en' ? item.en[1] : item.zh[1];
  }

  function coachName(name, zhOverride) {
    if (!name) return '';
    if (currentLang === 'en') return name;
    if (zhOverride) return zhOverride;
    if (Object.hasOwn(COACH_ZH, name)) return COACH_ZH[name];
    const norm = normName(name);
    if (COACH_NORM.has(norm)) return COACH_NORM.get(norm);
    // Support abbreviated forms like "M. Almeyda" or "C. Ancelotti"
    const abbr = /^([a-z])\.\s+(.+)$/.exec(norm);
    if (abbr) {
      const [, initial, surname] = abbr;
      for (const [k, zh] of COACH_NORM) {
        if (k.startsWith(initial) && (k.endsWith(' ' + surname) || k === surname)) return zh;
      }
    }
    return name;
  }

  function buildSquadLookup(lineups) {
    const entries = [];
    if (!lineups) return entries;
    for (const side of ['home', 'away']) {
      const s = lineups[side];
      if (!s) continue;
      for (const pl of [...(s.players || []), ...(s.substitutes || [])]) {
        if (!pl?.name) continue;
        entries.push({
          name: pl.name,
          zh: pl.zh || '',
          norm: normName(pl.name)
        });
      }
    }
    return entries;
  }

  function playerName(name, zhOverride, squadEntries) {
    if (!name) return '';
    if (currentLang === 'en') return name;
    if (zhOverride) return zhOverride;
    if (Object.hasOwn(PLAYER_ZH, name)) return PLAYER_ZH[name];
    const norm = normName(name);
    if (PLAYER_NORM.has(norm)) return PLAYER_NORM.get(norm);

    // Match abbreviated event names (e.g. "P. Foden", "L. Jović", "M. Gaćinović") against match squad
    if (Array.isArray(squadEntries) && squadEntries.length) {
      const abbr = /^([a-z])\.\s+(.+)$/.exec(norm);
      if (abbr) {
        const [, initial, rest] = abbr;
        const hit = squadEntries.find(item =>
          item.norm.startsWith(initial) && (item.norm.endsWith(' ' + rest) || item.norm === rest)
        ) || squadEntries.find(item => item.norm.endsWith(' ' + rest));
        if (hit) {
          if (hit.zh) return hit.zh;
          if (PLAYER_NORM.has(hit.norm)) return PLAYER_NORM.get(hit.norm);
        }
      } else {
        const clean = norm.replace(/\s+jr\.?$/, ' junior');
        const hit = squadEntries.find(item => item.norm === clean || item.norm.endsWith(' ' + norm));
        if (hit) {
          if (hit.zh) return hit.zh;
          if (PLAYER_NORM.has(hit.norm)) return PLAYER_NORM.get(hit.norm);
        }
      }
    }

    // Fallback check against global PLAYER_NORM for abbreviated names
    const abbr = /^([a-z])\.\s+(.+)$/.exec(norm);
    if (abbr) {
      const [, initial, rest] = abbr;
      for (const [k, zh] of PLAYER_NORM) {
        if (k.startsWith(initial) && k.endsWith(' ' + rest)) return zh;
      }
    }
    return name;
  }

  window.Rate90 = window.Rate90 || {};
  window.Rate90.i18n = {
    getLang,
    setLang,
    t,
    leagueName,
    teamName,
    formatDate,
    formatSpan,
    formatMonthYear,
    formatRound,
    styleLabel,
    styleDesc,
    coachName,
    playerName,
    registerPlayers,
    buildSquadLookup
  };
})();
