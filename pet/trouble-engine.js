/* 困りごとと助けの純粋な計算。DOM・保存に触れない。Nodeでも再現可能にする。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LittleCompanionTrouble = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const KINDS = ['puni', 'book', 'window', 'hiccup', 'leaf', 'ball'];
  const phrases = {
    puni: { troubled: 'ぷに…？', resolved: 'いた！ ありがと', nextDay: 'きのう、ぷに さがしてくれたね' },
    book: { troubled: 'あ…', resolved: 'ありがと', nextDay: 'きのう、ほん なおしてくれたね' },
    window: { troubled: 'さむ…', resolved: 'ふぅ。ありがと', nextDay: 'きのう、まど しめてくれたね' },
    hiccup: { troubled: 'ひっく', resolved: 'とまった。ありがと', nextDay: 'きのう、しゃっくり とめてくれたね' },
    leaf: { troubled: 'ん…？', resolved: 'とれた。ありがと', nextDay: 'きのう、はっぱ とってくれたね' },
    ball: { troubled: 'とどかない…', resolved: 'やった！ ありがと', nextDay: 'きのう、ボール とってくれたね' }
  };
  const clamp = value => Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  const today = now => { const date = now instanceof Date ? now : new Date(now || Date.now()); const pad = value => String(value).padStart(2, '0'); return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`; };
  const dayShift = (now, days) => { const date = new Date(now instanceof Date ? now.getTime() : new Date(now || Date.now()).getTime()); date.setDate(date.getDate() + days); return date; };
  function resolvedPhrase(kind, childName) {
    const base = phrases[kind] ? phrases[kind].resolved : '';
    const name = String(childName || '').trim().slice(0, 12);
    return base && name ? `${base}、${name}ちゃん` : base;
  }
  function troubleOf(data) { return data && data.trouble && typeof data.trouble === 'object' ? data.trouble : null; }
  function dailyOf(trouble, now) {
    const daily = trouble && trouble.daily && typeof trouble.daily === 'object' ? trouble.daily : null;
    if (daily && daily.date === today(now)) return daily;
    return { date: today(now), count: 0, kinds: [] };
  }
  function occurrencesOf(trouble, now) {
    const daily = dailyOf(trouble, now);
    const kinds = Array.isArray(daily.kinds) ? daily.kinds.filter(kind => KINDS.includes(kind)) : [];
    return Math.max(Math.max(0, Number(daily.count) || 0), kinds.length);
  }
  function yesterdayKinds(data, now) {
    const trouble = troubleOf(data);
    const yesterday = today(dayShift(now, -1));
    const fromLog = trouble && Array.isArray(trouble.helpLog) ? trouble.helpLog.filter(item => item && item.date === yesterday && KINDS.includes(item.kind)).map(item => item.kind) : [];
    const fromDaily = trouble && trouble.daily && trouble.daily.date === yesterday && Array.isArray(trouble.daily.kinds) ? trouble.daily.kinds.filter(kind => KINDS.includes(kind)) : [];
    return [...new Set([...fromLog, ...fromDaily])];
  }
  function pickTrouble(data, ctx, now) {
    const context = ctx && typeof ctx === 'object' ? ctx : {};
    const trouble = troubleOf(data);
    if (!trouble) return null;
    if (trouble.enabled === false || context.enabled === false) return null;
    if (context.quiet === true) return null;
    if (context.allAsleep === true) return null;
    const awake = Array.isArray(context.awakePetIds) ? context.awakePetIds.filter(id => id === 'pet-1' || id === 'pet-2') : [];
    if (!awake.length) return null;
    const protagonist = context.activePetId === 'pet-2' ? 'pet-2' : context.activePetId === 'pet-1' ? 'pet-1' : '';
    if (!protagonist || !awake.includes(protagonist)) return null;
    if (trouble.active && trouble.active.kind) return null;
    if (occurrencesOf(trouble, now) >= 2) return null;
    const used = new Set([...dailyOf(trouble, now).kinds.filter(kind => KINDS.includes(kind)), ...yesterdayKinds(data, now), ...(Array.isArray(context.exclude) ? context.exclude.filter(kind => KINDS.includes(kind)) : [])]);
    const candidates = KINDS.filter(kind => !used.has(kind));
    if (!candidates.length) return null;
    const rng = typeof context.rng === 'function' ? context.rng : Math.random;
    const value = Number(rng()) || 0;
    return candidates[Math.min(candidates.length - 1, Math.floor(value * candidates.length))];
  }
  function troubleDailyReset(data, now) {
    const trouble = troubleOf(data);
    if (!trouble) return data;
    const date = today(now);
    if (trouble.daily && trouble.daily.date === date) return data;
    trouble.active = null;
    trouble.daily = { date, count: 0, kinds: [] };
    return data;
  }
  function startTrouble(data, kind, petId, now) {
    if (!data || !KINDS.includes(kind)) return null;
    if (!data.trouble || typeof data.trouble !== 'object') data.trouble = { active: null, daily: { date: today(now), count: 0, kinds: [] }, helpLog: [], helpTotal: 0, enabled: true };
    troubleDailyReset(data, now);
    const trouble = data.trouble;
    if (trouble.active && trouble.active.kind) return trouble.active;
    const daily = dailyOf(trouble, now);
    if (!daily.kinds.includes(kind)) daily.kinds = [...daily.kinds, kind].slice(-6);
    trouble.daily = daily;
    trouble.active = { kind, petId: petId === 'pet-2' ? 'pet-2' : 'pet-1', startedAt: new Date(now instanceof Date ? now.getTime() : new Date(now || Date.now()).getTime()).toISOString(), date: daily.date };
    return trouble.active;
  }
  function resolveTrouble(data, now) {
    const trouble = troubleOf(data);
    if (!trouble || !trouble.active || !trouble.active.kind) return null;
    const helped = { kind: trouble.active.kind, petId: trouble.active.petId === 'pet-2' ? 'pet-2' : 'pet-1' };
    troubleDailyReset(data, now);
    trouble.active = null;
    const date = today(now);
    trouble.helpLog = [...(Array.isArray(trouble.helpLog) ? trouble.helpLog : []), { date, kind: helped.kind, petId: helped.petId, at: new Date(now instanceof Date ? now.getTime() : new Date(now || Date.now()).getTime()).toISOString() }].slice(-60);
    trouble.helpTotal = Math.max(0, Number(trouble.helpTotal) || 0) + 1;
    trouble.daily.count = Math.max(0, Number(trouble.daily.count) || 0) + 1;
    data.bond = clamp((Number(data.bond) || 0) + 2);
    return helped;
  }
  function helpedYesterday(data, now) {
    const trouble = troubleOf(data);
    if (!trouble || !Array.isArray(trouble.helpLog)) return null;
    const yesterday = today(dayShift(now, -1));
    const entries = trouble.helpLog.filter(item => item && item.date === yesterday && KINDS.includes(item.kind));
    return entries.length ? entries[entries.length - 1].kind : null;
  }
  return { KINDS, phrases, resolvedPhrase, pickTrouble, startTrouble, resolveTrouble, troubleDailyReset, helpedYesterday };
}));
