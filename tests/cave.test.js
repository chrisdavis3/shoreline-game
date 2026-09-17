import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.js';
import {Terrain,setActiveLevel,SIZE} from '../src/terrain.js?v=108';
import {Player} from '../src/player.js?v=108';
import {buildHiddenCave,CAVE_X,CAVE_BACK,CAVE_MOUTH,CAVE_WATER,reachedCavePassage} from '../src/hidden-cave.js?v=108';
setActiveLevel('level2');
const terrain=new Terrain(),cave=buildHiddenCave(terrain),player=new Player(terrain);
player.walkHeight=cave.walkHeight;player.setSpawn(CAVE_X,CAVE_WATER+1);
assert.equal(reachedCavePassage(CAVE_X,CAVE_WATER),false);
assert.equal(reachedCavePassage(CAVE_X+3,CAVE_BACK+1),false);
let crossed=false,reached=false;
for(let i=0;i<180;i++) {
 player.update(1/30,{moveVector:new THREE.Vector3(0,0,-1),run:false},{SIZE});
 if(player.pos.z<CAVE_MOUTH)crossed=true;
 if(reachedCavePassage(player.pos.x,player.pos.z)){reached=true;break;}
}
assert.ok(crossed && reached,'Normal walking must cross water and reach passage');
assert.ok(Math.abs(player.pos.y-cave.floorY)<.01,'Player stays on cave floor');
console.log('PASS: cave reachable through waterfall by normal movement; exterior and side approaches do not trigger');
