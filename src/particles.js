import * as THREE from 'three';

// A small fixed-size particle pool for sand dust and water splashes.
// Kept deliberately simple: CPU-updated positions written into a Points buffer.

export class Particles {
  constructor(scene, max = 260) {
    this.max = max;
    this.geo = new THREE.BufferGeometry();
    this.positions = new Float32Array(max * 3);
    this.colors = new Float32Array(max * 3);
    this.sizes = new Float32Array(max);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.geo.setAttribute('size', new THREE.BufferAttribute(this.sizes, 1));

    this.material = new THREE.PointsMaterial({
      size: 0.14,
      vertexColors: true,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      sizeAttenuation: true,
    });
    this.points = new THREE.Points(this.geo, this.material);
    this.points.frustumCulled = false;
    scene.add(this.points);

    this.pool = new Array(max).fill(null).map(() => ({
      alive: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, maxLife: 1,
      r: 1, g: 1, b: 1,
    }));
    this.cursor = 0;
  }

  spawn(x, y, z, opts = {}) {
    const p = this.pool[this.cursor];
    this.cursor = (this.cursor + 1) % this.max;
    p.alive = true;
    p.x = x; p.y = y; p.z = z;
    const spread = opts.spread ?? 0.6;
    p.vx = (Math.random() - 0.5) * spread + (opts.vx0 ?? 0);
    p.vz = (Math.random() - 0.5) * spread + (opts.vz0 ?? 0);
    p.vy = (opts.up ?? 1.2) + Math.random() * (opts.upVar ?? 0.8);
    p.life = 0;
    p.maxLife = opts.life ?? 0.6;
    const c = opts.color ?? [0.8, 0.72, 0.55];
    p.r = c[0]; p.g = c[1]; p.b = c[2];
    p.gravity = opts.gravity ?? -3.2;
  }

  burst(x, y, z, count, opts) {
    for (let i = 0; i < count; i++) this.spawn(x, y, z, opts);
  }

  update(dt) {
    for (let i = 0; i < this.max; i++) {
      const p = this.pool[i];
      if (!p.alive) {
        this.positions[i * 3 + 1] = -1000;
        continue;
      }
      p.life += dt;
      if (p.life >= p.maxLife) {
        p.alive = false;
        this.positions[i * 3 + 1] = -1000;
        continue;
      }
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.y < 0) { p.y = 0; p.vy *= -0.2; }
      const t = 1 - p.life / p.maxLife;
      this.positions[i * 3 + 0] = p.x;
      this.positions[i * 3 + 1] = p.y;
      this.positions[i * 3 + 2] = p.z;
      this.colors[i * 3 + 0] = p.r;
      this.colors[i * 3 + 1] = p.g;
      this.colors[i * 3 + 2] = p.b;
      this.sizes[i] = t;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
    this.material.opacity = 0.85;
  }
}
