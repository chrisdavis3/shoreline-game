import * as THREE from '../vendor/three.module.js';
import { mawganHeight, mawganColour } from './mawgan.js?v=112';
import { mappedBuildings } from './mawgan-map.js?v=112';
import { FINE_GRID, FINE_CELL } from './terrain.js?v=112';
import { coastalMaterial } from './coastal-material.js?v=112';
const EDGE=139*.82;
export function landscapeHeight(terrain,x,z) {
  if(x>=0&&x<=EDGE&&z>=0&&z<=EDGE)return terrain.sampleHeightBilinear(x,z);
  const cx=THREE.MathUtils.clamp(x,0,EDGE),cz=THREE.MathUtils.clamp(z,0,EDGE);
  const distance=Math.hypot(x-cx,z-cz);
  return mawganHeight(x,z)+(terrain.sampleHeightBilinear(cx,cz)-mawganHeight(cx,cz))*Math.max(0,1-distance/8);
}
export function buildMawganSurround(terrain) {
  const group=new THREE.Group();group.name='Mawgan Porth headlands and mapped roads';
  const axis=[-800,-600,-400,-250,-180];for(let x=-130;x<0;x+=2)axis.push(x);
  for(let x=0;x<EDGE;x+=1.64)axis.push(x);
  axis.push(EDGE);for(let x=EDGE+2;x<=240;x+=2)axis.push(x);
  axis.push(400,600,800);
  const n=axis.length,p=[],c=[],indices=[];
  for(const z of axis)for(const x of axis){
    const y=landscapeHeight(terrain,x,z);
    const slope=Math.hypot(mawganHeight(x+.4,z)-mawganHeight(x-.4,z),mawganHeight(x,z+.4)-mawganHeight(x,z-.4))/.8;
    p.push(x,y,z);c.push(...mawganColour(x,z,y,slope));
  }
  for(let j=0;j<n-1;j++)for(let i=0;i<n-1;i++){
    if(axis[i]>=0&&axis[i+1]<=EDGE&&axis[j]>=0&&axis[j+1]<=EDGE)continue;
    const a=j*n+i;indices.push(a,a+n,a+1,a+1,a+n,a+n+1);
  }
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(p,3));geo.setAttribute('color',new THREE.Float32BufferAttribute(c,3));geo.setIndex(indices);geo.computeVertexNormals();
  const mesh=new THREE.Mesh(geo,coastalMaterial());mesh.receiveShadow=true;group.add(mesh);
  function ground(x,z) {
    if(x>=0&&x<=EDGE&&z>=0&&z<=EDGE){
      const fx=x/FINE_CELL,fz=z/FINE_CELL,i=Math.min(FINE_GRID-2,Math.floor(fx)),j=Math.min(FINE_GRID-2,Math.floor(fz));
      const u=fx-i,v=fz-j,arr=terrain.geometry.attributes.position.array;
      const a=arr[(j*FINE_GRID+i)*3+1],b=arr[(j*FINE_GRID+i+1)*3+1],c=arr[((j+1)*FINE_GRID+i)*3+1],d=arr[((j+1)*FINE_GRID+i+1)*3+1];
      return u+v<=1?a+(b-a)*u+(c-a)*v:d+(c-d)*(1-u)+(b-d)*(1-v);
    }
    let i=0,j=0;while(i<n-2&&axis[i+1]<x)i++;while(j<n-2&&axis[j+1]<z)j++;
    const u=THREE.MathUtils.clamp((x-axis[i])/(axis[i+1]-axis[i]),0,1),v=THREE.MathUtils.clamp((z-axis[j])/(axis[j+1]-axis[j]),0,1);
    const a=p[(j*n+i)*3+1],b=p[(j*n+i+1)*3+1],c=p[((j+1)*n+i)*3+1],d=p[((j+1)*n+i+1)*3+1];
    return u+v<=1?a+(b-a)*u+(c-a)*v:d+(c-d)*(1-u)+(b-d)*(1-v);
  }
  // Small garden hedges give the mapped settlement scale and contact with the
  // hillside. This is authored scenery, not claimed as surveyed vegetation.
  const hedges=new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1,1),new THREE.MeshStandardMaterial({color:'#354d27',roughness:1}),mappedBuildings.length*4);
  const dummy=new THREE.Object3D();let count=0;
  for(let i=0;i<mappedBuildings.length;i++){
    const b=mappedBuildings[i];if(b.z>15||b.w>8||b.d>8)continue;
    for(let j=0;j<3;j++){
      const x=b.x+(j-1)*.7,z=b.z-b.d*.5-1.1,y=ground(x,z);
      if(y<3)continue;
      dummy.position.set(x,y+.35,z);dummy.scale.set(.65,.45+(i%4)*.08,.55);dummy.rotation.set(0,i,0);dummy.updateMatrix();hedges.setMatrixAt(count++,dummy.matrix);
    }
  }
  hedges.count=count;hedges.receiveShadow=true;group.add(hedges);
  return group;
}
