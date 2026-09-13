import * as THREE from 'three';
import { Terrain, SIZE, GRID, CELL, streamCenterX, idx } from './terrain.js?v=76';
import { WaterSim } from './water.js?v=76';
import { buildSky, buildOcean, scatterProps, buildBirds, buildSkirt, buildVillage } from './environment.js?v=76';
import { scatterRocks, Rock } from './rocks.js?v=76';
import { Player } from './player.js?v=76';
import { AudioSystem } from './audio.js?v=76';
import { Particles } from './particles.js?v=76';
import { Debris } from './debris.js?v=76';
import { saveState, loadSavedData, applySavedData, clearSave } from './save.js?v=76';

// Bumped alongside every ?v=N cache-bust across the project (see version.txt,
// fetched below) - mobile Safari in particular can keep an old tab's JS
// running indefinitely across app-switches/backgrounding with no new network
// request at all (it's a suspended tab, not a cache-header problem, so no
// amount of server-side cache-busting reaches it) - the only way a long-lived
// tab ever picks up a fix is to actually reload. Checked whenever the tab
// becomes visible again (see checkForUpdate below), which is exactly when a
// player is starting a new session anyway, not interrupting one mid-action.
const APP_VERSION = 76;

// ---------- renderer / scene / camera ----------

const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(3, window.devicePixelRatio || 1));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
// Slightly down from 1.18 - the old exposure was washing out the richer, more
// saturated palette below (everything read a bit bleached/flat regardless of
// what colour was actually painted on it).
renderer.toneMappingExposure = 1.06;
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
const ocean = buildOcean(water.uniforms);
scene.add(ocean.mesh);

const birds = buildBirds(scene);

// A save carries its own rock positions/orientations (they're as much "player
// work" as dug sand - pushing rocks to redirect the stream is a core mechanic),
// so a restored game skips the random scatter and rebuilds the exact rocks the
// player left behind instead.
const savedData = loadSavedData();

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
scene.add(buildSkirt(terrain));
scene.add(buildVillage(terrain));
const props = scatterProps(terrain);
scene.add(props);

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
  touch.run = dist > JOY_RADIUS * 0.8;
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
bindHoldButton('digBtn',
  () => { touchDigHeld = true; document.getElementById('digBtn').classList.add('active'); },
  () => { touchDigHeld = false; document.getElementById('digBtn').classList.remove('active'); });
bindHoldButton('smoothBtn',
  () => { touchSmoothHeld = true; document.getElementById('smoothBtn').classList.add('active'); },
  () => { touchSmoothHeld = false; document.getElementById('smoothBtn').classList.remove('active'); });

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

const DEFAULT_DIST = 13.5;
const INTRO_START_DIST = 190;
const INTRO_DURATION = 5.2;

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
  if (keys.has('KeyQ')) camYaw += dt * 1.4;
  if (keys.has('BracketLeft')) camYaw += dt * 1.4;
  if (keys.has('BracketRight')) camYaw -= dt * 1.4;

  // gentle auto-orientation behind the player so the view mostly self-corrects
  const desired = player.facing + Math.PI;
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

  const target = player.pos.clone().add(camLookOffset);
  const offset = new THREE.Vector3(
    Math.sin(camYaw) * Math.cos(camPitch) * camDist,
    Math.sin(camPitch) * camDist,
    Math.cos(camYaw) * Math.cos(camPitch) * camDist,
  );
  const desiredPos = target.clone().add(offset);
  camera.position.lerp(desiredPos, Math.min(1, dt * 6));
  camera.lookAt(target);

  sun.position.copy(player.pos).add(sunDir.clone().multiplyScalar(30));
  sun.target.position.copy(player.pos);
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

    const pushSpeed = (1.1 / r.mass) * resist;
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
            terrain.scoopDeform(pileX, pileZ, dx, dz, PILE_LEN, PILE_WID, -removed, 0);
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
  messages: {
    intro: 'A shovel. A stream finding its way to the sea. Left click to dig, right click to smooth. Rocks can be pushed, or carried with E.',
    dig: 'Keep holding to keep digging - each scoop piles up right next to the hole.',
    pickUp: 'Carry it to the water. E to set it down.',
    putDown: null,
    pushRock: null,
    tideRise: 'The tide is turning. Watch what it does to the stream mouth.',
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

function updateTideUI() {
  const h = water.tideHeight(water.elapsed);
  const norm = THREE.MathUtils.clamp((h - (water.tideLevel - water.tideRange / 2)) / water.tideRange, 0, 1);
  tideMarker.style.left = `${norm * 100}%`;
  const rising = h > lastTideHeight;
  tideLabel.textContent = rising ? 'Tide rising' : 'Tide falling';
  if (rising && norm > 0.6) hints.trigger('tideRise');
  lastTideHeight = h;
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

function doSave() { if (!resetting) saveState({ terrain, water, rocks, player }); }

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
  resetBtn.addEventListener('click', () => {
    const sure = window.confirm('Reset the whole beach back to its natural state? Everything you\'ve dug, piled, or moved will be lost - this can\'t be undone.');
    if (!sure) return;
    resetting = true;
    clearSave();
    location.reload();
  });
}

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

// Split from animate() so a frame can be driven manually (see window.__game
// .stepFrame) for testing/debugging - `requestAnimationFrame` doesn't reliably
// fire in every embedding context this game gets tested in (a backgrounded or
// non-OS-focused tab can silently stop ticking rAF at all, even while
// `document.hidden` reports false and JS itself keeps running - confirmed live:
// `performance.now()` advances normally while an rAF counter stays at 0), which
// otherwise makes it impossible to verify any time-driven behaviour from outside
// the page.
function stepFrame(dt, elapsedTime) {
  const move = computeMoveVector();
  player.update(dt, { moveVector: move, run: keys.has('Space') || touch.run || sprintHeld }, { SIZE });

  updateRockPushing(dt);
  updateRockGravity(dt);
  updateRockCollisions();
  updateCarriedRock();
  updateShovel(dt);

  // Rocks move (pushed, carried, dropped) - rebuild their hydraulic halo from the
  // live rock list before the water sim reads it this frame. Cheap: a few dozen
  // rocks, each touching a small neighbourhood of cells.
  terrain.recomputeObstruction(rocks);
  water.update(dt, terrain);
  terrain.update(dt);
  particles.update(dt);
  debris.update(dt, elapsedTime);

  updateCamera(dt);
  sky.material.uniforms.uTime.value = elapsedTime;
  ocean.uniforms.uTime.value = elapsedTime;
  birds.update(elapsedTime);
  updateTideUI();
  hints.update(dt);

  streamCheckAccum += dt;
  if (streamCheckAccum > 0.4) {
    streamCheckAccum = 0;
    const near = water.flowAt(player.pos.x, player.pos.z);
    audio.setStreamIntensity(Math.min(1, near.speed * 1.2 + water.depthAt(player.pos.x, player.pos.z) * 0.5));
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
  setTouchDig: (v) => { touchDigHeld = v; },
  debug: () => ({
    camDist, camDistTarget, introTimer, clockElapsed: clock.elapsedTime,
    mouseLeft: mouse.left, mouseRight: mouse.right, mouseNdc: [mouse.ndcX, mouse.ndcY],
    touchDigHeld, touchSmoothHeld,
  }),
  setZoom: (d) => { camDistTarget = d; camDist = d; introTimer = INTRO_DURATION; },
  saveNow: doSave,
  stepFrame: (dt, n = 1) => { for (let i = 0; i < n; i++) stepFrame(dt, clock.elapsedTime + dt * i); },
  hasSave: () => !!loadSavedData(),
  clearSaveNow: clearSave,
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
