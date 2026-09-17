import assert from 'node:assert/strict';
import {Terrain,setActiveLevel} from '../src/terrain.js?v=108';
import {buildCoastalVillage} from '../src/village.js?v=108';

setActiveLevel('level1');
const terrain=new Terrain();
const first=buildCoastalVillage(terrain), second=buildCoastalVillage(terrain);
assert.ok(first.door,'The village must keep a discoverable gorge entrance');
assert.deepEqual(first.door,second.door,'Reloading unchanged terrain must not move the hidden entrance');
assert.ok(first.placements.length>=12,'The real terrain must have room for a populated village');
for(let i=0;i<first.placements.length;i++) {
 const a=first.placements[i];
 assert.ok(a.floor>=a.highestCorner,'Walls must sit above the highest foundation corner');
 for(let j=i+1;j<first.placements.length;j++) {
  const b=first.placements[j];
  assert.ok(Math.hypot(a.x-b.x,a.z-b.z)>=a.radius+b.radius+.6,'House footprints must not overlap');
 }
}
assert.ok(first.group.children.length<=12,'Architecture detail must not add hundreds of draw calls');
for(const mesh of first.group.children) {
 assert.ok(mesh.geometry.attributes.position.array.every(Number.isFinite),'Baked positions are finite');
 assert.ok(mesh.geometry.attributes.normal.array.every(Number.isFinite),'Baked normals are finite');
}
console.log(`PASS: ${first.placements.length} non-overlapping cottages in ${first.group.children.length} material batches; stable entrance and grounded foundations`);
