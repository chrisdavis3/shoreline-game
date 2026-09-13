import * as THREE from 'three';
import { SIZE, CELL, streamCenterX, coastT, warpX } from './terrain.js?v=80';

// Small floating leaves/twigs that ride the stream's ACTUAL simulated current
// (water.flowAt's real per-cell velX/velZ, not a scripted path) from source to
// sea and loop back - the point isn't just decoration, it's a constant, visible
// demonstration that water is always moving downstream, the way the user asked
// for: "I would ideally like to see a leaf just floating all the way down the
// river... water is always flowing, constantly."
const COUNT = 6;
const MAX_LIFETIME = 90; // seconds - a safety net if a leaf ever gets stuck in a dead eddy
const STRAND_LIMIT = 4;  // seconds allowed sitting on dry ground before respawning

export class Debris {
  constructor(scene, terrain, water) {
    this.terrain = terrain;
    this.water = water;
    this.leaves = [];

    // Sized up from a literal real leaf (~7cm) to ~16cm - at the chase camera's
    // usual distance a true-scale leaf was nearly impossible to actually spot
    // against the water's own texture/caustics, defeating the whole point.
    const leafGeo = new THREE.CircleGeometry(0.16, 6);
    const twigGeo = new THREE.CylinderGeometry(0.014, 0.018, 0.32, 4);

    for (let n = 0; n < COUNT; n++) {
      const isTwig = n % 3 === 2;
      const geo = isTwig ? twigGeo : leafGeo;
      const color = isTwig ? '#7a5a36' : (Math.random() < 0.5 ? '#8a6b3a' : '#6b7a3a');
      const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.92, side: THREE.DoubleSide, flatShading: true });
      const mesh = new THREE.Mesh(geo, mat);
      if (isTwig) mesh.rotation.z = Math.PI / 2; else mesh.rotation.x = -Math.PI / 2;
      mesh.castShadow = false;
      scene.add(mesh);
      const leaf = { mesh, x: 0, z: 0, age: 0, dryTimer: 0, spin: (Math.random() - 0.5) * 1.2, bobPhase: Math.random() * Math.PI * 2 };
      this.leaves.push(leaf);
      // Stagger initial spawns along the stream's length so they don't all bunch
      // up together on the first lap.
      this._respawn(leaf, (n / COUNT) * SIZE * 0.5);
    }
  }

  _respawn(leaf, zStart) {
    const z = THREE.MathUtils.clamp(zStart ?? (1 + Math.random() * 3), 0.5, SIZE - 0.5);
    leaf.x = streamCenterX(z) + (Math.random() - 0.5) * 1.2;
    leaf.z = z;
    leaf.age = 0;
    leaf.dryTimer = 0;
  }

  update(dt, elapsed) {
    for (const leaf of this.leaves) {
      leaf.age += dt;
      const flow = this.water.flowAt(leaf.x, leaf.z);
      const depth = this.water.depthAt(leaf.x, leaf.z);
      if (depth > 0.008) {
        leaf.x += flow.vx * dt;
        leaf.z += flow.vz * dt;
        leaf.dryTimer = 0;
      } else {
        leaf.dryTimer += dt;
      }

      // Reached the open sea (past this column's real coastline by a margin),
      // been stranded on dry ground too long, drifted off the map, or simply
      // been going long enough that it's clearly not making progress - loop it
      // back to the source rather than let it vanish or drift forever.
      const i = THREE.MathUtils.clamp(Math.round(leaf.x / CELL), 0, 139);
      const reachedSea = leaf.z / SIZE > coastT(i) + 0.05;
      if (reachedSea || leaf.dryTimer > STRAND_LIMIT || leaf.age > MAX_LIFETIME
        || leaf.x < 0.3 || leaf.x > SIZE - 0.3 || leaf.z < 0.3) {
        this._respawn(leaf);
        continue;
      }

      // The water mesh's own vertex shader adds ripple/foam/crest displacement on
      // top of this flat terrain+depth sum, so a small clearance here still ends
      // up visually submerged under the animated surface - clear it generously.
      const y = this.terrain.sampleHeightBilinear(leaf.x, leaf.z) + depth + 0.07
        + Math.sin(elapsed * 2.2 + leaf.bobPhase) * 0.015;
      leaf.mesh.position.set(warpX(leaf.x, leaf.z), y, leaf.z);
      leaf.mesh.rotation.y += leaf.spin * dt;
    }
  }
}
