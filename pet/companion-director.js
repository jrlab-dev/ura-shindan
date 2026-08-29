/* 最初の15分の小さな誘い・成功・思い出しを、保存せずに調整する。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../app/companion-scenes.js'));
  else root.LittleCompanionDirector = factory(root.LittleCompanionScenes);
}(typeof self !== 'undefined' ? self : this, function (Scenes) {
  'use strict';

  const SCENES = Scenes && Array.isArray(Scenes.SCENES) ? Scenes.SCENES : [];
  const MAX_INVITES = 10;
  const SECOND = 1000;
  const MINUTE = 60 * SECOND;
  let tokenSerial = 0;

  function timeValue(value, fallback) {
    if (value instanceof Date) return value.getTime();
    const number = Number(value);
    if (Number.isFinite(number)) return number;
    const parsed = typeof value === 'string' ? Date.parse(value) : NaN;
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function seededRandom(seed) {
    let value = (Number(seed) || 0x6d2b79f5) >>> 0;
    return function () {
      value = (value + 0x6d2b79f5) >>> 0;
      let result = value;
      result = Math.imul(result ^ (result >>> 15), result | 1);
      result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
      return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
    };
  }

  function randomSource(options) {
    if (options && typeof options.rng === 'function') return options.rng;
    return seededRandom(options && options.seed);
  }

  function randomUnit(session) {
    const value = Number(session && session._rng ? session._rng() : 0.5);
    if (!Number.isFinite(value)) return 0.5;
    return Math.max(0, Math.min(0.999999999, value));
  }

  function randomInt(session, minimum, maximum) {
    return minimum + Math.floor(randomUnit(session) * (maximum - minimum + 1));
  }

  function newToken(now) {
    tokenSerial += 1;
    return `director-${now}-${tokenSerial}`;
  }

  function createSession(options) {
    const settings = options || {};
    const now = timeValue(settings.now, Date.now());
    const session = {
      startedAt: now,
      actionCount: 0,
      phase: 'warmup',
      nextInviteAt: now,
      nextInviteActionCount: 1,
      usedSceneIds: [],
      completedSceneIds: [],
      activeScene: null,
      callbacks: [],
      inviteCount: 0,
      token: newToken(now),
      _rng: randomSource(settings)
    };
    session.nextInviteAt = now + randomInt(session, 10, 18) * SECOND;
    return session;
  }

  function phaseFor(session, now) {
    if (!session) return 'warmup';
    const current = timeValue(now, Date.now());
    const elapsed = Math.max(0, current - timeValue(session.startedAt, current));
    const actions = Math.max(0, Number(session.actionCount) || 0);
    if (elapsed >= 12 * MINUTE || actions >= 15) return 'settle';
    if (elapsed >= 7 * MINUTE || actions >= 9) return 'remember';
    if (elapsed >= 2 * MINUTE || actions >= 3) return 'play';
    return 'warmup';
  }

  function isBlocked(context) {
    return Boolean(context && context.blocked);
  }

  function rawLearnedWord(context) {
    const value = context && context.learnedWord;
    if (value && typeof value === 'object') return value.word || value.value || '';
    return value || '';
  }

  function safeWord(context) {
    const raw = String(rawLearnedWord(context)).normalize('NFKC').trim();
    if (/[<>\u0000-\u001f\u007f]/.test(raw)) return '';
    const compact = raw.replace(/[\s\u0000-\u001f\u007f<>「」『』【】（）()。！？!?、,]/g, '');
    if (!compact || compact.length > 12) return '';
    if (!/^[\p{L}\p{N}ー々]+$/u.test(compact)) return '';
    if (/(?:\d{2,4}[-\s]?\d{2,4}[-\s]?\d{3,4}|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|https?:\/\/|住所|電話|学校|メール|顔写真|実名|死にたい|自殺|消えたい|けが|怪我|薬を|火事|地震|連れ去|いじめ|殴る|裸|性的|エッチ|いやなさわり)/i.test(raw)) return '';
    return compact;
  }

  function phaseMatches(scene, phase) {
    const value = scene && scene.phase;
    if (Array.isArray(value)) return value.includes(phase) || value.includes('any');
    return value === phase || value === 'any' || value === 'all';
  }

  function eligibleScenes(session, context, phase) {
    const used = new Set(session.usedSceneIds || []);
    const word = safeWord(context);
    const eligible = SCENES.filter(scene => scene && scene.id && !used.has(scene.id))
      .filter(scene => phaseMatches(scene, phase))
      .filter(scene => !scene.requiresEcho || Boolean(context && context.echoEnabled))
      .filter(scene => !scene.requiresLearnedWord || Boolean(word));
    if (eligible.length || phase !== 'warmup') return eligible;
    return SCENES.filter(scene => scene && scene.id && !used.has(scene.id))
      .filter(scene => phaseMatches(scene, 'play'))
      .filter(scene => !scene.requiresEcho || Boolean(context && context.echoEnabled))
      .filter(scene => !scene.requiresLearnedWord || Boolean(word));
  }

  function eventFor(type, scene, text) {
    return {
      type,
      sceneId: scene.id,
      text: text == null ? '' : text,
      sound: scene.sound || null,
      state: scene.state || null,
      expectedAction: scene.expectedAction || null
    };
  }

  function fillWord(text, word) {
    return String(text || '').replace(/\{\{word\}\}/g, word || '');
  }

  function canInvite(session, context) {
    if (!session || isBlocked(context)) return false;
    const now = timeValue(context && context.now, Date.now());
    const phase = phaseFor(session, now);
    if (session.actionCount < 1) return false;
    if (session.activeScene || (session.callbacks && session.callbacks.length)) return false;
    if ((Number(session.inviteCount) || 0) >= MAX_INVITES) return false;
    if (now < session.nextInviteAt && session.actionCount < session.nextInviteActionCount) return false;
    return eligibleScenes(session, context, phase).length > 0;
  }

  function scheduleNextInvite(session, now, phase) {
    const quiet = phase === 'settle' || now - session.startedAt >= 15 * MINUTE;
    let actionGap;
    let timeGap;
    if (quiet) {
      actionGap = randomInt(session, 3, 5);
      timeGap = randomInt(session, 60, 90) * SECOND;
    } else if (phase === 'remember') {
      actionGap = randomInt(session, 2, 3);
      timeGap = randomInt(session, 35, 55) * SECOND;
    } else {
      actionGap = randomInt(session, 1, 2);
      timeGap = randomInt(session, 20, 35) * SECOND;
    }
    session.nextInviteActionCount = session.actionCount + actionGap;
    session.nextInviteAt = now + timeGap;
  }

  function invite(session, context) {
    if (!canInvite(session, context)) return null;
    const now = timeValue(context && context.now, Date.now());
    const phase = phaseFor(session, now);
    const candidates = eligibleScenes(session, context, phase);
    const scene = candidates[Math.floor(randomUnit(session) * candidates.length)];
    const word = safeWord(context);
    const duration = randomInt(session, 20, 30) * SECOND;
    session.phase = phase;
    session.activeScene = {
      id: scene.id,
      expectedAction: scene.expectedAction,
      prompt: fillWord(scene.prompt, word),
      success: fillWord(scene.success, word),
      callback: fillWord(scene.callback, word),
      sound: scene.sound || null,
      state: scene.state || null,
      invitedAt: now,
      expiresAt: now + duration,
      token: session.token
    };
    session.usedSceneIds.push(scene.id);
    session.inviteCount += 1;
    scheduleNextInvite(session, now, phase);
    return { handled: false, events: [eventFor('invite', session.activeScene, session.activeScene.prompt)] };
  }

  function expire(session, context) {
    if (!session || !session.activeScene || isBlocked(context)) return null;
    const now = timeValue(context && context.now, Date.now());
    if (now < session.activeScene.expiresAt) return null;
    const scene = session.activeScene;
    session.activeScene = null;
    return { handled: false, events: [eventFor('expired', scene, '')] };
  }

  function dueCallbacks(session) {
    const due = [];
    const waiting = [];
    (session.callbacks || []).forEach(item => {
      if (item.token === session.token && !item.fired && session.actionCount >= item.dueActionCount) {
        item.fired = true;
        due.push(eventFor('callback', item, item.callback));
      } else if (item.token === session.token && !item.fired) {
        waiting.push(item);
      }
    });
    session.callbacks = waiting;
    return due;
  }

  function noteAction(session, action, context) {
    if (!session || isBlocked(context)) return null;
    const now = timeValue(context && context.now, Date.now());
    const events = [];
    let handled = false;
    const expired = expire(session, { now, blocked: false });
    if (expired) events.push.apply(events, expired.events);

    session.actionCount = Math.max(0, Number(session.actionCount) || 0) + 1;
    session.phase = phaseFor(session, now);

    const active = session.activeScene;
    if (active && active.token === session.token && action === active.expectedAction) {
      session.activeScene = null;
      if (!session.completedSceneIds.includes(active.id)) session.completedSceneIds.push(active.id);
      session.callbacks.push({
        id: active.id,
        expectedAction: active.expectedAction,
        callback: active.callback,
        sound: active.sound,
        state: active.state,
        dueActionCount: session.actionCount + randomInt(session, 1, 2),
        fired: false,
        token: session.token
      });
      events.push(eventFor('success', active, active.success));
      handled = true;
    }

    events.push.apply(events, dueCallbacks(session));
    return events.length ? { handled, events } : null;
  }

  function reset(session, options) {
    if (session) {
      session.token = `${session.token || 'director'}-stale-${++tokenSerial}`;
      session.activeScene = null;
      session.callbacks = [];
    }
    return createSession(options || {});
  }

  return { createSession, phaseFor, isBlocked, canInvite, invite, noteAction, expire, reset };
}));
