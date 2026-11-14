import * as THREE from '../vendor/three.module.js';
import { landscapeHeight } from './mawgan-surround.js?v=113';

// OSM way 424487882, B3276 crossing of the Menalhyl. Coordinates use the
// identical geographic transform as the roads, buildings and LiDAR samples.
export const ROAD_BRIDGE={a:{x:86.62,z:15.54},b:{x:88.95,z:18.61},width:1.75};
export function buildMawganBridge(terrain){
  const {a,b,width}=ROAD_BRIDGE,dx=b.x-a.x,dz=b.z-a.z,len=Math.hypot(dx,dz);
  const ux=dx/len,uz=dz/len,cx=(a.x+b.x)/2,cz=(a.z+b.z)/2;
  const span=len+1.4,ramp=2.8,half=span/2;
  const deck=Math.max(1.65,landscapeHeight(terrain,cx-ux*half,cz-uz*half),landscapeHeight(terrain,cx+ux*half,cz+uz*half))+.08;
  const group=new THREE.Group();group.name='B3276 Menalhyl bridge';
  group.position.set(cx,0,cz);group.rotation.y=Math.atan2(ux,uz);
  const stone=new THREE.MeshStandardMaterial({color:'#737c79',roughness:.93});
  const asphalt=new THREE.MeshStandardMaterial({color:'#535b59',roughness:.97});
  function box(w,h,d,x,y,z,material=stone){const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),material);m.position.set(x,y,z);m.castShadow=m.receiveShadow=true;group.add(m);}
  box(width,.22,span,0,deck-.11,0,asphalt);
  // Short parapets and end abutments; the waterway below stays open.
  for(const side of [-1,1]){
    box(.16,.48,span,side*(width/2-.08),deck+.24,0);
    box(.20,.09,span+.10,side*(width/2-.08),deck+.52,0);
    for(const end of [-1,1])box(.40,1.3,.48,side*(width/2-.12),deck-.65,end*(half-.15));
  }
  function local(x,z){return {along:(x-cx)*ux+(z-cz)*uz,across:(x-cx)*uz-(z-cz)*ux};}
  function walkHeight(x,z){
    const p=local(x,z),ground=landscapeHeight(terrain,x,z),distance=Math.abs(p.along);
    if(Math.abs(p.across)>width/2 || distance>half+ramp)return ground;
    if(distance<=half)return Math.max(ground,deck);
    const t=(distance-half)/ramp;return Math.max(ground,deck*(1-t)+ground*t);
  }
  for(const end of [-1,1]){
    const positions=[];
    for(let j=0;j<14;j++)for(let i=0;i<4;i++){
      const verts=[];
      for(const [di,dj] of [[0,0],[1,0],[0,1],[1,1]]){
        const across=-width/2+width*(i+di)/4,along=end*(half+ramp*(j+dj)/14);
        const x=cx+ux*along+uz*across,z=cz+uz*along-ux*across;
        verts.push([across,walkHeight(x,z)+.015,along]);
      }
      for(const id of [0,2,1,1,2,3])positions.push(...verts[id]);
    }
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geo.computeVertexNormals();
    const mat=asphalt.clone();mat.side=THREE.DoubleSide;const m=new THREE.Mesh(geo,mat);m.receiveShadow=true;group.add(m);
  }
  return {group,walkHeight,deck,center:{x:cx,z:cz},axis:{x:ux,z:uz},span,ramp,width};
}
