import assert from 'node:assert/strict';
import {Terrain,setActiveLevel,CELL,GRID} from '../src/terrain.js?v=108';
import {WaterSim} from '../src/water.js?v=108';
import {millRaceX,bypassX,readMillFlow,millRpmForFlow} from '../src/mill-layout.js';

setActiveLevel('level3');
const terrain=new Terrain(), water=new WaterSim(terrain);
const advance=seconds=>{for(let n=0;n<seconds*30;n++){water._step(1/30,terrain);water.elapsed+=1/30;}};
const sum=a=>a.reduce((v,x)=>v+x,0);
const before=sum(terrain.height);
const removed=-terrain.scoopDeform(85,40,0,1,2.1,1.7,-.6,1);
terrain.depositScoop(89,42,1,0,3,2.4,removed);
assert.ok(Math.abs(sum(terrain.height)-before)<.0001,'A scoop and deposit must conserve earth');
// Rendering and simulation must agree on both axes, including the far corner.
const positions=water.geometry.attributes.position;
assert.ok(Math.abs(positions.getZ(positions.count-1)-(GRID-1)*CELL)<.0001,'Water grid Z matches terrain');
advance(480);
const initial=readMillFlow(water,CELL,GRID);
console.log('Initial discharge:',initial);
assert.ok(millRpmForFlow(initial)<3,'The mill must not solve itself during an eight-minute idle run');
// Move the silt using the same deformation API as the excavator, then dam
// the competing branch. No direct water injection or objective overrides.
for(let z=29;z<=45;z+=1.2)for(let n=0;n<12;n++) {
  const amount=-terrain.scoopDeform(millRaceX(z),z,0,1,2,2,-.32,1);
  terrain.depositScoop(bypassX(z),z,0,1,2,3,amount);
}
advance(160);
const restored=readMillFlow(water,CELL,GRID);
console.log('Restored discharge:',restored,'rpm:',millRpmForFlow(restored));
assert.ok(restored>initial*2+.01,'Redirecting water increases wheel flow');
assert.ok(millRpmForFlow(restored)>3,'The actual river can power the pump');
assert.ok(water.depth.every(x=>Number.isFinite(x)&&x>=0),'Water stays finite and nonnegative');
assert.ok(terrain.height.every(Number.isFinite),'Terrain stays finite');
water.velZ.fill(0);
assert.equal(readMillFlow(water,CELL,GRID),0,'Standing water cannot power the wheel');
console.log('PASS: water alignment, earth conservation, diversion, pump power, stability, stagnant water');
