import * as THREE from 'three';
import { GRID, CELL, SIZE, streamCenterX } from './terrain.js?v=4';
import { Noise2D } from './noise.js?v=4';

const rn = new Noise2D(777);

function makeRockGeometry(scale, seed) {
  const geo = new THREE.IcosahedronGeometry(scale, 1);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const n = rn.fbm(x * 1.4 + seed, z * 1.4 + seed * 2, 3);
    const n2 = rn.fbm(x * 3.1 + seed * 3, y * 3.1 - seed, 2);
    const bump = 1 + n * 0.22 + n2 * 0.08;
    pos.setXYZ(i, x * bump, y * bump * (0.78 + Math.abs(n) * 0.25), z * bump);
  }
  geo.computeVertexNormals();
  return geo;
}

const ROCK_COLORS = ['#8c8a82', '#79766d', '#96887a', '#6f6c66', '#a39786'];

export class Rock {
  constructor(x, z, size, terrain) {
    this.size = size; // 'small' | 'medium' | 'large'
    this.radius = size === 'small' ? 0.14 + Math.random() * 0.1
      : size === 'medium' ? 0.75 + Math.random() * 0.25
      : 1.2 + Math.random() * 0.5;
    this.mass = size === 'small' ? 1 : size === 'medium' ? 3 : 7;

    const geo = makeRockGeometry(this.radius, Math.random() * 1000);
    const color = ROCK_COLORS[Math.floor(Math.random() * ROCK_COLORS.length)];
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.92, flatShading: true });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);

    this.x = x; this.z = z;
    this.terrain = terrain;
    this.carried = false;
    this.settle(terrain);
    this._applyBlockedMask(terrain);
  }

  settle(terrain) {
    const y = terrain.sampleHeightBilinear(this.x, this.z);
    this.mesh.position.set(this.x, y + this.radius * 0.25, this.z);
  }

  _cellsUnder() {
    const cells = [];
    const r = this.radius * 0.7;
    const i0 = Math.max(0, Math.floor((this.x - r) / CELL));
    const i1 = Math.min(GRID - 1, Math.ceil((this.x + r) / CELL));
    const j0 = Math.max(0, Math.floor((this.z - r) / CELL));
    const j1 = Math.min(GRID - 1, Math.ceil((this.z + r) / CELL));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const dx = i * CELL - this.x, dz = j * CELL - this.z;
        if (Math.sqrt(dx * dx + dz * dz) <= r) cells.push(j * GRID + i);
      }
    }
    return cells;
  }

  _applyBlockedMask(terrain) {
    if (this.size === 'small') return; // small rocks are lifted clean off the ground, no blocking
    for (const k of this._cellsUnder()) terrain.blocked[k] = 1;
  }

  _clearBlockedMask(terrain) {
    for (const k of this._cellsUnder()) terrain.blocked[k] = 0;
  }

  moveTo(x, z, terrain) {
    this._clearBlockedMask(terrain);
    this.x = x; this.z = z;
    this.settle(terrain);
    this._applyBlockedMask(terrain);
    terrain.markDirty();
  }

  pickUp() {
    this.carried = true;
    if (this.terrain) this._clearBlockedMask(this.terrain);
  }

  putDown(x, z, terrain) {
    this.carried = false;
    this.x = x; this.z = z;
    this.settle(terrain);
    this._applyBlockedMask(terrain);
    terrain.markDirty();
  }
}

export function scatterRocks(terrain, scene, count = 46) {
  const rocks = [];
  let placed = 0, attempts = 0;
  while (placed < count && attempts < count * 20) {
    attempts++;
    const x = Math.random() * SIZE;
    const z = Math.random() * SIZE * 0.72 + SIZE * 0.03;
    const t = z / SIZE;
    const cx = streamCenterX(z);
    const distToStream = Math.abs(x - cx);

    // bias placement: some rocks sit right in/near the stream (great for splitting flow),
    // others scattered across dunes and the beach.
    const nearStream = distToStream < 4.5;
    const roll = Math.random();
    let size = 'small';
    if (roll > 0.82) size = 'large';
    else if (roll > 0.5) size = 'medium';

    // Small rocks never block flow (they're pickup-only, see Rock._applyBlockedMask),
    // so they can sit anywhere including right in the stream. Medium/large rocks DO
    // block their footprint - keep them clear of the channel's actual width (in
    // metres; the carve `width` parameter is in CELLS, easy to mix up) plus their own
    // footprint radius, or a rock can fully dam a channel this narrow with no bypass.
    if (size !== 'small') {
      const channelHalfWidthM = (2.4 + 2.4 * t) * 0.82 * 1.6;
      const footprint = size === 'large' ? 1.6 : 1.0;
      if (distToStream < channelHalfWidthM + footprint) continue;
    }

    if (!nearStream && Math.random() < 0.3) continue; // thin out slightly for natural spacing

    const r = new Rock(x, z, size, terrain);
    // avoid stacking rocks too close together
    let tooClose = false;
    for (const other of rocks) {
      const dx = other.x - x, dz = other.z - z;
      if (Math.sqrt(dx * dx + dz * dz) < (r.radius + other.radius) * 1.6) { tooClose = true; break; }
    }
    if (tooClose) continue;

    scene.add(r.mesh);
    rocks.push(r);
    placed++;
  }
  return rocks;
}
