import assert from 'node:assert/strict';
import {Terrain,GRID,setActiveLevel} from '../src/terrain.js?v=110';
setActiveLevel('level1');
const terrain=new Terrain();
// Model a bed-height change from the solver (it does not mark a player-edit patch).
for(let k=0;k<terrain.height.length;k++) terrain.height[k]+=.25;
for(let frame=0;frame<GRID;frame++) terrain.update(0);
const incremental=terrain.geometry.attributes.position.array.slice();
terrain.refreshFineMeshFully();
const full=terrain.geometry.attributes.position.array;
let maxError=0,stale=0;
for(let k=1;k<full.length;k+=3) {
 const error=Math.abs(full[k]-incremental[k]);maxError=Math.max(maxError,error);
 if(error>1e-5)stale++;
}
assert.equal(stale,0,`${stale} fine vertices were skipped; worst height error ${maxError}`);
console.log('PASS: incremental scan updates every fine terrain vertex, matching a full refresh');
