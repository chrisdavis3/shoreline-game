import * as THREE from '../vendor/three.module.js';
import { L2_LIP_X, L2_T_FALL1, SIZE } from './terrain.js?v=108';

// The rock shelter sits in front of the heightfield cliff; the falling sheet
// bows out over its mouth. No terrain carving or save migration is needed.
export const CAVE_X = L2_LIP_X;
export const CAVE_BACK = L2_T_FALL1 * SIZE + .45;
export const CAVE_MOUTH = CAVE_BACK + 4.8;
export const CAVE_WATER = CAVE_MOUTH + 1.4;
export function insideCave(x,z) {
  return Math.abs(x-CAVE_X)<1.8 && z<CAVE_MOUTH && z>CAVE_BACK;
}
export function reachedCavePassage(x,z) {
  return Math.abs(x-CAVE_X)<1.25 && z<CAVE_BACK+1.35 && z>CAVE_BACK;
}
export function buildHiddenCave(terrain) {
  const group=new THREE.Group();
  let floorY=terrain.sampleHeightBilinear(CAVE_X,CAVE_MOUTH)+.15;
  for(let x=CAVE_X-1.8;x<=CAVE_X+1.8;x+=.3)
    for(let z=CAVE_BACK;z<=CAVE_MOUTH;z+=.3)
      floorY=Math.max(floorY,terrain.sampleHeightBilinear(x,z)+.2);
  const rock=new THREE.MeshStandardMaterial({color:'#414942',roughness:1});
  const dark=new THREE.MeshStandardMaterial({color:'#111c19',roughness:1});
  const floor=new THREE.MeshStandardMaterial({color:'#58605a',roughness:.95});
  function block(w,h,d,x,y,z,mat) {
    const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);
    m.position.set(x,y,z); m.castShadow=true;m.receiveShadow=true;group.add(m);return m;
  }
  const mid=(CAVE_BACK+CAVE_MOUTH)/2;
  block(4.6,.4,5.4,CAVE_X,floorY-.2,mid,floor);
  block(1.3,4.4,5.7,CAVE_X-2.35,floorY+1.9,mid,rock);
  block(1.3,4.4,5.7,CAVE_X+2.35,floorY+1.9,mid,rock);
  for(let i=0;i<7;i++) {
    const m=new THREE.Mesh(new THREE.DodecahedronGeometry(1,1),rock);
    m.position.set(CAVE_X+(i-3)*.85,floorY+3.8+.18*Math.sin(i*2),mid);
    m.scale.set(1.1,.95,3.1);m.rotation.z=.13*Math.sin(i);m.castShadow=true;group.add(m);
  }
  // A dark passage, not a door or frame. The transition occurs before its end.
  block(3.5,3.5,.2,CAVE_X,floorY+1.7,CAVE_BACK,dark);
  for(let side of [-1,1]) for(let i=0;i<5;i++) {
    const m=new THREE.Mesh(new THREE.DodecahedronGeometry(1,1),rock);
    m.position.set(CAVE_X+side*(2.25+.12*Math.sin(i)),floorY+.4+i*.75,CAVE_MOUTH-.15);
    m.scale.set(.8,.7,.8);m.rotation.set(i*.4,i*.7,side*.2);
    m.castShadow=true;group.add(m);
  }
  const glow=new THREE.PointLight('#91b2a3',3,6,2);
  glow.position.set(CAVE_X,floorY+2.2,CAVE_BACK+2);group.add(glow);
  function walkHeight(x,z) {
    if(Math.abs(x-CAVE_X)>1.75 || z<CAVE_BACK || z>CAVE_WATER+1.5) return terrain.sampleHeightBilinear(x,z);
    const t=THREE.MathUtils.smoothstep(z,CAVE_MOUTH,CAVE_WATER+1.5);
    return THREE.MathUtils.lerp(floorY,terrain.sampleHeightBilinear(x,z),t);
  }
  const rampGeo=new THREE.PlaneGeometry(3.5,CAVE_WATER+1.5-CAVE_MOUTH,6,16);
  const pos=rampGeo.attributes.position;
  for(let i=0;i<pos.count;i++) {
    const x=CAVE_X+pos.getX(i),z=(CAVE_MOUTH+CAVE_WATER+1.5)/2+pos.getY(i);
    pos.setXYZ(i,x,walkHeight(x,z)+.02,z);
  }
  rampGeo.computeVertexNormals();floor.side=THREE.DoubleSide;
  const ramp=new THREE.Mesh(rampGeo,floor);ramp.receiveShadow=true;group.add(ramp);
  return {group,floorY,walkHeight,standX:CAVE_X,standZ:CAVE_BACK+1, mouthZ:CAVE_MOUTH};
}
