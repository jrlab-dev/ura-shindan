/* Rhythm decorations share immutable event snapshots across screen and recording. */
(function(root,factory){
  if(typeof module==='object'&&module.exports) module.exports=factory();
  else root.LittleCompanionMusicEffects=factory();
}(typeof self!=='undefined'?self:this,function(){
  'use strict';
  const SETTING='little-companion-rhythm-effects';
  function Events(){this.reset(0);}
  Events.prototype.reset=function(runId){this.runId=runId;this.sequence=0;this.rings=[];this.lastRing=-Infinity;this.milestone=null;this.seen=new Set();this.finishedAt=null;};
  Events.prototype.hit=function(runId,hit,combo){
    if(runId!==this.runId||hit.sequence<=this.sequence||this.finishedAt!==null)return;
    this.sequence=hit.sequence;
    this.rings=this.rings.filter(r=>hit.at-r.at<.24);
    if(hit.at-this.lastRing>=.1-1e-9){this.rings.push({...hit});this.rings=this.rings.slice(-4);this.lastRing=hit.at;}
    if((combo===5||combo===10||(combo>=20&&combo%20===0))&&!this.seen.has(combo)){
      this.seen.add(combo);this.milestone={combo,at:hit.at};
    }
  };
  Events.prototype.finish=function(runId,at){if(runId!==this.runId||this.finishedAt!==null)return;this.finishedAt=at;this.rings=[];this.milestone=null;};
  Events.prototype.snapshot=function(){return {runId:this.runId,rings:this.rings.map(r=>({...r})),milestone:this.milestone&&{...this.milestone},finishedAt:this.finishedAt};};
  function view(events,at,quiet=false){
    events=events||{};
    const milestone=events.milestone&&at>=events.milestone.at&&at-events.milestone.at<.6?events.milestone:null;
    const elapsed=events.finishedAt==null?Infinity:Math.max(0,at-events.finishedAt);
    return {rings:quiet?[]:(events.rings||[]).filter(r=>at>=r.at&&at-r.at<.24).map(r=>({...r,progress:(at-r.at)/.24})),
      milestone,scale:!quiet&&milestone?1+.12*Math.sin(Math.PI*(at-milestone.at)/.6):1,
      bow:!quiet&&elapsed<.7?4*Math.sin(Math.PI*elapsed/.7):0};
  }
  function resultMessage(hits){return hits>0?`${hits}この音が ひけたね`:'さいごまで あそんだね';}
  function load(storage){try{return storage.getItem(SETTING)==='quiet'?'quiet':'normal';}catch(_){return 'normal';}}
  function save(storage,value){try{storage.setItem(SETTING,value==='quiet'?'quiet':'normal');}catch(_){}}
  /* Miniature of the existing rounded bodies, tilted ears, cheeks and smile. */
  function drawPet(ctx,x,y,size,blue=false,bow=0){
    ctx.save();ctx.translate(x,y+bow);ctx.scale(size/240,size/240);
    const colors=blue?['#b9e2f8','#79bce8','#4f8fc8','#76b9e5','#2f6f9e']:['#f8bfd0','#eb91af','#c9688d','#e993b0','#a64169'];
    const ellipse=(x,y,rx,ry,color,angle=0)=>{ctx.fillStyle=color;ctx.beginPath();ctx.ellipse(x,y,rx,ry,angle,0,Math.PI*2);ctx.fill();};
    ellipse(60,39,29,35,colors[3],-.49);ellipse(180,39,29,35,colors[3],.49);
    ellipse(60,39,17,23,colors[0],-.49);ellipse(180,39,17,23,colors[0],.49);
    const gradient=ctx.createLinearGradient(30,40,210,222);gradient.addColorStop(0,colors[0]);gradient.addColorStop(.65,colors[1]);gradient.addColorStop(1,colors[2]);
    ctx.fillStyle=gradient;ctx.beginPath();ctx.moveTo(120,28);ctx.bezierCurveTo(194,28,222,70,220,145);ctx.bezierCurveTo(218,205,191,232,120,232);ctx.bezierCurveTo(49,232,22,205,20,145);ctx.bezierCurveTo(18,70,46,28,120,28);ctx.fill();
    ellipse(67,211,24,18,colors[1]);ellipse(173,211,24,18,colors[1]);
    ellipse(120,178,41,30,'rgba(255,255,255,.2)');
    ctx.strokeStyle='#40374f';ctx.lineWidth=7;ctx.lineCap='round';
    [78,162].forEach(cx=>{ctx.beginPath();ctx.arc(cx,94,10,Math.PI,Math.PI*2);ctx.stroke();});
    ellipse(60,123,11.5,6,colors[3]);ellipse(180,123,11.5,6,colors[3]);
    ctx.strokeStyle=colors[4];ctx.lineWidth=3;ctx.beginPath();ctx.arc(120,126,10,0,Math.PI);ctx.stroke();ctx.restore();
  }
  return {Events,view,resultMessage,load,save,drawPet};
}));
