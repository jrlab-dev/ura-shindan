/* 週ごとの成長の純粋な計算。DOM・保存に触れない。Nodeでも再現可能にする。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LittleCompanionGrowth = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const WEEK_DAYS = 7;
  const WEEK_HELP_THRESHOLD = 3;
  const MAX_STAGE = 4;
  const phrases = { levelUp: 'せいちょうしたみたい' };
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
  function defaultGrowth() { return { enabled: true, stage: 0, weekStartDate: '', weekStartHelpTotal: 0, unlockedAt: [] }; }
  function growthOf(data) { return data && data.growth && typeof data.growth === 'object' ? data.growth : null; }
  function ensure(data) {
    if (!data || typeof data !== 'object') return null;
    if (!growthOf(data)) data.growth = defaultGrowth();
    return data.growth;
  }
  /* 助けた累計（trouble の中身は引数の data から読むだけ。無ければ0） */
  function helpTotalOf(data) {
    return Math.max(0, Math.floor(Number(data && data.trouble && data.trouble.helpTotal) || 0));
  }
  /* 今の段階（0〜4）。壊れた値は0に丸める */
  function getStage(data) {
    const growth = growthOf(data);
    if (!growth) return 0;
    return Math.max(0, Math.min(MAX_STAGE, Math.floor(Number(growth.stage) || 0)));
  }
  /* 開いた。前回の週の開始日から7日たっていて、その7日間に助けが3以上増えていれば1段だけ進める。
     1回のチェックで最大1段（長く開かなかった家庭が飛び級しない）。
     進めても進めなくても、7日たっていたら次の週の計測を今日から始め直す（届かなかった週は何も起きない） */
  function onOpen(data, now) {
    const growth = ensure(data);
    if (!growth) return { advanced: false, stage: 0, justReachedMax: false };
    const date = today(now);
    if (!isDate(growth.weekStartDate)) {
      growth.weekStartDate = date;
      growth.weekStartHelpTotal = helpTotalOf(data);
      return { advanced: false, stage: getStage(data), justReachedMax: false };
    }
    const gap = dayDiff(growth.weekStartDate, date);
    if (!Number.isFinite(gap) || gap < 0) return { advanced: false, stage: getStage(data), justReachedMax: false }; /* 時計が過去へ戻っていたら何もしない・日付も進めない */
    if (gap < WEEK_DAYS) return { advanced: false, stage: getStage(data), justReachedMax: false };
    const helped = helpTotalOf(data);
    const stage = getStage(data);
    let advanced = false;
    if (helped - growth.weekStartHelpTotal >= WEEK_HELP_THRESHOLD && growth.enabled !== false && stage < MAX_STAGE) {
      growth.stage = stage + 1;
      growth.unlockedAt = [...(Array.isArray(growth.unlockedAt) ? growth.unlockedAt : []), date].slice(-MAX_STAGE);
      advanced = true;
    }
    growth.weekStartDate = date;
    growth.weekStartHelpTotal = helped;
    return { advanced, stage: growth.stage, justReachedMax: advanced && growth.stage === MAX_STAGE };
  }
  /* 保護者画面のスイッチ。以後の段階アップだけ止まる（stage・unlockedAt は一切変えない） */
  function setEnabled(data, on) {
    const growth = ensure(data);
    if (!growth) return null;
    growth.enabled = on !== false;
    return growth;
  }
  return { WEEK_DAYS, WEEK_HELP_THRESHOLD, MAX_STAGE, phrases, defaultGrowth, helpTotalOf, onOpen, getStage, setEnabled };
}));
