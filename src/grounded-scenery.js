import * as THREE from '../vendor/three.module.js';

// Decorative instances only. Movable gameplay rocks never enter this registry.
export class GroundedScenery {
  constructor(terrain,water) {
    this.terrain=terrain;this.water=water;this.items=[];this.cursor=0;
    this.matrix=new THREE.Matrix4();
  }
  add(mesh,index,x,z,offset=0,vegetation=false) {
    mesh.getMatrixAt(index,this.matrix);
    this.items.push({mesh,index,x,z,offset,vegetation,base:this.matrix.elements.slice(),hidden:false});
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // Erosion can move instances outside the original static bounding sphere.
    // These are a few existing batches, not thousands of separate draw calls.
    mesh.frustumCulled=false;
  }
  update(budget=256) {
    const changed=new Set();
    for(let n=0;n<Math.min(budget,this.items.length);n++) {
      const item=this.items[this.cursor];
      this.cursor=(this.cursor+1)%this.items.length;
      const {mesh,index,x,z,offset,vegetation,base}=item;
      const depth=this.water.depthAt(x,z);
      const cell=this.terrain.cellIndexAt(x,z);
      const disturbed=cell>=0 && this.terrain.disturbance[cell]>.15;
      const hidden=vegetation && (disturbed || depth>(item.hidden ? .025 : .06));
      const y=this.terrain.sampleHeightBilinear(x,z)+offset;
      const data=mesh.instanceMatrix.array, start=index*16;
      if(hidden!==item.hidden || Math.abs(data[start+13]-y)>.008) {
        for(let k=0;k<16;k++)data[start+k]=hidden && k<12 ? 0 : base[k];
        data[start+13]=y;
        item.hidden=hidden;changed.add(mesh);
      }
    }
    for(const mesh of changed)mesh.instanceMatrix.needsUpdate=true;
  }
}
