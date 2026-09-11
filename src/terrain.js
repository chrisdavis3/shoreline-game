import * as THREE from 'three';
import { Noise2D } from './noise.js?v=23';

// Grid-based terrain heightfield shared by rendering, water sim, and rocks.
// Coordinate convention: world (x, z) in metres, x in [0, SIZE), z in [0, SIZE).
// z=0 is inland (dunes / high ground), z=SIZE is the open sea.

export const GRID = 140;          // cells per side
export const CELL = 0.82;         // metres per cell
export const SIZE = GRID * CELL;  // world size (metres)

const n1 = new Noise2D(1337);
const n2 = new Noise2D(9001);
const n3 = new Noise2D(4242);

function idx(i, j) { return j * GRID + i; }

// Stream centreline: a gentle meander from the dunes down to the sea.
function streamCenterX(z) {
  const t = z / SIZE;
  return SIZE * 0.72 + Math.sin(t * 5.4 + 0.6) * SIZE * 0.06 * (0.4 + t) + n2.fbm(0, t * 3, 2) * SIZE * 0.03;
}

// The coastline's t-threshold (0..1, inland->sea) as a function of column i - a
// real bay silhouette, not a straight line: two low-frequency octaves carve
// genuine coves and headland points tens of metres across (comparable in scale
// to Mawgan Porth's own bay). This is the SINGLE source of truth for where
// "land" ends and "sea" begins at this column - the water sim's tide zone and
// erosion cutoff both call this too, so the simulation's idea of the coastline
// always matches what's actually rendered, instead of a flat cutoff that would
// flood a cove early or starve a headland point of its own tide/erosion.
export function coastT(i) {
  // The real constraint here isn't amplitude or frequency alone, it's their
  // PRODUCT: that sets how fast the coastline shifts sideways in z per single
  // column of x. Get that too high and the line looks jagged/zigzagged from
  // ANY camera angle or transition width, no matter how the vertical land/sea
  // blend is tuned - confirmed by direct measurement (an earlier version's
  // coastline shifted over 10 grid cells of z across just 3-4 columns of x,
  // close to a 45-degree diagonal at its steepest, which reads as a sawtooth
  // rather than a curve). Tuned so each octave's own amp*freq stays small
  // enough for a smooth, gently curving bay - still ~1 cycle plus a secondary
  // wave, at a real, visible scale (tens of metres), just not a fast zigzag.
  const bigCove = n3.fbm(i * 0.05 + 200, 0, 1);
  const medCove = n3.fbm(i * 0.11 + 600, 0, 1);
  return 0.60 + bigCove * 0.09 + medCove * 0.035;
}

export class Terrain {
  constructor() {
    this.bedrock = new Float32Array(GRID * GRID); // hard, barely erodable base
    this.height = new Float32Array(GRID * GRID);  // current surface height (bedrock + loose sand)
    this.hardness = new Float32Array(GRID * GRID); // 0 = loose sand, 1 = rock/hard
    this.blocked = new Uint8Array(GRID * GRID);    // occupied by a placed/large rock
    this.moisture = new Float32Array(GRID * GRID); // 0..1, set by water sim for shading/footprints
    this.disturbance = new Float32Array(GRID * GRID); // 0..1, freshly dug/piled sand - fades over time
    this._generate();

    this.geometry = new THREE.PlaneGeometry(SIZE, SIZE, GRID - 1, GRID - 1);
    this.geometry.rotateX(-Math.PI / 2);
    this.geometry.translate(SIZE / 2, 0, SIZE / 2);
    this.colors = new Float32Array(GRID * GRID * 3);
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));

    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.96,
      metalness: 0.0,
      flatShading: false,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;

    this._syncPositions();
    this._updateColors();
    this.geometry.computeVertexNormals();

    this._colorDirtyAccum = 0;
  }

  _generate() {
    for (let j = 0; j < GRID; j++) {
      for (let i = 0; i < GRID; i++) {
        const x = i * CELL, z = j * CELL;
        const t = z / SIZE; // 0 inland -> 1 sea

        // Base profile modelled loosely on Mawgan Porth: a wide bay with a long,
        // gently-shelving sandy beach (broad low-tide sands), dunes at the back,
        // and rocky headlands closing off both sides of the bay.
        // Build the LAND profile first (as if there were no sea at all), then blend
        // to a fixed sea depth right at the coastline over a narrow, fixed-width
        // transition. Earlier this used a single subtractive dip term whose onset
        // was entangled with the ambient inland slope - a big swing in the
        // coastline threshold barely moved the real land/sea crossing point
        // (measured: +/-0.3 in threshold only moved the crossing by +/-0.09).
        // Blending against a flat, coastline-independent sea depth instead means
        // the crossing point tracks the threshold almost exactly, so real coves
        // and points actually show up at the scale they're specified.
        let hLand = 0;
        hLand += (1 - t) * 5.2;                              // gentle overall inland-to-sea slope
        hLand += Math.exp(-Math.pow((t - 0.10) / 0.09, 2)) * 2.5;  // primary dune ridge
        hLand += Math.exp(-Math.pow((t - 0.24) / 0.09, 2)) * 1.0;  // secondary, lower dune ridge

        // Rocky headland cliffs closing both sides of the bay (like Mawgan Porth's cliffs):
        // a steep rise near the edge that levels into a clifftop plateau, not a soft dune bump.
        const cliffWidth = SIZE * 0.115;
        const dL = Math.abs(i * CELL - SIZE * 0.045);
        const dR = Math.abs(i * CELL - SIZE * 0.955);
        // An exponent below 1 here (was 0.32) has an unbounded derivative right at
        // its own zero point - the very first active cell past the cliff's outer
        // edge jumps straight to ~40% of full mask height, not a gradual rise, and
        // with an 11.5-unit headland coefficient that's a real visible seam right
        // where the cliff's influence begins. An exponent above 1 starts smooth
        // (small slope near zero) and only steepens near the clifftop itself,
        // which also reads as more natural - a gentle talus slope at the base,
        // steep rock face higher up - rather than a jump straight into the mask.
        const maskL = Math.pow(THREE.MathUtils.clamp(1 - dL / cliffWidth, 0, 1), 1.6);
        const maskR = Math.pow(THREE.MathUtils.clamp(1 - dR / cliffWidth, 0, 1), 1.6);
        const headland = Math.max(maskL, maskR);
        hLand += headland * (11.5 + n1.fbm(i * 0.06, j * 0.06, 3) * 1.8) * Math.max(0.55, 1 - t * 0.18);

        const coastline = coastT(i);
        // Fine detail noise, larger inland (soft dune texture) smaller on the wide
        // sand flats - and now explicitly faded out right at THIS column's own
        // coastline (not a fixed t, since the coastline itself moves a lot per
        // column). The old, slow high-exponent sea-edge curve used to absorb this
        // kind of small bump without the visible boundary actually moving; the
        // sharper blend below doesn't, so without this fade every dune ripple
        // bled straight into the coastline as a jagged, comb-like edge.
        const duneDetail = n1.fbm(i * 0.045, j * 0.045, 4) * (0.85 - 0.55 * Math.min(1, t * 1.8));
        const coastFade = THREE.MathUtils.clamp((coastline - t) / 0.08, 0, 1);
        hLand += duneDetail * (1 - Math.max(0, t - 0.5) * 1.6) * (1 - headland * 0.7) * coastFade;
        // Small rock-pool style depressions on the mid/lower beach, relative to
        // THIS column's own coastline rather than a fixed band (or a cove's
        // narrower dry strip would get no pools, and a point's longer one would
        // get pools well out past where the old fixed band ended).
        const poolNoise = n3.fbm(i * 0.10 + 50, j * 0.10 + 50, 3);
        if (t > 0.35 && t < coastline - 0.04) {
          const dip = Math.max(0, poolNoise - 0.45) * 1.8 * (1 - headland);
          hLand -= dip;
        }

        // Headlands are already their own explicit rock structure - don't let the
        // sea blend eat into them just because a cove's coastline threshold
        // happens to fall earlier at this same column. Width and slope both
        // tuned for a gently-shelving beach, not a cliff: a narrow, steep version
        // of this turned the whole coastline into a jagged little wall, because
        // adjacent columns' drop-off points differ by a few metres (that's the
        // whole point - it's what makes the coves and points) and a steep,
        // narrow transition turns that natural difference into a visible ridge.
        const seaEdgeWidth = 0.16;
        const edge = THREE.MathUtils.clamp((t - coastline) / seaEdgeWidth, 0, 1) * (1 - headland * 0.85);
        const seaDepth = -2.2 - Math.max(0, t - coastline) * 2.2;
        let h = hLand * (1 - edge) + seaDepth * edge;

        this.bedrock[idx(i, j)] = h;

        // Hardness: headlands + occasional outcrop noise = rock; dunes/beach = soft sand.
        let hard = headland * 0.92;
        const outcrop = n2.fbm(i * 0.08, j * 0.08, 3);
        if (outcrop > 0.42) hard = Math.max(hard, (outcrop - 0.42) * 3.2 * (1 - headland * 0.3));
        hard = Math.min(1, hard);
        this.hardness[idx(i, j)] = hard;
      }
    }

    // Carve the stream channel into the heightfield.
    for (let j = 0; j < GRID; j++) {
      const z = j * CELL;
      const cx = streamCenterX(z);
      const ci = cx / CELL;
      const t = z / SIZE;
      const width = 2.4 + 2.4 * t; // widens into a natural mouth as it nears the sea
      for (let i = 0; i < GRID; i++) {
        const d = Math.abs(i - ci);
        const carve = Math.exp(-Math.pow(d / width, 2)) * 1.7;
        const k = idx(i, j);
        this.bedrock[k] -= carve;
        this.hardness[k] *= Math.max(0, 1 - carve * 1.5); // channel bed is soft
      }
    }

    // The dune ridges can otherwise leave a hump in the streambed that water can
    // never climb over. Force the channel centreline (and the band around it) to
    // keep a gentle, monotonic downhill gradient from source to sea.
    const MIN_DROP_PER_CELL = 0.006;
    let ceiling = Infinity;
    for (let j = 0; j < GRID; j++) {
      const z = j * CELL;
      const cx = streamCenterX(z);
      const ci = cx / CELL;
      const width = 2.4 + 2.4 * (z / SIZE);
      const centerK = idx(Math.round(THREE.MathUtils.clamp(ci, 0, GRID - 1)), j);
      const centerH = this.bedrock[centerK];
      const target = Math.min(centerH, ceiling);
      if (target < centerH - 1e-6) {
        const drop = centerH - target;
        const i0 = Math.max(0, Math.floor(ci - width * 1.8));
        const i1 = Math.min(GRID - 1, Math.ceil(ci + width * 1.8));
        for (let i = i0; i <= i1; i++) {
          const d = Math.abs(i - ci);
          const falloff = Math.exp(-Math.pow(d / width, 2));
          this.bedrock[idx(i, j)] -= drop * falloff;
        }
      }
      ceiling = target - MIN_DROP_PER_CELL;
    }

    // Steep ground exposes bare rock regardless of the headland mask's own falloff -
    // this is what actually makes a cliff FACE read as rock instead of the softer
    // colouring the plateau-shaped mask alone would give it right at the drop.
    // Excludes the stream channel itself: its banks are steep by construction but
    // should stay sandy, not read as a rock canyon. Also excludes each column's
    // own coastal shelf (the sea-edge blend in the main loop above) - that slope
    // is a deliberately gentle, natural beach gradient, not a cliff, but without
    // this exclusion this pass darkened the ENTIRE coastline into jagged-looking
    // bare rock, because a real bay's coastline curves in and out (coves and
    // points), and this measures slope from local height differences - so it
    // read every bend in that curve as if it were a small cliff.
    for (let j = 1; j < GRID - 1; j++) {
      const z = j * CELL;
      const t = z / SIZE;
      const streamI = streamCenterX(z) / CELL;
      const streamWidth = (2.4 + 2.4 * (z / SIZE)) * 2.2;
      for (let i = 1; i < GRID - 1; i++) {
        if (Math.abs(i - streamI) < streamWidth) continue;
        if (t > coastT(i) - 0.22) continue;
        const k = idx(i, j);
        const hL = this.bedrock[idx(i - 1, j)], hR = this.bedrock[idx(i + 1, j)];
        const hD = this.bedrock[idx(i, j - 1)], hU = this.bedrock[idx(i, j + 1)];
        const slope = (Math.abs(hR - hL) + Math.abs(hU - hD)) / (4 * CELL);
        this.hardness[k] = Math.max(this.hardness[k], Math.min(1, slope * 1.4));
      }
    }

    this.bedrock.set(this.bedrock); // no-op, keeps intent clear
    this.height.set(this.bedrock);
  }

  sampleHeightBilinear(x, z) {
    const fx = THREE.MathUtils.clamp(x / CELL, 0, GRID - 1.001);
    const fz = THREE.MathUtils.clamp(z / CELL, 0, GRID - 1.001);
    const i0 = Math.floor(fx), j0 = Math.floor(fz);
    const i1 = i0 + 1, j1 = j0 + 1;
    const tx = fx - i0, tz = fz - j0;
    const h00 = this.height[idx(i0, j0)];
    const h10 = this.height[idx(i1, j0)];
    const h01 = this.height[idx(i0, j1)];
    const h11 = this.height[idx(i1, j1)];
    const a = h00 + (h10 - h00) * tx;
    const b = h01 + (h11 - h01) * tx;
    return a + (b - a) * tz;
  }

  cellIndexAt(x, z) {
    const i = Math.round(x / CELL), j = Math.round(z / CELL);
    if (i < 0 || j < 0 || i >= GRID || j >= GRID) return -1;
    return idx(i, j);
  }

  _syncPositions() {
    const pos = this.geometry.attributes.position;
    for (let j = 0; j < GRID; j++) {
      for (let i = 0; i < GRID; i++) {
        pos.setY(idx(i, j), this.height[idx(i, j)]);
      }
    }
    pos.needsUpdate = true;
  }

  _updateColors() {
    const sand = new THREE.Color('#cdbd97');
    const wetSand = new THREE.Color('#8f8365');
    const mud = new THREE.Color('#4f4636'); // dark, saturated mud right at the immediate waterline
    const grass = new THREE.Color('#71805a');
    const dryGrass = new THREE.Color('#95935f');
    const rock = new THREE.Color('#7a7570');
    const darkRock = new THREE.Color('#57534d');
    const turnedSand = new THREE.Color('#7c6142'); // freshly dug/piled sand - richer, darker, "just turned"
    const tmp = new THREE.Color();

    for (let j = 0; j < GRID; j++) {
      for (let i = 0; i < GRID; i++) {
        const k = idx(i, j);
        const t = (j * CELL) / SIZE;
        const hardness = this.hardness[k];
        const wet = this.moisture[k];

        // slope for rock exposure on steep faces
        const hL = this.height[idx(Math.max(0, i - 1), j)];
        const hR = this.height[idx(Math.min(GRID - 1, i + 1), j)];
        const hD = this.height[idx(i, Math.max(0, j - 1))];
        const hU = this.height[idx(i, Math.min(GRID - 1, j + 1))];
        const slope = (Math.abs(hR - hL) + Math.abs(hU - hD)) / (4 * CELL);

        let base = sand.clone().lerp(grass, THREE.MathUtils.clamp((0.22 - t) * 3.2, 0, 1) * 0.85);
        base.lerp(dryGrass, 0.15 * Math.max(0, 1 - t * 3));

        // Clifftop plateau: flat high ground reads as grass regardless of where it
        // sits along the beach - only the steep cliff face itself exposes bare rock.
        const clifftopGrass = THREE.MathUtils.clamp((this.height[k] - 4.5) / 3.5, 0, 1)
          * THREE.MathUtils.clamp(1 - slope * 2.6, 0, 1);
        base.lerp(grass, clifftopGrass * 0.85);

        const rockExposure = THREE.MathUtils.clamp(hardness * (0.2 + slope * 1.8), 0, 1);
        base.lerp(rock, rockExposure);
        base.lerp(darkRock, THREE.MathUtils.clamp((slope - 0.45) * 1.0, 0, 1));
        if (rockExposure > 0.25) {
          const strata = Math.sin(this.height[k] * 2.4) * 0.5 + 0.5;
          base.lerp(darkRock, strata * 0.22 * rockExposure);
        }
        // A single linear wet->sand blend reads as one flat "damp" tone everywhere
        // water has ever been. Real banks are muddier the closer they sit to the
        // water's edge right now - so bias a second, darker mud tone toward only
        // the highest moisture values (biased with a square), layered on top of
        // the broader damp-sand blend rather than replacing it.
        const wetT = THREE.MathUtils.clamp(wet, 0, 1);
        base.lerp(wetSand, wetT * 0.85);
        base.lerp(mud, wetT * wetT * 0.55);

        // Freshly disturbed sand (just dug out, or just piled into a spoil rim) reads
        // as a distinct, richer "turned earth" tone that weathers back over about a
        // minute (see update()) - a plain height change in the same colour as
        // everything else barely registers as "material actually moved."
        base.lerp(turnedSand, THREE.MathUtils.clamp(this.disturbance[k], 0, 1) * 0.8);

        // Cheap cavity shading (a poor man's AO): sample a couple of cells further out
        // than the slope check above - a dug hole is wider than one cell, so comparing
        // against immediate neighbours alone barely shows it. A basin reads darker,
        // a rim reads lighter, which sells the "you actually dug that" feel even
        // before the real shadow map catches up.
        const i2L = Math.max(0, i - 2), i2R = Math.min(GRID - 1, i + 2);
        const j2D = Math.max(0, j - 2), j2U = Math.min(GRID - 1, j + 2);
        const wideAvg = (this.height[idx(i2L, j)] + this.height[idx(i2R, j)]
          + this.height[idx(i, j2D)] + this.height[idx(i, j2U)]) / 4;
        const cavity = THREE.MathUtils.clamp((wideAvg - this.height[k]) * 0.9, -0.4, 1);
        if (cavity > 0) base.multiplyScalar(1 - cavity * 0.5);
        else base.multiplyScalar(1 - cavity * 0.22); // rims catch noticeably more light

        tmp.copy(base);
        this.colors[k * 3 + 0] = tmp.r;
        this.colors[k * 3 + 1] = tmp.g;
        this.colors[k * 3 + 2] = tmp.b;
      }
    }
    this.geometry.attributes.color.needsUpdate = true;
  }

  // Apply a radial deform. `delta` > 0 raises, < 0 lowers. Returns net volume actually moved.
  deform(x, z, radius, delta, hardnessLimit = 1.0) {
    const i0 = Math.max(0, Math.floor((x - radius) / CELL));
    const i1 = Math.min(GRID - 1, Math.ceil((x + radius) / CELL));
    const j0 = Math.max(0, Math.floor((z - radius) / CELL));
    const j1 = Math.min(GRID - 1, Math.ceil((z + radius) / CELL));
    let moved = 0;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const dx = i * CELL - x, dz = j * CELL - z;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d > radius) continue;
        const k = idx(i, j);
        if (this.blocked[k]) continue;
        const falloff = 1 - d / radius;
        const resist = 1 - Math.min(0.92, this.hardness[k]) * hardnessLimit;
        const amt = delta * falloff * falloff * resist;
        this.height[k] += amt;
        moved += amt;
        this.disturbance[k] = Math.min(1, this.disturbance[k] + Math.abs(amt) * 6);
        if (delta < 0) {
          // digging softens what's left slightly (loosened sand)
          this.hardness[k] *= 0.985;
        }
      }
    }
    return moved;
  }

  // Raises a ring of terrain between innerR and outerR - used for the spoil heap
  // thrown up around a dug hole, so digging feels mass-conserving without an inventory.
  depositRing(x, z, innerR, outerR, amount) {
    const i0 = Math.max(0, Math.floor((x - outerR) / CELL));
    const i1 = Math.min(GRID - 1, Math.ceil((x + outerR) / CELL));
    const j0 = Math.max(0, Math.floor((z - outerR) / CELL));
    const j1 = Math.min(GRID - 1, Math.ceil((z + outerR) / CELL));
    let weightSum = 0;
    const weights = [];
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const dx = i * CELL - x, dz = j * CELL - z;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d < innerR || d > outerR) continue;
        const k = idx(i, j);
        if (this.blocked[k]) continue;
        const w = 1 - Math.abs((d - (innerR + outerR) / 2) / ((outerR - innerR) / 2));
        if (w <= 0) continue;
        weights.push([k, w]);
        weightSum += w;
      }
    }
    if (weightSum <= 0) return;
    for (const [k, w] of weights) {
      const amt = (amount * w) / weightSum;
      this.height[k] += amt;
      this.disturbance[k] = Math.min(1, this.disturbance[k] + Math.abs(amt) * 6);
    }
  }

  // Local averaging - patting sand flat with the back of the shovel.
  smooth(x, z, radius, strength) {
    const i0 = Math.max(0, Math.floor((x - radius) / CELL));
    const i1 = Math.min(GRID - 1, Math.ceil((x + radius) / CELL));
    const j0 = Math.max(0, Math.floor((z - radius) / CELL));
    const j1 = Math.min(GRID - 1, Math.ceil((z + radius) / CELL));
    const before = this.height.slice();
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const dx = i * CELL - x, dz = j * CELL - z;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d > radius) continue;
        const k = idx(i, j);
        if (this.blocked[k]) continue;
        let sum = 0, count = 0;
        for (let dj = -1; dj <= 1; dj++) {
          for (let di = -1; di <= 1; di++) {
            const ii = i + di, jj = j + dj;
            if (ii < 0 || jj < 0 || ii >= GRID || jj >= GRID) continue;
            sum += before[idx(ii, jj)];
            count++;
          }
        }
        const avg = sum / count;
        const falloff = 1 - d / radius;
        this.height[k] += (avg - before[k]) * strength * falloff;
        this.hardness[k] *= (1 - 0.01 * falloff);
      }
    }
  }

  markDirty() {
    this._needsSync = true;
  }

  update(dt) {
    if (this._needsSync) {
      this._syncPositions();
      this.geometry.computeVertexNormals();
      this._needsSync = false;
    }
    // Freshly turned sand slowly weathers back to its normal colour over roughly
    // a minute - long enough that a dig session reads clearly, short enough that
    // the beach doesn't stay visibly "scarred" forever.
    const decay = Math.exp(-dt / 25);
    for (let k = 0; k < this.disturbance.length; k++) this.disturbance[k] *= decay;

    this._colorDirtyAccum += dt;
    if (this._colorDirtyAccum > 0.35) {
      this._colorDirtyAccum = 0;
      this._updateColors();
    }
  }
}

export { idx, streamCenterX };
