import * as THREE from '../vendor/three.module.js';
import { SIZE, warpX } from './terrain.js?v=108';

// Drivable construction vehicles: a bulldozer (blade grading) and an excavator
// (fixed-reach bucket digging, independently-rotating cab). Deliberately
// level-agnostic - nothing in here reads Level 1's specific coordinates or
// coastline shape. Everything it needs (height sampling, deforming, water
// depth) is passed in per-call by main.js, exactly like rocks.js/player.js
// already do. main.js owns WHERE vehicles start out; this file only owns HOW
// they drive and dig once they exist.
//
// Both vehicles share the same physical convention as Player/Rock: `pos` is
// the logical (unwarped) world position, `facing` is the heading in radians
// where forward = (sin(facing), cos(facing)) - identical to Player.facing/
// aheadPoint, so main.js's camera code can treat "whatever the player is
// currently controlling" (on foot or in a vehicle) as one interchangeable
// { pos, facing } shape.

// ---------------------------------------------------------------------------
// Shared low-poly construction-vehicle materials - same approach as
// Rock/buildVillage: MeshStandardMaterial, flatShading, roughness ~0.8-0.9,
// no textures. A little metalness/lower roughness only on the "bare steel"
// bits (blade, bucket, arms) to read as worked metal against the painted body.
function buildMaterials() {
  return {
    dozerBody: new THREE.MeshStandardMaterial({ color: '#d99a1f', roughness: 0.82, flatShading: true }),
    excaBody: new THREE.MeshStandardMaterial({ color: '#e0651c', roughness: 0.82, flatShading: true }),
    trim: new THREE.MeshStandardMaterial({ color: '#33312c', roughness: 0.85, flatShading: true }),
    track: new THREE.MeshStandardMaterial({ color: '#1c1c1c', roughness: 0.9, flatShading: true }),
    roller: new THREE.MeshStandardMaterial({ color: '#403f3a', roughness: 0.75, flatShading: true }),
    glass: new THREE.MeshStandardMaterial({ color: '#28383d', roughness: 0.3, metalness: 0.25, flatShading: true }),
    steel: new THREE.MeshStandardMaterial({ color: '#8a8f93', roughness: 0.5, metalness: 0.4, flatShading: true }),
    darkMetal: new THREE.MeshStandardMaterial({ color: '#4c4f52', roughness: 0.55, metalness: 0.45, flatShading: true }),
    warnStripe: new THREE.MeshStandardMaterial({ color: '#2a2a2a', roughness: 0.8, flatShading: true }),
  };
}

function addShadows(root) {
  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
}

// A pair of track units (left/right), shared shape between both vehicles -
// tracked base is explicitly called out for both in the brief, and re-using
// the same builder keeps them visually related (same "family" of machine).
function buildTracks(mats, { halfLength, halfWidth, trackWidth = 0.34, trackHeight = 0.5 }) {
  const group = new THREE.Group();
  const rollerGeo = new THREE.CylinderGeometry(0.23, 0.23, trackWidth * 0.94, 10);
  for (const side of [-1, 1]) {
    const trackX = side * (halfWidth + trackWidth * 0.5 - 0.02);
    const track = new THREE.Mesh(new THREE.BoxGeometry(trackWidth, trackHeight, halfLength * 2 + 0.5), mats.track);
    track.position.set(trackX, trackHeight * 0.5, 0);
    group.add(track);
    for (let i = -1; i <= 1; i++) {
      const roller = new THREE.Mesh(rollerGeo, mats.roller);
      roller.rotation.z = Math.PI / 2;
      roller.position.set(trackX, trackHeight * 0.46, i * (halfLength * 0.8));
      group.add(roller);
    }
  }
  return group;
}

// ---------------------------------------------------------------------------
// Bulldozer mesh: chassis + cab + tracks + an angled front blade on two push
// arms. Front = local +z (see the heading convention note above).
function buildBulldozerMesh(mats) {
  const group = new THREE.Group();
  const HALF_LEN = 1.3, HALF_WID = 0.78, DECK_Y = 0.5, CHASSIS_H = 0.58;

  group.add(buildTracks(mats, { halfLength: HALF_LEN, halfWidth: HALF_WID }));

  const chassis = new THREE.Mesh(new THREE.BoxGeometry(HALF_WID * 1.7, CHASSIS_H, HALF_LEN * 2), mats.dozerBody);
  chassis.position.y = DECK_Y + CHASSIS_H / 2;
  group.add(chassis);

  const hood = new THREE.Mesh(new THREE.BoxGeometry(HALF_WID * 1.5, 0.22, HALF_LEN * 0.9), mats.dozerBody);
  hood.position.set(0, DECK_Y + CHASSIS_H + 0.11, HALF_LEN * 0.35);
  group.add(hood);

  const cab = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.64, 0.86), mats.dozerBody);
  cab.position.set(0, DECK_Y + CHASSIS_H + 0.32, -HALF_LEN * 0.32);
  group.add(cab);
  const windows = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.42, 0.9), mats.glass);
  windows.position.copy(cab.position);
  windows.position.y += 0.03;
  group.add(windows);

  const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.5, 8), mats.darkMetal);
  exhaust.position.set(0.5, DECK_Y + CHASSIS_H + 0.38, -HALF_LEN * 0.7);
  group.add(exhaust);

  // Push arms connecting the blade to the chassis front.
  const armGeo = new THREE.CylinderGeometry(0.055, 0.055, 1.15, 6);
  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(armGeo, mats.darkMetal);
    arm.rotation.x = Math.PI / 2;
    arm.position.set(side * 0.56, DECK_Y + 0.3, HALF_LEN + 0.55);
    group.add(arm);
  }

  // Flat, angled blade - a trapezoid extrusion (same technique as the hand
  // shovel's blade in player.js) leant back slightly at the top for spillage.
  const bladeShape = new THREE.Shape();
  bladeShape.moveTo(-0.98, 0);
  bladeShape.lineTo(0.98, 0);
  bladeShape.lineTo(0.84, 0.62);
  bladeShape.lineTo(-0.84, 0.62);
  bladeShape.lineTo(-0.98, 0);
  const bladeGeo = new THREE.ExtrudeGeometry(bladeShape, {
    depth: 0.16, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 1, curveSegments: 1,
  });
  bladeGeo.translate(0, 0, -0.08);
  bladeGeo.rotateX(-0.16); // the "angled" part of "flat angled blade"
  const blade = new THREE.Mesh(bladeGeo, mats.steel);
  blade.position.set(0, DECK_Y - 0.16, HALF_LEN + 1.12);
  group.add(blade);

  addShadows(group);
  return {
    group, blade,
    halfLength: HALF_LEN, halfWidth: HALF_WID, deckY: DECK_Y,
    bladeOffset: HALF_LEN + 1.05, bladeLen: 0.6, bladeWidth: HALF_WID * 1.7,
  };
}

// ---------------------------------------------------------------------------
// Excavator mesh: tracked base, a turret ring, a cab group that ROTATES
// INDEPENDENTLY of the chassis (this is the "aim" mechanism - see the class
// below), and a 3-segment arm (boom/stick/bucket) hanging off the cab.
function buildExcavatorMesh(mats) {
  const group = new THREE.Group();
  const HALF_LEN = 1.15, HALF_WID = 0.82, DECK_Y = 0.5, CHASSIS_H = 0.5;

  group.add(buildTracks(mats, { halfLength: HALF_LEN, halfWidth: HALF_WID }));

  const chassis = new THREE.Mesh(new THREE.BoxGeometry(HALF_WID * 1.75, CHASSIS_H, HALF_LEN * 2), mats.excaBody);
  chassis.position.y = DECK_Y + CHASSIS_H / 2;
  group.add(chassis);

  // Small fixed front stabilizer blade - a real, common excavator feature,
  // purely cosmetic here (earthmoving on this vehicle is bucket-only, see below).
  const stabBlade = new THREE.Mesh(new THREE.BoxGeometry(HALF_WID * 1.6, 0.22, 0.16), mats.steel);
  stabBlade.position.set(0, DECK_Y - 0.14, HALF_LEN + 0.1);
  group.add(stabBlade);

  const turret = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.68, 0.22, 12), mats.trim);
  turret.position.y = DECK_Y + CHASSIS_H + 0.11;
  group.add(turret);

  // Everything above the turret rotates together, independent of the chassis
  // heading - this whole group's rotation.y is the "aim" control.
  const cabGroup = new THREE.Group();
  cabGroup.position.y = DECK_Y + CHASSIS_H + 0.22;
  group.add(cabGroup);

  const cab = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.6, 1.05), mats.excaBody);
  cab.position.set(-0.05, 0.32, -0.05);
  cabGroup.add(cab);
  const windows = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.4, 0.7), mats.glass);
  windows.position.set(0.15, 0.34, 0.42);
  cabGroup.add(windows);
  const counterweight = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.4, 0.32), mats.trim);
  counterweight.position.set(0, 0.32, -0.75);
  cabGroup.add(counterweight);

  // Boom (hip -> elbow)
  const boomPivot = new THREE.Group();
  boomPivot.position.set(0, 0.45, 0.55);
  cabGroup.add(boomPivot);
  const BOOM_LEN = 1.5;
  const boom = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.3, BOOM_LEN), mats.excaBody);
  boom.position.z = BOOM_LEN / 2;
  boomPivot.add(boom);

  // Stick (elbow -> wrist)
  const stickPivot = new THREE.Group();
  stickPivot.position.z = BOOM_LEN;
  boomPivot.add(stickPivot);
  const STICK_LEN = 1.25;
  const stick = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.22, STICK_LEN), mats.excaBody);
  stick.position.z = STICK_LEN / 2;
  stickPivot.add(stick);

  // Bucket (wrist -> teeth) - a simple open scoop: a curved-looking shell
  // built from an angled box plus a row of tooth cones, all low-poly.
  const bucketPivot = new THREE.Group();
  bucketPivot.position.z = STICK_LEN;
  stickPivot.add(bucketPivot);
  const bucketShell = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.42, 0.5), mats.steel);
  bucketShell.position.z = 0.28;
  bucketPivot.add(bucketShell);
  const toothGeo = new THREE.ConeGeometry(0.045, 0.18, 6);
  for (let i = -2; i <= 2; i++) {
    const tooth = new THREE.Mesh(toothGeo, mats.darkMetal);
    tooth.rotation.x = Math.PI / 2;
    tooth.position.set(i * 0.11, -0.19, 0.5);
    bucketPivot.add(tooth);
  }

  addShadows(group);
  return {
    group, cabGroup, boomPivot, stickPivot, bucketPivot,
    halfLength: HALF_LEN, halfWidth: HALF_WID, deckY: DECK_Y,
  };
}

// ---------------------------------------------------------------------------
// Shared driving physics: tank-style steering (pivot turn, not car-style
// Ackermann - conventional for tracked vehicles, and reads more like "heavy
// machinery" than wheeled cornering would), heavy/slow acceleration, terrain-
// follow height + tilt sampled the same way rocks sample slope for gravity
// rolling (see updateRockGravity in main.js), and a soft stall/slide when the
// slope ahead is steeper than this vehicle can climb.
class VehicleBase {
  constructor(x, z, heading, terrain, mesh, tuning) {
    this.pos = new THREE.Vector3(x, terrain.sampleHeightBilinear(x, z), z);
    this.facing = heading;
    this.speed = 0; // signed, +forward / -reverse, metres/second
    this.mesh = mesh.group;
    this.halfLength = mesh.halfLength;
    this.halfWidth = mesh.halfWidth;
    this.deckY = mesh.deckY;
    this._pitch = 0;
    this._roll = 0;

    // Tuning knobs - deliberately modest numbers throughout: this is
    // construction equipment, not a sports car (per the brief).
    this.maxForwardSpeed = tuning.maxForwardSpeed;
    this.maxReverseSpeed = tuning.maxReverseSpeed;
    this.accel = tuning.accel;
    this.decel = tuning.decel;
    this.maxTurnRate = tuning.maxTurnRate;
    this.climbEase = tuning.climbEase;   // slope (rise/run) below which climbing is unaffected
    this.climbStall = tuning.climbStall; // slope at/above which forward progress fully stalls and it slides back
    this.maxWaterDepth = tuning.maxWaterDepth; // water depth at which it's treated as an impassable wall

    this._setMeshTransform();
  }

  worldForward() { return { x: Math.sin(this.facing), z: Math.cos(this.facing) }; }

  // Contact-point terrain sampling, same technique as the rock-gravity slope
  // check in main.js: sample a small offset in each relevant direction and
  // take the finite-difference gradient, rather than anything fancier.
  _sampleFollow(terrain) {
    const fwd = this.worldForward();
    const sideX = -fwd.z, sideZ = fwd.x;
    const hFront = terrain.sampleHeightBilinear(this.pos.x + fwd.x * this.halfLength, this.pos.z + fwd.z * this.halfLength);
    const hBack = terrain.sampleHeightBilinear(this.pos.x - fwd.x * this.halfLength, this.pos.z - fwd.z * this.halfLength);
    const hLeft = terrain.sampleHeightBilinear(this.pos.x - sideX * this.halfWidth, this.pos.z - sideZ * this.halfWidth);
    const hRight = terrain.sampleHeightBilinear(this.pos.x + sideX * this.halfWidth, this.pos.z + sideZ * this.halfWidth);
    const hCenter = terrain.sampleHeightBilinear(this.pos.x, this.pos.z);
    const climbSlope = (hFront - hBack) / (2 * this.halfLength); // >0 = uphill ahead
    const rollSlope = (hRight - hLeft) / (2 * this.halfWidth);
    const groundY = (hFront + hBack + hLeft + hRight + hCenter) / 5;
    return { groundY, climbSlope, rollSlope };
  }

  // Tank-steer movement + terrain following. `input` = { throttle, steer } in
  // [-1, 1]. Returns the sampled climbSlope so subclasses (bulldozer grading)
  // can reuse it without resampling.
  _updateMovement(dt, input, terrain, water) {
    const follow = this._sampleFollow(terrain);

    let targetSpeed = input.throttle >= 0
      ? input.throttle * this.maxForwardSpeed
      : input.throttle * this.maxReverseSpeed;

    // Climbing resistance: eases off past climbEase, fully stalls at climbStall.
    if (targetSpeed > 0 && follow.climbSlope > this.climbEase) {
      const t = THREE.MathUtils.clamp((follow.climbSlope - this.climbEase) / (this.climbStall - this.climbEase), 0, 1);
      targetSpeed *= Math.max(0, 1 - t);
    }

    // Deep water reads as a wall - construction equipment doesn't drive into the sea.
    const depth = water ? water.depthAt(this.pos.x, this.pos.z) : 0;
    if (targetSpeed > 0 && depth > this.maxWaterDepth) {
      const t = THREE.MathUtils.clamp((depth - this.maxWaterDepth) / 0.3, 0, 1);
      targetSpeed *= Math.max(0, 1 - t);
    }

    const rate = targetSpeed > this.speed ? this.accel : this.decel;
    const dv = THREE.MathUtils.clamp(targetSpeed - this.speed, -rate * dt, rate * dt);
    this.speed += dv;

    // Stalled on too steep a slope while trying to climb it: slide back downhill
    // a little, same idea as a rock rolling under gravity, rather than just
    // freezing dead - reads as "struggling", per the brief.
    if (follow.climbSlope > this.climbStall && this.speed > -this.maxReverseSpeed * 0.5) {
      this.speed -= 0.6 * dt;
    }

    // Tank pivot turn - full authority at any speed (real tracked steering),
    // gently damped at high forward speed so it doesn't spin like a top.
    // Sign flipped - reported directly as reversed (pressing D turned the
    // vehicle left on screen, and vice versa) for both the bulldozer and
    // excavator, which share this same driving code.
    const speedDamp = 1 - 0.3 * Math.min(1, Math.abs(this.speed) / this.maxForwardSpeed);
    this.facing -= input.steer * this.maxTurnRate * speedDamp * dt;

    const fwd = this.worldForward();
    this.pos.x += fwd.x * this.speed * dt;
    this.pos.z += fwd.z * this.speed * dt;
    this.pos.x = THREE.MathUtils.clamp(this.pos.x, 1, SIZE - 1);
    this.pos.z = THREE.MathUtils.clamp(this.pos.z, 1, SIZE - 1);

    this._applyFollowTransform(dt, terrain);
    return follow.climbSlope;
  }

  // Re-samples the current spot (no movement) - used while an arm/dig cycle
  // has movement frozen, so the vehicle still settles onto the ground under it.
  _settleInPlace(terrain) {
    this._applyFollowTransform(1, terrain);
  }

  _applyFollowTransform(dt, terrain) {
    const follow = this._sampleFollow(terrain);
    const snap = Math.min(1, 12 * dt);
    this.pos.y += (follow.groundY + this.deckY - this.pos.y) * snap;
    // Clamped much tighter than the actual terrain slope can get near the
    // river/falls (confirmed live: a vehicle sitting on a rough patch near
    // the bank snapping to the old +-0.32/0.3 rad clamp read as visibly
    // broken, not just "on a slope") - reads as settling onto the ground,
    // never as tipping over.
    const targetPitch = THREE.MathUtils.clamp(-Math.atan(follow.climbSlope), -0.12, 0.12);
    const targetRoll = THREE.MathUtils.clamp(Math.atan(follow.rollSlope), -0.1, 0.1);
    this._pitch += (targetPitch - this._pitch) * snap;
    this._roll += (targetRoll - this._roll) * snap;
    this._setMeshTransform();
  }

  _setMeshTransform() {
    this.mesh.position.set(warpX(this.pos.x, this.pos.z), this.pos.y - this.deckY, this.pos.z);
    this.mesh.rotation.order = 'YXZ';
    this.mesh.rotation.set(this._pitch, this.facing, this._roll);
  }
}

// ---------------------------------------------------------------------------
// Bulldozer: grades as it drives forward into high ground. Samples the ground
// just past the blade; whatever sits above the vehicle's own current ground
// level is treated as material the blade shoves - most of it piled just ahead
// (pushed forward, the way a real dozer builds a windrow in front of the
// blade) and the rest spilling to either side, all via terrain.scoopDeform
// (the exact same primitive the hand shovel uses), so it's the same
// conservation-of-mass model at a bigger footprint/rate, not a new mechanic.
const DOZER_CUT_RATE = 1.1;    // metres of excess height the blade can remove per second
const DOZER_GRADE_INTERVAL = 0.1; // tick cadence - frequent enough to read as continuous
const DOZER_GRADE_TOL = 0.006; // ignore bumps/dips smaller than this - not "nothing ever happens"
const DOZER_LOAD_CAP = 1.4;    // cubic-ish "metres" of spoil the blade can carry between a cut and the next dip

export class Bulldozer {
  constructor(x, z, heading, terrain) {
    const mats = buildMaterials();
    const built = buildBulldozerMesh(mats);
    this.type = 'bulldozer';
    this.label = 'Bulldozer';
    this.occupied = false;
    this.enterRange = 3.2;
    this.exitOffset = 2.6;
    this.cameraDist = 16;
    this.base = new VehicleBase(x, z, heading, terrain, built, {
      maxForwardSpeed: 2.7, maxReverseSpeed: 1.5, accel: 1.15, decel: 2.0,
      maxTurnRate: 0.85, climbEase: 0.45, climbStall: 1.0, maxWaterDepth: 0.5,
    });
    this.mesh = this.base.mesh;
    this.bladeOffset = built.bladeOffset;
    this.bladeLen = built.bladeLen;
    this.bladeWidth = built.bladeWidth;
    this.bladeMesh = built.blade;
    this._bladeRestY = built.blade.position.y;
    this._gradeAccum = 0;
    this._bladeLoad = 0; // spoil currently carried in front of the blade, cut from a mound and not yet all shed
    // Blade starts UP/inactive - grading is now an explicit toggle ("a dig
    // button which moves the shovel down to move the earth, that stays on"),
    // not automatic just from driving forward.
    this.bladeDown = false;
  }

  get pos() { return this.base.pos; }
  get facing() { return this.base.facing; }
  set facing(v) { this.base.facing = v; }
  get speed() { return this.base.speed; }

  // Returns { gradeEvent } for main.js to hang particles/audio off.
  update(dt, input, terrain, water) {
    this.base._updateMovement(dt, input, terrain, water);
    // Toggle, not hold - one press drops the blade and it stays down until
    // pressed again, same as a real blade-control lever.
    if (input.digPressed) {
      this.bladeDown = !this.bladeDown;
      // Lifting the blade drops whatever it was still carrying right where it
      // stands, rather than letting it vanish or ride along invisibly forever.
      if (!this.bladeDown && this._bladeLoad > 0.0004) {
        const fwd = this.base.worldForward();
        const bx = this.base.pos.x + fwd.x * this.bladeOffset, bz = this.base.pos.z + fwd.z * this.bladeOffset;
        terrain.depositScoop(bx, bz, fwd.x, fwd.z, this.bladeLen * 1.2, this.bladeWidth, this._bladeLoad);
        terrain.markDirty();
        this._bladeLoad = 0;
      }
    }
    // Ease the visible blade mesh toward its up/down pose rather than
    // snapping, so the toggle reads as a real mechanical action.
    const targetY = this._bladeRestY - (this.bladeDown ? 0.22 : 0);
    this.bladeMesh.position.y += (targetY - this.bladeMesh.position.y) * Math.min(1, dt * 6);
    const gradeEvent = this.bladeDown ? this._grade(dt, terrain) : null;
    if (!this.bladeDown) this._gradeAccum = 0;
    return { gradeEvent };
  }

  _grade(dt, terrain) {
    // Only grades while actually driving forward at a meaningful clip - idling
    // or reversing doesn't push anything, same as a real blade only cutting
    // on the way in.
    if (this.base.speed <= 0.15) { this._gradeAccum = 0; return null; }
    this._gradeAccum += dt;
    if (this._gradeAccum < DOZER_GRADE_INTERVAL) return null;
    const tick = this._gradeAccum;
    this._gradeAccum = 0;

    const fwd = this.base.worldForward();
    const bx = this.base.pos.x + fwd.x * this.bladeOffset, bz = this.base.pos.z + fwd.z * this.bladeOffset;
    const groundHere = terrain.sampleHeightBilinear(this.base.pos.x, this.base.pos.z);
    const groundAhead = terrain.sampleHeightBilinear(bx, bz);
    const diff = groundAhead - groundHere; // >0 = a mound in the blade's way, <0 = a dip

    if (diff > DOZER_GRADE_TOL) {
      const cut = Math.min(diff, DOZER_CUT_RATE * tick);
      const removed = -terrain.scoopDeform(bx, bz, fwd.x, fwd.z, this.bladeLen, this.bladeWidth, -cut, 1.0);
      if (removed < 0.0004) return null;

      // A real blade doesn't shed its whole load the instant it cuts one - some
      // of it rides along in front, ready to fill the next dip (see the < 0
      // branch below); what doesn't fit piles up just past the blade (half)
      // or spills off to either side (a quarter each), same as before.
      const carry = Math.min(DOZER_LOAD_CAP - this._bladeLoad, removed * 0.45);
      this._bladeLoad += carry;
      const shed = removed - carry;
      const pileDist = this.bladeOffset + this.bladeLen * 0.95;
      const px = this.base.pos.x + fwd.x * pileDist, pz = this.base.pos.z + fwd.z * pileDist;
      terrain.depositScoop(px, pz, fwd.x, fwd.z, this.bladeLen * 1.3, this.bladeWidth * 1.1, shed * 0.5);
      const sideX = -fwd.z, sideZ = fwd.x;
      for (const side of [-1, 1]) {
        const spx = bx + sideX * side * this.bladeWidth * 0.95, spz = bz + sideZ * side * this.bladeWidth * 0.95;
        terrain.depositScoop(spx, spz, fwd.x, fwd.z, this.bladeLen * 0.9, this.bladeWidth * 0.6, shed * 0.25);
      }
      terrain.markDirty();
      return { x: bx, y: groundHere, z: bz, amount: cut };
    }

    if (diff < -DOZER_GRADE_TOL && this._bladeLoad > 0.0004) {
      // A dip, and the blade's carrying spoil from an earlier cut - drop
      // enough of it here to level the dip out, same scoopDeform primitive
      // just adding instead of removing. This is what actually lets a pass
      // with the blade down grade a smooth ramp rather than only ever cut.
      const fill = Math.min(-diff, DOZER_CUT_RATE * tick, this._bladeLoad);
      this._bladeLoad -= fill;
      terrain.depositScoop(bx, bz, fwd.x, fwd.z, this.bladeLen, this.bladeWidth, fill);
      terrain.markDirty();
      return { x: bx, y: groundHere, z: bz, amount: fill };
    }

    return null;
  }
}

// ---------------------------------------------------------------------------
// Excavator: tracked base + a cab that rotates independently of the chassis
// (this IS the aim control - see requestDig below) + a fixed-reach bucket dig.
//
// SCOPE NOTE (stated plainly, per the brief): this is the simplified version.
// A fully free-aim articulated arm (independent boom/stick/bucket angles the
// player positions by hand, then digs wherever the bucket actually ends up)
// was more than this pass could responsibly tune in the time available. What
// shipped instead: the player aims by rotating the CAB (an extra, real input
// on top of driving), and the bucket always reaches a FIXED distance/depth
// straight out from wherever the cab is currently facing. The boom/stick/
// bucket still fully articulate - curl, lift, swing, dump - but that motion
// is a scripted animation for weight/drama, not an independently-aimed IK
// chain. The dig point is always "fixed reach, in the cab's current facing".
const EXC_DIG_REACH = 3.0;
const EXC_DUMP_REACH = 2.3;
const EXC_DUMP_SWING = 2.35; // radians the cab swings to dump, relative to dig facing
const EXC_DIG_LEN = 1.5, EXC_DIG_WID = 1.15;
const EXC_DIG_DEPTH = 1.05;

// Arm keyframes: [boomPivot.x, stickPivot.x, bucketPivot.x, swingOffset]
const POSE_REST   = [-0.55, 1.0, -0.3, 0];
const POSE_CURLED = [-0.22, 1.4, -1.55, 0];   // bucket teeth driven into the ground
const POSE_LIFTED = [-0.75, 0.5, -1.1, 0];    // loaded bucket pulled up and in
const POSE_SWUNG  = [-0.75, 0.5, -1.1, EXC_DUMP_SWING];
const POSE_DUMPED = [-0.62, 0.65, 0.55, EXC_DUMP_SWING];

const DIG_PHASES = [
  { name: 'curl', dur: 0.35, from: POSE_REST, to: POSE_CURLED },
  { name: 'lift', dur: 0.22, from: POSE_CURLED, to: POSE_LIFTED },
  { name: 'swing', dur: 0.45, from: POSE_LIFTED, to: POSE_SWUNG },
  { name: 'dump', dur: 0.3, from: POSE_SWUNG, to: POSE_DUMPED },
  { name: 'return', dur: 0.5, from: POSE_DUMPED, to: POSE_REST },
];

export class Excavator {
  constructor(x, z, heading, terrain) {
    const mats = buildMaterials();
    const built = buildExcavatorMesh(mats);
    this.type = 'excavator';
    this.label = 'Excavator';
    this.occupied = false;
    this.enterRange = 3.2;
    this.exitOffset = 2.4;
    this.cameraDist = 15;
    this.base = new VehicleBase(x, z, heading, terrain, built, {
      maxForwardSpeed: 2.2, maxReverseSpeed: 1.3, accel: 1.0, decel: 1.9,
      maxTurnRate: 0.8, climbEase: 0.45, climbStall: 1.0, maxWaterDepth: 0.5,
    });
    this.mesh = this.base.mesh;
    this.cabGroup = built.cabGroup;
    this.boomPivot = built.boomPivot;
    this.stickPivot = built.stickPivot;
    this.bucketPivot = built.bucketPivot;

    this.cabAngle = 0; // relative to chassis heading - this is the "aim"
    this.cabTurnRate = 1.7; // rad/s
    this.digState = 'idle'; // 'idle' | index into DIG_PHASES
    this.phaseIndex = 0;
    this.digTimer = 0;
    this._pendingSpoil = 0;
    this._applyPose(POSE_REST);
  }

  get pos() { return this.base.pos; }
  get facing() { return this.base.facing; }
  set facing(v) { this.base.facing = v; }
  get speed() { return this.base.speed; }
  get cabFacing() { return this.base.facing + this.cabAngle; }
  get busy() { return this.digState !== 'idle'; }

  requestDig() {
    if (this.digState !== 'idle') return false;
    this.digState = 'active';
    this.phaseIndex = 0;
    this.digTimer = 0;
    return true;
  }

  _applyPose([boom, stick, bucket, swing]) {
    this.boomPivot.rotation.x = boom;
    this.stickPivot.rotation.x = stick;
    this.bucketPivot.rotation.x = bucket;
    this.cabGroup.rotation.y = this.cabAngle + swing;
  }

  // input = { throttle, steer, cabTurn (-1..1) }. Returns { digEvent } for
  // main.js to hang particles/audio/hints off ('dig' | 'dump' | null).
  update(dt, input, terrain, water) {
    if (this.digState === 'idle') {
      this.base._updateMovement(dt, input, terrain, water);
    } else {
      // Arm's busy - hold position (bleed off any residual speed) rather than
      // let the chassis keep driving mid-swing.
      this.base.speed *= Math.max(0, 1 - 6 * dt);
      this.base._settleInPlace(terrain);
    }
    this.cabAngle += (input.cabTurn || 0) * this.cabTurnRate * dt;

    // "Holding the dig button should enable continuous digging" - requestDig()
    // is already a no-op while a cycle is running (see its own idle check), so
    // calling it every frame the button is held just chains cycles back to
    // back the instant each one finishes, with no special repeat-timer needed.
    if (input.digHeld) this.requestDig();

    let digEvent = null;
    if (this.digState !== 'idle') digEvent = this._updateDigCycle(dt, terrain);
    else this.cabGroup.rotation.y = this.cabAngle;

    return { digEvent };
  }

  _updateDigCycle(dt, terrain) {
    const phase = DIG_PHASES[this.phaseIndex];
    this.digTimer += dt;
    const t = Math.min(1, this.digTimer / phase.dur);
    const eased = t * t * (3 - 2 * t);
    const pose = [0, 1, 2, 3].map((i) => THREE.MathUtils.lerp(phase.from[i], phase.to[i], eased));
    this._applyPose(pose);

    if (t < 1) return null;
    let event = null;
    if (phase.name === 'curl') event = this._doDig(terrain);
    else if (phase.name === 'swing') event = this._doDump(terrain);

    this.phaseIndex++;
    this.digTimer = 0;
    if (this.phaseIndex >= DIG_PHASES.length) {
      this.digState = 'idle';
      this.phaseIndex = 0;
      this._applyPose(POSE_REST);
    }
    return event;
  }

  _doDig(terrain) {
    const fx = Math.sin(this.cabFacing), fz = Math.cos(this.cabFacing);
    const dx = this.base.pos.x + fx * EXC_DIG_REACH, dz = this.base.pos.z + fz * EXC_DIG_REACH;
    const removed = -terrain.scoopDeform(dx, dz, fx, fz, EXC_DIG_LEN, EXC_DIG_WID, -EXC_DIG_DEPTH, 1.0);
    this._pendingSpoil = Math.max(0, removed);
    terrain.markDirty();
    const y = terrain.sampleHeightBilinear(dx, dz);
    return this._pendingSpoil > 0.0004 ? { kind: 'dig', x: dx, y, z: dz } : null;
  }

  _doDump(terrain) {
    if (this._pendingSpoil <= 0.0004) return null;
    const dumpFacing = this.cabFacing + EXC_DUMP_SWING;
    const fx = Math.sin(dumpFacing), fz = Math.cos(dumpFacing);
    const dx = this.base.pos.x + fx * EXC_DUMP_REACH, dz = this.base.pos.z + fz * EXC_DUMP_REACH;
    terrain.depositScoop(dx, dz, fx, fz, EXC_DIG_LEN * 1.15, EXC_DIG_WID * 1.25, this._pendingSpoil);
    terrain.markDirty();
    const y = terrain.sampleHeightBilinear(dx, dz);
    const spoil = this._pendingSpoil;
    this._pendingSpoil = 0;
    return spoil > 0.0004 ? { kind: 'dump', x: dx, y, z: dz } : null;
  }
}
