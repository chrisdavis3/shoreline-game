import * as THREE from '../vendor/three.module.js';
import { MILL, millRaceX, bypassX, valleyFloor, readMillFlow, millRpmForFlow } from './mill-layout.js';
import { CELL, GRID, SIZE } from './terrain.js?v=111';

// A working mill court: all motion and the fountain respond to measured river
// discharge. Scenery is deliberately separate from the hydraulic simulation.
export function buildMillValley(terrain, water) {
  const group = new THREE.Group();
  const mat = (color, roughness=.85) => new THREE.MeshStandardMaterial({color, roughness});
  const stone = mat('#9b9a83'), trim = mat('#c9c5ac'), slate = mat('#394b50');
  const wood = mat('#604732'), iron = mat('#303d3c', .55), glass = mat('#42666a', .28);
  const ground = (x,z) => terrain.sampleHeightBilinear(x,z);
  function mesh(geo, material, x,y,z, parent=group) {
    const m = new THREE.Mesh(geo, material); m.position.set(x,y,z);
    m.castShadow=true; m.receiveShadow=true; parent.add(m); return m;
  }
  const box = (w,h,d,m,x,y,z,p) => mesh(new THREE.BoxGeometry(w,h,d),m,x,y,z,p);
  const mx=MILL.x+7, mz=MILL.z-1, my=ground(mx,mz);
  box(9,7,11,stone,mx,my+3.2,mz);
  box(9.5,.35,11.5,trim,mx,my+.3,mz);
  // Gabled roof, projecting eaves, chimney, deep window openings and shutters.
  for (const side of [-1,1]) {
    const roof=box(5.5,.3,12,slate,mx+side*2.35,my+7.9,mz);
    roof.rotation.z=-side*.48;
  }
  box(1.2,3,1.2,stone,mx+2,my+8.6,mz-3);
  for (const z of [-3,2.7]) for (const h of [2,5]) {
    box(.18,1.6,1.4,glass,mx-4.56,my+h,mz+z);
    box(.24,.12,1.6,trim,mx-4.7,my+h,mz+z);
    box(.24,1.8,.12,trim,mx-4.7,my+h,mz+z);
  }
  box(1.8,2.7,.15,wood,mx,my+1.4,mz+5.6);
  for(let h=.5;h<6.5;h+=.65) box(9.04,.035,11.04,trim,mx,my+h,mz);
  // The wheel lies in the YZ plane, with its paddles in the leat.
  const wheel = new THREE.Group();
  const wheelY=valleyFloor(MILL.z)+1.15;
  wheel.position.set(MILL.x,wheelY,MILL.z); group.add(wheel);
  for(const x of [-.72,.72]) {
    const rim=mesh(new THREE.TorusGeometry(2.3,.14,8,48),wood,x,0,0,wheel);
    rim.rotation.y=Math.PI/2;
    for(let n=0;n<8;n++) {
      const a=n*Math.PI/4;
      const spoke=box(.16,4.5,.14,wood,x,0,0,wheel); spoke.rotation.x=a;
    }
  }
  for(let n=0;n<20;n++) {
    const a=n*Math.PI/10;
    const paddle=box(1.8,.17,.7,wood,0,Math.cos(a)*2.2,Math.sin(a)*2.2,wheel);
    paddle.rotation.x=a;
  }
  const axle=mesh(new THREE.CylinderGeometry(.16,.16,8,12),iron,MILL.x+3,wheelY,MILL.z);
  axle.rotation.z=Math.PI/2;
  // Race-side stonework and pedestrian bridge keep the water visible.
  for(const x of [MILL.x-2.9,MILL.x+2.9]) box(.65,.8,12,stone,x,ground(x,MILL.z)-.05,MILL.z);
  const bz=53, bx=millRaceX(bz), by=ground(bx+4,bz)+.35;
  for(let z=bz-1.2;z<bz+1.2;z+=.35) box(8,.18,.28,wood,bx,by,z);
  for(const z of [bz-1.3,bz+1.3]) {
    box(8,.12,.12,wood,bx,by+1.05,z);
    for(let x=bx-3.8;x<=bx+3.8;x+=1.9) box(.13,1.3,.13,wood,x,by+.55,z);
  }
  // Garden court and fountain are the reward, reached by a visible copper pipe.
  const fx=MILL.fountainX,fz=MILL.fountainZ,fy=ground(fx,fz);
  const paving=mesh(new THREE.CylinderGeometry(6.7,6.7,.15,48),mat('#b3ad92'),fx,fy+.05,fz);
  const basin=mesh(new THREE.TorusGeometry(2.5,.32,10,64),stone,fx,fy+.45,fz); basin.rotation.x=Math.PI/2;
  mesh(new THREE.CylinderGeometry(2.45,2.45,.18,48),glass,fx,fy+.2,fz);
  mesh(new THREE.CylinderGeometry(.25,.45,1.8,16),trim,fx,fy+.95,fz);
  const pipePoints=[new THREE.Vector3(MILL.x+2,wheelY,MILL.z),new THREE.Vector3(mx+1,my+.5,MILL.z+7),new THREE.Vector3(fx,fy+.3,fz),new THREE.Vector3(fx,fy+1.8,fz)];
  mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pipePoints),40,.10,8,false),mat('#9a7950',.45),0,0,0);
  const jets=new THREE.Group(); group.add(jets);
  const jetMat=new THREE.MeshBasicMaterial({color:'#bde4df',transparent:true,opacity:.72});
  for(let n=0;n<8;n++) {
    const a=n*Math.PI/4, pts=[];
    for(let k=0;k<=24;k++) { const t=k/24; pts.push(new THREE.Vector3(Math.cos(a)*t*1.8,1.6+3.2*t-4.2*t*t,Math.sin(a)*t*1.8)); }
    mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts),24,.035,5,false),jetMat,fx,fy,fz,jets);
  }
  // Clustered deciduous woodland. Deterministic placement keeps reloads stable.
  const leafMats=['#536c42','#627745','#3e5c41','#788349'].map(c=>mat(c));
  let seed=1937; const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const trees=[];
  for(let n=0;n<170;n++) {
    const x=3+rand()*(SIZE-6),z=3+rand()*(SIZE-6);
    if (x>45&&x<94&&z>27&&z<87) continue;
    if(Math.abs(x-(z<30?56:bypassX(z)))<6 || (z>28&&Math.abs(x-millRaceX(z))<6)) continue;
    const y=ground(x,z), scale=.8+rand()*.65;
    const tree=new THREE.Group(); tree.position.set(x,y,z); tree.scale.setScalar(scale); group.add(tree);
    mesh(new THREE.CylinderGeometry(.13,.23,3.6,7),wood,0,1.8,0,tree);
    for(let k=0;k<4;k++) mesh(new THREE.IcosahedronGeometry(1.45,1),leafMats[n%4],(rand()-.5)*1.7,3.4+rand()*1.5,(rand()-.5)*1.7,tree);
    trees.push(tree);
  }
  // Distant ground continues the edge height, so there is no floating square.
  const geo=new THREE.PlaneGeometry(520,520,100,100);geo.rotateX(-Math.PI/2);geo.translate(SIZE/2,0,SIZE/2);
  const pos=geo.attributes.position;
  for(let i=0;i<pos.count;i++) {
    const x=pos.getX(i),z=pos.getZ(i),cx=THREE.MathUtils.clamp(x,0,SIZE-.83),cz=THREE.MathUtils.clamp(z,0,SIZE-.83);
    const d=Math.hypot(x-cx,z-cz);
    pos.setY(i,ground(cx,cz)-.6+Math.sin(d*.015)*Math.min(19,d*.12));
  }
  const indices=[];
  for(let j=0;j<100;j++)for(let i=0;i<100;i++) {
    const a=j*101+i,b=a+1,c=a+101,d=c+1;
    const x=pos.getX(a),z=pos.getZ(a);
    if(x>0&&x<SIZE-5.2&&z>0&&z<SIZE-5.2)continue;
    indices.push(a,c,b,b,c,d);
  }
  geo.setIndex(indices);geo.computeVertexNormals();mesh(geo,mat('#687957'),0,0,0);
  let rpm=0, uiTimer=0;
  const hud=document.getElementById('millObjective');
  hud.hidden=false;
  return {group, wheel, get rpm(){return rpm;}, update(dt) {
    const q=readMillFlow(water,CELL,GRID);
    const target=millRpmForFlow(q);
    rpm+=(target-rpm)*(1-Math.exp(-dt*1.5));
    wheel.rotation.x-=rpm*Math.PI/30*dt;
    const power=THREE.MathUtils.clamp((rpm-3)/5,0,1);
    water.millProgress=Math.min(1,(water.millProgress||0)+power*dt/16);
    jets.visible=power>.08; jets.scale.y=.5+power*.5;
    // Keep roots on edited ground, rather than allowing floating scenery.
    for(const tree of trees) tree.position.y=ground(tree.position.x,tree.position.z);
    uiTimer+=dt;
    if(uiTimer>.25) {
      uiTimer=0;
      document.getElementById('millRpm').textContent=rpm.toFixed(1);
      document.getElementById('millProgress').value=water.millProgress;
      document.getElementById('millStatus').textContent=water.millProgress>=1?'The garden is flowing':power>.08?'The pump is lifting water':'Bring the river back to the mill';
      document.getElementById('millTip').textContent=water.millProgress>=1?'Keep the leat flowing to sustain the fountain.':power>.08?'Keep the wheel above 3 rpm to fill the garden supply.':'Upstream, clear the silt from the right fork. Pile it into the left branch to send more water through the wheel.';
    }
  }};
}
