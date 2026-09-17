import * as THREE from '../vendor/three.module.js';
import { L2_LIP_X, L2_T_FALL1, SIZE } from './terrain.js?v=104';

export function buildHiddenDoor(terrain) {
  const group = new THREE.Group();
  const standX=L2_LIP_X, standZ=L2_T_FALL1*SIZE+.5;
  const y=terrain.sampleHeightBilinear(standX,standZ);
  const wood=new THREE.MeshStandardMaterial({color:'#283733',roughness:.9});
  const stone=new THREE.MeshStandardMaterial({color:'#555e59',roughness:1});
  function block(w,h,d,x,yy,z,material) {
    const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),material);
    m.position.set(x,yy,z);m.castShadow=true;m.receiveShadow=true;group.add(m);return m;
  }
  // Facing the landing pool, just behind the last sheet of falling water.
  const z=standZ-.85;
  block(1.8,2.7,.18,standX,y+1.3,z,wood);
  block(.35,3.1,.5,standX-1.05,y+1.4,z,stone);
  block(.35,3.1,.5,standX+1.05,y+1.4,z,stone);
  block(2.45,.4,.5,standX,y+3,z,stone);
  const handle=block(.10,.12,.12,standX+.5,y+1.3,z+.15,new THREE.MeshStandardMaterial({color:'#b6a26b',metalness:.6,roughness:.4}));
  return {group,standX,standZ};
}
