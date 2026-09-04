/* 愛着体験v1。端末内だけで、教わった言葉が後の出来事へ戻る状態機械。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LittleCompanionStory = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const CATEGORIES = ['food','animal','play','thing','other'];
  const CATEGORY_LABELS = { food:'食べもの', animal:'どうぶつ', play:'あそび', thing:'もの', other:'そのほか' };
  const CATEGORY_EXAMPLES = { food:'もぐもぐするんだよね', animal:'どんなこえ？', play:'いっしょにする？', thing:'どこでみつける？', other:'ふしぎなひびき' };
  const URGES = ['curious','playful','quiet','sleepy','proud'];
  const PREFERENCES = ['round','softSound','light','rain','warm'];
  const SMALL_EVENTS = [
    { id:'shadow', text:'あれ？ ぼくのかげ、うごいた？', sound:'curious' },
    { id:'sneeze', text:'くしゅん……えへへ、ないしょ', sound:'play' },
    { id:'follow-finger', text:'ゆびをおって、おくれちゃった', sound:'curious' },
    { id:'own-preference', text:'ぼく、まるいもの ちょっとすき', sound:'proud' },
    { id:'remember-pause', text:'ことば……もうすぐ思い出せそう', sound:'thinking' },
    { id:'quiet-float', text:'いま、ちょっと ふわふわしてる', sound:'sleepy' }
  ];
  const clean = value => String(value || '').replace(/[<>]/g, '').replace(/[\u0000-\u001f]/g, '').trim();
  const wordText = value => clean(value).replace(/[。！？!?、,\s]/g, '').slice(0, 12);
  const privateLike = value => /(?:\d{2,4}[-\s]?\d{2,4}[-\s]?\d{3,4}|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|住所|電話|学校|メール|顔写真|実名|(?:東京都|北海道|(?:大阪|京都)府|.{2,3}県).{1,20}(?:市|区|町|村))/i.test(value);
  const unsafeWord = value => privateLike(value) || /(?:死にたい|自殺|消えたい|けが|怪我|薬を|火事|地震|連れ去|いじめ|殴る|裸|性的|エッチ|いやなさわり)/.test(value);
  const localDate = value => { const date = value instanceof Date ? value : new Date(value || Date.now()); const pad = n => String(n).padStart(2, '0'); return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`; };
  const idFor = (word, now) => `w-${localDate(now).replace(/-/g, '')}-${word.toLowerCase().replace(/[^a-z0-9ぁ-んァ-ヶ一-龠]/gi, '').slice(0, 8)}`;
  const categoryOk = category => CATEGORIES.includes(category) ? category : 'other';
  function defaultStory(profileId = '') { return { profileId, chapter:'find', beat:'idle', pendingWordId:'', lastBeatAt:'', unrelatedActions:0, completedAt:'', lastCompletedAt:'', recallReadyAt:'', eventDates:{}, preferenceShown:false }; }
  function defaultPreference() { return 'round'; }
  function getWordStory(data, profileId = '') { if (!data) return null; const id=profileId||data.activeProfileId||'p-default'; if(!data.wordMemoryV2||typeof data.wordMemoryV2!=='object')data.wordMemoryV2={stories:[],requestDate:'',requestProfileId:'',deletionLedger:[]}; if(!Array.isArray(data.wordMemoryV2.stories))data.wordMemoryV2.stories=[]; let story=data.wordMemoryV2.stories.find(item=>item&&item.profileId===id); if(!story){ const legacy=id===(data.activeProfileId||'p-default')&&data.bondStory?data.bondStory:null; story={...defaultStory(id),...(legacy||{}),profileId:id}; data.wordMemoryV2.stories.push(story); } if(id===(data.activeProfileId||'p-default'))data.bondStory=story; return story; }
  function isActive(data) { const story = getWordStory(data); return Boolean(story && !story.completedAt && story.beat !== 'complete'); }
  function start(data, now = new Date()) {
    if (!data) return null; const story = getWordStory(data);
    if (story.completedAt || story.beat === 'complete') return null;
    if (story.beat === 'idle') { story.chapter = 'find'; story.beat = 'ask-word'; story.lastBeatAt = new Date(now).toISOString(); return { kind:'ask-word', text:'きょう、ことばをひとつ おしえて', sound:'curious' }; }
    return null;
  }
  function canRequestWord(data,{now=new Date(),blocked=false}={}){ if(!data||blocked)return false; const memory=data.wordMemoryV2||{}; return memory.requestDate!==localDate(now); }
  function markWordRequest(data,{profileId='',now=new Date()}={}){ if(!data||!canRequestWord(data,{now}))return false; getWordStory(data,profileId); data.wordMemoryV2.requestDate=localDate(now); data.wordMemoryV2.requestProfileId=profileId||data.activeProfileId||'p-default'; return true; }
  function startTeaching(data,{source='manual',profileId='',now=new Date()}={}){ if(!data)return null; const id=profileId||data.activeProfileId||'p-default'; if(source==='spontaneous'&&!markWordRequest(data,{profileId:id,now}))return null; const story=getWordStory(data,id); if(!story||(!['idle','complete','memory'].includes(story.beat)&&!story.completedAt))return null; const previous=story.completedAt||story.lastCompletedAt||''; const fresh=defaultStory(id); fresh.lastCompletedAt=previous; Object.keys(story).forEach(key=>delete story[key]); Object.assign(story,fresh); story.chapter='find';story.beat='ask-word';story.lastBeatAt=new Date(now).toISOString(); if(id===(data.activeProfileId||'p-default'))data.bondStory=story; return {kind:'ask-word',text:'きょう、ことばをひとつ おしえて',sound:'curious',profileId:id,source}; }
  function receiveWord(data, raw, now = new Date(), draft = null) {
    const story = getWordStory(data); const normalizedRaw = clean(raw).replace(/[。！？!?、,\s]/g, ''); const word = wordText(raw);
    if (!story || !['ask-word','correct-word'].includes(story.beat)) return { ok:false, reason:'not-ready' };
    if (!word || normalizedRaw.length > 12 || word.length > 12 || unsafeWord(normalizedRaw) || !/^[\p{L}\p{N}ー々]+$/u.test(normalizedRaw)) return { ok:false, reason:unsafeWord(normalizedRaw) ? 'unsafe' : 'invalid', unsafe:unsafeWord(normalizedRaw) };
    if (story.beat === 'correct-word') {
      if (!draft || word !== draft.word) return { ok:false, reason:'different-word' };
      return saveSeed(data, draft, now);
    }
    const nextDraft = { id:idFor(word, now), word, category:'', correctedCount:0 };
    story.beat = 'confirm-word'; story.lastBeatAt = new Date(now).toISOString(); story.pendingWordId = nextDraft.id;
    return { ok:true, draft:nextDraft, kind:'confirm-word', word, text:`${word}って きこえた。あってる？`, candidates:['そう','ちがう'], sound:'curious' };
  }
  function confirmWord(data, yes, now = new Date(), draft = null) {
    const story = getWordStory(data); if (!story || story.beat !== 'confirm-word' || !draft) return { ok:false, reason:'not-ready' };
    if (!yes) { story.beat = 'ask-word'; story.pendingWordId = ''; story.lastBeatAt = new Date(now).toISOString(); return { ok:true, kind:'ask-word', text:'わかった。もういっかい、ことばをきかせて？', candidates:[] }; }
    story.beat = 'classify'; story.chapter = 'teach'; story.lastBeatAt = new Date(now).toISOString(); return { ok:true, kind:'classify', text:`${draft.word}は、どのなかまかな？`, candidates:CATEGORIES.map(item => CATEGORY_LABELS[item]), categories:CATEGORIES, sound:'curious' };
  }
  function classify(data, category, now = new Date(), draft = null) {
    const story = getWordStory(data); const index = CATEGORIES.indexOf(category); if (!story || story.beat !== 'classify' || !draft || index < 0) return { ok:false, reason:'not-ready' };
    draft.category = category; story.beat = 'stumble'; story.chapter = 'teach'; story.lastBeatAt = new Date(now).toISOString(); return { ok:true, kind:'stumble', text:`${draft.word}……${draft.word.slice(0, Math.max(1, draft.word.length - 1))}? もういっかい？`, candidates:['そう','ちがう'], sound:'thinking' };
  }
  function correct(data, yes, now = new Date(), draft = null) {
    const story = getWordStory(data); if (!story || story.beat !== 'stumble' || !draft) return { ok:false, reason:'not-ready' };
    if (yes) return saveSeed(data, draft, now);
    story.beat = 'correct-word'; story.lastBeatAt = new Date(now).toISOString(); draft.correctedCount = (draft.correctedCount || 0) + 1; return { ok:true, kind:'correct-word', text:`${draft.word}って、もういっかい おしえて？`, candidates:[], sound:'thinking' };
  }
  function saveSeed(data, draft, now = new Date()) {
    const story = getWordStory(data); if (!story || !draft || !draft.word || !CATEGORIES.includes(draft.category)) return { ok:false, reason:'not-ready' };
    data.learnedWords = Array.isArray(data.learnedWords) ? data.learnedWords : [];
    const profileId = data.activeProfileId || 'p-default'; const existing = data.learnedWords.find(item => item.word === draft.word && (item.profileId || 'p-default') === profileId);
    if (!existing && data.learnedWords.filter(item => (item.profileId || 'p-default') === profileId).length >= 20) { story.beat = 'complete'; story.completedAt = new Date(now).toISOString(); story.lastCompletedAt=story.completedAt; return { ok:false, full:true, kind:'full', text:'ことばの箱、いっぱいだよ', sound:'sad' }; }
    const word = existing || { id:draft.id, profileId, word:draft.word, category:draft.category, confidence:1, taughtAt:new Date(now).toISOString(), lastUsedAt:'', usedCount:0, correctedCount:draft.correctedCount || 0 }; if (existing) { existing.category = draft.category; existing.lastUsedAt=new Date(now).toISOString(); } else data.learnedWords.push(word);
    story.beat = 'seed'; story.chapter = 'teach'; story.pendingWordId = word.id; story.unrelatedActions = 0; story.lastBeatAt = new Date(now).toISOString();
    return { ok:true, kind:'seed', text:`ことばのたねが ひとつ できたよ。${word.word}、おぼえた`, word:word.word, wordId:word.id, profileId, sound:'proud' };
  }
  function noteUnrelated(data, now = new Date()) {
    const story = getWordStory(data); if (!story || story.completedAt) return null;
    if (!['seed','preference','wait'].includes(story.beat)) return null;
    story.unrelatedActions = Math.min(2, (Number(story.unrelatedActions) || 0) + 1); story.lastBeatAt = new Date(now).toISOString();
    if (story.beat === 'seed') { story.beat = 'preference'; story.preferenceShown = true; story.eventDates = story.eventDates || {}; story.eventDates['own-preference'] = localDate(now); return { kind:'preference', text:'ぼく、まるいもの ちょっとすき', sound:'proud' }; }
    if (story.unrelatedActions >= 2) story.beat = 'wait';
    if (story.beat === 'wait' && !story.recallReadyAt) story.recallReadyAt = new Date(new Date(now).getTime() + 45000).toISOString();
    return null;
  }
  function canRecall(data, now = new Date()) { const story = getWordStory(data); if (!story || story.beat !== 'wait') return false; return story.unrelatedActions >= 2 || (story.recallReadyAt && new Date(now).getTime() >= Date.parse(story.recallReadyAt)); }
  function recall(data, now = new Date()) {
    if (!canRecall(data, now)) return null; const story = getWordStory(data); const word = (data.learnedWords || []).find(item => item.id === story.pendingWordId && (item.profileId || 'p-default') === (data.activeProfileId || 'p-default')); if (!word) return null;
    story.beat = 'recall-use'; story.lastBeatAt = new Date(now).toISOString(); const phrase = CATEGORY_EXAMPLES[word.category] || CATEGORY_EXAMPLES.other; return { kind:'recall-use', text:`${word.word}って、${phrase}`, word:word.word, wordId:word.id, profileId:word.profileId || 'p-default', candidates:['おぼえてた','そうだよ'], sound:'curious' };
  }
  function react(data, now = new Date()) {
    const story = getWordStory(data); if (!story || story.beat !== 'recall-use') return null; const word = (data.learnedWords || []).find(item => item.id === story.pendingWordId && (item.profileId || 'p-default') === (data.activeProfileId || 'p-default')); if (!word) return null;
    word.usedCount = (word.usedCount || 0) + 1; word.confidence = Math.min(3, (word.confidence || 1) + 1); word.lastUsedAt = new Date(now).toISOString(); story.beat = 'memory'; story.chapter = 'remember'; story.completedAt = new Date(now).toISOString(); story.lastCompletedAt=story.completedAt; story.lastBeatAt = story.completedAt;
    data.moments = Array.isArray(data.moments) ? data.moments : []; data.moments.push({ id:`moment-${word.id}-${localDate(now)}`, profileId:data.activeProfileId || 'p-default', type:'learned-word', word:word.word, category:word.category, text:`きょう、${word.word}を おしえてもらった`, at:story.completedAt }); data.moments = data.moments.slice(-30);
    return { kind:'memory', text:`つかえた！きょう、${word.word}を おしえてもらったね`, word:word.word, sound:'proud' };
  }
  function nextSmallEvent(data, now = new Date()) {
    if (!data || !Array.isArray(data.learnedWords) || !data.learnedWords.some(item => (item.profileId || 'p-default') === (data.activeProfileId || 'p-default'))) return null; const story = getWordStory(data) || defaultStory(data.activeProfileId); story.eventDates = story.eventDates || {}; const date = localDate(now);
    const seed = Math.max(0, Math.floor(Number(data.surpriseSeed) || 0)); const rotated = SMALL_EVENTS.slice(seed % SMALL_EVENTS.length).concat(SMALL_EVENTS.slice(0, seed % SMALL_EVENTS.length)); const preferred = Number(data.attention) < 30 ? 'quiet-float' : data.urge === 'sleepy' ? 'quiet-float' : data.urge === 'playful' ? 'sneeze' : data.urge === 'quiet' ? 'quiet-float' : data.urge === 'proud' ? 'follow-finger' : ''; const available = item => !(item.id === 'own-preference' && story.preferenceShown) && story.eventDates[item.id] !== date; const event = preferred ? (rotated.find(item => item.id === preferred && available(item)) || rotated.find(available)) : rotated.find(available); if (!event) return null; story.eventDates[event.id] = date; data.bondStory = story; return { kind:'small-event', id:event.id, text:event.text, sound:event.sound };
  }
  function forgetWordCascade(data,{profileId='',wordId=''}={}) { if(!data||!wordId)return false; const id=profileId||data.activeProfileId||'p-default'; const removed=(data.learnedWords||[]).filter(item=>item.id===wordId&&(item.profileId||'p-default')===id); if(!removed.length)return false; const values=removed.map(item=>item.word); data.learnedWords=(data.learnedWords||[]).filter(item=>!(item.id===wordId&&(item.profileId||'p-default')===id)); data.factMemories=(data.factMemories||[]).filter(item=>!(item.profileId===id&&(item.id===`word-${wordId}`||values.includes(item.value)))); data.callbackQueue=(data.callbackQueue||[]).filter(item=>!(item.profileId===id&&(item.id===`word-${wordId}`||values.includes(item.value)))); data.moments=(data.moments||[]).filter(item=>!((item.profileId||'p-default')===id&&(item.wordId===wordId||values.includes(item.word)))); const story=getWordStory(data,id); if(story&&story.pendingWordId===wordId){ const fresh=defaultStory(id); Object.keys(story).forEach(key=>delete story[key]); Object.assign(story,fresh); } (data.pairRelations||[]).filter(item=>item.profileId===id).forEach(relation=>{relation.sharedWords=(relation.sharedWords||[]).filter(item=>item.wordId!==wordId);relation.sharedEvents=(relation.sharedEvents||[]).filter(item=>item.wordId!==wordId);}); return true; }
  function purgeProfileWordReferences(data,profileId){ if(!data||!profileId)return false; data.learnedWords=(data.learnedWords||[]).filter(item=>(item.profileId||'p-default')!==profileId); data.factMemories=(data.factMemories||[]).filter(item=>item.profileId!==profileId); data.callbackQueue=(data.callbackQueue||[]).filter(item=>item.profileId!==profileId); data.moments=(data.moments||[]).filter(item=>(item.profileId||'p-default')!==profileId); if(data.wordMemoryV2&&Array.isArray(data.wordMemoryV2.stories))data.wordMemoryV2.stories=data.wordMemoryV2.stories.filter(item=>item.profileId!==profileId); (data.pairRelations||[]).filter(item=>item.profileId===profileId).forEach(relation=>{relation.sharedWords=[];relation.sharedEvents=[];}); return true; }
  function forgetWord(data, id, explicitProfileId = '') { return forgetWordCascade(data,{profileId:explicitProfileId||data&&data.activeProfileId||'p-default',wordId:id}); }
  function restore(data) { if (!data) return data; const story=getWordStory(data); if (!story.eventDates || typeof story.eventDates !== 'object') story.eventDates = {}; if (!Array.isArray(data.learnedWords)) data.learnedWords = []; if (story.beat === 'paused') { story.beat = 'idle'; story.chapter = 'find'; story.pendingWordId = ''; story.unrelatedActions = 0; story.recallReadyAt = ''; } if (['confirm-word','classify','stumble','correct-word'].includes(story.beat)) { story.beat = 'ask-word'; story.chapter = 'find'; story.pendingWordId = ''; story.unrelatedActions = 0; } return data; }
  function resume(data) { const story = getWordStory(data); if (!story || story.completedAt) return null; if (story.beat === 'ask-word') return { kind:'ask-word', text:'きょう、ことばをひとつ おしえて', sound:'curious' }; if (story.beat === 'seed' || story.beat === 'preference') return { kind:'resume', text:'ことばのたね、ここにあるよ。いっしょにいよう', sound:'normal' }; return null; }
  return { CATEGORIES, CATEGORY_LABELS, URGES, PREFERENCES, SMALL_EVENTS, defaultStory, defaultPreference, getWordStory, isActive, start, startTeaching, canRequestWord, markWordRequest, receiveWord, confirmWord, classify, correct, saveSeed, noteUnrelated, canRecall, recall, react, nextSmallEvent, forgetWord, forgetWordCascade, purgeProfileWordReferences, restore, resume, wordText, unsafeWord };
}));
