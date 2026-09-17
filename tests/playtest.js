// Explicit local-only QA controls; never loaded on the published game.
import {millRaceX,bypassX} from '../src/mill-layout.js';
const bar=document.createElement('aside');
bar.style.cssText='position:fixed;bottom:46px;right:18px;z-index:40;display:flex;gap:6px;padding:8px;background:#152722;color:white;font:11px sans-serif';
bar.setAttribute('aria-label','Local playtest tools');
function button(text, action){const b=document.createElement('button');b.textContent=text;b.onclick=action;bar.append(b);}
button('Walk to hidden door',()=>{
 const g=window.__game,d=g.debug().waterfallDoor || g.debug().villageDoor;
 if(d){g.player.setSpawn(d.standX,d.standZ);g.stepFrame(1/30,2);}
});
button('Excavate the diversion',()=>{
 const g=window.__game;if(g.levelId!=='level3')return;
 for(let z=29;z<=45;z+=1.2)for(let n=0;n<12;n++){
  const amount=-g.terrain.scoopDeform(millRaceX(z),z,0,1,2,2,-.32,1);
  g.terrain.depositScoop(bypassX(z),z,0,1,2,3,amount);
 }
 g.terrain.markDirty();g.player.setSpawn(78,65);g.setZoom(80);
});
button('Advance river 30 seconds',()=>{
 const g=window.__game;
 for(let i=0;i<900;i++){g.water._step(1/30,g.terrain);g.water.elapsed+=1/30;if(g.mill)g.mill.update(1/30);}
 g.terrain.refreshFineMeshFully();g.water._syncMeshAttrs(g.terrain);g.stepFrame(1/30);
});
button('Frame mill court',()=>{window.__game.player.setSpawn(78,65);window.__game.setZoom(80);});
button('Hide test tools',()=>bar.remove());
document.body.append(bar);
