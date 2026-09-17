import * as THREE from '../vendor/three.module.js';
import {
  Terrain, SIZE, GRID, CELL, streamCenterX, idx,
  setActiveLevel, L2_LIP_X, L2_T_FALL1,
} from './terrain.js?v=106';
import { WaterSim } from './water.js?v=106';
import {
  buildSky, buildOcean, scatterProps, buildBirds, buildSkirt, buildVillage,
  buildSkirtLevel2, scatterPropsLevel2, buildWaterfallCascade,
} from './environment.js?v=106';
import { scatterRocks, Rock } from './rocks.js?v=106';
import { Player } from './player.js?v=106';
import { AudioSystem } from './audio.js?v=106';
import { Particles } from './particles.js?v=106';
import { Debris } from './debris.js?v=106';
import { saveState, loadSavedData, applySavedData, clearSave } from './save.js?v=106';
import { buildHiddenDoor } from './hidden-door.js';
import { buildMillValley } from './mill.js';
import { Bulldozer, Excavator } from './vehicles.js?v=106';

// ---------- level selection ----------
// index.html/artifact.html's inline bootstrap script picks a level (a simple
// level-select screen, shown before this module ever loads) and stores it
// here before appending this <script type=module> - so by the time this runs,
// a level is always already chosen. setActiveLevel() must run before
// `new Terrain()`/`new WaterSim()` below - both read it synchronously once,
// at construction time (see terrain.js's own comment on ACTIVE_LEVEL).
const ACTIVE_LEVEL_ID = localStorage.getItem('shoreline_active_level') || 'level1';
setActiveLevel(ACTIVE_LEVEL_ID);

// Bumped alongside every ?v=N cache-bust across the project (see version.txt,
// fetched below) - mobile Safari in particular can keep an old tab's JS
// running indefinitely across app-switches/backgrounding with no new network
// request at all (it's a suspended tab, not a cache-header problem, so no
// amount of server-side cache-busting reaches it) - the only way a long-lived
// tab ever picks up a fix is to actually reload. Checked whenever the tab
// becomes visible again (see checkForUpdate below), which is exactly when a
// player is starting a new session anyway, not interrupting one mid-action.
const APP_VERSION = 106;

// ---------- renderer / scene / camera ----------

const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
// Slightly down from 1.18 - the old exposure was washing out the richer, more
// saturated palette below (everything read a bit bleached/flat regardless of
// what colour was actually painted on it).
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xcfe0dd, 70, 420);

const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 1600);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- lighting ----------

// Soft coastal-daylight setup: cooler sky fill against a warmer sun reads much
// richer than a single neutral wash over everything (and gives the vertex-colour
// palette in terrain.js/environment.js something to actually contrast against).
// Hemi intensity brought down from 0.85 - that much flat ambient fill was
// competing with the sun and softening every shadow/AO cue into a flat wash,
// which is a big part of what read as "flat" to begin with.
const hemi = new THREE.HemisphereLight(0xaad2ea, 0x776a45, 0.7);
scene.add(hemi);

// Fill light: a real Cornish coast (see the reference photos this pass was
// re-graded against) is almost always shot under a bright, heavily overcast
// sky - soft, near-omnidirectional light with no hard black shadows anywhere,
// even in a cliff's own gullies. This engine's single hard sun + 0.6 hemi
// wasn't enough fill for that: any cliff face angled away from the sun (most
// of the north headland, whose exposed rock face points inland/away from
// sunDir) fell to almost pure black - losing all of terrain.js's strata/
// colour work entirely, not just darkening it. A second, dim, shadowless
// directional light from roughly the opposite side stands in for that
// scattered overcast skylight/bounce without adding a second hard shadow.
const fill = new THREE.DirectionalLight(0xcfe3ea, 0.85);
fill.position.set(-0.4, 0.6, -0.3);
fill.castShadow = false;
scene.add(fill);

// Sun brought up correspondingly (hemi's fill dropped) and warmed slightly - a
// warm key light against the cooler sky fill is what actually separates grass/
// rock/sand tonally instead of everything reading under the same flat wash.
const sun = new THREE.DirectionalLight(0xffe6b8, 2.15);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 90;
sun.shadow.camera.left = -34;
sun.shadow.camera.right = 34;
sun.shadow.camera.top = 34;
sun.shadow.camera.bottom = -34;
sun.shadow.bias = -0.0015;
// Reduces shadow-acne/peter-panning on the fine mesh's own bumpy micro-normals
// (see terrain.js's fine detail noise) without softening genuine contact shadows
// the way a larger bias would - those contact shadows at cliff bases and rock
// cavities are one of the main cues that was reading flat before.
sun.shadow.normalBias = 0.02;
scene.add(sun);
scene.add(sun.target);

// Slightly lower sun angle than before (more raking, less straight-down) so
// grass blades, rock strata and cliff faces actually pick up modelling shadows
// instead of the flatter look a near-overhead sun gives low-relief geometry.
const sunDir = new THREE.Vector3(0.5, 0.72, 0.47).normalize();

// ---------- world ----------

const terrain = new Terrain();
scene.add(terrain.mesh);

const water = new WaterSim(terrain);
scene.add(water.mesh);

const sky = buildSky(scene);
// Level 2 has no sea - the water sim's own mesh already covers its still lake
// (see terrain.js's coastT/L2_LAKE_T0) - so skip the distant-ocean backdrop
// plane and add the waterfall's own decorative cascade instead.
let ocean = null, cascade = null;
if (ACTIVE_LEVEL_ID === 'level2') {
  cascade = buildWaterfallCascade(terrain);
  scene.add(cascade.mesh);
} else if (ACTIVE_LEVEL_ID === 'level1') {
  ocean = buildOcean(water.uniforms);
  scene.add(ocean.mesh);
}

const birds = buildBirds(scene);

// A save carries its own rock positions/orientations (they're as much "player
// work" as dug sand - pushing rocks to redirect the stream is a core mechanic),
// so a restored game skips the random scatter and rebuilds the exact rocks the
// player left behind instead. Each level has its own independent save slot
// (see save.js's keyFor) so switching levels never overwrites the other's progress.
const savedData = loadSavedData(ACTIVE_LEVEL_ID);

const rocks = savedData && Array.isArray(savedData.rocks)
  ? savedData.rocks.map((rd) => {
      const r = new Rock(rd.x, rd.z, rd.size, terrain);
      if (rd.q) r.mesh.quaternion.set(rd.q[0], rd.q[1], rd.q[2], rd.q[3]);
      scene.add(r.mesh);
      return r;
    })
  : scatterRocks(terrain, scene, 46);

// Hard guarantee, independent of the placement odds above: the stream must never be
// fully dammed. Walk every row and if every cell across the channel's width ended up
// blocked, forcibly clear the one closest to the centreline so there's always a gap.
{
  let unblocked = 0;
  for (let j = 0; j < GRID; j++) {
    const z = j * CELL;
    const ci = streamCenterX(z) / CELL;
    const halfWidthCells = (2.4 + 2.4 * (z / SIZE)) * 1.6;
    const i0 = Math.max(0, Math.floor(ci - halfWidthCells));
    const i1 = Math.min(GRID - 1, Math.ceil(ci + halfWidthCells));
    let allBlocked = true;
    let closestI = Math.round(ci), closestD = Infinity;
    for (let i = i0; i <= i1; i++) {
      if (!terrain.blocked[idx(i, j)]) { allBlocked = false; break; }
      const d = Math.abs(i - ci);
      if (d < closestD) { closestD = d; closestI = i; }
    }
    if (allBlocked && i1 >= i0) {
      terrain.blocked[idx(closestI, j)] = 0;
      unblocked++;
    }
  }
  if (unblocked > 0) console.warn(`[shoreline] cleared ${unblocked} channel-blocking cell(s) to guarantee the stream stays open`);
}

const player = new Player(terrain);
scene.add(player.mesh);
if (savedData) player.setSpawn(savedData.playerX, savedData.playerZ);
else if (ACTIVE_LEVEL_ID === 'level3') player.setSpawn(76, 60);
else if (ACTIVE_LEVEL_ID === 'level2') player.setSpawn(L2_LIP_X + 7, (L2_T_FALL1 + .045) * SIZE); // just below the falls' landing pool
else player.setSpawn(SIZE * 0.72 - 6, SIZE * 0.22);

const particles = new Particles(scene, 320);
const debris = new Debris(scene, terrain, water);

const audio = new AudioSystem();

if (savedData) {
  // Restore dug/piled terrain and the water's own depth/sediment/tide state -
  // skip the fresh-level priming below entirely, since this already IS a real
  // simulated state (whatever the player left it in).
  applySavedData(savedData, terrain, water);
  terrain.markDirty();
  terrain.update(0);
  terrain.refreshFineMeshFully();
  water._syncMeshAttrs(terrain);
} else {
  // Pre-simulate the water system before the player ever sees it, so the stream
  // is already in a flowing steady state on arrival rather than filling from dry.
  const PRIME_SECONDS = 40;
  const steps = Math.round(PRIME_SECONDS / water.stepDt);
  for (let s = 0; s < steps; s++) {
    water._step(water.stepDt, terrain);
    water.elapsed += water.stepDt;
  }
  terrain.markDirty();
  terrain.update(0);
  // 40 simulated seconds of erosion/sediment/moisture drift just happened before
  // the player ever sees the level - force the fine render mesh fully in sync
  // right away rather than waiting for the background scan (see terrain.js
  // update()) to cycle all the way around.
  terrain.refreshFineMeshFully();
  water._syncMeshAttrs(terrain);
}

// Placed AFTER priming/restore (not right after construction) - these sample
// live terrain height, and priming runs real erosion/slumping for up to 40
// simulated seconds (see the sand-slumping pass added to fix the stream-bank
// staircase). Placing decoration first meant grass/pebbles near the banks
// were pinned to the PRE-erosion height, then the ground moved out from
// under them during priming - "grass floating in the air" by the river.
let villageDoor = null;
let mill = null;
let waterfallDoor = null;
if (ACTIVE_LEVEL_ID === 'level3') {
  mill = buildMillValley(terrain, water);
  scene.add(mill.group);
} else if (ACTIVE_LEVEL_ID === 'level2') {
  scene.add(buildSkirtLevel2(terrain));
  scene.add(scatterPropsLevel2(terrain));
  waterfallDoor = buildHiddenDoor(terrain);
  scene.add(waterfallDoor.group);
} else {
  scene.add(buildSkirt(terrain));
  const village = buildVillage(terrain);
  scene.add(village.group);
  villageDoor = village.door;
  scene.add(scatterProps(terrain));
}

// ---------- vehicles ----------

// A bulldozer and an excavator, parked for the player to walk up to, get in,
// and drive - see vehicles.js for the actual driving/digging model. Placement
// here is deliberately the ONLY Level-1-specific thing about them: vehicles.js
// itself never reads this level's coordinates or coastline shape, so dropping
// them into the Level 2 world later is just a matter of calling createVehicle
// with different spawn coordinates, not touching vehicles.js at all.
function createVehicle(type, x, z, heading, terrainRef) {
  const v = type === 'excavator' ? new Excavator(x, z, heading, terrainRef) : new Bulldozer(x, z, heading, terrainRef);
  scene.add(v.mesh);
  return v;
}

// Finds a flat, unblocked, stream-clear spot for each vehicle - the same kind
// of candidate-search buildVillage()/scatterRocks() already use, rather than
// a bare hardcoded coordinate, so a future terrain tweak here can't strand a
// vehicle half-buried or floating. The candidate box itself is level-gated:
// construction equipment only belongs in the gorge's own working valley
// floor, not the coastal village - level 1 never calls this any more (see
// the `vehicles` const below).
function placeVehicles(terrainRef) {
  if (ACTIVE_LEVEL_ID === 'level3') return [createVehicle('excavator', 64, 40, Math.PI, terrainRef), createVehicle('bulldozer', 47, 38, Math.PI, terrainRef)];
  const specs = [
    { type: 'bulldozer', heading: Math.PI * 0.12 },
    { type: 'excavator', heading: -Math.PI * 0.22 },
  ];
  // Level 2's working stretch runs from the landing pool (t~0.20) down to the
  // lake (t~0.90) - centred well inside that, clear of both the waterfall
  // spray and the lake shore, spanning most of the valley's own width so the
  // search has real room to find flat ground beside the river. The valley
  // floor itself is a steady slope (not flat like level 1's village), so
  // rather than reject candidates against a fixed flatness threshold - which
  // can end up with nothing qualifying at all - score every candidate and
  // keep the flattest one seen.
  const zLo = SIZE * 0.30, zHi = SIZE * 0.55;
  const xLo = SIZE * 0.20, xHi = SIZE * 0.80;
  const chosen = [];
  for (const spec of specs) {
    let best = null;
    for (let attempt = 0; attempt < 120; attempt++) {
      const cx = xLo + Math.random() * (xHi - xLo);
      const cz = zLo + Math.random() * (zHi - zLo);
      if (Math.abs(cx - streamCenterX(cz)) < 14) continue; // stay well clear of the stream/river corridor
      if (terrainRef.blocked[idx(Math.round(cx / CELL), Math.round(cz / CELL))]) continue;
      let tooClose = false;
      for (const p of chosen) { if (Math.hypot(p.x - cx, p.z - cz) < 6) { tooClose = true; break; } }
      if (tooClose) continue;
      const hC = terrainRef.sampleHeightBilinear(cx, cz);
      const hL = terrainRef.sampleHeightBilinear(cx - 1.6, cz);
      const hR = terrainRef.sampleHeightBilinear(cx + 1.6, cz);
      const hF = terrainRef.sampleHeightBilinear(cx, cz - 1.6);
      const hB = terrainRef.sampleHeightBilinear(cx, cz + 1.6);
      const spread = Math.max(hC, hL, hR, hF, hB) - Math.min(hC, hL, hR, hF, hB);
      if (!best || spread < best.spread) best = { x: cx, z: cz, spread };
      if (best.spread < 0.5) break; // good enough, stop searching
    }
    chosen.push(best || { x: SIZE * 0.5, z: SIZE * 0.4 });
  }
  return specs.map((spec, i) => createVehicle(spec.type, chosen[i].x, chosen[i].z, spec.heading, terrainRef));
}

// Construction equipment only belongs in the gorge (level 2) - a hand-shovel
// coastal sandbox has no business with a bulldozer parked on the beach.
const vehicles = ACTIVE_LEVEL_ID === 'level1' ? [] : (
  savedData && Array.isArray(savedData.vehicles) && savedData.vehicles.length
    ? savedData.vehicles.map((vd) => createVehicle(vd.type, vd.x, vd.z, vd.heading, terrain))
    : placeVehicles(terrain)
);

// The single vehicle the player currently occupies, or null when on foot.
let drivingVehicle = null;
let savedCamDistTarget = null;

// ---------- input ----------

const keys = new Set();
let running = false;
const NAV_KEYS = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
window.addEventListener('keydown', (e) => {
  if (NAV_KEYS.has(e.code)) e.preventDefault(); // don't scroll the page or activate a focused button
  keys.add(e.code);
  ensureAudioStarted();
  if (e.code === 'KeyE') tryInteract();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));

const mouse = { x: 0, y: 0, ndcX: 0, ndcY: 0, left: false, right: false };
const touch = { x: 0, y: 0, run: false };
const canvas = renderer.domElement;
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerdown', (e) => {
  ensureAudioStarted();
  if (e.button === 0) mouse.left = true;
  if (e.button === 2) mouse.right = true;
  // Excavator digging is driven centrally by computeVehicleControls()'s
  // digHeld/digPressed each frame (holding now repeats the whole dig cycle -
  // requestDig() itself no-ops while one is already running) - no separate
  // trigger needed here any more.
});
window.addEventListener('pointerup', (e) => {
  if (e.button === 0) mouse.left = false;
  if (e.button === 2) mouse.right = false;
});
window.addEventListener('pointermove', (e) => {
  mouse.x = e.clientX; mouse.y = e.clientY;
  mouse.ndcX = (e.clientX / window.innerWidth) * 2 - 1;
  mouse.ndcY = -(e.clientY / window.innerHeight) * 2 + 1;
});

function ensureAudioStarted() {
  if (!audio.started) audio.start();
}

// ---------- touch controls (mobile) ----------

const isTouchDevice = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
if (isTouchDevice) document.body.classList.add('touch');

let touchDigHeld = false, touchSmoothHeld = false;

const joystickZone = document.getElementById('joystickZone');
const joystickBase = document.getElementById('joystickBase');
const joystickThumb = document.getElementById('joystickThumb');
const JOY_RADIUS = 54;
let joystickId = null, joystickCx = 0, joystickCy = 0;

joystickZone.addEventListener('pointerdown', (e) => {
  if (joystickId !== null) return;
  joystickId = e.pointerId;
  ensureAudioStarted();
  joystickCx = e.clientX; joystickCy = e.clientY;
  joystickBase.style.left = `${joystickCx - 54}px`;
  joystickBase.style.top = `${joystickCy - 54}px`;
  joystickBase.style.display = 'block';
  joystickThumb.style.left = `${joystickCx - 23}px`;
  joystickThumb.style.top = `${joystickCy - 23}px`;
  joystickThumb.style.display = 'block';
  try { joystickZone.setPointerCapture(e.pointerId); } catch { /* pointer already gone - harmless */ }
});
joystickZone.addEventListener('pointermove', (e) => {
  if (e.pointerId !== joystickId) return;
  const dx = e.clientX - joystickCx, dy = e.clientY - joystickCy;
  const dist = Math.hypot(dx, dy);
  const clamped = Math.min(dist, JOY_RADIUS);
  const angle = Math.atan2(dy, dx);
  const tx = Math.cos(angle) * clamped, ty = Math.sin(angle) * clamped;
  joystickThumb.style.left = `${joystickCx + tx - 23}px`;
  joystickThumb.style.top = `${joystickCy + ty - 23}px`;
  touch.x = tx / JOY_RADIUS;
  touch.y = ty / JOY_RADIUS;
  // Used to auto-trigger run past 80% of the joystick's radius - but `dist` is
  // the RAW, unclamped distance from the initial touch-down point, which keeps
  // growing even after the visible thumb maxes out at the edge if a finger
  // drifts further during play. On a real touchscreen that threshold (43px)
  // is so easily and persistently exceeded by ordinary directional input that
  // sprint read as "always on" - reported directly: "sprint seems to be
  // always enabled for mobile". Removed - the dedicated Sprint button is the
  // only way to sprint on touch now, same as Space bar is the only way on
  // keyboard, no ambiguous implicit trigger.
});
function joystickEnd(e) {
  if (e.pointerId !== joystickId) return;
  joystickId = null;
  touch.x = 0; touch.y = 0; touch.run = false;
  joystickBase.style.display = 'none';
  joystickThumb.style.display = 'none';
}
joystickZone.addEventListener('pointerup', joystickEnd);
joystickZone.addEventListener('pointercancel', joystickEnd);

// The rest of the screen: drag to look around (a twin-stick layout - left thumb
// moves, this side turns the camera), the way most mobile third-person games work.
// Digging/smoothing live on their own hold buttons below, auto-aimed at wherever
// the player is currently facing - no separate "aim precisely with your finger"
// step, which was confusing (a mode toggle that didn't itself do anything).
const digZone = document.getElementById('digZone');
let lookId = null, lookLastX = 0;
digZone.addEventListener('pointerdown', (e) => {
  if (lookId !== null) return;
  lookId = e.pointerId;
  ensureAudioStarted();
  lookLastX = e.clientX;
  try { digZone.setPointerCapture(e.pointerId); } catch { /* pointer already gone - harmless */ }
});
digZone.addEventListener('pointermove', (e) => {
  if (e.pointerId !== lookId) return;
  const dx = e.clientX - lookLastX;
  lookLastX = e.clientX;
  camYaw -= dx * 0.008;
});
function lookEnd(e) {
  if (e.pointerId !== lookId) return;
  lookId = null;
}
digZone.addEventListener('pointerup', lookEnd);
digZone.addEventListener('pointercancel', lookEnd);

function bindHoldButton(id, onDown, onUp) {
  const el = document.getElementById(id);
  el.addEventListener('pointerdown', (e) => { e.preventDefault(); ensureAudioStarted(); onDown(); });
  el.addEventListener('pointerup', (e) => { e.preventDefault(); onUp(); });
  el.addEventListener('pointercancel', onUp);
  el.addEventListener('pointerleave', onUp);
  return el;
}
const digBtnEl = document.getElementById('digBtn');
const smoothBtnEl = document.getElementById('smoothBtn');
bindHoldButton('digBtn',
  // touchDigHeld drives all three: the hand shovel's hold-to-scoop, the
  // excavator's hold-to-repeat dig cycle, and the bulldozer's blade toggle
  // (via computeVehicleControls()'s digHeld/digPressed) - one physical
  // button, interpreted per context rather than special-cased here.
  () => { touchDigHeld = true; digBtnEl.classList.add('active'); },
  () => { touchDigHeld = false; digBtnEl.classList.remove('active'); });
bindHoldButton('smoothBtn',
  () => { touchSmoothHeld = true; smoothBtnEl.classList.add('active'); },
  () => { touchSmoothHeld = false; smoothBtnEl.classList.remove('active'); });

const interactBtn = document.getElementById('interactBtn');
interactBtn.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  ensureAudioStarted();
  tryInteract();
});

// Hold-to-sprint, on top of the joystick's own push-further-to-run.
const sprintBtn = document.getElementById('sprintBtn');
let sprintHeld = false;
sprintBtn.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  sprintHeld = true;
  sprintBtn.classList.add('active');
});
function sprintRelease(e) {
  e.preventDefault();
  sprintHeld = false;
  sprintBtn.classList.remove('active');
}
sprintBtn.addEventListener('pointerup', sprintRelease);
sprintBtn.addEventListener('pointercancel', sprintRelease);
sprintBtn.addEventListener('pointerleave', sprintRelease);

document.getElementById('zoomInBtn').addEventListener('pointerdown', (e) => {
  e.preventDefault();
  camDistTarget = THREE.MathUtils.clamp(camDistTarget - 4, 6, 150);
});
document.getElementById('zoomOutBtn').addEventListener('pointerdown', (e) => {
  e.preventDefault();
  camDistTarget = THREE.MathUtils.clamp(camDistTarget + 4, 6, 150);
});

// ---------- camera controller ----------

const DEFAULT_DIST = ACTIVE_LEVEL_ID === 'level3' ? 64 : 38;
const INTRO_START_DIST = 95;
const INTRO_DURATION = 2.8;

let camYaw = Math.PI;
let camDistTarget = DEFAULT_DIST;
let camDist = INTRO_START_DIST;
let introTimer = 0;
const camPitch = THREE.MathUtils.degToRad(46);
const camLookOffset = new THREE.Vector3(0, 1.1, 0);

function easeInOutCubic(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

canvas.addEventListener('wheel', (e) => {
  camDistTarget = THREE.MathUtils.clamp(camDistTarget + e.deltaY * 0.05, 6, 150);
}, { passive: true });

function updateCamera(dt) {
  // Whatever the player currently controls - on foot, or a vehicle they've
  // driven into - exposes the same { pos, facing } shape (see vehicles.js),
  // so the camera doesn't need to know or care which one it's following.
  const camSubject = drivingVehicle || player;

  if (keys.has('KeyQ')) camYaw += dt * 1.4;
  if (keys.has('BracketLeft')) camYaw += dt * 1.4;
  if (keys.has('BracketRight')) camYaw -= dt * 1.4;

  // gentle auto-orientation behind the subject so the view mostly self-corrects
  const desired = camSubject.facing + Math.PI;
  let diff = desired - camYaw;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff));
  camYaw += diff * Math.min(1, dt * 0.35);

  if (introTimer < INTRO_DURATION) {
    introTimer += dt;
    const t = easeInOutCubic(Math.min(1, introTimer / INTRO_DURATION));
    camDist = THREE.MathUtils.lerp(INTRO_START_DIST, camDistTarget, t);
  } else {
    camDist += (camDistTarget - camDist) * Math.min(1, dt * 4);
  }

  const target = camSubject.pos.clone().add(camLookOffset);
  const offset = new THREE.Vector3(
    Math.sin(camYaw) * Math.cos(camPitch) * camDist,
    Math.sin(camPitch) * camDist,
    Math.cos(camYaw) * Math.cos(camPitch) * camDist,
  );
  const desiredPos = target.clone().add(offset);
  camera.position.lerp(desiredPos, Math.min(1, dt * 6));
  camera.lookAt(target);

  sun.position.copy(camSubject.pos).add(sunDir.clone().multiplyScalar(30));
  sun.target.position.copy(camSubject.pos);
}

// ---------- movement vector ----------

const raycaster = new THREE.Raycaster();
const moveVector = new THREE.Vector3();

function computeMoveVector() {
  let ix = 0, iz = 0;
  if (keys.has('KeyW') || keys.has('ArrowUp')) iz -= 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) iz += 1;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) ix -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) ix += 1;
  ix += touch.x; iz += touch.y;
  moveVector.set(ix, 0, iz);
  if (moveVector.lengthSq() > 1) moveVector.normalize();
  // rotate into camera space (camera yaw around Y)
  const forward = new THREE.Vector3(Math.sin(camYaw + Math.PI), 0, Math.cos(camYaw + Math.PI));
  const right = new THREE.Vector3(-forward.z, 0, forward.x);
  const world = new THREE.Vector3()
    .addScaledVector(right, moveVector.x)
    .addScaledVector(forward, -moveVector.z);
  if (world.lengthSq() > 1) world.normalize();
  return world;
}

// ---------- shovel target ----------

function getShovelTarget() {
  raycaster.setFromCamera({ x: mouse.ndcX, y: mouse.ndcY }, camera);
  // Raycast the coarse invisible pick proxy, not the fine rendered mesh - three.js's
  // core raycaster has no BVH (linear in triangle count), and the rendered mesh is
  // ~16x denser than before. Only x/z from the hit matter here (see below), so the
  // coarse proxy's lower-fidelity y is irrelevant.
  const hit = raycaster.intersectObject(terrain.pickMesh, false)[0];
  if (!hit) return null;
  const point = hit.point;
  const dx = point.x - player.pos.x, dz = point.z - player.pos.z;
  const dist = Math.sqrt(dx * dx + dz * dz);
  if (dist > player.reach) {
    const s = player.reach / dist;
    point.x = player.pos.x + dx * s;
    point.z = player.pos.z + dz * s;
  }
  return point;
}

// ---------- rock interaction ----------

const PLAYER_RADIUS = 0.4;
let nearbySmallRock = null;
const _rollAxis = new THREE.Vector3();
const _rollQuat = new THREE.Quaternion();

function findNearbySmallRock() {
  let best = null, bestD = Infinity;
  for (const r of rocks) {
    if (r.carried || r.size !== 'small') continue;
    const dx = r.x - player.pos.x, dz = r.z - player.pos.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d < player.pickupRange && d < bestD) { bestD = d; best = r; }
  }
  return best;
}

let lastInteractAt = 0;
function tryInteract() {
  // Debounced: on touch, a single physical tap can sometimes generate more than
  // one pointerdown-equivalent event (platform/browser quirks vary) - without this,
  // a "double-fire" toggles pick-up-then-drop in the same gesture and looks like
  // the button randomly does nothing.
  const now = performance.now();
  if (now - lastInteractAt < 350) return;
  lastInteractAt = now;

  if (drivingVehicle) {
    exitVehicle();
    return;
  }

  if (player.carriedRock) {
    const p = player.aheadPoint(0.9);
    player.carriedRock.putDown(
      THREE.MathUtils.clamp(p.x, 0.5, SIZE - 0.5),
      THREE.MathUtils.clamp(p.z, 0.5, SIZE - 0.5),
      terrain,
    );
    audio.rockScrape();
    hints.trigger('putDown');
    player.carriedRock = null;
    player.state = 'idle';
  } else if (findNearbyVehicle()) {
    enterVehicle(findNearbyVehicle()); // second call is cheap - just 1-2 vehicles
  } else {
    const target = findNearbySmallRock();
    if (target) {
      target.pickUp();
      player.carriedRock = target;
      player.state = 'carry';
      hints.trigger('pickUp');
    }
  }
}

function updateCarriedRock() {
  if (!player.carriedRock) return;
  const rock = player.carriedRock;
  // Held at the hip, offset to the character's side rather than dead-ahead - the
  // camera sits mostly behind the player, so anything held directly "ahead" (away
  // from camera, facing-wise) is hidden behind their own body. Held to the side it
  // stays visible past the silhouette, the same way the shovel is offset in-hand.
  const forwardX = Math.sin(player.facing), forwardZ = Math.cos(player.facing);
  const rightX = -forwardZ, rightZ = forwardX;
  const hold = 0.22 + rock.radius * 0.4;
  const px = player.pos.x + rightX * hold + forwardX * 0.12;
  const pz = player.pos.z + rightZ * hold + forwardZ * 0.12;
  const y = terrain.sampleHeightBilinear(player.pos.x, player.pos.z) + 0.4;
  rock.mesh.position.set(px, y, pz);
  rock.mesh.rotation.y += 0.6 * (1 / 60);
}

let rockScrapeCooldown = 0;
function updateRockPushing(dt) {
  for (const r of rocks) {
    if (r.carried || r.size === 'small') continue;
    const dx = r.x - player.pos.x, dz = r.z - player.pos.z;
    const dist = Math.sqrt(dx * dx + dz * dz) || 0.0001;
    const minDist = PLAYER_RADIUS + r.radius;
    if (dist >= minDist) continue;
    const overlap = minDist - dist;
    const nx = dx / dist, nz = dz / dist;

    const h0 = terrain.sampleHeightBilinear(r.x, r.z);
    const h1 = terrain.sampleHeightBilinear(r.x + nx * 0.5, r.z + nz * 0.5);
    const slope = (h1 - h0) / 0.5; // positive = pushing uphill
    const resist = THREE.MathUtils.clamp(1 - Math.max(0, slope) * 1.6, 0.08, 1);

    // A big rock should feel grippy while leaned into, not like the player's feet
    // are on ice - the overlap correction below only ever fixes the radial
    // (player <-> rock) component, so any sideways drift in the player's velocity
    // (a slightly off-axis joystick push, a diagonal WASD tap) was free to slide
    // them around the boulder's curved edge with nothing opposing it. That
    // unopposed tangential slide is what read as "slipping off" a rock you're
    // actively pushing. Kill it, but only while the player is driving INTO the
    // rock (velocity has a positive component along the push normal) - the
    // instant they're not pushing, this releases and walking past/around a rock
    // feels completely normal again.
    const velIntoRock = player.velocity.x * nx + player.velocity.z * nz;
    if (velIntoRock > 0.05) {
      const tx = -nz, tz = nx;
      const velAlongTangent = player.velocity.x * tx + player.velocity.z * tz;
      const grip = Math.min(1, dt * 12);
      player.velocity.x -= tx * velAlongTangent * grip;
      player.velocity.z -= tz * velAlongTangent * grip;
    }

    // Push speed used to be a flat constant, completely independent of how fast
    // the player was actually moving into the rock - sprinting into a boulder
    // pushed it no harder than walking into it, which read as sprint doing
    // nothing at all. Tied directly to velIntoRock (the player's own speed
    // along the push direction) instead, with a small floor so a stationary
    // lean still nudges a light rock - sprint's real ~2.4x speed advantage
    // over walking now carries straight through to a proportionally faster push.
    const pushSpeed = (Math.max(0.5, velIntoRock * 0.9) / r.mass) * resist;
    const moveAmt = Math.min(overlap, pushSpeed * dt);
    if (moveAmt > 0.0005) {
      const nx2 = THREE.MathUtils.clamp(r.x + nx * moveAmt, 0.5, SIZE - 0.5);
      const nz2 = THREE.MathUtils.clamp(r.z + nz * moveAmt, 0.5, SIZE - 0.5);
      r.moveTo(nx2, nz2, terrain);
      // Roll, don't slide: a ball rolling distance `d` without slipping turns by
      // d/radius around the horizontal axis perpendicular to its direction of
      // travel. Applied as a world-space quaternion premultiply (not r.mesh.rotation
      // directly), so repeated pushes from any angle accumulate into real tumbling
      // rather than resetting/fighting a fixed local axis.
      const rollAxis = _rollAxis.set(nz, 0, -nx).normalize();
      const rollAngle = moveAmt / r.radius;
      r.mesh.quaternion.premultiply(_rollQuat.setFromAxisAngle(rollAxis, rollAngle));
      hints.trigger('pushRock');
      rockScrapeCooldown -= dt;
      if (rockScrapeCooldown <= 0 && player.speed > 0.2) {
        audio.rockScrape();
        rockScrapeCooldown = 0.7 + Math.random() * 0.4;
        particles.burst(r.x, terrain.sampleHeightBilinear(r.x, r.z) + 0.1, r.z, 3, {
          color: [0.72, 0.66, 0.5], life: 0.5, up: 0.6, spread: 0.5,
        });
      }
    }
    // Whatever the rock didn't give way for (too heavy, too steep, or simply not
    // enough this frame), the player must not tunnel through - a fast approach could
    // otherwise cross a slow-moving rock within a single frame. Resolve any leftover
    // overlap by holding the player back, every frame, regardless of the branch above.
    const dx2 = r.x - player.pos.x, dz2 = r.z - player.pos.z;
    const dist2 = Math.sqrt(dx2 * dx2 + dz2 * dz2) || 0.0001;
    const remaining = minDist - dist2;
    if (remaining > 0) {
      player.pos.x -= (dx2 / dist2) * remaining;
      player.pos.z -= (dz2 / dist2) * remaining;
    }
  }
}

// Rocks used to only ever collide with the PLAYER (see updateRockPushing) -
// two rocks pushed toward each other just interpenetrated, since nothing ever
// checked rock-vs-rock distance. Positional correction only (no momentum/
// impulse) - rocks aren't otherwise simulated bodies, they're moved by direct
// position sets elsewhere (pushing, carrying, gravity below), so a full
// physics response would be solving a problem nothing else here has.
function updateRockCollisions() {
  for (let i = 0; i < rocks.length; i++) {
    const a = rocks[i];
    if (a.carried) continue;
    for (let j = i + 1; j < rocks.length; j++) {
      const b = rocks[j];
      if (b.carried) continue;
      const dx = b.x - a.x, dz = b.z - a.z;
      const dist = Math.sqrt(dx * dx + dz * dz) || 0.0001;
      const minDist = a.radius + b.radius;
      if (dist >= minDist) continue;
      const overlap = minDist - dist;
      const nx = dx / dist, nz = dz / dist;
      // Heavier rock gives way less - split the correction by the OTHER rock's
      // mass share, so a small rock shoved into a large one mostly moves itself.
      const totalMass = a.mass + b.mass;
      const aShare = overlap * (b.mass / totalMass);
      const bShare = overlap * (a.mass / totalMass);
      a.moveTo(
        THREE.MathUtils.clamp(a.x - nx * aShare, 0.5, SIZE - 0.5),
        THREE.MathUtils.clamp(a.z - nz * aShare, 0.5, SIZE - 0.5),
        terrain,
      );
      b.moveTo(
        THREE.MathUtils.clamp(b.x + nx * bShare, 0.5, SIZE - 0.5),
        THREE.MathUtils.clamp(b.z + nz * bShare, 0.5, SIZE - 0.5),
        terrain,
      );
    }
  }
}

// Rocks sat wherever they were placed or last pushed to, forever, even on a
// steep dug-out slope - real boulders don't just balance on an incline. Any
// unheld rock on ground steeper than a real angle of repose rolls downhill on
// its own, using the exact same "roll distance / radius = rotation" physics
// as being pushed by the player (see updateRockPushing) - it should look like
// the same rock, just moved by gravity instead of a shove.
const ROCK_GRAVITY_THRESHOLD = 0.16; // slope (rise/run) below this: stays put, no jitter on gentle ground
const ROCK_GRAVITY_ACCEL = 2.0;
const ROCK_MAX_ROLL_SPEED = 3.2;
function updateRockGravity(dt) {
  for (const r of rocks) {
    if (r.carried) continue;
    const eps = Math.max(0.3, r.radius * 0.6);
    const h0 = terrain.sampleHeightBilinear(r.x, r.z);
    const hX = terrain.sampleHeightBilinear(r.x + eps, r.z);
    const hZ = terrain.sampleHeightBilinear(r.x, r.z + eps);
    const gx = (hX - h0) / eps, gz = (hZ - h0) / eps;
    const slope = Math.sqrt(gx * gx + gz * gz);
    if (slope < ROCK_GRAVITY_THRESHOLD) continue;
    const dirX = -gx / slope, dirZ = -gz / slope; // downhill = against the gradient
    const speed = Math.min(ROCK_MAX_ROLL_SPEED, (slope - ROCK_GRAVITY_THRESHOLD) * ROCK_GRAVITY_ACCEL / Math.max(0.4, r.mass));
    const moveAmt = speed * dt;
    if (moveAmt < 0.0003) continue;
    r.moveTo(
      THREE.MathUtils.clamp(r.x + dirX * moveAmt, 0.5, SIZE - 0.5),
      THREE.MathUtils.clamp(r.z + dirZ * moveAmt, 0.5, SIZE - 0.5),
      terrain,
    );
    const rollAxis = _rollAxis.set(dirZ, 0, -dirX).normalize();
    const rollAngle = moveAmt / r.radius;
    r.mesh.quaternion.premultiply(_rollQuat.setFromAxisAngle(rollAxis, rollAngle));
  }
}

// ---------- vehicle interaction ----------

// Same idea as findNearbySmallRock: nearest not-currently-occupied vehicle
// within its own enter range.
function findNearbyVehicle() {
  let best = null, bestD = Infinity;
  for (const v of vehicles) {
    if (v.occupied) continue;
    const dx = v.pos.x - player.pos.x, dz = v.pos.z - player.pos.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d < v.enterRange && d < bestD) { bestD = d; best = v; }
  }
  return best;
}

function enterVehicle(v) {
  drivingVehicle = v;
  v.occupied = true;
  player.mesh.visible = false;
  savedCamDistTarget = camDistTarget;
  camDistTarget = v.cameraDist;
  hints.trigger('enterVehicle');
}

function exitVehicle() {
  const v = drivingVehicle;
  if (!v) return;
  // Step out to the vehicle's side, not straight in front of a blade/bucket.
  const fx = Math.sin(v.facing), fz = Math.cos(v.facing);
  const sideX = -fz, sideZ = fx;
  const side = Math.random() < 0.5 ? -1 : 1;
  let px = v.pos.x + sideX * side * v.exitOffset;
  let pz = v.pos.z + sideZ * side * v.exitOffset;
  px = THREE.MathUtils.clamp(px, 1, SIZE - 1);
  pz = THREE.MathUtils.clamp(pz, 1, SIZE - 1);
  player.pos.set(px, terrain.sampleHeightBilinear(px, pz), pz);
  player.facing = v.facing;
  player.mesh.visible = true;
  v.occupied = false;
  drivingVehicle = null;
  if (savedCamDistTarget != null) { camDistTarget = savedCamDistTarget; savedCamDistTarget = null; }
}

// input for whichever vehicle is currently occupied - W/S throttle, A/D
// (tank-pivot) steer, exactly the same physical keys/joystick as on-foot
// movement, so getting in doesn't mean learning a new control scheme. Z/X
// additionally rotate the excavator's cab independent of its tracks - the
// "extra input while driving" the brief calls for to aim the dig.
// Same physical dig input the hand shovel already uses (mouse left / the
// touch Dig button) - reused here rather than a separate vehicle-only
// control, so getting in a vehicle doesn't mean learning a new button.
// `digHeld` is the continuous state (excavator repeats its whole dig cycle
// for as long as this stays true - "holding the dig button should enable
// continuous digging", requestDig() itself is a no-op while a cycle is
// already running, so calling it every frame just chains cycles back to
// back); `digPressed` is the rising edge only, once per press (the
// bulldozer's blade is a toggle - "a dig button which moves the shovel down
// ... which stays on" - not something that should flip every frame it's held).
let _wasDigHeld = false;
function computeVehicleControls() {
  let throttle = 0, steer = 0, cabTurn = 0;
  if (keys.has('KeyW') || keys.has('ArrowUp')) throttle += 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) throttle -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) steer += 1;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) steer -= 1;
  throttle -= touch.y; // joystick pushed up (forward) => touch.y negative, see computeMoveVector
  steer += touch.x;
  if (keys.has('KeyX')) cabTurn += 1;
  if (keys.has('KeyZ')) cabTurn -= 1;
  const digHeld = mouse.left || touchDigHeld;
  const digPressed = digHeld && !_wasDigHeld;
  _wasDigHeld = digHeld;
  return {
    throttle: THREE.MathUtils.clamp(throttle, -1, 1),
    steer: THREE.MathUtils.clamp(steer, -1, 1),
    cabTurn: THREE.MathUtils.clamp(cabTurn, -1, 1),
    digHeld, digPressed,
  };
}

let dozerScrapeCooldown = 0;
function handleVehicleEvents(result, dt) {
  if (result.gradeEvent) {
    const g = result.gradeEvent;
    particles.burst(g.x, g.y + 0.12, g.z, 3, {
      color: [0.74, 0.63, 0.44], life: 0.4, up: 0.9, upVar: 0.5, spread: 0.9,
    });
    dozerScrapeCooldown -= dt;
    if (dozerScrapeCooldown <= 0) {
      audio.digScrape();
      dozerScrapeCooldown = 0.35 + Math.random() * 0.15;
    }
    hints.trigger('bulldoze');
  }
  if (result.digEvent) {
    const e = result.digEvent;
    if (e.kind === 'dig') {
      audio.digScrape();
      particles.burst(e.x, e.y + 0.18, e.z, 12, {
        color: [0.82, 0.73, 0.53], life: 0.6, up: 1.8, upVar: 1.0, spread: 1.3,
      });
      hints.trigger('excavatorDig');
    } else if (e.kind === 'dump') {
      audio.rockScrape();
      particles.burst(e.x, e.y + 0.18, e.z, 9, {
        color: [0.74, 0.63, 0.44], life: 0.5, up: 1.0, upVar: 0.6, spread: 1.1,
      });
    }
  }
}

// ---------- shovel action ----------

// Straightforward, no inventory: hold the button and the shovel keeps taking
// discrete scoops out of the ground right at the target, piling each one up
// immediately next to the hole (on the side toward the player, like actually
// throwing spoil over your shoulder). Keep holding and it keeps going, for as
// long as you like, in the same spot or wherever you aim - each stroke fires on
// a fixed cadence so it reads as distinct scoops, not a smoothly draining ramp.
// An oval, blade-shaped mark (see terrain.scoopDeform), not a round dimple - and
// deliberately small: the terrain mesh only has a vertex every ~0.82m, so this is
// close to the smallest footprint that still spans enough vertices to show an
// actual oval shape rather than a single point poked down.
const DIG_LEN = 0.85, DIG_WID = 0.55;
const PILE_LEN = 0.7, PILE_WID = 0.5;
const STROKE_INTERVAL = 0.4; // seconds per scoop - matches the shovel-swing animation
const STROKE_AMOUNT = 0.22;  // height-units of material moved per scoop

let strokeAccum = 0;
// The mouse path aims by raycasting onto the terrain - fine for a single click, but
// while actively digging the ground right under that screen pixel keeps getting
// lower, so a fresh raycast every frame drifts to wherever that now-deeper surface
// sits (the same camera ray meets a lower surface further along its length). Over a
// few seconds of holding still, that silent drift was enough to slide the dig point
// onto the pile it had just built, digging it back out and undoing the whole hole -
// exactly the "nothing happens no matter how long I hold it" complaint. Lock the aim
// once per hold (mouse press to release) instead of re-raycasting every frame -
// "digging in the location you specified" means the location doesn't move on its own.
let lockedDigTarget = null;
function updateShovel(dt) {
  const carrying = !!player.carriedRock;
  const usingMouse = (mouse.left || mouse.right) && !carrying;
  const wantsDig = (mouse.left || touchDigHeld) && !carrying;
  const wantsFlatten = (mouse.right || touchSmoothHeld) && !carrying;

  if (wantsDig || wantsFlatten) {
    let target;
    if (!usingMouse) {
      target = player.aheadPoint(player.reach * 0.85);
    } else if (wantsDig) {
      if (!lockedDigTarget) lockedDigTarget = getShovelTarget();
      target = lockedDigTarget;
    } else {
      lockedDigTarget = null; // flattening still tracks the live mouse ray - sweeping to smooth an area is the point
      target = getShovelTarget();
    }
    if (target) {
      if (usingMouse) player.facing = Math.atan2(target.x - player.pos.x, target.z - player.pos.z);

      if (wantsDig) {
        player.startDig();
        strokeAccum += dt;
        if (strokeAccum >= STROKE_INTERVAL) {
          strokeAccum -= STROKE_INTERVAL;

          // Spoil lands just past the dig radius, on the side nearest the player -
          // a real digger throws each scoop back over their shoulder, not into a
          // ring around the hole, so the growing pile stays a distinct heap you can
          // watch form right next to the (also growing) hole. Both scoop and pile
          // are oriented along this same player<->target axis.
          const dx = player.pos.x - target.x, dz = player.pos.z - target.z;
          const dlen = Math.sqrt(dx * dx + dz * dz) || 1;
          const pileDist = DIG_LEN + PILE_LEN * 0.85;
          const pileX = THREE.MathUtils.clamp(target.x + (dx / dlen) * pileDist, 0.5, SIZE - 0.5);
          const pileZ = THREE.MathUtils.clamp(target.z + (dz / dlen) * pileDist, 0.5, SIZE - 0.5);

          const y = terrain.sampleHeightBilinear(target.x, target.z);
          const depth = water.depthAt(target.x, target.z);

          // scoopDeform()'s return is the NET volume actually removed (hardness
          // resists digging into packed/rocky ground) - pile exactly that much back
          // up, not a fixed amount, so a scoop out of soft sand builds a bigger heap
          // than the same stroke against harder ground.
          const removed = terrain.scoopDeform(target.x, target.z, dx, dz, DIG_LEN, DIG_WID, -STROKE_AMOUNT, 1.0);
          if (removed < -0.0005) {
            terrain.depositScoop(pileX, pileZ, dx, dz, PILE_LEN, PILE_WID, -removed);
          }
          terrain.markDirty();

          if (depth > 0.02) audio.splash(); else audio.digScrape();
          particles.burst(target.x, y + 0.08, target.z, depth > 0.02 ? 5 : 8, {
            color: depth > 0.02 ? [0.75, 0.85, 0.85] : [0.82, 0.73, 0.53],
            life: depth > 0.02 ? 0.4 : 0.55,
            up: depth > 0.02 ? 1.4 : 1.2,
            upVar: 0.8,
            spread: 1.0,
          });
          const pileY = terrain.sampleHeightBilinear(pileX, pileZ);
          particles.burst(pileX, pileY + 0.12, pileZ, 4, {
            color: [0.74, 0.63, 0.44], life: 0.4, up: 0.5, upVar: 0.3, spread: 0.6,
          });
          hints.trigger('dig');
        }
      } else {
        strokeAccum = 0;
        player.state = 'dig-active';
        player.digTimer += dt * 0.6;
        terrain.smooth(target.x, target.z, 1.9, Math.min(1, dt * 1.6));
        terrain.markDirty();
      }
      return;
    }
  }
  strokeAccum = 0;
  lockedDigTarget = null;
  player.stopDig();
}

// ---------- hints (minimal, one-shot, event driven) ----------

const hintEl = document.getElementById('hint');
const hints = {
  shown: new Set(),
  queue: [],
  current: null,
  timer: 0,
  messages: ACTIVE_LEVEL_ID !== 'level1' ? {
    nearVehicle: 'Walk to a machine and press E to drive. Hold the dig control to move earth.',
    enterVehicle: 'W/S drive · A/D steer · E exit · Click to dig · Z/X rotate the excavator cab',
    intro: ACTIVE_LEVEL_ID === 'level3' ? 'The old mill is starved of water. Clear the silted right fork upstream, then redirect the river to bring the garden fountain back to life.' : 'A shovel. A waterfall feeding a river through the gorge. Left click to dig, right click to smooth. Rocks can be pushed, or carried with E.',
    dig: 'Keep holding to keep digging - each scoop piles up right next to the hole.',
    pickUp: 'Carry it to the water. E to set it down.',
    putDown: null,
    pushRock: null,
    tideRise: null,
  } : {
    intro: 'A shovel. A stream finding its way to the sea. Left click to dig, right click to smooth. Rocks can be pushed, or carried with E.',
    dig: 'Keep holding to keep digging - each scoop piles up right next to the hole.',
    pickUp: 'Carry it to the water. E to set it down.',
    putDown: null,
    pushRock: null,
    tideRise: 'The tide is turning. Watch what it does to the stream mouth.',
    nearVehicle: 'A bulldozer and an excavator, parked nearby. Walk up and press E to hop in.',
    enterVehicle: 'W/S drive, A/D turn. The excavator also has Z/X to rotate its cab, and click to dig.',
    bulldoze: null,
    excavatorDig: null,
  },
  trigger(key) {
    if (this.shown.has(key)) return;
    const msg = this.messages[key];
    if (!msg) { this.shown.add(key); return; }
    this.shown.add(key);
    this.queue.push(msg);
  },
  update(dt) {
    if (!this.current && this.queue.length) {
      this.current = this.queue.shift();
      hintEl.textContent = this.current;
      hintEl.classList.add('show');
      this.timer = 7.5;
    } else if (this.current) {
      this.timer -= dt;
      if (this.timer <= 0) {
        hintEl.classList.remove('show');
        this.current = null;
      }
    }
  },
};
setTimeout(() => hints.trigger('intro'), 1400);

// ---------- tide UI ----------

const tideMarker = document.getElementById('tideMarker');
const tideLabel = document.getElementById('tideLabel');
let lastTideHeight = water.tideHeight(0);
// Level 2 is a still mountain lake, not a tidal sea (see water.js's own
// tideRange=0 for level 2) - the tide readout has nothing to show there.
if (ACTIVE_LEVEL_ID !== 'level1') {
  const tideWrap = document.getElementById('tideWrap');
  if (tideWrap) tideWrap.style.display = 'none';
}

function updateTideUI() {
  if (ACTIVE_LEVEL_ID !== 'level1') return;
  const h = water.tideHeight(water.elapsed);
  const norm = THREE.MathUtils.clamp((h - (water.tideLevel - water.tideRange / 2)) / water.tideRange, 0, 1);
  tideMarker.style.left = `${norm * 100}%`;
  const rising = h > lastTideHeight;
  tideLabel.textContent = rising ? 'Tide rising' : 'Tide falling';
  if (rising && norm > 0.6) hints.trigger('tideRise');
  lastTideHeight = h;
}

// ---------- vehicle prompt / HUD ----------

const vehiclePromptEl = document.getElementById('vehiclePrompt');
const vehicleHudEl = document.getElementById('vehicleHud');

function updateVehicleUI() {
  if (drivingVehicle) {
    vehiclePromptEl.style.display = 'none';
    vehicleHudEl.style.display = 'block';
    vehicleHudEl.textContent = drivingVehicle.type === 'excavator'
      ? 'W/S drive · A/D turn · Z/X rotate cab · hold to dig · E to exit'
      : `W/S drive · A/D turn · Dig lowers the blade (${drivingVehicle.bladeDown ? 'down' : 'up'}) · E to exit`;
    interactBtn.textContent = 'Exit';
    digBtnEl.style.display = '';
    digBtnEl.textContent = drivingVehicle.type === 'bulldozer' && drivingVehicle.bladeDown ? 'Blade down' : 'Dig';
    smoothBtnEl.style.display = 'none';
  } else {
    vehicleHudEl.style.display = 'none';
    digBtnEl.style.display = '';
    digBtnEl.textContent = 'Dig';
    smoothBtnEl.style.display = '';
    const nearVeh = findNearbyVehicle();
    if (nearVeh) {
      hints.trigger('nearVehicle');
      vehiclePromptEl.style.display = 'block';
      vehiclePromptEl.textContent = `Press E to enter the ${nearVeh.label.toLowerCase()}`;
      interactBtn.textContent = 'Enter';
    } else {
      vehiclePromptEl.style.display = 'none';
      interactBtn.textContent = player.carriedRock ? 'Put down' : 'Pick up';
    }
  }
}

// ---------- village door (the sole route into level 2) ----------

// The gorge door only appears in level 1, on the one hero house buildVillage()
// singled out (see environment.js) - it's meant to be a thing to stumble on
// rather than an upfront choice (that's the whole point of replacing the old
// boot-time level picker with this), but that comes from the door itself
// being unremarkable amid 25 ordinary houses, not from an artificial delay -
// an earlier version also gated the popup behind 90s of elapsed play time
// with no feedback at all, so finding the door before then just looked
// broken ("I see the door but nothing happens"). Re-uses the picker's own
// markup/styling (#levelSelect), repointed at a single "enter the gorge"
// card instead of the two-level chooser it used to be - see index.html/
// artifact.html.
const DOOR_RANGE = 2.6;
const doorPopupEl = document.getElementById('levelSelect');
let doorPopupShown = false;
let doorDismissed = false;

function nearVillageDoor() {
  const door = ACTIVE_LEVEL_ID === 'level2' ? waterfallDoor : villageDoor;
  if (!door) return false;
  const dx = door.standX - player.pos.x, dz = door.standZ - player.pos.z;
  return Math.hypot(dx, dz) < DOOR_RANGE;
}

function updateDoorUI() {
  if (ACTIVE_LEVEL_ID === 'level3' || drivingVehicle) return;
  const near = nearVillageDoor();
  if (near && !doorPopupShown && !doorDismissed) {
    doorPopupShown = true;
    if (doorPopupEl) doorPopupEl.style.display = 'flex';
  } else if (!near) {
    doorDismissed = false; // walking away resets it, so stepping back up shows it again
  }
}

if (doorPopupEl) {
  if (ACTIVE_LEVEL_ID === 'level2') {
    doorPopupEl.querySelector('.lsTitle').textContent = 'Behind the falling water';
    doorPopupEl.querySelector('.lsSubtitle').textContent = 'An old door in the rock.';
    doorPopupEl.querySelector('.lsCardTitle').textContent = 'Stillwater Mill';
    doorPopupEl.querySelector('.lsCardDesc').textContent = 'Beyond the gorge, a divided river and a waterwheel waiting to turn.';
  }
  const gorgeCard = document.getElementById('gorgeCard');
  const dismissBtn = document.getElementById('lsDismiss');
  if (gorgeCard) {
    gorgeCard.addEventListener('click', () => {
      saveState({ terrain, water, rocks, player, vehicles, levelId: ACTIVE_LEVEL_ID });
      const next = ACTIVE_LEVEL_ID === 'level2' ? 'level3' : 'level2';
      localStorage.setItem('shoreline_active_level', next);
      location.href = location.pathname; // consume debug level override when travelling
    });
  }
  if (dismissBtn) {
    dismissBtn.addEventListener('click', () => {
      doorPopupEl.style.display = 'none';
      doorPopupShown = false;
      doorDismissed = true;
    });
  }
}

// ---------- sound toggle ----------

const soundBtn = document.getElementById('sound');
let soundOn = true;
soundBtn.addEventListener('click', () => {
  soundOn = !soundOn;
  ensureAudioStarted();
  audio.setEnabled(soundOn);
  soundBtn.textContent = `Sound: ${soundOn ? 'on' : 'off'}`;
});

// ---------- save / reset ----------

// Guards the autosave-on-unload handlers below during a deliberate reset -
// `location.reload()` itself fires `pagehide`/`visibilitychange`, which would
// otherwise re-save (and so silently undo) the reset in the instant between
// `clearSave()` and the reload actually taking effect. Caught live: without
// this flag, the reset button appeared to do nothing at all.
let resetting = false;

function doSave() { if (!resetting) saveState({ terrain, water, rocks, player, vehicles, levelId: ACTIVE_LEVEL_ID }); }

// Periodic autosave (every dig/push/tide-tick is too frequent to serialize
// ~140x140 float arrays on every one) plus a save right when the tab is about
// to actually disappear - `visibilitychange`'s 'hidden' state fires reliably on
// mobile (backgrounding, switching apps, locking the screen) where `beforeunload`
// often does not, so it's the primary save point, not just a fallback.
setInterval(doSave, 12000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') doSave(); });
window.addEventListener('pagehide', doSave);

const resetBtn = document.getElementById('resetBtn');
if (resetBtn) {
  const resetLabel = ACTIVE_LEVEL_ID === 'level3' ? 'Reset valley' : ACTIVE_LEVEL_ID === 'level2' ? 'Reset gorge' : 'Reset beach';
  resetBtn.textContent = resetLabel;
  resetBtn.addEventListener('click', () => {
    const sure = window.confirm('Reset this level back to its natural state? Everything you\'ve dug, piled, or moved will be lost - this can\'t be undone.');
    if (!sure) return;
    resetting = true;
    clearSave(ACTIVE_LEVEL_ID);
    location.reload();
  });
}

// Returns to Mawgan Porth (level 1, the only level the game ever boots
// straight into - see index.html/artifact.html's inline bootstrap script)
// without touching either level's save - just clears which level is
// "active" so the next load falls back to its level-1 default.
const levelBtn = document.getElementById('levelBtn');
if (levelBtn) {
  // Level 1 has no "change level" destination any more - the door is the only
  // way there. Only level 2 (reached through it) needs a way back.
  if (ACTIVE_LEVEL_ID === 'level1') levelBtn.style.display = 'none';
  else levelBtn.textContent = ACTIVE_LEVEL_ID === 'level3' ? 'Back to the gorge' : 'Back to Mawgan Porth';
  levelBtn.addEventListener('click', () => {
    // Unlike reset, this keeps (rather than clears) the current level's save -
    // save explicitly first (bypassing the `resetting` guard, which only
    // exists to stop an in-flight autosave from undoing a deliberate clearSave)
    // then just forget which level is "active" so the next load defaults to level 1.
    saveState({ terrain, water, rocks, player, vehicles, levelId: ACTIVE_LEVEL_ID });
    localStorage.setItem('shoreline_active_level', ACTIVE_LEVEL_ID === 'level3' ? 'level2' : 'level1');
    location.href = location.pathname;
  });
}

// Locations are discovered through doors, not a level-selection menu.
const placeNames = {level1: 'Mawgan Porth', level2: 'Highfall Gorge', level3: 'Stillwater Mill'};
document.getElementById('placeName').textContent = placeNames[ACTIVE_LEVEL_ID];
document.getElementById('chapterLabel').textContent = 'SHORELINE / ' + ACTIVE_LEVEL_ID.replace('level', '0');
const objectiveDetails = document.getElementById('millDetails');
objectiveDetails.onclick = () => {
  const expanded = document.getElementById('millObjective').classList.toggle('expanded');
  objectiveDetails.setAttribute('aria-expanded', String(expanded));
  objectiveDetails.textContent = expanded ? 'Hide objective' : 'Show objective';
};
const controls = document.getElementById('controlsDialog');
document.getElementById('helpBtn').onclick = () => controls.showModal();
document.getElementById('closeHelp').onclick = () => controls.close();
document.getElementById('overviewBtn').onclick = () => {
  camDistTarget = camDistTarget > 70 ? DEFAULT_DIST : 115;
  introTimer = INTRO_DURATION;
};
// ---------- auto-update on a stale tab ----------

// version.txt is a tiny static file bumped alongside every ?v=N cache-bust -
// fetched with cache disabled so THIS request always reaches the server even
// though the JS modules themselves are cache-busted by query string. Checked
// when the tab becomes visible again (returning from another app, unlocking
// the phone) - a long-suspended mobile tab can sit on old code indefinitely
// with no new network request at all until something explicitly asks. Saves
// first so a real update doesn't throw away whatever the player just did.
async function checkForUpdate() {
  try {
    const res = await fetch(`version.txt?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return;
    const latest = parseInt((await res.text()).trim(), 10);
    if (Number.isFinite(latest) && latest !== APP_VERSION) {
      doSave();
      location.reload();
    }
  } catch (e) { /* offline, or the request was blocked - just skip, try again next time */ }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') checkForUpdate();
});

// ---------- footstep / stream audio hookups ----------

player.onFootstep = () => { if (audio.started) audio.footstep(); };

// ---------- main loop ----------

const clock = new THREE.Clock();
let streamCheckAccum = 0;
let fallsSprayAccum = 0;

// Split from animate() so a frame can be driven manually (see window.__game
// .stepFrame) for testing/debugging - `requestAnimationFrame` doesn't reliably
// fire in every embedding context this game gets tested in (a backgrounded or
// non-OS-focused tab can silently stop ticking rAF at all, even while
// `document.hidden` reports false and JS itself keeps running - confirmed live:
// `performance.now()` advances normally while an rAF counter stays at 0), which
// otherwise makes it impossible to verify any time-driven behaviour from outside
// the page.
function stepFrame(dt, elapsedTime) {
  if (drivingVehicle) {
    const result = drivingVehicle.update(dt, computeVehicleControls(), terrain, water);
    handleVehicleEvents(result, dt);
  } else {
    const move = computeMoveVector();
    player.update(dt, { moveVector: move, run: keys.has('Space') || touch.run || sprintHeld }, { SIZE });
    updateRockPushing(dt);
    updateCarriedRock();
    updateShovel(dt);
  }
  // Parked vehicles still settle onto whatever the ground under them is doing
  // (a bulldozer graded near a parked excavator, tide-driven erosion, etc).
  for (const v of vehicles) if (v !== drivingVehicle) v.base._settleInPlace(terrain);

  updateRockGravity(dt);
  updateRockCollisions();

  // Rocks move (pushed, carried, dropped) - rebuild their hydraulic halo from the
  // live rock list before the water sim reads it this frame. Cheap: a few dozen
  // rocks, each touching a small neighbourhood of cells.
  terrain.recomputeObstruction(rocks);
  water.update(dt, terrain);
  if (mill) mill.update(dt);
  terrain.update(dt);
  particles.update(dt);
  debris.update(dt, elapsedTime);

  updateCamera(dt);
  sky.material.uniforms.uTime.value = elapsedTime;
  if (ocean) ocean.uniforms.uTime.value = elapsedTime;
  if (cascade) {
    cascade.update(elapsedTime);
    // Spray at the base of the falls - a scripted supplement to the sim's own
    // real (but vertical-velocity-free) flow there, see buildWaterfallCascade.
    fallsSprayAccum += dt;
    if (fallsSprayAccum > 0.1) {
      fallsSprayAccum = 0;
      const px = L2_LIP_X + (Math.random() - 0.5) * 4;
      const pz = L2_T_FALL1 * SIZE + (Math.random() - 0.5) * 3;
      const py = terrain.sampleHeightBilinear(px, pz);
      particles.burst(px, py + 0.3, pz, 3, {
        color: [0.86, 0.93, 0.96], life: 0.5, up: 1.2, upVar: 0.7, spread: 1.6,
      });
    }
  }
  birds.update(elapsedTime);
  updateTideUI();
  updateVehicleUI();
  updateDoorUI();
  hints.update(dt);

  const audioSubject = drivingVehicle || player;
  streamCheckAccum += dt;
  if (streamCheckAccum > 0.4) {
    streamCheckAccum = 0;
    const near = water.flowAt(audioSubject.pos.x, audioSubject.pos.z);
    audio.setStreamIntensity(Math.min(1, near.speed * 1.2 + water.depthAt(audioSubject.pos.x, audioSubject.pos.z) * 0.5));
  }

  renderer.render(scene, camera);
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, clock.getDelta());
  stepFrame(dt, clock.elapsedTime);
}

window.__game = {
  player, camera, terrain, water, rocks, scene, updateShovel, debris,
  renderer, hemi, sun, fill, // exposed for lighting/material debugging in the browser console
  vehicles, mill,
  getDrivingVehicle: () => drivingVehicle,
  enterVehicleByIndex: (i) => { const v = vehicles[i]; if (v && !v.occupied) enterVehicle(v); return !!drivingVehicle; },
  exitVehicleNow: () => exitVehicle(),
  requestVehicleDig: () => { if (drivingVehicle && drivingVehicle.type === 'excavator') drivingVehicle.requestDig(); },
  levelId: ACTIVE_LEVEL_ID,
  setTouchDig: (v) => { touchDigHeld = v; },
  debug: () => ({
    camDist, camDistTarget, introTimer, clockElapsed: clock.elapsedTime,
    mouseLeft: mouse.left, mouseRight: mouse.right, mouseNdc: [mouse.ndcX, mouse.ndcY],
    touchDigHeld, touchSmoothHeld,
    drivingVehicle: drivingVehicle ? { type: drivingVehicle.type, x: drivingVehicle.pos.x, z: drivingVehicle.pos.z, facing: drivingVehicle.facing, speed: drivingVehicle.speed } : null,
    vehicles: vehicles.map((v) => ({ type: v.type, x: v.pos.x, z: v.pos.z, occupied: v.occupied })),
    villageDoor, waterfallDoor, doorPopupShown,
  }),
  setZoom: (d) => { camDistTarget = d; camDist = d; introTimer = INTRO_DURATION; },
  saveNow: doSave,
  stepFrame: (dt, n = 1) => { for (let i = 0; i < n; i++) stepFrame(dt, clock.elapsedTime + dt * i); },
  hasSave: () => !!loadSavedData(ACTIVE_LEVEL_ID),
  clearSaveNow: () => clearSave(ACTIVE_LEVEL_ID),
};

// Compile every material's shader program up front rather than letting the GPU
// compile them lazily the first time each object enters view - the difference
// between a smooth intro flythrough and a stutter each time something new
// (grass, rocks, water) first comes into frame.
renderer.compile(scene, camera);

// Everything is primed, shaders are warm, and the geometry buffers are valid -
// reveal the world on the frame after the first real render, so nothing
// mid-construction (or mid-compile) ever shows.
requestAnimationFrame(() => {
  renderer.render(scene, camera);
  requestAnimationFrame(() => {
    const loadingEl = document.getElementById('loading');
    loadingEl.style.opacity = '0';
    setTimeout(() => loadingEl.remove(), 1200);
  });
});

animate();
if (['127.0.0.1','localhost'].includes(location.hostname) && new URLSearchParams(location.search).has('qa')) import('../tests/playtest.js');
