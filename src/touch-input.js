// Prevent Safari's page gestures on the game surface, while leaving dialog
// controls and browser/OS accessibility outside the page under user control.
export function installGameTouchPolicy(){
  const stop=e=>{if(e.cancelable)e.preventDefault();};
  document.addEventListener('dblclick',stop,{passive:false});
  for(const name of ['gesturestart','gesturechange'])document.addEventListener(name,stop,{passive:false});
  document.addEventListener('touchstart',e=>{
    if(e.target.closest?.('#joystickZone,#digZone,canvas'))stop(e);
  },{passive:false});
  let previous=null;
  document.addEventListener('touchend',e=>{
    if(!e.changedTouches.length)return;
    const t=e.changedTouches[0],now=performance.now();
    if(previous && now-previous.time<350 && Math.hypot(t.clientX-previous.x,t.clientY-previous.y)<30)stop(e);
    previous={time:now,x:t.clientX,y:t.clientY};
  },{passive:false});
}

export function bindPointerHold(el,onDown,onUp){
  let id=null;
  function release(e){
    if(id===null || (e?.pointerId!==undefined && e.pointerId!==id))return;
    id=null;onUp();
  }
  el.addEventListener('pointerdown',e=>{
    e.preventDefault();if(id!==null)return;id=e.pointerId;
    try{el.setPointerCapture(id);}catch{}
    onDown();
  });
  for(const event of ['pointerup','pointercancel','lostpointercapture'])el.addEventListener(event,release);
  window.addEventListener('blur',()=>release());
  document.addEventListener('visibilitychange',()=>{if(document.hidden)release();});
  return el;
}
