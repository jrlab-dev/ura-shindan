/* 2匹生活v1の固定短場面。入力・保存・通信・マイク取得は行わない。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./pet-presentations.js'));
  else root.LittleCompanionTwoPetScenes = factory(root.LittleCompanionPetPresentations);
}(typeof self !== 'undefined' ? self : this, function (Presentations) {
  'use strict';
  const PETS = ['pet-1', 'pet-2'];
  const kinds = ['silent', 'mimic', 'toy', 'word', 'role', 'join'];
  const NONVERBAL_EMOTIONS = ['surprised', 'thinking', 'satisfied', 'sleepy'];
  const NONVERBAL_SOUNDS = {
    'pet-1': {
      surprised:{durationMs:180,frequencies:[720,960,1220]}, thinking:{durationMs:220,frequencies:[620,760]},
      satisfied:{durationMs:240,frequencies:[700,920,1120]}, sleepy:{durationMs:260,frequencies:[520,650]}
    },
    'pet-2': {
      surprised:{durationMs:300,frequencies:[280,210]}, thinking:{durationMs:400,frequencies:[240]},
      satisfied:{durationMs:360,frequencies:[300,230]}, sleepy:{durationMs:500,frequencies:[210]}
    }
  };
  const firstTiming = petId => petId === 'pet-1' ? [0,250] : [350,800];
  const replyTiming = petId => { const value=Presentations&&Presentations.PET_PRESENTATIONS&&Presentations.PET_PRESENTATIONS[petId]; return value ? Array.from(value.replyGapMs) : []; };
  const emotionFor = (sceneId, petId) => {
    const total=Array.from(sceneId).reduce((sum,char)=>sum+char.codePointAt(0),0)+(petId==='pet-2'?1:0);
    return NONVERBAL_EMOTIONS[total%NONVERBAL_EMOTIONS.length];
  };
  const s = (id, kind, a, b, options) => Object.assign({
    id, kind, durationMs: 7000, requiresWord: false, requiresToy: false,
    optionalAction: null, lockKey: 'two-pet-event',
    steps: [
      { atMs: 0, actorPetId: a, text: '', sound: null, actorState: 'watching', observerState: 'watching' },
      { atMs: 3200, actorPetId: b, text: '', sound: null, actorState: 'watching', observerState: 'watching' }
    ]
  }, options || {});
  const spoken = (id, kind, a, b, textA, textB, options) => s(id, kind, a, b, Object.assign({
    steps: [
      { atMs: firstTiming(a)[0], startDelayMs:firstTiming(a), actorPetId: a, text: textA, sound: emotionFor(id,a), actorState: 'talking', observerState: 'watching' },
      { atMs: 3600, replyGapMs:replyTiming(b), actorPetId: b, text: textB, sound: emotionFor(id,b), actorState: 'talking', observerState: 'watching' }
    ]
  }, options || {}));
  const SCENES = [
    s('silent-peek','silent','pet-1','pet-2',{durationMs:6000,steps:[
      {atMs:0,actorPetId:'pet-1',text:'',sound:null,actorState:'ear-react',observerState:'watching'},
      {atMs:3200,actorPetId:'pet-2',text:'',sound:null,actorState:'body-react',observerState:'watching'}]}),
    s('silent-near','silent','pet-2','pet-1',{durationMs:8000,steps:[
      {atMs:350,actorPetId:'pet-2',text:'',sound:null,actorState:'body-react',observerState:'watching'},
      {atMs:3600,actorPetId:'pet-1',text:'',sound:null,actorState:'watching',observerState:'watching'}]}),
    s('silent-ear','silent','pet-1','pet-2',{durationMs:7000,steps:[
      {atMs:0,actorPetId:'pet-1',text:'',sound:null,actorState:'ear-react',observerState:'watching'},
      {atMs:3000,actorPetId:'pet-2',text:'',sound:null,actorState:'body-react',observerState:'watching'}]}),
    s('silent-nap','silent','pet-2','pet-1',{durationMs:9000,steps:[
      {atMs:500,actorPetId:'pet-2',text:'',sound:null,actorState:'sleepy',observerState:'watching'},
      {atMs:3800,actorPetId:'pet-1',text:'',sound:null,actorState:'watching',observerState:'sleepy'}]}),
    s('silent-look-child','silent','pet-1','pet-2',{durationMs:6000,optionalAction:'tap'}),
    spoken('mimic-ear-miss','mimic','pet-1','pet-2','みみ、ぴん','あれ、ぎゃくだった',{durationMs:8000}),
    spoken('mimic-step-late','mimic','pet-2','pet-1','ゆっくり、まねするね','おなじだね',{durationMs:9000}),
    s('mimic-yawn','mimic','pet-1','pet-2',{durationMs:7000}), s('mimic-blink','mimic','pet-2','pet-1',{durationMs:6000}),
    spoken('mimic-sneeze','mimic','pet-1','pet-2','くしゅん','びっくりしたね',{durationMs:7000}),
    spoken('toy-roll','toy','pet-1','pet-2','ころころするよ','そっと、うけとるね',{requiresToy:true, toy:'ball'}),
    spoken('toy-pass','toy','pet-2','pet-1','どうぞ','ありがとう',{requiresToy:true, toy:'ball'}),
    s('toy-pull-share','toy','pet-1','pet-2',{requiresToy:true,toy:'rope',durationMs:9000}),
    s('toy-light','toy','pet-2','pet-1',{requiresToy:true,toy:'light',durationMs:8000}),
    spoken('toy-hide-find','toy','pet-1','pet-2','どこかな','ここにあったね',{requiresToy:true,toy:'ball'}),
    spoken('word-introduce','word','pet-1','pet-2','{{word}}って、知ってる？','きいてみるね',{requiresWord:true}),
    spoken('word-mishear','word','pet-2','pet-1','{{word}}？','そう、{{word}}だよ',{requiresWord:true}),
    spoken('word-category','word','pet-1','pet-2','{{word}}を教わったよ','たいせつな言葉だね',{requiresWord:true}),
    spoken('word-whisper','word','pet-2','pet-1','{{word}}って、すてき','いっしょに覚える',{requiresWord:true}),
    spoken('word-remember','word','pet-1','pet-2','{{word}}、思い出したね','うん、覚えてる',{requiresWord:true}),
    spoken('role-first-step','role','pet-1','pet-2','先に一歩いくね','ゆっくり見てるね'),
    spoken('role-careful-check','role','pet-2','pet-1','ここ、大丈夫かな','見てみよう'),
    spoken('role-brave-guest','role','pet-2','pet-1','ちょっと近づくね','うれしいな'),
    spoken('role-calm-main','role','pet-1','pet-2','ここで休もう','落ち着くね'),
    spoken('role-switch-helper','role','pet-2','pet-1','今度はぼくが案内するね','ありがとう'),
    spoken('join-roll','join','pet-1','pet-2','いっしょに転がす？','見てても続けるね',{optionalAction:'play',requiresToy:true,toy:'ball'}),
    s('join-touch','join','pet-2','pet-1',{optionalAction:'tap',durationMs:7000}),
    spoken('join-choose-sound','join','pet-1','pet-2','好きな音を選んでもいいよ','どれでも楽しいね',{optionalAction:'tap'}),
    s('join-look','join','pet-2','pet-1',{optionalAction:'tap',durationMs:6000}),
    spoken('join-rest','join','pet-1','pet-2','いっしょに休む？','うん、ゆっくりしよう',{optionalAction:'tap',durationMs:9000})
  ];
  return { PETS, KINDS: kinds, NONVERBAL_EMOTIONS, NONVERBAL_SOUNDS, SCENES };
}));
