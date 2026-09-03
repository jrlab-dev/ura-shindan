/* 朝と夜の儀式の純粋な計算。DOM・保存に触れない。Nodeでも再現可能にする。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LittleCompanionRitual = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const WINDOWS = { 'pet-1': { wakeFrom: 8, wakeTo: 12, tuckFrom: 19, tuckTo: 22 }, 'pet-2': { wakeFrom: 7, wakeTo: 12, tuckFrom: 19, tuckTo: 20.5 } };
  const MEAL_WINDOW = { from: 7, to: 19 };
  const CLOCK_SLEEP = { 'pet-1': { sleep: 22 * 60, wake: 8 * 60 }, 'pet-2': { sleep: 20 * 60 + 30, wake: 5 * 60 + 30 } };
  const PET_IDS = ['pet-1', 'pet-2'];
  const phrases = {
    drowsy: 'ん…',
    wake: 'おはよう',
    wakeTiredFirst: 'ん…まだ ねむい…',
    wakeTired: 'ふぁ…おはよう',
    hungry: 'おなか すいた…',
    good: 'きょうも あえた！',
    meal: 'もぐもぐ',
    tuckIn: 'また あした',
    autoWake: 'ふぁ…'
  };
  const pad = value => String(value).padStart(2, '0');
  const toDate = now => now instanceof Date ? now : new Date(now || Date.now());
  const today = now => { const date = toDate(now); return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`; };
  const dayShift = (now, days) => { const date = new Date(toDate(now).getTime()); date.setDate(date.getDate() + days); return date; };
  const timeOf = now => toDate(now).getTime();
  const minutesOf = now => { const date = toDate(now); return date.getHours() * 60 + date.getMinutes(); };
  const hoursOf = now => { const date = toDate(now); return date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600; };
  const stamp = now => new Date(timeOf(now)).toISOString();
  const inWindow = (from, to, now) => { const hours = hoursOf(now); return hours >= from && hours < to; };
  const clockSleeping = (petId, now) => { const config = CLOCK_SLEEP[petId]; if (!config) return false; const minutes = minutesOf(now); return config.sleep < config.wake ? (minutes >= config.sleep && minutes < config.wake) : (minutes >= config.sleep || minutes < config.wake); };
  function withName(base, childName) {
    const name = String(childName || '').trim().slice(0, 12);
    return name ? `${base}、${name}ちゃん` : base;
  }
  function ritualOf(data) { return data && data.ritual && typeof data.ritual === 'object' ? data.ritual : null; }
  function freshDay(date) {
    return {
      date,
      morning: { 'pet-1': { woke: false, at: '', tries: 0 }, 'pet-2': { woke: false, at: '', tries: 0 } },
      meal: { done: false, at: '' },
      night: { 'pet-1': { tucked: false, at: '' }, 'pet-2': { tucked: false, at: '' } },
      yesterday: null,
      log: [],
      streak: 0,
      yawns: { 'pet-1': '', 'pet-2': '' },
      enabled: true
    };
  }
  function morningOf(ritual, petId) { return ritual && ritual.morning && typeof ritual.morning === 'object' && ritual.morning[petId] && typeof ritual.morning[petId] === 'object' ? ritual.morning[petId] : {}; }
  function nightOf(ritual, petId) { return ritual && ritual.night && typeof ritual.night === 'object' && ritual.night[petId] && typeof ritual.night[petId] === 'object' ? ritual.night[petId] : {}; }
  function carryOf(ritual, date) {
    const morning = {}; const night = {};
    PET_IDS.forEach(id => { morning[id] = morningOf(ritual, id).woke === true; night[id] = nightOf(ritual, id).tucked === true; });
    const meal = Boolean(ritual.meal && typeof ritual.meal === 'object' && ritual.meal.done);
    const all = meal && PET_IDS.every(id => morning[id] && night[id]);
    return { date, morning, meal, night, all };
  }
  /* 日付が変わっていたら昨日ぶんをまとめて新しい日を作る。返り値は変わったかどうか */
  function ritualDailyReset(data, now) {
    if (!data || typeof data !== 'object') return false;
    const date = today(now);
    const current = ritualOf(data);
    if (!current) { data.ritual = freshDay(date); return true; }
    if (current.date === date) return false;
    const carried = current.date === today(dayShift(now, -1)) ? carryOf(current, current.date) : null;
    const next = freshDay(date);
    next.yesterday = carried;
    const log = Array.isArray(current.log) ? current.log.filter(item => item && /^\d{4}-\d{2}-\d{2}$/.test(String(item.date))) : [];
    if (carried) log.push({ date: carried.date, woke: PET_IDS.filter(id => carried.morning[id]).length, meal: carried.meal, tucked: PET_IDS.filter(id => carried.night[id]).length, all: carried.all });
    next.log = log.slice(-30);
    next.streak = Math.max(0, Math.floor(Number(current.streak) || 0)) + (carried && carried.all ? 1 : 0);
    next.enabled = current.enabled !== false;
    data.ritual = next;
    return true;
  }
  /* 寝ぼけている（①を待っている）か */
  function isDrowsy(data, petId, now) {
    const window = WINDOWS[petId];
    if (!window) return false;
    const ritual = ritualOf(data);
    if (!ritual || ritual.enabled === false) return false;
    if (!inWindow(window.wakeFrom, window.wakeTo, now)) return false;
    const morning = morningOf(ritual, petId);
    if (morning.woke === true || morning.autoAt) return false;
    return true;
  }
  /* 前夜に③をしなかった子か（記録が無い初日は false） */
  function missedTuckYesterday(ritual, petId) {
    const yesterday = ritual && ritual.yesterday;
    return Boolean(yesterday && yesterday.night && typeof yesterday.night === 'object' && yesterday.night[petId] === false);
  }
  /* なでる1回ごとの判定。前夜に③をしなかった子は2回かかる */
  function wake(data, petId, now) {
    if (!isDrowsy(data, petId, now)) return { done: false, phrase: '' };
    const ritual = ritualOf(data);
    if (!ritual.morning || typeof ritual.morning !== 'object') ritual.morning = {};
    const entry = ritual.morning[petId] = typeof ritual.morning[petId] === 'object' && ritual.morning[petId] || { woke: false, at: '', tries: 0 };
    entry.tries = Math.max(0, Number(entry.tries) || 0) + 1;
    const tired = missedTuckYesterday(ritual, petId);
    if (tired && entry.tries < 2) return { done: false, phrase: phrases.wakeTiredFirst };
    entry.woke = true;
    entry.at = stamp(now);
    return { done: true, phrase: withName(tired ? phrases.wakeTired : phrases.wake, data && data.childName) };
  }
  /* 12:00 を過ぎて起こしていない子を「自分で起きた」にする */
  function autoWake(data, now) {
    const ritual = ritualOf(data);
    if (!ritual) return [];
    const woken = [];
    PET_IDS.forEach(id => {
      const morning = morningOf(ritual, id);
      if (morning.woke === true || morning.autoAt) return;
      if (hoursOf(now) >= WINDOWS[id].wakeTo) {
        if (!ritual.morning || typeof ritual.morning !== 'object') ritual.morning = {};
        ritual.morning[id] = { woke: false, at: '', tries: Math.max(0, Number(morning.tries) || 0), autoAt: stamp(now) };
        woken.push(id);
      }
    });
    return woken;
  }
  /* 器を出すか（窓の中・未・起きている子がいる・有効。寝ぼけている子は起きている数に入れない） */
  function mealReady(data, ctx, now) {
    const ritual = ritualOf(data);
    if (!ritual || ritual.enabled === false) return false;
    if (!inWindow(MEAL_WINDOW.from, MEAL_WINDOW.to, now)) return false;
    if (ritual.meal && typeof ritual.meal === 'object' && ritual.meal.done) return false;
    const context = ctx && typeof ctx === 'object' ? ctx : {};
    const awake = Array.isArray(context.awakePetIds) ? context.awakePetIds.filter(id => PET_IDS.includes(id) && !isDrowsy(data, id, now)) : [];
    return awake.length > 0;
  }
  /* ごはんをあげる。返り値＝なかよしを足す petId 一覧 */
  function feed(data, awakePetIds, now) {
    const ritual = ritualOf(data);
    if (!ritual) return [];
    if (ritual.meal && typeof ritual.meal === 'object' && ritual.meal.done) return [];
    ritual.meal = { done: true, at: stamp(now) };
    return (Array.isArray(awakePetIds) ? awakePetIds : []).filter(id => PET_IDS.includes(id) && !isDrowsy(data, id, now));
  }
  /* 寝かしつけの窓の中か */
  function canTuckIn(data, petId, now) {
    const window = WINDOWS[petId];
    if (!window) return false;
    const ritual = ritualOf(data);
    if (!ritual || ritual.enabled === false) return false;
    if (!inWindow(window.tuckFrom, window.tuckTo, now)) return false;
    if (nightOf(ritual, petId).tucked === true) return false;
    if (isTuckedAsleep(data, petId, now)) return false;
    if (clockSleeping(petId, now)) return false;
    if (isDrowsy(data, petId, now)) return false;
    return true;
  }
  function tuckIn(data, petId, now) {
    if (!canTuckIn(data, petId, now)) return null;
    const ritual = ritualOf(data);
    if (!ritual.night || typeof ritual.night !== 'object') ritual.night = {};
    const entry = { tucked: true, at: stamp(now) };
    ritual.night[petId] = entry;
    return entry;
  }
  /* 今日③で眠り、まだその子の起きる時刻前か（日付をまたいだ深夜も） */
  function isTuckedAsleep(data, petId, now) {
    const window = WINDOWS[petId];
    if (!window) return false;
    const ritual = ritualOf(data);
    if (!ritual) return false;
    const beforeWake = minutesOf(now) < CLOCK_SLEEP[petId].wake;
    if (ritual.date === today(now)) {
      if (nightOf(ritual, petId).tucked === true) return true;
      return Boolean(beforeWake && ritual.yesterday && typeof ritual.yesterday.night === 'object' && ritual.yesterday.night[petId] === true);
    }
    /* 日替わりの reset がまだの深夜は、昨晩の夜ぶんを直接見る */
    if (ritual.date === today(dayShift(now, -1))) return nightOf(ritual, petId).tucked === true && beforeWake;
    return false;
  }
  /* あくびを出すか（窓の中・未・前回から3分以上） */
  function yawnDue(data, petId, now) {
    const window = WINDOWS[petId];
    if (!window) return false;
    const ritual = ritualOf(data);
    if (!ritual || ritual.enabled === false) return false;
    if (!inWindow(window.tuckFrom, window.tuckTo, now)) return false;
    if (nightOf(ritual, petId).tucked === true) return false;
    const last = Date.parse(ritual.yawns && typeof ritual.yawns === 'object' && ritual.yawns[petId] || '');
    if (Number.isFinite(last) && timeOf(now) - last < 3 * 60 * 1000) return false;
    return true;
  }
  function noteYawn(data, petId, now) {
    const ritual = ritualOf(data);
    if (!ritual) return false;
    if (!ritual.yawns || typeof ritual.yawns !== 'object') ritual.yawns = {};
    ritual.yawns[petId] = stamp(now);
    return true;
  }
  /* 起きてから10分以内の翌朝の機嫌 */
  function morningMood(data, petId, now) {
    const ritual = ritualOf(data);
    if (!ritual || ritual.enabled === false) return null;
    const morning = morningOf(ritual, petId);
    const at = Date.parse(morning.at || '');
    if (morning.woke !== true || !Number.isFinite(at)) return null;
    if (timeOf(now) - at > 10 * 60 * 1000) return null;
    const yesterday = ritual.yesterday;
    if (!yesterday) return 'good';
    if (yesterday.night && typeof yesterday.night === 'object' && yesterday.night[petId] === false) return 'tired';
    if (!yesterday.meal) return 'hungry';
    if (yesterday.all) return 'good';
    return null;
  }
  /* 起きた直後の一言（該当なしは ''） */
  function openingPhrase(data, petId, now) {
    const ritual = ritualOf(data);
    if (!ritual || ritual.enabled === false) return '';
    if (morningOf(ritual, petId).woke !== true) return '';
    const yesterday = ritual.yesterday;
    if (!yesterday) return phrases.good;
    if (!yesterday.meal) return phrases.hungry;
    if (yesterday.all) return phrases.good;
    return '';
  }
  function todaySummary(data) {
    const ritual = ritualOf(data);
    if (!ritual) return { woke: 0, meal: false, tucked: 0 };
    return {
      woke: PET_IDS.filter(id => morningOf(ritual, id).woke === true).length,
      meal: Boolean(ritual.meal && typeof ritual.meal === 'object' && ritual.meal.done),
      tucked: PET_IDS.filter(id => nightOf(ritual, id).tucked === true).length
    };
  }
  return { WINDOWS, MEAL_WINDOW, phrases, withName, ritualDailyReset, isDrowsy, wake, autoWake, mealReady, feed, canTuckIn, tuckIn, isTuckedAsleep, yawnDue, noteYawn, morningMood, openingPhrase, todaySummary };
}));
