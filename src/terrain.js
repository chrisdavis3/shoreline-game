import * as THREE from 'three';
import { Noise2D } from './noise.js?v=104';

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
export const TERRAIN_VERSION = 8;
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
function streamCenterXLevel1(z) {
  const t = z / SIZE;
  return SIZE * 0.78 + Math.sin(t * 5.4 + 0.6) * SIZE * 0.06 * (0.4 + t) + n2.fbm(0, t * 3, 2) * SIZE * 0.03;
}

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
export const L2_T_FALL0 = 0.17;           // t where the near-vertical drop begins
export const L2_T_FALL1 = 0.28;           // t where it lands in the base pool
export const L2_TOP_H = 52;               // mountainside height above the falls
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
export const L2_LAKE_RADIUS_X = 15;
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

// ---------------------------------------------------------------------------
// Level 3 ("Millwright's Fork"): a valley downstream of Highfall Gorge where a
// single river forks around a small wooded island - one branch (the old mill
// race) used to feed a water wheel, but a rockslide silted it up, diverting
// most of the flow into the other, now-larger fork. z=0 is the upstream end
// (the river arrives off-map, same "0 = where the water comes from" convention
// level1's stream source and level2's mountainside top both use), z=SIZE is
// the downstream exit (the valley continues, unbuilt, toward a future level 4).
//
// Unlike level1 (a single meandering stream carved into noisy dune terrain,
// which needed the elaborate downhill-ratchet + cross-slope-limiter passes
// below to stay monotonic) this follows level2's simpler, safer approach: the
// valley floor's elevation is an explicit, already-monotonic function of t
// (see l3FloorH), so both channels are carved INTO that guaranteed-downhill
// profile rather than derived from noisy terrain that then needs correcting.
export const L3_TOP_H = 14;         // upstream valley-floor height
export const L3_EXIT_H = 2;         // downstream exit height
export const L3_T_FORK0 = 0.26;     // t where the two channels start separating
export const L3_T_FORK1 = 0.38;     // t where they reach full separation (island begins)
export const L3_T_REJOIN0 = 0.74;   // t where they start coming back together
export const L3_T_REJOIN1 = 0.87;   // t where they're fully merged again
export const L3_SEPARATION = 15;    // metres each channel's centre sits off the shared base line, at full separation
export const L3_CHANNEL_HALFWIDTH = 2.4; // metres, per channel
export const L3_CHANNEL_DEPTH = 1.3;     // metres, per channel, away from the weir/sill
export const L3_T_WEIR = 0.55;      // the mill race's own small weir/drop, right at the wheel
export const L3_WEIR_WIDTH = 0.03;  // t half-width of the weir's rise (and, mirrored, its later fall-back-level before the rejoin)
export const L3_WEIR_DROP = 1.6;    // metres the mill race's bed drops at the weir
export const L3_T_SILL = 0.46;      // rockslide blockage in the mill race, upstream of the weir
export const L3_SILL_WIDTH = 0.035; // t sigma of the blockage's (Gaussian) footprint
export const L3_SILL_HEIGHT = 1.3;  // metres the blockage shallows the mill race's own bed (clamped so it never fully seals it)
export const L3_ISLAND_AMP = 3.2;   // metres the island rises above the shared valley floor at full separation

export function l3BaseCenterX(z) {
  const t = z / SIZE;
  return SIZE * 0.5 + Math.sin(t * 3.6 + 0.4) * SIZE * 0.05 + n2.fbm(2, t * 3 + 40, 2) * SIZE * 0.025;
}

// 0 before the fork, ramps to 1 by full separation, holds at 1 through the
// island, ramps back to 0 by the rejoin - continuous throughout (see the
// terrain.js header note on never hard-cutting a blend: this is the same
// min-of-two-smoothsteps "plateau" trick used below for the weir/tailrace).
function l3SeparationT(t) {
  const up = THREE.MathUtils.smoothstep(t, L3_T_FORK0, L3_T_FORK1);
  const down = 1 - THREE.MathUtils.smoothstep(t, L3_T_REJOIN0, L3_T_REJOIN1);
  return Math.min(up, down);
}

export function l3MainChannelX(z) {
  const t = z / SIZE;
  return l3BaseCenterX(z) + l3SeparationT(t) * L3_SEPARATION;
}
export function l3RaceChannelX(z) {
  const t = z / SIZE;
  return l3BaseCenterX(z) - l3SeparationT(t) * L3_SEPARATION;
}

// A 0->1->0 "plateau" over t: rises smoothly around `riseCenter` (+/- riseWidth),
// stays at 1, then eases back down to 0 between fallStart and fallEnd. Used for
// the mill race's weir: it drops at the weir and STAYS dropped through its own
// tailrace, but must smoothly rejoin the main channel's (shallower, by then)
// bed before the two channels actually merge in x - a permanent step-down
// would otherwise leave a real cliff right at the confluence.
function l3Plateau(t, riseCenter, riseWidth, fallStart, fallEnd) {
  const up = THREE.MathUtils.smoothstep(t, riseCenter - riseWidth, riseCenter + riseWidth);
  const down = 1 - THREE.MathUtils.smoothstep(t, fallStart, fallEnd);
  return Math.min(up, down);
}

function streamCenterX(z) {
  if (ACTIVE_LEVEL === 'level2') return streamCenterXLevel2(z);
  if (ACTIVE_LEVEL === 'level3') return l3BaseCenterX(z);
  return streamCenterXLevel1(z);
}

// The coastline's t-threshold (0..1, inland->sea) as a function of column i.
//
// CORRECTED AGAIN (this went through two wrong versions before this one - see
// git history/TESTING_FEEDBACK.md): first traced from the wrong OSM way
// entirely, then from a "real" OSM way that turned out to have a dramatic
// ~0.42-deep, sharply-peaked bulge in the middle of the bay - which rendered,
// verified via a raw top-down data image (bypassing 3D lighting entirely),
// as an unmistakable sharp mountain-shaped wedge of sea jutting into the
// sand, not a coastline. That matches the user's own screenshot complaint
// exactly (a pointed wedge where sea meets sand) - so that data, however it
// was traced, was wrong for this purpose regardless of source.
//
// This version is built from actual reference photos instead of a hand-traced
// OSM way: a drone aerial of the whole bay (oblique) and a ground-level shot
// from the dune line showing both headlands in one frame. Both show the same
// thing - a wide, gently-curving crescent bay with an almost STRAIGHT
// sea-facing edge (waves roll in close to parallel to the dune line - there's
// no dramatic bulge or pinch anywhere along it). The actual bay-mouth-to-mouth
// TAPER (narrow at the dune line, fanning out toward the sea) is already
// handled entirely by insetCells()/warpX() below; this function only needs to
// supply a gentle, mostly-flat crescent with a slight seaward bulge at the
// centre and small natural irregularity - not a large per-column swing.
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

// Level 3 has no sea or still lake either - the river (both forks, rejoined by
// here) simply continues downstream off the map toward the unbuilt next
// valley. Reuses the same coastT/tide-relaxation machinery so that "downstream
// edge" doesn't pool up indefinitely (see water.js's sea-coupling step) - a
// high, near-constant threshold near the map's far edge, same idea as level2's
// lake threshold.
const L3_EXIT_T0 = 0.93;
function coastTContinuousLevel3(ci) {
  return L3_EXIT_T0 + coastRoughNoise.fbm(ci * 0.045, 130, 2) * 0.012;
}

function coastTContinuousLevel1(ci) {
  const u = THREE.MathUtils.clamp(ci, 0, GRID - 1) / (GRID - 1);
  const crescent = Math.sin(Math.PI * u); // 0 at both headlands, 1 at the bay's centre
  const bulge = Math.pow(crescent, 1.3);
  // 0.66 right off each headland's base (still a real sandy apron there, per
  // the eye-level photo - sand runs right up to both hills, it doesn't pinch
  // to nothing) rising gently to 0.76 at the bay's centre - a ~0.10 total
  // range, an order of magnitude gentler than the old traced data, matching
  // the reference photos' near-straight waterline.
  const base = 0.66 + 0.10 * bulge;
  // Small, low-frequency organic irregularity so the edge doesn't read as a
  // mathematically perfect sine - real coastlines wobble a little - but kept
  // an order of magnitude smaller than the swing itself so it can never
  // reintroduce a wedge/pinch.
  const rough = coastRoughNoise.fbm(ci * 0.035, 40, 3) * 0.018;
  return base + rough;
}

export function coastT(i) {
  const ci = Math.round(THREE.MathUtils.clamp(i, 0, GRID - 1));
  if (ACTIVE_LEVEL === 'level2') return coastTContinuousLevel2(ci);
  if (ACTIVE_LEVEL === 'level3') return coastTContinuousLevel3(ci);
  return coastTContinuousLevel1(ci);
}

// Continuous (non-staircased) version for callers evaluating at fractional i
// (fine render-mesh spacing, e.g. insetCells() below) - coastT() itself rounds
// since most callers index one specific simulation column.
function coastTSmooth(i) {
  const c = THREE.MathUtils.clamp(i, 0, GRID - 1);
  if (ACTIVE_LEVEL === 'level2') return coastTContinuousLevel2(c);
  if (ACTIVE_LEVEL === 'level3') return coastTContinuousLevel3(c);
  return coastTContinuousLevel1(c);
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
  // Level 2 and level 3 are both valleys, not an organic coastline - they want
  // straight edges right out to the map boundary (the valley walls/slopes
  // themselves already supply all the shape), not level 1's coastline-tracing
  // taper. Returning 0 here makes warpX() below a no-op automatically (see its
  // own early-out).
  if (ACTIVE_LEVEL === 'level2' || ACTIVE_LEVEL === 'level3') return 0;
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
    if (ACTIVE_LEVEL === 'level2') this._generateLevel2();
    else if (ACTIVE_LEVEL === 'level3') this._generateLevel3();
    else this._generateLevel1();
  }

  _generateLevel1() {
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
        // Reach capped at 8+60=68 cells used to mean almost the ENTIRE coastline
        // (only ~4 of 140 cells stayed clear dead-centre) got some non-zero
        // headland contribution right at its own coastline threshold - a small
        // rock/hardness bump whose peak height only just happened to sit above
        // or below the sand/rock colour threshold from one column to the next,
        // which is exactly what read as a jagged, pointed "wizard hat" pinching
        // the sand from both sides rather than a clean, wide-open bay middle.
        // Real headlands are localised to the two actual rocky points - capped
        // at 8+22=30 cells (~25m) leaves a genuinely headland-free ~65m-wide
        // clean stretch across the middle of the bay.
        const cliffWidthCells = 8 + 22 * Math.pow(nearCoastT, 1.25);
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
        // A real river doesn't cut a narrow slot through the tallest part of a
        // cliff - it finds the lowest ground, because that's WHY the land is
        // low there in the first place. This end of the bay (the stream sits
        // close to i=GRID-1, the same end `edgeDist` already scores as the
        // tallest cliff) was reading backwards from the real map/photos: the
        // real headland by the stream mouth is gentle, low, open farmland -
        // the dramatic rock is the OTHER headland, which has nothing to do
        // with drainage. `streamExemption` above only ever cleared a ~10-cell
        // channel-width gap through full-height cliff on both sides; this
        // widens that into a genuine broad valley (~30 cells) so the whole
        // neighbourhood of the stream reads as low ground, not just its exact
        // centreline.
        const streamValleyDist = streamGapDist;
        const streamValleyWidth = 30;
        const streamValleyT = THREE.MathUtils.clamp(1 - streamValleyDist / streamValleyWidth, 0, 1);
        const streamValley = streamValleyT * streamValleyT * (3 - 2 * streamValleyT);
        const headland = cliffPotential * cliffOnset * (1 - streamExemption * 0.92) * (1 - streamValley * 0.72);
        // Checked against real elevation data (open-elevation.com samples around
        // the actual headlands, cross-checked against a web search putting both
        // Berryl's Point and Trenance Point at "over 50 metres"): the beach/dune
        // area itself sits at only ~6-8m, and the headlands reach ~48-68m - a
        // real height difference of ~45-60m, not the ~13m this constant gave.
        // The simulated grid only covers the walkable NEAR side of each
        // headland (the decorative skirt in environment.js continues rising
        // beyond it toward the real summit), so it doesn't need to reach the
        // full 50m+ by itself - raised enough that the two read as continuous
        // rather than the skirt suddenly having to make up a huge, visible gap
        // right at the seam.
        hLand += headland * (19 + n1.fbm(i * 0.06, j * 0.06, 3) * 2.6) * Math.max(0.55, 1 - t * 0.18);

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
      // Fade the carve out once this row is already past ITS OWN column's real
      // coastline (t beyond coastT(i)) - found via the raw top-down data render
      // (bypassing 3D lighting) as the exact source of a sharp, single-column
      // "spike" of full-depth sea poking into the sand right at the creek mouth:
      // the sea-depth blend above already carries every column below the
      // -0.3 "deep sea" cutoff a few cells past its own coastline, so carving
      // another 1.7m off a spot that's already "sea" punched a visibly deeper,
      // narrower notch there than anywhere else along the same waterline - a
      // real geometric artifact, not merely a symptom of the water shader (the
      // user's reported wedge could well have BOTH causes; this is the terrain
      // half). Only fades past this column's coastline - the actual channel bed
      // everywhere upstream of it (dune line to coastline) is untouched, so the
      // simulated creek's flow/erosion still sees the same carved bed it always did.
      for (let i = 0; i < GRID; i++) {
        const carveFade = 1 - THREE.MathUtils.clamp((t - coastT(i)) / 0.05, 0, 1);
        const d = Math.abs(i - ci);
        const carve = Math.exp(-Math.pow(d / width, 2)) * 1.7 * carveFade;
        const k = idx(i, j);
        this.bedrock[k] -= carve;
        this.hardness[k] *= Math.max(0, 1 - carve * 1.5); // channel bed is soft
      }
    }

    // The dune ridges can otherwise leave a hump in the streambed that water can
    // never climb over. Force the channel centreline (and the band around it) to
    // keep a gentle, monotonic downhill gradient from source to sea.
    //
    // ROOT CAUSE of a reported "tooth/staircase" pattern along the stream banks
    // (confirmed live, tide-independent - present with the water mesh hidden
    // entirely, at any tide level, wherever the current waterline happens to sit
    // at the affected elevation): the original single-pass version below computed
    // each row's required drop from only the IMMEDIATELY PRECEDING row's ceiling,
    // then dumped the ENTIRE correction into that one row through the same narrow
    // Gaussian falloff the regular channel carve uses. Wherever a real dune ridge
    // crossed the channel steeply - confirmed live right at the stream's source,
    // where the channel is at its narrowest (width ~2.4 cells) - that whole
    // multi-metre correction landed on a single row instead of being spread over
    // the many rows a real streambank would gradually descend across. Measured
    // live: ~5m of height change compressed into ~1.2m of horizontal distance (a
    // ~77 degree wall, only a handful of fine-mesh vertices wide) - far steeper
    // than the fixed terrain mesh resolution can render as anything but a visible
    // stair-step under raking light. The SAME Gaussian cross-section width also
    // means a bigger single-row drop directly steepens that row's CROSS-CHANNEL
    // slope too (a deeper carve at the same lateral width = a steeper wall) -
    // which is exactly the "77 degree wall" being measured, not a separate effect.
    //
    // Fixed in three passes instead of one: first compute the exact same raw,
    // unsmoothed per-row target this always has (into a scratch array, without
    // touching the bedrock yet); then walk that array BACKWARD (sea toward
    // source) capping how far any one row's target may sit above the NEXT (more
    // seaward) row's already-finalised target - `MAX_DROP_PER_CELL` - pulling the
    // earlier row down to compensate wherever the raw jump would exceed it; only
    // then apply the (now gradual) result to the bedrock via the same Gaussian
    // falloff as before. Since the backward pass only ever makes a row's target
    // LOWER than the raw ratchet computed (never higher), it can't reintroduce a
    // hump or weaken the "always strictly downhill" guarantee this whole pass
    // exists for - it just spreads whatever single big drop the raw pass would
    // have produced back over as many preceding rows as it takes to keep every
    // step under the cap, so the SAME total elevation change happens over a much
    // longer, gentler run instead of one near-vertical wall.
    const MIN_DROP_PER_CELL = 0.006;
    // Caps the steepest a forced correction may descend in a single row. 0.05m
    // over one ~0.82m cell is a ~3.5 degree grade at the steepest single step -
    // even a hump needing several metres removed now does it gradually over
    // dozens of rows (tens of metres of actual channel length, invisible against
    // the stream's full source-to-sea run) rather than one near-vertical wall.
    const MAX_DROP_PER_CELL = 0.05;
    const centerHRaw = new Float32Array(GRID);
    const rawTarget = new Float32Array(GRID);
    {
      let ceiling = Infinity;
      for (let j = 0; j < GRID; j++) {
        const z = j * CELL;
        const cx = streamCenterX(z);
        const ci = cx / CELL;
        const centerK = idx(Math.round(THREE.MathUtils.clamp(ci, 0, GRID - 1)), j);
        const centerH = this.bedrock[centerK];
        const target = Math.min(centerH, ceiling);
        centerHRaw[j] = centerH;
        rawTarget[j] = target;
        ceiling = target - MIN_DROP_PER_CELL;
      }
    }
    const smoothedTarget = new Float32Array(GRID);
    smoothedTarget[GRID - 1] = rawTarget[GRID - 1];
    for (let j = GRID - 2; j >= 0; j--) {
      smoothedTarget[j] = Math.min(rawTarget[j], smoothedTarget[j + 1] + MAX_DROP_PER_CELL);
    }
    // Spreading the drop over more ROWS (above) only fixes the ALONG-channel
    // slope. Measured live it wasn't enough on its own: the CROSS-channel slope
    // (within a single row) was still ~80 degrees at a row where the centreline
    // itself now descends perfectly smoothly - because that slope is just
    // (how much depth needs removing here) / (the fixed carve width), and the
    // width this correction used was always the same narrow base channel width
    // regardless of how much depth it had to remove. A big correction and a
    // small one were being crammed through the identical lateral footprint, so
    // the big one was inevitably steeper. Widening the falloff in proportion to
    // the drop keeps the resulting slope roughly constant instead of growing
    // with depth - `1.5` is chosen so a drop as big as the base width itself
    // still resolves to close to the SAME cross-section slope the regular,
    // un-corrected channel carve already has everywhere else (so a corrected
    // stretch reads as "normal streambank", not "unusually wide" or "unusually
    // steep" relative to the rest of the channel).
    for (let j = 0; j < GRID; j++) {
      const drop = centerHRaw[j] - smoothedTarget[j];
      if (drop <= 1e-6) continue;
      const z = j * CELL;
      const cx = streamCenterX(z);
      const ci = cx / CELL;
      const width = Math.max(2.4 + 2.4 * (z / SIZE), drop * 1.5);
      const i0 = Math.max(0, Math.floor(ci - width * 1.8));
      const i1 = Math.min(GRID - 1, Math.ceil(ci + width * 1.8));
      for (let i = i0; i <= i1; i++) {
        const d = Math.abs(i - ci);
        const falloff = Math.exp(-Math.pow(d / width, 2));
        this.bedrock[idx(i, j)] -= drop * falloff;
      }
    }

    // The two passes above fix the ALONG-channel slope (row to row) and widen
    // the falloff in proportion to how big a correction THEY make - but measured
    // live, a steep CROSS-channel wall could still remain even at a row needing
    // almost no correction from either pass: the channel's fixed-width, fixed-
    // amplitude carve cuts through whatever natural dune/ridge terrain happens
    // to sit there, and wherever that surrounding ridge is unusually tall right
    // at the channel (a real, ordinary feature of the noise-based terrain, nothing
    // "wrong" with it on its own), the SAME narrow carve width produces a much
    // steeper bank than it does through ordinary, lower terrain nearby - confirmed
    // live at exactly such a spot: a ~76 degree cross-section where the centreline
    // itself was already perfectly smooth row-to-row, so neither pass above had
    // any reason to widen anything there.
    //
    // Rather than guess at which upstream cause produced a given steep bank, cap
    // the actual RESULTING cross-slope directly, symmetrically outward from the
    // centreline on each side, right after every other height-affecting pass
    // above has already run - this catches a steep wall regardless of whether it
    // came from the main carve, the ratchet correction, or the surrounding
    // terrain's own noise, without needing to special-case any of them. Chosen to
    // match (not tighten) the SAME slope the un-corrected channel carve already
    // produces everywhere else (~35-36 degrees, i.e. roughly 1 vertical to 1.4
    // horizontal) - a stretch this pass touches should read as an ordinary
    // streambank, not a visibly different (unusually gentle OR unusually wide)
    // one. Only ever lowers terrain (consistent with every other carving pass
    // here), so it can't reintroduce a hump.
    const MAX_CROSS_SLOPE = 0.7; // metres of height per metre of horizontal distance
    const maxStepPerCell = MAX_CROSS_SLOPE * CELL;
    for (let j = 0; j < GRID; j++) {
      const z = j * CELL;
      const cx = streamCenterX(z);
      const ci = Math.round(THREE.MathUtils.clamp(cx / CELL, 0, GRID - 1));
      const width = 2.4 + 2.4 * (z / SIZE);
      // Wide enough to reach past any bank this could plausibly have created,
      // narrow enough to never touch unrelated dune terrain far from the channel.
      const reach = Math.ceil(width * 4);
      // Walk outward from the centreline in both directions, capping each next
      // cell's height at (previous cell's, already-capped, height + max step) -
      // this can only ever pull a too-tall cell DOWN to the cap, never raise one.
      let prev = this.bedrock[idx(ci, j)];
      for (let i = ci + 1; i <= Math.min(GRID - 1, ci + reach); i++) {
        const k = idx(i, j);
        if (this.bedrock[k] > prev + maxStepPerCell) this.bedrock[k] = prev + maxStepPerCell;
        prev = this.bedrock[k];
      }
      prev = this.bedrock[idx(ci, j)];
      for (let i = ci - 1; i >= Math.max(0, ci - reach); i--) {
        const k = idx(i, j);
        if (this.bedrock[k] > prev + maxStepPerCell) this.bedrock[k] = prev + maxStepPerCell;
        prev = this.bedrock[k];
      }
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
          const sideBlendWidth = THREE.MathUtils.lerp(9, 20, THREE.MathUtils.smoothstep(t, L2_T_FALL1 - 0.02, L2_T_FALL1 + 0.05));
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

  // Level 3's terrain: a river forking around a small wooded island, downstream
  // of level 2's gorge. See the L3_* constants and l3*/streamCenterX helpers
  // above - the valley-floor elevation is an explicit, already-monotonic
  // function of t (l3FloorH below), same trick level2's floorH uses, so there's
  // no need for level1's separate downhill-ratchet/cross-slope-limiter passes:
  // a channel carved into an already-monotonic profile can't develop a hump.
  //
  // Per this session's own hard-won lessons: kept deliberately OPEN (a gentle
  // ~12m grade across the whole map, modest wall rise) rather than a walled
  // canyon - the only genuinely steep/dramatic feature is the mill race's own
  // small weir, and even that is a single ~1.6m step, not a cliff.
  _generateLevel3() {
    const l3FloorH = (t) => THREE.MathUtils.lerp(L3_TOP_H, L3_EXIT_H, t);

    for (let j = 0; j < GRID; j++) {
      for (let i = 0; i < GRID; i++) {
        const x = i * CELL, z = j * CELL;
        const t = z / SIZE;

        const baseX = l3BaseCenterX(z);
        const sepT = l3SeparationT(t);
        const mainX = baseX + sepT * L3_SEPARATION;
        const raceX = baseX - sepT * L3_SEPARATION;
        const floor = l3FloorH(t);

        // The mill race's own weir: a plateau (0 before, 1 through the weir and
        // its tailrace, back to 0 before the rejoin - see l3Plateau's comment)
        // that deepens the race channel's own carve amplitude, NOT a separate
        // "local floor" - deepening the carve (rather than dropping a whole
        // row's baseline) keeps the drop spatially localised to the race
        // channel itself via the same Gaussian falloff as the ordinary carve,
        // so it can't bleed sideways onto the island or the open floor between
        // the two channels.
        const weirT = l3Plateau(t, L3_T_WEIR, L3_WEIR_WIDTH, L3_T_REJOIN0 - 0.08, L3_T_REJOIN0);
        // The upstream rockslide blockage: a Gaussian bump in t (not a plateau -
        // it's a single localised pile of debris, not an ongoing feature),
        // shallowing the race channel's carve right where it sits. Clamped so
        // it can reduce the channel to a bare trickle-depth trench but never
        // fully invert/seal it outright.
        const sillT = Math.exp(-Math.pow((t - L3_T_SILL) / L3_SILL_WIDTH, 2));

        const dMain = Math.abs(x - mainX);
        const dRace = Math.abs(x - raceX);
        const carveMain = Math.exp(-Math.pow(dMain / L3_CHANNEL_HALFWIDTH, 2)) * L3_CHANNEL_DEPTH;
        const raceAmp = Math.max(0.15, L3_CHANNEL_DEPTH + weirT * L3_WEIR_DROP - sillT * L3_SILL_HEIGHT);
        const carveRace = Math.exp(-Math.pow(dRace / L3_CHANNEL_HALFWIDTH, 2)) * raceAmp;

        // The island: a low wooded rise sitting between the two channels,
        // gated by the same sepT profile that drives the fork itself (so it's
        // guaranteed to fade to exactly 0 outside the forked reach, never a
        // separate hard-edged shape) and by an elliptical falloff in x that
        // shrinks along with the available gap between the channels - it can
        // never overlap either channel's own carve.
        const islandAmp = L3_ISLAND_AMP * sepT;
        const islandHalfX = Math.max(0.5, L3_SEPARATION * sepT - L3_CHANNEL_HALFWIDTH * 2.0 - 3.5);
        const dIsland = (x - baseX) / islandHalfX;
        const islandBump = islandAmp * Math.max(0, 1 - dIsland * dIsland);

        // Gentle valley-wall rise, well clear of the river corridor (both
        // channels plus the island) - kept low per this session's own "get rid
        // of high embankments" note: caps at ~8m over a long taper, an order of
        // magnitude gentler than level2's canyon walls, mostly decorative.
        const corridorHalfExtent = L3_SEPARATION * sepT + L3_CHANNEL_HALFWIDTH * 2.2 + 4;
        const distFromCorridor = Math.max(0, Math.abs(x - baseX) - corridorHalfExtent);
        const wallRise = Math.pow(Math.min(1, distFromCorridor / 65), 0.6) * 8;

        const openFloor = floor + wallRise + islandBump;
        const mainSurface = floor - carveMain;
        const raceSurface = floor - carveRace;
        let h = Math.min(openFloor, mainSurface, raceSurface);

        // Fine dirt/detail noise - calmer right at the weir's own sheer-ish
        // drop (reads as a real small waterfall/millrace lip, not undulating
        // scree) than the open valley floor.
        const nearWeir = weirT > 0.3 && dRace < L3_CHANNEL_HALFWIDTH * 1.6 && Math.abs(t - L3_T_WEIR) < 0.03;
        const detail = n1.fbm(i * 0.05, j * 0.05, 4);
        h += detail * (nearWeir ? 0.5 : 1.8);

        this.bedrock[idx(i, j)] = h;

        // Hardness: soft, grassy river-valley dirt by default; the rockslide
        // sill itself (and, more gently, the weir's own lip) read as rubble/
        // rock; steep ground (see the slope-exposure pass below) hardens too.
        let hard = 0.1;
        const sillHardness = sillT * Math.exp(-Math.pow(dRace / (L3_CHANNEL_HALFWIDTH * 1.6), 2));
        hard = Math.max(hard, sillHardness * 0.82);
        const weirHardness = THREE.MathUtils.clamp(weirT, 0, 1) * Math.exp(-Math.pow(dRace / (L3_CHANNEL_HALFWIDTH * 1.3), 2));
        hard = Math.max(hard, weirHardness * 0.5);
        const outcrop = n2.fbm(i * 0.08, j * 0.08, 3);
        if (outcrop > 0.48) hard = Math.max(hard, (outcrop - 0.48) * 2.6);
        this.hardness[idx(i, j)] = Math.min(1, hard);
      }
    }

    // Bare rock/rubble wherever the ground is genuinely steep (same slope-
    // exposure technique as level1/level2's own passes) - excludes both
    // channel corridors themselves, which should stay soft, diggable riverbed.
    for (let j = 1; j < GRID - 1; j++) {
      const z = j * CELL;
      const t = z / SIZE;
      const baseX = l3BaseCenterX(z);
      const sepT = l3SeparationT(t);
      const mainX = baseX + sepT * L3_SEPARATION;
      const raceX = baseX - sepT * L3_SEPARATION;
      const corridorHalf = L3_CHANNEL_HALFWIDTH * 2.4;
      for (let i = 1; i < GRID - 1; i++) {
        const x = i * CELL;
        if (Math.abs(x - mainX) < corridorHalf || Math.abs(x - raceX) < corridorHalf) continue;
        const k = idx(i, j);
        const hL = this.bedrock[idx(i - 1, j)], hR = this.bedrock[idx(i + 1, j)];
        const hD = this.bedrock[idx(i, j - 1)], hU = this.bedrock[idx(i, j + 1)];
        const slope = (Math.abs(hR - hL) + Math.abs(hU - hD)) / (4 * CELL);
        this.hardness[k] = Math.max(this.hardness[k], Math.min(1, slope * 1.3));
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
    if (ACTIVE_LEVEL === 'level2') this._colorAtLevel2(fi, fj, h, slope, hardness, wet, disturbance, cavity, out);
    else if (ACTIVE_LEVEL === 'level3') this._colorAtLevel3(fi, fj, h, slope, hardness, wet, disturbance, cavity, out);
    else this._colorAtLevel1(fi, fj, h, slope, hardness, wet, disturbance, cavity, out);
  }

  // Lush water-meadow palette (greener/softer than level2's bare mountain
  // dirt-and-rock, matching a working valley around an old mill rather than a
  // sheer gorge) with rock only where the slope-exposure pass actually hardened
  // the ground, and the rockslide sill/weir reading as distinct pale rubble.
  _colorAtLevel3(fi, fj, h, slope, hardness, wet, disturbance, cavity, out) {
    const P = this._pal;
    const fx = fi / RENDER_SUBDIV, fz = fj / RENDER_SUBDIV;

    const grassWarmth = THREE.MathUtils.clamp((n2.fbm(fx * 0.1 + 700, fz * 0.1 + 700, 3) - 0.1) * 1.5, 0, 1);
    const grassTone = this._cGrass.copy(P.grass).lerp(P.grassWarm, grassWarmth);
    const base = this._cBase.copy(P.dirt).lerp(grassTone, 0.6);
    base.lerp(P.dryGrass, 0.1);

    const mossNoise = n1.fbm(fx * 0.12 + 200, fz * 0.12 + 200, 3);
    const mossPatch = THREE.MathUtils.clamp((mossNoise - 0.15) * 2.0, 0, 1) * THREE.MathUtils.clamp(1 - slope * 2.0, 0, 1) * (1 - hardness * 0.7);
    base.lerp(P.moss, mossPatch * 0.5);

    const rockExposure = THREE.MathUtils.clamp(hardness * (0.3 + slope * 1.6), 0, 1);
    const rockTone = this._cTone.copy(P.rockMid).lerp(P.rockLight, 0.4);
    rockTone.lerp(P.rockDark, THREE.MathUtils.clamp(wet * 1.2, 0, 1) * 0.4);
    base.lerp(rockTone, rockExposure);
    if (rockExposure > 0.15) {
      const strataPhase = fi * FINE_CELL * 0.9 + h * 1.6;
      const strata = Math.sin(strataPhase) * 0.5 + 0.5;
      base.lerp(P.rockDark, strata * 0.35 * rockExposure);
      base.lerp(P.rockLight, (1 - strata) * 0.15 * rockExposure);
    }
    base.lerp(P.rockDark, THREE.MathUtils.clamp((slope - 0.45) * 1.0, 0, 1) * 0.6);

    const wetT = THREE.MathUtils.clamp(wet, 0, 1);
    base.lerp(P.mud, wetT * 0.8);

    const distT = THREE.MathUtils.clamp(disturbance, 0, 1);
    if (cavity > 0) base.lerp(P.turnedSandDug, distT * 0.8);
    else base.lerp(P.turnedSand, distT * 0.75);
    if (cavity > 0) base.multiplyScalar(1 - Math.min(1, cavity) * 0.5);
    else base.multiplyScalar(1 - cavity * 0.24);

    out.copy(base);
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

  _colorAtLevel1(fi, fj, h, slope, hardness, wet, disturbance, cavity, out) {
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

    // The two headlands are NOT symmetric in reality, but not for the reason
    // first assumed here: a real river finds the LOWEST ground, it doesn't cut
    // a narrow gap through the tallest cliff - the land is low and gentle right
    // around the stream's mouth precisely BECAUSE that's where it drains. The
    // dramatic dark, jagged, fractured rock cliff is the OTHER headland, well
    // clear of the stream, unrelated to drainage. This was tied to absolute
    // north/south position before (assuming the stream's own end was the rocky
    // one), which is exactly backwards - now tied to actual distance from the
    // stream's real path. The hardness field itself (headland + outcrop +
    // slope-exposure, all baked together in _generate()) stays untouched here -
    // that field also feeds water.js's erosion/flux - this only biases how much
    // of that hardness actually SHOWS as bare rock vs. how far grass is allowed
    // to creep down the slope, purely a display decision. rockAllow: low near
    // the stream (most would-be rock repainted as grass below), 1.0 well clear
    // of it (full rock, unchanged).
    const distFromStreamHere = Math.abs(fx * CELL - streamCenterX(fz * CELL));
    const nearStreamT = THREE.MathUtils.clamp(1 - distFromStreamHere / 34, 0, 1);
    const nearStreamSmooth = nearStreamT * nearStreamT * (3 - 2 * nearStreamT);
    const rockAllow = 0.22 + 0.78 * (1 - nearStreamSmooth);
    const southGrassBoost = 1 - rockAllow; // how much extra grass-friendliness the low ground near the stream gets

    const grassPatch = THREE.MathUtils.clamp((n1.fbm(fx * 0.15 + 300, fz * 0.15 + 300, 3) - 0.1) * 2.4, 0, 1);
    const clifftopHeightThresh = 4.5 - 3.2 * southGrassBoost; // grass starts much lower up the south hill
    const clifftopSlopeTol = 2.6 - 1.9 * southGrassBoost;     // and tolerates a steeper slope there too
    const clifftopGrass = THREE.MathUtils.clamp((h - clifftopHeightThresh) / 3.5, 0, 1)
      * THREE.MathUtils.clamp(1 - slope * clifftopSlopeTol, 0, 1) * grassPatch;
    base.lerp(grassTone, clifftopGrass * 0.9);

    const rockExposure = THREE.MathUtils.clamp(hardness * (0.2 + slope * 1.8), 0, 1) * rockAllow;
    const rockHeightT = THREE.MathUtils.clamp((h - 2) / 9, 0, 1);
    const rockTone = this._cTone.copy(P.rockMid).lerp(P.rockLight, rockHeightT * 0.8).lerp(P.rockDark, (1 - rockHeightT) * 0.5);
    // Rock exposed low down, where `wet` (the water sim's own moisture field) runs
    // high, reads as genuinely dark, wet slate - not the same flat brown-grey as
    // the dry rock higher up the cliff face.
    rockTone.lerp(P.rockDark, THREE.MathUtils.clamp(wet * 1.3, 0, 1) * 0.45);
    base.lerp(rockTone, rockExposure);
    if (rockExposure > 0.15) {
      // Fine, closely-spaced diagonal strata - real sedimentary slate here reads
      // as thin, tightly-packed layering (like a stack of paper), not big,
      // widely-spaced alternating blobs - the old 0.32/2.6 frequency was low
      // enough to read as a handful of fat bands per cliff face rather than
      // dozens of thin ones, a real and specific mismatch against the photos.
      //
      // CAUGHT AND FIXED (verified with shadows forced off, so it wasn't
      // shadow acne): pushing the HEIGHT term's coefficient up to match (7.5,
      // scaling with x's 0.95) aliased into an ugly regular checkerboard on
      // any near-vertical cliff face - a steep slope can change many metres of
      // height over one ~0.2m fine-mesh vertex step, so a phase term that
      // multiplies raw height by anything large enough to matter completes
      // several full sine cycles between adjacent vertices, which is
      // undersampling/moire, not banding. The x term alone (well resolved,
      // since x changes slowly and smoothly per vertex regardless of slope)
      // already gives the fine, closely-spaced look; height's coefficient is
      // kept small here so it only adds a gentle diagonal tilt, never enough
      // cycles-per-vertex to alias even on a sheer face.
      const strataPhase = fi * FINE_CELL * 0.95 + h * 1.7;
      const strata = Math.sin(strataPhase) * 0.5 + 0.5;
      base.lerp(P.rockDark, strata * 0.4 * rockExposure);
      // Alternate bands lighten toward the dry, higher-up rock tone instead of
      // every band only ever darkening - real sedimentary strata reads as
      // alternating light/dark banding, not a one-directional smudge. Gated by
      // rockHeightT so this light band only shows through on the drier rock
      // higher up; wet rock near the waterline stays uniformly dark.
      base.lerp(P.rockLight, (1 - strata) * 0.18 * rockExposure * rockHeightT);
      // The fine secondary layer needs its OWN higher x-frequency, not the
      // whole phase (x term AND height term together) multiplied up - doing
      // that to the height term is exactly what caused the aliasing above,
      // just at 3.4x the severity.
      const fineStrataPhase = fi * FINE_CELL * 3.4 + h * 2.3 + 1.4;
      const fineStrata = Math.sin(fineStrataPhase) * 0.5 + 0.5;
      base.lerp(P.rockDark, fineStrata * 0.16 * rockExposure);
    }
    base.lerp(P.rockDark, THREE.MathUtils.clamp((slope - 0.45) * 1.0, 0, 1) * 0.78 * rockAllow);

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
