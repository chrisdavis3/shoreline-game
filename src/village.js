import * as THREE from '../vendor/three.module.js';
import {CELL, idx, streamCenterX, warpX} from './terrain.js?v=111';

// Static architecture is merged by material after placement. Detail should not
// turn a small village into hundreds of separate draw calls on a phone.
function bakeArchitecture(root) {
  root.updateMatrixWorld(true);
  const batches = new Map();
  root.traverse(object => {
    if (!object.isMesh) return;
    const geometry = object.geometry.index ? object.geometry.toNonIndexed() : object.geometry.clone();
    geometry.applyMatrix4(object.matrixWorld);
    if (!batches.has(object.material)) batches.set(object.material, []);
    batches.get(object.material).push(geometry);
  });
  const baked = new THREE.Group();
  for (const [material, geometries] of batches) {
    const count = geometries.reduce((n, g) => n + g.attributes.position.count * 3, 0);
    const positions = new Float32Array(count), normals = new Float32Array(count);
    let offset = 0;
    for (const g of geometries) {
      positions.set(g.attributes.position.array, offset);
      normals.set(g.attributes.normal.array, offset);
      offset += g.attributes.position.array.length;
      g.dispose();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, material);
    mesh.castShadow = mesh.receiveShadow = true;
    baked.add(mesh);
  }
  root.traverse(o => { if (o.isMesh) o.geometry.dispose(); });
  return baked;
}

export function buildCoastalVillage(terrain) {
  const root = new THREE.Group();
  const material = (color, roughness=.9) => new THREE.MeshStandardMaterial({color, roughness});
  const plaster = ['#e8e7da','#d8ded7','#ddd9c8'].map(c => material(c));
  const slate = material('#3f4e55'), slateSeams = material('#56636a');
  const trim = material('#ecebdc'), glass = material('#365d69', .35);
  const foundation = material('#858579'), timber = material('#567778');
  const redDoor = material('#8c4938'), chimneyPot = material('#9a7153');
  const placements = [];
  let door = null, seed = 27091937;
  const rand = () => { seed = (Math.imul(seed,1664525)+1013904223)>>>0; return seed/4294967296; };
  function box(parent,w,h,d,mat,x,y,z,rotation=0) {
    const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);
    mesh.position.set(x,y,z);mesh.rotation.z=rotation;parent.add(mesh);return mesh;
  }
  for (let attempt=0; attempt<1600 && placements.length<24; attempt++) {
    const x=14+rand()*59, z=3+rand()*17;
    const w=3.2+rand()*1.6, d=3.0+rand()*1.5;
    const rotation=(rand()-.5)*.42;
    const radius=Math.hypot(w,d)/2;
    if(Math.abs(x-streamCenterX(z))<15)continue;
    if(terrain.blocked[idx(Math.round(x/CELL),Math.round(z/CELL))])continue;
    if(placements.some(p=>Math.hypot(p.x-x,p.z-z)<p.radius+radius+.65))continue;
    const corners=[];
    for(const xx of [-w/2,w/2])for(const zz of [-d/2,d/2]){
      const wx=x+xx*Math.cos(rotation)+zz*Math.sin(rotation);
      const wz=z-xx*Math.sin(rotation)+zz*Math.cos(rotation);
      corners.push(terrain.sampleHeightBilinear(wx,wz));
    }
    const low=Math.min(...corners), high=Math.max(...corners);
    if(high-low>.75)continue;
    // Foundations descend into the slope; the walls begin above the highest
    // corner. Averaging corner heights left half the old houses floating.
    const y=high+.06, plinthHeight=high-low+.25;
    const house=new THREE.Group();house.position.set(warpX(x,z),y,z);house.rotation.y=rotation;root.add(house);
    const hero=placements.length===0;
    const storeys=rand()>.5?2:1, height=storeys===2?3.9:2.5;
    const wall=plaster[placements.length%plaster.length];
    box(house,w+.16,plinthHeight,d+.16,foundation,0,-plinthHeight/2+.08,0);
    box(house,w,height,d,wall,0,height/2,0);
    const rise=w*.28, pitch=Math.atan2(rise,w/2), roofLength=Math.hypot(w/2+.16,rise+.09);
    const gable=new THREE.Shape();gable.moveTo(-w/2,0);gable.lineTo(w/2,0);gable.lineTo(0,rise);gable.closePath();
    const endWalls=new THREE.Mesh(new THREE.ExtrudeGeometry(gable,{depth:d,bevelEnabled:false}),wall);
    endWalls.position.set(0,height,-d/2);house.add(endWalls);
    for(const side of [-1,1]) {
      box(house,roofLength,.13,d+.4,slate,side*w/4,height+rise/2,0,-side*pitch);
      for(const zz of [-d/2-.21,d/2+.21])box(house,roofLength,.10,.09,trim,side*w/4,height+rise/2,zz,-side*pitch);
      for(let row=1;row<7;row++) {
        const fraction=row/7;
        box(house,.025,.018,d+.36,slateSeams,side*fraction*w/2,height+rise*(1-fraction)+.09,0,-side*pitch);
      }
      box(house,.10,.13,d+.4,trim,side*(w/2+.12),height-.025,0);
    }
    box(house,.13,.12,d+.38,slateSeams,0,height+rise+.04,0);
    // Frames and shallow reveals give windows depth at ordinary play distance.
    function windowOn(parent,wx,wy,wz,width=.68) {
      box(parent,width+.16,.98,.08,trim,wx,wy,wz);
      box(parent,width,.81,.10,glass,wx,wy,wz+.055);
      box(parent,.045,.82,.035,trim,wx,wy,wz+.12);
      box(parent,width,.045,.035,trim,wx,wy,wz+.12);
      box(parent,width+.22,.09,.24,trim,wx,wy-.5,wz+.06);
    }
    for(const side of [-1,1]) {
      const facade=new THREE.Group();facade.rotation.y=side===1?0:Math.PI;house.add(facade);
      for(const wx of [-w*.29,w*.29]) windowOn(facade,wx,1.55,d/2+.01);
      if(storeys===2)for(const wx of [-w*.29,w*.29])windowOn(facade,wx,3.05,d/2+.01);
    }
    for(const side of [-1,1]) {
      const end=new THREE.Group();end.position.x=side*w/2;end.rotation.y=side*Math.PI/2;house.add(end);
      windowOn(end,0,1.55,.015,.8);
      if(storeys===2)windowOn(end,0,3.05,.015,.8);
    }
    box(house,.92,1.91,.11,trim,0,.95,d/2+.05);
    box(house,.73,1.75,.12,hero?redDoor:timber,0,.89,d/2+.12);
    box(house,.46,.43,.035,glass,0,1.4,d/2+.20);
    box(house,.055,.055,.06,chimneyPot,.25,.84,d/2+.22);
    // Low threshold leaves an unobstructed approach to the hidden entrance.
    box(house,1.22,.12,.55,foundation,0,.01,d/2+.29);
    box(house,.48,1.2,.54,wall,-w*.26,height+rise*.75+.28,-d*.22);
    box(house,.62,.12,.68,foundation,-w*.26,height+rise*.75+.92,-d*.22);
    for(const zz of [-.13,.13]) {
      const pot=new THREE.Mesh(new THREE.CylinderGeometry(.085,.11,.3,8),chimneyPot);
      pot.position.set(-w*.26,height+rise*.75+1.12,-d*.22+zz);house.add(pot);
    }
    if(hero) {
      house.updateMatrixWorld(true);
      const doorPos=house.localToWorld(new THREE.Vector3(0,0,d/2));
      const standPos=house.localToWorld(new THREE.Vector3(0,0,d/2+1.6));
      door={x:doorPos.x,z:doorPos.z,standX:standPos.x,standZ:standPos.z,facing:rotation};
    }
    placements.push({x,z,radius,rotation,floor:y,lowestCorner:low,highestCorner:high,storeys});
  }
  const group=bakeArchitecture(root);
  group.name='Coastal village';
  return {group,door,placements};
}
