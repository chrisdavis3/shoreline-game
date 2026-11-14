import * as THREE from '../vendor/three.module.js';
// Same material, tide and wave phase as the simulated water; no overlapping
// rectangle of differently coloured ocean. The inner mesh remains authoritative.
export function buildCoastalOcean(water) {
  const edge=139*.82;
  const axis=[-1200,-700,-350,-170,-80,-30,0,60,edge,edge+10,edge+25,edge+50,edge+100,edge+200,edge+400,edge+800,edge+1500];
  const p=[],uv=[],coast=[],indices=[],n=axis.length;
  for(const z of axis)for(const x of axis){p.push(x,0,z);uv.push((x/.82+.5)/140,(z/.82+.5)/140);coast.push(114.8*.65);}
  for(let j=0;j<n-1;j++)for(let i=0;i<n-1;i++){
    if(axis[j+1]<=60)continue; // Ocean does not extend into the inland river valley.
    if(axis[i]>=0&&axis[i+1]<=edge&&axis[j]>=0&&axis[j+1]<=edge)continue;
    const a=j*n+i;indices.push(a,a+n,a+1,a+1,a+n,a+n+1);
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setAttribute('aFieldUV',new THREE.Float32BufferAttribute(uv,2));g.setAttribute('aCoastZ',new THREE.Float32BufferAttribute(coast,1));g.setIndex(indices);
  const material=water.material.clone();material.uniforms={...water.uniforms,uFarOcean:{value:1}};
  const mesh=new THREE.Mesh(g,material);mesh.frustumCulled=false;mesh.renderOrder=2;
  return {mesh,uniforms:water.uniforms};
}
