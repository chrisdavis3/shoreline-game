import * as THREE from 'three';
import { Noise2D } from './noise.js?v=58';

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
//
// CORRECTED (this was backwards for a whole prior session): earlier code and
// an earlier web search both claimed the real River Menalhyl "meanders along
// Mawgan Porth's southern edge" and placed the stream near i=31 (low i,
// close to the southern end). Independently re-verified this time by
// pulling the ACTUAL OpenStreetMap topology instead of trusting either
// claim: Overpass way 307894885 ("River Menalhyl") plus its connected
// unnamed "stream" ways (30348987, 1176294924-27) trace a continuous
// waterway from inland, ending at node 334634419 (50.465113, -5.0321424).
// Projected onto the real coastline (way 62688995) between the two
// headlands that flank Mawgan Porth beach, that mouth sits at ~99% of the
// way along the bay from its southern end (i.e. i~137 of 139) - hard up
// against the NORTHERN headland, not the southern one. (The user's own
// on-screen observation of the live game is what triggered re-checking this
// - it was right, the prior "southern edge" research was wrong.)
//
// Placed at a mirror image of the old (wrong) 0.22-from-the-south position -
// 0.78, i.e. the same ~31-cell margin from the NORTH edge (i=GRID-1) this
// time - rather than pushing all the way out to the literal i~137 the real
// mouth projects to. Going any closer to the edge than that runs the stream
// into insetCells()'s dune-line taper band below (up to ~17 cells wide at
// t=0, see insetCells' own comment for the exact current figure), which would
// re-introduce the exact "wizard hat" pinch that band was built to avoid (see
// insetCells' own comment). 31 cells of margin keeps the stream clear of it at
// every t, same as the old placement did on the other side.
function streamCenterX(z) {
  const t = z / SIZE;
  return SIZE * 0.78 + Math.sin(t * 5.4 + 0.6) * SIZE * 0.06 * (0.4 + t) + n2.fbm(0, t * 3, 2) * SIZE * 0.03;
}

// The coastline's t-threshold (0..1, inland->sea) as a function of column i.
//
// CORRECTED (this was wrong for a whole prior session): the previous version
// of this array was traced from OSM way 399625654 ("Dunes", natural=beach) -
// but that way turned out to be a small, narrow, unrelated dune-ridge
// feature well inland of and much smaller than Mawgan Porth's actual wide
// sandy bay (confirmed by plotting way 399625654 next to the real
// natural=coastline way 62688995: they aren't even the same shape or scale).
// Using it explains why the beach looked nothing like the reference map no
// matter how the other constants were tuned - the source data was for the
// wrong feature.
//
// This version is traced from the REAL coastline instead: Overpass way
// 62688995 (natural=coastline, OS OpenData StreetView), restricted to the
// stretch that actually bounds the sandy bay (between the two flanking
// rocky headlands, verified against the river mouth above and against the
// aerial reference photo). For each of the 140 columns, the coastline's
// perpendicular distance from the straight baseline connecting the bay's
// two ends (i.e. how far it bulges seaward past a straight mouth-to-mouth
// line, not raw longitude - using raw longitude here is what produced a
// misleading monotonic ramp during verification, since this stretch of
// coast itself runs at a diagonal, not purely north-south) was sampled at
// 140 even arc-length steps, lightly smoothed (7-sample moving average) to
// keep the per-column slope gentle, then rescaled to a 0.40-0.82 depth
// range. i=0 is the southern end of the real bay, i=GRID-1 the northern end
// (unchanged convention - only the traced shape and the stream's side were
// wrong before, not this axis labelling). This is also where the specific
// real asymmetry lives: a real rocky point cuts into the sand around
// i=20-29 (the dip below), on the southern third - the two ends of this
// beach are not mirror images of each other, and this notch is why.
const REAL_COAST_T = [
  0.4862, 0.4922, 0.4986, 0.5044, 0.5170, 0.5285, 0.5360, 0.5400, 0.5418, 0.5412,
  0.5391, 0.5357, 0.5308, 0.5262, 0.5218, 0.5167, 0.5103, 0.5025, 0.4935, 0.4834,
  0.4730, 0.4623, 0.4512, 0.4401, 0.4292, 0.4188, 0.4102, 0.4039, 0.4004, 0.4000,
  0.4025, 0.4074, 0.4137, 0.4215, 0.4307, 0.4404, 0.4510, 0.4607, 0.4704, 0.4808,
  0.4913, 0.5017, 0.5104, 0.5191, 0.5288, 0.5376, 0.5456, 0.5536, 0.5620, 0.5726,
  0.5821, 0.5921, 0.6031, 0.6148, 0.6257, 0.6341, 0.6419, 0.6504, 0.6571, 0.6639,
  0.6701, 0.6754, 0.6826, 0.6896, 0.6935, 0.6993, 0.7050, 0.7114, 0.7191, 0.7265,
  0.7338, 0.7441, 0.7539, 0.7637, 0.7727, 0.7804, 0.7877, 0.7929, 0.7951, 0.7968,
  0.7989, 0.8011, 0.8039, 0.8066, 0.8103, 0.8155, 0.8193, 0.8200, 0.8187, 0.8146,
  0.8084, 0.8007, 0.7921, 0.7820, 0.7713, 0.7591, 0.7476, 0.7392, 0.7343, 0.7306,
  0.7268, 0.7244, 0.7257, 0.7286, 0.7290, 0.7265, 0.7239, 0.7250, 0.7253, 0.7238,
  0.7202, 0.7168, 0.7142, 0.7100, 0.7025, 0.6945, 0.6857, 0.6774, 0.6708, 0.6640,
  0.6570, 0.6498, 0.6431, 0.6356, 0.6273, 0.6161, 0.6031, 0.5899, 0.5765, 0.5631,
  0.5501, 0.5369, 0.5238, 0.5105, 0.4971, 0.4858, 0.4773, 0.4713, 0.4657, 0.4611,
];

export function coastT(i) {
  return REAL_COAST_T[THREE.MathUtils.clamp(Math.round(i), 0, GRID - 1)];
}

// Smoothly interpolated coastT for use where the caller needs a continuous
// curve across columns (avoids a staircase every integer i) - coastT() itself
// intentionally rounds, since most callers index one specific simulation
// column, but insetCells() below evaluates at continuous fractional i (fine
// render-mesh spacing), so it needs the in-between values too.
function coastTSmooth(i) {
  const ci = THREE.MathUtils.clamp(i, 0, GRID - 1);
  const i0 = Math.floor(ci), i1 = Math.min(GRID - 1, i0 + 1);
  const f = ci - i0;
  return REAL_COAST_T[i0] + (REAL_COAST_T[i1] - REAL_COAST_T[i0]) * f;
}

const edgeRoughNoise = new Noise2D(2718);

// The level's own physical footprint was still a perfect square in world space
// no matter how the sand/rock/sea classification varied within it - every
// depth row spanned the full [0, SIZE] width, so the mesh always ended in a
// hard 90-degree corner where the inland (dune-line) edge met the side edge.
// First attempt at fixing this scaled every vertex in a row toward the
// centreline by the same factor - which also dragged in the stream (well off
// centre) by that same factor, so ITS width visibly tapered to a point near
// the dune line (an unwanted "wizard hat" on the river) while the actual sand
// edge, softened by noise, read as a vague round blob instead of a specific
// outline.
//
// SECOND attempt (this one superseded too - see TESTING_FEEDBACK.md and the
// user's own screenshots) only touched vertices within a band of the nearest
// side edge, sized purely from t (depth) - 22 cells right at the dune line,
// fading to 0 by a fixed t=0.30, identical on both sides regardless of what
// either real headland actually looks like. That produced a big, clean,
// perfectly symmetric diagonal wedge at each inland corner ("big triangular
// inlets") with NO relationship to the real coastline data already driving
// the sand/rock/sea colouring - the taper was the one part of the level's
// silhouette that was still, literally, generic.
//
// THIS version ties the same mechanism to the real per-column data instead:
// insetCells(i, t) below reads THIS column's own real coastline depth
// (coastTSmooth(i), the same REAL_COAST_T data _generate() uses for
// sand/rock/sea and for cliffPotential/nearCoastT). A column whose real
// coastline already sits close to the dune line (low coastT - a narrow rocky
// point with almost no beach in front of it, like the literal i=0/i=GRID-1
// headland columns here) tapers in harder and resolves later; a column with a
// wide sandy apron in front of it (high coastT) stays close to full width
// almost immediately. Evaluated per-vertex (not once per edge), so the two
// sides need not behave identically, and a little organic noise breaks the
// curve up so it reads as an uneven natural edge rather than one clean
// geometric wedge. Peak width and reach are deliberately kept modest (well
// under the old 22-cell/t=0.30 figures) - the point of this taper is only to
// round off the literal inland corner without a jarring right angle; the
// actual organic bay/headland shape should come from the real coastline
// colouring and cliff relief, not from this seam being a competing shape in
// its own right.
//
// Still only touches vertices within insetCells() of whichever side edge is
// nearest - the stream (now ~31 cells in from i=GRID-1, see streamCenterX -
// it was ~31 cells in from i=0 before the river-side fix) stays safely outside
// this band at every depth (max reach below is ~17 cells), so it renders
// exactly as the water sim computes it. Only x is warped (z/depth untouched),
// and only render positions - the (i, j) simulation grid underneath stays a
// rectangle.
export function insetCells(i, t) {
  const ct = coastTSmooth(i);
  // 0 = a narrow rocky point (real coastline already close to the dune line),
  // 1 = a wide sandy apron in front of this column.
  const openness = THREE.MathUtils.clamp((ct - 0.35) / 0.45, 0, 1);
  const peakInset = 16 - 6 * openness;       // 10-16 cells right at the dune line
  const taperEndT = 0.10 + 0.06 * openness;  // fully resolved to full width by this t
  const wt = THREE.MathUtils.clamp(t / taperEndT, 0, 1);
  const base = peakInset * (1 - Math.pow(wt, 1.4));
  // Organic irregularity, faded out at both ends of the band (wt=0 right at
  // the dune line, where the boundary must stay exact and predictable, and
  // wt=1 where it's already resolved to full width) so it can only roughen
  // the taper's middle, never widen it past its own peak or reopen it once
  // resolved.
  const rough = edgeRoughNoise.fbm(i * 0.15, t * 14, 2) * 2.6 * wt * (1 - wt);
  return Math.max(0, base + rough);
}

export function warpX(x, z) {
  const t = z / SIZE;
  const i = x / CELL;
  const side = i < (GRID - 1) / 2 ? 0 : 1; // 0 = south edge (i=0), 1 = north edge (i=GRID-1)
  const edgeDist = side === 0 ? i : (GRID - 1 - i);
  const blendWidth = insetCells(i, t);
  if (blendWidth <= 0.001) return x;
  if (edgeDist >= blendWidth) return x; // safely inside the untouched middle - stream lives here
  const insetAmount = blendWidth * 0.8; // how far the true edge itself gets pulled inward
  const localT = edgeDist / blendWidth; // 0 at the literal edge, 1 at the blend boundary
  const eased = Math.pow(localT, 0.7);
  const newEdgeDist = insetAmount + (blendWidth - insetAmount) * eased; // monotonic, continuous at the blend boundary
  const newI = side === 0 ? newEdgeDist : (GRID - 1) - newEdgeDist;
  return newI * CELL;
}

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
export const RENDER_SUBDIV = 4;                          // fine vertices per coarse cell edge
export const FINE_GRID = (GRID - 1) * RENDER_SUBDIV + 1; // 557 vertices/side
export const FINE_CELL = CELL / RENDER_SUBDIV;           // ~0.205m

const nFine1 = new Noise2D(6161);
const nFine2 = new Noise2D(7331);

// Named clampIdx (not `ci`) to avoid shadowing the many local `ci` (cell-index)
// variables used throughout _generate() below.
function clampIdx(v) { return v < 0 ? 0 : v > GRID - 1 ? GRID - 1 : v; }

// Catmull-Rom cubic through 4 samples, t in [0,1] between p1 and p2 - passes
// exactly through every coarse sample (unlike a least-squares fit) while
// keeping a continuous derivative, so adjacent coarse cells blend smoothly
// instead of showing the facet naive bilinear would produce at each seam.
function catmullRom1D(p0, p1, p2, p3, t) {
  return p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
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
      rockDark: new THREE.Color('#15130f'),         // near-black wet slate, not a flat brown-grey
      rockMid: new THREE.Color('#4a4438'),
      rockLight: new THREE.Color('#9c8f76'),        // lighter, drier rock higher up the cliff
      turnedSand: new THREE.Color('#7c6142'),      // piled/disturbed rim - lighter, "just turned"
      turnedSandDug: new THREE.Color('#4a3720'),   // freshly dug basin - darker, damp-looking
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
        // flank the real coastline (see REAL_COAST_T above) at its two ends. Note
        // the river/stream enters right against the Trenance Point end (high i),
        // not Berryl's Point - see streamCenterX's own comment. An exponent above 1
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
    const P = this._pal;
    const fx = fi / RENDER_SUBDIV, fz = fj / RENDER_SUBDIV;
    const t = (fj * FINE_CELL) / SIZE;

    // Warm/cool grass variation: real coastal turf is never one flat green - it
    // mottles between a cooler, shaded green and a warm, sun-bleached almost-golden
    // tone. Driven by its own noise field (independent of the coverage masks below)
    // so the warm/cool mix reads as natural patchiness, not banding tied to where
    // the grass itself is placed.
    const grassWarmth = THREE.MathUtils.clamp((n2.fbm(fx * 0.11 + 700, fz * 0.11 + 700, 3) - 0.1) * 1.5, 0, 1);
    const grassTone = this._cGrass.copy(P.grass).lerp(P.grassWarm, grassWarmth);

    const base = this._cBase.copy(P.sand).lerp(grassTone, THREE.MathUtils.clamp((0.22 - t) * 3.2, 0, 1) * 0.85);
    base.lerp(P.dryGrass, 0.15 * Math.max(0, 1 - t * 3));

    const grassPatch = THREE.MathUtils.clamp((n1.fbm(fx * 0.15 + 300, fz * 0.15 + 300, 3) - 0.1) * 2.4, 0, 1);
    const clifftopGrass = THREE.MathUtils.clamp((h - 4.5) / 3.5, 0, 1)
      * THREE.MathUtils.clamp(1 - slope * 2.6, 0, 1) * grassPatch;
    base.lerp(grassTone, clifftopGrass * 0.9);

    const rockExposure = THREE.MathUtils.clamp(hardness * (0.2 + slope * 1.8), 0, 1);
    const rockHeightT = THREE.MathUtils.clamp((h - 2) / 9, 0, 1);
    const rockTone = this._cTone.copy(P.rockMid).lerp(P.rockLight, rockHeightT * 0.8).lerp(P.rockDark, (1 - rockHeightT) * 0.5);
    // Rock exposed low down, where `wet` (the water sim's own moisture field) runs
    // high, reads as genuinely dark, wet slate - not the same flat brown-grey as
    // the dry rock higher up the cliff face.
    rockTone.lerp(P.rockDark, THREE.MathUtils.clamp(wet * 1.3, 0, 1) * 0.45);
    base.lerp(rockTone, rockExposure);
    if (rockExposure > 0.2) {
      const strataPhase = fi * FINE_CELL * 0.32 + h * 2.6;
      const strata = Math.sin(strataPhase) * 0.5 + 0.5;
      base.lerp(P.rockDark, strata * 0.36 * rockExposure);
      // Alternate bands lighten toward the dry, higher-up rock tone instead of
      // every band only ever darkening - real sedimentary strata reads as
      // alternating light/dark banding, not a one-directional smudge. Gated by
      // rockHeightT so this light band only shows through on the drier rock
      // higher up; wet rock near the waterline stays uniformly dark.
      base.lerp(P.rockLight, (1 - strata) * 0.16 * rockExposure * rockHeightT);
      const fineStrata = Math.sin(strataPhase * 2.7 + 1.4) * 0.5 + 0.5;
      base.lerp(P.rockDark, fineStrata * 0.16 * rockExposure);
    }
    base.lerp(P.rockDark, THREE.MathUtils.clamp((slope - 0.45) * 1.0, 0, 1) * 0.78);

    const wetT = THREE.MathUtils.clamp(wet, 0, 1);
    base.lerp(P.wetSand, wetT * 0.85);
    base.lerp(P.mud, wetT * wetT * 0.55);

    // Dug basins (cavity > 0) read as a distinctly darker, damp "just turned"
    // tone; piled rims (cavity < 0) read lighter/drier - stronger than the old
    // single shared "disturbed" tint so a hole and its spoil heap read as visually
    // different things, the way real turned sand actually does.
    const distT = THREE.MathUtils.clamp(disturbance, 0, 1);
    if (cavity > 0) base.lerp(P.turnedSandDug, distT * 0.8);
    else base.lerp(P.turnedSand, distT * 0.75);

    // Moderated from an earlier pass that clamped cavity up to 1.3 and darkened by
    // up to 0.62 - combined with turnedSandDug that read as a near-black void
    // rather than a shadowed damp basin. Still a strong, unambiguous "this is a
    // hole" cue (verified in-browser - see deployment notes), just not literally black.
    if (cavity > 0) base.multiplyScalar(1 - Math.min(1, cavity) * 0.5);
    else base.multiplyScalar(1 - cavity * 0.24); // rims catch noticeably more light

    out.copy(base);
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
    const scanJ1 = Math.min(GRID - 1, scanJ0 + FINE_SCAN_ROWS_PER_FRAME - 1);
    this._flushFineRegion({ i0: 0, i1: GRID - 1, j0: scanJ0, j1: scanJ1 });
    this._scanRow = scanJ1 >= GRID - 1 ? 0 : scanJ1 + 1;

    // Freshly turned sand slowly weathers back to its normal colour over roughly
    // a minute - long enough that a dig session reads clearly, short enough that
    // the beach doesn't stay visibly "scarred" forever.
    const decay = Math.exp(-dt / 25);
    for (let k = 0; k < this.disturbance.length; k++) this.disturbance[k] *= decay;
  }
}

export { idx, streamCenterX };
