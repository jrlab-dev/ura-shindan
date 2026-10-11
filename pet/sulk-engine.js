/* 拗ねる・戻るの純粋な計算。DOM・保存に触れない。Nodeでも再現可能にする。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LittleCompanionSulk = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const SULK_DAYS = 3;
  const phrases = {
    first: '……',
    talk1: 'ん…',
    talk2: '……ひさしぶり',
    half: '…あそぶ？',
    back: 'おかえり'
  };
  const pad = value => String(value).padStart(2, '0');
  const toDate = now => now instanceof Date ? now : new Date(now || Date.now());
  const today = now => { const date = toDate(now); return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`; };
  const isDate = value => { const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '')); if (!match) return false; const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])); return date.getFullYear() === Number(match[1]) && date.getMonth() === Number(match[2]) - 1 && date.getDate() === Number(match[3]); };
  /* カレンダーの日付の差（時刻では数えない）。端末のローカル日付で数える */
  function dayDiff(from, to) {
    const a = String(from || '').split('-').map(Number);
    const b = String(to || '').split('-').map(Number);
    if (a.length !== 3 || b.length !== 3 || a.some(Number.isNaN) || b.some(Number.isNaN)) return NaN;
    return Math.round((new Date(b[0], b[1] - 1, b[2]).getTime() - new Date(a[0], a[1] - 1, a[2]).getTime()) / 86400000);
  }
  function withName(base, childName) {
    const name = String(childName || '').trim().slice(0, 12);
    return name ? `${base}、${name}ちゃん` : base;
  }
  function defaultSulk() { return { enabled: true, level: 0, sinceDate: '', lastVisitDate: '', talkCount: 0 }; }
  function sulkOf(data) { return data && data.sulk && typeof data.sulk === 'object' ? data.sulk : null; }
  function ensure(data) {
    if (!data || typeof data !== 'object') return null;
    if (!sulkOf(data)) data.sulk = defaultSulk();
    return data.sulk;
  }
  /* 開いた。前に開いた日から3日以上あいていればその場で拗ねる。戻り値＝今回拗ねに入ったか。
     拗ねに入った日は lastVisitDate を進めない（あいた日数を「すねている（○日ぶり）」に残すため。
     戻る（care）ときに、その日のぶんを記録する） */
  function onOpen(data, now) {
    const sulk = ensure(data);
    if (!sulk) return false;
    const date = today(now);
    if (!isDate(sulk.lastVisitDate)) { sulk.lastVisitDate = date; return false; }
    const gap = dayDiff(sulk.lastVisitDate, date);
    if (!Number.isFinite(gap) || gap < 0) return false; /* 時計が過去へ戻っていたら拗ねない・記録も進めない */
    if (gap >= SULK_DAYS && sulk.enabled !== false) {
      const fresh = sulk.sinceDate !== date;
      sulk.level = 1; sulk.sinceDate = date;
      if (fresh) sulk.talkCount = 0;
      return true;
    }
    sulk.lastVisitDate = date;
    return false;
  }
  /* 拗ね中か（オフなら常に false） */
  function isSulking(data, now) {
    const sulk = sulkOf(data);
    return Boolean(sulk && sulk.enabled !== false && Number(sulk.level) === 1);
  }
  /* 世話が1つ入った。拗ね中ならその場で解けて「たった今戻った」を返す。戻った日を記録する */
  function care(data, now) {
    const sulk = ensure(data);
    if (!sulk || !isSulking(data, now)) return false;
    sulk.level = 0;
    sulk.talkCount = 0;
    sulk.lastVisitDate = today(now);
    return true;
  }
  /* 世話に数えないこと（おはなし・まねっこ）をした。言葉を返す（拗ねていなければ空文字） */
  function noteTalk(data, now) {
    const sulk = ensure(data);
    if (!sulk || !isSulking(data, now)) return '';
    sulk.talkCount = Math.max(0, Math.floor(Number(sulk.talkCount) || 0)) + 1;
    return sulk.talkCount === 1 ? phrases.talk1 : phrases.talk2;
  }
  /* 何日ぶりか（保護者画面の表示用。記録が無い・時計が過去なら 0） */
  function daysAway(data, now) {
    const sulk = sulkOf(data);
    if (!sulk || !isDate(sulk.lastVisitDate)) return 0;
    const gap = dayDiff(sulk.lastVisitDate, today(now));
    return Number.isFinite(gap) && gap > 0 ? gap : 0;
  }
  /* 保護者画面のスイッチ。オフでその場で解除。オンでその日から数え直す（過去に遡らない） */
  function setEnabled(data, on, now) {
    const sulk = ensure(data);
    if (!sulk) return null;
    sulk.enabled = on !== false;
    sulk.level = 0;
    sulk.talkCount = 0;
    if (sulk.enabled) { sulk.sinceDate = ''; sulk.lastVisitDate = today(now); }
    return sulk;
  }
  return { SULK_DAYS, phrases, withName, onOpen, isSulking, care, noteTalk, daysAway, setEnabled, defaultSulk };
}));
