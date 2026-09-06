/* まねっこリレーの純粋な計算。鳴らす順番と声の設定だけを作る。DOM・音・保存に触れない。Nodeでも再現可能にする。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LittleCompanionEchoRelay = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* 掛け合わせた高さの枠。voice-memory.js の normalizeTuning と同じ範囲（0.55〜3.5）。
     1を1.2に置き換える既存の決まりはここではしない（掛け算の途中の1は、その回の声をそのまま生かす） */
  const PITCH_MIN = .55;
  const PITCH_MAX = 3.5;
  const DEFAULT_HOPS = 4;

  const otherPetId = petId => petId === 'pet-1' ? 'pet-2' : 'pet-1';
  const clampPitch = value => Math.max(PITCH_MIN, Math.min(PITCH_MAX, value));
  const usableTuning = tuning => Boolean(tuning && typeof tuning === 'object' && Number.isFinite(Number(tuning.pitchRate)));
  /* 鳴らす回数。指定がなければ4回。0や負・数字でないものは1回扱い（今までどおり）に落とす */
  const hopCount = hops => {
    if (hops === undefined) return DEFAULT_HOPS;
    const value = Math.floor(Number(hops));
    return Number.isFinite(value) && value > 0 ? value : 1;
  };

  function relayPlan({ startPetId, tunings, hops } = {}) {
    /* 1回だけ（今までどおり）。始まりの子が変・その子か相手の設定が無い・回数が1以下のときはここに落ちる */
    const single = () => [{ petId:startPetId, tuning:usableTuning(tunings && tunings[startPetId]) ? tunings[startPetId] : null }];
    if ((startPetId !== 'pet-1' && startPetId !== 'pet-2') || !usableTuning(tunings && tunings[startPetId]) || !usableTuning(tunings && tunings[otherPetId(startPetId)])) return single();
    const count = hopCount(hops);
    if (count < 2) return single();
    const plan = [];
    let pitchRate = 0;
    let petId = startPetId;
    for (let index = 0; index < count; index += 1) {
      const tuning = tunings[petId];
      /* 1回目はその子の高さ。2回目以降は前の回の高さに、その回の子の高さを掛ける。枠を外れたら丸める。
         高さ以外（速さ・二重声・明るさ・方式）は、その回にまねている子のものをそのまま使う */
      pitchRate = clampPitch(index === 0 ? Number(tuning.pitchRate) : pitchRate * Number(tuning.pitchRate));
      plan.push({ petId, tuning:{ pitchRate, speedRate:tuning.speedRate, doubleMix:tuning.doubleMix, brightness:tuning.brightness, timingMode:tuning.timingMode } });
      petId = otherPetId(petId);
    }
    return plan;
  }

  return Object.freeze({ PITCH_MIN, PITCH_MAX, DEFAULT_HOPS, otherPetId, relayPlan });
}));
