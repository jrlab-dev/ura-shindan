(() => {
  'use strict';

  const STORAGE_KEY = 'little-companion-v1';
  const Brain = window.LittleCompanionBrain;
  const Life = window.LittleCompanionLife;
  const Story = window.LittleCompanionStory;
  const Week = window.LittleCompanionWeek;
  const VoiceMemory = window.LittleCompanionVoiceMemory;
  const CompanionScenes = window.LittleCompanionScenes;
  const CompanionDirector = window.LittleCompanionDirector;
  const ActivityLock = window.LittleCompanionActivityLock;
  const TwoPetScenes = window.LittleCompanionTwoPetScenes;
  const TwoPetDirector = window.LittleCompanionTwoPetDirector;
  const SpeechArbiter = window.LittleCompanionSpeechArbiter;
  const Trouble = window.LittleCompanionTrouble;
  const Ritual = window.LittleCompanionRitual;
  const Sulk = window.LittleCompanionSulk;
  /* 儀式エンジンがあるときだけ、舞台判定（主役・起きている子・全員ねんね）に「寝かしつけで早く眠った子」を反映する */
  if (Ritual && Life && typeof Life.getStageState === 'function') {
    const rawGetStageState = Life.getStageState.bind(Life);
    Life.getStageState = function (data, profileId, value) {
      const stage = rawGetStageState(data, profileId, value);
      const at = value instanceof Date ? value : new Date(value || Date.now());
      const awakePetIds = (stage.awakePetIds || []).filter(id => !petAsleep(id, at));
      if (awakePetIds.length === (stage.awakePetIds || []).length) return stage;
      return { activePetId: awakePetIds.includes(stage.activePetId) ? stage.activePetId : awakePetIds[0] || stage.activePetId, awakePetIds, allAsleep: awakePetIds.length === 0, pairAvailable: stage.pairAvailable };
    };
  }
  const PetPresentations = window.LittleCompanionPetPresentations;
  const PetSpeech = window.LittleCompanionPetSpeech;
  const PET_PRESENTATIONS = PetPresentations && PetPresentations.PET_PRESENTATIONS || {};
  const DEFAULTS = Life.createDefaultState(new Date());
  const $ = id => document.getElementById(id);
  const pet = $('pet');
  const state = { data: null, recognition: null, recognizing: false, recognitionHadResult:false, cameraStream: null, replyTimer: null, spontaneousTimer: null, monologueTimer: null, initialPromptTimer: null, directorTimer: null, director: null, storyRecallTimer: null, weekTimer:null, storyDraft:null, seedGlowId:'', voice:null, voiceCount:0, voiceTarget:null, tuningBlob:null, tuningToken:0, echoBlob:null, echoToken:0, echoRecording:false, echoSession:null, echoInviteTimer:null, echoEndTimer:null, echoIdleTimer:null, echoResumeTimer:null, echoNoInviteUntil:0, manualInterruptToken:0, companionSession:null, companionTimer:null, companionToken:0, twoPetSession:null, twoPetProfileId:'', twoPetInviteTimer:null, twoPetSceneTimer:null, twoPetStepTimers:[], twoPetToken:0, activityLock:ActivityLock && ActivityLock.ActivityLock ? new ActivityLock.ActivityLock() : null, speechArbiter:SpeechArbiter && SpeechArbiter.SpeechArbiter ? new SpeechArbiter.SpeechArbiter() : null, lastSpontaneousAt: 0, spontaneousDate:'', spontaneousSeen:[], lastInteractionAt: Date.now(), game: null, audioContext: null, audioNodes: [], audioTimer: null, speechWatchdog: null, lookDirectionTimer: null, yawnTimers:{'pet-1':null,'pet-2':null}, rollTimers:{'pet-1':null,'pet-2':null}, puniWanderTimer: null, troubleTimer: null, troubleToken: 0, troubleNextAt: 0, troubleRemindTimer: null, troubleRemindToken: 0, troubleHiccupTaps: 0, ritualYawnTimer: null, ritualMealBusy: false, ritualMealToken: 0, sulkHalfTimer: null, sulkResumeTimer: null, sulkResumeAt: 0, sulkPlayingSeen: false };
  const session = { lastIntent:'', lastTopic:'', userMood:'okay', turnCount:0 };
  const speechAvailable = 'speechSynthesis' in window;
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let speechVoices = [];
  const clean = value => String(value || '').replace(/[<>]/g, '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 50);
  const clamp = value => Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  const safeForStorage = value => /(?:\d{2,4}[-\s]?\d{2,4}[-\s]?\d{3,4}|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|(?:東京都|北海道|(?:大阪|京都)府|.{2,3}県).{1,20}(?:市|区|町|村)|住所|電話番号|電話|学校名|学校)/i.test(value);
  const nameForStorage = (value, fallback) => { const normalized = clean(value).slice(0, 12); return safeForStorage(normalized) || (Brain && Brain.detectSafety && Brain.detectSafety(normalized)) ? { value: fallback, personal: true } : { value: normalized || fallback, personal: false }; };

  function readData() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? Life.migrateState(raw, new Date()) : null;
    } catch (_) { return null; }
  }
  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data)); return true; } catch (_) { return false; }
  }
  function applyElapsed() {
    if (!state.data) return;
    const last = Date.parse(state.data.lastSeenAt || '');
    if (!Number.isFinite(last)) return;
    const days = Math.min(1, Math.max(0, (Date.now() - last) / 86400000));
    if (days > 0) { state.data.energy = clamp(state.data.energy - 5 * days); state.data.mood = clamp(state.data.mood - 2 * days); Life.decayAttention(state.data, Date.now() - last); }
  }
  function setSeen() { state.data.lastSeenAt = new Date().toISOString(); save(); }
  function visualPetId() { return state.echoSession && state.echoSession.imitatorPetId || activePetId(); }
  function setState(next, duration = 1800) {
    if (state.echoSession && !String(next).startsWith('copy-')) return;
    clearTimeout(state.replyTimer);
    const visualPet = petNode(visualPetId()) || pet;
    visualPet.dataset.state = next;
    refreshSulkVisual();
    if (next === 'sleepy') $('status-pill').textContent = 'すやすや';
    else if (next === 'listening') $('status-pill').textContent = 'きいてるよ';
    else if (next === 'thinking') $('status-pill').textContent = 'んーっと';
    else if (next === 'talking') $('status-pill').textContent = 'おはなし中';
    else if (next === 'copy-invite') $('status-pill').textContent = 'まねっこしたい';
    else if (next === 'copy-ready') $('status-pill').textContent = 'はなしてね';
    else if (next === 'copy-calibrating') $('status-pill').textContent = 'じゅんび中';
    else if (next === 'copy-live') $('status-pill').textContent = 'きいてるよ';
    else if (next === 'copy-satisfied') $('status-pill').textContent = 'まんぞく';
    else if (next === 'copy-listening') $('status-pill').textContent = 'きいてるよ';
    else if (next === 'copy-thinking') $('status-pill').textContent = 'んーっと';
    else if (next === 'copy-speaking') $('status-pill').textContent = 'まねっこ中';
    else if (next === 'copy-happy') $('status-pill').textContent = 'できた';
    else { const sleepingNow = petAsleep(visualPetId(), new Date()); $('status-pill').textContent = sleepingNow || state.data.energy < 30 ? 'すやすや' : 'げんきだよ'; }
    if (duration && !['listening', 'talking'].includes(next)) state.replyTimer = setTimeout(() => setState(state.data.energy < 30 ? 'sleepy' : 'normal', 0), duration);
  }
  function bubble(text) { if (state.echoSession && state.echoSession.imitatorPetId) { $('bubble').hidden = true; showPetBubble(state.echoSession.imitatorPetId, text); return; } $('bubble').hidden = false; $('bubble').textContent = text; }
  function activeProfileId() { return state.data && state.data.activeProfileId || 'p-default'; }
  /* 寝ている判定：時計で寝ている＋寝かしつけで早く眠ったぶん（儀式エンジン）を合わせる。
     getStageState の呼び出しは app.js の中でこっち向きにする（pet-life.js 自体は変えない） */
  function petAsleep(petId, now = new Date()) { return Boolean(Life && Life.isPetSleeping && Life.isPetSleeping(petId, now)) || Boolean(Ritual && state.data && Ritual.isTuckedAsleep && Ritual.isTuckedAsleep(state.data, petId, now)); }
  function ritualAwakePetIds(now = new Date()) { return ['pet-1','pet-2'].filter(id => !petAsleep(id, now)); }
  function stageAwakePetIds(now = new Date()) { if (!state.data || !Life || !Life.getStageState) return []; return Life.getStageState(state.data, activeProfileId(), now).awakePetIds || []; }
  function activePetId() { if (Life && Life.getStageState) return Life.getStageState(state.data, activeProfileId(), new Date()).activePetId; return Life && Life.getActivePetId ? Life.getActivePetId(state.data, activeProfileId()) : 'pet-1'; } function stageAsleep() { if (!state.data || !Life || !Life.getStageState) return false; return Life.getStageState(state.data, activeProfileId(), new Date()).allAsleep === true; } function petSleepingNow(id) { return petAsleep(id); }
  function pairRelation() { return Life && Life.getPairRelation ? Life.getPairRelation(state.data, activeProfileId()) : null; }
  function petInfo(id) { return (state.data && state.data.pets || []).find(item => item.id === id) || { id, name:id === 'pet-2' ? 'ふわ' : 'ぽこ' }; }
  function petNode(id) { return id === 'pet-2' ? $('pet-2') : $('pet'); }
  function setPetState(id, next) { const node = petNode(id); const forced = petSleepingNow(id) ? 'sleepy' : (next || 'normal'); if (node) node.dataset.state = forced; refreshSulkVisual(); const value = Life && Life.getProfilePetState ? Life.getProfilePetState(state.data, activeProfileId(), id) : null; if (value) value.lastExpression = forced; }
  function clearPetBubbles() { ['pet-1','pet-2'].forEach(id => { const node = $(`${id}-bubble`); if (node) { node.hidden = true; node.textContent = ''; } }); }
  function showPetBubble(id, text) { clearPetBubbles(); if (petSleepingNow(id)) return; const node = $(`${id}-bubble`); if (node && text) { node.textContent = text; node.hidden = false; } }
  function twoPetCandidate() { const relation = pairRelation(); if (!relation || relation.phase === 'cohabiting' || relation.phase === 'visiting') return Boolean(relation && relation.phase !== 'solo'); const words = (state.data && state.data.learnedWords || []).filter(item => (item.profileId || 'p-default') === activeProfileId()); return words.length > 0 || (Number(relation.soloCareCount) >= 6 && Array.isArray(relation.soloCareKinds) && relation.soloCareKinds.length >= 2); }
  function twoPetIntroductionPending() { const relation = pairRelation(); return Boolean(relation && relation.phase !== 'cohabiting' && twoPetCandidate()); }
  function twoPetActive() { return Boolean(state.twoPetSession && state.twoPetSession.activeScene); }
  function twoPetReplacesCompanion() { const relation = pairRelation(); return twoPetActive() || Boolean(relation && (relation.phase === 'visiting' || relation.phase === 'cohabiting' || twoPetCandidate())); }
  function twoPetLearnedWord() { return (state.data && state.data.learnedWords || []).slice().reverse().find(item => (item.profileId || 'p-default') === activeProfileId())?.word || ''; }
  function twoPetToy() { const relation = pairRelation(); const toys = relation && relation.sharedToys || []; return toys.length ? toys[toys.length - 1].toyId : ''; }
  function twoPetHardBlocked() { const modal = Boolean(($('setup-dialog') && $('setup-dialog').open) || ($('parent-dialog') && $('parent-dialog').open) || !$('forget-confirm-box').hidden || !$('voice-clear-confirm-box').hidden); return !state.data || document.hidden || Life.isQuietTime(new Date()) || Life.isSafetyPaused(state.data) || modal; }
  function twoPetBlocked() { return twoPetHardBlocked() || state.game || state.recognizing || state.director || Boolean(state.echoSession) || Boolean(state.tuningBlob) || Boolean(state.voice && (state.voice.pendingRecording || state.voice.permissionInFlight || state.voice.recording)) || Boolean(speechAvailable && window.speechSynthesis.speaking) || Boolean(state.audioNodes.length) || companionActive() || Boolean(Story && Story.isActive(state.data) && state.data.bondStory && state.data.bondStory.beat !== 'idle') || Boolean(state.activityLock && state.activityLock.isBlocked('two-pet-event')); }
  function recentTwoPetEvents(relation, now = Date.now()) { return (relation && relation.sharedEvents || []).filter(item => { const at = Date.parse(item && item.at || ''); return Number.isFinite(at) && now - at >= 0 && now - at < 15 * 60 * 1000; }); }
  function ensureTwoPetSession() {
    if (!TwoPetDirector || !TwoPetDirector.createSession || !state.data) return null;
    const profileId = activeProfileId(); const relation = pairRelation(); const recent = recentTwoPetEvents(relation);
    const rollingWindowExpired = state.twoPetSession && state.twoPetProfileId === profileId && state.twoPetSession.inviteCount >= 5 && recent.length < 5 && !state.twoPetSession.activeScene;
    if (state.twoPetSession && state.twoPetProfileId === profileId && !rollingWindowExpired) return state.twoPetSession;
    const session = TwoPetDirector.createSession({ now:Date.now(), scenes:TwoPetScenes && TwoPetScenes.SCENES });
    session.usedSceneIds = [...new Set(relation && relation.recentSceneIds || [])];
    session.inviteCount = Math.min(5, recent.length);
    const lastAt = recent.reduce((latest, item) => Math.max(latest, Date.parse(item.at) || 0), 0);
    if (lastAt) session.nextInviteAt = Math.max(session.nextInviteAt, lastAt + 90 * 1000);
    state.twoPetSession = session; state.twoPetProfileId = profileId;
    return session;
  }
  function renderTwoPets() { if (!state.data) return; const relation = pairRelation(); const pets = state.data.pets || []; const active = visualPetId(); const guestSleeping = petAsleep('pet-2', new Date()) && active !== 'pet-2'; const stageNow = Life && Life.getStageState ? Life.getStageState(state.data, activeProfileId(), new Date()) : null; const showSecond = Boolean(relation && relation.phase === 'cohabiting') || Boolean(state.twoPetGuestVisible) || active === 'pet-2' || guestSleeping || (stageNow && stageNow.pairAvailable); ['pet-1','pet-2'].forEach(id => { const info = pets.find(item => item.id === id) || petInfo(id); const value = Life && Life.getProfilePetState ? Life.getProfilePetState(state.data, activeProfileId(), id) : null; const label = $(`${id}-name`); if (label) label.textContent = info.name; const node = petNode(id); const slot = node && node.closest('.pet-slot'); const isActive = id === active; const isSleeping = petAsleep(id, new Date()); if (slot) { slot.classList.toggle('is-active-pet', isActive); /* 奥行きは「寝ている＞起きている主役＞起きている見守り」の順（設計書「誰がどの段に入るか」）。寝ている子は主役でも奥 */ slot.dataset.depth = isSleeping ? 'far' : isActive ? 'near' : 'mid'; /* 奥の子ほど中央へ寄せる（far 22px・mid 10px・near 0px）。主役は order:-1 で必ず左＝＋、右席は−。pet-2-slot が隠れている（1体だけ）ときは寄せない */ const depthShift = isSleeping ? 44 : isActive ? 0 : 24; slot.style.setProperty('--depth-shift', !showSecond || depthShift === 0 ? '0px' : `${isActive ? '' : '-'}${depthShift}px`); if (isSleeping) slot.dataset.asleep = 'true'; else delete slot.dataset.asleep; } if (node) { const presentation=twoPetPresentation(id); node.dataset.presentation=presentation.visual||''; node.dataset.active = String(isActive); node.setAttribute('aria-label', value ? `${info.name}。気分${value.mood}、体力${value.energy}、表情${value.lastExpression}${isActive ? '、いま遊ぶ主役' : '、見守り中'}` : `${info.name}がこちらを見ている`); const isActiveInSession = state.echoSession && (state.echoSession.imitatorPetId === id || id === active); const isCopyState = String(node.dataset.state || '').indexOf('copy-') === 0; if (isSleeping) { node.dataset.state = 'sleepy'; const sleepBubble = $(`${id}-bubble`); if (sleepBubble) { sleepBubble.hidden = true; sleepBubble.textContent = ''; } } else if (!isActiveInSession && !isCopyState && node.dataset.state === 'sleepy') node.dataset.state = 'normal'; } }); $('pet-2-slot').hidden = !showSecond; const allAsleep = stageNow && stageNow.allAsleep; const status = $('two-pet-status'); if (status) { status.hidden = !showSecond; const friendshipStage = relation && relation.friendshipStage || 'together'; const friendshipLabel = friendshipStage === 'not-met' ? 'まだ あってない' : friendshipStage === 'visiting' ? 'あそびにきた' : friendshipStage === 'familiar' ? 'なかよし' : 'ずっといっしょ'; status.textContent = allAsleep ? 'ふたりとも ねんねしているよ' : guestSleeping ? `${petInfo('pet-2').name} は うしろで ねんねしているよ` : relation && relation.phase === 'cohabiting' ? `いまは ${petInfo(active).name} が主役・${friendshipLabel}` : active === 'pet-2' ? `${petInfo(active).name} が主役だよ` : 'ふわが あそびにきたよ'; } const note = $('welcome-note'); if (note) { if (typeof state.welcomeNoteDefault !== 'string') state.welcomeNoteDefault = note.textContent; note.hidden = Boolean(stageNow && stageNow.allAsleep); note.textContent = stageNow && stageNow.allAsleep ? (stageNow.pairAvailable ? 'ふたりとも ねてるよ' : `${petInfo('pet-1').name}は ねてるよ`) : (stageNow && stageNow.pairAvailable && stageNow.activePetId === 'pet-2') ? state.welcomeNoteDefault : state.welcomeNoteDefault; } if (stageNow && stageNow.allAsleep) { const mainBubble = $('bubble'); if (mainBubble) { mainBubble.hidden = true; mainBubble.textContent = ''; } } if ( $('puni')) $('puni').dataset.front = stageAsleep() ? 'true' : 'false'; refreshSulkVisual(); } function echoTuning(petId) { const presentation = twoPetPresentation(petId); const override = state.data && state.data.echoVoiceOverrides && state.data.echoVoiceOverrides[petId]; return override || { pitchRate:Number(presentation.pitchRate) || (petId === 'pet-2' ? .55 : 2.3), speedRate:Number(presentation.speedRate) || (petId === 'pet-2' ? .85 : 1.11), doubleMix:Number(presentation.doubleMix) || 0, brightness:Number(presentation.brightness) || (petId === 'pet-2' ? 35 : 70), timingMode:'preserve' }; }
  function canSwitchActivePet() { const relation = pairRelation(); return Boolean(state.data && relation && ['visiting','cohabiting'].includes(relation.phase) && !document.hidden && !Life.isSafetyPaused(state.data) && !state.echoRecording && !state.tuningBlob && !(state.voice && (state.voice.pendingRecording || state.voice.permissionInFlight || state.voice.recording || state.voice.playback)) && !state.audioNodes.length && !(speechAvailable && window.speechSynthesis.speaking)); }
  function switchActivePet(nextPetId, message = '') { const previous = activePetId(); if (!canSwitchActivePet() || !Life || !Life.setActivePetId || !Life.setActivePetId(state.data, nextPetId, activeProfileId())) return false; setPetState(previous, 'normal'); state.twoPetGuestVisible = pairRelation() && pairRelation().phase === 'visiting'; renderTwoPets(); const next = activePetId(); showPetBubble(next, message || `${petInfo(next).name} が こんどは主役だよ`); setPetState(next, 'listening'); window.setTimeout(() => { if (!state.echoSession) setPetState(next, 'normal'); }, 850); save(); return true; }
  function noteTwoPetCare(action) { const relation = pairRelation(); if (!relation || relation.phase !== 'solo') return; relation.soloCareCount = Math.max(0, Number(relation.soloCareCount) || 0) + 1; relation.soloCareKinds = [...new Set([...(relation.soloCareKinds || []), action])].filter(kind => ['tap','stroke','hold','play','sleep'].includes(kind)).slice(-5); if (action === 'play') relation.sharedToys = [{ toyId:'ball', petIds:['pet-1','pet-2'], firstAt:new Date().toISOString(), lastAt:new Date().toISOString(), playCount:1 }]; }
  function noteTwoPetAction(action) { const relation = pairRelation(); if (!relation) return; const session = ensureTwoPetSession(); if (session && TwoPetDirector && TwoPetDirector.noteAction && !twoPetActive()) TwoPetDirector.noteAction(session, action, { now:Date.now(), blocked:false }); scheduleTwoPetMoment(); }
  function cancelTwoPetMoment(reason = 'cancelled') { window.clearTimeout(state.twoPetInviteTimer); window.clearTimeout(state.twoPetSceneTimer); state.twoPetInviteTimer = null; state.twoPetSceneTimer = null; state.twoPetStepTimers.forEach(timer => window.clearTimeout(timer)); state.twoPetStepTimers = []; state.twoPetToken += 1; if (state.speechArbiter) state.speechArbiter.cancel(); clearPetBubbles(); ['pet-1','pet-2'].forEach(id => setPetState(id, 'normal')); if (speechAvailable) window.speechSynthesis.cancel(); stopPetAudio(); const deleting = state.activityLock && state.activityLock.snapshot().owner === 'deleting'; if (state.activityLock && !deleting) state.activityLock.cancelAll(reason); if (state.twoPetSession) state.twoPetSession.activeScene = null; state.twoPetGuestVisible = false; renderTwoPets(); }
  function twoPetPresentation(petId) { return PET_PRESENTATIONS[petId] || {}; }
  function randomInRange(range, fallback = 0) { const values=Array.isArray(range)?range:[]; const min=Number(values[0]), max=Number(values[1]); return Number.isFinite(min)&&Number.isFinite(max) ? Math.round(min + Math.random() * Math.max(0,max-min)) : fallback; }
  function playTwoPetNonverbal(petId, emotion = 'satisfied') {
    if (!state.data || state.data.soundMode === 'text') return 20;
    const sounds=TwoPetScenes&&TwoPetScenes.NONVERBAL_SOUNDS, profile=sounds&&sounds[petId]&&sounds[petId][emotion];
    if (!profile) { playPetSound('normal'); return 650; }
    const context=unlockAudio(); if(!context)return profile.durationMs;
    try {
      stopPetAudio(); const now=context.currentTime, frequencies=profile.frequencies, duration=Math.max(1,profile.durationMs), slice=duration/frequencies.length/1000;
      frequencies.forEach((frequency,index)=>{ const oscillator=context.createOscillator(), gain=context.createGain(), start=now+index*slice, stop=now+(index+1)*slice; oscillator.type=petId==='pet-1'?'triangle':'sine'; oscillator.frequency.value=frequency; gain.gain.setValueAtTime(.001,start); gain.gain.exponentialRampToValueAtTime(petId==='pet-1'?.11:.13,start+.012); gain.gain.exponentialRampToValueAtTime(.001,Math.max(start+.02,stop-.006)); oscillator.connect(gain); gain.connect(context.destination); oscillator.start(start); oscillator.stop(stop); state.audioNodes.push(oscillator); });
      state.audioTimer=window.setTimeout(stopPetAudio,duration+20); return duration;
    } catch(_){ stopPetAudio(); return profile.durationMs; }
  }
  function speakTwoPetStep(step, token) {
    if (!step || (!step.text && !step.sound) || !state.speechArbiter) return Promise.resolve(false);
    const presentation=twoPetPresentation(step.actorPetId), emotions=TwoPetScenes&&TwoPetScenes.NONVERBAL_EMOTIONS||[], emotion=emotions.includes(step.sound)?step.sound:'satisfied';
    const request={petId:step.actorPetId,text:step.text,sound:emotion,assetKey:step.assetKey||'',activityToken:token};
    const scheduleSpeech=typeof state.speechArbiter.speak==='function' ? state.speechArbiter.speak.bind(state.speechArbiter) : (item,run)=>state.speechArbiter.enqueue(item.petId,valid=>run(valid,item));
    return scheduleSpeech(request,(valid,item)=>new Promise(resolve=>{
      if(!valid()||token!==state.twoPetToken){resolve();return;}
      let finished=false, fallbackStarted=false; const done=()=>{if(finished)return;finished=true;if(valid()&&token===state.twoPetToken)setPetState(item.petId,'normal');resolve();};
      const fallback=()=>{if(fallbackStarted||!valid()||token!==state.twoPetToken){done();return;}fallbackStarted=true;const duration=playTwoPetNonverbal(item.petId,item.sound);window.setTimeout(done,duration+30);};
      if(state.data.soundMode==='text'){window.setTimeout(done,20);return;}
      if(!item.text||!speechAvailable||state.data.soundMode==='pet'){const duration=playTwoPetNonverbal(item.petId,item.sound);window.setTimeout(done,duration+30);return;}
      try {
        const timeout=window.setTimeout(()=>{window.speechSynthesis.cancel();fallback();},5000);
        if(!PetSpeech || !PetSpeech.speakPetText || !PetSpeech.speakPetText({petId:item.petId,text:item.text,synth:window.speechSynthesis,getVoice:preferredVoice,onend:()=>{window.clearTimeout(timeout);done();},onerror:()=>{window.clearTimeout(timeout);fallback();}})){window.clearTimeout(timeout);fallback();}
      } catch(_){fallback();}
    }));
  }
  function finishTwoPetScene(token, scene) { if (token !== state.twoPetToken || !state.twoPetSession || !scene) return; window.clearTimeout(state.twoPetSceneTimer); state.twoPetSceneTimer = null; const relation = pairRelation(); if (relation) { relation.recentSceneIds = [...new Set([...(relation.recentSceneIds || []), scene.id])].slice(-12); relation.lastEventAt = new Date().toISOString(); const word = scene.requiresWord ? (state.data.learnedWords || []).slice().reverse().find(item => (item.profileId || 'p-default') === activeProfileId()) : null; if (word && !(relation.sharedWords || []).some(item => item.wordId === word.id)) relation.sharedWords = [...(relation.sharedWords || []), { profileId:activeProfileId(), wordId:word.id, taughtByPetId:'pet-1', sharedWithPetId:'pet-2', sharedAt:new Date().toISOString(), lastUsedAt:new Date().toISOString() }].slice(-20); if (scene.requiresToy) { const toy = scene.toy || 'ball'; const old = (relation.sharedToys || []).find(item => item.toyId === toy); if (old) { old.lastAt = new Date().toISOString(); old.playCount = (Number(old.playCount) || 0) + 1; } else relation.sharedToys = [...(relation.sharedToys || []), {toyId:toy,petIds:['pet-1','pet-2'],firstAt:new Date().toISOString(),lastAt:new Date().toISOString(),playCount:1}].slice(-20); } relation.sharedEvents = [...(relation.sharedEvents || []), {id:`pair-${Date.now()}-${scene.id}`,sceneId:scene.id,petIds:['pet-1','pet-2'],wordId:word && word.id || '',toyId:scene.toy || '',at:new Date().toISOString()}].slice(-60); if (relation.phase === 'solo' || relation.phase === 'visiting') { relation.visitCount = Math.min(3, (Number(relation.visitCount) || 0) + 1); relation.phase = relation.visitCount >= 3 ? 'cohabiting' : 'visiting'; relation.friendshipStage = relation.visitCount >= 3 ? 'together' : relation.visitCount >= 2 ? 'familiar' : 'visiting'; if (relation.phase === 'cohabiting') relation.cohabitedAt = new Date().toISOString(); } }
    TwoPetDirector.expire(state.twoPetSession, {now:Date.now(),blocked:false}); if (state.activityLock) state.activityLock.cancelAll('two-pet-complete'); state.twoPetGuestVisible = Boolean(relation && relation.phase === 'visiting'); const nextPetId = Life && Life.advanceActivePetTurn ? Life.advanceActivePetTurn(state.data, activeProfileId()) : ''; clearPetBubbles(); ['pet-1','pet-2'].forEach(id => setPetState(id, 'normal')); if (nextPetId) switchActivePet(nextPetId); else bubble('…'); save(); updateScreen(); scheduleTwoPetMoment(); }
  function runTwoPetScene(scene, token) {
    if(!scene||token!==state.twoPetToken)return; $('bubble').textContent='…'; $('bubble').hidden=true; const startedAt=Date.now(), steps=(scene.steps||[]).slice().sort((a,b)=>Number(a.atMs)-Number(b.atMs)), spoken=steps.some(step=>step.text);
    const present=step=>{if(token!==state.twoPetToken||document.hidden)return false;const other=step.actorPetId==='pet-1'?'pet-2':'pet-1';setPetState(step.actorPetId,step.actorState||'watching');setPetState(other,step.observerState||'ear-react');if(step.text)showPetBubble(step.actorPetId,step.text);else clearPetBubbles();return true;};
    if(!spoken){
      steps.forEach(step=>{const timer=window.setTimeout(()=>{present(step);},Math.max(0,Number(step.atMs)||0));state.twoPetStepTimers.push(timer);});
      state.twoPetSceneTimer=window.setTimeout(()=>finishTwoPetScene(token,scene),Math.max(5000,Number(scene.durationMs)||7000)); return;
    }
    (async()=>{
      for(let index=0;index<steps.length;index++){
        const step=steps[index], pause=index===0?randomInRange(step.startDelayMs,0):randomInRange(step.replyGapMs,0);
        if(index>0&&pause){const other=step.actorPetId==='pet-1'?'pet-2':'pet-1';setPetState(step.actorPetId,step.actorPetId==='pet-2'?'reply-wait-slow':'reply-wait-quick');setPetState(other,'watching');}
        if(pause)await new Promise(resolve=>window.setTimeout(resolve,pause));
        if(!present(step))return; await speakTwoPetStep(step,token); if(token!==state.twoPetToken)return;
      }
      const target=Math.max(5000,Math.min(15000,Number(scene.durationMs)||7000)),remaining=Math.max(0,target-(Date.now()-startedAt)); state.twoPetStepTimers=[];
      state.twoPetSceneTimer=window.setTimeout(()=>finishTwoPetScene(token,scene),remaining);
    })();
  }
  function retryTwoPetMoment(token, profileId, sessionToken) { if (twoPetHardBlocked()) return; state.twoPetInviteTimer = window.setTimeout(() => { if (token !== state.twoPetToken || activeProfileId() !== profileId || !state.twoPetSession || state.twoPetSession.token !== sessionToken) return; scheduleTwoPetMoment(); }, 3000); }
  function scheduleTwoPetMoment() { window.clearTimeout(state.twoPetInviteTimer); state.twoPetInviteTimer = null; if (stageAsleep()) return; if (state.activityLock && !Life.isSafetyPaused(state.data)) state.activityLock.clearHardBlock('safety'); const relation = pairRelation(); if (!relation || recentTwoPetEvents(relation).length >= 9 || !twoPetCandidate() || twoPetActive() || twoPetHardBlocked()) return; const session = ensureTwoPetSession(); if (!session) return; const profileId = activeProfileId(); const sessionToken = session.token; const delay = Math.max(1000, Number(session.nextInviteAt) - Date.now()); const token = ++state.twoPetToken; state.twoPetInviteTimer = window.setTimeout(() => { if (stageAsleep() || token !== state.twoPetToken || activeProfileId() !== profileId || !state.twoPetSession || state.twoPetSession.token !== sessionToken || recentTwoPetEvents(relation).length >= 9 || twoPetHardBlocked()) return; if (twoPetBlocked()) { retryTwoPetMoment(token, profileId, sessionToken); return; } const lockToken = state.activityLock ? state.activityLock.tryAcquire('two-pet-event') : {owner:'two-pet-event'}; if (!lockToken) { retryTwoPetMoment(token, profileId, sessionToken); return; } const event = TwoPetDirector.invite(session, {now:Date.now(),blocked:false,learnedWord:twoPetLearnedWord(),toy:twoPetToy()}); if (!event || !event.events || !event.events[0]) { if (state.activityLock) state.activityLock.release(lockToken); return; } const scene=event.events[0].scene; state.twoPetGuestVisible = relation.phase !== 'cohabiting'; cancelCompanionMoment(); renderTwoPets(); runTwoPetScene(scene, token); }, delay); }
  function companionLearnedWord() {
    if (!state.data || !Array.isArray(state.data.learnedWords)) return '';
    const profileId = state.data.activeProfileId || 'p-default';
    const word = state.data.learnedWords.slice().reverse().find(item => item && (item.profileId || 'p-default') === profileId && typeof item.word === 'string' && item.word && !safeForStorage(item.word) && !(Brain && Brain.detectSafety && Brain.detectSafety(item.word)));
    return word ? clean(word.word).slice(0, 20) : '';
  }
  function companionActive() { return Boolean(state.companionSession && state.companionSession.activeScene); }
  function companionExpects(action) { return Boolean(state.companionSession && state.companionSession.activeScene && state.companionSession.activeScene.expectedAction === action); }
  function companionBlocked(action = '') {
    const modalOpen = Boolean(($('setup-dialog') && $('setup-dialog').open) || ($('parent-dialog') && $('parent-dialog').open) || !$('forget-confirm-box').hidden || !$('voice-clear-confirm-box').hidden);
    const voiceBusy = Boolean(state.voice && (state.voice.pendingRecording || state.voice.permissionInFlight || state.voice.recording));
    const storyBusy = Boolean(Story && Story.isActive(state.data) && state.data.bondStory && state.data.bondStory.beat !== 'idle');
    const blocked = !state.data || document.hidden || state.data.soundMode === 'text' || Life.isQuietTime(new Date()) || Life.isSafetyPaused(state.data) || modalOpen || state.game || state.recognizing || state.director || storyBusy || voiceBusy || Boolean(state.tuningBlob) || Boolean(state.audioNodes.length) || Boolean(speechAvailable && window.speechSynthesis.speaking) || twoPetReplacesCompanion() || (action !== 'echo' && Boolean(state.echoSession));
    return CompanionDirector && typeof CompanionDirector.isBlocked === 'function' ? CompanionDirector.isBlocked({ blocked }) : blocked;
  }
  function companionContext(action = '') { return { now:Date.now(), blocked:companionBlocked(action), echoEnabled:Boolean(state.data && state.data.echoModeEnabled), learnedWord:companionLearnedWord() }; }
  function ensureCompanionSession() {
    if (!CompanionDirector || typeof CompanionDirector.createSession !== 'function' || state.companionSession) return state.companionSession;
    state.companionSession = CompanionDirector.createSession({ now:Date.now(), scenes:CompanionScenes && CompanionScenes.SCENES });
    return state.companionSession;
  }
  function companionSound(sound) { return ({ soft:'quiet', sparkle:'happy', echo:'curious' }[sound] || sound || 'normal'); }
  function companionVisual(stateName) { return ({ sleepy:'sleepy', calm:'normal', close:'happy', playful:'happy', proud:'happy', happy:'happy', thinking:'thinking', talking:'talking' }[stateName] || 'normal'); }
  function showCompanionEvent(event, options = {}) {
    if (!event) return;
    const moment = $('companion-moment');
    if (event.type === 'expired') { const oldPrompt = moment.textContent; moment.hidden = true; moment.textContent = ''; moment.dataset.sceneId = ''; if ($('bubble').textContent === oldPrompt) bubble('…'); return; }
    if (!event.text) return;
    moment.textContent = event.text; moment.hidden = false; moment.dataset.sceneId = event.sceneId || '';
    if (options.passive) return;
    bubble(event.text); setState(companionVisual(event.state), 0); playPetSound(companionSound(event.sound)); speak(event.text, companionSound(event.sound));
  }
  function showCompanionResult(result, options = {}) {
    if (!result || !Array.isArray(result.events)) return false;
    result.events.forEach(event => showCompanionEvent(event, options));
    return result.handled === true;
  }
  function cancelCompanionMoment(reset = true) {
    window.clearTimeout(state.companionTimer); state.companionTimer = null; state.companionToken += 1;
    const moment = $('companion-moment'); moment.hidden = true; moment.textContent = ''; moment.dataset.sceneId = '';
    if (reset && state.companionSession && CompanionDirector && typeof CompanionDirector.reset === 'function') state.companionSession = CompanionDirector.reset(state.companionSession, { now:Date.now(), scenes:CompanionScenes && CompanionScenes.SCENES });
  }
  function companionRetryAllowed() {
    const modalOpen = Boolean(($('setup-dialog') && $('setup-dialog').open) || ($('parent-dialog') && $('parent-dialog').open) || !$('forget-confirm-box').hidden || !$('voice-clear-confirm-box').hidden);
    return Boolean(state.data && !document.hidden && state.data.soundMode !== 'text' && !Life.isQuietTime(new Date()) && !Life.isSafetyPaused(state.data) && !modalOpen);
  }
  function retryCompanionMoment(token, sessionToken) {
    if (!companionRetryAllowed()) return;
    state.companionTimer = window.setTimeout(() => {
      if (token !== state.companionToken || !state.companionSession || sessionToken !== state.companionSession.token) return;
      scheduleCompanionMoment();
    }, 3000);
  }
  function scheduleCompanionMoment() {
    window.clearTimeout(state.companionTimer); state.companionTimer = null;
    if (stageAsleep()) return; const companion = ensureCompanionSession(); if (!companion) return;
    const token = ++state.companionToken; const sessionToken = companion.token;
    const nextInviteAt = Number(companion.nextInviteAt);
    const expiresAt = Number(companion.activeScene && companion.activeScene.expiresAt);
    if (companionActive()) {
      const delay = Number.isFinite(expiresAt) ? Math.max(1000, expiresAt - Date.now()) : 25000;
      state.companionTimer = window.setTimeout(() => {
        if (stageAsleep() || token !== state.companionToken || !state.companionSession || sessionToken !== state.companionSession.token) return;
        const expired = CompanionDirector.expire(state.companionSession, companionContext()); showCompanionResult(expired);
        scheduleCompanionMoment();
      }, delay);
      return;
    }
    if (companionBlocked()) { retryCompanionMoment(token, sessionToken); return; }
    const canInviteNow = !companionActive() && CompanionDirector.canInvite(companion, companionContext());
    const delay = canInviteNow ? 0 : (Number.isFinite(nextInviteAt) ? Math.max(1000, nextInviteAt - Date.now()) : 5000);
    state.companionTimer = window.setTimeout(() => {
      if (stageAsleep() || token !== state.companionToken || !state.companionSession || sessionToken !== state.companionSession.token) return;
      if (companionBlocked()) { retryCompanionMoment(token, sessionToken); return; }
      const context = companionContext();
      const expired = CompanionDirector.expire(state.companionSession, context); showCompanionResult(expired);
      if (!companionActive() && CompanionDirector.canInvite(state.companionSession, companionContext())) showCompanionResult(CompanionDirector.invite(state.companionSession, companionContext()));
      scheduleCompanionMoment();
    }, delay);
  }
  function companionAction(action) {
    const companion = ensureCompanionSession(); if (!companion || !CompanionDirector || typeof CompanionDirector.noteAction !== 'function') return false;
    const result = CompanionDirector.noteAction(companion, action, companionContext(action));
    const expressive = Boolean(result && Array.isArray(result.events) && result.events.some(event => event && (event.type === 'success' || event.type === 'callback')));
    const handled = showCompanionResult(result, { passive:!expressive || action === 'echo' });
    scheduleCompanionMoment();
    return action === 'echo' ? handled : (handled || expressive);
  }
  function updateScreen() {
    if (!state.data) return;
    if (Week) Week.ensure(state.data);
    $('pet-name-label').textContent = petInfo('pet-1').name || state.data.petName || 'ぽこ';
    $('pet').setAttribute('aria-label', `${state.data.petName || 'ぽこ'}がこちらを見ている`);
    const soundOn = state.data.soundMode !== 'text';
    $('sound-toggle').setAttribute('aria-pressed', String(soundOn));
    $('sound-toggle').setAttribute('aria-label', soundOn ? '音をオフにする' : '音をオンにする');
    $('sound-toggle').textContent = soundOn ? '🔊' : '🔇';
    $('speech-input-toggle').checked = state.data.speechInputEnabled;
    $('speech-output-toggle').checked = soundOn;
    $('sound-mode-select').value = state.data.soundMode;
    $('voice-memory-toggle').checked = state.data.voiceMemoryEnabled === true;
    $('echo-mode-toggle').checked = state.data.echoModeEnabled === true;
    const echoSession = state.echoSession;
    $('echo-button').hidden = state.data.echoModeEnabled !== true || Boolean(echoSession);
    $('echo-button').disabled = state.echoRecording === 'pending' || !soundOn;
    if (!state.echoRecording) $('echo-button').innerHTML = '<span aria-hidden="true">○</span>まねっこ';
    $('echo-session-panel').hidden = !echoSession;
    $('echo-controls').hidden = !echoSession;
    $('main-controls').hidden = Boolean(echoSession);
    if (echoSession) {
      const pressMode = echoSession.inputMode === 'press';
      $('echo-press-button').hidden = !pressMode;
      $('echo-live-status').hidden = pressMode;
      $('echo-stop-button').disabled = false;
      $('echo-session-panel').dataset.mode = pressMode ? 'press' : 'live';
      if (pressMode) {
        $('echo-press-button').disabled = state.echoRecording === 'pending' || state.echoRecording === 'speaking';
        $('echo-press-button').textContent = state.echoRecording === true ? 'ここで止める' : state.echoRecording === 'pending' ? 'マイクを待っています' : state.echoRecording === 'speaking' ? 'まねしてるよ' : '● はなす';
      }
      else { $('echo-live-status').dataset.phase = echoSession.phase; $('echo-live-status').textContent = state.echoRecording === 'speaking' ? '● まねしてる' : echoSession.phase === 'calibrating' ? 'マイク準備中・しずかに1秒まってね' : '● いま きいてるよ'; }
      const imitatorName = petInfo(echoSession.imitatorPetId).name;
      $('echo-session-message').textContent = echoSession.inputMode === 'press' ? (state.echoRecording === 'pending' ? `${imitatorName} がマイクを待ってるよ` : state.echoRecording === 'speaking' ? `${imitatorName} がまねしてるよ` : echoSession.liveFallback ? 'うまく聞こえないから「はなす」をおしてね' : echoSession.source === 'spontaneous' ? `${imitatorName} がおしたときだけ きくよ` : 'この端末では「はなす」をおしてね') : (echoSession.phase === 'calibrating' ? 'マイク準備中・しずかに1秒まってね' : state.echoRecording === 'speaking' ? `${imitatorName} がまねしてるよ` : `${imitatorName} がいま きいてるよ。はなしてね`);
    }
    $('voice-memory-status').textContent = `声の記憶 ${state.voiceCount}/20件`;
    const tuning = echoTuning(selectedTuningPetId()); const fastTuning = tuning.timingMode === 'fast'; $('tuning-pitch').value = String(Math.round(tuning.pitchRate * 100)); $('tuning-speed').value = String(Math.round((tuning.speedRate || 1) * 100)); $('tuning-double').value = String(Math.round(tuning.doubleMix * 100)); $('tuning-brightness').value = String(tuning.brightness); $('tuning-timing-mode').value = fastTuning ? 'fast' : 'preserve'; $('tuning-pitch-value').textContent = `${Math.round(tuning.pitchRate * 100)}%`; $('tuning-speed-value').textContent = `${Math.round((tuning.speedRate || 1) * 100)}%`; $('tuning-double-value').textContent = `${Math.round(tuning.doubleMix * 100)}%`; $('tuning-brightness-value').textContent = String(tuning.brightness); $('tuning-speed').disabled = fastTuning; $('tuning-timing-note').textContent = fastTuning ? '高さと速さが連動します。速さの調整はおすすめ方式で使えます' : '高さと速さを別々に変えます。ゆっくりでも高い声のままです'; $('tuning-controls').hidden = !state.tuningBlob; const tuningBusy = Boolean(state.voice && (state.voice.pendingRecording || state.voice.permissionInFlight || state.voice.recording)); $('tuning-record-button').disabled = state.data.voiceMemoryEnabled !== true || tuningBusy; if (!state.tuningBlob && !tuningBusy) { if (state.data.voiceMemoryEnabled !== true) $('tuning-status').textContent = '上の「教えた声をこのブラウザに覚える」をオンにしてください'; else if ($('tuning-status').textContent.startsWith('上の「教えた声')) $('tuning-status').textContent = '試験録音はこのページを離れると消えます'; }
    $('camera-toggle').checked = state.data.cameraEnabled;
    $('bond-value').textContent = state.data.bond;
    $('energy-value').textContent = state.data.energy;
    $('mood-value').textContent = state.data.mood;
    const memories = []; if (state.data.likes.length) memories.push(`好き：${state.data.likes.join('、')}`); if (state.data.dislikes.length) memories.push(`苦手：${state.data.dislikes.join('、')}`); $('memory-summary').textContent = memories.length ? memories.join('　') : 'まだないよ';
    const learned = Array.isArray(state.data.learnedWords) ? state.data.learnedWords.filter(item => (item.profileId || 'p-default') === (state.data.activeProfileId || 'p-default')) : []; $('learned-words').replaceChildren(); if (!learned.length) { const empty = document.createElement('p'); empty.className = 'memory-summary'; empty.textContent = 'まだないよ（0/20語）'; $('learned-words').appendChild(empty); } else learned.forEach(item => { const row = document.createElement('div'); row.className = 'learned-word-row'; const label = document.createElement('span'); label.textContent = `${item.word}（${Story.CATEGORY_LABELS[item.category] || 'そのほか'}・${item.confidence || 1}）`; const forget = document.createElement('button'); forget.type = 'button'; forget.dataset.forgetWord = item.id; forget.textContent = '忘れる'; forget.setAttribute('aria-label', `${item.word}を忘れる`); row.append(label, forget); $('learned-words').appendChild(row); });
    const seeds = learned.slice(-3).reverse(); $('word-seeds').replaceChildren(); seeds.forEach(item => { const seed = document.createElement('span'); seed.className = `word-seed${item.id === state.seedGlowId ? ' is-new' : ''}`; seed.textContent = `✦ ${item.word}`; $('word-seeds').appendChild(seed); });
    const profileMoments = Array.isArray(state.data.moments) ? state.data.moments.filter(item => (item.profileId || 'p-default') === (state.data.activeProfileId || 'p-default')) : []; const lastMoment = profileMoments.length ? profileMoments[profileMoments.length - 1] : null; const showMoment = lastMoment && lastMoment.at && Life.today(lastMoment.at) === Life.today(new Date()); $('today-memory').hidden = !showMoment; if (showMoment) $('today-memory').textContent = `今日の思い出：${lastMoment.text}`;
    $('bond-stage-label').textContent = Life.bondStageLabel(state.data.bondStage);
    $('daily-summary').textContent = `会話 ${state.data.daily.talk}・タッチ ${state.data.daily.touch}・遊び ${state.data.daily.play}`;
    $('trait-summary').textContent = Life.traitLabel(state.data.traits, state.data.careCount);
    const profiles = Array.isArray(state.data.profiles) ? state.data.profiles : []; const active = profiles.find(item => item.id === state.data.activeProfileId) || profiles[0];
    const profileSelect = $('profile-select'); profileSelect.replaceChildren(); profiles.forEach(profile => { const option = document.createElement('option'); option.value = profile.id; option.textContent = profile.name; option.selected = profile.id === state.data.activeProfileId; profileSelect.appendChild(option); });
    const profileList = $('profile-list'); profileList.replaceChildren(); profiles.forEach(profile => { const row = document.createElement('div'); row.className = 'profile-row'; const label = document.createElement('span'); label.textContent = `${profile.name}${profile.id === state.data.activeProfileId ? '（いまここ）' : ''}`; const actions = document.createElement('span'); const select = document.createElement('button'); select.type = 'button'; select.className = 'small-button'; select.textContent = '選ぶ'; select.dataset.profileSelect = profile.id; actions.appendChild(select); if (profile.id !== 'p-default') { const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'small-button'; remove.textContent = '消す'; remove.dataset.profileDelete = profile.id; actions.appendChild(remove); } row.append(label, actions); profileList.appendChild(row); });
    const target = state.voiceTarget; const targetStillExists = target && target.profileId === state.data.activeProfileId && learned.some(item => item.id === target.wordId); const showVoiceRecord = Boolean(state.data.voiceMemoryEnabled && targetStillExists && state.data.bondStory && state.data.bondStory.beat === 'seed' && !Life.isSafetyPaused(state.data)); $('voice-record-panel').hidden = !showVoiceRecord;
    if (Week && state.data.weekProgress) { const day = Week.DAY_THEMES[(state.data.weekProgress.dayIndex || 1) - 1] || Week.DAY_THEMES[0]; $('week-today').hidden = false; $('week-today').textContent = `きょうのテーマ：${day.title}（${state.data.weekProgress.dayIndex}/7）`; }
    pet.dataset.urge = state.data.urge || 'curious'; $('status-pill').dataset.urge = state.data.urge || 'curious'; { const sleepingNode = petNode(visualPetId()); if (sleepingNode && sleepingNode.dataset.state === 'sleepy') $('status-pill').textContent = 'すやすや'; } $('inner-state').textContent = ({ curious:'きょうみしんしん', playful:'あそびたい', quiet:'しずかにふわふわ', sleepy:'ねむねむ', proud:'えっへん' }[state.data.urge] || 'きょうみしんしん'); if (state.data.energy < 30 && !['listening', 'thinking', 'talking', 'copy-calibrating', 'copy-ready', 'copy-live', 'copy-listening', 'copy-thinking', 'copy-speaking', 'copy-happy'].includes(pet.dataset.state)) setState('sleepy', 0); renderTwoPets(); updateTroublePanel(); updateRitualPanel(); updateSulkPanel();
  }
  function refreshVoices() { if (speechAvailable) speechVoices = window.speechSynthesis.getVoices(); }
  function preferredVoice() {
    const japanese = speechVoices.filter(voice => /^ja/i.test(voice.lang));
    return japanese.find(voice => voice.localService) || japanese[0] || speechVoices.find(voice => voice.localService) || speechVoices[0] || null;
  }
  function setVoiceStatus(message) { $('voice-test-status').textContent = message; }
  function unlockAudio() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    try { if (!state.audioContext) state.audioContext = new AudioContextClass(); if (state.audioContext.state === 'suspended') state.audioContext.resume().catch(() => {}); return state.audioContext; } catch (_) { return null; }
  }
  function playTestChime() {
    const context = unlockAudio(); if (!context) return false;
    try { stopPetAudio(); const now = context.currentTime; [{ frequency:660, start:0, length:.12 }, { frequency:880, start:.14, length:.16 }].forEach(tone => { const oscillator = context.createOscillator(); const gain = context.createGain(); oscillator.type='sine'; oscillator.frequency.value=tone.frequency; gain.gain.setValueAtTime(0, now + tone.start); gain.gain.linearRampToValueAtTime(.16, now + tone.start + .015); gain.gain.exponentialRampToValueAtTime(.001, now + tone.start + tone.length); oscillator.connect(gain); gain.connect(context.destination); oscillator.start(now + tone.start); oscillator.stop(now + tone.start + tone.length); state.audioNodes.push(oscillator); }); state.audioTimer = window.setTimeout(stopPetAudio, 700); return true; } catch (_) { return false; }
  }
  function stopPetAudio() { window.clearTimeout(state.audioTimer); state.audioTimer = null; state.audioNodes.forEach(node => { try { node.stop(); } catch (_) {} try { node.disconnect(); } catch (_) {} }); state.audioNodes = []; }
  async function refreshVoiceCount() { state.voiceCount = state.voice ? Math.min(20, await state.voice.count(activeProfileId())) : 0; if (state.data) updateScreen(); }
  function acquireDeletionLock() {
    if (!state.activityLock) return { owner:'deleting' };
    let token = state.activityLock.tryAcquire('deleting');
    if (!token && !state.activityLock.snapshot().hardBlocks.length) { state.activityLock.cancelAll('delete-request'); token = state.activityLock.tryAcquire('deleting'); }
    return token;
  }
  async function stopDeletionActivities() {
    cancelTwoPetMoment('deleting'); cancelCompanionMoment(); cancelEcho(); discardTuningBlob();
    clearSpontaneous(); clearSpeechWatchdog(); window.clearTimeout(state.storyRecallTimer); state.storyRecallTimer = null; window.clearTimeout(state.weekTimer); state.weekTimer = null;
    if (state.recognizing) stopRecognition();
    if (state.director) { state.director = null; hideQuestion(); }
    if (speechAvailable) window.speechSynthesis.cancel(); stopPetAudio();
    if (state.voice) { state.voice.stopRecording(); state.voice.stopPlayback(); await state.voice.invalidate(); }
  }
  function wordReferenceCount(data, profileId, wordId, wordValue = '') {
    if (!data) return 1;
    const owns = item => item && (item.profileId || 'p-default') === profileId;
    let count = (data.learnedWords || []).filter(item => owns(item) && item.id === wordId).length;
    count += (data.factMemories || []).filter(item => owns(item) && (item.wordId === wordId || item.id === `word-${wordId}` || (wordValue && item.value === wordValue))).length;
    count += (data.callbackQueue || []).filter(item => owns(item) && (item.wordId === wordId || item.id === `word-${wordId}` || (wordValue && item.value === wordValue))).length;
    count += (data.moments || []).filter(item => owns(item) && (item.wordId === wordId || (wordValue && item.word === wordValue))).length;
    count += (data.wordMemoryV2 && data.wordMemoryV2.stories || []).filter(item => item && item.profileId === profileId && item.pendingWordId === wordId).length;
    if (data.activeProfileId === profileId && data.bondStory && data.bondStory.pendingWordId === wordId) count += 1;
    (data.pairRelations || []).filter(item => item.profileId === profileId).forEach(relation => { count += (relation.sharedWords || []).filter(item => item.wordId === wordId).length; count += (relation.sharedEvents || []).filter(item => item.wordId === wordId).length; });
    return count;
  }
  function profileReferenceCount(data, profileId) {
    if (!data) return 1;
    let count = (data.profiles || []).filter(item => item.id === profileId).length;
    ['factMemories','playMemories','callbackQueue','learnedWords','moments','profilePetStates','pairRelations'].forEach(key => { count += (data[key] || []).filter(item => item && (item.profileId || 'p-default') === profileId).length; });
    count += (data.wordMemoryV2 && data.wordMemoryV2.stories || []).filter(item => item && item.profileId === profileId).length;
    return count;
  }
  async function finalizeDeletion(item, wordValue = '') {
    const removed = state.voice ? (item.kind === 'profile' ? await state.voice.deleteProfile(item.profileId) : await state.voice.deleteWord(item.profileId, item.wordId)) : { ok:true };
    if (!removed || !removed.ok) return { ok:false, reason:'voice-delete-failed' };
    Life.applyDeletionLedger(state.data);
    if (!save()) return { ok:false, reason:'save-failed' };
    const reloaded = readData();
    const references = item.kind === 'profile' ? profileReferenceCount(reloaded, item.profileId) : wordReferenceCount(reloaded, item.profileId, item.wordId, wordValue);
    if (!reloaded || references !== 0) return { ok:false, reason:'verify-failed' };
    state.data = reloaded;
    Life.completeDeletion(state.data, item.id);
    if (!save()) return { ok:false, reason:'complete-save-failed' };
    state.voiceTarget = state.voiceTarget && (item.kind === 'profile' ? state.voiceTarget.profileId === item.profileId : state.voiceTarget.profileId === item.profileId && state.voiceTarget.wordId === item.wordId) ? null : state.voiceTarget;
    ensureTwoPetSession(); updateScreen(); await refreshVoiceCount();
    return { ok:true };
  }
  async function deleteWordWithLedger(profileId, wordId) {
    const word = (state.data.learnedWords || []).find(item => item.id === wordId && (item.profileId || 'p-default') === profileId); if (!word) return false;
    const lockToken = acquireDeletionLock(); if (!lockToken) { showToast('いまは削除できません。少し待ってね'); return false; }
    try {
      const item = Life.beginDeletion(state.data, { kind:'word', profileId, wordId, now:new Date() });
      if (!item || !save()) { showToast('削除の準備を保存できません'); return false; }
      await stopDeletionActivities();
      const result = await finalizeDeletion(item, word.word);
      if (!result.ok) { updateScreen(); showToast(result.reason === 'voice-delete-failed' ? '声の記憶を消せません。ことばは残しました' : '削除の確認ができません。もう一度ためしてね'); return false; }
      showToast('そのことばを忘れたよ'); return true;
    } finally { if (state.activityLock) state.activityLock.release(lockToken); }
  }
  async function deleteProfileWithLedger(profileId) {
    if (profileId === 'p-default' || !(state.data.profiles || []).some(item => item.id === profileId) || (state.data.profiles || []).length <= 1) return false;
    const lockToken = acquireDeletionLock(); if (!lockToken) { showToast('いまは削除できません。少し待ってね'); return false; }
    try {
      const item = Life.beginDeletion(state.data, { kind:'profile', profileId, now:new Date() });
      if (!item || !save()) { showToast('削除の準備を保存できません'); return false; }
      await stopDeletionActivities();
      const result = await finalizeDeletion(item);
      if (!result.ok) { updateScreen(); showToast(result.reason === 'voice-delete-failed' ? '声の記憶を消せません。プロフィールは残しました' : '削除の確認ができません。もう一度ためしてね'); return false; }
      showToast('プロフィールと記憶を消したよ'); return true;
    } finally { if (state.activityLock) state.activityLock.release(lockToken); }
  }
  async function retryPendingDeletions() {
    const pending = state.data && state.data.wordMemoryV2 && Array.isArray(state.data.wordMemoryV2.deletionLedger) ? state.data.wordMemoryV2.deletionLedger.slice() : [];
    for (const item of pending) {
      if (!item || !item.profileId || (item.kind === 'profile' && item.profileId === 'p-default')) continue;
      const lockToken = acquireDeletionLock(); if (!lockToken) break;
      try { await stopDeletionActivities(); await finalizeDeletion(item); } finally { if (state.activityLock) state.activityLock.release(lockToken); }
    }
  }
  function setVoiceRecordStatus(message, recording = false) { $('voice-record-status').textContent = message; $('voice-record-panel').classList.toggle('is-recording', recording); $('voice-record-button').disabled = recording; }
  async function playStoredWord(event) {
    if (!state.voice || !state.data || state.echoSession || !state.data.voiceMemoryEnabled || state.data.soundMode === 'text' || Life.isSafetyPaused(state.data) || Life.isQuietTime(new Date()) || !event || event.profileId !== state.data.activeProfileId) return false;
    stopPetAudio(); const result = await state.voice.playProcessed({ profileId:event.profileId, wordId:event.wordId, tuning:state.data.voiceTuning });
    if (!result.ok) return false;
    return true;
  }
  async function recordWordVoice() {
    const target = state.voiceTarget;
    if (!state.voice || !target || !state.data || !state.data.voiceMemoryEnabled || Life.isSafetyPaused(state.data)) return;
    cancelTwoPetMoment('voice-recording'); cancelCompanionMoment();
    const lockToken = state.activityLock ? state.activityLock.tryAcquire('voice-recording') : { owner:'voice-recording' };
    if (!lockToken) { showToast('いまは録音できません。少し待ってね'); return; }
    try {
      const result = await state.voice.record({ profileId:target.profileId, wordId:target.wordId, onPending:() => setVoiceRecordStatus('マイクの許可を待っています', false), onStart:() => setVoiceRecordStatus(`● 録音中　「${target.word}」って言ってね`, true), onStop:() => setVoiceRecordStatus('録音を止めたよ') });
      if (result.ok) { setVoiceRecordStatus(`${target.word}の声も覚えたよ`); bubble(`${target.word}の声も覚えたよ`); showToast('声も覚えたよ'); await refreshVoiceCount(); return; }
      const message = result.reason === 'limit' ? '声の記憶が20件いっぱいだよ。保護者設定から消してね' : 'この端末では声を覚えられないよ。ことばは覚えているよ'; setVoiceRecordStatus(message); bubble(message); showToast(message); await refreshVoiceCount();
    } finally { if (state.activityLock) state.activityLock.release(lockToken); }
  }
  function discardTuningBlob(message = '') { state.tuningToken += 1; state.tuningBlob = null; if (state.voice) { state.voice.stopRecording(); state.voice.stopPlayback(); } $('tuning-stop-button').hidden = true; $('tuning-stop-button').disabled = false; $('tuning-record-button').disabled = false; if (message) $('tuning-status').textContent = message; updateScreen(); }
  function selectedTuningPetId() { return $('tuning-pet-select').value === 'pet-2' ? 'pet-2' : 'pet-1'; }
  function loadTuning(petId = selectedTuningPetId()) { const tuning=echoTuning(petId); $('tuning-pitch').value=String(Math.round(tuning.pitchRate*100)); $('tuning-speed').value=String(Math.round(tuning.speedRate*100)); $('tuning-double').value=String(Math.round(tuning.doubleMix*100)); $('tuning-brightness').value=String(Math.round(tuning.brightness)); $('tuning-timing-mode').value=tuning.timingMode==='fast'?'fast':'preserve'; updateScreen(); }
  function saveTuning() { const petId=selectedTuningPetId(); const raw={ pitchRate:Number($('tuning-pitch').value) / 100, speedRate:Number($('tuning-speed').value) / 100, doubleMix:Number($('tuning-double').value) / 100, brightness:Number($('tuning-brightness').value), timingMode:$('tuning-timing-mode').value }; const normalized=VoiceMemory.normalizeTuning(raw); normalized.pitchRate=Math.max(.55,Math.min(3.5,normalized.pitchRate)); normalized.doubleMix=Math.max(0,Math.min(.36,Number(raw.doubleMix)||0)); if(normalized.pitchRate===1) normalized.pitchRate=1.2; state.data.echoVoiceOverrides=state.data.echoVoiceOverrides||{}; state.data.echoVoiceOverrides[petId]=normalized; save(); updateScreen(); }
  function clearEchoTimers() { ['echoInviteTimer','echoEndTimer','echoIdleTimer','echoResumeTimer'].forEach(key => { window.clearTimeout(state[key]); state[key] = null; }); }
  function liveEchoApi(name) { return (state.voice && typeof state.voice[name] === 'function' && state.voice[name].bind(state.voice)) || (VoiceMemory && typeof VoiceMemory[name] === 'function' && VoiceMemory[name]); }
  function echoHardBlocked() { return !state.data || document.hidden || state.game || Life.isSafetyPaused(state.data) || $('setup-dialog').open || $('parent-dialog').open || !$('forget-confirm-box').hidden || !$('voice-clear-confirm-box').hidden || Boolean(state.voice && (state.voice.pendingRecording || state.voice.permissionInFlight || state.voice.recording)); }
  function echoBlocked() { return echoHardBlocked() || twoPetActive() || twoPetIntroductionPending() || state.recognizing || state.director || (Story && Story.isActive(state.data) && state.data.bondStory && state.data.bondStory.beat !== 'idle') || Boolean(state.tuningBlob) || Boolean(state.audioNodes.length) || Boolean(speechAvailable && window.speechSynthesis.speaking); }
  function canStartEcho(source = 'spontaneous') { return state.data && state.data.echoModeEnabled === true && state.data.soundMode !== 'text' && !(['manual','companion'].includes(source) ? echoHardBlocked() : echoBlocked()); }
  function interruptForManualEcho() { state.manualInterruptToken += 1; if (state.recognizing) stopRecognition(); clearSpeechWatchdog(); if (speechAvailable) window.speechSynthesis.cancel(); stopPetAudio(); if (state.voice) state.voice.stopPlayback(); hideQuestion(); renderStoryCandidates(null); toggleTextEntry(false); }
  function finishEcho(reason = 'stop', silent = false) {
    const active = state.echoSession;
    state.echoToken += 1; state.echoBlob = null; state.echoRecording = false; clearEchoTimers();
    const stopLive = liveEchoApi('stopLiveEchoSession'); if (stopLive) { try { stopLive(); } catch (_) {} }
    if (state.voice) { state.voice.stopRecording(); state.voice.stopPlayback(); }
    state.echoSession = null;
    if (active && active.temporaryGuest) state.twoPetGuestVisible = Boolean(pairRelation() && pairRelation().phase === 'visiting');
    clearPetBubbles();
    if (reason === 'stop' && active && Date.now() - active.startedAt < 10000) state.echoNoInviteUntil = Date.now() + 60 * 60 * 1000;
    if (!silent && state.data) { const text = reason === 'stop' ? 'おしまい。たのしかった' : reason === 'satisfied' ? 'いっぱい まねした。まんぞく' : reason === 'failed' ? 'きょうは ここまでにしよ' : 'また まねっこしよ'; bubble(text); setState(reason === 'satisfied' ? 'copy-satisfied' : (state.data.energy < 30 ? 'sleepy' : 'normal'), reason === 'satisfied' ? 1200 : 0); }
    updateScreen(); scheduleEchoInvite();
  }
  function cancelEcho() { finishEcho('stop', true); }
  function echoReaction() {
    const choices = ['まねっこ、できた', 'ぼくの声になった', 'たかい声、でた', 'ふふっ。もういっかい？', 'いまの、似てた？', 'きゅるんってなった', 'おもしろい声になったね'];
    const recent = Array.isArray(state.data.lastReplies) ? state.data.lastReplies : [];
    const previous = recent.filter(item => String(item).startsWith('echo:')).slice(-1)[0];
    const usable = choices.filter(text => `echo:${text}` !== previous);
    const text = usable[Math.floor(Math.random() * usable.length)] || choices[0];
    state.data.lastReplies = recent.concat(`echo:${text}`).slice(-12);
    return text;
  }
  const wait = ms => new Promise(resolve => window.setTimeout(resolve, ms));
  function prepareEchoAudio() {
    if (state.recognizing) stopRecognition();
    clearSpeechWatchdog();
    if (speechAvailable) window.speechSynthesis.cancel();
    stopPetAudio();
    if (state.voice) state.voice.stopPlayback();
  }
  function armEchoEndChecks() {
    window.clearTimeout(state.echoEndTimer); window.clearTimeout(state.echoIdleTimer);
    if (!state.echoSession) return;
    const token = state.echoSession.token;
    state.echoEndTimer = window.setTimeout(() => { if (state.echoSession && state.echoSession.token === token) finishEcho('timeout'); }, 120000);
    const checkIdle = () => { if (!state.echoSession || state.echoSession.token !== token) return; if (!echoImitatorSleepCheck()) return; const reason = Life.echoShouldEnd(state.echoSession, Date.now()); if (reason) finishEcho(reason); else state.echoIdleTimer = window.setTimeout(checkIdle, 1000); };
    state.echoIdleTimer = window.setTimeout(checkIdle, 1000);
  }
  function echoFailure(token) { if (!state.echoSession || state.echoSession.token !== token) return; const resume = liveEchoApi('resumeLiveEchoDetection'); if (state.echoSession.inputMode === 'live' && resume) resume(); state.echoRecording = false; state.echoSession.phase = state.echoSession.inputMode === 'live' ? 'live' : 'ready'; state.echoSession.consecutiveFailures += 1; if (Life.echoShouldEnd(state.echoSession, Date.now()) === 'failed') finishEcho('failed'); else { bubble('まねっこできなかった。もういっこ？'); setState(state.echoSession.inputMode === 'live' ? 'copy-live' : 'copy-ready', 0); updateScreen(); } }
  function recoverLiveEchoToPress(token) {
    const echoSession = state.echoSession;
    if (!echoSession || echoSession.token !== token || echoSession.inputMode !== 'live' || echoSession.liveFallback) return;
    echoSession.liveFallback = true;
    const stopLive = liveEchoApi('stopLiveEchoSession'); if (stopLive) { try { stopLive(); } catch (_) {} }
    echoSession.inputMode = 'press'; echoSession.phase = 'ready'; state.echoRecording = false;
    bubble('うまく聞こえないから「はなす」をおしてね'); setState('copy-ready', 0); updateScreen();
  }
  function switchEchoImitator(echoSession) { if (!echoSession || echoSession.manualSelection || echoSession.rounds < echoSession.switchAtRound || !canSwitchActivePet()) return false; const next = echoSession.imitatorPetId === 'pet-1' ? 'pet-2' : 'pet-1'; if (petSleepingNow(next)) return false; if (!switchActivePet(next, `${petInfo(next).name} が こんどは まねするよ`)) return false; echoSession.imitatorPetId = next; echoSession.switchAtRound = echoSession.rounds + 2 + Math.floor(Math.random() * 3); return true; }
  /* まねっこの相手が寝る時刻へ入ったら、起きている子へ交代する。ふたりとも寝たら既存の理由コードで終える */
  function echoImitatorSleepCheck() {
    const echoSession = state.echoSession;
    if (!echoSession || !petSleepingNow(echoSession.imitatorPetId)) return true;
    const next = echoSession.imitatorPetId === 'pet-1' ? 'pet-2' : 'pet-1';
    if (petSleepingNow(next)) { finishEcho('timeout'); return false; }
    const message = `${petInfo(next).name} が こんどは まねするよ`;
    const midRound = state.echoRecording || state.tuningBlob || state.audioNodes.length || (state.voice && (state.voice.pendingRecording || state.voice.permissionInFlight || state.voice.recording || state.voice.playback)) || (speechAvailable && window.speechSynthesis.speaking);
    if (activePetId() === next) { echoSession.imitatorPetId = next; echoSession.switchAtRound = echoSession.rounds + 2 + Math.floor(Math.random() * 3); showPetBubble(next, message); setState(echoSession.inputMode === 'press' ? 'copy-ready' : 'copy-live', 0); updateScreen(); return true; }
    if (!switchActivePet(next, message)) { if (midRound) return true; finishEcho('timeout'); return false; }
    echoSession.imitatorPetId = next; echoSession.switchAtRound = echoSession.rounds + 2 + Math.floor(Math.random() * 3); setState(echoSession.inputMode === 'press' ? 'copy-ready' : 'copy-live', 0); updateScreen(); return true;
  }
  function echoSucceeded(token) { if (!state.echoSession || state.echoSession.token !== token) return; state.echoRecording = false; state.echoSession.phase = state.echoSession.inputMode === 'live' ? 'live' : 'ready'; state.echoSession.rounds += 1; state.echoSession.consecutiveFailures = 0; state.echoSession.lastActionAt = Date.now(); Life.recordEchoRound(state.data, new Date()); const changed = switchEchoImitator(state.echoSession); const companionHandled = companionAction('echo'); const reaction = companionHandled ? '' : echoReaction(); if (companionHandled && $('companion-moment').textContent) bubble($('companion-moment').textContent); save(); const reason = Life.echoShouldEnd(state.echoSession, Date.now()); if (reason === 'satisfied') finishEcho('satisfied'); else { if (!companionHandled && !changed) bubble(state.echoSession.inputMode === 'press' ? `${reaction}　もういっこ？ 「はなす」をおしてね` : `${reaction}　もういっこ、きくよ`); setState(state.echoSession.inputMode === 'press' ? 'copy-ready' : 'copy-live', 0); updateScreen(); } }
  async function playLiveEcho(utterance, token) {
    if (!state.echoSession || state.echoSession.token !== token || state.echoSession.inputMode !== 'live' || state.echoSession.phase !== 'live' || !utterance) return;
    const pause = liveEchoApi('pauseLiveEchoDetection'); if (pause) pause(); state.echoRecording = 'speaking'; state.echoSession.phase = 'thinking'; setState('copy-thinking', 0); bubble('んーっと…'); updateScreen();
    await wait(350 + Math.floor(Math.random() * 301));
    if (!state.echoSession || state.echoSession.token !== token) return;
    state.echoSession.phase = 'speaking'; setState('copy-speaking', 0); updateScreen();
    let result = { ok:false };
    try { const play = liveEchoApi('playProcessed'); if (play) result = await play({ pcm16:utterance.pcm16, sampleRate:utterance.sampleRate, tuning:echoTuning(state.echoSession.imitatorPetId) }); } catch (_) {}
    if (!state.echoSession || state.echoSession.token !== token) return;
    if (!result || !result.ok) { echoFailure(token); return; }
    await wait(Math.max(0, Number(result.durationMs) || 0) + 350);
    if (!state.echoSession || state.echoSession.token !== token) return;
    const resume = liveEchoApi('resumeLiveEchoDetection'); if (resume) resume(); state.echoRecording = false; echoSucceeded(token);
  }
  async function startEchoSession(source, selectedPetId = '') {
    if (stageAsleep()) return; if (!canStartEcho(source)) { if (state.data && state.data.soundMode === 'text') bubble('右上の音をオンにしてね'); return; }
    if (source === 'manual') { cancelCompanionMoment(); cancelTwoPetMoment('echo'); }
    if (source === 'manual') interruptForManualEcho();
    const petInvited = source === 'spontaneous' || source === 'companion';
    prepareEchoAudio(); const token = ++state.echoToken; const liveStart = source === 'manual' && liveEchoApi('startLiveEchoSession');
    let imitatorPetId = selectedPetId === 'pet-2' ? 'pet-2' : selectedPetId === 'pet-1' ? 'pet-1' : activePetId();
    if (petSleepingNow(imitatorPetId)) imitatorPetId = imitatorPetId === 'pet-1' ? 'pet-2' : 'pet-1';
    if (petSleepingNow(imitatorPetId)) return;
    const relation = pairRelation(); const temporaryGuest = imitatorPetId === 'pet-2' && Boolean(relation && relation.phase === 'solo');
    state.echoSession = { token, source, imitatorPetId, manualSelection:Boolean(selectedPetId), temporaryGuest, inputMode:liveStart ? 'live' : 'press', startedAt:Date.now(), lastActionAt:Date.now(), lastVoiceAt:0, rounds:0, targetRounds:3 + Math.floor(Math.random() * 8), switchAtRound:2 + Math.floor(Math.random() * 3), consecutiveFailures:0, liveFallback:false, phase:liveStart ? 'calibrating' : 'ready' };
    if (temporaryGuest) state.twoPetGuestVisible = true;
    renderTwoPets();
    Life.recordEchoSession(state.data, new Date()); save(); const sulkTalkWord = noteSulkTalk(); if (sulkTalkWord) showPetBubble(imitatorPetId, sulkTalkWord); setState(liveStart ? 'copy-calibrating' : (petInvited ? 'copy-invite' : 'copy-ready'), 0); bubble(liveStart ? 'マイク準備中・しずかに1秒まってね' : (petInvited ? '「はなす」をおして、なにか はなして' : 'この端末では「はなす」をおしてね')); if (petInvited) playPetSound('curious'); updateScreen(); armEchoEndChecks();
    if (!liveStart) return;
    try {
      const liveResult = await liveStart({ onReady:() => { if (state.echoSession && state.echoSession.token === token && state.echoSession.inputMode === 'live' && state.echoSession.phase === 'calibrating') { state.echoSession.phase = 'live'; state.echoRecording = false; bubble('いま きいてるよ。はなしてね'); setState('copy-live', 0); updateScreen(); } }, onSpeechStart:() => { if (state.echoSession && state.echoSession.token === token && state.echoSession.inputMode === 'live' && state.echoSession.phase === 'live') { state.echoSession.lastVoiceAt = Date.now(); state.echoRecording = true; setState('copy-listening', 0); updateScreen(); } }, onUtterance:utterance => playLiveEcho(utterance, token), onSilence:() => { if (state.echoSession && state.echoSession.token === token && state.echoSession.inputMode === 'live' && !['thinking','speaking'].includes(state.echoSession.phase)) { state.echoRecording = false; updateScreen(); } }, onError:() => recoverLiveEchoToPress(token) });
      if (!liveResult || !liveResult.ok) throw new Error('live-echo-unavailable');
    } catch (_) { recoverLiveEchoToPress(token); }
  }
  async function runEcho() {
    if (stageAsleep()) return; if (!state.echoSession) { startEchoSession(companionExpects('echo') ? 'companion' : 'manual'); return; }
    if (!state.voice || state.echoSession.inputMode !== 'press' || !canStartEcho(state.echoSession.source)) return;
    if (state.echoRecording === true) {
      if (state.voice.finishTemporaryRecording()) { $('echo-press-button').disabled = true; $('echo-press-button').textContent = '録音を止めています'; }
      return;
    }
    if (state.echoRecording || state.voice.pendingRecording || state.voice.permissionInFlight || state.voice.recording) return;
    const token = state.echoSession.token;
    state.echoSession.lastActionAt = Date.now(); state.echoSession.phase = 'recording';
    state.echoBlob = null;
    state.echoRecording = 'pending';
    prepareEchoAudio();
    updateScreen();
    const result = await state.voice.recordTemporary({
      stopMs:4000, maxDurationMs:4200, maxBytes:768 * 1024,
      onPending:() => { if (token === state.echoToken) { bubble('マイクを待ってるよ'); updateScreen(); } },
      onStart:() => { if (token === state.echoToken) { state.echoRecording = true; state.echoSession.phase = 'recording'; bubble('きいてるよ'); setState('copy-listening', 0); updateScreen(); } },
      onStop:() => { if (token === state.echoToken) { state.echoRecording = false; updateScreen(); } }
    });
    if (!state.echoSession || token !== state.echoSession.token || !canStartEcho(state.echoSession.source)) { state.echoBlob = null; return; }
    if (!result.ok || !result.blob) { state.echoBlob = null; echoFailure(token); return; }
    state.echoBlob = result.blob;
    state.echoRecording = 'speaking'; state.echoSession.phase = 'thinking'; setState('copy-thinking', 0); bubble('んーっと…'); updateScreen();
    await wait(350 + Math.floor(Math.random() * 301));
    if (!state.echoSession || token !== state.echoSession.token || !canStartEcho(state.echoSession.source)) { state.echoBlob = null; return; }
    let blob = state.echoBlob;
    state.echoBlob = null;
    state.echoSession.phase = 'speaking'; setState('copy-speaking', 0); updateScreen();
    const played = await state.voice.playProcessed({ blob, tuning:echoTuning(state.echoSession.imitatorPetId) });
    blob = null;
    if (!state.echoSession || token !== state.echoSession.token || !played.ok || !canStartEcho(state.echoSession.source)) { if (state.echoSession && token === state.echoSession.token) echoFailure(token); return; }
    await wait(Math.max(600, played.durationMs + 600 + Math.floor(Math.random() * 501)));
    if (!state.echoSession || token !== state.echoSession.token || !canStartEcho(state.echoSession.source)) return;
    echoSucceeded(token);
  }
  async function recordTuning() { if (!state.voice || !state.data || !state.data.voiceMemoryEnabled || document.hidden || Life.isSafetyPaused(state.data) || state.voice.pendingRecording || state.voice.permissionInFlight) return; cancelCompanionMoment(); cancelEcho(); const token = ++state.tuningToken; state.tuningBlob = null; state.voice.stopPlayback(); updateScreen(); const result = await state.voice.recordTemporary({ stopMs:6000, maxDurationMs:6200, maxBytes:1024 * 1024, onPending:() => { $('tuning-record-button').disabled = true; $('tuning-status').textContent = 'マイクの許可を待っています'; }, onStart:() => { $('tuning-stop-button').disabled = false; $('tuning-stop-button').hidden = false; $('tuning-status').textContent = '● 録音中　固定文を言ってください'; }, onStop:() => { $('tuning-stop-button').hidden = true; $('tuning-stop-button').disabled = false; $('tuning-record-button').disabled = false; } }); if (token !== state.tuningToken || document.hidden || !state.data.voiceMemoryEnabled || Life.isSafetyPaused(state.data)) { state.tuningBlob = null; return; } if (result.ok) { state.tuningBlob = result.blob; $('tuning-status').textContent = '録音完了。調整して聞いてみてね'; updateScreen(); } else { discardTuningBlob('試験録音を使えません。もう一度ためしてね'); } }
  async function playTuning() { if (!state.voice || !state.data || !state.data.voiceMemoryEnabled || !state.tuningBlob || document.hidden || Life.isSafetyPaused(state.data)) return; const token = state.tuningToken; const blob = state.tuningBlob; stopPetAudio(); if (speechAvailable) window.speechSynthesis.cancel(); saveTuning(); $('tuning-status').textContent = '加工した声を再生します'; const result = await state.voice.playProcessed({ blob, tuning:echoTuning(selectedTuningPetId()) }); if (!result.ok && token === state.tuningToken && blob === state.tuningBlob && !Life.isSafetyPaused(state.data)) $('tuning-status').textContent = '加工した声を再生できませんでした'; }
  function playPetSound(kind = 'normal') {
    if (!state.data || state.data.soundMode === 'text') return false;
    const context = unlockAudio(); if (!context) return false;
    const patterns = { happy:[660,880,1040], normal:[520,620], call:[760,520,760], thinking:[440,540], sleepy:[360,280], sad:[420,330], play:[700,820,700,920], danger:[300], curious:[580,760,680], proud:[520,780,980], quiet:[300,360], shy:[410,460], puni:[380,260,330] };
    try { stopPetAudio(); const frequencies = patterns[kind] || patterns.normal; const now = context.currentTime; frequencies.forEach((frequency, index) => { const oscillator=context.createOscillator(); const gain=context.createGain(); const start=now + index*.12; oscillator.type='triangle'; oscillator.frequency.value=frequency; gain.gain.setValueAtTime(.001,start); gain.gain.exponentialRampToValueAtTime(.13,start+.015); gain.gain.exponentialRampToValueAtTime(.001,start+.1); oscillator.connect(gain); gain.connect(context.destination); oscillator.start(start); oscillator.stop(start+.12); state.audioNodes.push(oscillator); }); state.audioTimer=window.setTimeout(stopPetAudio, frequencies.length*120+300); return true; } catch (_) { return false; }
  }
  function clearSpeechWatchdog() { window.clearTimeout(state.speechWatchdog); state.speechWatchdog = null; }
  function armSpeechWatchdog(kind = 'normal', status = '音声が返ってこないため、ペット声に切り替えます') { clearSpeechWatchdog(); state.speechWatchdog = window.setTimeout(() => { playPetSound(kind); setVoiceStatus(status); setState(state.data.energy < 30 ? 'sleepy' : 'normal', 0); }, 8000); }
  function speakTestPhrase() {
    if (!speechAvailable) return false;
    try {
      const petId=activePetId(), label=petId === 'pet-2' ? '青の低い声' : 'ピンクの高い声';
      stopPetAudio(); window.speechSynthesis.cancel(); const started=PetSpeech && PetSpeech.speakPetText && PetSpeech.speakPetText({petId,text:'こえ、きこえる？',synth:window.speechSynthesis,getVoice:preferredVoice,onstart:()=>{setVoiceStatus(`3/3 ${label}を再生中です`); bubble('こえ、きこえる？'); setState('talking',0);},onend:()=>{clearSpeechWatchdog();setVoiceStatus('再生処理は完了しました。実際に聞こえたか確認してね');setState(state.data.energy<30?'sleepy':'normal',350);},onerror:()=>{clearSpeechWatchdog();const message='声の再生に失敗しました。ペット声と文字を使えます';playPetSound('normal');setVoiceStatus(message);bubble(message);showToast(message);setState('sad');}}); if(started)armSpeechWatchdog('normal'); return Boolean(started);
    } catch (_) { const message = '音声合成を開始できません。文字でも使えるよ'; setVoiceStatus(message); bubble(message); showToast(message); return false; }
  }
  function testVoice() {
    if (state.data.soundMode === 'text') { const message = '音モードが文字だけです。保護者設定から変更できます'; setVoiceStatus(message); bubble(message); showToast(message); return; }
    const chimePlayed = playTestChime(); setVoiceStatus(chimePlayed ? '1/3 ポン音を再生しました' : '1/3 ポン音は使えません');
    window.setTimeout(() => { const petPlayed = playPetSound('normal'); setVoiceStatus(petPlayed ? '2/3 ペット声を再生しました' : '2/3 ペット声は使えません'); if (state.data.soundMode === 'pet') { setVoiceStatus('ペット声テストが完了しました'); return; } if (!speechAvailable) { const message = '3/3 日本語音声に未対応です。文字とペット声を使えます'; setVoiceStatus(message); bubble(message); showToast(message); return; } window.setTimeout(speakTestPhrase, 360); }, 320);
  }
  function speak(text, kind = 'normal') {
    if (!state.data || state.data.soundMode === 'text') return;
    if (!speechAvailable || state.data.soundMode === 'pet') { playPetSound(kind); return; }
    window.speechSynthesis.cancel(); const interruptToken=state.manualInterruptToken, speakingPetId=activePetId(); const started=PetSpeech&&PetSpeech.speakPetText&&PetSpeech.speakPetText({petId:speakingPetId,text,synth:window.speechSynthesis,getVoice:preferredVoice,onstart:()=>{if(interruptToken===state.manualInterruptToken&&!state.echoSession)setPetState(speakingPetId,'talking');},onend:()=>{clearSpeechWatchdog();if(interruptToken===state.manualInterruptToken&&!state.echoSession)setPetState(speakingPetId,state.data.energy<30?'sleepy':'normal');},onerror:()=>{clearSpeechWatchdog();if(interruptToken!==state.manualInterruptToken||state.echoSession)return;playPetSound(kind);setVoiceStatus('声の再生に失敗しました。ペット声を使います');showToast('声を出せなかったよ。ペット声にするね');setState('sad');}}); if(started)armSpeechWatchdog(kind); else playPetSound(kind);
  }
  function answer(text, options = {}) {
    if (options.forcePetSound) playPetSound(options.soundKind || 'normal');
    bubble(text); setState('talking', 0); speak(text, options.soundKind || 'normal');
    if (!speechAvailable || state.data.soundMode !== 'auto') setTimeout(() => setState(state.data.energy < 30 ? 'sleepy' : 'normal', 350), 500);
    const replyId = options.id || text; if (state.data.lastReplies[state.data.lastReplies.length - 1] !== replyId) state.data.lastReplies = [...state.data.lastReplies, replyId].slice(-12); state.data.daily.seenReplyIds = [...(state.data.daily.seenReplyIds || []), replyId].slice(-50); setSeen(); updateScreen();
  }
  function getReply(text) {
    return Brain.respond(text, state.data, session);
  }
  function hideQuestion() { state.director = null; window.clearTimeout(state.directorTimer); state.directorTimer = null; $('question-candidates').hidden = true; $('question-candidates').replaceChildren(); }
  function renderQuestion(question) {
    const box = $('question-candidates'); box.replaceChildren(); if (!question || !Array.isArray(question.candidates)) { box.hidden = true; return; }
    question.candidates.slice(0, 4).forEach(candidate => { const button = document.createElement('button'); button.type = 'button'; button.textContent = candidate; button.setAttribute('aria-label', `${candidate}と答える`); button.addEventListener('click', () => handleMessage(candidate, { fromCandidate:true, alternatives:[candidate] })); box.appendChild(button); }); box.hidden = false;
  }
  function renderStoryCandidates(event) {
    const box = $('question-candidates'); box.replaceChildren(); const candidates = event && Array.isArray(event.candidates) ? event.candidates : []; if (!candidates.length) { box.hidden = true; return; }
    candidates.slice(0, 5).forEach((candidate, index) => { const button = document.createElement('button'); button.type = 'button'; button.textContent = candidate; button.setAttribute('aria-label', `${candidate}を選ぶ`); button.addEventListener('click', () => handleStoryInput(candidate, { fromCandidate:true, category:event.categories ? event.categories[index] : '', alternatives:[candidate] })); box.appendChild(button); }); box.hidden = false;
  }
  function storyPresent(event) { if (!event || !event.text) return; cancelTwoPetMoment('story'); cancelEcho(); const cleanHistory = ['ask-word','confirm-word','classify','stumble','correct-word','preference','recall-use','memory','small-event','resume'].includes(event.kind); if (cleanHistory) { $('recognized-text').textContent = ''; $('recognized-text').hidden = true; } if (event.kind === 'memory') { hideQuestion(); toggleTextEntry(false); $('input-hint').textContent = 'また、さわってみてね'; } bubble(event.text); renderStoryCandidates(event); if (event.kind === 'ask-word' || event.kind === 'correct-word') showTextEntry('ことばを入力するか、声で教えてね'); if (event.kind === 'recall-use') showTextEntry('「おぼえてた」など、返してね'); if (event.kind === 'seed' && event.wordId) { state.seedGlowId = event.wordId; state.voiceTarget = { profileId:event.profileId, wordId:event.wordId, word:event.word }; noteTwoPetAction('talk'); setVoiceRecordStatus('このことばの声も覚えられるよ'); window.setTimeout(() => { state.seedGlowId = ''; updateScreen(); }, 1000); } const listening = ['ask-word','classify','correct-word'].includes(event.kind); const visualState = listening ? 'listening' : event.sound === 'quiet' || event.sound === 'sleepy' ? 'sleepy' : event.sound === 'proud' ? 'happy' : event.sound === 'curious' || event.sound === 'thinking' ? 'thinking' : 'talking'; setState(visualState, 0); playPetSound(event.sound || 'normal'); if (event.kind === 'recall-use') window.setTimeout(() => { playStoredWord(event); }, 260); else speak(event.text, event.sound || 'normal'); setSeen(); updateScreen(); if (event.kind === 'memory') { noteTwoPetAction('talk'); scheduleTwoPetMoment(); } }
  function startStoryFlow() { if (!Story || !state.data || state.echoSession || companionActive() || twoPetActive() || Life.isSafetyPaused(state.data) || ($('setup-dialog') && $('setup-dialog').open) || state.director || state.game || sulkingNow()) return false; if (Ritual && Ritual.isDrowsy && Ritual.isDrowsy(state.data, activePetId(), new Date())) return false; const event = Story.startTeaching(state.data, {source:'spontaneous',now:new Date()}); if (!event) return false; storyPresent(event); save(); return true; }
  function scheduleStoryRecall() { window.clearTimeout(state.storyRecallTimer); state.storyRecallTimer = null; if (!state.data || Life.isSafetyPaused(state.data) || ($('setup-dialog') && $('setup-dialog').open)) return; if (!Story.canRecall(state.data, new Date()) && state.data.bondStory && state.data.bondStory.recallReadyAt) { const at = Date.parse(state.data.bondStory.recallReadyAt); if (Number.isFinite(at)) state.storyRecallTimer = window.setTimeout(() => { if (!document.hidden && !state.echoSession && !Life.isSafetyPaused(state.data) && !($('setup-dialog') && $('setup-dialog').open)) maybeStoryRecall(); }, Math.max(0, at - Date.now())); } }
  function maybeStoryRecall() { if (!state.data || state.echoSession || companionActive() || Life.isSafetyPaused(state.data) || state.director || state.game || !Story.canRecall(state.data, new Date())) return false; const event = Story.recall(state.data, new Date()); if (!event) return false; storyPresent(event); return true; }
  function storyNoteUnrelated() { if (!Story || !state.data || !Story.isActive(state.data)) return null; if (state.data.bondStory.beat === 'recall-use') { const reacted = Story.react(state.data, new Date()); if (reacted) storyPresent(reacted); save(); updateScreen(); return reacted; } const event = Story.noteUnrelated(state.data, new Date()); const recalled = event ? null : maybeStoryRecall(); if (event) storyPresent(event); scheduleStoryRecall(); save(); updateScreen(); return event || recalled; }
  function storyYes(value) { const normalized = Brain.normalizeAnswer(value); return normalized === 'yes' ? true : normalized === 'no' ? false : null; }
  function handleStoryInput(value, options = {}) {
    const text = clean(value); if (!Story || !state.data || !Story.isActive(state.data)) return false; const story = state.data.bondStory; const now = new Date();
    if (text && !options.fromCandidate) { $('recognized-text').textContent = `「${text}」って、きこえたよ`; $('recognized-text').hidden = false; }
    const safetyHit = Brain.detectSafety(text); if (safetyHit) { pauseForSafety(); hideQuestion(); answer(safetyHit.text, { id:`safety-${safetyHit.id}`, soundKind:'danger', forcePetSound:true }); save(); return true; }
    let event = null;
    if (story.beat === 'ask-word' || story.beat === 'correct-word') { const result = Story.receiveWord(state.data, text, now, state.storyDraft); if (result.ok) { if (result.draft) state.storyDraft = result.draft; event = result; } else { storyPresent({ kind:'story-unknown', text:'ことばを、もう一回きかせて？', sound:'thinking' }); return true; } }
    else if (story.beat === 'confirm-word') { const yes = storyYes(text); if (yes === null) { storyPresent({ kind:'story-unknown', text:'そう？ それとも、ちがう？', candidates:['そう','ちがう'], sound:'thinking' }); return true; } event = Story.confirmWord(state.data, yes, now, state.storyDraft); }
    else if (story.beat === 'classify') { const index = (Story.CATEGORIES.map(item => Story.CATEGORY_LABELS[item]).indexOf(text)); const category = options.category || (index >= 0 ? Story.CATEGORIES[index] : Story.CATEGORIES.find(item => text.includes(Story.CATEGORY_LABELS[item]))); if (!category) { storyPresent({ kind:'story-unknown', text:'食べもの、どうぶつ、あそび、もの、そのほかからえらんでね', candidates:Story.CATEGORIES.map(item => Story.CATEGORY_LABELS[item]), categories:Story.CATEGORIES, sound:'thinking' }); return true; } event = Story.classify(state.data, category, now, state.storyDraft); }
    else if (story.beat === 'stumble') { const yes = storyYes(text); if (yes === null) { storyPresent({ kind:'story-unknown', text:'そう？ それとも、ちがう？', candidates:['そう','ちがう'], sound:'thinking' }); return true; } event = Story.correct(state.data, yes, now, state.storyDraft); }
    else if (story.beat === 'recall-use') { event = Story.react(state.data, now); }
    else return false;
    if (event) { if (event.kind === 'seed') state.storyDraft = null; storyPresent(event); save(); updateScreen(); if (event.kind === 'memory') state.storyDraft = null; }
    return true;
  }
  function startConversationTheme(themeId = '') {
    if (!state.data || state.echoSession || companionActive() || twoPetActive() || twoPetIntroductionPending() || state.game || state.director || document.hidden || Life.isSafetyPaused(state.data)) return false;
    if (Ritual && Ritual.isDrowsy && Ritual.isDrowsy(state.data, activePetId(), new Date())) return false;  /* 寝ぼけている子は「ん…」だけ。質問を始めると儀式が止まる */
    cancelEcho();
    const director = Brain.startTheme(state.data, new Date(), themeId); if (!director || !director.question) return false;
    state.director = director; window.clearTimeout(state.directorTimer); state.directorTimer = window.setTimeout(() => { if (state.director === director) { hideQuestion(); bubble('また、おはなししようね'); setState(state.data.energy < 30 ? 'sleepy' : 'normal', 0); } }, 30000);
    noteInteraction(); bubble(director.question.question); renderQuestion(director.question); setState('listening', 0); playPetSound('thinking'); return true;
  }
  function applyQuestionReply(reply) {
    if (reply.safety) { pauseForSafety(); state.director = null; hideQuestion(); answer(reply.text, { id:reply.id, soundKind:'danger', forcePetSound:true }); return; }
    if (reply.value && (reply.intent === 'questionNext' || reply.intent === 'questionDone')) Life.recordQuestion(state.data, state.director && state.director.themeId, reply.value, new Date(), { type:reply.answeredQuestionType, id:reply.answeredQuestionId, rawValue:reply.recognizedText });
    if (Week && reply.answeredQuestionType === 'word' && reply.recognizedText) Week.captureFact(state.data, reply.recognizedText, 'word', 'question', new Date());
    if (Week && reply.done && state.data.weekProgress && state.data.weekProgress.dailyBeat === 'question') { Week.advanceBeat(state.data, 'activity'); const activity = Week.DAILY_ACTIVITIES[(state.data.weekProgress.dayIndex || 1) - 1] || Week.DAILY_ACTIVITIES[0]; if (activity) { window.setTimeout(() => { if (!document.hidden && !state.echoSession && !state.game) { bubble(activity.intro || `${activity.title}、しよう`); playPetSound(activity.sound || 'play'); speak(activity.intro || `${activity.title}、しよう`, activity.sound || 'play'); updateScreen(); } }, 700); } }
    if (reply.done || reply.safety) hideQuestion(); else if (reply.nextQuestion) { renderQuestion(reply.nextQuestion); window.clearTimeout(state.directorTimer); state.directorTimer = window.setTimeout(() => { hideQuestion(); bubble('また、おはなししようね'); }, 30000); }
    Life.applyAction(state.data, 'talk'); if (!companionAction('talk')) answer(reply.text, { id:reply.id, soundKind:reply.soundKind || (reply.safety ? 'danger' : 'normal'), forcePetSound:true });
  }
  function handleMessage(value, options = {}) {
    if (stageAsleep()) return; if (Ritual && Ritual.isDrowsy && Ritual.isDrowsy(state.data, activePetId(), new Date())) { $('message-input').value = ''; bubble(Ritual.phrases.drowsy); setState('sleepy', 1200); return; } if (twoPetActive()) cancelTwoPetMoment('conversation');
    const text = clean(value); const alternatives = Array.isArray(options.alternatives) ? options.alternatives : text ? [text] : [];
    noteInteraction(); sulkTalkSoon(); if (state.recognizing) stopRecognition();
    if (text && !options.fromCandidate) { $('recognized-text').textContent = `「${text}」って、きこえたよ`; $('recognized-text').hidden = false; }
    if (Story && state.data && Story.isActive(state.data) && state.data.bondStory.beat !== 'paused') { const storyHandled = handleStoryInput(text, options); if (storyHandled || ['ask-word','confirm-word','classify','stumble','correct-word','recall-use'].includes(state.data.bondStory.beat)) { $('message-input').value = ''; return; } if (storyNoteUnrelated()) { $('message-input').value = ''; return; } }
    if (state.director) {
      setState('thinking', 500); const director = state.director; const reply = Brain.answerQuestion(director, alternatives, state.data, new Date());
      const interruptToken = state.manualInterruptToken; window.setTimeout(() => { if (interruptToken === state.manualInterruptToken && !state.echoSession) applyQuestionReply(reply); }, 220); $('message-input').value = ''; return;
    }
    if (!text) { bubble('きこえなかった。文字でもいいよ'); playPetSound('sad'); setState('sad'); return; }
    setState('thinking', 700); bubble('んーっと…');
    const interruptToken = state.manualInterruptToken; setTimeout(() => { if (interruptToken !== state.manualInterruptToken || state.echoSession) return; const reply = getReply(text); if (reply.safety) pauseForSafety(); if (Week && reply.memoryHit && reply.memoryHit.value && !reply.safety) Week.captureFact(state.data, reply.memoryHit.value, reply.memoryHit.type || 'word', 'conversation', new Date()); Life.applyAction(state.data, 'talk'); if (!companionAction('talk')) answer(reply.text, { id: reply.id, soundKind: reply.safety ? 'danger' : 'normal' }); }, 500);
    $('message-input').value = '';
  }
  function performTouch(kind) {
    if (stageAsleep()) return; performTouchCore(kind); if (kind === 'stroke' || kind === 'tap') tryRitualWake(); if (kind === 'stroke' || kind === 'tap') noteSulkCare();
  }
  function performTouchCore(kind) {
    if (stageAsleep()) return; if (twoPetActive()) { noteTwoPetAction(kind); return; }
    const reply = Brain.touchReply(kind, state.data.lastReplies); Life.applyAction(state.data, kind); noteTwoPetCare(kind); noteTwoPetAction(kind); state.data.lastReplies = [...state.data.lastReplies, reply.id].slice(-12); noteInteraction(); if (companionAction(kind)) { setSeen(); updateScreen(); return; } const storyEvent = storyNoteUnrelated(); if (!storyEvent) { bubble(reply.text); setState(kind === 'hold' || kind === 'stroke' ? 'happy' : 'happy'); playPetSound(kind === 'hold' ? 'normal' : 'happy'); speak(reply.text, kind === 'hold' ? 'normal' : 'happy'); } setSeen(); updateScreen();
  }
  /* --- ぷにの居場所（data-spot 0〜8。0,1,2＝奥／3,4,5＝中／6,7,8＝手前）。見た目は styles.css 担当 --- */
  /* 動き回り方（設計書）：12〜20秒に1回、同じ段に続けて行かないで移る。静かな時間・全員ねんね・困りごとで隠れている・みんなねんねで手前に出ているときは動かない */
  function puniSpotRow(spot) { return Math.floor(Math.max(0, Math.min(8, Math.round(Number(spot)) || 0)) / 3); }
  function nextPuniSpot(current) { const spot = Math.max(0, Math.min(8, Math.round(Number(current)) || 0)); const rows = [0,1,2].filter(row => row !== puniSpotRow(spot)); const row = rows[Math.floor(Math.random() * rows.length)]; return row * 3 + Math.floor(Math.random() * 3); }
  function puniWanderBlocked() { const puni = $('puni'); return Boolean(!state.data || document.hidden || stageAsleep() || (Life && Life.isQuietTime && Life.isQuietTime(new Date())) || (puni && (puni.dataset.hide || puni.dataset.front === 'true'))); }
  function schedulePuniWander() { window.clearTimeout(state.puniWanderTimer); const delay = 12000 + Math.floor(Math.random() * 8000); state.puniWanderTimer = window.setTimeout(() => { state.puniWanderTimer = null; const puni = $('puni'); if (puni && !puniWanderBlocked()) puni.dataset.spot = String(nextPuniSpot(puni.dataset.spot)); schedulePuniWander(); }, delay); }
  function handlePuniPoke() { const puni = $('puni'); if (!puni) return; window.clearTimeout(handlePuniPoke.timer); puni.dataset.poke = 'true'; playPetSound('puni'); handlePuniPoke.timer = window.setTimeout(() => { const p = $('puni'); if (p) delete p.dataset.poke; }, 600); puni.dataset.spot = String(nextPuniSpot(puni.dataset.spot)); schedulePuniWander(); }
  function handleSleepyPetTouch(petNode) { if (!petNode || petNode.dataset.state !== 'sleepy') return; petNode.dataset.doze = 'true'; window.clearTimeout(handleSleepyPetTouch.timer); handleSleepyPetTouch.timer = window.setTimeout(() => { if (petNode && petNode.dataset.state === 'sleepy') delete petNode.dataset.doze; }, 2000); }
  function openPlayMenu() { if (stageAsleep()) return; if (!state.data || state.echoSession || state.game || Life.isSafetyPaused(state.data)) return; cancelTwoPetMoment('play-menu'); cancelCompanionMoment(); $('play-menu-dialog').showModal(); }
  function openEchoPetMenu() { $('play-menu-dialog').close(); ['pet-1','pet-2'].forEach((id, index) => { const sleeping = petSleepingNow(id); const button = $(`echo-pet-${index + 1}-button`); const label = $(`echo-pet-${index + 1}-name`); if (button) button.disabled = sleeping; if (label) label.textContent = `${petInfo(id).name}${sleeping ? '（ねてるよ）' : ''}`; }); $('echo-pet-note').textContent=state.data.echoModeEnabled===true?'まねする子をえらんでね':'おとなと設定してね'; $('echo-pet-dialog').showModal(); }
  function startManualEcho(petId) { $('echo-pet-dialog').close(); if (state.data.echoModeEnabled!==true) { showToast('おとなと設定してね'); return; } startEchoSession('manual',petId); }
  function care(action) {
    if (stageAsleep()) return; if (action === 'pet' || action === 'stroke') { performTouch('stroke'); return; }
    if (action === 'play') { if (twoPetActive()) { noteTwoPetAction('play'); return; } openPlayMenu(); return; }
    if (action === 'sleep') { if (tryRitualTuckIn()) return; if (twoPetActive()) { noteTwoPetAction('sleep'); return; } Life.applyAction(state.data, 'sleep'); noteTwoPetCare('sleep'); noteTwoPetAction('sleep'); noteInteraction(); if (companionAction('sleep')) { setSeen(); updateScreen(); return; } const storyEvent = storyNoteUnrelated(); if (!storyEvent) { bubble('おやすみ。すやすや'); setState('sleepy', 2500); playPetSound('sleepy'); speak('おやすみ。すやすや', 'sleepy'); } setSeen(); updateScreen(); }
  }
  function moveGameTarget() { const board = $('game-board'); const target = $('game-target'); const maxX = Math.max(10, board.clientWidth - 78); const maxY = Math.max(10, board.clientHeight - 78); target.style.left = `${10 + Math.floor(Math.random() * maxX)}px`; target.style.top = `${10 + Math.floor(Math.random() * maxY)}px`; }
  function finishMiniGame(reason = 'done') { if (!state.game) return; const score = state.game.score; const gameName = state.game.name || 'ひかりをつかまえる'; const endText = state.game.end || 'いっしょにできたね'; const soundKind = state.game.sound || (score >= 8 ? 'happy' : 'play'); window.clearInterval(state.game.timer); state.game = null; $('game-panel').hidden = true; Life.applyGameResult(state.data, score, new Date()); if (Week) { Week.capturePlay(state.data, gameName, score, new Date()); if (state.data.weekProgress && state.data.weekProgress.dailyBeat === 'activity') Week.advanceBeat(state.data, 'callback'); } const text = endText; stopPetAudio(); if (!companionAction('play')) { bubble(reason === 'time' ? `${text}。またあそぼう` : text); setState(score >= 8 ? 'happy' : 'normal'); playPetSound(soundKind); speak(text, soundKind); } noteSulkCare(); setSeen(); updateScreen(); }
  function startMiniGame() { if (stageAsleep()) return; if (state.game) return; cancelTwoPetMoment('mini-game'); cancelEcho(); noteInteraction(); storyNoteUnrelated(); const activity = Week && (!Story || !Story.isActive(state.data)) ? Week.nextActivity(state.data, new Date()) : null; state.game = { score:0, left:15, timer:null, name:activity ? activity.name : 'ひかりをつかまえる', end:activity ? activity.end : 'いっしょにできたね', sound:activity ? activity.sound : 'play' }; $('game-title').textContent = state.game.name; $('game-score').textContent = '0'; $('game-time').textContent = '15'; $('game-status').textContent = activity ? (activity.intro || 'ひかりをおしてね') : 'ひかりをおしてね'; $('game-panel').hidden = false; moveGameTarget(); state.game.timer = window.setInterval(() => { if (!state.game) return; state.game.left -= 1; $('game-time').textContent = String(state.game.left); if (state.game.left <= 0) finishMiniGame('time'); }, 1000); $('game-target').focus(); setState('happy', 0); }
  function scoreGameTarget() { if (!state.game) return; state.game.score += 1; $('game-score').textContent = String(state.game.score); $('game-status').textContent = state.game.score >= 8 ? 'きらきら！' : 'つかまえた！'; playPetSound('play'); moveGameTarget(); if (state.game.score >= 8) finishMiniGame('done'); }
  function startRecognition() {
    if (stageAsleep()) return; if (!state.data.speechInputEnabled) { showTextEntry('音声入力はオフだよ。文字でどうぞ'); return; }
    if (!Recognition) { showTextEntry('音声がきこえないときは、文字でどうぞ'); return; }
    try {
      if (!state.recognition) { state.recognition = new Recognition(); state.recognition.lang = 'ja-JP'; state.recognition.interimResults = false; state.recognition.maxAlternatives = 5; state.recognition.onresult = event => { if (!state.recognizing || state.echoSession) return; state.recognitionHadResult = true; const alternatives = Array.from(event.results[0] || []).slice(0, 5).map(item => item.transcript); const selected = alternatives[0] || ''; handleMessage(selected, { alternatives }); }; state.recognition.onerror = () => { state.recognitionHadResult = true; stopRecognition(); if (state.director) handleMessage('', { empty:true }); else { bubble('きこえなかった。文字でもいいよ'); showTextEntry('きこえなかった。文字でもいいよ'); playPetSound('sad'); setState('sad'); } }; state.recognition.onend = () => { state.recognizing = false; $('talk-button').classList.remove('is-listening'); $('talk-button').innerHTML = '<span aria-hidden="true">●</span>おはなし'; if (!state.recognitionHadResult && state.director) handleMessage('', { empty:true }); state.recognitionHadResult = true; if (pet.dataset.state === 'listening') setState('normal', 0); }; }
      state.recognitionHadResult = false; state.recognizing = true; $('talk-button').classList.add('is-listening'); $('talk-button').innerHTML = '<span aria-hidden="true">●</span>きいてるよ'; setState('listening', 0); bubble('おはなし、きくよ'); state.recognition.start();
    } catch (_) { stopRecognition(); showTextEntry('文字でおはなししよう'); }
  }
  function stopRecognition() { if (!state.recognizing) return; try { state.recognition.stop(); } catch (_) {} state.recognizing = false; $('talk-button').classList.remove('is-listening'); $('talk-button').innerHTML = '<span aria-hidden="true">●</span>おはなし'; }
  function toggleTextEntry(open) { $('text-entry').hidden = !open; $('keyboard-toggle').setAttribute('aria-pressed', String(open)); $('keyboard-toggle').setAttribute('aria-label', open ? '文字入力を閉じる' : '文字入力を開く'); if (open) $('message-input').focus(); }
  function showTextEntry(message) { toggleTextEntry(true); $('input-hint').textContent = message || 'ことばを入力してね'; }
  async function setCamera(enabled) {
    state.data.cameraEnabled = enabled;
    if (!enabled) { stopCamera(); save(); updateScreen(); return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { $('camera-toggle').checked = false; state.data.cameraEnabled = false; $('camera-message').textContent = 'この端末ではカメラを使えません。'; $('camera-box').hidden = false; save(); return; }
    try { state.cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode:'user' }, audio:false }); $('camera-video').srcObject = state.cameraStream; $('camera-message').textContent = 'カメラの映像は保存されません。'; $('camera-box').hidden = false; save(); }
    catch (_) { state.data.cameraEnabled = false; $('camera-toggle').checked = false; $('camera-message').textContent = 'カメラは使わなくても、ぜんぶ遊べるよ。'; $('camera-box').hidden = false; save(); }
  }
  function stopCamera() { if (state.cameraStream) state.cameraStream.getTracks().forEach(track => track.stop()); state.cameraStream = null; $('camera-video').srcObject = null; $('camera-box').hidden = true; }
  function clearSpontaneous() { window.clearTimeout(state.spontaneousTimer); window.clearTimeout(state.monologueTimer); window.clearTimeout(state.initialPromptTimer); window.clearTimeout(state.echoInviteTimer); state.spontaneousTimer = null; state.monologueTimer = null; state.initialPromptTimer = null; state.echoInviteTimer = null; }
  function scheduleEchoInvite() {
    window.clearTimeout(state.echoInviteTimer); state.echoInviteTimer = null;
    if (stageAsleep() || !state.data || state.data.echoModeEnabled !== true || state.data.soundMode === 'text' || state.echoSession || companionActive() || document.hidden) return;
    const daily = Life.echoDaily(state.data, new Date());
    if (!daily || daily.echoInviteCount >= 5) return;
    const now = Date.now(); const lastInvite = Date.parse(daily.lastEchoInviteAt || '');
    const firstDelay = 120000 + Math.floor(Math.random() * 120001);
    const intervalDelay = Number.isFinite(lastInvite) ? Math.max(0, lastInvite + 20 * 60 * 1000 - now) : firstDelay;
    const idleDelay = Math.max(0, state.lastInteractionAt + 45000 - now);
    const noInviteDelay = Math.max(0, state.echoNoInviteUntil - now);
    const delay = Math.max(1000, intervalDelay, idleDelay, noInviteDelay);
    state.echoInviteTimer = window.setTimeout(() => {
      state.echoInviteTimer = null;
      if (!stageAsleep() && !sulkingNow() && Life.canInviteEcho(state.data, { now:new Date(), visible:!document.hidden, lastInteractionAt:state.lastInteractionAt, blocked:echoBlocked(), quickExitUntil:state.echoNoInviteUntil })) {
        if (Life.recordEchoInvite(state.data, new Date())) { save(); startEchoSession('spontaneous'); return; }
      }
      scheduleEchoInvite();
    }, delay);
  }
  function scheduleSpontaneous() {
    clearSpontaneous(); if (stageAsleep() || document.hidden || ($('setup-dialog') && $('setup-dialog').open) || (state.data && Life.isSafetyPaused(state.data))) return;
    const scheduleMovement = () => { state.spontaneousTimer = window.setTimeout(() => { if (!stageAsleep() && !document.hidden && !state.echoSession && !companionActive() && !state.game) setState('thinking', 800); if (!document.hidden) scheduleMovement(); }, 12000 + Math.floor(Math.random() * 16000)); };
    const scheduleMonologue = () => { state.monologueTimer = window.setTimeout(() => { if (!stageAsleep() && !document.hidden && !state.echoSession && !companionActive() && !twoPetIntroductionPending() && !state.game && !state.director && !Life.isSafetyPaused(state.data) && !sulkingNow() && Date.now() - state.lastInteractionAt >= 60000) { if (Story && Story.isActive(state.data)) { if (!maybeStoryRecall() && !startStoryFlow()) { const event = Story.nextSmallEvent(state.data, new Date()); if (event) { storyPresent(event); save(); } } } else if (!weekStartDay() && !weekSpontaneous() && !weekCallback()) { const event = Story && Story.nextSmallEvent(state.data, new Date()); if (event) { storyPresent(event); save(); } else if (!startConversationTheme()) { const candidate = nextSpontaneousLine(); if (candidate) { bubble(candidate.text); state.lastSpontaneousAt = Date.now(); setState('talking', 0); window.setTimeout(() => setState(state.data.energy < 30 ? 'sleepy' : 'normal', 2000), 2000); if (Life.canSpontaneousSpeak({ now:new Date(), lastInteractionAt:state.lastInteractionAt })) speak(candidate.text, 'normal'); } } } } if (!document.hidden) scheduleMonologue(); }, 60000 + Math.floor(Math.random() * 90000)); };
    scheduleMovement(); scheduleMonologue();
    scheduleEchoInvite();
    if ((!state.data.daily.talk || (Story && Story.isActive(state.data) && state.data.bondStory.beat === 'idle')) && !companionActive() && !twoPetIntroductionPending() && !state.director && !Life.isSafetyPaused(state.data)) state.initialPromptTimer = window.setTimeout(() => { if (!stageAsleep() && !document.hidden && !state.echoSession && !companionActive() && !twoPetIntroductionPending() && !state.game && !state.director && !Life.isSafetyPaused(state.data) && !sulkingNow()) { if (Story && Story.isActive(state.data)) startStoryFlow(); else if (!weekStartDay()) startConversationTheme(); } }, 8000 + Math.floor(Math.random() * 7000));
  }
  function noteInteraction() { unlockAudio(); state.lastInteractionAt = Date.now(); scheduleSpontaneous(); scheduleCompanionMoment(); scheduleTwoPetMoment(); scheduleTrouble(); }
  function pauseForSafety() { if (!state.data) return; cancelTwoPetMoment('safety'); if (state.activityLock) state.activityLock.activateHardBlock('safety'); cancelCompanionMoment(); cancelEcho(); discardTuningBlob(); Life.pauseSafety(state.data, new Date()); if (state.voice) state.voice.invalidate(); clearSpontaneous(); window.clearTimeout(state.storyRecallTimer); state.storyRecallTimer = null; window.clearTimeout(state.weekTimer); state.weekTimer = null; if (state.recognizing) stopRecognition(); if (state.director) { state.director = null; hideQuestion(); } save(); }
  function weekStartDay() { if (!Week || !state.data || state.echoSession || companionActive() || twoPetIntroductionPending() || Life.isSafetyPaused(state.data) || state.game || state.director || (Story && Story.isActive(state.data) && state.data.weekProgress && state.data.weekProgress.dayIndex === 1)) return false; const event = Week.visit(state.data, new Date()); if (!event) return false; Week.advanceBeat(state.data, 'question'); bubble(event.text); setState('thinking', 0); playPetSound(event.sound || 'call'); speak(event.text, event.sound || 'call'); save(); updateScreen(); const themeByDay = [null,'favorite-food','mood','treasure','copycat','together','thank-you']; const themeId = themeByDay[event.dayIndex]; if (themeId) window.setTimeout(() => { if (!document.hidden && !state.echoSession && !companionActive() && !twoPetIntroductionPending() && !Life.isSafetyPaused(state.data) && !state.game && !state.director && !(Story && Story.isActive(state.data))) startConversationTheme(themeId); }, 900); return true; }
  function weekSpontaneous() { if (!Week || !state.data || state.echoSession || companionActive() || twoPetIntroductionPending() || Life.isSafetyPaused(state.data) || document.hidden || state.game || state.director || (Story && Story.isActive(state.data))) return false; const event = Week.dailyEvent(state.data, new Date()); if (!event) return false; bubble(event.text); setState('talking', 0); playPetSound(event.sound || 'curious'); speak(event.text, event.sound || 'curious'); save(); updateScreen(); return true; }
  function weekCallback() { if (!Week || !state.data || state.echoSession || companionActive() || twoPetIntroductionPending() || Life.isSafetyPaused(state.data) || document.hidden || state.game || state.director || (Story && Story.isActive(state.data))) return false; const event = Week.callback(state.data, new Date()); if (!event) return false; bubble(event.text); setState('talking', 0); playPetSound(event.sound || 'happy'); speak(event.text, event.sound || 'happy'); save(); updateScreen(); return true; }
  function nextSpontaneousLine() { const recent = (state.data.daily.seenReplyIds || []).filter(id => String(id).startsWith('mono:')).map(id => String(id).slice(5)); const candidate = Brain.spontaneousPick(state.data, new Date(), recent); if (!candidate) return null; state.data.daily.seenReplyIds = [...(state.data.daily.seenReplyIds || []), `mono:${candidate.id}`].slice(-50); save(); return candidate; }
  /* --- 困りごとと助け（trouble-engine.js が無くても落ちない。部品が無くても落ちない） --- */
  function troubleData() { return state.data && state.data.trouble ? state.data.trouble : null; }
  function troubleOccurrences() { const trouble = troubleData(); if (!trouble) return 0; const daily = trouble.daily && typeof trouble.daily === 'object' ? trouble.daily : {}; const kinds = Array.isArray(daily.kinds) ? daily.kinds : []; return Math.max(Math.max(0, Number(daily.count) || 0), kinds.length); }
  function troubleFastMode() { try { return localStorage.getItem('little-companion-trouble-fast') === '1'; } catch (_) { return false; } }
  function troubleBlocked() {
    if (!Trouble) return true;
    const modalOpen = Boolean(($('setup-dialog') && $('setup-dialog').open) || ($('parent-dialog') && $('parent-dialog').open) || !$('forget-confirm-box').hidden || !$('voice-clear-confirm-box').hidden);
    const voiceBusy = Boolean(state.voice && (state.voice.pendingRecording || state.voice.permissionInFlight || state.voice.recording));
    const storyBusy = Boolean(Story && Story.isActive(state.data) && state.data.bondStory && state.data.bondStory.beat !== 'idle');
    return Boolean(!state.data || document.hidden || state.data.soundMode === 'text' || Life.isQuietTime(new Date()) || Life.isSafetyPaused(state.data) || modalOpen || state.game || state.recognizing || state.director || storyBusy || voiceBusy || Boolean(state.tuningBlob) || Boolean(state.audioNodes.length) || Boolean(speechAvailable && window.speechSynthesis.speaking) || Boolean(state.echoSession) || companionActive() || twoPetActive() || Boolean(state.activityLock && state.activityLock.snapshot().owner));
  }
  function troubleMissingPartKinds(activePetId) {
    const missing = [];
    if (!$('trouble-book')) missing.push('book');
    if (!$('trouble-ball')) missing.push('ball');
    if (!$('trouble-window')) missing.push('window');
    if (!$(`trouble-leaf-${activePetId === 'pet-2' ? '2' : '1'}`)) missing.push('leaf');
    if (!$('puni')) missing.push('puni');
    return missing;
  }
  function scheduleTrouble() {
    if (!Trouble || !state.data) return;
    window.clearTimeout(state.troubleTimer); state.troubleTimer = null;
    const hadActive = Boolean(troubleData() && troubleData().active);
    Trouble.troubleDailyReset(state.data, new Date());
    if (hadActive && !(troubleData() && troubleData().active)) { state.troubleHiccupTaps = 0; stopTroubleReminder(); applyTroubleAttributes(); save(); }
    if (!state.data.trouble.enabled || (troubleData() && troubleData().active) || troubleOccurrences() >= 2) { state.troubleNextAt = 0; return; }
    const now = Date.now();
    if (!state.troubleNextAt || state.troubleNextAt <= now) {
      const delay = troubleOccurrences() === 0 ? (troubleFastMode() ? 5000 : 120000 + Math.floor(Math.random() * 180001)) : (troubleFastMode() ? 20000 : 900000 + Math.floor(Math.random() * 60001));
      state.troubleNextAt = now + delay;
    }
    const token = ++state.troubleToken;
    state.troubleTimer = window.setTimeout(() => { if (token === state.troubleToken) fireTrouble(); }, Math.max(500, state.troubleNextAt - now));
  }
  function fireTrouble() {
    state.troubleTimer = null;
    if (!Trouble || !state.data) return;
    const trouble = troubleData();
    if (!trouble || !trouble.enabled || trouble.active || troubleOccurrences() >= 2) { state.troubleNextAt = 0; return; }
    if (troubleBlocked()) {
      const hardWait = document.hidden || Life.isQuietTime(new Date()) || stageAsleep() || Life.isSafetyPaused(state.data) || Boolean($('setup-dialog') && $('setup-dialog').open);
      const token = ++state.troubleToken;
      state.troubleTimer = window.setTimeout(() => { if (token === state.troubleToken) fireTrouble(); }, hardWait ? 60000 : 3000);
      return;
    }
    state.troubleNextAt = 0;
    const now = new Date();
    const ritualAwake = stageAwakePetIds(now).filter(id => !(Ritual && Ritual.isDrowsy(state.data, id, now)));
    const stageActive = ritualAwake.includes(activePetId()) ? activePetId() : ritualAwake[0] || '';
    const kind = Trouble.pickTrouble(state.data, { activePetId: stageActive, awakePetIds: ritualAwake, quiet: Life.isQuietTime(now), allAsleep: ritualAwake.length === 0, enabled: trouble.enabled !== false, exclude: troubleMissingPartKinds(stageActive) }, now);
    if (!kind) return;
    const petId = kind === 'book' && ritualAwake.includes('pet-2') ? 'pet-2' : stageActive;
    beginTrouble(kind, petId);
  }
  function applyTroubleAttributes() {
    const stage = document.querySelector('.pet-stage');
    const active = troubleData() && troubleData().active;
    ['pet-1','pet-2'].forEach(id => { const node = petNode(id); if (node) delete node.dataset.trouble; });
    const puni = $('puni'); if (puni) delete puni.dataset.hide;
    if (stage) { delete stage.dataset.trouble; delete stage.dataset.troublePet; }
    if (!active) return;
    if (stage) { stage.dataset.trouble = active.kind; stage.dataset.troublePet = active.petId; }
    const node = petNode(active.petId); if (node) node.dataset.trouble = active.kind;
    if (active.kind === 'puni' && puni && puni.dataset.front !== 'true') puni.dataset.hide = active.hide || 'right';
  }
  function beginTrouble(kind, petId) {
    if (!Trouble) return;
    const active = Trouble.startTrouble(state.data, kind, petId, new Date());
    if (!active) return;
    if (kind === 'puni' && !active.hide) active.hide = ['left','right','bottom'][Math.floor(Math.random() * 3)];
    state.troubleHiccupTaps = 0;
    save(); applyTroubleAttributes(); startTroubleReminder();
    showPetBubble(petId, Trouble.phrases[kind].troubled);
    playPetSound('curious');
    speak(Trouble.phrases[kind].troubled, 'curious');
  }
  function startTroubleReminder() {
    window.clearTimeout(state.troubleRemindTimer); state.troubleRemindTimer = null;
    if (!Trouble) return;
    const token = ++state.troubleRemindToken;
    const remind = () => {
      if (token !== state.troubleRemindToken) return;
      const active = troubleData() && troubleData().active;
      if (!active) return;
      if (!document.hidden && !troubleBlocked() && !petSleepingNow(active.petId)) { showPetBubble(active.petId, Trouble.phrases[active.kind].troubled); playPetSound('curious'); }
      state.troubleRemindTimer = window.setTimeout(remind, 30000);
    };
    state.troubleRemindTimer = window.setTimeout(remind, 30000);
  }
  function stopTroubleReminder() { window.clearTimeout(state.troubleRemindTimer); state.troubleRemindTimer = null; state.troubleRemindToken += 1; }
  function resolveActiveTrouble() {
    const trouble = troubleData();
    if (!Trouble || !trouble || !trouble.active) return false;
    const kind = trouble.active.kind; const petId = trouble.active.petId;
    Trouble.resolveTrouble(state.data, new Date());
    stopTroubleReminder(); state.troubleHiccupTaps = 0;
    applyTroubleAttributes();
    const node = petNode(petId); if (node) node.style.setProperty('--look-x', '0px');
    setPetState(petId, 'happy');
    const text = Trouble.resolvedPhrase(kind, state.data.childName);
    showPetBubble(petId, text);
    playPetSound('happy');
    speak(text, 'happy');
    noteSulkCare();
    save(); updateScreen();
    scheduleTrouble();
    return true;
  }
  function tryResolveTroubleTarget(kind, petId = '') {
    const trouble = troubleData();
    if (!trouble || !trouble.active || trouble.active.kind !== kind) return false;
    if (petId && trouble.active.petId !== petId) return false;
    return resolveActiveTrouble();
  }
  function handleTroublePuniPoke(event) {
    const puni = $('puni');
    if (!puni || !puni.dataset.hide) return;
    if (tryResolveTroubleTarget('puni')) { event.preventDefault(); event.stopImmediatePropagation(); }
  }
  function noteTroubleHiccupTap(petId) {
    const trouble = troubleData();
    if (!trouble || !trouble.active || trouble.active.kind !== 'hiccup' || trouble.active.petId !== petId) return false;
    state.troubleHiccupTaps += 1;
    if (state.troubleHiccupTaps >= 3) return resolveActiveTrouble();
    return false;
  }
  function updateTroublePanel() {
    if (!Trouble || !state.data || !state.data.trouble) return;
    const toggle = $('trouble-toggle'); if (toggle) toggle.checked = state.data.trouble.enabled !== false;
    const todayCount = $('trouble-count-today'); if (todayCount) todayCount.textContent = String(Math.max(0, Number(state.data.trouble.daily && state.data.trouble.daily.count) || 0));
    const totalCount = $('trouble-count-total'); if (totalCount) totalCount.textContent = String(Math.max(0, Number(state.data.trouble.helpTotal) || 0));
  }
  function restoreTroubleOnLoad() {
    if (!Trouble || !state.data) return;
    Trouble.troubleDailyReset(state.data, new Date());
    if (troubleData() && troubleData().active) { state.troubleHiccupTaps = 0; applyTroubleAttributes(); startTroubleReminder(); }
  }
  /* --- 朝と夜の儀式（ritual-engine.js が無くても落ちない。部品が無くても落ちない） --- */
  /* 受け口の阻止条件＝troubleBlocked() から isQuietTime を除いたもの。
     さらに「直前の既存の反応の効果音・読み上げ」は除く（なでるの反応が必ず音を鳴らすため、それで儀式が止まらないように） */
  function ritualAcceptBlocked() {
    if (!Ritual) return true;
    const modalOpen = Boolean(($('setup-dialog') && $('setup-dialog').open) || ($('parent-dialog') && $('parent-dialog').open) || !$('forget-confirm-box').hidden || !$('voice-clear-confirm-box').hidden);
    const voiceBusy = Boolean(state.voice && (state.voice.pendingRecording || state.voice.permissionInFlight || state.voice.recording));
    const storyBusy = Boolean(Story && Story.isActive(state.data) && state.data.bondStory && state.data.bondStory.beat !== 'idle');
    return Boolean(!state.data || document.hidden || state.data.soundMode === 'text' || Life.isSafetyPaused(state.data) || modalOpen || state.game || state.recognizing || state.director || storyBusy || voiceBusy || Boolean(state.tuningBlob) || Boolean(state.echoSession) || companionActive() || twoPetActive() || Boolean(state.activityLock && state.activityLock.snapshot().owner));
  }
  function ritualTick(now = new Date()) {
    if (!Ritual || !state.data) return;
    const changed = Ritual.ritualDailyReset(state.data, now);
    const autoWoken = Ritual.autoWake(state.data, now);
    if (changed || autoWoken.length) save();
    applyRitualAttributes();
    scheduleRitualYawns();
    if (autoWoken.length && !document.hidden) { const active = activePetId(); if (autoWoken.includes(active) && !petAsleep(active)) { showPetBubble(active, Ritual.phrases.autoWake); setPetState(active, 'sleepy'); } }
  }
  function applyRitualAttributes() {
    if (!Ritual || !state.data) return;
    const now = new Date();
    const stage = document.querySelector('.pet-stage');
    ['pet-1','pet-2'].forEach(id => {
      const node = petNode(id);
      if (!node) return;
      if (node.dataset.ritual !== 'yawn') { if (Ritual.isDrowsy(state.data, id, now)) node.dataset.ritual = 'drowsy'; else delete node.dataset.ritual; }
      const mood = Ritual.morningMood(state.data, id, now);
      if (mood) node.dataset.ritualMood = mood; else delete node.dataset.ritualMood;
    });
    if (stage && !state.ritualMealBusy) {
      if (Ritual.mealReady(state.data, { awakePetIds: ritualAwakePetIds(now) }, now)) stage.dataset.meal = 'ready'; else delete stage.dataset.meal;
    }
  }
  function addRitualBond(points) { state.data.bond = Life.clamp((Number(state.data.bond) || 0) + points); state.data.bondStage = Math.max(Number(state.data.bondStage) || 0, Life.bondStage(state.data.bond)); Life.syncLegacyToActivePet(state.data); }
  /* なでる／体タップの既存の反応のあとに呼ぶ。1回（前夜に③無しは2回）で起きる */
  function tryRitualWake(petId = activePetId()) {
    if (!Ritual || !state.data) return false;
    if (!Ritual.isDrowsy(state.data, petId, new Date())) return false;
    if (ritualAcceptBlocked()) return false;
    const result = Ritual.wake(state.data, petId, new Date());
    if (!result.done) { showPetBubble(petId, sulkNameless(result.phrase)); save(); return false; }
    setPetState(petId, 'happy');
    const wakePhrase = sulkNameless(result.phrase);
    bubble(wakePhrase); showPetBubble(petId, wakePhrase);
    playPetSound('happy'); speak(wakePhrase, 'happy');
    addRitualBond(1);
    const mood = Ritual.morningMood(state.data, petId, new Date());
    if (mood === 'tired') state.data.energy = Life.clamp(state.data.energy - 10);
    if (mood === 'hungry') state.data.mood = Life.clamp(state.data.mood - 10);
    applyRitualAttributes();
    /* 起こした直後の一言を2秒後、きのう助けてくれたねを4秒後に回す */
    const opening = Ritual.openingPhrase(state.data, petId, new Date());
    const helpedKind = Trouble ? Trouble.helpedYesterday(state.data, new Date()) : null;
    if (opening) window.setTimeout(() => { if (activePetId() === petId && !petAsleep(petId)) { bubble(opening); showPetBubble(petId, opening); } }, 2000);
    if (helpedKind && Trouble.phrases[helpedKind]) window.setTimeout(() => { if (activePetId() === petId && !petAsleep(petId)) { const text = Trouble.phrases[helpedKind].nextDay; bubble(text); showPetBubble(petId, text); } }, 4000);
    save(); updateScreen();
    return true;
  }
  /* #ritual-bowl クリック → eating 2秒 → eaten 1.5秒 → 消える */
  function tryRitualFeed() {
    if (!Ritual || !state.data) return false;
    const now = new Date();
    const awake = ritualAwakePetIds(now);
    if (!Ritual.mealReady(state.data, { awakePetIds: awake }, now)) return false;
    if (ritualAcceptBlocked()) return false;
    const petIds = Ritual.feed(state.data, awake, now);
    save();
    noteSulkCare();
    const stage = document.querySelector('.pet-stage');
    const token = ++state.ritualMealToken;
    state.ritualMealBusy = true;
    if (stage) stage.dataset.meal = 'eating';
    const speaker = petIds.includes(activePetId()) ? activePetId() : petIds[0];
    if (speaker) { showPetBubble(speaker, Ritual.phrases.meal); setPetState(speaker, 'happy'); bubble(Ritual.phrases.meal); }
    window.setTimeout(() => { if (token !== state.ritualMealToken) return; if (stage) stage.dataset.meal = 'eaten'; playPetSound('happy'); petIds.forEach(id => setPetState(id, 'happy')); }, 2000);
    window.setTimeout(() => { if (token !== state.ritualMealToken) return; state.ritualMealBusy = false; if (stage) delete stage.dataset.meal; if (petIds.length) addRitualBond(petIds.length); clearPetBubbles(); save(); updateScreen(); }, 3500);
    return true;
  }
  /* action==='sleep' の先頭で呼ぶ。窓の中なら儀式（幕1.5秒→一言→その場で眠る） */
  function tryRitualTuckIn() {
    if (!Ritual || !state.data) return false;
    const petId = activePetId();
    if (!Ritual.canTuckIn(state.data, petId, new Date())) return false;
    if (ritualAcceptBlocked()) return false;
    const entry = Ritual.tuckIn(state.data, petId, new Date());
    if (!entry) return false;
    save();
    noteSulkCare();
    const dim = $('ritual-dim');
    if (dim) { dim.dataset.dim = 'on'; window.setTimeout(() => { delete dim.dataset.dim; }, 1500); }
    window.setTimeout(() => {
      const text = sulkNameless(Ritual.withName(Ritual.phrases.tuckIn, state.data.childName));
      bubble(text); showPetBubble(petId, text);
      speak(text, 'sleepy'); playPetSound('sleepy');
      setPetState(petId, 'sleepy');
      addRitualBond(1);
      save(); renderTwoPets(); applyRitualAttributes(); updateScreen();
    }, 1500);
    return true;
  }
  /* あくび：③の窓の中で3分に1回、音なし・言葉なし */
  function scheduleRitualYawns() {
    window.clearInterval(state.ritualYawnTimer); state.ritualYawnTimer = null;
    if (!Ritual || !state.data || !state.data.ritual || state.data.ritual.enabled === false) return;
    state.ritualYawnTimer = window.setInterval(() => {
      if (!state.data || document.hidden || state.echoSession || state.game) return;
      const now = new Date();
      ['pet-1','pet-2'].forEach(id => {
        if (petAsleep(id, now) || !Ritual.yawnDue(state.data, id, now)) return;
        const node = petNode(id);
        if (!node || node.dataset.ritual === 'yawn') return;
        Ritual.noteYawn(state.data, id, now); save();
        node.dataset.ritual = 'yawn';
        window.setTimeout(() => { const n = petNode(id); if (n && n.dataset.ritual === 'yawn') { delete n.dataset.ritual; applyRitualAttributes(); } }, 1500);
      });
    }, 15000);
  }
  function updateRitualPanel() {
    if (!Ritual || !state.data || !state.data.ritual) return;
    applyRitualAttributes();
    const toggle = $('ritual-toggle'); if (toggle) toggle.checked = state.data.ritual.enabled !== false;
    const todayRow = $('ritual-today');
    if (todayRow) { const summary = Ritual.todaySummary(state.data); todayRow.textContent = `起こした ${summary.woke}／ごはん ${summary.meal ? '○' : '－'}／寝かしつけ ${summary.tucked}`; }
    const streakRow = $('ritual-streak');
    if (streakRow) streakRow.textContent = `ぜんぶできた日 ${Math.max(0, Number(state.data.ritual.streak) || 0)}`;
  }
  /* --- 拗ねる・戻る（sulk-engine.js が無くても落ちない。部品が無くても落ちない） --- */
  function sulkingNow() { return Boolean(Sulk && state.data && Sulk.isSulking(state.data, new Date())); }
  /* 遊びの状態（この間は data-sulk の見た目を止める） */
  function sulkStatePlaying(value) { return ['happy', 'talking', 'listening', 'thinking'].includes(value) || String(value || '').indexOf('copy-') === 0; }
  /* data-sulk の付け外し。JS は属性を付けるだけで、強さは CSS 側が持つ（設計書「表示の優先順位」） */
  function refreshSulkVisual() {
    if (!Sulk || !state.data) return;
    const sulking = Sulk.isSulking(state.data, new Date());
    if (!sulking) {
      ['pet-1', 'pet-2'].forEach(id => { const node = petNode(id); if (node && node.dataset.sulk !== 'half') delete node.dataset.sulk; });
      clearSulkResume();
      return;
    }
    const playing = ['pet-1', 'pet-2'].some(id => { const node = petNode(id); return node && sulkStatePlaying(node.dataset.state); });
    if (playing) {
      state.sulkPlayingSeen = true;
      ['pet-1', 'pet-2'].forEach(id => { const node = petNode(id); if (node && node.dataset.sulk !== 'half') delete node.dataset.sulk; });
      /* 遊び中は5秒タイマーだけ止める（「遊んでいた」印は消さない。消すと終わった直後に背中へ戻ってしまう） */
      window.clearTimeout(state.sulkResumeTimer); state.sulkResumeTimer = null; state.sulkResumeAt = 0;
      return;
    }
    /* 遊びが終わったら5秒だけ待って戻す（タイマーは1本） */
    if (state.sulkPlayingSeen) { state.sulkPlayingSeen = false; state.sulkResumeAt = Date.now() + 5000; }
    if (state.sulkResumeAt && state.sulkResumeAt > Date.now()) { armSulkResume(); return; }
    ['pet-1', 'pet-2'].forEach(id => { const node = petNode(id); if (node && node.dataset.sulk !== 'half') node.dataset.sulk = 'away'; });
  }
  function armSulkResume() { window.clearTimeout(state.sulkResumeTimer); state.sulkResumeTimer = window.setTimeout(() => { state.sulkResumeTimer = null; refreshSulkVisual(); }, Math.max(200, (Number(state.sulkResumeAt) || 0) - Date.now())); }
  function clearSulkResume() { window.clearTimeout(state.sulkResumeTimer); state.sulkResumeTimer = null; state.sulkResumeAt = 0; state.sulkPlayingSeen = false; }
  function sulkTick(now = new Date()) { if (!Sulk || !state.data) return; refreshSulkVisual(); updateSulkPanel(); }
  /* 起動時・再表示時に呼ぶ。前回から3日以上あいていればその場で拗ねる */
  function sulkOnOpen() {
    if (!Sulk || !state.data) return false;
    const entered = Sulk.onOpen(state.data, new Date());
    save();
    refreshSulkVisual();
    updateSulkPanel();
    return entered;
  }
  /* 世話の各受け口の「あと」に呼ぶ。戻った瞬間の進行（half3秒→おかえり）はここで行う */
  function noteSulkCare() {
    if (!Sulk || !state.data) return false;
    const returned = Sulk.care(state.data, new Date());
    if (!returned) return false;
    clearSulkResume();
    save();
    ['pet-1', 'pet-2'].forEach(id => { const node = petNode(id); if (node) node.dataset.sulk = 'half'; });
    const petId = activePetId();
    bubble(Sulk.phrases.half); showPetBubble(petId, Sulk.phrases.half);
    speak(Sulk.phrases.half, 'curious');
    window.clearTimeout(state.sulkHalfTimer);
    state.sulkHalfTimer = window.setTimeout(() => {
      state.sulkHalfTimer = null;
      ['pet-1', 'pet-2'].forEach(id => { const node = petNode(id); if (node) delete node.dataset.sulk; });
      refreshSulkVisual();
      const text = Sulk.withName(Sulk.phrases.back, state.data.childName);
      bubble(text); showPetBubble(petId, text);
      setPetState(petId, 'happy');
      playPetSound('happy');
      speak(text, 'happy');
      save(); updateScreen();
    }, 3000);
    return true;
  }
  /* 世話に数えないこと（おはなし・まねっこ）。返った言葉があれば出す。戻さない */
  function noteSulkTalk() {
    if (!Sulk || !state.data) return '';
    const word = Sulk.noteTalk(state.data, new Date());
    if (word) save();
    return word;
  }
  /* 拗ねている間は名前を呼ばない（既存の挨拶の「○○ちゃん」を外す） */
  function sulkNameless(text) {
    const name = String(state.data && state.data.childName || '').trim();
    return sulkingNow() && name ? String(text).split(`、${name}ちゃん`).join('') : text;
  }
  function updateSulkPanel() {
    if (!Sulk || !state.data || !state.data.sulk) return;
    const toggle = $('sulk-toggle'); if (toggle) toggle.checked = state.data.sulk.enabled !== false;
    const status = $('sulk-status'); if (!status) return;
    status.textContent = sulkingNow() ? `すねている（${Math.max(1, Sulk.daysAway(state.data, new Date()))}日ぶり）` : 'ふつう';
  }
  /* おはなしの返事が終わってから、小さく一言出す（世話に数えないので戻さない） */
  function sulkTalkSoon(petId = activePetId()) {
    const word = noteSulkTalk();
    if (!word) return;
    window.setTimeout(() => { if (!state.echoSession && !stageAsleep() && !petSleepingNow(petId)) { showPetBubble(petId, word); playPetSound('quiet'); } }, 3200);
  }
  function welcomeOnOpen(previousSeen, firstToday) { if (stageAsleep()) { setState('sleepy', 0); return; } if (Ritual && Ritual.isDrowsy && Ritual.isDrowsy(state.data, activePetId(), new Date())) { bubble(Ritual.phrases.drowsy); setState('sleepy', 1500); return; } if (sulkingNow()) { bubble(Sulk.phrases.first); return; } const now = new Date(); const gap = Date.parse(previousSeen || '') && now.getTime() - Date.parse(previousSeen) >= 86400000; const activePetIsSleeping = petSleepingNow(activePetId()); const helpedKind = firstToday && Trouble ? Trouble.helpedYesterday(state.data, now) : null; const message = helpedKind && Trouble.phrases[helpedKind] ? Trouble.phrases[helpedKind].nextDay : activePetIsSleeping ? 'ねむねむ。おかえり' : gap ? 'あえた。うれしい' : firstToday ? (now.getHours() < 12 ? 'おはよ。きょうもあえた' : 'こんにちは。あえたね') : 'おかえり。ここだよ'; bubble(message); if (activePetIsSleeping) setState('sleepy', 0); else { setState('happy'); speak(message, 'happy'); } }
  function updateLookDirection() {
    if (!state.data || document.hidden) return;
    ['pet-1', 'pet-2'].forEach(petId => {
      const node = petNode(petId);
      if (!node) return;
      const sleepingNow = petSleepingNow(petId);
      if (sleepingNow) { node.style.setProperty('--look-x', '0px'); return; }
      const slot = document.querySelector(`.pet-slot[data-pet-id="${petId}"]`);
      if (slot && slot.dataset.attention === 'true') { node.style.setProperty('--look-x', '0px'); return; }
      const petRect = node.getBoundingClientRect();
      const petCenterX = petRect.left + petRect.width / 2;
      let lookX = 0;
      const puni = $('puni');
      if (puni) {
        const puniRect = puni.getBoundingClientRect();
        const puniCenterX = puniRect.left + puniRect.width / 2;
        const distPuni = Math.abs(puniCenterX - petCenterX);
        if (distPuni <= 200) {
          lookX = (puniCenterX > petCenterX ? 1 : -1) * (3 + 5 * (1 - distPuni / 200));
        }
      }
      if (lookX === 0) {
        const otherPetId = petId === 'pet-1' ? 'pet-2' : 'pet-1';
        const otherNode = petNode(otherPetId);
        if (otherNode) {
          const otherRect = otherNode.getBoundingClientRect();
          const otherCenterX = otherRect.left + otherRect.width / 2;
          const distOther = Math.abs(otherCenterX - petCenterX);
          if (distOther <= 150) {
            lookX = (otherCenterX > petCenterX ? 1 : -1) * (3 + 5 * (1 - distOther / 150));
          }
        }
      }
      node.style.setProperty('--look-x', `${lookX}px`);
    });
    state.lookDirectionTimer = setTimeout(updateLookDirection, 150 + Math.floor(Math.random() * 50));
  }
  function scheduleYawn(petId) {
    if (!state.data || !Life) return;
    const timer = state.yawnTimers[petId];
    if (timer) { clearTimeout(timer); state.yawnTimers[petId] = null; }
    if (petSleepingNow(petId)) return;
    const node = petNode(petId);
    if (!node) return;
    const slot = document.querySelector(`.pet-slot[data-pet-id="${petId}"]`);
    if (slot && slot.dataset.attention === 'true') return;
    if (state.echoSession || state.game) return;
    const now = new Date();
    const sleepHours = Life.PET_SLEEP_HOURS && Life.PET_SLEEP_HOURS[petId] || { start:22, end:8 };
    const [startH, startM] = (sleepHours.start || '22:00').split(':').map(Number);
    const [endH, endM] = (sleepHours.end || '8:00').split(':').map(Number);
    const sleepStart = new Date(now);
    sleepStart.setHours(startH, startM || 0, 0, 0);
    const sleepEnd = new Date(now);
    sleepEnd.setHours(endH, endM || 0, 0, 0);
    if (sleepEnd < sleepStart) sleepEnd.setDate(sleepEnd.getDate() + 1);
    const thirtyBefore = new Date(sleepStart.getTime() - 30 * 60 * 1000);
    if (now < thirtyBefore || now >= sleepStart) return;
    const delay = 60000 + Math.floor(Math.random() * 90000);
    state.yawnTimers[petId] = setTimeout(() => {
      if (!state.data || petSleepingNow(petId)) return;
      const n = petNode(petId);
      const s = document.querySelector(`.pet-slot[data-pet-id="${petId}"]`);
      if (n && s && s.dataset.attention !== 'true' && !state.echoSession && !state.game) {
        n.dataset.yawn = 'true';
        setTimeout(() => { if (n) delete n.dataset.yawn; }, 1200);
      }
      scheduleYawn(petId);
    }, delay);
  }
  function scheduleRoll(petId) {
    if (!state.data) return;
    const timer = state.rollTimers[petId];
    if (timer) { clearTimeout(timer); state.rollTimers[petId] = null; }
    if (!petSleepingNow(petId)) return;
    const slot = document.querySelector(`.pet-slot[data-pet-id="${petId}"]`);
    if (!slot) return;
    const delay = 40000 + Math.floor(Math.random() * 60000);
    state.rollTimers[petId] = setTimeout(() => {
      if (!state.data || !petSleepingNow(petId)) return;
      const s = document.querySelector(`.pet-slot[data-pet-id="${petId}"]`);
      if (s) {
        s.dataset.roll = 'true';
        setTimeout(() => { if (s) delete s.dataset.roll; }, 3000);
      }
      scheduleRoll(petId);
    }, delay);
  }
  function initialize() {
    if (speechAvailable) { refreshVoices(); window.speechSynthesis.onvoiceschanged = refreshVoices; }
    const savedData = readData(); const previousSeen = savedData && savedData.lastSeenAt; const firstToday = !!savedData && (!previousSeen || Life.today(previousSeen) !== Life.today(new Date())); state.data = savedData; applyElapsed();
    if (!state.data) { state.data = Life.createDefaultState(new Date()); state.data.lastSeenAt = new Date().toISOString(); $('setup-dialog').showModal(); }
    state.voice = VoiceMemory ? new VoiceMemory.VoiceMemory() : null; const pendingDeletionRetry = retryPendingDeletions(); refreshVoiceCount();
    Story.restore(state.data); ensureCompanionSession(); ensureTwoPetSession(); restoreTroubleOnLoad(); ritualTick(); sulkOnOpen();
    updateScreen(); if (savedData) { welcomeOnOpen(previousSeen, firstToday); const resumedStory = Story.resume(state.data); if (resumedStory) storyPresent(resumedStory); else if (!Story.isActive(state.data) && !sulkingNow()) weekStartDay(); } setSeen();
    $('setup-form').addEventListener('submit', event => { event.preventDefault(); const petName = nameForStorage($('setup-pet-name').value, 'ぽこ'); const childName = nameForStorage($('setup-child-name').value, ''); state.data.petName = petName.value; state.data.childName = childName.value; const initialProfile = (state.data.profiles || []).find(item => item.id === state.data.activeProfileId); if (initialProfile) initialProfile.childName = childName.value; state.data.soundMode = document.querySelector('input[name="setup-sound"]:checked').value === 'on' ? 'pet' : 'text'; $('setup-dialog').close(); bubble(state.data.childName ? `こんにちは、${state.data.childName}。あえたね` : 'こんにちは。あえたね'); updateScreen(); if (!Life.isQuietTime(new Date())) speak('こんにちは。あえたね'); save(); if (petName.personal || childName.personal) showToast('個人情報らしい名前は覚えないよ'); noteInteraction(); });
    document.querySelectorAll('.care-button').forEach(button => button.addEventListener('click', () => care(button.dataset.action)));
    let pointerStart = null; let holdTimer = null; let holdTriggered = false;
    ['pet-1','pet-2'].forEach(petId => { const node = petNode(petId); node.addEventListener('pointerdown', event => { noteTroubleHiccupTap(petId); if (node.dataset.state === 'sleepy') { handleSleepyPetTouch(node); return; } if (petId !== activePetId()) { if (state.game || state.echoSession || state.director || companionActive() || twoPetActive() || state.recognizing || stageAsleep()) return; if (node.dataset.attention === 'true') { const slot = node.closest('.pet-slot'); if (slot) delete slot.dataset.attention; node.dataset.attention = 'false'; window.clearTimeout(state.attentionTimer); if (Life && Life.setActivePetId) { Life.setActivePetId(state.data, petId, activeProfileId()); save(); updateScreen(); playPetSound('happy'); } } else { const slot = node.closest('.pet-slot'); if (slot) slot.dataset.attention = 'true'; node.dataset.attention = 'true'; playPetSound('curious'); state.attentionTimer = window.setTimeout(() => { const n = petNode(petId); const s = n && n.closest('.pet-slot'); if (n) n.dataset.attention = 'false'; if (s) delete s.dataset.attention; }, 3000); } tryRitualWake(petId); return; } pointerStart = { x:event.clientX, y:event.clientY, time:Date.now() }; holdTriggered = false; try { node.setPointerCapture(event.pointerId); } catch (_) {} holdTimer = window.setTimeout(() => { if (pointerStart) { holdTriggered = true; performTouch('hold'); } }, 650); }); node.addEventListener('pointermove', event => { if (!pointerStart) return; const movedX = event.clientX - pointerStart.x; const movedY = event.clientY - pointerStart.y; if (Math.hypot(movedX, movedY) >= 20 && !holdTriggered) { window.clearTimeout(holdTimer); holdTimer = null; } }); node.addEventListener('pointerup', event => { if (!pointerStart) return; window.clearTimeout(holdTimer); const touch = { durationMs:Date.now() - pointerStart.time, deltaX:event.clientX - pointerStart.x, deltaY:event.clientY - pointerStart.y }; if (!holdTriggered) performTouch(Life.classifyTouch(touch)); pointerStart = null; }); node.addEventListener('pointercancel', () => { window.clearTimeout(holdTimer); pointerStart = null; }); }); { const puni = $('puni'); if (puni) { puni.addEventListener('pointerdown', handleTroublePuniPoke); puni.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') handleTroublePuniPoke(event); }); puni.addEventListener('pointerdown', handlePuniPoke); puni.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); handlePuniPoke(); } }); } }
    [['trouble-book','book',''],['trouble-ball','ball',''],['trouble-window','window',''],['trouble-leaf-1','leaf','pet-1'],['trouble-leaf-2','leaf','pet-2']].forEach(([id, kind, petId]) => { const part = $(id); if (!part) return; part.addEventListener('click', () => tryResolveTroubleTarget(kind, petId)); if (part.tagName !== 'BUTTON') part.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); tryResolveTroubleTarget(kind, petId); } }); });
    { const troubleToggle = $('trouble-toggle'); if (troubleToggle) troubleToggle.addEventListener('change', () => { if (!state.data || !state.data.trouble) return; state.data.trouble.enabled = troubleToggle.checked; save(); updateTroublePanel(); scheduleTrouble(); }); }
    { const ritualBowl = $('ritual-bowl'); if (ritualBowl) ritualBowl.addEventListener('click', () => { tryRitualFeed(); }); }
    { const ritualToggle = $('ritual-toggle'); if (ritualToggle) ritualToggle.addEventListener('change', () => { if (!state.data || !state.data.ritual) return; state.data.ritual.enabled = ritualToggle.checked; save(); ritualTick(); renderTwoPets(); updateScreen(); }); }
    { const sulkToggle = $('sulk-toggle'); if (sulkToggle) sulkToggle.addEventListener('change', () => { if (!state.data || !state.data.sulk || !Sulk) return; Sulk.setEnabled(state.data, sulkToggle.checked, new Date()); save(); refreshSulkVisual(); updateSulkPanel(); renderTwoPets(); updateScreen(); }); }
    $('talk-button').addEventListener('click', () => { cancelTwoPetMoment('conversation'); cancelEcho(); state.recognizing ? stopRecognition() : startRecognition(); });
    $('teach-word-button').addEventListener('click', () => { if (!state.data || !Story || Life.isSafetyPaused(state.data)) return; cancelTwoPetMoment('teaching'); cancelCompanionMoment(); cancelEcho(); hideQuestion(); const event = Story.startTeaching(state.data, {source:'manual',now:new Date()}); if (event) { state.storyDraft = null; storyPresent(event); save(); updateScreen(); } else showToast('いまのことばを教え終わってから、つぎを教えてね'); });
    $('echo-button').addEventListener('click', runEcho); $('echo-press-button').addEventListener('click', runEcho); $('echo-stop-button').addEventListener('click', () => finishEcho('stop'));
    $('voice-test-button').addEventListener('click', testVoice);
    $('play-light-button').addEventListener('click', () => { $('play-menu-dialog').close(); startMiniGame(); }); $('play-echo-button').addEventListener('click', openEchoPetMenu); $('play-menu-close').addEventListener('click', () => $('play-menu-dialog').close()); $('echo-pet-back').addEventListener('click', () => { $('echo-pet-dialog').close(); $('play-menu-dialog').showModal(); }); $('echo-pet-1-button').addEventListener('click', () => startManualEcho('pet-1')); $('echo-pet-2-button').addEventListener('click', () => startManualEcho('pet-2'));
    $('tuning-record-button').addEventListener('click', recordTuning); $('tuning-stop-button').addEventListener('click', () => { if (state.voice && state.voice.finishTemporaryRecording()) { $('tuning-stop-button').disabled = true; $('tuning-status').textContent = '録音を止めています'; } }); $('tuning-play-button').addEventListener('click', playTuning); $('tuning-reset-button').addEventListener('click', () => { const petId=selectedTuningPetId(); if(state.data.echoVoiceOverrides)delete state.data.echoVoiceOverrides[petId]; save(); loadTuning(petId); }); $('tuning-pet-select').addEventListener('change', () => loadTuning()); ['tuning-pitch','tuning-speed','tuning-double','tuning-brightness','tuning-timing-mode'].forEach(id => $(id).addEventListener(id === 'tuning-timing-mode' ? 'change' : 'input', saveTuning));
    $('game-target').addEventListener('click', scoreGameTarget); $('game-end').addEventListener('click', () => finishMiniGame('end'));
    $('keyboard-toggle').addEventListener('click', () => toggleTextEntry($('text-entry').hidden));
    $('send-button').addEventListener('click', () => handleMessage($('message-input').value)); $('message-input').addEventListener('keydown', event => { if (event.key === 'Enter') handleMessage(event.target.value); });
    $('sound-toggle').addEventListener('click', () => { const wasOff = state.data.soundMode === 'text'; state.data.soundMode = wasOff ? 'pet' : 'text'; if (!wasOff) { cancelTwoPetMoment('sound-off'); cancelCompanionMoment(); cancelEcho(); if (speechAvailable) window.speechSynthesis.cancel(); } save(); updateScreen(); if (wasOff) testVoice(); });
    $('parent-open').addEventListener('click', () => { cancelTwoPetMoment('modal'); cancelCompanionMoment(); cancelEcho(); updateScreen(); $('parent-dialog').showModal(); });
    $('profile-select').addEventListener('change', async event => { cancelTwoPetMoment('profile-change'); cancelCompanionMoment(); cancelEcho(); if (state.voice) await state.voice.invalidate(); if (Life.selectProfile(state.data, event.target.value)) { state.data.weekProgress.lastCallbackAt = ''; state.voiceTarget = null; ensureTwoPetSession(); save(); updateScreen(); await refreshVoiceCount(); bubble('きてくれたね'); noteInteraction(); } });
    $('profile-add').addEventListener('click', () => { const profile = Life.addProfile(state.data, $('profile-add-input').value, new Date()); if (!profile) { showToast('呼び名を確認してね'); return; } $('profile-add-input').value = ''; save(); updateScreen(); showToast('呼び名を追加したよ'); });
    $('profile-list').addEventListener('click', async event => { const selectId = event.target && event.target.dataset.profileSelect; const deleteId = event.target && event.target.dataset.profileDelete; if (selectId) { cancelTwoPetMoment('profile-change'); cancelCompanionMoment(); cancelEcho(); if (state.voice) await state.voice.invalidate(); if (Life.selectProfile(state.data, selectId)) { state.data.weekProgress.lastCallbackAt = ''; state.voiceTarget = null; ensureTwoPetSession(); save(); updateScreen(); await refreshVoiceCount(); bubble('きてくれたね'); } } if (deleteId) await deleteProfileWithLedger(deleteId); });
    $('speech-input-toggle').addEventListener('change', event => { state.data.speechInputEnabled = event.target.checked; save(); }); $('speech-output-toggle').addEventListener('change', event => { state.data.soundMode = event.target.checked ? (state.data.soundMode === 'text' ? 'pet' : state.data.soundMode) : 'text'; if (!event.target.checked) { cancelTwoPetMoment('sound-off'); cancelCompanionMoment(); cancelEcho(); } save(); updateScreen(); }); $('sound-mode-select').addEventListener('change', event => { state.data.soundMode = event.target.value; if (event.target.value === 'text') { cancelTwoPetMoment('sound-off'); cancelCompanionMoment(); cancelEcho(); } save(); updateScreen(); }); $('voice-memory-toggle').addEventListener('change', event => { state.data.voiceMemoryEnabled = event.target.checked; if (!event.target.checked && state.voice) { discardTuningBlob(); state.voice.invalidate(); } save(); updateScreen(); }); $('echo-mode-toggle').addEventListener('change', event => { state.data.echoModeEnabled = event.target.checked; if (!event.target.checked) cancelEcho(); save(); updateScreen(); });
    $('camera-toggle').addEventListener('change', event => setCamera(event.target.checked)); $('camera-stop').addEventListener('click', () => { $('camera-toggle').checked = false; setCamera(false); });
    $('edit-name').addEventListener('click', () => { cancelTwoPetMoment('modal'); cancelEcho(); $('name-edit-input').value = state.data.petName; $('name-edit-box').hidden = false; $('forget-confirm-box').hidden = true; $('name-edit-input').focus(); });
    $('name-save').addEventListener('click', () => { const petName = nameForStorage($('name-edit-input').value, 'ぽこ'); state.data.petName = petName.value; $('name-edit-box').hidden = true; save(); updateScreen(); showToast(petName.personal ? '個人情報らしい名前は覚えないよ' : '名前を変えたよ'); });
    $('name-cancel').addEventListener('click', () => { $('name-edit-box').hidden = true; });
    $('forget-button').addEventListener('click', () => { cancelTwoPetMoment('deleting'); cancelCompanionMoment(); cancelEcho(); $('forget-confirm-box').hidden = false; $('name-edit-box').hidden = true; });
    $('forget-cancel').addEventListener('click', () => { $('forget-confirm-box').hidden = true; });
    $('learned-words').addEventListener('click', async event => { const id = event.target && event.target.dataset.forgetWord; if (!id) return; await deleteWordWithLedger(activeProfileId(), id); });
    $('voice-record-button').addEventListener('click', () => { cancelEcho(); recordWordVoice(); }); $('voice-clear-button').addEventListener('click', () => { cancelEcho(); $('voice-clear-confirm-box').hidden = false; $('forget-confirm-box').hidden = true; }); $('voice-clear-cancel').addEventListener('click', () => { $('voice-clear-confirm-box').hidden = true; }); $('voice-clear-confirm').addEventListener('click', async () => { cancelEcho(); const removed = state.voice ? await state.voice.clearAll() : { ok:true }; if (!removed.ok) { $('voice-memory-status').textContent = '消せません。もう一度ためしてね'; return; } $('voice-clear-confirm-box').hidden = true; await refreshVoiceCount(); showToast('声の記憶を消しました'); });
    $('forget-confirm').addEventListener('click', async () => { cancelTwoPetMoment('deleting'); cancelCompanionMoment(); cancelEcho(); const removed = state.voice ? await state.voice.clearAll() : { ok:true }; if (!removed.ok) { $('forget-confirm-box').hidden = false; showToast('声の記憶を消せません。もう一度ためしてね'); return; } discardTuningBlob(); localStorage.removeItem(STORAGE_KEY); stopCamera(); state.data = Life.createDefaultState(new Date()); state.data.lastSeenAt = new Date().toISOString(); state.storyDraft = null; state.voiceTarget = null; ensureCompanionSession(); ensureTwoPetSession(); restoreTroubleOnLoad(); ritualTick(); sulkOnOpen(); scheduleTrouble(); save(); updateScreen(); $('forget-confirm-box').hidden = true; $('parent-dialog').close(); await refreshVoiceCount(); bubble('また、はじめまして'); showToast('記憶を消しました'); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) { cancelTwoPetMoment('hidden'); if (state.activityLock) state.activityLock.activateHardBlock('hidden'); cancelCompanionMoment(); cancelEcho(); discardTuningBlob(); if (state.voice) state.voice.invalidate(); clearSpontaneous(); clearSpeechWatchdog(); window.clearTimeout(state.storyRecallTimer); state.storyRecallTimer = null; stopPetAudio(); if (speechAvailable) window.speechSynthesis.cancel(); window.clearTimeout(state.lookDirectionTimer); state.lookDirectionTimer = null; ['pet-1','pet-2'].forEach(id => { if (state.yawnTimers[id]) { clearTimeout(state.yawnTimers[id]); state.yawnTimers[id] = null; } if (state.rollTimers[id]) { clearTimeout(state.rollTimers[id]); state.rollTimers[id] = null; } }); } else if (!($('setup-dialog') && $('setup-dialog').open)) { if (state.activityLock) state.activityLock.clearHardBlock('hidden'); noteInteraction(); ritualTick(); sulkTick(); scheduleStoryRecall(); updateScreen(); updateLookDirection(); scheduleYawn('pet-1'); scheduleYawn('pet-2'); scheduleRoll('pet-1'); scheduleRoll('pet-2'); } else { clearSpontaneous(); window.clearTimeout(state.storyRecallTimer); state.storyRecallTimer = null; updateScreen(); } }); window.addEventListener('pagehide', () => { cancelTwoPetMoment('pagehide'); cancelCompanionMoment(); cancelEcho(); discardTuningBlob(); if (state.voice) state.voice.invalidate(); });
    if (savedData) pendingDeletionRetry.finally(() => { scheduleSpontaneous(); scheduleTrouble(); scheduleStoryRecall(); scheduleCompanionMoment(); scheduleTwoPetMoment(); updateLookDirection(); scheduleYawn('pet-1'); scheduleYawn('pet-2'); scheduleRoll('pet-1'); scheduleRoll('pet-2'); });
    window.setInterval(() => { if (state.data && !document.hidden) renderTwoPets(); }, 60000);
    schedulePuniWander();
    window.setInterval(() => { if (state.data && !document.hidden) { ritualTick(); sulkTick(); } }, 60000);
    /* 見本ページではオフライン保存を使わない */
  }
  function showToast(message) { const node = $('toast'); node.textContent = message; node.classList.add('show'); setTimeout(() => node.classList.remove('show'), 2200); }
  initialize();
})();
