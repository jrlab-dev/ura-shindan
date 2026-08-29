/* 15分体験の自発場面データ。保存・通信・入力取得は行わない。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LittleCompanionScenes = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ACTIONS = ['tap', 'stroke', 'hold', 'play', 'sleep', 'talk', 'echo'];
  const scene = (id, phase, expectedAction, prompt, success, callback, sound, state, requiresLearnedWord, requiresEcho) => ({
    id, phase, expectedAction, prompt, success, callback, sound, state,
    requiresLearnedWord: Boolean(requiresLearnedWord), requiresEcho: Boolean(requiresEcho)
  });

  const SCENES = [
    scene('tap-spark', 'play', 'tap', 'きらりを、ひとつ見つけよう', 'きらり、見つかったね', 'あのきらり、すてきだったね', 'curious', 'happy'),
    scene('tap-nose', 'play', 'tap', 'おはなを、ちょんとしてみよう', 'おはなが、ぴくっとしたよ', 'ちょん、楽しかったね', 'curious', 'happy'),
    scene('tap-star', 'play', 'tap', '星を、そっとつついてみよう', '星が、きらっと光ったね', '星の光、覚えているよ', 'sparkle', 'happy'),
    scene('tap-leaf', 'play', 'tap', '葉っぱを、ひとつ探そう', '葉っぱを、見つけたね', '葉っぱの形、面白かったね', 'curious', 'proud'),
    scene('tap-light', 'play', 'tap', '小さな光を押してみよう', '光が、ぽんっと弾んだね', '光が、また弾んだ気がするね', 'play', 'happy'),
    scene('tap-circle', 'play', 'tap', 'まるを、ちょんと触ろう', 'まるが、ふわっと揺れたね', 'まるの動き、よかったね', 'curious', 'playful'),

    scene('stroke-cheek', 'play', 'stroke', 'ほっぺを、ゆっくりなでよう', 'ほっぺが、ぽかぽかしたよ', 'ぽかぽか、心地よかったね', 'soft', 'calm'),
    scene('stroke-head', 'play', 'stroke', 'あたまを、そっとなでよう', 'あたまが、ほっとしたよ', 'ほっとする時間だったね', 'soft', 'calm'),
    scene('stroke-ear', 'play', 'stroke', 'おみみを、やさしくなでよう', 'おみみが、ぴんとしたよ', 'おみみが元気になったね', 'curious', 'happy'),
    scene('stroke-back', 'play', 'stroke', 'せなかを、ゆっくりなでよう', 'せなかが、ふわっとしたよ', 'ゆっくりできて、よかったね', 'quiet', 'calm'),
    scene('stroke-paw', 'play', 'stroke', 'てを、やさしくなでよう', 'てが、あたたかくなったよ', 'あたたかい手、うれしいね', 'soft', 'close'),
    scene('stroke-tail', 'play', 'stroke', 'しっぽを、そっとなでよう', 'しっぽが、ゆらゆらしたよ', 'ゆらゆら、面白かったね', 'play', 'happy'),

    scene('hold-warm', 'play', 'hold', 'ぎゅっとせず、そっと抱こう', 'そばにいると、ほっとするね', 'ほっとしたこと、覚えているよ', 'soft', 'close'),
    scene('hold-close', 'play', 'hold', '近くで、ゆっくり抱こう', '近くにいると、安心するね', 'ゆっくりした時間だったね', 'quiet', 'calm'),
    scene('hold-rest', 'play', 'hold', 'ひざの上で、休もう', 'ひざの上、落ち着くね', '落ち着く場所を見つけたね', 'sleepy', 'calm'),
    scene('hold-breathe', 'play', 'hold', '抱っこして、ひとやすみ', 'ひとやすみ、できたね', 'ひとやすみを思い出したよ', 'quiet', 'calm'),
    scene('hold-hug', 'play', 'hold', 'やさしく、くっついてみよう', 'やさしい時間になったね', 'やさしい時間、よかったね', 'soft', 'close'),

    scene('play-peek', 'play', 'play', 'かくれた光を探して遊ぼう', '光を探すの、楽しいね', '光探し、またしたいね', 'play', 'playful'),
    scene('play-roll', 'play', 'play', 'まるをころころ転がそう', 'ころころ、うまく転がったね', 'ころころの音、覚えているよ', 'play', 'happy'),
    scene('play-color', 'play', 'play', '色をひとつ選んで遊ぼう', '色が、きれいに広がったね', 'きれいな色で遊んだね', 'sparkle', 'happy'),
    scene('play-cloud', 'play', 'play', '雲をふわふわ動かそう', '雲が、ふわっと動いたね', 'ふわふわ、気持ちよかったね', 'soft', 'calm'),
    scene('play-rhythm', 'play', 'play', 'リズムを、ゆっくり楽しもう', 'リズムが、ぽんっと弾んだね', '弾むリズム、面白かったね', 'play', 'playful'),

    scene('sleep-yawn', 'settle', 'sleep', 'ゆっくり、目を休めよう', 'ゆっくりできたね', 'ゆっくりしたこと、覚えているよ', 'sleepy', 'sleepy'),
    scene('sleep-star', 'settle', 'sleep', '静かな星を眺めよう', '星を見て、落ち着いたね', '静かな星、きれいだったね', 'quiet', 'calm'),
    scene('sleep-breath', 'settle', 'sleep', 'ふうっと、ひと息つこう', 'ひと息ついて、すっきりしたね', 'すっきりしたね', 'quiet', 'calm'),
    scene('sleep-night', 'settle', 'sleep', '小さな声で、おやすみしよう', 'おやすみの時間だね', 'おやすみ前、静かだったね', 'sleepy', 'sleepy'),

    scene('talk-word', 'remember', 'talk', '教えてくれた{{word}}を思い出そう', '{{word}}って、すてきな言葉だね', '{{word}}を聞いたね', 'curious', 'happy', true),
    scene('talk-greeting', 'remember', 'talk', 'ひとこと、おしゃべりしよう', 'おしゃべり、うれしいね', 'おしゃべりの時間だったね', 'happy', 'close'),
    scene('talk-color', 'remember', 'talk', '好きな色を話してみよう', '色のお話、楽しいね', '色のお話を覚えているよ', 'curious', 'happy'),
    scene('talk-feeling', 'remember', 'talk', 'いまの気分を話してみよう', '気分を教えてくれて、ありがとう', '気分のお話、聞けたね', 'soft', 'close'),
    scene('talk-sound', 'remember', 'talk', '好きな音を話してみよう', '音のお話、面白いね', '音のお話、また聞きたいね', 'curious', 'playful'),

    scene('echo-ping', 'play', 'echo', 'ぼくの音を、まねしてみよう', '音のまね、ぴったりだね', '音のまね、楽しかったね', 'echo', 'happy', false, true),
    scene('echo-soft', 'play', 'echo', 'やさしい声を、まねしてみよう', 'やさしいまねっこだね', 'やさしい声、覚えているよ', 'soft', 'calm', false, true),
    scene('echo-rhythm', 'play', 'echo', 'このリズムを、まねしてみよう', 'リズムのまね、できたね', 'リズムを一緒に楽しんだね', 'play', 'playful', false, true),
    scene('echo-hello', 'remember', 'echo', 'ひとこと、まねしてみよう', 'ひとことのまね、できたね', 'ひとことを一緒に言ったね', 'happy', 'close', false, true)
  ];

  return { ACTIONS, SCENES };
}));
