import assert from 'node:assert/strict';
import {Terrain,setActiveLevel,CELL,GRID,warpX,terrainVersionFor} from '../src/terrain.js?v=113';
import {WaterSim} from '../src/water.js?v=113';
import {bayEdges,mawganStream,mawganHeight} from '../src/mawgan.js?v=113';
import {loadSavedData,saveState,applySavedData} from '../src/save.js?v=113';
import {buildMawganBridge} from '../src/mawgan-bridge.js?v=113';
import {buildMawganSurround} from '../src/mawgan-surround.js?v=113';
setActiveLevel('level1');
const terrain=new Terrain(),water=new WaterSim(terrain);
// Spatial requirements: opening beach, low inland approach, river south of centre.
const near=bayEdges(20),far=bayEdges(75);
assert.ok(far[1]-far[0]>near[1]-near[0]+20,'Beach must open toward the sea');
assert.ok(mawganHeight(80,0)<7,'Inland approach must not be enclosed by a cliff wall');
assert.ok(mawganHeight(30,-25)>mawganHeight(88,17)+8,'Surveyed Trenance hillside rises above the river crossing');
for(let z=0;z<80;z+=2){
 const x=mawganStream(z);
 const [left,right]=bayEdges(z);
 assert.ok(x>(left+right)/2 && x<(GRID-1)*CELL-5,'River follows south half of the actual bay within physical grid');
 assert.equal(warpX(x,z),x,'Visible river and physical terrain must align');
}
// Run two minutes of the actual solver; every reach must carry water and stay finite.
for(let k=0;k<120*30;k++){water._step(1/30,terrain);water.elapsed+=1/30;}
for(let z=3;z<70;z+=3){
 const row=Math.round(z/CELL),cx=Math.round(mawganStream(z)/CELL);
 const depths=[];for(let dx=-3;dx<=3;dx++)depths.push(water.depth[row*GRID+cx+dx]);
 assert.ok(Math.max(...depths)>.025,`River remains wet at z=${z}`);
}
assert.ok(water.depth.every(x=>Number.isFinite(x)&&x>=0),'Stable nonnegative water');
assert.ok(terrain.height.every(Number.isFinite),'Finite terrain after erosion');
for(const z of [12,17])for(const dx of [-6,6]){
 const k=Math.round(z/CELL)*GRID+Math.round((mawganStream(z)+dx)/CELL);
 assert.ok(water.depth[k]<.08,'Normal river flow must not flood the village banks');
}
const total=()=>terrain.height.reduce((a,b)=>a+b,0),before=total();
const amount=-terrain.scoopDeform(65,40,0,1,2,2,-.32,1);
terrain.depositScoop(61,40,0,1,2,3,amount);
assert.ok(Math.abs(total()-before)<.0002,'New beach conserves scooped/deposited earth');
// Old beach saves are copied before replacement, other levels remain compatible.
const memory=new Map(),raw=JSON.stringify({v:1,terrainV:7,height:'original-earthworks'});
globalThis.localStorage={getItem:k=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,v)};
memory.set('shoreline_save_v1',raw);
assert.equal(loadSavedData('level1'),null);
assert.equal(memory.get('shoreline_save_v1_terrain_7_backup'),raw);
assert.ok(saveState({terrain,water,rocks:[],player:{pos:{x:91,z:36}}}));
assert.equal(memory.get('shoreline_save_v1'),raw,'Autosave must not replace legacy earthworks');
const saved=loadSavedData('level1'),dug=terrain.height.slice();
assert.equal(saved.terrainV,9);
terrain.height.fill(0);applySavedData(saved,terrain,water);
assert.deepEqual(terrain.height,dug,'Reload restores edited terrain exactly');
memory.delete('shoreline_save_v1_terrain_9');
const previous=JSON.stringify({...saved,terrainV:8});memory.set('shoreline_save_v1_terrain_8',previous);
assert.equal(loadSavedData('level1'),null);
assert.equal(memory.get('shoreline_save_v1_terrain_8'),previous,'Version 112 earthworks remain preserved');
const bridge=buildMawganBridge(terrain);
assert.ok(bridge.deck>terrain.sampleHeightBilinear(bridge.center.x,bridge.center.z)+.3,'Bridge spans above the riverbed');
let last=null;
for(let s=-bridge.span/2-bridge.ramp;s<=bridge.span/2+bridge.ramp;s+=.1){
 const h=bridge.walkHeight(bridge.center.x+bridge.axis.x*s,bridge.center.z+bridge.axis.z*s);
 if(last!==null)assert.ok(Math.abs(h-last)<.22,'Bridge approach stays walkable');last=h;
}
assert.equal(terrainVersionFor('level2'),9);assert.equal(terrainVersionFor('level3'),10);
const surround=buildMawganSurround(terrain),edge=surround.userData.boundary;
// Deform a boundary after building scenery; the join must follow live fine vertices.
terrain.scoopDeform(.5,50,0,1,2,2,-.3,1);terrain.refreshFineMeshFully();surround.userData.syncBoundary();
const surface=terrain.geometry.attributes.position.array,joined=surround.children[0].geometry.attributes.position.array;
for(const {source,dest} of edge)for(let a=0;a<3;a++)assert.equal(joined[dest*3+a],surface[source*3+a],'Every fine cliff-edge vertex must stay joined after digging');
console.log('PASS: bay footprint, low approach, southern river, two-minute flow, earth conservation, old-save backup');
