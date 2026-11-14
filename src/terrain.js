import { mawganHeight, mawganHardness, mawganStream, mawganColour } from './mawgan.js?v=113';
import { coastalMaterial } from './coastal-material.js?v=113';
import * as THREE from '../vendor/three.module.js';
import { Noise2D } from './noise.js?v=113';
import { millHeight, bypassX } from './mill-layout.js';

// Grid-based terrain heightfield shared by rendering, water sim, and rocks.
// Coordinate convention: world (x, z) in metres, x in [0, SIZE), z in [0, SIZE).
// z=0 is inland (dunes / high ground), z=SIZE is the open sea.

// Bumped whenever a level's actual SHAPE-generating logic changes (a new
// L2_* constant, a new basin/carve, a different halfWidth formula, etc.) -
// as opposed to SCHEMA_VERSION in save.js, which only tracks the save
// file's own field layout. save.js compares this against what a save was
// written with and discards the save if they differ, rather than blindly
// overwriting freshly-generated (new-shape) terrain with an old raw height
// snapshot - the actual cause of "the lake's gone and there's a duplicate
// floating waterfall" after this session's terrain rework: the OLD save's
// height array (old falls position, no lake) was overwriting the new
// generation, while everything else (the cascade mesh, water source) used
// the new constants.
export const TERRAIN_VERSION = 9;
export const terrainVersionFor = level => level === 'level2' ? 9 : level === 'level3' ? 10 : TERRAIN_VERSION;
export const GRID = 140;          // cells per side
export const CELL = 0.82;         // metres per cell
export const SIZE = GRID * CELL;  // world size (metres)

const n1 = new Noise2D(1337);
const n2 = new Noise2D(9001);
const n3 = new Noise2D(4242);

function idx(i, j) { return j * GRID + i; }

// ---------------------------------------------------------------------------
// Level selection. Two levels share this one module (GRID/CELL/SIZE, the
// Terrain class's dig/pile/erosion machinery, and water.js's flux sim are all
// untouched by which level is active) - only the handful of functions below
// that actually decide the LAND SHAPE (streamCenterX, coastT, insetCells) and
// Terrain's own _generate()/_colorAt branch per level, as parallel profiles
// rather than forking the engine. Callers (main.js) must call setActiveLevel()
// BEFORE constructing Terrain/WaterSim - both read this synchronously at
// construction time, there's no live-switching mid-session.
export const LEVEL_IDS = ['level1', 'level2', 'level3'];
let ACTIVE_LEVEL = 'level1';
export function setActiveLevel(id) { ACTIVE_LEVEL = LEVEL_IDS.includes(id) ? id : 'level1'; }
export function getActiveLevel() { return ACTIVE_LEVEL; }

// x runs north to south; the Menalhyl follows the southern beach margin.
function streamCenterXLevel1(z) { return mawganStream(z); }

// ---------------------------------------------------------------------------
// Level 2 ("Highfall Gorge"): a steep mountain valley whose water source is a
// single waterfall partway down one side (not a spread inland stream origin),
// landing in a pool that feeds a diggable river running down the valley to a
// still mountain lake at the far end. z=0 is high mountainside here (mirrors
// level 1's "z=0 is inland" convention), z=SIZE is the low valley
// exit/lakeside. Kept as its own fully parallel set of constants/functions
// rather than branching level 1's own (heavily-tuned, Mawgan-Porth-specific)
// formulas - see setActiveLevel above.
export const L2_LIP_X = SIZE * 0.46;      // waterfall lip, world x (metres)
export const L2_T_FALL0 = 0.27;           // t where the near-vertical drop begins
export const L2_T_FALL1 = 0.38;           // t where it lands in the base pool
export const L2_TOP_H = 28;               // mountainside height above the falls
export const L2_POOL_H = 7;               // landing-pool floor height
export const L2_LAKE_H = 1.3;             // still lake level at the valley's exit
export const L2_WALL_HEIGHT = 55;         // added valley-wall rise above the floor

// A small lake sitting in the (now-enlarged) plateau above the falls, feeding
// them - see _generateLevel2's halfWidth/lake-basin carve below. Its own
// water source (see water.js's _seedSource) sits inside the basin rather than
// right at the lip, so the falls are just wherever the lake's rim happens to
// be lowest: dig a new low point in the rim elsewhere and the same real flow
// sim should send water there too, no separate mechanic needed.
export const L2_LAKE_CENTER_Z = L2_T_FALL0 * SIZE * 0.42;
export const L2_LAKE_RADIUS_Z = L2_T_FALL0 * SIZE * 0.36;
export const L2_LAKE_RADIUS_X = 18;
export const L2_LAKE_DEPTH = 4;

function streamCenterXLevel2(z) {
  const t = z / SIZE;
  // Above and at the falls the channel runs straight down from the lip - a
  // real waterfall doesn't meander on its way over the edge. Only the river
  // BELOW the landing pool meanders, same idea as level 1's stream but around
  // a fixed downstream anchor instead of a diagonal inland-to-sea run.
  if (t <= L2_T_FALL1) return L2_LIP_X;
  const tt = (t - L2_T_FALL1) / (1 - L2_T_FALL1);
  const meander = Math.sin(tt * 4.0 + 0.5) * SIZE * 0.09 * (0.25 + tt * 0.75)
    + n2.fbm(1, tt * 3.2 + 70, 2) * SIZE * 0.03;
  return L2_LIP_X + meander;
}

function streamCenterX(z) {
  if (ACTIVE_LEVEL === 'level3') return z < 30 ? 56 + Math.sin(z * .11) * .6 : bypassX(z);
  return ACTIVE_LEVEL === 'level2' ? streamCenterXLevel2(z) : streamCenterXLevel1(z);
}

// Sea coupling begins offshore; the beach profile and tide determine the actual
// waterline. The inland dune boundary is never used as an ocean outline.
const coastRoughNoise = new Noise2D(3721);

// Level 2 has no coastline/coves at all - just a still lake pooling at the
// valley's low exit end. Reuses the exact same "coastT" mechanism (per-column
// t-threshold beyond which water.js relaxes depth toward a `tide` level and
// stops eroding) so the whole sea-coupling/erosion-skip machinery in water.js
// keeps working unchanged for a lake instead of a tidal sea - see
// setActiveLevel's own comment. Only the threshold and its (much smaller,
// non-cove-shaped) per-column wobble differ.
const L2_LAKE_T0 = 0.90;
function coastTContinuousLevel2(ci) {
  return L2_LAKE_T0 + coastRoughNoise.fbm(ci * 0.05, 80, 2) * 0.015;
}

function coastTContinuousLevel1(ci) { return 0.65; }

export function coastT(i) {
  if (ACTIVE_LEVEL === 'level3') return 0.96;
  const ci = Math.round(THREE.MathUtils.clamp(i, 0, GRID - 1));
  return ACTIVE_LEVEL === 'level2' ? coastTContinuousLevel2(ci) : coastTContinuousLevel1(ci);
}

// Continuous (non-staircased) version for callers evaluating at fractional i
// (fine render-mesh spacing, e.g. insetCells() below) - coastT() itself rounds
// since most callers index one specific simulation column.
function coastTSmooth(i) {
  if (ACTIVE_LEVEL === 'level3') return 0.96;
  const c = THREE.MathUtils.clamp(i, 0, GRID - 1);
  return ACTIVE_LEVEL === 'level2' ? coastTContinuousLevel2(c) : coastTContinuousLevel1(c);
}

// The physical and visible coordinates now agree throughout the beach.
// Its outline comes from the reference terrain, not a warped rectangular edge.
export function insetCells(i,t) { return 0; }
export function warpX(x,z) { return x; }

// ---------------------------------------------------------------------------
// Render/simulation resolution decoupling.
//
// Everything above (and the deform/erosion code below) keeps reading and
// writing the coarse GRIDxGRID (140x140, 0.82m/cell) arrays exactly as before -
// water.js's flux/erosion/sediment passes, world-gen, and every hardness/
// blocked/obstruction lookup are untouched. Only the RENDERED terrain mesh is
// built at a much finer resolution (see FINE_GRID below), with heights derived
// from the same coarse height array via smooth (Catmull-Rom) interpolation plus
// a layer of genuine fine noise detail. This is what lets a shovel scoop
// (~0.85m x 0.55m - only 1-2 coarse cells) actually read as a defined 3D
// depression instead of a single coarse vertex tugging at a ~1.64m-wide fan of
// triangles (which is what made a dug hole read as barely more than a colour
// smudge before this change).
export const RENDER_SUBDIV = 3;                          // fine vertices per coarse cell edge
export const FINE_GRID = (GRID - 1) * RENDER_SUBDIV + 1; // 418 vertices/side
export const FINE_CELL = CELL / RENDER_SUBDIV;           // ~0.273m

const nFine1 = new Noise2D(6161);
const nFine2 = new Noise2D(7331);

// Named clampIdx (not `ci`) to avoid shadowing the many local `ci` (cell-index)
// variables used throughout _generate() below.
function clampIdx(v) { return v < 0 ? 0 : v > GRID - 1 ? GRID - 1 : v; }

// Catmull-Rom cubic through 4 samples, t in [0,1] between p1 and p2 - passes
// exactly through every coarse sample (unlike a least-squares fit) while
// keeping a continuous derivative, so adjacent coarse cells blend smoothly
// instead of showing the facet naive bilinear would produce at each seam.
//
// Clamped to [min(p1,p2), max(p1,p2)]: a plain Catmull-Rom can overshoot past
// its own p1/p2 samples wherever the SLOPE changes abruptly right at a coarse
// cell boundary (classic Gibbs-type ringing at a kink, not at a discontinuity
// in the values themselves, which stay perfectly smooth and monotonic either
// side). Confirmed live to matter here specifically: the stream-channel slope-
// limiter above (see MAX_CROSS_SLOPE) produces an exactly linear ramp up to
// the point where it hands back off to the channel's own Gaussian curve - a
// kink in slope, even though every actual height value on both sides is
// smooth - and the unclamped cubic rang past it into a fresh ~75 degree spike
// exactly at that seam, undoing the slope limiter's own fix one interpolation
// step later. Clamping is a no-op wherever the four samples already lie on a
// smooth curve (the overwhelming majority of the terrain), so this doesn't
// soften any genuinely smooth slope - it only ever pulls back an overshoot.
function catmullRom1D(p0, p1, p2, p3, t) {
  const v = p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
  const lo = Math.min(p1, p2), hi = Math.max(p1, p2);
  return v < lo ? lo : v > hi ? hi : v;
}

// Bicubic sample of a coarse GRIDxGRID array at fractional cell coords (fx, fz).
function sampleBicubicCoarse(arr, fx, fz) {
  const ix = Math.floor(fx), iz = Math.floor(fz);
  const tx = fx - ix, tz = fz - iz;
  let c0 = 0, c1 = 0, c2 = 0, c3 = 0;
  for (let m = -1; m <= 2; m++) {
    const jj = clampIdx(iz + m);
    const p0 = arr[idx(clampIdx(ix - 1), jj)];
    const p1 = arr[idx(clampIdx(ix), jj)];
    const p2 = arr[idx(clampIdx(ix + 1), jj)];
    const p3 = arr[idx(clampIdx(ix + 2), jj)];
    const v = catmullRom1D(p0, p1, p2, p3, tx);
    if (m === -1) c0 = v; else if (m === 0) c1 = v; else if (m === 1) c2 = v; else c3 = v;
  }
  return catmullRom1D(c0, c1, c2, c3, tz);
}

// Plain bilinear sample of a coarse array - used for fields that don't need C1
// continuity (hardness, moisture, disturbance), and as the "undo the Catmull-Rom
// rounding" sharper fallback blended in right at freshly-dug/piled cells (see
// _computeFineHeightAt) so scoop marks keep a crisp, well-defined edge instead of
// being softened by the wider bicubic stencil.
function sampleBilinearCoarse(arr, fx, fz) {
  const ix = clampIdx(Math.floor(fx)), iz = clampIdx(Math.floor(fz));
  const ix1 = clampIdx(ix + 1), iz1 = clampIdx(iz + 1);
  const tx = fx - Math.floor(fx), tz = fz - Math.floor(fz);
  const h00 = arr[idx(ix, iz)], h10 = arr[idx(ix1, iz)];
  const h01 = arr[idx(ix, iz1)], h11 = arr[idx(ix1, iz1)];
  const a = h00 + (h10 - h00) * tx;
  const b = h01 + (h11 - h01) * tx;
  return a + (b - a) * tz;
}

// Coarse rows processed per frame by Terrain's background "fine mesh" scan (see
// update()) - keeps erosion/sediment/moisture/tide-driven height drift flowing
// through to the fine render mesh without ever re-touching the whole ~310K-vertex
// mesh in a single frame (measured at ~126ms - a severe hitch - see the deployment
// notes). Measured cost is ~0.85-0.9ms per coarse row (height+normal+colour pass
// over that row's ~557 fine vertices); at 8 rows/frame that was ~7ms EVERY frame,
// a big, permanent tax on the frame budget for no real benefit (erosion/moisture
// are a "minutes-scale" process, not something that needs to reach the screen
// within a fraction of a second). 2 rows/frame keeps the steady-state cost to
// ~1.5-2ms/frame while still cycling the whole 140-row grid roughly every 1-2.5s.
const FINE_SCAN_ROWS_PER_FRAME = 2;

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

    // ---- coarse "pick" proxy: invisible, never added to the scene, exists only
    // so raycasting (the shovel-aim ray in main.js's getShovelTarget) stays as
    // cheap as it was before this change. The rendered mesh below is ~16x denser
    // (557x557 vs 140x140) - raycasting THAT every frame the mouse moves would be
    // a real per-frame cost (three.js's core raycaster has no BVH, so hit-testing
    // is linear in triangle count), for zero benefit since only x/z from the hit
    // matter to gameplay, never the fine y. ----
    this.pickGeometry = new THREE.PlaneGeometry(SIZE, SIZE, GRID - 1, GRID - 1);
    this.pickGeometry.rotateX(-Math.PI / 2);
    this.pickGeometry.translate(SIZE / 2, 0, SIZE / 2);
    this.pickMesh = new THREE.Mesh(this.pickGeometry, new THREE.MeshBasicMaterial({ visible: false }));
    this.pickMesh.visible = false;

    // ---- the actual rendered terrain: FINE_GRID x FINE_GRID, heights derived
    // from the coarse arrays above (see _computeFineHeightAt / _flushFineRegion) ----
    this.geometry = new THREE.PlaneGeometry(SIZE, SIZE, FINE_GRID - 1, FINE_GRID - 1);
    this.geometry.rotateX(-Math.PI / 2);
    this.geometry.translate(SIZE / 2, 0, SIZE / 2);
    this.fineHeight = new Float32Array(FINE_GRID * FINE_GRID);
    this.colors = new Float32Array(FINE_GRID * FINE_GRID * 3);
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));

    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      // Slightly less than fully matte - real wet sand/slate near the waterline
      // picks up a soft sheen even in overcast light, and a uniform 0.96 read as
      // chalky/flat everywhere regardless of what colour was actually painted
      // there. Full per-vertex roughness would need a custom shader attribute
      // (out of scope for this colour/lighting-only pass); this uniform nudge is
      // a safe, cheap approximation that helps every material read a bit less flat.
      roughness: 0.88,
      metalness: 0.0,
      flatShading: false,
    });
    if(ACTIVE_LEVEL === 'level1') this.material=coastalMaterial();
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;

    // Colour palette + scratch THREE.Color instances, built once and reused every
    // fine-vertex colour evaluation (the old per-call `new THREE.Color(...)` x ~15
    // was fine at 140x140 called every 0.35s; at fine-mesh scale/frequency it isn't).
    this._pal = {
      sand: new THREE.Color('#d9c49b'),             // warmer, more golden-tan (reference beach sand)
      wetSand: new THREE.Color('#7d6c49'),          // richer, darker wet sand (was too close to dry sand)
      mud: new THREE.Color('#3c3325'),
      grass: new THREE.Color('#5f7a45'),            // cool, richer coastal-turf green (was flat/desaturated)
      grassWarm: new THREE.Color('#96a04c'),        // warm, sun-bleached golden-green - real turf is never one flat green
      dryGrass: new THREE.Color('#a89860'),
      // Re-graded against actual reference photos of these cliffs (not a text
      // description) - the real rock is a COOL charcoal/near-black slate with
      // essentially no warm brown in it; the old rockMid/rockLight here (a
      // warm khaki-brown and a warm tan) were a real, specific mismatch, not a
      // subjective quibble - every rock surface in the photos reads grey-to-
      // black, only lightening toward a cool pale grey when dry, never tan.
      rockDark: new THREE.Color('#121316'),         // near-black wet slate, cool not warm
      rockMid: new THREE.Color('#3c3f42'),          // cool charcoal, not warm khaki-brown
      rockLight: new THREE.Color('#8b8d87'),        // cool pale grey, drier rock higher up the cliff
      turnedSand: new THREE.Color('#7c6142'),      // piled/disturbed rim - lighter, "just turned"
      turnedSandDug: new THREE.Color('#4a3720'),   // freshly dug basin - darker, damp-looking
      // Level 2 palette: dirt and rock, no sand tan or coastal grass green -
      // rockDark/rockMid/rockLight above are already a cool grey slate that
      // works unchanged for a mountain gorge's rock; only dirt/moss are new.
      dirt: new THREE.Color('#4a3a28'),
      dirtLight: new THREE.Color('#6b5540'),
      moss: new THREE.Color('#3f4f34'),
      mossWarm: new THREE.Color('#5c6b3f'),
    };
    this._cBase = new THREE.Color();
    this._cTone = new THREE.Color();
    this._cGrass = new THREE.Color();

    this._fineDirty = null;
    this._scanRow = 0;

    this._syncPickPositions();
    this._buildFineStatic();
    this.refreshFineMeshFully();
  }

  // One-time setup of the fine mesh's x/z positions (constant - only y moves).
  _buildFineStatic() {
    const arr = this.geometry.attributes.position.array;
    for (let fj = 0; fj < FINE_GRID; fj++) {
      const z = fj * FINE_CELL;
      for (let fi = 0; fi < FINE_GRID; fi++) {
        const k = fj * FINE_GRID + fi;
        arr[k * 3] = warpX(fi * FINE_CELL, z);
        arr[k * 3 + 2] = z;
      }
    }
  }

  // Public: force an immediate full-grid fine mesh resync (heights, normals,
  // colours) rather than waiting for the incremental background scan to get all
  // the way around - used once at startup and again after the water sim is
  // pre-primed (see main.js), since 40 simulated seconds of erosion before the
  // player ever sees the level would otherwise only reach the fine mesh a few
  // frames late via the scan.
  refreshFineMeshFully() {
    this._flushFineRegion({ i0: 0, i1: GRID - 1, j0: 0, j1: GRID - 1 });
  }

  _generate() {
    if (ACTIVE_LEVEL === 'level3') {
      for (let j = 0; j < GRID; j++) for (let i = 0; i < GRID; i++) {
        const k = idx(i, j);
        this.bedrock[k] = millHeight(i * CELL, j * CELL);
        this.hardness[k] = 0.38;
      }
      this.height.set(this.bedrock);
    }
    else if (ACTIVE_LEVEL === 'level2') this._generateLevel2();
    else this._generateLevel1();
  }

  _generateLevel1() {
    for(let j=0;j<GRID;j++)for(let i=0;i<GRID;i++) {
      const k=idx(i,j),x=i*CELL,z=j*CELL;
      this.bedrock[k]=mawganHeight(x,z);
      this.hardness[k]=mawganHardness(x,z);
    }
    this.height.set(this.bedrock);
  }

  // Level 2's terrain: a steep valley whose walls rise sharply on both sides
  // of a narrow river corridor, fed by a single waterfall partway down one
  // side (not level 1's spread inland stream origin). See the L2_* constants
  // and streamCenterXLevel2 above for the shared shape/position data (also
  // read by water.js for the flux sim's source cells and the cascade's own
  // decorative placement in environment.js).
  _generateLevel2() {
    for (let j = 0; j < GRID; j++) {
      for (let i = 0; i < GRID; i++) {
        const x = i * CELL, z = j * CELL;
        const t = z / SIZE; // 0 = high mountainside, 1 = the lake at the valley's exit

        const cx = streamCenterXLevel2(z);
        const ci = cx / CELL;
        const distCells = Math.abs(i - ci);

        // Valley-floor centreline elevation: flat-ish high mountain plateau
        // above the falls, a steep (mostly near-vertical in the middle) drop
        // through the falls themselves, then a real but gentler descent down
        // the diggable river valley to the lake - all only right on the
        // river's own centreline. Off to the side, see sideRampH below.
        let floorH;
        if (t <= L2_T_FALL0) {
          floorH = L2_TOP_H;
        } else {
          let centerH;
          if (t <= L2_T_FALL1) {
            const ft = (t - L2_T_FALL0) / (L2_T_FALL1 - L2_T_FALL0);
            // Quintic smoothstep: zero slope at both ends (so it hands off
            // smoothly to the flat plateau above and the levelling-out pool
            // below), steepest through the middle - that middle third works
            // out to roughly 80 degrees, a genuine near-vertical cliff face,
            // not just a steep hill.
            const eased = ft * ft * ft * (ft * (ft * 6 - 15) + 10);
            centerH = L2_TOP_H - (L2_TOP_H - L2_POOL_H) * eased;
          } else {
            const rt = (t - L2_T_FALL1) / (1 - L2_T_FALL1);
            // The working valley floor descends in 3 real steps (4 flat
            // terraces) rather than one smooth grade - each step is a small
            // waterfall right on the river's own centreline (same quintic-
            // ease technique as the main falls, just much smaller), giving
            // the user's "3 or so small elevation changes with small
            // waterfalls".
            const STEPS = 3;
            const stepDrop = (L2_POOL_H - L2_LAKE_H) / (STEPS + 1);
            const bandF = THREE.MathUtils.clamp(rt, 0, 0.99999) * (STEPS + 1);
            const band = Math.floor(bandF);
            const within = bandF - band;
            const stepStart = 0.93; // each terrace is flat for its first 93%, then drops - narrow enough to read as a real small step, not just a gentle grade
            let dropFrac = 0;
            if (within > stepStart) {
              const dt2 = (within - stepStart) / (1 - stepStart);
              dropFrac = dt2 * dt2 * (3 - 2 * dt2);
            }
            centerH = (L2_POOL_H - band * stepDrop) - stepDrop * dropFrac;
          }

          // "Ramping sidewall": the falls' own ~13m of run can't fit a
          // climbable slope for a 45m drop at any easing curve - so rather
          // than a separate ramp mechanism (confirmed live: a discrete
          // switchback both looked wrong, a "canyon that doesn't need to be
          // there", AND broke on its own - see version history), the sides
          // just use a single, much gentler descent spread across nearly the
          // whole rest of the map's length instead, connecting the flat
          // plateau above to the flat valley floor below directly. Averages
          // well under VehicleBase's climbStall over that distance.
          const st = THREE.MathUtils.clamp((t - L2_T_FALL0) / (1 - L2_T_FALL0), 0, 1);
          const sideEased = 1 - Math.pow(1 - st, 1.5);
          const sideRampH = L2_TOP_H - (L2_TOP_H - L2_LAKE_H) * sideEased;

          // Close to the river/falls, the dramatic centreline wins - a real
          // waterfall shouldn't be too wide; well off to the side, the ramp
          // does. Narrower through the falls' own drop, wider once the
          // terraced valley starts (where the centreline itself is already
          // fairly gentle, so the handoff can be more gradual).
          // A hard switch right at L2_T_FALL1 (9 in the falls zone, 20 in the
          // terrace zone) meant a point already fully on sideRampH just
          // above the pool could suddenly fall partway back onto centreH
          // just below it - a sharp local cliff right at the pool, confirmed
          // live. Transitions smoothly across the boundary instead.
          const sideBlendWidth = THREE.MathUtils.lerp(28, 36, THREE.MathUtils.smoothstep(t, L2_T_FALL1 - 0.02, L2_T_FALL1 + 0.05));
          const sideBlend = THREE.MathUtils.clamp((distCells - 6) / sideBlendWidth, 0, 1);
          floorH = THREE.MathUtils.lerp(centerH, sideRampH, sideBlend);
        }

        // Gorge floor around the falls, widening into a real (if still
        // steep-sided) valley floor downstream. Widened from the original
        // 5+3/9+10 - the camera clipped against the walls on anything but a
        // dead-on view, and there wasn't enough flat ground up top to dig an
        // alternate waterfall notch into.
        const chuteHalfWidth = 7 + 4 * Math.min(1, t / L2_T_FALL1);
        // Above the falls, the chute belled out into a small lake basin - see
        // L2_LAKE_* above. Bulges widest mid-plateau, tapering back down to
        // match the chute's own width right at the outlet (t=L2_T_FALL0) for
        // a seamless handoff, and again toward the inland map edge (t=0).
        const lakeBulge = t <= L2_T_FALL0
          ? Math.sin(THREE.MathUtils.clamp(t / L2_T_FALL0, 0, 1) * Math.PI)
          : 0;
        const halfWidth = t <= L2_T_FALL0
          ? chuteHalfWidth + lakeBulge * 16
          : t <= L2_T_FALL1
            ? chuteHalfWidth
            : 11 + 11 * Math.min(1, (t - L2_T_FALL1) / (1 - L2_T_FALL1));
        const distToWallEdge = Math.max(0, distCells - halfWidth);
        // Walls taper down somewhat toward the valley's low exit end, so it
        // reads as opening up rather than staying a uniform-height trench for
        // its whole length.
        const wallGain = L2_WALL_HEIGHT * (1 - 0.55 * Math.min(1, t * 1.15));
        let wallRise = Math.pow(Math.min(1, distToWallEdge / 22), 0.6) * wallGain;

        // The plateau, the lake, the falls' own banks, the pool and the
        // working valley below are all meant to read as one continuously
        // descending open highland with the falls/steps as its only real
        // drops - not a walled canyon. Two earlier attempts got this wrong:
        // full-height canyon walls throughout (confirmed live as an unwanted
        // "canyon" between the pool and the plateau) with a switchback ramp
        // punched through them (fragile - eaten by the water sim's own sand-
        // slumping during startup priming); then bringing the walls BACK once
        // the terraced valley started, which fought against sideRampH's own
        // descent there and produced a "ski jump" profile (a dip, then an
        // unwanted hump climbing back up, before the drop resumes) - drawn
        // out and confirmed live. Wall strength now stays low for the whole
        // level instead of ever ramping back up - sideRampH above already
        // carries the descent continuously the entire way to the exit lake,
        // so there's nothing left for a real canyon wall to usefully add.
        wallRise *= 0.04;

        let h = floorH + wallRise;

        // Carve an actual riverbed INTO the flat valley floor below the pool -
        // without this the whole (fairly wide) flat floor sits at one uniform
        // height and water spreads to fill it evenly like a flooded valley,
        // not a defined river. A narrower, deeper channel at the centreline
        // (mirrors level 1's own stream carve - see streamCenterXLevel1's
        // carve loop) gives the water somewhere lower to concentrate, leaving
        // the wider floor around it as dry, walkable diggable banks.
        if (t > L2_T_FALL1) {
          const rt = (t - L2_T_FALL1) / (1 - L2_T_FALL1);
          const chanWidth = 2.6 + 2.4 * rt;
          const chanCarve = Math.exp(-Math.pow(distCells / chanWidth, 2)) * 1.7;
          h -= chanCarve;
        }

        // Fine dirt/rock detail - much calmer right on the falls' own sheer
        // face (a real cliff doesn't have loose undulating texture the way a
        // slope of scree does) than on the open valley walls/floor.
        const nearFallsFace = t > L2_T_FALL0 - 0.02 && t < L2_T_FALL1 + 0.03 && distCells < halfWidth + 3;
        const detail = n1.fbm(i * 0.05, j * 0.05, 4);
        h += detail * (nearFallsFace ? 0.6 : 2.2);

        // A shallow landing pool right at the base of the falls, so the
        // cascade has somewhere real to land rather than running straight off
        // a knife-edge into the ordinary valley floor slope.
        const poolDist = Math.sqrt((x - L2_LIP_X) ** 2 + (z - L2_T_FALL1 * SIZE) ** 2);
        if (poolDist < 7) h -= (1 - poolDist / 7) * 2.2;

        // The lake basin itself - an elliptical bowl carved into the plateau,
        // well clear of the actual drop (see L2_LAKE_* above), so there's a
        // real depth for water.js's source cells to fill rather than a flat
        // plain the water just spreads thin across. Its rim (right at the
        // ellipse edge) sits back at the plain plateau height, held in by the
        // ordinary wallRise beyond halfWidth - dig THAT rim down anywhere
        // along the lake's edge and the sim should send water there too.
        const lakeEllipse = Math.sqrt(
          ((x - L2_LIP_X) / L2_LAKE_RADIUS_X) ** 2 + ((z - L2_LAKE_CENTER_Z) / L2_LAKE_RADIUS_Z) ** 2
        );
        if (lakeEllipse < 1) h -= (1 - lakeEllipse) * L2_LAKE_DEPTH;

        // A lake needs an outlet below its water surface. Previously the bowl
        // stopped short of the lip, leaving a dry sill across the waterfall.
        if (z >= L2_LAKE_CENTER_Z && t <= L2_T_FALL0 + .015) {
          const outlet = L2_TOP_H - .8 - (z - L2_LAKE_CENTER_Z) * .025;
          const w = Math.exp(-Math.pow((x - L2_LIP_X) / 2.3, 4));
          h = THREE.MathUtils.lerp(h, Math.min(h, outlet), w);
        }

        this.bedrock[idx(i, j)] = h;

        // Hardness: the falls' own face and the valley walls are bare rock;
        // the river corridor and valley floor are looser, diggable dirt.
        // nearFallsFace used to harden the WHOLE valley width through this
        // t-range, which meant the plateau above the falls and the landing
        // pool right below it (both flat, not the actual sheer drop) came out
        // nearly indestructible too - "the excavator doesn't dig well on the
        // top zone" was this, not a top-zone-specific issue. The real curtain
        // of falling water is only as wide as the falls itself (a narrow
        // strip right on the centreline), so only harden that strip.
        let hard = Math.min(1, distToWallEdge / 9);
        if (nearFallsFace && distCells < 3) hard = Math.max(hard, 0.88);
        const outcrop = n2.fbm(i * 0.08, j * 0.08, 3);
        if (outcrop > 0.45) hard = Math.max(hard, (outcrop - 0.45) * 2.8);
        this.hardness[idx(i, j)] = Math.min(1, hard);
      }
    }

    // Bare rock wherever the ground itself is genuinely steep (same slope-
    // exposure technique as level 1's own pass - see _generateLevel1) -
    // excludes only the river corridor itself, which should read as gravelly
    // dirt riverbed, not a rock canyon, regardless of incidental slope.
    for (let j = 1; j < GRID - 1; j++) {
      const z = j * CELL;
      const riverI = streamCenterXLevel2(z) / CELL;
      const riverWidth = 9;
      for (let i = 1; i < GRID - 1; i++) {
        if (Math.abs(i - riverI) < riverWidth) continue;
        const k = idx(i, j);
        const hL = this.bedrock[idx(i - 1, j)], hR = this.bedrock[idx(i + 1, j)];
        const hD = this.bedrock[idx(i, j - 1)], hU = this.bedrock[idx(i, j + 1)];
        const slope = (Math.abs(hR - hL) + Math.abs(hU - hD)) / (4 * CELL);
        this.hardness[k] = Math.max(this.hardness[k], Math.min(1, slope * 1.2));
      }
    }

    // A few passes of light neighbour-averaging on the side-ramp area only -
    // well clear of the river/falls/steps at the centreline, which stay
    // exactly as authored (a real waterfall/step edge SHOULD be sharp).
    // Several of the blend formulas above (sideRampH's own blend width,
    // wallRise, the terrace/ramp handoff) still left small local seams where
    // they meet - confirmed live as vehicles tilting hard and stalling on
    // ground that was supposed to read as a gentle, driveable slope. Smoothed
    // away in one general pass rather than chasing each seam individually.
    for (let pass = 0; pass < 25; pass++) {
      const src = this.bedrock.slice();
      for (let j = 1; j < GRID - 1; j++) {
        const z = j * CELL;
        if (z <= L2_T_FALL0 * SIZE) continue; // flat plateau/lake - nothing to smooth
        const ci = streamCenterXLevel2(z) / CELL;
        for (let i = 1; i < GRID - 1; i++) {
          // A hard on/off cutoff here (< 13: skip, >= 13: fully smoothed) put
          // a sharp, literal edge in the terrain exactly at that boundary -
          // and since the river's centreline is a smooth curve crossing a
          // discrete grid, which integer cells fell just inside vs. just
          // outside that boundary changed unevenly row to row, so the edge
          // itself came out as a jagged sawtooth (confirmed live: a comb of
          // regular triangular teeth along both banks). Fades in gradually
          // over a few cells instead of switching outright.
          const w = THREE.MathUtils.smoothstep(Math.abs(i - ci), 11, 15);
          if (w <= 0) continue;
          const k = idx(i, j);
          const avg = (src[k] + src[idx(i - 1, j)] + src[idx(i + 1, j)] + src[idx(i, j - 1)] + src[idx(i, j + 1)]) / 5;
          this.bedrock[k] = THREE.MathUtils.lerp(src[k], avg, w);
        }
      }
    }

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

  // Coarse "pick" proxy sync - cheap (19,600 verts), unchanged cost from before
  // this change. Only x/z/y positions matter here (raycast hit testing); no
  // normals are computed since the pick mesh is never rendered or shaded.
  _syncPickPositions() {
    const pos = this.pickGeometry.attributes.position;
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

  // Fine-mesh height at one fine vertex (fi, fj): smooth Catmull-Rom interpolation
  // of the coarse height field, sharpened back toward the raw (bilinear) coarse
  // value right where the player has actually disturbed the ground - the wide
  // bicubic stencil otherwise rounds off a freshly dug/piled cell enough that a
  // scoop reads as a soft dimple rather than a defined pit - plus a genuine fine
  // noise detail layer (grain/ripple) that's stronger on soft sand than bare rock
  // and locally amplified over disturbed cells so scoop marks read as a crisper
  // texture, not just a colour change. Purely cosmetic: never read back for
  // physics/water/collision, only written into the rendered mesh's Y.
  _computeFineHeightAt(fi, fj) {
    const fx = fi / RENDER_SUBDIV, fz = fj / RENDER_SUBDIV;
    const smoothH = sampleBicubicCoarse(this.height, fx, fz);
    const dist = THREE.MathUtils.clamp(sampleBilinearCoarse(this.disturbance, fx, fz), 0, 1);
    let h = smoothH;
    if (dist > 0.01) {
      const sharpH = sampleBilinearCoarse(this.height, fx, fz);
      h = smoothH + (sharpH - smoothH) * dist * 0.85;
    }
    const hardness = sampleBilinearCoarse(this.hardness, fx, fz);
    const wx = fi * FINE_CELL, wz = fj * FINE_CELL;
    const detailAmp = 1 - hardness * 0.85;
    const micro1 = nFine1.fbm(wx * 2.2, wz * 2.2, 2) * 0.026 * detailAmp;
    const micro2 = nFine2.fbm(wx * 7.6 + 91, wz * 7.6 + 91, 2) * 0.011 * detailAmp * (1 + dist * 1.6);
    return h + micro1 + micro2;
  }

  // Fine-vertex colour, mirroring the old coarse _updateColors() formula almost
  // exactly (same palette, same logic) but sampled continuously and - crucially -
  // with its cavity/AO check re-tuned to the shovel's own scale (~0.55m) instead
  // of the old ~1.6m coarse offset, which was wider than an entire scoop and so
  // could barely detect one at all. Dug basins vs piled rims now get visibly
  // different tinting (darker/damp vs lighter/dry), not just a shared "disturbed"
  // colour - this plus the sharpened geometry above is what makes a scoop read as
  // an actual hole rather than a colour smudge.
  _colorAt(fi, fj, h, slope, hardness, wet, disturbance, cavity, out) {
    if (ACTIVE_LEVEL === 'level3') {
      const x = fi * FINE_CELL, z = fj * FINE_CELL;
      const patch = n1.fbm(x * .19, z * .19, 3) * .5 + .5;
      out.copy(this._pal.grass).lerp(this._pal.grassWarm, patch * .42);
      out.lerp(this._pal.dirtLight, Math.min(.85, slope * .7 + wet * .55 + disturbance * .8));
      out.multiplyScalar(.88 + patch * .2);
    }
    else if (ACTIVE_LEVEL === 'level2') this._colorAtLevel2(fi, fj, h, slope, hardness, wet, disturbance, cavity, out);
    else this._colorAtLevel1(fi, fj, h, slope, hardness, wet, disturbance, cavity, out);
  }

  // Dirt/rock palette (no sand or coastal turf) with mossy patches on gentler,
  // sheltered slopes - mirrors _colorAtLevel1's structure (same strata/wet/
  // disturbance techniques) so the two levels read as consistent quality
  // without sharing literal colour values that wouldn't fit a mountain gorge.
  _colorAtLevel2(fi, fj, h, slope, hardness, wet, disturbance, cavity, out) {
    const P = this._pal;
    const fx = fi / RENDER_SUBDIV, fz = fj / RENDER_SUBDIV;

    const heightT = THREE.MathUtils.clamp((h - 2) / 45, 0, 1);
    const base = this._cBase.copy(P.dirt).lerp(P.dirtLight, heightT * 0.5);

    // Moss patches: gentle, damp-ish, mid-hardness ground only - not the sheer
    // rock face, not the driest exposed dirt.
    const mossNoise = n1.fbm(fx * 0.12 + 200, fz * 0.12 + 200, 3);
    const mossSlopeOk = THREE.MathUtils.clamp(1 - slope * 2.2, 0, 1);
    const mossPatch = THREE.MathUtils.clamp((mossNoise - 0.12) * 2.2, 0, 1) * mossSlopeOk * (1 - hardness * 0.6);
    const mossWarmth = THREE.MathUtils.clamp((n2.fbm(fx * 0.1 + 900, fz * 0.1 + 900, 2) - 0.1) * 1.6, 0, 1);
    const mossTone = this._cGrass.copy(P.moss).lerp(P.mossWarm, mossWarmth);
    base.lerp(mossTone, mossPatch * 0.85);

    const rockExposure = THREE.MathUtils.clamp(hardness * (0.25 + slope * 1.6), 0, 1);
    const rockHeightT = THREE.MathUtils.clamp((h - 2) / 40, 0, 1);
    const rockTone = this._cTone.copy(P.rockMid).lerp(P.rockLight, rockHeightT * 0.8).lerp(P.rockDark, (1 - rockHeightT) * 0.5);
    rockTone.lerp(P.rockDark, THREE.MathUtils.clamp(wet * 1.3, 0, 1) * 0.45);
    base.lerp(rockTone, rockExposure);
    if (rockExposure > 0.15) {
      const strataPhase = fi * FINE_CELL * 0.95 + h * 1.7;
      const strata = Math.sin(strataPhase) * 0.5 + 0.5;
      base.lerp(P.rockDark, strata * 0.4 * rockExposure);
      base.lerp(P.rockLight, (1 - strata) * 0.18 * rockExposure * rockHeightT);
      const fineStrataPhase = fi * FINE_CELL * 3.4 + h * 2.3 + 1.4;
      const fineStrata = Math.sin(fineStrataPhase) * 0.5 + 0.5;
      base.lerp(P.rockDark, fineStrata * 0.16 * rockExposure);
    }
    base.lerp(P.rockDark, THREE.MathUtils.clamp((slope - 0.45) * 1.0, 0, 1) * 0.78);

    const wetT = THREE.MathUtils.clamp(wet, 0, 1);
    base.lerp(P.mud, wetT * 0.85); // wet dirt/rock darkens toward mud - no wet-sand tone here

    const distT = THREE.MathUtils.clamp(disturbance, 0, 1);
    if (cavity > 0) base.lerp(P.turnedSandDug, distT * 0.8);
    else base.lerp(P.turnedSand, distT * 0.75);
    if (cavity > 0) base.multiplyScalar(1 - Math.min(1, cavity) * 0.5);
    else base.multiplyScalar(1 - cavity * 0.24);

    out.copy(base);
  }

  _colorAtLevel1(fi,fj,h,slope,hardness,wet,disturbance,cavity,out) {
    const c=mawganColour(fi*FINE_CELL,fj*FINE_CELL,h,slope,wet,disturbance);
    out.setRGB(c[0],c[1],c[2]);
    out.multiplyScalar(1-Math.min(.22,Math.max(0,cavity)*.2));
  }

  // Recomputes height, normals and vertex colour for every fine vertex covering
  // coarse cell range [i0,i1] x [j0,j1] (inclusive). Called both for small,
  // padded regions right after a dig/smooth/pile edit (cheap - a handful of
  // coarse cells, so a handful of fine vertices) and, one band of coarse rows at
  // a time, by the continuous background scan in update() (see
  // FINE_SCAN_ROWS_PER_FRAME) that keeps slower erosion/moisture/tide-driven
  // height drift flowing through without ever touching the whole ~310K-vertex
  // mesh in a single frame.
  _flushFineRegion({ i0, i1, j0, j1 }) {
    const fi0 = i0 * RENDER_SUBDIV, fi1 = Math.min(FINE_GRID - 1, i1 * RENDER_SUBDIV);
    const fj0 = j0 * RENDER_SUBDIV, fj1 = Math.min(FINE_GRID - 1, j1 * RENDER_SUBDIV);
    const fh = this.fineHeight;
    const pos = this.geometry.attributes.position;
    const posArr = pos.array;

    for (let fj = fj0; fj <= fj1; fj++) {
      for (let fi = fi0; fi <= fi1; fi++) {
        const k = fj * FINE_GRID + fi;
        const h = this._computeFineHeightAt(fi, fj);
        fh[k] = h;
        posArr[k * 3 + 1] = h;
      }
    }

    const normal = this.geometry.attributes.normal;
    const normArr = normal.array;
    const colArr = this.colors;
    // AO/cavity sample radius: ~0.55m, matching the shovel scoop's own scale
    // (DIG_LEN/DIG_WID in main.js) - the old coarse version used a ~1.6m offset,
    // wider than an entire scoop, which is a big part of why a dig used to barely
    // show up as anything more than a colour change.
    const AO_R = Math.max(1, Math.round(0.55 / FINE_CELL));
    const outColor = this._cOut || (this._cOut = new THREE.Color());

    for (let fj = fj0; fj <= fj1; fj++) {
      const jL = fj > 0 ? fj - 1 : 0, jR = fj < FINE_GRID - 1 ? fj + 1 : FINE_GRID - 1;
      const jAO0 = Math.max(0, fj - AO_R), jAO1 = Math.min(FINE_GRID - 1, fj + AO_R);
      for (let fi = fi0; fi <= fi1; fi++) {
        const k = fj * FINE_GRID + fi;
        const iL = fi > 0 ? fi - 1 : 0, iR = fi < FINE_GRID - 1 ? fi + 1 : FINE_GRID - 1;
        const hL = fh[fj * FINE_GRID + iL], hR = fh[fj * FINE_GRID + iR];
        const hD = fh[jL * FINE_GRID + fi], hU = fh[jR * FINE_GRID + fi];
        const dxWorld = posArr[(fj * FINE_GRID + iR) * 3] - posArr[(fj * FINE_GRID + iL) * 3];
        const dx = Math.abs(dxWorld) > 1e-6 ? (hR - hL) / dxWorld : 0;
        const dzWorld = (jR - jL) * FINE_CELL;
        const dz = dzWorld > 1e-6 ? (hU - hD) / dzWorld : 0;
        const nx = -dx, ny = 1, nz = -dz;
        const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
        normArr[k * 3] = nx / len; normArr[k * 3 + 1] = ny / len; normArr[k * 3 + 2] = nz / len;

        const h = fh[k];
        const slope = (Math.abs(dx) + Math.abs(dz)) / 2;
        const fx = fi / RENDER_SUBDIV, fz = fj / RENDER_SUBDIV;
        const hardness = sampleBilinearCoarse(this.hardness, fx, fz);
        const wet = sampleBilinearCoarse(this.moisture, fx, fz);
        const disturbance = sampleBilinearCoarse(this.disturbance, fx, fz);

        const iAO0 = Math.max(0, fi - AO_R), iAO1 = Math.min(FINE_GRID - 1, fi + AO_R);
        const wideAvg = (fh[fj * FINE_GRID + iAO0] + fh[fj * FINE_GRID + iAO1]
          + fh[jAO0 * FINE_GRID + fi] + fh[jAO1 * FINE_GRID + fi]) / 4;
        const cavity = THREE.MathUtils.clamp((wideAvg - h) * 1.5, -0.4, 1.0);

        this._colorAt(fi, fj, h, slope, hardness, wet, disturbance, cavity, outColor);
        colArr[k * 3] = outColor.r; colArr[k * 3 + 1] = outColor.g; colArr[k * 3 + 2] = outColor.b;
      }
    }

    pos.needsUpdate = true;
    normal.needsUpdate = true;
    this.geometry.attributes.color.needsUpdate = true;
  }

  // Marks a coarse cell range as needing a fine-mesh resync, padded by enough
  // cells to cover the bicubic stencil's own reach (2 cells) plus a small margin -
  // called from every player-driven edit (deform/scoopDeform/depositRing/smooth)
  // so the very next update() flushes just that small local patch immediately,
  // rather than waiting on the background scan to come back around.
  _markFineDirty(i0, i1, j0, j1) {
    const PAD = 3;
    const ci0 = Math.max(0, i0 - PAD), ci1 = Math.min(GRID - 1, i1 + PAD);
    const cj0 = Math.max(0, j0 - PAD), cj1 = Math.min(GRID - 1, j1 + PAD);
    if (!this._fineDirty) { this._fineDirty = { i0: ci0, i1: ci1, j0: cj0, j1: cj1 }; return; }
    const d = this._fineDirty;
    d.i0 = Math.min(d.i0, ci0); d.i1 = Math.max(d.i1, ci1);
    d.j0 = Math.min(d.j0, cj0); d.j1 = Math.max(d.j1, cj1);
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
    this._markFineDirty(i0, i1, j0, j1);
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
    this._markFineDirty(i0, i1, j0, j1);
    return moved;
  }

  // Raises a ring of terrain between innerR and outerR - used for the spoil heap
  // Deposit an exact quantity returned by scoopDeform. Its `delta` argument
  // is a peak height, not a quantity: feeding removed soil back into it
  // multiplied the earth by the destination footprint's summed weights.
  depositScoop(x, z, dirX, dirZ, lenR, widR, amount) {
    const len = Math.hypot(dirX, dirZ) || 1;
    const ux = dirX / len, uz = dirZ / len, r = Math.max(lenR, widR);
    const cells = []; let total = 0;
    for (let j = Math.max(0, Math.floor((z-r)/CELL)); j <= Math.min(GRID-1, Math.ceil((z+r)/CELL)); j++) {
      for (let i = Math.max(0, Math.floor((x-r)/CELL)); i <= Math.min(GRID-1, Math.ceil((x+r)/CELL)); i++) {
        const k = idx(i,j); if (this.blocked[k]) continue;
        const dx=i*CELL-x, dz=j*CELL-z;
        const d=Math.hypot((dx*ux+dz*uz)/lenR,(-dx*uz+dz*ux)/widR);
        if(d>=1)continue;
        const w=(1-d)**2;cells.push([k,w]);total+=w;
      }
    }
    if(!total)return 0;
    for(const [k,w] of cells) { const dh=amount*w/total;this.height[k]+=dh;this.disturbance[k]=Math.min(1,this.disturbance[k]+dh*6); }
    this._markFineDirty(Math.max(0,Math.floor((x-r)/CELL)),Math.min(GRID-1,Math.ceil((x+r)/CELL)),Math.max(0,Math.floor((z-r)/CELL)),Math.min(GRID-1,Math.ceil((z+r)/CELL)));
    return amount;
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
    this._markFineDirty(i0, i1, j0, j1);
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
    this._markFineDirty(i0, i1, j0, j1);
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
      // Coarse pick-proxy resync only - cheap, same cost as before this change.
      // No normals needed (raycasting doesn't use them, and the pick mesh is
      // never rendered), which is actually one less thing done per frame than
      // the old code that also ran computeVertexNormals() on this same geometry
      // every time it was (also) the rendered mesh.
      this._syncPickPositions();
      this._needsSync = false;
    }

    // Player edits (dig/smooth/pile) get their small local patch of the fine mesh
    // flushed immediately - cheap, since it's only ever a handful of coarse cells
    // (padded for the interpolation stencil) at a time.
    if (this._fineDirty) {
      this._flushFineRegion(this._fineDirty);
      this._fineDirty = null;
    }

    // Continuous low-cost background scan: a handful of coarse rows' worth of
    // fine mesh gets refreshed every single frame regardless of dirty state, so
    // slower drift the player didn't directly cause (erosion/sediment carving the
    // channel, moisture creeping with the tide) still reaches the render mesh -
    // without ever re-touching the whole ~310K-vertex mesh in one frame (measured
    // to be the expensive case - see the deployment notes for actual numbers).
    const scanJ0 = this._scanRow;
    const scanJ1 = Math.min(GRID - 1, scanJ0 + FINE_SCAN_ROWS_PER_FRAME);
    this._flushFineRegion({ i0: 0, i1: GRID - 1, j0: scanJ0, j1: scanJ1 });
    // Regions include both endpoints. Share the last coarse row with the next
    // strip, otherwise the fine vertices BETWEEN row 1 and row 2 never refresh.
    this._scanRow = scanJ1 >= GRID - 1 ? 0 : scanJ1;

    // Freshly turned sand slowly weathers back to its normal colour over roughly
    // a minute - long enough that a dig session reads clearly, short enough that
    // the beach doesn't stay visibly "scarred" forever.
    const decay = Math.exp(-dt / 25);
    for (let k = 0; k < this.disturbance.length; k++) this.disturbance[k] *= decay;
  }
}

export { idx, streamCenterX };
