import * as THREE from '../vendor/three.module.js';
import { mappedRoads } from './mawgan-map.js?v=113';

// Project a small static road mask onto the live ground. Separate ribbons
// intersected the terrain as erosion changed its height beneath them.
let roadTexture;
function roadMask() {
  if(roadTexture)return roadTexture;
  const size=1024,origin=-130,extent=370,data=new Uint8Array(size*size*4),pixel=extent/size;
  for(const road of mappedRoads){
    const foot=['footway','path'].includes(road.kind),width=foot?.28:road.kind==='service'?.7:road.kind==='secondary'?1.35:1.1;
    for(let k=1;k<road.points.length;k++){
      const [ax,az]=road.points[k-1],[bx,bz]=road.points[k],dx=bx-ax,dz=bz-az,len2=dx*dx+dz*dz;
      if(!len2||len2>10000)continue;
      const radius=width*.5+pixel;
      const i0=Math.max(0,Math.floor((Math.min(ax,bx)-radius-origin)/pixel)),i1=Math.min(size-1,Math.ceil((Math.max(ax,bx)+radius-origin)/pixel));
      const j0=Math.max(0,Math.floor((Math.min(az,bz)-radius-origin)/pixel)),j1=Math.min(size-1,Math.ceil((Math.max(az,bz)+radius-origin)/pixel));
      for(let j=j0;j<=j1;j++)for(let i=i0;i<=i1;i++){
        const x=origin+(i+.5)*pixel,z=origin+(j+.5)*pixel;
        if(x<-90||x>170||z<-115||z>38)continue;
        const t=Math.max(0,Math.min(1,((x-ax)*dx+(z-az)*dz)/len2));
        const distance=Math.hypot(x-ax-t*dx,z-az-t*dz);
        const value=Math.round(255*Math.max(0,Math.min(1,(width*.5+pixel*.5-distance)/pixel)));
        const index=(j*size+i)*4+(foot?1:0);data[index]=Math.max(data[index],value);
      }
    }
  }
  roadTexture=new THREE.DataTexture(data,size,size,THREE.RGBAFormat);
  roadTexture.minFilter=roadTexture.magFilter=THREE.LinearFilter;roadTexture.needsUpdate=true;
  return roadTexture;
}

// Fine material detail is shaded on the GPU; it never increases physics resolution.
// World-space sampling stays attached to the ground when it is dug or piled.
export function coastalMaterial() {
  const material=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.94,metalness:0});
  material.onBeforeCompile=shader=>{
    shader.uniforms.uRoadMask={value:roadMask()};
    shader.vertexShader='varying vec3 vGround;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvGround=(modelMatrix*vec4(position,1.0)).xyz;');
    shader.fragmentShader=`varying vec3 vGround;
      uniform sampler2D uRoadMask;
      float hashGround(vec3 p){p=fract(p*.1031);p+=dot(p,p.yzx+33.33);return fract((p.x+p.y)*p.z);}
      float groundNoise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
      return mix(mix(mix(hashGround(i),hashGround(i+vec3(1,0,0)),f.x),mix(hashGround(i+vec3(0,1,0)),hashGround(i+vec3(1,1,0)),f.x),f.y),mix(mix(hashGround(i+vec3(0,0,1)),hashGround(i+vec3(1,0,1)),f.x),mix(hashGround(i+vec3(0,1,1)),hashGround(i+vec3(1,1,1)),f.x),f.y),f.z);}
      `+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
      float turf=smoothstep(0.01,0.065,vColor.g-vColor.r);
      float rock=1.0-smoothstep(0.015,0.13,vColor.r-vColor.b);
      rock*=1.0-turf;
      float grain=groundNoise(vGround*5.0);
      float patches=groundNoise(vGround*.65);
      float bedding=sin(vGround.y*8.0+vGround.x*1.7+patches*4.0);
      float aa=1.0-smoothstep(.3,2.0,fwidth(vGround.y*8.0+vGround.x*1.7));
      float detail=(grain-.5)*.12+(patches-.5)*.18+rock*bedding*.12*aa;
      diffuseColor.rgb*=1.0+detail;
      vec2 road=texture2D(uRoadMask,(vGround.xz+130.0)/370.0).rg;
      diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.35,.29,.19)*(1.0+detail*.3),road.g*.75);
      diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.19,.20,.18)*(1.0+detail*.25),road.r*.96);
    `);
    shader.fragmentShader=shader.fragmentShader.replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>
      float wetSand=(1.0-turf)*(1.0-rock)*(1.0-smoothstep(0.0,1.8,vGround.y));
      roughnessFactor=mix(.94,.42,wetSand);
    `);
    shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
      float relief=grain*.018+patches*.04+rock*bedding*.025*aa;
      vec3 dpdx=dFdx(vViewPosition),dpdy=dFdy(vViewPosition);
      vec3 rx=cross(dpdy,normal),ry=cross(normal,dpdx);
      float det=dot(dpdx,rx);
      vec3 grad=sign(det)*(dFdx(relief)*rx+dFdy(relief)*ry);
      normal=normalize(abs(det)*normal+grad);
    `);
  };
  material.customProgramCacheKey=()=> 'coastal-ground-112';
  return material;
}
