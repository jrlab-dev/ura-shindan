/* 世代交代の一生の純粋な計算。DOM・保存に触れない。Nodeでも再現可能にする。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LittleCompanionGeneration = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const STAGES = ['baby', 'child', 'big', 'adult'];
  const ADULT_TYPES = ['amaenbo', 'oshaberi', 'genki'];
  const CARE_KINDS = ['tap', 'stroke', 'hold', 'play', 'sleep', 'talk'];

  const RULES = {
    baby:  { days: 0, care: 3, cap: 1  },
    child: { days: 2, care: 3, cap: 4  },
    big:   { days: 5, care: 5, cap: 10 },
    adult: { days: 7, care: 5, cap: 14 }
  };
  const phrases = {
    soonAdult: 'もうすぐ おとなに なりそう',
    wantsChild: 'あかちゃん ほしいな',
    needMore:  'もうすこし げんきに なったら',
    born:      'あかちゃんが うまれたよ',
    depart:    'たびに でるよ。またね',
    returned:  'おおきく なったね',
    newGeneration: 'あたらしい こが うまれたよ',
    visitStay:     'おとうさんと おかあさんが かえってきた'
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
  function defaultGeneration() { return { generation:1, lifeStage:'baby', adultType:'', stageStartDate:'', stageStartCare:0, childrenBorn:0, away:false, parents:[], hue:340, highVoiceColor:'pink', childNames:[], lastVisitDate:'', petName:'' }; }
  function generationOf(data) { return data && data.generation && typeof data.generation === 'object' ? data.generation : null; }
  function ensure(data) {
    if (!data || typeof data !== 'object') return null;
    if (!generationOf(data)) data.generation = defaultGeneration();

    const gen = data.generation;
    if (!Array.isArray(gen.childNames)) gen.childNames = [];
    if (typeof gen.lastVisitDate !== 'string' || !isDate(gen.lastVisitDate)) gen.lastVisitDate = '';
    if (typeof gen.petName !== 'string') gen.petName = '';
    if (!Array.isArray(gen.parents)) gen.parents = [];
    const generationNumber = Math.max(1, Math.floor(Number(gen.generation) || 0));
    if (generationNumber === 1) gen.highVoiceColor = 'pink';
    else if (gen.highVoiceColor !== 'white' && gen.highVoiceColor !== 'pink') gen.highVoiceColor = legacyHighVoiceColor(gen, generationNumber);
    return gen;
  }
  /* 世話の累計（careCount の中身は引数の data から読むだけ。壊れた値は0に丸める） */
  function careTotalOf(data) {
    const counts = data && data.careCount && typeof data.careCount === 'object' ? data.careCount : {};
    return CARE_KINDS.reduce((sum, kind) => sum + Math.max(0, Math.floor(Number(counts[kind]) || 0)), 0);
  }

  function adultTypeOf(traits) {
    const source = traits && typeof traits === 'object' ? traits : null;
    if (!source) return 'amaenbo';
    const values = { playful: numOf(source.playful), calm: numOf(source.calm), talkative: numOf(source.talkative) };
    if (!Object.values(values).every(Number.isFinite)) return 'amaenbo';
    if (values.calm >= values.playful && values.calm >= values.talkative) return 'amaenbo';
    if (values.talkative >= values.playful) return 'oshaberi';
    return 'genki';
  }
  /* seed から -15〜+15 のずらしを決める（同じ seed なら必ず同じ値。乱数は直接使わない） */
  function seedOffset(seed) {
    let hash = 0;
    const text = String(seed === undefined || seed === null ? '' : seed);
    for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) | 0;
    return (Math.abs(hash) % 31) - 15;
  }
  /* null/undefined を Number で 0 にしないための読み（無い値は NaN にして既定へ落とす） */
  const numOf = value => value === undefined || value === null ? NaN : Number(value);
  const wrapHue = value => ((Math.round(value) % 360) + 360) % 360;
  /* 生まれた瞬間に一度だけ使う50%の二択。結果は highVoiceColor として保存する */
  function chooseHighVoiceColor(randomValue) { return Number(randomValue) >= 0 && Number(randomValue) < 0.5 ? 'white' : 'pink'; }
  /* v13の2代目以降に色が無い場合だけ使う。移行のたびに色を引き直さないための安定した二択 */
  function legacyHighVoiceColor(source, generationNumber) {
    let hash = 2166136261;
    const text = `${generationNumber}:${source && source.stageStartDate || ''}:${source && source.petName || ''}`;
    for (let i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 16777619); }
    return (hash >>> 0) % 2 === 0 ? 'white' : 'pink';
  }
  const hueOf = side => { const value = numOf(side && side.hue); return Number.isFinite(value) ? wrapHue(value) : 340; };
  const traitOf = (side, key) => { const value = numOf(side && side.traits && side.traits[key]); return Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : 50; };

  function inherit(a, b, seed) {
    const traits = {};
    ['playful', 'calm', 'talkative'].forEach(key => {
      traits[key] = Math.max(0, Math.min(100, Math.round(((traitOf(a, key) + traitOf(b, key)) / 2 + 50) / 2)));
    });
    return { hue: wrapHue((hueOf(a) + hueOf(b)) / 2 + seedOffset(seed)), traits };
  }
  /* 今の段と子の数。壊れた値は最初期に丸める */
  const lifeStageOf = gen => STAGES.includes(gen.lifeStage) ? gen.lifeStage : 'baby';
  const childrenBornOf = gen => Math.max(0, Math.min(2, Math.floor(Number(gen.childrenBorn) || 0)));
  const stageStartCareOf = gen => Math.max(0, Math.floor(Number(gen.stageStartCare) || 0));
  const adultTypeOrEmpty = gen => ADULT_TYPES.includes(gen.adultType) ? gen.adultType : '';
  /* X2の3項目と親の記録。壊れた値は既定に丸める。名前は前後の空白を落として12字まで */
  const generationNumOf = gen => Math.max(1, Math.floor(Number(gen.generation) || 0));
  const petNameOf = gen => { const name = typeof gen.petName === 'string' ? gen.petName.trim() : ''; return name ? name.slice(0, 12) : ''; };
  const childNamesOf = gen => { const raw = Array.isArray(gen.childNames) ? gen.childNames : []; return [0, 1].map(i => { const name = typeof raw[i] === 'string' ? raw[i].trim() : ''; return name ? name.slice(0, 12) : ''; }); };
  /* 代の名前。gen.petName が空なら保存データの petName を使う（1代目は gen 側に名前が無いため。2026-09-10） */
  const dataPetName = data => data && typeof data.petName === 'string' ? data.petName.trim().slice(0, 12) : '';
  const parentsOf = gen => (Array.isArray(gen.parents) ? gen.parents : []).filter(item => item && typeof item === 'object').slice(-2);


  function setChildName(data, index, name) {
    const gen = ensure(data);
    if (!gen) return [];
    const names = childNamesOf(gen);
    if ((index === 0 || index === 1) && typeof name === 'string') {
      const clean = name.trim().slice(0, 12);
      if (clean) names[index] = clean;
    }
    gen.childNames = names;
    return names.slice();
  }


  function result(data, gen, date, motion) {
    const stage = lifeStageOf(gen);
    const rule = RULES[stage];
    const away = gen.away === true;
    const gained = Math.max(0, careTotalOf(data) - stageStartCareOf(gen));
    const gap = Math.max(0, dayDiff(gen.stageStartDate, date) || 0);
    /* 次へ進る見込み。世話が足りていれば days を、足りなければ cap を待つ */
    const daysLeft = gained >= rule.care ? rule.days - gap : rule.cap - gap;
    return {
      advanced: motion.advanced,
      lifeStage: stage,
      adultType: stage === 'adult' ? adultTypeOrEmpty(gen) : '',
      bornChild: motion.bornChild,
      departed: motion.departed,
      newGeneration: motion.newGeneration === true,
      returned: motion.returned === true,
      parentsVisiting: parentsOf(gen).length > 0 && gen.lastVisitDate === date,
      soonAdult: !away && stage === 'big' && daysLeft <= 2,
      wantsChild: !away && stage === 'adult' && childrenBornOf(gen) < 2,
      needCare: away || motion.departed ? 0 : Math.max(0, rule.care - gained)
    };
  }



  function onOpen(data, now, random = Math.random) {
    const gen = ensure(data);
    if (!gen) return { advanced:false, lifeStage:'baby', adultType:'', bornChild:0, departed:false, newGeneration:false, returned:false, parentsVisiting:false, soonAdult:false, wantsChild:false, needCare:0 };
    const date = today(now);
    const careNow = careTotalOf(data);
    if (!isDate(gen.stageStartDate)) {
      gen.stageStartDate = date;
      gen.stageStartCare = careNow;
      return result(data, gen, date, { advanced:false, bornChild:0, departed:false });
    }
    const gap = dayDiff(gen.stageStartDate, date);
    if (!Number.isFinite(gap) || gap < 0) return result(data, gen, date, { advanced:false, bornChild:0, departed:false }); /* 時計が過去へ戻っていたら何もしない・日付も進めない */
    const stage = lifeStageOf(gen);
    const rule = RULES[stage];
    const gained = Math.max(0, careNow - stageStartCareOf(gen));
    const born = childrenBornOf(gen);
    let advanced = false, bornChild = 0, departed = false, returned = false, newGeneration = false;
    if (gen.away !== true && (gap >= rule.cap || (gap >= rule.days && gained >= rule.care))) {
      if (stage === 'baby') { gen.lifeStage = 'child'; advanced = true; }
      else if (stage === 'child') { gen.lifeStage = 'big'; advanced = true; }
      else if (stage === 'big') { gen.lifeStage = 'adult'; gen.adultType = adultTypeOf(data && data.traits); advanced = true; }
      else if (born >= 2) {

        gen.away = true; departed = true; advanced = true;
        gen.parents = parentsOf(gen);
        gen.parents.push({ name: petNameOf(gen) || dataPetName(data), hue: hueOf(gen), adultType: adultTypeOrEmpty(gen), departedAt: date });
        gen.parents = gen.parents.slice(-2); /* 額に出すぶんだけ。直近2件（祖父母より前は持たない） */
        const pair = gen.parents.length >= 2 ? [gen.parents[gen.parents.length - 2], gen.parents[gen.parents.length - 1]] : [gen.parents[0], { hue: gen.hue }];
        gen.generation = generationNumOf(gen) + 1;
        gen.hue = inherit(pair[0], pair[1], gen.generation + ':' + date).hue;
        gen.petName = childNamesOf(gen)[0] || petNameOf(gen); /* 1人めの名前。無ければ元の名前のまま */
        gen.highVoiceColor = chooseHighVoiceColor(typeof random === 'function' ? random() : Math.random());
        gen.lifeStage = 'baby'; gen.adultType = ''; gen.childrenBorn = 0; gen.away = false;
        gen.childNames = []; gen.lastVisitDate = '';
        newGeneration = true;
      }
      else { gen.childrenBorn = born + 1; bornChild = born + 1; advanced = true; }

      if (advanced && !bornChild && !departed && parentsOf(gen).length > 0) { returned = true; gen.lastVisitDate = date; }
      gen.stageStartDate = date;
      gen.stageStartCare = careNow;
    }
    return result(data, gen, date, { advanced, bornChild, departed, returned, newGeneration });
  }
  return { STAGES, ADULT_TYPES, RULES, phrases, defaultGeneration, careTotalOf, ensure, adultTypeOf, inherit, chooseHighVoiceColor, setChildName, onOpen };
}));
