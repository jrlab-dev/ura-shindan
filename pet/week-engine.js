/* 1週間の出会い・構造化記憶。会話全文や音声は保存しない。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LittleCompanionWeek = factory(root.LittleCompanionLife);
}(typeof self !== 'undefined' ? self : this, function (Life) {
  'use strict';
  const DAY_THEMES = [
    { id:'hello', title:'はじめまして', call:'きょうは、ことばをひとつ教えて？', activity:'ひとことを教える' },
    { id:'preference', title:'すきなもの', call:'ぼくのすきなもの、見つけよう', activity:'ペットの好みを探す' },
    { id:'mood', title:'きょうの気分', call:'きょうは、どんなきぶん？', activity:'気分を聞く' },
    { id:'treasure', title:'ちいさな発見', call:'ちいさな宝物を見つけたよ', activity:'発見を共有する' },
    { id:'copy', title:'まねっこ', call:'きみのことば、まねしていい？', activity:'ことばをまねる' },
    { id:'family', title:'家族の日', call:'きてくれたね。きょうは誰かな？', activity:'プロフィールを選ぶ' },
    { id:'partner', title:'相棒の日', call:'いままでの思い出、ひとつ見よう', activity:'思い出を振り返る' }
  ];
  const DAILY_ACTIVITIES = [
    {name:'ぷにをつかまえる',title:'ぷにをつかまえる',intro:'ぷにを、そっとつかまえよう',end:'ぷに、つかまえたね',sound:'play'},
    {name:'ゆっくりぷに',title:'ゆっくりぷに',intro:'ゆっくり、ぷにを追ってみよう',end:'ゆっくりできたね',sound:'quiet'},
    {name:'ぷにをさがす',title:'ぷにをさがす',intro:'どこかな、ぷにをさがそう',end:'ぷに、みつけたね',sound:'curious'},
    {name:'しずかなぷに',title:'しずかなぷに',intro:'しずかに、ぷにをつかまえよう',end:'ぷにが、とろんとしたね',sound:'sleepy'},
    {name:'ぷにを追いかける',title:'ぷにを追いかける',intro:'ゆびで、ぷにを追ってみよう',end:'追いかけっこ、たのしかったね',sound:'play'},
    {name:'ぷにがいっぱい',title:'ぷにがいっぱい',intro:'ぷにを、いっぱいつかまえよう',end:'いっぱい、つかまえたね',sound:'happy'},
    {name:'相棒のお祝い',title:'相棒のお祝い',intro:'7日分のお祝いをしよう',end:'お祝い、うれしいね',sound:'proud'}
  ];
  const SPONTANEOUS_EVENTS = [
    ['sneeze','くしゅん。いまの、きこえた？','shy'],['hiccup','ひっく…あれれ？','curious'],['yawn','ふぁ…。ちょっとゆっくりするね','sleepy'],['ear-twitch','おみみが、ぴくっ','curious'],['eye-contact','めがあったね','close'],['nod-late','いま、うなずいたよ','proud'],
    ['light','ひかりが、きらり','happy'],['shadow','かげが、すーっとしたよ','curious'],['sound','ちいさなおとがしたね','curious'],['rain','あめの音、しずかだね','quiet'],['round','まるいもの、みつけた','playful'],['edge','画面のはし、気になるな','curious'],
    ['sparkle','きらりを見つけたよ','happy'],['own-like','ぼくは、まるいのがすきかも','proud'],['wonder','んーっと、考え中','thinking'],['shy','ちょっと、てれるね','shy'],['quiet-wish','いまは、ゆっくりしたいな','quiet'],['proud','できた気がする','proud'],
    ['remember-word','前に教えてくれたことば、思い出しそう','curious'],['remember-play','前にいっしょに遊んだね','happy'],['family-call','きてくれたね','close'],['morning-stretch','おはよ。のびーっ','happy'],['day-watch','ひるの空、見てるよ','curious'],['evening-recall','きょうも、あえたね','close'],['night-whisper','おやすみ前は、小さな声','quiet']
  ].map(([id,text,sound]) => ({id,text,sound}));
  const localDate = value => { const d = value instanceof Date ? value : new Date(value || Date.now()); const p = n => String(n).padStart(2,'0'); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`; };
  const stamp = value => new Date(value || Date.now()).toISOString().slice(0,30);
  const safe = value => String(value || '').replace(/[<>\u0000-\u001f]/g,'').trim().slice(0,12);
  function ensure(data) {
    if (!data.weekProgress) data.weekProgress = {visitDates:[],dayIndex:1,dailyBeat:'greeting',dayHistory:{},lastCallbackAt:'',completedAt:''};
    if (!Array.isArray(data.weekProgress.visitDates)) data.weekProgress.visitDates = [];
    if (!data.weekProgress.dayHistory || typeof data.weekProgress.dayHistory !== 'object') data.weekProgress.dayHistory = {};
    if (!Array.isArray(data.factMemories)) data.factMemories = [];
    if (!Array.isArray(data.playMemories)) data.playMemories = [];
    if (!Array.isArray(data.callbackQueue)) data.callbackQueue = [];
    if (!Array.isArray(data.profiles) || !data.profiles.length) data.profiles = [{id:'p-default',name:'いつものひと',createdAt:stamp(),lastSeenAt:'',interactionCount:0}];
    if (!data.activeProfileId || !data.profiles.some(item => item.id === data.activeProfileId)) data.activeProfileId = data.profiles[0].id;
    return data;
  }
  function visit(data, now = new Date()) {
    ensure(data); const date = localDate(now); const p = data.weekProgress;
    const first = !p.visitDates.includes(date); const profile = data.profiles.find(item => item.id === data.activeProfileId); if (profile && !(profile.visitDates || []).includes(date)) profile.visitDates = [...(profile.visitDates || []), date].slice(-7); if (first) { p.visitDates = [...p.visitDates, date].slice(-7); p.dayIndex = Math.max(1, Math.min(7, p.visitDates.length)); p.dailyBeat = 'greeting'; }
    const day = DAY_THEMES[p.dayIndex - 1] || DAY_THEMES[6]; const history = p.dayHistory[date] || (p.dayHistory[date] = {intro:false,eventIds:[],callbackIds:[],activity:false});
    if (!history.intro) { history.intro = true; return {kind:'week-greeting', dayIndex:p.dayIndex, theme:day.id, text:day.call, activity:day.activity, sound:p.dayIndex === 7 ? 'proud' : 'curious', first}; }
    return null;
  }
  function dailyEvent(data, now = new Date()) {
    ensure(data); const date = localDate(now); const p = data.weekProgress; const history = p.dayHistory[date] || (p.dayHistory[date] = {intro:false,eventIds:[],callbackIds:[],activity:false});
    const ids = history.eventIds || []; const seed = Math.abs(Number(data.surpriseSeed) || 17) + p.dayIndex; const candidates = SPONTANEOUS_EVENTS.filter(event => !ids.includes(event.id)); if (!candidates.length) return null;
    const hour = (now instanceof Date ? now : new Date(now)).getHours(); const bucket = hour < 7 || hour >= 20 ? 'night' : hour < 12 ? 'morning' : hour < 17 ? 'day' : 'evening'; const routineScore = data.routine && data.routine[bucket] ? Object.values(data.routine[bucket]).reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0) : 0; const event = candidates[(seed + (data.socialMood === 'shy' ? 1 : data.socialMood === 'proud' ? 2 : 0) + (Array.isArray(data.recentActionKinds) ? data.recentActionKinds.length : 0) + routineScore) % candidates.length]; history.eventIds = [...ids, event.id].slice(-8); return {...event, kind:'week-event', dayIndex:p.dayIndex};
  }
  function captureFact(data, value, type = 'word', source = 'conversation', now = new Date()) {
    ensure(data); const text = safe(value); if (!text || (Life && Life.privateLike && Life.privateLike(text))) return null; if (/死にたい|自殺|けが|怪我|薬|住所|電話|学校|メール|裸|性的|エッチ/.test(text)) return null;
    const profileId = data.activeProfileId; const same = data.factMemories.find(item => item.profileId === profileId && item.value === text && item.type === type); if (same) { same.lastUsedAt = stamp(now); return same; }
    const item = {id:`fact-${Date.now()}-${data.factMemories.length}`,profileId,type,value:text,source,date:localDate(now),lastUsedAt:'',usedCount:0}; data.factMemories = [...data.factMemories, item].slice(-60); data.callbackQueue = [...data.callbackQueue, {...item,used:false}].slice(-12); return item;
  }
  function capturePlay(data, game, score = 0, now = new Date()) { ensure(data); const item = {id:`play-${Date.now()}-${data.playMemories.length}`,profileId:data.activeProfileId,game:safe(game).slice(0,20),value:safe(game).slice(0,20),type:'play',source:'game',date:localDate(now),score:Math.max(0,Number(score)||0),satisfaction:Number(score)>=5?'high':'good'}; data.playMemories = [...data.playMemories,item].slice(-30); data.callbackQueue = [...data.callbackQueue, {...item,used:false}].slice(-12); return item; }
  function callback(data, now = new Date()) {
    ensure(data); const date = localDate(now); const p = data.weekProgress; if (p.lastCallbackAt && localDate(p.lastCallbackAt) === date) return null;
    const history = p.dayHistory[date] || (p.dayHistory[date] = {intro:false,eventIds:[],callbackIds:[],activity:false}); const item = data.callbackQueue.find(candidate => !candidate.used && candidate.profileId === data.activeProfileId && candidate.date && candidate.date < date && !history.callbackIds.includes(candidate.id)); if (!item) return null;
    item.used = true; item.usedCount = (item.usedCount || 0) + 1; item.lastUsedAt = stamp(now); history.callbackIds = [...(history.callbackIds || []),item.id].slice(-2); p.lastCallbackAt = stamp(now); const child = data.childName || ''; const name = child ? `${child}${child.length <= 10 ? 'ちゃん' : ''}、` : '前に'; const tail = item.type === 'play' ? 'だね' : 'だよ'; const body = item.type === 'play' ? `${item.value}で遊んだね` : `「${item.value}」おぼえてる`; let text = `${name}${body}`; if (text.length > 16) { const room = Math.max(1, 16 - name.length - tail.length); text = `${name}${item.value.slice(0, room)}${tail}`.slice(0, 16); } return {kind:'week-callback',memoryId:item.id,text,sound:'happy'};
  }
  function advanceBeat(data, beat) { ensure(data); if (['greeting','question','activity','callback','done'].includes(beat)) data.weekProgress.dailyBeat = beat; return data.weekProgress.dailyBeat; }
  function nextActivity(data, now = new Date()) { ensure(data); const date = localDate(now); const h = data.weekProgress.dayHistory[date] || (data.weekProgress.dayHistory[date] = {intro:false,eventIds:[],callbackIds:[],activity:false}); if (h.activity) return null; h.activity = true; const activity = DAILY_ACTIVITIES[data.weekProgress.dayIndex-1] || DAILY_ACTIVITIES[0]; return {id:`activity-${data.weekProgress.dayIndex}`,...activity,dayIndex:data.weekProgress.dayIndex}; }
  function nextEvent(data, now = new Date()) { return dailyEvent(data, now); }
  return {DAY_THEMES, DAILY_ACTIVITIES, SPONTANEOUS_EVENTS, localDate, createDefaultWeek:() => ({visitDates:[],dayIndex:1,dailyBeat:'greeting',dayHistory:{},lastCallbackAt:'',completedAt:''}), ensure, visit, dailyEvent, nextEvent, captureFact, capturePlay, callback, advanceBeat, nextActivity};
}));
