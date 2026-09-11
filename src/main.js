import * as THREE from 'three';
import { Terrain, SIZE, GRID, CELL, streamCenterX, idx } from './terrain.js?v=36';
import { WaterSim } from './water.js?v=36';
import { buildSky, buildOcean, scatterProps, buildBirds, buildSkirt } from './environment.js?v=36';
import { scatterRocks } from './rocks.js?v=36';
import { Player } from './player.js?v=36';
import { AudioSystem } from './audio.js?v=36';
import { Particles } from './particles.js?v=36';

// ---------- renderer / scene / camera ----------

const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(3, window.devicePixelRatio || 1));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.18;
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

const hemi = new THREE.HemisphereLight(0xbcd9ee, 0x8c8058, 0.85);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xffe9c2, 1.85);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 90;
sun.shadow.camera.left = -34;
sun.shadow.camera.right = 34;
sun.shadow.camera.top = 34;
sun.shadow.camera.bottom = -34;
sun.shadow.bias = -0.0015;
scene.add(sun);
scene.add(sun.target);

const sunDir = new THREE.Vector3(0.42, 0.82, 0.32).normalize();

// ---------- world ----------

const terrain = new Terrain();
scene.add(terrain.mesh);

const water = new WaterSim(terrain);
scene.add(water.mesh);

const sky = buildSky(scene);
const ocean = buildOcean(water.uniforms);
scene.add(ocean.mesh);
scene.add(buildSkirt(terrain));

const props = scatterProps(terrain);
scene.add(props);

const birds = buildBirds(scene);

const rocks = scatterRocks(terrain, scene, 46);

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
player.setSpawn(SIZE * 0.72 - 6, SIZE * 0.22);

const particles = new Particles(scene, 320);

const audio = new AudioSystem();

// Pre-simulate the water system before the player ever sees it, so the stream
// is already in a flowing steady state on arrival rather than filling from dry.
{
  const PRIME_SECONDS = 40;
  const steps = Math.round(PRIME_SECONDS / water.stepDt);
  for (let s = 0; s < steps; s++) {
    water._step(water.stepDt, terrain);
    water.elapsed += water.stepDt;
  }
  terrain.markDirty();
  terrain._colorDirtyAccum = 1;
  terrain.update(0);
  water._syncMeshAttrs(terrain);
}

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
  const hit = raycaster.intersectObject(terrain.mesh, false)[0];
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

// ---------- shovel action ----------

let digAudioCooldown = 0;
function updateShovel(dt) {
  const carrying = !!player.carriedRock;
  const usingMouse = (mouse.left || mouse.right) && !carrying;
  const wantsDig = (mouse.left || touchDigHeld) && !carrying;
  const wantsFlatten = (mouse.right || touchSmoothHeld) && !carrying;

  // The shovel physically holds either sand or nothing - never both a scoop and a
  // dig at once. Empty shovel + action = scoop up from the target; loaded shovel +
  // action = tip that exact load out at the (new) target. No auto-conjured rim, no
  // particles flung to an invented destination - the pile you see IS the material,
  // and it only moves where you carry it.
  player.sandPile.visible = player.sandLoad > 0.015;
  const pileScale = 0.45 + 0.85 * (player.sandLoad / player.maxSandLoad);
  player.sandPile.scale.set(pileScale, pileScale * 0.5, pileScale);

  if (wantsDig || wantsFlatten) {
    const target = usingMouse ? getShovelTarget() : player.aheadPoint(player.reach * 0.85);
    if (target) {
      if (usingMouse) player.facing = Math.atan2(target.x - player.pos.x, target.z - player.pos.z);

      if (wantsDig) {
        player.startDig();
        const rate = 0.8;
        const y = terrain.sampleHeightBilinear(target.x, target.z);
        const depth = water.depthAt(target.x, target.z);
        digAudioCooldown -= dt;
        const playSound = digAudioCooldown <= 0;
        if (playSound) digAudioCooldown = 0.16;

        if (player.shovelEmpty) {
          // Scoop: take a load OUT of the ground here, up to a full shovel.
          // The gauge tracks the INTENDED amount (want), not deform()'s return
          // value - that return sums the height change over the whole falloff
          // footprint (many cells), not just this one spot, so using it here
          // inflated the gauge relative to what dump later drains 1:1 by `give`,
          // and the shovel would "fill up" well before an equivalent amount was
          // actually excavated - a large net height gain every cycle. want/give
          // are the same unit on both sides, so the gauge now nets to zero.
          const allowed = player.maxSandLoad - player.sandLoad;
          const want = Math.min(rate * dt, allowed);
          terrain.deform(target.x, target.z, 1.25, -want, 1.0);
          player.sandLoad = Math.min(player.maxSandLoad, player.sandLoad + want);
          if (player.sandLoad >= player.maxSandLoad - 0.001) player.shovelEmpty = false;
          terrain.markDirty();
          if (playSound) {
            if (depth > 0.02) audio.splash(); else audio.digScrape();
            particles.burst(target.x, y + 0.08, target.z, depth > 0.02 ? 4 : 6, {
              color: depth > 0.02 ? [0.75, 0.85, 0.85] : [0.82, 0.73, 0.53],
              life: depth > 0.02 ? 0.35 : 0.5,
              up: depth > 0.02 ? 1.4 : 1.1,
              upVar: 0.8,
              spread: 1.0,
            });
          }
          hints.trigger('dig');
          if (player.shovelEmpty === false && playSound) hints.trigger('shovelFull');
        } else {
          // Dump: tip the carried load OUT here, restoring ground. Hardness resists
          // DIGGING into ground, not piling loose sand on top of it, so pass
          // hardnessLimit 0 to always apply at full effect here.
          const give = Math.min(rate * dt, player.sandLoad);
          terrain.deform(target.x, target.z, 1.25, give, 0);
          player.sandLoad -= give;
          if (player.sandLoad <= 0.001) { player.sandLoad = 0; player.shovelEmpty = true; }
          terrain.markDirty();
          if (playSound) {
            audio.digScrape();
            particles.burst(target.x, y + 0.1, target.z, 5, {
              color: [0.74, 0.63, 0.44],
              life: 0.45,
              up: 0.5,
              upVar: 0.3,
              spread: 0.7,
            });
          }
          hints.trigger('dump');
        }
      } else {
        player.state = 'dig-active';
        player.digTimer += dt * 0.6;
        terrain.smooth(target.x, target.z, 1.9, Math.min(1, dt * 1.6));
        terrain.markDirty();
      }
      return;
    }
  }
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
    dig: 'That load is staying on the shovel until you tip it out somewhere.',
    shovelFull: "Shovel's full - find somewhere to tip it out.",
    dump: null,
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

// ---------- footstep / stream audio hookups ----------

player.onFootstep = () => { if (audio.started) audio.footstep(); };

// ---------- main loop ----------

const clock = new THREE.Clock();
let streamCheckAccum = 0;

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, clock.getDelta());

  const move = computeMoveVector();
  player.update(dt, { moveVector: move, run: keys.has('Space') || touch.run || sprintHeld }, { SIZE });

  updateRockPushing(dt);
  updateCarriedRock();
  updateShovel(dt);

  water.update(dt, terrain);
  terrain.update(dt);
  particles.update(dt);

  updateCamera(dt);
  sky.material.uniforms.uTime.value = clock.elapsedTime;
  ocean.uniforms.uTime.value = clock.elapsedTime;
  birds.update(clock.elapsedTime);
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

window.__game = {
  player, camera, terrain, water, rocks, scene, updateShovel,
  setTouchDig: (v) => { touchDigHeld = v; },
  debug: () => ({
    camDist, camDistTarget, introTimer, clockElapsed: clock.elapsedTime,
    mouseLeft: mouse.left, mouseRight: mouse.right, mouseNdc: [mouse.ndcX, mouse.ndcY],
    touchDigHeld, touchSmoothHeld,
  }),
  setZoom: (d) => { camDistTarget = d; camDist = d; introTimer = INTRO_DURATION; },
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
