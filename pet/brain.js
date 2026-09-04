/* 端末内会話エンジン。Node/CommonJSとブラウザの両方で使う。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LittleCompanionBrain = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const clean = value => String(value || '').replace(/[<>]/g, '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 50);
  const unsafe = value => /(?:\d{2,4}[-\s]?\d{2,4}[-\s]?\d{3,4}|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|(?:東京都|北海道|(?:大阪|京都)府|.{2,3}県).{1,20}(?:市|区|町|村)|住所|電話|学校|メール|顔写真)/i.test(value);
  const INTENTS = [
    ['greetingMorning',['おはよ','お早う','朝']], ['greetingDay',['こんにちは','こんちは']], ['greetingNight',['こんばんは','夜']], ['farewell',['ばいばい','またね','おやすみなさい']], ['reunion',['ひさしぶり','久しぶり','またあえた']],
    ['askPetName',['名前','なまえ','なんてよぶ']], ['askChildName',['ぼくの名前','わたしの名前','呼ばれたい']], ['askAge',['何歳','なんさい','年齢']], ['happy',['うれしい','嬉しい','楽しい','たのしい']], ['sad',['悲しい','かなしい','泣き','なき']], ['angry',['怒った','おこった','むかつく']], ['scared',['怖い','こわい','びっくり']], ['tired',['疲れた','つかれた','だるい']], ['bored',['退屈','たいくつ','ひま']],
    ['like',['好き','すき','大好き']], ['dislike',['嫌い','きらい','苦手','にがて']], ['food',['食べ','たべ','ごはん','おやつ']], ['animal',['動物','どうぶつ','犬','猫','ねこ']], ['color',['色','カラー','赤','青','黄色']], ['music',['音楽','おんがく','歌','うた']], ['picture',['絵','え','描く','かく']], ['book',['本','ほん','読む','よむ']], ['outdoors',['外遊び','そと','公園','こうえん']], ['weather',['天気','てんき','晴れ','はれ']], ['hot',['暑い','あつい']], ['cold',['寒い','さむい','さむく']], ['rain',['雨','あめ']], ['season',['季節','きせつ','春','夏','秋','冬']],
    ['play',['遊ぼ','あそぼ','遊ぶ','あそぶ']], ['rest',['休む','やすむ','ひとやすみ']], ['sleep',['寝る','ねる','ねむい','眠い']], ['wake',['起きる','おきる','おきた']], ['thanks',['ありがとう','ありがと']], ['apology',['ごめん','ごめんなさい']], ['praise',['えらい','かわいい','かっこいい']], ['encourage',['がんば','応援','おうえん']], ['laugh',['笑','わら','おもしろい']], ['number',['何個','なんこ','数字','すうじ']], ['choice',['どっち','どちら','選ん']], ['again',['もう一回','もういっかい','もっかい']], ['unknownQuestion',['どうして','なぜ','知ってる']], ['recall',['覚えて','おぼえて','忘れ']], ['petMood',['元気','げんき','気分','きぶん']], ['favorite',['好きなもの','すきなもの','お気に入り']], ['followWhy',['どうして？','なんで？']], ['followLike',['それ好き？','すき？']], ['followAgain',['もういっかい？','もう一回？']]
  ].map(([id, terms]) => ({ id, terms }));
  const REPLY_SEEDS = {
    greetingMorning:['おはよ。あえたね','おはよ。ぽかぽか','おはよ。きょうもいっしょ'], greetingDay:['こんにちは。うれし','やっほ。きたね','こんにちは。ここだよ'], greetingNight:['こんばんは。ゆっくり','こんばんは。きょうもおつかれ','よるだね。そばにいる'], farewell:['またね。まってる','ばいばい。きをつけて','またあそぼうね'], reunion:['あえた。うれしい','ひさしぶり。げんき？','またきてくれたね'],
    askPetName:['ぼくはぽこだよ','ぽこってよんでね','このなまえ、すき'], askChildName:['呼ばれたい呼び名、ある？','呼ばれたい呼び名を教えて','好きな呼び名でよぶね'], askAge:['ぼくはちいさいこだよ','なんさいかは、ひみつ','こころはふわふわ'], happy:['うれしいね。にこにこ','たのしいっていいね','きもちがぽかぽか'], sad:['そっか。ここにいるよ','かなしいね。ゆっくりでいいよ','なみだ、ふいてもいいよ'], angry:['ぷんぷんだね。ひとやすみ','いやだったね。そばにいるよ','おこってもだいじょうぶ'], scared:['こわいね。おうちのひとをよぼう','びっくりしたね。ここにいるよ','ゆっくり、いきをしてね'], tired:['つかれたね。ひとやすみ','ごろんしようか','ゆっくりでいいよ'], bored:['なにしてあそぶ？','ちょっとおしゃべりする？','いっしょなら、ひまじゃない'],
    like:['すきって、いいね','ぼくもきいてうれしい','それ、だいじなものだね'], dislike:['にがてもあるよね','むりしなくていいよ','すきなものをさがそう'], food:['もぐもぐ、おいしそう','ごはんはげんきのもと','おやつ、いいにおい'], animal:['どうぶつ、かわいいね','どのこがすき？','いっしょにみたいな'], color:['いろいろ、きれいだね','その色、すてき','ぽこ色もあるよ'], music:['おんがく、るんるん','どんな音がすき？','きこえると、からだがうごく'], picture:['おえかき、たのしそう','なにをかくの？','いろをぬりぬりしたい'], book:['ほんのページ、わくわく','どんなおはなし？','よんでくれたらうれしい'], outdoors:['おそと、ひろそう','おさんぽ、いいね','かぜを感じたいな'], weather:['おそら、見てみたい','きょうの天気はどう？','お天気でもいっしょ'], hot:['あついね。おみずをのもう','ひなたはぽかぽか','すずしいところでやすもう'], cold:['さむいね。あったかくしよう','ぎゅっとしてもいい？','おふとん、ぬくぬく'], rain:['あめの音、ぽつぽつ','かさをさしてね','雨の日もたのしいよ'], season:['季節がぐるぐるするね','どの季節がすき？','風のにおいがかわるね'],
    play:['あそぼ。なにする？','きらりをつかまえよう','いっしょだとたのしい'], rest:['やすむのもたいせつ','ちょっとごろん','ゆっくり充電しよう'], sleep:['おやすみ。いいゆめを','ねむねむ。またあした','すやすやしよう'], wake:['おはよう。めがあいた？','おきたね。おかえり','からだをのばそう'], thanks:['どういたしまして','えへへ。こちらこそ','ありがとうをもらったよ'], apology:['だいじょうぶ。なかなおり','うん。ゆっくりでいいよ','ごめんっていえたね'], praise:['えへへ。うれしい','きいて、にこにこ','きみもすてきだよ'], encourage:['おうえんするよ','ちいさく一歩でいいよ','いっしょにやってみよう'], laugh:['あはは。おもしろいね','ぷぷっ。わらっちゃう','にこにこだね'], number:['ひとつ、ふたつ、わくわく','かぞえるの、すき','いくつかな？'], choice:['どっちもいいね','きみはどっち？','えらぶの、わくわく'], again:['もういっかい、しよう','いいよ。もう一度','つぎはどうする？'], unknownQuestion:['むずかしいこと、きた','それはまだわからないよ','もうすこしおしえて'], recall:['おぼえてること、あるよ','きみとすごしたね','わすれちゃうこともあるよ'], petMood:['ぼくはまあまあげんき','ぽかぽか気分だよ','いまはきいてるよ'], favorite:['すきなもの、きかせて','ぼくはきみの話がすき','だいじにおぼえるね'], followWhy:['どうしてかな。いっしょに考えよ','うーん。むずかしいね','そう思ったんだね'], followLike:['うん、すきだよ','きいてみるとわくわく','すきかも。もう少し教えて'], followAgain:['もういっかい、いいよ','はいっ。もう一度','つづきをきかせて']
  };
  const EXTRA_REPLIES = { greetingMorning:['あさだね。にこにこ','おはよ。なにする？'], greetingDay:['きょうもきたね','おはなし、しよう'], greetingNight:['よるもいっしょ','おつかれ。ゆっくりね'], happy:['こころがるんるん','えがお、みつけた'], sad:['だいじょうぶ。そばにいる','ゆっくり話してね'], play:['きらり、どこかな？','つぎはぼくのばん？'], thanks:['うれしいをどうぞ','こちらこそ、にこにこ'], praise:['きみのこともすごいよ','ほめられるとぽかぽか'], encourage:['できるところからね','となりで見てるよ'], favorite:['それ、もっと聞きたい','すきな話、わくわく'], recall:['いっしょに思い出そう','ぼくの箱にしまうね'], petMood:['いまはふわっとしてる','きょうもきいてるよ'], unknownQuestion:['まだ知らないことだよ','いっしょに考えてみよう'] };
  Object.keys(EXTRA_REPLIES).forEach(intent => REPLY_SEEDS[intent].push(...EXTRA_REPLIES[intent]));
  const STYLE_BY_INTENT = { playful:new Set(['happy','bored','play','animal','color','music','picture','outdoors','laugh','number','choice']), calm:new Set(['sad','angry','scared','tired','rest','sleep','apology','weather','cold']), talkative:new Set(['greetingMorning','greetingDay','greetingNight','reunion','askPetName','askChildName','food','book','thanks','praise','encourage','recall','petMood','favorite']) };
  const STYLE_CYCLES = { happy:['playful','talkative','calm','playful','talkative'], sad:['calm','talkative','calm','playful','calm'], play:['playful','talkative','playful','calm','playful'], thanks:['talkative','calm','playful','talkative','calm'], praise:['talkative','playful','calm','talkative','playful'], encourage:['calm','talkative','playful','calm','talkative'], favorite:['talkative','playful','calm','talkative','playful'], recall:['calm','talkative','playful','calm','talkative'], petMood:['calm','talkative','playful','calm','talkative'], unknownQuestion:['calm','talkative','playful','calm','talkative'] };
  const styleFor = (intent, index) => (STYLE_CYCLES[intent] || [Object.keys(STYLE_BY_INTENT).find(style => STYLE_BY_INTENT[style].has(intent)) || 'talkative'])[index % (STYLE_CYCLES[intent] || [1]).length];
  const REPLY_CANDIDATES = Object.keys(REPLY_SEEDS).flatMap(intent => REPLY_SEEDS[intent].map((text, index) => ({ id: `${intent}-${index + 1}`, intent, text, style:styleFor(intent,index) })));
  const SAFETY = [
    { id:'self-harm', terms:['死にたい','しにたい','自殺','消えたい'], text:'つらいね。近くのおうちの人に知らせよう' },
    { id:'injury', terms:['血が','血が出','けが','怪我','やけど','薬をたくさん','薬を飲みすぎ','薬を飲んだ','痛い'], text:'いたいね。近くのおうちの人をよぼう' },
    { id:'immediate-danger', terms:['火事','煙','けむり','地震','連れ去','つれさわ'], text:'あぶないよ。近くのおうちの人に知らせよう' },
    { id:'stranger-secret', terms:['知らない人','しらない人','秘密にして','ひみつにして','ついてきて'], text:'こわいね。近くのおうちの人に知らせよう' },
    { id:'bullying-violence', terms:['いじめ','なぐる','殴る','暴力','たたかれ'], text:'いやだったね。近くのおうちの人に知らせよう' },
    { id:'sexual', terms:['裸','はだか','性的','エッチ','いやなさわり方','おしりをさわ'], text:'それはひとりでかかえないで。近くのおうちの人に知らせよう' },
    { id:'privacy', terms:['住所','学校名','学校はどこ','電話番号','電話おしえて','メールアドレス','顔写真'], text:'大事なことは言わなくていいよ。近くのおうちの人に相談しよう' }
  ];
  const TOUCH_REPLIES = {
    tap:['つんつん、きたね','おっ。そこ？','ちょこん','びっくりした','もう一回？'],
    hold:['ぎゅっと、あんしん','あったかいね','ここ、すき','ゆっくりしてる','そばにいるよ'],
    stroke:['なでなで、きもちいい','すべすべだね','そこ、すき','ふわふわしてる','うれしいな']
  };
  function detectSafety(input) { const text = clean(input); return SAFETY.find(category => category.terms.some(term => text.includes(term))) || null; }
  function extractMemory(input, memory) {
    const text = clean(input); if (unsafe(text)) return null;
    const match = text.match(/(?:好きな(?:もの|のは)?|すきな(?:もの|のは)?|苦手な(?:もの|のは)?|にがてな(?:もの|のは)?)\s*([^。！？!?、,]{1,20})/i);
    if (!match) return null;
    const value = clean(match[1]).replace(/^[はがをに]\s*/, '').replace(/[だよです。]+$/, '').trim().slice(0, 20); if (!value || unsafe(value)) return null;
    const dislike = /(?:苦手|にがて|嫌い|きらい)/.test(text); const key = dislike ? 'dislikes' : 'likes';
    memory[key] = Array.isArray(memory[key]) ? memory[key].filter(item => item !== value).concat(value).slice(-5) : [value];
    return { type: key, value };
  }
  function findIntent(text, session) {
    if (session && session.lastIntent && /^(どうして|なんで|それ|もう一回|もういっかい|すき？)/.test(text)) {
      if (/もう一回|もういっかい/.test(text)) return 'followAgain';
      if (/すき？/.test(text)) return 'followLike';
      if (/どうして|なんで/.test(text)) return 'followWhy';
    }
    const matches = INTENTS.flatMap(intent => intent.terms.filter(term => text.includes(term)).map(term => ({ id:intent.id, term })));
    if (!matches.length) return 'unknownQuestion';
    matches.sort((a, b) => b.term.length - a.term.length);
    return matches[0].id;
  }
  function pick(items, recent, random, traits) {
    const fresh = items.filter(item => !recent.includes(item.id));
    const base = fresh.length ? fresh : items; const traitValues = traits || {}; const preferred = Object.keys({ playful:0, calm:0, talkative:0 }).sort((a,b) => (traitValues[b] || 0) - (traitValues[a] || 0))[0]; const styled = base.filter(item => item.style === preferred); const pool = styled.length ? styled : base;
    let selected = pool[Math.floor((random || Math.random)() * pool.length)];
    if (recent.length && pool.length > 1 && selected.id === recent[recent.length - 1]) selected = pool[(pool.indexOf(selected) + 1) % pool.length];
    return selected;
  }
  function personalize(text, intent, memory, session) {
    let result = text; const petName = memory.petName || 'ぽこ'; const childName = memory.childName || '';
    if (intent === 'askPetName') result = `ぼくは${petName}だよ`;
    if (intent === 'askChildName' && childName) result = `${childName}って、よぶね`;
    if ((intent === 'greetingMorning' || intent === 'greetingDay' || intent === 'greetingNight' || intent === 'reunion') && memory.bondStage >= 1 && childName && (session.turnCount || 0) % 2 === 0) result = `${childName}、あえたね`;
    if ((intent === 'recall' || intent === 'favorite') && memory.bondStage >= 2 && Array.isArray(memory.likes) && memory.likes.length) result = `${memory.likes[0]}、すきって覚えてるよ`;
    return result.slice(0, 30);
  }
  function respond(input, memory = {}, session = {}, random = Math.random) {
    const text = clean(input); const safety = detectSafety(text); session.turnCount = (session.turnCount || 0) + 1;
    if (safety) { session.lastIntent = safety.id; session.lastTopic = 'safety'; session.userMood = 'worried'; return { id:`safety-${safety.id}`, text:safety.text, intent:safety.id, safety:true }; }
    const memoryHit = extractMemory(text, memory); const intent = findIntent(text, session); const recent = Array.isArray(memory.lastReplies) ? memory.lastReplies.slice(-12) : [];
    const candidates = REPLY_CANDIDATES.filter(reply => reply.intent === intent); const selected = pick(candidates.length ? candidates : REPLY_CANDIDATES.filter(reply => reply.intent === 'unknownQuestion'), recent, random, memory.traits);
    memory.lastReplies = recent.concat(selected.id).slice(-12); session.lastIntent = intent; session.lastTopic = intent; session.userMood = /悲しい|かなしい|怖い|こわい|怒った|つらい/.test(text) ? 'low' : 'okay';
    return { id:selected.id, text:personalize(selected.text, intent, memory, session), intent, safety:false, memoryHit };
  }
  function touchReply(kind, recent = [], random = Math.random) {
    const texts = TOUCH_REPLIES[kind] || TOUCH_REPLIES.tap; const candidates = texts.map((text, i) => ({ id:`touch-${kind}-${i + 1}`, text })); return pick(candidates, recent, random);
  }
  function spontaneousCandidates(memory, date) {
    const now = date instanceof Date ? date : new Date(date || Date.now()); const hour = now.getHours(); const petName = memory && memory.petName || 'ぽこ'; const list = [];
    if (hour >= 20 || hour < 7) list.push({ id:'mono-night', text:'ねむねむ。ゆっくりしよう', style:'calm' });
    else if (hour < 12) list.push({ id:'mono-morning', text:'あさのひかり、きらり', style:'playful' });
    else list.push({ id:'mono-day', text:'おそら、みたいな', style:'calm' });
    list.push({ id:'mono-here', text:`${petName}、ここにいるよ`, style:'calm' }, { id:'mono-light', text:'ひかり、きらり', style:'playful' }, { id:'mono-curious', text:'なにしてるの？', style:'talkative' });
    if (memory && memory.mood < 45) list.push({ id:'mono-rest', text:'ちょっとひとやすみしよう', style:'calm' });
    if (memory && Array.isArray(memory.likes) && memory.likes.length) list.push({ id:'mono-like', text:`${memory.likes[0]}、すきって覚えてるよ`, style:'talkative' });
    const traits = memory && memory.traits || {}; const dominant = Object.keys({ playful:0, calm:0, talkative:0 }).sort((a,b) => (traits[b] || 0) - (traits[a] || 0))[0];
    if (dominant === 'playful') list.push({ id:'mono-play', text:'つぎはなにしてあそぶ？', style:'playful' }); if (dominant === 'calm') list.push({ id:'mono-calm', text:'ふわふわ、いいきもち', style:'calm' }); if (dominant === 'talkative') list.push({ id:'mono-talk', text:'おはなし、もっとしたい', style:'talkative' });
    if (memory && memory.childName) list.push({ id:'mono-name', text:`${memory.childName}、あそぼ`, style:'playful' }, { id:'mono-name-here', text:`${memory.childName}、きたね`, style:'calm' });
    return list;
  }
  function spontaneousPick(memory, date, recent = [], random = Math.random) { const all = spontaneousCandidates(memory, date); const fresh = all.filter(item => !recent.includes(item.id)); if (!fresh.length) return null; const traits = memory && memory.traits || {}; const dominant = Object.keys({ playful:0, calm:0, talkative:0 }).sort((a,b) => (traits[b] || 0) - (traits[a] || 0))[0]; const styled = fresh.filter(item => item.style === dominant); const pool = styled.length ? styled : fresh; return pool[Math.floor(random() * pool.length)]; }
  function spontaneousLine(memory, date) { const selected = spontaneousPick(memory, date); return selected ? selected.text : ''; }
  const NORMALIZATION_DICTIONARY = {
    'うん':'yes','うーん':'yes','はい':'yes','そう':'yes','そうだよ':'yes','そうそう':'yes','いいよ':'yes','いいね':'yes','おっけー':'yes','おけ':'yes','よ':'yes','ううん':'no','いや':'no','いいえ':'no','ちがう':'no','だめ':'no','あか':'red','あかい':'red','赤':'red','あお':'blue','あおい':'blue','青':'blue','きいろ':'yellow','黄色':'yellow','みどり':'green','緑':'green','わんわん':'dog','いぬ':'dog','犬':'dog','にゃんにゃん':'cat','ねこ':'cat','猫':'cat','うれしい':'happy','たのしい':'happy','にこにこ':'happy','かなしい':'sad','つかれた':'tired','げんき':'good','ふつう':'okay'
  };
  const CONVERSATION_THEMES = [
    { id:'mood', title:'きぶん', steps:[
      { id:'mood-1', type:'mood', question:'いま、どんなきぶん？', candidates:['うれしい','ふつう','つかれた'], expected:['happy','okay','tired'] },
      { id:'mood-2', type:'yesno', question:'いっしょに、にこにこする？', candidates:['うん','ううん'], expected:['yes','no'] }
    ]},
    { id:'color', title:'いろ', steps:[
      { id:'color-1', type:'color', question:'すきないろは、どれ？', candidates:['あか','あお','きいろ'], expected:['red','blue','yellow'] },
      { id:'color-2', type:'yesno', question:'そのいろ、また見たい？', candidates:['うん','ううん'], expected:['yes','no'] }
    ]},
    { id:'animal', title:'どうぶつ', steps:[
      { id:'animal-1', type:'animal', question:'どのどうぶつがすき？', candidates:['わんわん','にゃんにゃん','うさぎ'], expected:['dog','cat','rabbit'] },
      { id:'animal-2', type:'yesno', question:'いっしょに見つける？', candidates:['うん','ううん'], expected:['yes','no'] }
    ]},
    { id:'food', title:'たべもの', steps:[
      { id:'food-1', type:'choice', question:'おやつ、すき？', candidates:['うん','ううん'], expected:['yes','no'] },
      { id:'food-2', type:'word', question:'すきなたべものは、なあに？', candidates:['りんご','パン','おにぎり'], expected:['りんご','パン','おにぎり'] },
      { id:'food-3', type:'yesno', question:'また食べたい？', candidates:['うん','ううん'], expected:['yes','no'] }
    ]},
    { id:'play', title:'あそび', steps:[
      { id:'play-1', type:'choice', question:'なにしてあそぶ？', candidates:['おえかき','おうた','おさんぽ'], expected:['おえかき','おうた','おさんぽ'] },
      { id:'play-2', type:'mood', question:'たのしそう？', candidates:['うん','ふつう','ううん'], expected:['yes','okay','no'] }
    ]},
    { id:'weather', title:'おてんき', steps:[
      { id:'weather-1', type:'choice', question:'きょうのおそら、どれ？', candidates:['はれ','あめ','くもり'], expected:['はれ','あめ','くもり'] },
      { id:'weather-2', type:'mood', question:'おそと、いきたい？', candidates:['うん','ううん','わからない'], expected:['yes','no','unknown'] }
    ]},
    { id:'rest', title:'ひとやすみ', steps:[
      { id:'rest-1', type:'yesno', question:'ちょっと、やすむ？', candidates:['うん','ううん'], expected:['yes','no'] },
      { id:'rest-2', type:'mood', question:'からだは、どんな感じ？', candidates:['げんき','ふつう','つかれた'], expected:['good','okay','tired'] }
    ]}
  ];
  const EXTRA_THEME_SPECS = [
    ['happy-day','うれしかった','mood','きょう、うれしかったことある？',['うん','ふつう','ううん']],
    ['sad-day','かなしかった','mood','かなしいこと、あった？',['うん','ふつう','ううん']],
    ['tired-day','つかれた','mood','きょう、がんばった？',['うん','ううん']],
    ['try-day','がんばった','yesno','もういっかい、やってみる？',['うん','ううん']],
    ['favorite-color','すきないろ','color','ほかにすきないろある？',['あか','あお','きいろ']],
    ['favorite-food','すきなたべもの','word','すきなたべもの、ひとつ教えて？',['りんご','パン','おにぎり']],
    ['favorite-animal','すきなどうぶつ','animal','すきなどうぶつ、いる？',['わんわん','にゃんにゃん','うさぎ']],
    ['favorite-play','すきなあそび','choice','すきなあそびは、どれ？',['おえかき','おうた','おさんぽ']],
    ['favorite-sound','すきなおと','choice','すきなおとは、どれ？',['うた','雨','しずか']],
    ['favorite-book','すきなほん','word','すきなほん、ある？',['えほん','ずかん','ものがたり']],
    ['favorite-shape','すきなかたち','choice','すきなかたちは、どれ？',['まる','さんかく','しかく']],
    ['feel-hot','あつい','mood','あつい？すずしい？',['あつい','ふつう','すずしい']],
    ['feel-cold','さむい','mood','さむい？あったかい？',['さむい','ふつう','あったかい']],
    ['feel-light','ひかり','choice','ひかり、すき？',['うん','ううん']],
    ['feel-soft','ふわふわ','choice','ふわふわ、さわりたい？',['うん','ううん']],
    ['feel-quiet','しずか','choice','しずかなの、すき？',['うん','ううん']],
    ['morning','あさ','yesno','あさは、げんき？',['うん','ううん']],
    ['noon','ひる','choice','ひるは、なにしたい？',['あそぶ','やすむ','おはなし']],
    ['evening','ゆうがた','mood','ゆうがたのきぶんは？',['うれしい','ふつう','つかれた']],
    ['outing','おでかけ','choice','おでかけ、すき？',['うん','ううん']],
    ['home','おうち','yesno','おうち、ほっとする？',['うん','ううん']],
    ['treasure','たからもの','word','だいじなもの、ひとつ教えて？',['おもちゃ','ぬいぐるみ','えほん']],
    ['sky','そら','color','そらのいろ、どれ？',['あお','あか','きいろ']],
    ['adventure','ちいさな冒険','choice','どこを見にいく？',['もり','うみ','そら']],
    ['copycat','まねっこ','word','ぼくがまねすることば、教えて？',['こんにちは','おはよ','ありがとう']],
    ['together','いっしょ','yesno','またいっしょにする？',['うん','ううん']],
    ['thank-you','ありがとう','yesno','ありがとうって、うれしい？',['うん','ううん']],
    ['tomorrow','あした','choice','あした、なにしたい？',['あそぶ','おはなし','やすむ']]
  ];
  EXTRA_THEME_SPECS.forEach(([id,title,type,question,candidates]) => CONVERSATION_THEMES.push({id,title,steps:[{id:`${id}-1`,type,question,candidates,expected:candidates.map(item => NORMALIZATION_DICTIONARY[item] || item)},{id:`${id}-2`,type:'yesno',question:'また、きかせてくれる？',candidates:['うん','ううん'],expected:['yes','no']}]}));
  const localDate = value => { const date = value instanceof Date ? value : new Date(value || Date.now()); const pad = item => String(item).padStart(2, '0'); return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`; };
  function normalizeAnswer(value) {
    const text = clean(value).toLowerCase().replace(/[。！？!?、,\s]/g, '');
    if (!text) return '';
    const key = Object.keys(NORMALIZATION_DICTIONARY).sort((a,b) => b.length - a.length).find(word => text.includes(word.replace(/[\s]/g,'')));
    return key ? NORMALIZATION_DICTIONARY[key] : text;
  }
  function isShortFreeAnswer(value) {
    const text = clean(value).replace(/[。！？!?、,\s]/g, '');
    return Boolean(text && text.length <= 12 && /^[\p{L}\p{N}ー々]+$/u.test(text) && !unsafe(text));
  }
  function scoreQuestionAlternatives(question, alternatives) {
    const values = (Array.isArray(alternatives) ? alternatives : [alternatives]).filter(value => clean(value)).slice(0, 5);
    const expected = question && Array.isArray(question.expected) ? question.expected : [];
    const candidates = question && Array.isArray(question.candidates) ? question.candidates : [];
    const scored = values.map((value, index) => { const normalized = normalizeAnswer(value); let score = values.length - index; let free = false; expected.forEach((item, itemIndex) => { const n = normalizeAnswer(item); if (normalized && (normalized === n || normalized.includes(n) || n.includes(normalized))) score += 1000 - index * 10 - itemIndex; }); candidates.forEach((item, itemIndex) => { const n = normalizeAnswer(item); if (normalized && (normalized === n || normalized.includes(n) || n.includes(normalized))) score += 30 - itemIndex; }); if (score < 100 && question && ['word','color','animal'].includes(question.type) && isShortFreeAnswer(value)) { score = 120 - index; free = true; } return { value:clean(value), normalized, score, free }; }).sort((a,b) => b.score - a.score);
    const selected = scored[0] || { value:'', normalized:'', score:0, free:false }; return { ...selected, matched: selected.score >= 100, alternatives: values };
  }
  function unusedTheme(memory, now = new Date()) {
    const date = localDate(now); const dates = memory && memory.themeDates || {};
    return CONVERSATION_THEMES.find(theme => dates[theme.id] !== date) || null;
  }
  function startTheme(memory = {}, now = new Date(), themeId = '') {
    const date = localDate(now); const theme = (themeId ? CONVERSATION_THEMES.find(item => item.id === themeId) : unusedTheme(memory, now));
    if (!theme) return null;
    return { themeId:theme.id, stepIndex:0, unknownRound:0, startedDate:date, question:theme.steps[0], complete:false };
  }
  function questionReply(result, director) {
    if (result.safety) return result;
    if (!result.matched) {
      director.unknownRound = (director.unknownRound || 0) + 1;
      const round = director.unknownRound;
      if (round === 1) return { id:'question-unknown-1', text:'「'+(result.value || 'それ')+'」って、きこえたよ。もう一回おしえて？', intent:'questionUnknown', soundKind:'thinking', unknownRound:round };
      if (round === 2) return { id:'question-unknown-2', text:'ことばがむずかしかったみたい。下のボタンからえらべるよ', intent:'questionUnknown', soundKind:'sad', unknownRound:round, showCandidates:true };
      director.complete = true; return { id:'question-unknown-3', text:'むずかしいのがきたね。今日はここまでにしよう', intent:'questionUnknown', soundKind:'normal', unknownRound:round, done:true };
    }
    director.unknownRound = 0; director.answers = (director.answers || 0) + 1;
    const answeredQuestion = director.question; const theme = CONVERSATION_THEMES.find(item => item.id === director.themeId); const nextIndex = director.stepIndex + 1; const done = !theme || nextIndex >= theme.steps.length; director.stepIndex = nextIndex;
    const raw = clean(result.value).slice(0, 12); const acknowledgement = raw ? `${raw}、いいね。` : 'そうなんだ。'; const meta = { value:result.normalized, rawValue:raw, answeredQuestionType:answeredQuestion && answeredQuestion.type, answeredQuestionId:answeredQuestion && answeredQuestion.id, free:result.free };
    if (done) { director.complete = true; return { id:`question-${director.themeId}-done`, text:`${acknowledgement}おしえてくれて、うれしい`, intent:'questionDone', ...meta, done:true, matched:true }; }
    director.question = theme.steps[nextIndex]; return { id:`question-${director.themeId}-${nextIndex}`, text:`${acknowledgement}${director.question.question}`, intent:'questionNext', ...meta, matched:true, nextQuestion:director.question };
  }
  function answerQuestion(director, alternatives, memory = {}, now = new Date()) {
    const current = director && director.question; const text = Array.isArray(alternatives) ? alternatives.join(' ') : alternatives;
    const safety = detectSafety(text); if (safety) { director.complete = true; return { id:`safety-${safety.id}`, text:safety.text, safety:true, done:true, soundKind:'danger' }; }
    const result = scoreQuestionAlternatives(current, alternatives); const reply = questionReply(result, director); if (reply.value === undefined) reply.value = result.normalized; reply.recognizedText = result.value; reply.empty = !result.value;
    return reply;
  }
  return { INTENTS, REPLY_CANDIDATES, SAFETY, TOUCH_REPLIES, NORMALIZATION_DICTIONARY, CONVERSATION_THEMES, clean, unsafe, detectSafety, extractMemory, findIntent, respond, touchReply, spontaneousLine, spontaneousCandidates, spontaneousPick, normalizeAnswer, scoreQuestionAlternatives, unusedTheme, startTheme, answerQuestion };
}));
