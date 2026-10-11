/* 話者別ブラウザ発話の共通入口。録音・保存・外部送信は扱わない。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./pet-presentations.js'));
  else root.LittleCompanionPetSpeech = factory(root.LittleCompanionPetPresentations);
}(typeof self !== 'undefined' ? self : this, function (Presentations) {
  'use strict';
  const presentationFor = petId => Presentations && Presentations.getPetPresentation ? Presentations.getPetPresentation(petId) : null;
  function createPetUtterance(text, petId, getVoice) {
    const presentation = presentationFor(petId) || presentationFor('pet-1') || {};
    const utterance = new SpeechSynthesisUtterance(String(text || ''));
    utterance.lang = 'ja-JP';
    utterance.volume = 1;
    utterance.pitch = Number(presentation.ttsPitch) || 2;
    utterance.rate = Number(presentation.ttsRate) || 1.11;
    const voice = typeof getVoice === 'function' ? getVoice() : null;
    if (voice) utterance.voice = voice;
    return utterance;
  }
  function speakPetText(options) {
    const item = options || {};
    const synth = item.synth;
    if (!synth || !item.text) return false;
    try {
      const utterance = createPetUtterance(item.text, item.petId, item.getVoice);
      if (typeof item.onstart === 'function') utterance.onstart = item.onstart;
      if (typeof item.onend === 'function') utterance.onend = item.onend;
      if (typeof item.onerror === 'function') utterance.onerror = item.onerror;
      synth.speak(utterance);
      return true;
    } catch (_) {
      if (typeof item.onerror === 'function') item.onerror();
      return false;
    }
  }
  return Object.freeze({ createPetUtterance, speakPetText });
}));
