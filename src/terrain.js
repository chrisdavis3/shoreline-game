import * as THREE from 'three';
import { Noise2D } from './noise.js?v=45';

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

// Stream centreline: a gentle meander from the dunes down to the sea. Enters
// toward the southern end of the beach (low i), matching the real River
// Menalhyl, which meanders along Mawgan Porth's southern edge rather than
// down the middle.
function streamCenterX(z) {
  const t = z / SIZE;
  return SIZE * 0.22 + Math.sin(t * 5.4 + 0.6) * SIZE * 0.06 * (0.4 + t) + n2.fbm(0, t * 3, 2) * SIZE * 0.03;
}

// The coastline's t-threshold (0..1, inland->sea) as a function of column i -
// traced directly from OpenStreetMap's actual "Dunes" beach polygon at Mawgan
// Porth (queried via the Overpass API: way 399625654, natural=beach, 63
// vertices), not a procedural formula. For each of the 140 columns this is
// the real seaward (westmost) edge of that polygon at the matching
// north-south position, projected to local metres, then linearly rescaled so
// the polygon's full north-south extent (~564m) maps across the level's
// width and its seaward swing maps to a 0.32-0.82 depth range. Light
// smoothing (a ~17-sample moving average over the raw traced points) keeps
// the per-column slope gentle - the raw trace had real jumps of ~25 grid
// cells between adjacent columns (small real features that are only a few
// metres across in reality, compressed into single columns here), which
// rendered as a sawtooth rather than a coastline at this map's scale.
// i=0 is the southern end of the real beach, i=GRID-1 the northern end.
const REAL_COAST_T = [
  0.4350, 0.4421, 0.4490, 0.4559, 0.4627, 0.4695, 0.4762, 0.4829, 0.4896, 0.5050,
  0.5183, 0.5308, 0.5421, 0.5513, 0.5559, 0.5490, 0.5399, 0.5305, 0.5217, 0.5138,
  0.5068, 0.5001, 0.4929, 0.4852, 0.4770, 0.4684, 0.4592, 0.4496, 0.4401, 0.4310,
  0.4235, 0.4199, 0.4271, 0.4361, 0.4446, 0.4532, 0.4689, 0.4849, 0.5009, 0.5176,
  0.5349, 0.5524, 0.5699, 0.5874, 0.6050, 0.6226, 0.6403, 0.6582, 0.6762, 0.6944,
  0.7128, 0.7312, 0.7486, 0.7575, 0.7648, 0.7711, 0.7764, 0.7811, 0.7853, 0.7893,
  0.7930, 0.7966, 0.7998, 0.8029, 0.8057, 0.8082, 0.8103, 0.8119, 0.8130, 0.8137,
  0.8139, 0.8137, 0.8132, 0.8125, 0.8116, 0.8104, 0.8090, 0.8072, 0.8052, 0.8030,
  0.8004, 0.7976, 0.7946, 0.7916, 0.7884, 0.7853, 0.7820, 0.7784, 0.7747, 0.7707,
  0.7664, 0.7617, 0.7565, 0.7509, 0.7450, 0.7386, 0.7318, 0.7246, 0.7170, 0.7092,
  0.7012, 0.6931, 0.6849, 0.6766, 0.6684, 0.6599, 0.6512, 0.6420, 0.6327, 0.6232,
  0.6135, 0.6038, 0.5942, 0.5846, 0.5752, 0.5658, 0.5564, 0.5478, 0.5400, 0.5329,
  0.5271, 0.5232, 0.5211, 0.5202, 0.5204, 0.5217, 0.5239, 0.5270, 0.5310, 0.5358,
  0.5412, 0.5472, 0.5511, 0.5561, 0.5613, 0.5667, 0.5725, 0.5778, 0.5816, 0.5839,
];

export function coastT(i) {
  return REAL_COAST_T[THREE.MathUtils.clamp(Math.round(i), 0, GRID - 1)];
}

// The level's own physical footprint was still a perfect square in world space
// no matter how the sand/rock/sea classification varied within it - every
// depth row spanned the full [0, SIZE] width, so the mesh always ended in a
// hard 90-degree corner where the inland (dune-line) edge met the side edge.
// First attempt at fixing this scaled every vertex in a row toward the
// centreline by the same factor - which also dragged in the stream (well off
// centre, near i=31) by that same factor, so ITS width visibly tapered to a
// point near the dune line (an unwanted "wizard hat" on the river) while the
// actual sand edge, softened by noise, read as a vague round blob instead of
// a specific outline. This only touches vertices within insetCells() of
// whichever side edge is nearest - the stream, which sits ~31 cells in from
// i=0, is safely outside that band at every depth, so it renders exactly as
// the water sim computes it. Only x is warped (z/depth untouched), and only
// render positions - the (i, j) simulation grid underneath stays a rectangle.
export function insetCells(t) {
  const wt = THREE.MathUtils.clamp(t / 0.30, 0, 1);
  return 22 * (1 - Math.pow(wt, 1.4));
}

export function warpX(x, z) {
  const t = z / SIZE;
  const blendWidth = insetCells(t);
  if (blendWidth <= 0.001) return x;
  const i = x / CELL;
  const edgeDist = Math.min(i, GRID - 1 - i);
  if (edgeDist >= blendWidth) return x; // safely inside the untouched middle - stream lives here
  const insetAmount = blendWidth * 0.8; // how far the true edge itself gets pulled inward
  const localT = edgeDist / blendWidth; // 0 at the literal edge, 1 at the blend boundary
  const eased = Math.pow(localT, 0.7);
  const newEdgeDist = insetAmount + (blendWidth - insetAmount) * eased; // monotonic, continuous at the blend boundary
  const newI = i < (GRID - 1) / 2 ? newEdgeDist : (GRID - 1) - newEdgeDist;
  return newI * CELL;
}

export class Terrain {
  constructor() {
    this.bedrock = new Float32Array(GRID * GRID); // hard, barely erodable base
    this.height = new Float32Array(GRID * GRID);  // current surface height (bedrock + loose sand)
    this.hardness = new Float32Array(GRID * GRID); // 0 = loose sand, 1 = rock/hard
    this.blocked = new Uint8Array(GRID * GRID);    // occupied by a placed/large rock - a hard wall, no water at all
    // Graduated hydraulic resistance around each medium/large rock, 0..1 - unlike
    // `blocked` (an all-or-nothing wall exactly under the rock's solid footprint),
    // this fades out over a wider halo so a boulder measurably slows/backs up flow
    // in its immediate vicinity even where the channel isn't literally full of rock.
    // Recomputed from the live rock list each frame (see recomputeObstruction) -
    // rocks move, so this can't be baked in once like the static terrain fields.
    this.obstruction = new Float32Array(GRID * GRID);
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

        // Rocky headlands: Berryl's Point at the southern end (i=0) and Trenance
        // Point at the northern end (i=GRID-1) - the real rock formations that
        // flank the traced beach polygon at its two ends. An exponent above 1
        // keeps the derivative bounded near the edge (the earlier exponent-below-1
        // version jumped straight to ~40% mask height in its very first active
        // cell, a visible seam - see the fix history). Only actually renders as
        // cliff past the dune line in z - inland of that it's ordinary dunes.
        //
        // Actually looking at the real map (twice got this backwards before -
        // first as a constant width, then tapering the WRONG direction): the sand
        // is NARROW right where it meets the road/dunes and FANS OUT into a wide
        // mouth at the sea - real headlands are barely there at the inland neck
        // and get wider and more dominant as you approach the coastline, staying
        // wide (rocky points jutting into the water) at and beyond it. So cliff
        // width is SMALLEST far inland and LARGEST right at and past the coastline.
        const edgeDist = Math.min(i, GRID - 1 - i); // cells from the nearest real end
        const distToCoast = coastT(i) - t; // >0 inland of the coastline, <=0 at/past it
        const nearCoastT = THREE.MathUtils.clamp(1 - distToCoast / 0.5, 0, 1); // 0 = still far from the coast (narrow neck), 1 = at/past the coastline (wide headland)
        const cliffWidthCells = 8 + 60 * Math.pow(nearCoastT, 1.25);
        const cliffPotential = Math.pow(THREE.MathUtils.clamp(1 - edgeDist / cliffWidthCells, 0, 1), 1.6);
        const cliffOnset = THREE.MathUtils.clamp((t - 0.20) / 0.14, 0, 1);
        // The funnel taper above narrows the whole beach toward the sea - but the
        // real river cuts its own gap straight through that narrowing (that's
        // where the tidal creek visibly slices between the rocks in aerial
        // photos), so the taper can't be allowed to close over the stream's own
        // path the way it closes over everywhere else near the coast.
        const streamGapDist = Math.abs(i - streamCenterX(z) / CELL);
        const streamGapWidth = 7 + 6 * t;
        const streamExemption = THREE.MathUtils.clamp(1 - streamGapDist / streamGapWidth, 0, 1);
        const headland = cliffPotential * cliffOnset * (1 - streamExemption * 0.92);
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
        // A MODERATE headland value (e.g. 0.4, just past the cliff's own outer
        // edge) was still suppressing the sea blend by a third, and because that
        // suppression sits right at the blend's own sensitive transition zone, a
        // small per-column change in headland was enough to snap the actual
        // land/sea crossing point by dozens of cells - a visible seam right past
        // every headland's edge (tried squaring headland here first - it only
        // moved the same problem to a different column, since values near 1
        // barely change under squaring while the ramp-up compresses). A smoothstep
        // GATE instead means only a genuinely strong, deep-into-the-cliff
        // headland (>0.5, ramping to full by 0.9) suppresses the blend at all;
        // moderate values right at the cliff's outer edge get zero suppression,
        // so the sea blend there behaves exactly like open coastline - no snap.
        const seaEdgeWidth = 0.16;
        const protT = THREE.MathUtils.clamp((headland - 0.5) / 0.4, 0, 1);
        const seaProtection = protT * protT * (3 - 2 * protT); // smoothstep, written out (no MathUtils dependency)
        const edge = THREE.MathUtils.clamp((t - coastline) / seaEdgeWidth, 0, 1) * (1 - seaProtection * 0.85);
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
      const z = j * CELL;
      for (let i = 0; i < GRID; i++) {
        const k = idx(i, j);
        pos.setX(k, warpX(i * CELL, z));
        pos.setY(k, this.height[k]);
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
    // Real Cornish cliffs (slate/shale) are much darker and more dramatic than a
    // flat mid-grey: near-black in the sheltered lower rock, a warmer bleached
    // grey-tan higher up where it's exposed to sun and salt, with dark banded
    // strata running through both - not a uniform "rock" colour at all.
    const rockDark = new THREE.Color('#241f1a');
    const rockMid = new THREE.Color('#5a5346');
    const rockLight = new THREE.Color('#8c8170');
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

        // Clifftop plateau: flat high ground can carry grass, but only in patches
        // (real clifftop grass clings to ledges and pockets of soil, it doesn't
        // blanket the whole rock uniformly) - gated by its own noise so most of
        // the flat high ground still reads as bare rock, with grass tufts only
        // where the patch noise says there's actually soil.
        const grassPatch = THREE.MathUtils.clamp((n1.fbm(i * 0.15 + 300, j * 0.15 + 300, 3) - 0.1) * 2.4, 0, 1);
        const clifftopGrass = THREE.MathUtils.clamp((this.height[k] - 4.5) / 3.5, 0, 1)
          * THREE.MathUtils.clamp(1 - slope * 2.6, 0, 1) * grassPatch;
        base.lerp(grass, clifftopGrass * 0.85);

        // Rock goes from a warm, sun-bleached grey-tan high on the cliff down to
        // near-black in the sheltered lower rock - real slate is never one flat
        // rock colour. Height alone (relative to the local rock's own base, not
        // an absolute number) drives that gradient.
        const rockExposure = THREE.MathUtils.clamp(hardness * (0.2 + slope * 1.8), 0, 1);
        const rockHeightT = THREE.MathUtils.clamp((this.height[k] - 2) / 9, 0, 1);
        const rockTone = rockMid.clone().lerp(rockLight, rockHeightT * 0.8).lerp(rockDark, (1 - rockHeightT) * 0.5);
        base.lerp(rockTone, rockExposure);
        // Strata: real slate's bedding lines run at a steep diagonal across the
        // WHOLE cliff face, not stacked flat like pancakes - mixing world x into
        // the phase alongside height (instead of height alone) tilts the bands so
        // they read as sloped strata sweeping across the rock, the way the
        // reference photo's cliff actually looks, rather than horizontal rings.
        if (rockExposure > 0.2) {
          const strataPhase = i * CELL * 0.32 + this.height[k] * 2.6;
          const strata = Math.sin(strataPhase) * 0.5 + 0.5;
          base.lerp(rockDark, strata * 0.32 * rockExposure);
          // A second, finer band on top breaks up any residual flatness/banding
          // regularity - real strata isn't perfectly periodic.
          const fineStrata = Math.sin(strataPhase * 2.7 + 1.4) * 0.5 + 0.5;
          base.lerp(rockDark, fineStrata * 0.14 * rockExposure);
        }
        base.lerp(rockDark, THREE.MathUtils.clamp((slope - 0.45) * 1.0, 0, 1) * 0.7);
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

  // Oval variant of deform() - a real shovel scoop is an elongated blade shape, not
  // a perfectly round dimple, and at this mesh's ~0.82m vertex spacing a small round
  // dab barely reads as anything at all. Elongated along (dirX, dirZ) - the direction
  // the blade drove in - and narrower across it, so it reads as a distinct scoop mark
  // rather than a shapeless soft blob once several strokes land near each other.
  scoopDeform(x, z, dirX, dirZ, lenR, widR, delta, hardnessLimit = 1.0) {
    const dlen = Math.sqrt(dirX * dirX + dirZ * dirZ) || 1;
    const ux = dirX / dlen, uz = dirZ / dlen; // along the scoop's length
    const vx = -uz, vz = ux;                  // across the scoop's width
    const maxR = Math.max(lenR, widR);
    const i0 = Math.max(0, Math.floor((x - maxR) / CELL));
    const i1 = Math.min(GRID - 1, Math.ceil((x + maxR) / CELL));
    const j0 = Math.max(0, Math.floor((z - maxR) / CELL));
    const j1 = Math.min(GRID - 1, Math.ceil((z + maxR) / CELL));
    let moved = 0;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const dx = i * CELL - x, dz = j * CELL - z;
        const along = dx * ux + dz * uz, across = dx * vx + dz * vz;
        const d = Math.sqrt((along / lenR) ** 2 + (across / widR) ** 2);
        if (d > 1) continue;
        const k = idx(i, j);
        if (this.blocked[k]) continue;
        const falloff = 1 - d;
        const resist = 1 - Math.min(0.92, this.hardness[k]) * hardnessLimit;
        const amt = delta * falloff * falloff * resist;
        this.height[k] += amt;
        moved += amt;
        this.disturbance[k] = Math.min(1, this.disturbance[k] + Math.abs(amt) * 6);
        if (delta < 0) this.hardness[k] *= 0.985;
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

  // Rebuilds the graduated obstruction halo around every non-carried medium/large
  // rock. Called once per frame from main.js (rocks are few - tens, not thousands -
  // so a full rebuild is cheap and avoids drift from incrementally adding/removing
  // overlapping rocks' contributions). Solid core (0..coreR) reads a full 1.0,
  // matching `blocked` exactly; it tapers to 0 by haloR so a large boulder measurably
  // resists flow well beyond its own solid footprint, the way a real obstruction
  // disturbs the current around it, not just exactly under itself. Overlapping
  // rocks take the max, not the sum - two rocks don't "double-dam" a cell.
  recomputeObstruction(rocksList) {
    this.obstruction.fill(0);
    for (const r of rocksList) {
      if (r.carried || r.size === 'small') continue;
      const coreR = r.radius * 0.7;
      const haloR = r.radius * 1.9;
      const i0 = Math.max(0, Math.floor((r.x - haloR) / CELL));
      const i1 = Math.min(GRID - 1, Math.ceil((r.x + haloR) / CELL));
      const j0 = Math.max(0, Math.floor((r.z - haloR) / CELL));
      const j1 = Math.min(GRID - 1, Math.ceil((r.z + haloR) / CELL));
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const dx = i * CELL - r.x, dz = j * CELL - r.z;
          const d = Math.sqrt(dx * dx + dz * dz);
          if (d >= haloR) continue;
          const val = d <= coreR ? 1 : Math.pow(1 - (d - coreR) / (haloR - coreR), 1.3);
          const k = idx(i, j);
          if (val > this.obstruction[k]) this.obstruction[k] = val;
        }
      }
    }
  }

  markDirty() {
    this._needsSync = true;
  }

  // A dug pit's rim or a dumped pile is left at whatever knife-edge slope the
  // shovel's circular falloff happened to produce - real loose sand can't hold
  // that, it slumps toward its angle of repose within seconds. Gated to cells
  // with real disturbance (i.e. recently player-touched, not the hand-tuned base
  // terrain) so it settles what you just dug/piled without softening the actual
  // dune ridges or headland cliffs generated at world start. Hardness raises the
  // stable slope a lot - packed/rocky ground barely moves, loose sand a great deal.
  _relaxSlopes(dt) {
    const h = this.height, hardness = this.hardness, blocked = this.blocked, disturbance = this.disturbance;
    const scratch = this._slopeScratch || (this._slopeScratch = new Float32Array(GRID * GRID));
    scratch.set(h);
    const dirs = [1, -1, GRID, -GRID];
    const rate = Math.min(1, dt * 6);
    let changed = false;
    for (let j = 1; j < GRID - 1; j++) {
      for (let i = 1; i < GRID - 1; i++) {
        const k = idx(i, j);
        if (blocked[k] || disturbance[k] < 0.04) continue;
        const maxSlope = 0.55 + hardness[k] * 3.5; // metres of drop per metre, at repose
        const hk = h[k];
        for (const d of dirs) {
          const nk = k + d;
          if (blocked[nk]) continue;
          const dropM = hk - h[nk];
          const excess = dropM - maxSlope * CELL;
          if (excess <= 0) continue;
          const move = excess * 0.4 * rate;
          scratch[k] -= move * 0.5;
          scratch[nk] += move * 0.5;
          changed = true;
        }
      }
    }
    if (changed) {
      h.set(scratch);
      this._needsSync = true;
    }
  }

  update(dt) {
    this._relaxSlopes(dt);
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
