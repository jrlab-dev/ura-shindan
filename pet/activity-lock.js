/* 言葉学習・2匹イベント・音声処理を1つずつ動かす活動ロック。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LittleCompanionActivityLock = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const OWNERS = ['conversation','story','mini-game','echo','voice-recording','voice-processing','modal','companion-scene','two-pet-event','deleting'];
  const HARD_BLOCKS = ['safety','hidden','quiet'];

  function ActivityLock() {
    this.owner = null;
    this.generation = 0;
    this.serial = 0;
    this.hardBlocks = new Set();
  }

  ActivityLock.prototype.tryAcquire = function (owner, context = {}) {
    if (!OWNERS.includes(owner) || this.owner || this.hardBlocks.size || context.blocked === true) return null;
    const token = Object.freeze({ owner, generation:this.generation, serial:++this.serial });
    this.owner = token;
    return token;
  };

  ActivityLock.prototype.release = function (token) {
    if (!token || !this.owner || token.owner !== this.owner.owner || token.serial !== this.owner.serial || token.generation !== this.owner.generation || token.generation !== this.generation) return false;
    this.owner = null;
    return true;
  };

  ActivityLock.prototype.isCurrent = function (token) {
    return Boolean(token && this.owner && token.owner === this.owner.owner && token.serial === this.owner.serial && token.generation === this.generation && !this.hardBlocks.size);
  };

  ActivityLock.prototype.isBlocked = function (owner = '') {
    if (this.hardBlocks.size) return true;
    if (!this.owner) return false;
    return !owner || this.owner.owner !== owner;
  };

  ActivityLock.prototype.cancelAll = function (reason = 'cancelled') {
    const previous = this.owner;
    this.owner = null;
    this.generation += 1;
    return { reason, previousOwner:previous && previous.owner || '', generation:this.generation };
  };

  ActivityLock.prototype.activateHardBlock = function (kind) {
    if (!HARD_BLOCKS.includes(kind)) return false;
    this.hardBlocks.add(kind);
    this.cancelAll(kind);
    return true;
  };

  ActivityLock.prototype.clearHardBlock = function (kind) {
    if (!HARD_BLOCKS.includes(kind)) return false;
    return this.hardBlocks.delete(kind);
  };

  ActivityLock.prototype.snapshot = function () {
    return { owner:this.owner && this.owner.owner || '', generation:this.generation, hardBlocks:[...this.hardBlocks].sort() };
  };

  return { OWNERS, HARD_BLOCKS, ActivityLock };
}));
