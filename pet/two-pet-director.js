/* 2匹場面の頻度・世代・排他を管理する純粋なローカル制御。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../app/two-pet-scenes.js'));
  else root.LittleCompanionTwoPetDirector = factory(root.LittleCompanionTwoPetScenes);
}(typeof self !== 'undefined' ? self : this, function (Scenes) {
  'use strict';
  const SECOND=1000, MINUTE=60000, MAX=9; let serial=0;
  const now = (v, fallback) => { const n=Number(v); return Number.isFinite(n)?n:(v instanceof Date?v.getTime():fallback); };
  const safeWord = c => { const w=String(c&&c.learnedWord||'').normalize('NFKC').trim(); return /^[\p{L}\p{N}ー々]{1,12}$/u.test(w) && !/(電話|住所|学校|メール|死にたい|自殺|裸|性的)/i.test(w) ? w : ''; };
  const rng = seed => { let x=(Number(seed)||123456789)>>>0; return ()=>((x=Math.imul(1664525,x)+1013904223)>>>0)/4294967296; };
  function createSession(options){ const o=options||{}, t=now(o.now,Date.now()), seeded=rng(o.seed); const q=()=>o.rng?o.rng():seeded(); return {startedAt:t,actionCount:0,inviteCount:0,usedSceneIds:[],activeScene:null,token:`two-${t}-${++serial}`,_rng:q,nextInviteAt:t+15000,nextInviteActionCount:1}; }
  const blocked = c => Boolean(c&&c.blocked);
  function eligible(session,c){ const word=safeWord(c), used=new Set(session.usedSceneIds); return Scenes.SCENES.filter(x=>!used.has(x.id)).filter(x=>!x.requiresWord||word).filter(x=>!x.requiresToy||Boolean(c&&c.toy)); }
  function canInvite(session,c){ if(!session||blocked(c)||session.activeScene||session.inviteCount>=MAX)return false; const t=now(c&&c.now,Date.now()); return session.actionCount>0 && t>=session.nextInviteAt && t>=session.startedAt+15000 && eligible(session,c).length>0; }
  function invite(session,c){ if(!canInvite(session,c))return null; const list=eligible(session,c), scene=list[Math.floor((session._rng?session._rng():0)*list.length)%list.length], t=now(c&&c.now,Date.now()), word=safeWord(c); const copy=JSON.parse(JSON.stringify(scene)); copy.steps.forEach(step=>{step.text=step.text.replace(/\{\{word\}\}/g,word);}); session.activeScene={...copy,invitedAt:t,expiresAt:t+copy.durationMs,token:session.token}; session.usedSceneIds.push(scene.id); session.inviteCount++; session.nextInviteAt=t+50*SECOND; session.nextInviteActionCount=session.actionCount+1; return {events:[{type:'invite',sceneId:scene.id,scene:copy}]}; }
  function noteAction(session, action, c){ if(!session||blocked(c))return null; session.actionCount++; const a=session.activeScene; if(!a)return null; if(action===a.optionalAction){session.activeScene=null; return {handled:true,events:[{type:'success',sceneId:a.id,scene:a}]};} return {handled:false,events:[]}; }
  function expire(session,c){ if(!session||!session.activeScene||blocked(c))return null; if(now(c&&c.now,Date.now())<session.activeScene.expiresAt)return null; const id=session.activeScene.id;session.activeScene=null;return {events:[{type:'expired',sceneId:id}]}; }
  function reset(session,options){if(session){session.token+=`-stale-${++serial}`;session.activeScene=null;}return createSession(options);}
  return {createSession,canInvite,invite,noteAction,expire,reset,safeWord};
}));
