/* 2匹の見た目・音声プロファイル。保存データではなく、版管理する固定契約。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LittleCompanionPetPresentations = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const PET_PRESENTATIONS = Object.freeze({
    'pet-1': Object.freeze({
      id: 'pink-quick', visual: 'pink-small',
      pitchRate: 2.30, speedRate: 1.11, doubleMix: 0, brightness: 70,
      ttsPitch: 2.0, ttsRate: 1.11, replyGapMs: Object.freeze([120, 320])
    }),
    'pet-2': Object.freeze({
      id: 'blue-slow', visual: 'blue-large',
      pitchRate: 0.55, speedRate: 0.85, doubleMix: 0, brightness: 35,
      ttsPitch: 0.55, ttsRate: 0.85, replyGapMs: Object.freeze([480, 900])
    })
  });

  function getPetPresentation(petId) {
    return PET_PRESENTATIONS[petId] || null;
  }

  return Object.freeze({ PET_PRESENTATIONS, getPetPresentation });
}));
