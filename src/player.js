import * as THREE from '../vendor/three.module.js';
import { warpX } from './terrain.js?v=113';

// A toddler in a brown bear hoody with a cream hood + ears, and striped shorts -
// described in the user's reference relay. The latest photo is not available
// in this desktop session; do not claim a verified photographic likeness.
const SKIN = '#efc4ad';
const HOODY = '#49392d';     // brown fleece body
const HOODY_DARK = '#463323';
const HOOD_CREAM = '#eee3d0'; // fuzzy cream/white hood + ears
const SHORTS_NAVY = '#33465a';
const SHORTS_RUST = '#a15a3a';

function buildCharacter() {
  const group = new THREE.Group();

  const hoodyMat = new THREE.MeshStandardMaterial({ color: HOODY, roughness: 0.88 });
  const hoodyDarkMat = new THREE.MeshStandardMaterial({ color: HOODY_DARK, roughness: 0.88 });
  const hoodMat = new THREE.MeshStandardMaterial({ color: HOOD_CREAM, roughness: 0.95, side: THREE.DoubleSide });
  const skinMat = new THREE.MeshStandardMaterial({ color: SKIN, roughness: 0.7 });
  const navyMat = new THREE.MeshStandardMaterial({ color: SHORTS_NAVY, roughness: 0.85 });
  const rustMat = new THREE.MeshStandardMaterial({ color: SHORTS_RUST, roughness: 0.85 });

  // Toddler proportions: short stubby limbs, a big head, low centre of gravity.
  // Feet must land exactly at the group's local y=0 (ground level): with legs at
  // len=0.16, rad=0.062 and the hip pivot 0.03 above hips-origin, the foot sits at
  // pivotY - (len + 2*rad) = 0.03 - 0.284 = -0.254 relative to hips, so hips sit
  // at +0.254 for the character to actually touch the ground.
  const hips = new THREE.Group();
  hips.position.y = 0.254;
  group.add(hips);

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.165, 0.075, 8, 20), hoodyMat);
  torso.position.y = 0.275;
  torso.castShadow = true;
  hips.add(torso);

  // Striped shorts poking out below the hoody, over bare thighs.
  const shortsGroup = new THREE.Group();
  shortsGroup.position.y = 0.025;
  hips.add(shortsGroup);
  const shortsColors = [rustMat, navyMat, rustMat];
  for (let i = 0; i < shortsColors.length; i++) {
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.078, 0.079, 0.045, 12), shortsColors[i]);
    band.position.y = 0.05 - i * 0.045;
    band.castShadow = true;
    band.position.x=-.082;shortsGroup.add(band);
    const other=band.clone();other.position.x=.082;shortsGroup.add(other);
  }

  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.065, 0.05, 8), skinMat);
  neck.position.y = 0.4;
  hips.add(neck);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 14), skinMat);
  head.scale.set(1.0, .97, .9);
  head.position.y = 0.53;
  head.castShadow = true;
  hips.add(head);

  // A small, round face, with understated eyes and mouth.
  const eyeMat = new THREE.MeshStandardMaterial({ color: '#2a2320', roughness: 0.5 });
  const mouthMat = new THREE.MeshStandardMaterial({ color: '#b05a4a', roughness: 0.7 });
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.010, 12, 8), eyeMat);
    eye.scale.set(1.05,.8,.55);
    eye.position.set(side * 0.058, 0.545, 0.148);
    hips.add(eye);

  }
  const mouth = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 8), mouthMat);
  mouth.scale.set(.9, .32, .25);
  mouth.position.set(0, 0.5, 0.155);
  hips.add(mouth);

  const nose=new THREE.Mesh(new THREE.SphereGeometry(.016,12,10),skinMat);
  nose.scale.set(.8,.8,1);nose.position.set(0,.527,.153);hips.add(nose);
  // The hood's face opening joins its back shell continuously. A detached torus
  // rim left a visible air gap beside the cheeks in oblique views.
  const hood=new THREE.Mesh(new THREE.SphereGeometry(.208,24,18,Math.PI,Math.PI),hoodMat);
  hood.position.set(0,.55,-.015);hood.scale.y=1.09;hood.castShadow=true;hips.add(hood);
  const hoodVertices=[],hoodIndices=[];
  for(let j=0;j<=6;j++)for(let i=0;i<=48;i++){
    const a=i/48*Math.PI*2,t=j/6,bulge=Math.sin(t*Math.PI)*.009;
    hoodVertices.push(Math.cos(a)*(.162+.046*t+bulge),.55+Math.sin(a)*(.183+.04372*t+bulge),.105-.12*t);
    if(j<6&&i<48){const k=j*49+i;hoodIndices.push(k,k+49,k+1,k+1,k+49,k+50);}
  }
  const hoodGeo=new THREE.BufferGeometry();hoodGeo.setAttribute('position',new THREE.Float32BufferAttribute(hoodVertices,3));hoodGeo.setIndex(hoodIndices);hoodGeo.computeVertexNormals();
  const rim=new THREE.Mesh(hoodGeo,hoodMat);rim.castShadow=true;hips.add(rim);
  const earInner=new THREE.MeshStandardMaterial({color:'#cdbb9c',roughness:1});
  for(const side of [-1,1]){
    const ear=new THREE.Mesh(new THREE.SphereGeometry(.057,14,10),hoodMat);
    ear.position.set(side*.136,.756,-.008);ear.scale.set(1,1,.65);ear.castShadow=true;hips.add(ear);
    const pad=new THREE.Mesh(new THREE.SphereGeometry(.034,12,8),earInner);
    pad.position.copy(ear.position);pad.position.z+=.036;pad.scale.z=.2;hips.add(pad);
  }
  const hairMat=new THREE.MeshStandardMaterial({color:'#9c693f',roughness:.96});
  // One curved cap with a softly irregular fringe, rather than rigid hair rods.
  const hairGeo=new THREE.SphereGeometry(.174,48,20,0,Math.PI*2,0,1);
  const hairPositions=hairGeo.attributes.position;
  for(let j=0;j<=20;j++)for(let i=0;i<=48;i++){
    const phi=i/48*Math.PI*2,front=Math.max(0,Math.sin(phi));
    const edge=1.65-.58*front+front*(.035*Math.sin(phi*18)+.024*Math.sin(phi*31));
    const theta=j/20*edge;
    hairPositions.setXYZ(j*49+i,-.174*Math.cos(phi)*Math.sin(theta),.174*Math.cos(theta),.157*Math.sin(phi)*Math.sin(theta));
  }
  hairGeo.computeVertexNormals();
  const crown=new THREE.Mesh(hairGeo,hairMat);crown.position.set(0,.53,.003);crown.castShadow=true;hips.add(crown);

  function makeLimb(mat, len, rad) {
    const pivot = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(rad, len, 4, 6), mat);
    mesh.position.y = -len / 2 - rad;
    mesh.castShadow = true;
    pivot.add(mesh);
    return { pivot, mesh };
  }

  const armL = makeLimb(hoodyMat, 0.15, 0.062);
  armL.pivot.position.set(0.175, 0.32, 0);
  hips.add(armL.pivot);
  const armR = makeLimb(hoodyMat, 0.15, 0.062);
  armR.pivot.position.set(-0.175, 0.32, 0);
  hips.add(armR.pivot);

  const legL = makeLimb(skinMat, 0.16, 0.062);
  legL.pivot.position.set(0.08, 0.03, 0);
  hips.add(legL.pivot);
  const legR = makeLimb(skinMat, 0.16, 0.062);
  legR.pivot.position.set(-0.08, 0.03, 0);
  hips.add(legR.pivot);

  const handR = new THREE.Group();
  handR.position.set(0, -0.15, 0);
  armR.pivot.add(handR);

  return { group, hips, torso, head, armL, armR, legL, legR, handR };
}

function buildShovel() {
  const group = new THREE.Group();
  const woodMat = new THREE.MeshStandardMaterial({ color: '#5f4128', roughness: 0.82 });
  const steelMat = new THREE.MeshStandardMaterial({ color: '#aab0b4', roughness: 0.38, metalness: 0.75, flatShading: true });
  const darkMetal = new THREE.MeshStandardMaterial({ color: '#4b4e52', roughness: 0.5, metalness: 0.65 });

  const bladeTopY = 0.11;
  const shaftLen = 0.46;

  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.017, shaftLen, 7), woodMat);
  shaft.position.y = bladeTopY + shaftLen / 2;
  shaft.castShadow = true;
  group.add(shaft);

  const grip = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.011, 6, 10, Math.PI), woodMat);
  grip.position.y = bladeTopY + shaftLen;
  grip.rotation.set(0, Math.PI / 2, Math.PI / 2);
  group.add(grip);

  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.026, 0.075, 8), darkMetal);
  collar.position.y = bladeTopY;
  group.add(collar);

  // Spade blade: a tapered, slightly rounded silhouette rather than a bare cone.
  const shape = new THREE.Shape();
  shape.moveTo(-0.075, bladeTopY);
  shape.quadraticCurveTo(-0.095, bladeTopY * 0.4, -0.062, -0.02);
  shape.lineTo(-0.024, -0.145);
  shape.quadraticCurveTo(0, -0.175, 0.024, -0.145);
  shape.lineTo(0.062, -0.02);
  shape.quadraticCurveTo(0.095, bladeTopY * 0.4, 0.075, bladeTopY);
  shape.lineTo(-0.075, bladeTopY);
  const bladeGeo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.01, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: 2, curveSegments: 6,
  });
  bladeGeo.translate(0, 0, -0.005);
  const blade = new THREE.Mesh(bladeGeo, steelMat);
  blade.castShadow = true;
  group.add(blade);

  // A small resting tilt only - blade down toward the ground, handle up toward the grip.
  // (A rotation anywhere near PI here would flip the blade to point skyward - that
  // was the "holding it backwards" bug.)
  group.rotation.z = Math.PI * 0.07;
  group.rotation.x = -0.1;
  group.position.set(-0.05, -0.06, 0.04);
  return group;
}

export class Player {
  constructor(terrain) {
    this.terrain = terrain;
    const built = buildCharacter();
    this.parts = built;
    this.mesh = built.group;
    this.shovel = buildShovel();
    built.handR.add(this.shovel);

    this.pos = new THREE.Vector3(0, 0, 0);
    this.facing = 0;
    this.velocity = new THREE.Vector3();
    this.speed = 0;
    this.state = 'idle';
    this.stateTimer = 0;
    this.walkCycle = 0;
    this.digTimer = 0;
    this.carriedRock = null;
    this.pushingRock = null;
    this.reach = 2.35;
    // Widened from 1.7 - a small rock sitting right next to (or now, with
    // rock-rock collision, wedged against) a medium/large rock is often
    // physically unreachable at the old range, since the bigger rock's own
    // collision keeps the player from walking close enough to it to register
    // - "picking up smaller stones in a pile is near impossible". More slack
    // here means the player doesn't have to stand exactly on top of it.
    this.pickupRange = 2.4;

    this.footstepAccum = 0;
    this.onFootstep = null;
    this.onDig = null;
    this.onRockScrape = null;
  }

  groundHeight(x,z) { return this.walkHeight ? this.walkHeight(x,z) : this.terrain.sampleHeightBilinear(x,z); }

  setSpawn(x, z) {
    this.pos.set(x, this.groundHeight(x, z), z);
    this.mesh.position.set(warpX(this.pos.x, this.pos.z), this.pos.y, this.pos.z);
  }

  update(dt, input, world) {
    const move = input.moveVector; // {x, z} in world space, already camera-relative & normalized-ish
    const moving = move.lengthSq() > 0.0001;
    const running = input.run && moving;

    const maxSpeed = this.state==='dig-active'?1.25:(running ? 5.0 : 2.5);
    const accel = 14;
    const targetVel = move.clone().multiplyScalar(maxSpeed);

    this.velocity.x += (targetVel.x - this.velocity.x) * Math.min(1, accel * dt);
    this.velocity.z += (targetVel.z - this.velocity.z) * Math.min(1, accel * dt);

    // slope resistance: slow down on steep ground
    const nx = this.pos.x, nz = this.pos.z;
    const h0 = this.groundHeight(nx, nz);
    const hX = this.groundHeight(nx + 0.3, nz);
    const hZ = this.groundHeight(nx, nz + 0.3);
    const slope = Math.min(1, (Math.abs(hX - h0) + Math.abs(hZ - h0)) / 0.6);
    const slopeFactor = 1 - Math.min(0.6, slope * 0.8);

    this.pos.x += this.velocity.x * dt * slopeFactor;
    this.pos.z += this.velocity.z * dt * slopeFactor;
    this.pos.x = THREE.MathUtils.clamp(this.pos.x, 1, world.SIZE - 1);
    this.pos.z = THREE.MathUtils.clamp(this.pos.z, 1, world.SIZE - 1);

    // Snap to the ground almost immediately - there's no falling/jumping here, so any
    // lag just reads as the character floating above or sinking into fast terrain changes.
    const targetY = this.groundHeight(this.pos.x, this.pos.z);
    this.pos.y += (targetY - this.pos.y) * Math.min(1, 30 * dt);

    this.speed = Math.sqrt(this.velocity.x ** 2 + this.velocity.z ** 2);

    if (moving) {
      const targetFacing = Math.atan2(move.x, move.z);
      let diff = targetFacing - this.facing;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      this.facing += diff * Math.min(1, 10 * dt);
    }

    // this.pos stays the logical (unwarped) position for all movement/physics
    // above - only the rendered mesh needs the same visual taper as the ground.
    this.mesh.position.set(warpX(this.pos.x, this.pos.z), this.pos.y, this.pos.z);
    this.mesh.rotation.y = this.facing;

    // footstep events
    if (this.speed > 0.3) {
      this.walkCycle += dt * (this.speed * 2.1 + 1.5);
      this.footstepAccum += dt * (this.speed * 1.4 + 0.6);
      if (this.footstepAccum > 1) {
        this.footstepAccum = 0;
        this.onFootstep && this.onFootstep(this.speed);
      }
    } else {
      this.walkCycle += dt * 0.4;
    }

    this._animate(dt);
  }

  _animate(dt) {
    const p = this.parts;
    if (this.state === 'dig-active') {
      this.digTimer += dt;
      const t = this.digTimer;
      const swing = Math.sin(t * Math.PI * 2 / .4);
      p.armR.pivot.rotation.x = -1.9 + swing * 0.55;
      p.armL.pivot.rotation.x = -0.5 + swing * 0.2;
      p.hips.rotation.x = 0.28 + Math.max(0, swing) * 0.08;
      const step=Math.sin(this.walkCycle)*Math.min(.45,this.speed*.35);
      p.legL.pivot.rotation.x = -.1+step;
      p.legR.pivot.rotation.x = .1-step;
      return;
    }
    if (this.state === 'carry') {
      p.armR.pivot.rotation.x = -1.7;
      p.armL.pivot.rotation.x = -1.7;
      p.armR.pivot.rotation.z = -0.35;
      p.armL.pivot.rotation.z = 0.35;
    } else {
      p.armR.pivot.rotation.z = 0;
      p.armL.pivot.rotation.z = 0;
    }

    const swing = Math.sin(this.walkCycle) * Math.min(1, this.speed / 2.2);
    const legSwing = swing * 0.7;
    p.legL.pivot.rotation.x = legSwing;
    p.legR.pivot.rotation.x = -legSwing;

    // A tidy adult stride keeps the arms as a clean mirror of the legs. A kid
    // running flat out doesn't bother being efficient - past a walking pace,
    // blend in a wider swing plus a faster, slightly-off-phase wobble that
    // breaks the left/right mirror, so a full sprint reads as flailing effort
    // rather than a smooth gait. Below that pace it's untouched (runT = 0).
    const runT = THREE.MathUtils.clamp((this.speed - 2.3) / 2.3, 0, 1);
    if (this.state !== 'carry') {
      const flail = Math.sin(this.walkCycle * 2.6 + 0.7) * 0.35;
      const armSwing = THREE.MathUtils.lerp(-legSwing * 0.8, -legSwing * 1.8 + flail, runT);
      p.armL.pivot.rotation.x = armSwing;
      p.armR.pivot.rotation.x = -armSwing - flail * 1.6 * runT;
    }
    p.hips.position.y = 0.254 + Math.abs(Math.cos(this.walkCycle)) * (0.018 + runT * 0.014) * Math.min(1, this.speed / 2);
    p.hips.rotation.z = Math.sin(this.walkCycle) * 0.09 * runT;
    p.hips.rotation.x = THREE.MathUtils.lerp(p.hips.rotation.x, 0, 0.2);
  }

  startDig() {
    if(this.state==='dig-active')return;
    this.state = 'dig-active';
    this.digTimer = 0;
  }

  stopDig() {
    if (this.state === 'dig-active') this.state = 'idle';
  }

  aheadPoint(distance = 1.1) {
    return new THREE.Vector3(
      this.pos.x + Math.sin(this.facing) * distance,
      0,
      this.pos.z + Math.cos(this.facing) * distance,
    );
  }
}
