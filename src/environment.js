import * as THREE from 'three';
import { GRID, CELL, SIZE, coastT, warpX, insetCells, streamCenterX } from './terrain.js?v=71';
import { Noise2D } from './noise.js?v=71';

const decoNoise = new Noise2D(555);

export function buildSky(scene) {
  const geo = new THREE.SphereGeometry(900, 32, 20);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: {
      uTop: { value: new THREE.Color('#2f7cb8') },
      uHorizon: { value: new THREE.Color('#bcd9e3') },
      uBottom: { value: new THREE.Color('#dcd2bd') },
      uTime: { value: 0 },
    },
    vertexShader: `
      varying vec3 vPos;
      void main() {
        vPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vPos;
      uniform vec3 uTop, uHorizon, uBottom;
      uniform float uTime;

      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        float a = hash(i), b = hash(i + vec2(1.0, 0.0));
        float c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
      }
      float fbm(vec2 p) {
        float v = 0.0, amp = 0.55;
        for (int i = 0; i < 5; i++) { v += amp * noise(p); p *= 2.02; amp *= 0.55; }
        return v;
      }

      void main() {
        vec3 dir = normalize(vPos);
        float h = dir.y;
        vec3 col = h > 0.0 ? mix(uHorizon, uTop, smoothstep(0.0, 0.55, h))
                           : mix(uHorizon, uBottom, smoothstep(0.0, -0.25, h));

        if (h > 0.02) {
          vec2 cp = dir.xz / max(0.12, h + 0.25) * 1.4 + vec2(uTime * 0.006, uTime * 0.003);
          float clouds = fbm(cp * 1.6);
          clouds = smoothstep(0.52, 0.88, clouds) * smoothstep(0.02, 0.25, h);
          vec3 cloudColor = mix(vec3(0.86, 0.89, 0.90), vec3(1.0, 1.0, 0.99), 0.5);
          col = mix(col, cloudColor, clouds * 0.85);
        }
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const sky = new THREE.Mesh(geo, mat);
  scene.add(sky);
  return sky;
}

export function buildOcean(waterUniforms) {
  const geo = new THREE.PlaneGeometry(2200, 1400, 120, 80);
  geo.rotateX(-Math.PI / 2);
  geo.translate(SIZE / 2, 0, SIZE + 500);

  const mat = new THREE.ShaderMaterial({
    transparent: true,
    uniforms: {
      uTime: { value: 0 },
      uTideLevel: waterUniforms.uTideLevel,
      uDeep: { value: new THREE.Color('#155e82') },
      uMid: { value: new THREE.Color('#3fb8b0') },
      uSunDir: waterUniforms.uSunDir,
    },
    vertexShader: `
      varying vec3 vWorldPos;
      varying vec3 vNormal;
      varying float vCrest;
      uniform float uTime;
      uniform float uTideLevel;
      void main() {
        vec3 pos = position;
        float swell = sin(pos.x * 0.02 + uTime * 0.55) * 0.35 + cos(pos.z * 0.017 - uTime * 0.4) * 0.3;
        float chop = sin(pos.x * 0.12 + pos.z * 0.09 + uTime * 1.7) * 0.05;
        pos.y += uTideLevel + swell + chop;

        // Surf sets: wave crests travel toward shore (this plane's local -z is the
        // shoreline, translated at world z = SIZE) and rear up into breakers as they
        // shoal, matching the same crest system the near-shore water mesh uses.
        float shoreZone = smoothstep(300.0, -450.0, pos.z);
        // Decreasing local z is toward shore here (see the comment above) - the
        // comment already said crests should travel shoreward, but the formula's
        // sign did the opposite (sent them out to sea). Matches the same fix in
        // water.js's near-shore crest shader.
        float wavePhase = fract((pos.z + uTime * 5.5) / 7.5);
        float crest = pow(max(0.0, sin(wavePhase * 6.28318)), 5.0);
        pos.y += crest * shoreZone * 0.55;
        vCrest = crest * shoreZone;

        vec4 world = modelMatrix * vec4(pos, 1.0);
        vWorldPos = world.xyz;
        vNormal = normalize(vec3(-0.02*cos(pos.x*0.12+pos.z*0.09+uTime*1.7), 1.0, -0.02*sin(pos.x*0.12+pos.z*0.09+uTime*1.7)));
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: `
      varying vec3 vWorldPos;
      varying vec3 vNormal;
      varying float vCrest;
      uniform vec3 uDeep, uMid, uSunDir;
      uniform float uTime;
      void main() {
        float fresnel = pow(1.0 - clamp(dot(normalize(vNormal), vec3(0.0,1.0,0.0)), 0.0, 1.0), 2.5);
        // From this game's elevated top-down camera the fresnel term rarely climbs
        // high, so give the blend a floor - the sea should read as blue-green even
        // looking straight down, not only at grazing horizon angles.
        vec3 col = mix(uDeep, uMid, clamp(fresnel + 0.4, 0.0, 1.0)) * 1.15;
        float sparkle = pow(max(0.0, dot(normalize(vNormal), normalize(uSunDir))), 40.0);
        col += sparkle * 0.6;
        float surfFoam = smoothstep(0.25, 0.8, vCrest);
        col = mix(col, vec3(0.94, 0.97, 0.96), surfFoam * 0.85);
        float fog = smoothstep(300.0, 1100.0, distance(vWorldPos.xz, vec2(${(SIZE / 2).toFixed(1)}, ${SIZE.toFixed(1)})));
        col = mix(col, vec3(0.82, 0.86, 0.85), fog * 0.8);
        gl_FragColor = vec4(col, 0.82);
      }
    `,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 1;
  return { mesh, uniforms: mat.uniforms };
}

// A genuine curling/breaking wave - a heightfield can only hold one Y per (x,z), so
// it can never fold over itself. This is a separate strip of geometry (u = along the
// shore, v = progress around the barrel's cross-section) that the vertex shader
// morphs between a flat swell (v traces a shallow bump) and a full overhead tube
// (v traces a spiral that curls past vertical and back down onto the water), driven
// by a "peel" that travels along the shore over time - so different stretches of
// the break are caught at different stages: building, standing up, throwing over,
// collapsing to foam - the way a real point break peels down the line.
export function buildSurfTube(waterUniforms) {
  const U_SEGS = 160, V_SEGS = 28;
  const geo = new THREE.PlaneGeometry(1, 1, U_SEGS, V_SEGS);
  const pos = geo.attributes.position;
  const uArr = new Float32Array(pos.count);
  const vArr = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    uArr[i] = pos.getX(i) + 0.5;   // 0..1 along the shore
    vArr[i] = pos.getY(i) + 0.5;   // 0..1 around the barrel cross-section
  }
  geo.setAttribute('aU', new THREE.BufferAttribute(uArr, 1));
  geo.setAttribute('aV', new THREE.BufferAttribute(vArr, 1));

  const uniforms = {
    uTime: { value: 0 },
    uShoreZ: { value: 0 },
    uWidth: { value: SIZE },
    uTideLevel: waterUniforms.uTideLevel,
    uDeep: waterUniforms.uDeepColor,
    uFoam: { value: new THREE.Color('#f2f8f5') },
    uSunDir: waterUniforms.uSunDir,
  };

  const mat = new THREE.ShaderMaterial({
    transparent: true,
    side: THREE.DoubleSide,
    uniforms,
    vertexShader: /* glsl */`
      attribute float aU;
      attribute float aV;
      uniform float uTime, uShoreZ, uWidth, uTideLevel;
      varying float vCurl;
      varying float vV;
      varying vec3 vWorldPos;
      varying vec3 vNormal;

      void main() {
        // A few overlapping peel bands so more than one section of the beach is
        // "live" at once, each drifting sideways at slightly different speed/phase -
        // reads as a real irregular point break, not one uniform pulsing wall.
        float peel = 0.0;
        for (int b = 0; b < 3; b++) {
          float fb = float(b);
          float speed = 0.05 + fb * 0.021;
          float freq = 2.2 + fb * 1.3;
          float phase = fract(aU * freq - uTime * speed + fb * 0.37);
          float d = abs(phase - 0.5);
          peel = max(peel, smoothstep(0.24, 0.0, d));
        }
        float curl = pow(clamp(peel, 0.0, 1.0), 1.4);

        // fade the whole effect out right at the map edges (rocky headlands, not surf beach)
        float edgeMask = smoothstep(0.0, 0.06, aU) * smoothstep(1.0, 0.94, aU);
        curl *= edgeMask;

        float R = 1.5 + 0.35 * sin(aU * 23.0 + uTime * 0.15);
        float maxAngle = 3.14159265 * 1.5;
        float angle = aV * maxAngle;

        float flatY = 0.22 * sin(aV * 3.14159265);
        float flatZ = (aV - 0.5) * 0.6;

        float tubeY = R * (1.0 - cos(angle));
        float tubeZ = -R * sin(angle) * 1.15;

        float y = mix(flatY, tubeY, curl);
        float z = mix(flatZ, tubeZ, curl);

        vec3 wp = vec3(aU * uWidth, uTideLevel + y, uShoreZ + z);

        // approximate normal from nearby samples along v (enough for shading a stylised barrel)
        float dv = 0.01;
        float angle2 = min(aV + dv, 1.0) * maxAngle;
        float y2 = mix(0.22 * sin(min(aV + dv, 1.0) * 3.14159265), R * (1.0 - cos(angle2)), curl);
        float z2 = mix((min(aV + dv, 1.0) - 0.5) * 0.6, -R * sin(angle2) * 1.15, curl);
        vec3 tangent = normalize(vec3(0.0, y2 - y, z2 - z) + vec3(0.0, 0.0001, 0.0));
        vNormal = normalize(cross(tangent, vec3(1.0, 0.0, 0.0)));

        vCurl = curl;
        vV = aV;
        vWorldPos = wp;
        gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(wp, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      uniform vec3 uDeep, uFoam, uSunDir;
      varying float vCurl;
      varying float vV;
      varying vec3 vWorldPos;
      varying vec3 vNormal;
      void main() {
        if (vCurl < 0.03) discard;
        vec3 n = normalize(vNormal);
        float diff = clamp(dot(n, normalize(uSunDir)), 0.0, 1.0);
        // backlit translucency: the inside of a barrel glows where sun shines through it
        float backlight = pow(clamp(dot(-n, normalize(uSunDir)), 0.0, 1.0), 2.0);
        vec3 glassy = mix(uDeep, vec3(0.55, 0.85, 0.8), backlight * 0.8);
        vec3 base = glassy * (0.55 + diff * 0.7);
        float lip = smoothstep(0.72, 1.0, vV) * vCurl;      // the curling lip is whitewater
        float wash = smoothstep(0.0, 0.12, vCurl) * (1.0 - smoothstep(0.05, 0.4, vCurl)); // just-forming edge foams thin
        float foam = clamp(lip * 1.0 + wash * 0.6, 0.0, 1.0);
        vec3 color = mix(base, uFoam, foam);
        float alpha = clamp(vCurl * 1.3, 0.0, 0.96);
        gl_FragColor = vec4(color, alpha);
      }
    `,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  return { mesh, uniforms };
}

// Instanced decorative props: pebbles, grass tufts, driftwood - scattered by noise so they read as natural clutter.
export function scatterProps(terrain) {
  const group = new THREE.Group();

  // Pebbles
  const pebbleGeo = new THREE.DodecahedronGeometry(1, 0);
  // White base colour - per-instance colour (below) carries all the actual
  // variation, rather than every pebble sharing one flat grey-brown.
  const pebbleMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, flatShading: true });
  const pebbleCount = 900;
  const pebbles = new THREE.InstancedMesh(pebbleGeo, pebbleMat, pebbleCount);
  pebbles.castShadow = true;
  pebbles.receiveShadow = true;
  const dummy = new THREE.Object3D();
  const pebbleTones = ['#8a8477', '#6f6a5c', '#9a9082', '#5c584c', '#7e7869'].map((c) => new THREE.Color(c));
  const tmpPebble = new THREE.Color();
  let pc = 0;
  for (let n = 0; n < pebbleCount * 3 && pc < pebbleCount; n++) {
    const x = Math.random() * SIZE, z = Math.random() * SIZE * 0.85 + SIZE * 0.05;
    const t = z / SIZE;
    const density = decoNoise.fbm(x * 0.05, z * 0.05, 3);
    // Coves and points shift where land actually ends at this x - use the real
    // coastline instead of a flat cutoff, or pebbles end up floating in the sea
    // (in a cove) or missing from newly-exposed sand (on a point).
    const coast = coastT(Math.round(x / CELL));
    if (density < 0.05 || t > coast) continue;
    const y = terrain.sampleHeightBilinear(x, z);
    const scale = 0.08 + Math.random() * 0.16;
    dummy.position.set(warpX(x, z), y + scale * 0.3, z);
    dummy.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
    dummy.scale.set(scale, scale * 0.7, scale);
    dummy.updateMatrix();
    pebbles.setMatrixAt(pc, dummy.matrix);
    // Pebbles right at the waterline (small coast - t gap) read darker/wetter,
    // like the real dark, damp rocks scattered at a tideline - drier ones further
    // up the beach pick a random tone from the drier end of the palette.
    const wetness = THREE.MathUtils.clamp(1 - (coast - t) / 0.06, 0, 1);
    tmpPebble.copy(pebbleTones[Math.floor(Math.random() * pebbleTones.length)]);
    tmpPebble.lerp(new THREE.Color('#2c2822'), wetness * 0.6);
    pebbles.setColorAt(pc, tmpPebble);
    pc++;
  }
  pebbles.count = pc;
  group.add(pebbles);

  // Marram-grass tufts on the dunes: small tapered blades, low and dense so they
  // read as ground texture rather than as standalone objects.
  const bladeGeo = new THREE.ConeGeometry(0.035, 0.34, 3, 1, true);
  bladeGeo.translate(0, 0.17, 0);
  // White base colour - per-instance colour (below) supplies the actual warm/cool
  // variation real grass has, rather than every blade sharing one flat green.
  const grassMat = new THREE.MeshStandardMaterial({
    color: '#ffffff', roughness: 0.92, flatShading: true, side: THREE.DoubleSide,
  });
  const grassCool = new THREE.Color('#5f7a45');
  const grassWarmC = new THREE.Color('#9aa250');
  const tmpBlade = new THREE.Color();
  const grassCount = 3200;
  const grass = new THREE.InstancedMesh(bladeGeo, grassMat, grassCount);
  let gc = 0;
  for (let n = 0; n < grassCount * 2.4 && gc < grassCount; n++) {
    const cx = Math.random() * SIZE, cz = Math.random() * SIZE * 0.42;
    const t = cz / SIZE;
    const duneMask = Math.exp(-Math.pow((t - 0.12) / 0.11, 2)) + Math.exp(-Math.pow((t - 0.30) / 0.09, 2)) * 0.6;
    const density = decoNoise.fbm(cx * 0.06 + 12, cz * 0.06 + 12, 3) * 0.5 + 0.5;
    if (duneMask * density < 0.4) continue;
    // Denser clumps (was 1-2 blades, now 2-4) so the dunes read as lush turf
    // rather than sparse scattered dots.
    const clumpSize = 2 + Math.floor(Math.random() * 3);
    for (let c = 0; c < clumpSize && gc < grassCount; c++) {
      const x = cx + (Math.random() - 0.5) * 0.6;
      const z = cz + (Math.random() - 0.5) * 0.6;
      const y = terrain.sampleHeightBilinear(x, z);
      const scaleY = 0.55 + Math.random() * 0.75;
      const scaleXZ = 0.7 + Math.random() * 0.6;
      dummy.position.set(warpX(x, z), y, z);
      dummy.rotation.set((Math.random() - 0.5) * 0.5, Math.random() * Math.PI, (Math.random() - 0.5) * 0.5);
      dummy.scale.set(scaleXZ, scaleY, scaleXZ);
      dummy.updateMatrix();
      grass.setMatrixAt(gc, dummy.matrix);
      const warmth = decoNoise.fbm(x * 0.15 + 700, z * 0.15 + 700, 2) * 0.5 + 0.5;
      tmpBlade.copy(grassCool).lerp(grassWarmC, warmth).multiplyScalar(0.85 + Math.random() * 0.3);
      grass.setColorAt(gc, tmpBlade);
      gc++;
    }
  }
  grass.count = gc;
  grass.castShadow = false;
  group.add(grass);

  // Clifftop grass: the headlands rise well above the beach and, in the real
  // place, are capped in real turf - terrain.js's own vertex colouring tints this
  // (see clifftopGrass there), but a flat colour tint alone reads as a green-washed
  // rock cap next to the dune tufts' actual 3D blades. Scatter the same blade prop
  // across any sufficiently high, gentle-sloped ground (not just the inland dune
  // band above), so the clifftops read as real lush grass, not sparse dots on rock.
  const cliffGrassCount = 1800;
  const cliffGrass = new THREE.InstancedMesh(bladeGeo, grassMat, cliffGrassCount);
  let cgc = 0;
  for (let n = 0; n < cliffGrassCount * 6 && cgc < cliffGrassCount; n++) {
    const cx = Math.random() * SIZE, cz = Math.random() * SIZE;
    const y = terrain.sampleHeightBilinear(cx, cz);
    // Same south/north asymmetry as terrain.js's own clifftopGrass and this
    // file's buildSkirt: a flat 4.5/0.42 cutoff here meant the south hill's
    // vertex-COLOUR was already grassed much lower (see terrain.js) but these
    // actual 3D grass-blade instances still only appeared above the same old
    // uniform threshold - so the south hill's lower slopes read as a flat
    // green-painted surface with no real blade texture, while the colour and
    // the geometry disagreed about how grassy it was. Bias both thresholds by
    // the same rockAllow curve so the blades actually cover what the colour
    // pass already promised.
    const northT = THREE.MathUtils.clamp(cx / SIZE, 0, 1);
    const northSmooth = northT * northT * (3 - 2 * northT);
    const rockAllow = 0.22 + 0.78 * northSmooth;
    const southGrassBoost = 1 - rockAllow;
    const heightThresh = 4.5 - 3.2 * southGrassBoost;
    // A real grassy hill (south end) is still fairly steep by nature - it's
    // still a headland, just a rounded/grassed one, not gentle like a dune -
    // so this needs a genuinely generous slope allowance there, not a token
    // bump, or almost every candidate on the actual slope keeps failing the
    // slope test and the hill ends up bladeless anyway regardless of the
    // height threshold above.
    const slopeMax = 0.42 + 0.75 * southGrassBoost;
    if (y < heightThresh) continue;
    const eps = 0.6;
    const hx1 = terrain.sampleHeightBilinear(cx + eps, cz), hx0 = terrain.sampleHeightBilinear(cx - eps, cz);
    const hz1 = terrain.sampleHeightBilinear(cx, cz + eps), hz0 = terrain.sampleHeightBilinear(cx, cz - eps);
    const slope = (Math.abs(hx1 - hx0) + Math.abs(hz1 - hz0)) / (4 * eps);
    if (slope > slopeMax) continue; // too steep - bare cliff face, not turf
    const density = decoNoise.fbm(cx * 0.15 + 300, cz * 0.15 + 300, 3);
    if (density < 0.25 - 0.15 * southGrassBoost) continue;
    const clumpSize = 2 + Math.floor(Math.random() * 3);
    for (let c = 0; c < clumpSize && cgc < cliffGrassCount; c++) {
      const x = cx + (Math.random() - 0.5) * 0.6;
      const z = cz + (Math.random() - 0.5) * 0.6;
      const yy = terrain.sampleHeightBilinear(x, z);
      const scaleY = 0.6 + Math.random() * 0.8;
      const scaleXZ = 0.75 + Math.random() * 0.6;
      dummy.position.set(warpX(x, z), yy, z);
      dummy.rotation.set((Math.random() - 0.5) * 0.5, Math.random() * Math.PI, (Math.random() - 0.5) * 0.5);
      dummy.scale.set(scaleXZ, scaleY, scaleXZ);
      dummy.updateMatrix();
      cliffGrass.setMatrixAt(cgc, dummy.matrix);
      // Clifftops catch more open sky/sun than the sheltered dune band, so bias
      // warmer/golder on average - matches the reference photos' sunlit headland turf.
      const warmth = decoNoise.fbm(x * 0.15 + 700, z * 0.15 + 700, 2) * 0.5 + 0.65;
      tmpBlade.copy(grassCool).lerp(grassWarmC, THREE.MathUtils.clamp(warmth, 0, 1)).multiplyScalar(0.85 + Math.random() * 0.3);
      cliffGrass.setColorAt(cgc, tmpBlade);
      cgc++;
    }
  }
  cliffGrass.count = cgc;
  cliffGrass.castShadow = false;
  group.add(cliffGrass);

  // Driftwood
  const woodGeo = new THREE.CylinderGeometry(0.09, 0.13, 2.4, 6);
  const woodMat = new THREE.MeshStandardMaterial({ color: '#a08662', roughness: 0.85, flatShading: true });
  const woodCount = 14;
  const wood = new THREE.InstancedMesh(woodGeo, woodMat, woodCount);
  wood.castShadow = true;
  for (let n = 0; n < woodCount; n++) {
    const x = Math.random() * SIZE, z = SIZE * 0.42 + Math.random() * SIZE * 0.22;
    const y = terrain.sampleHeightBilinear(x, z);
    dummy.position.set(warpX(x, z), y + 0.1, z);
    dummy.rotation.set(Math.PI / 2 + (Math.random() - 0.5) * 0.3, 0, Math.random() * Math.PI);
    dummy.scale.setScalar(0.6 + Math.random() * 0.8);
    dummy.updateMatrix();
    wood.setMatrixAt(n, dummy.matrix);
  }
  group.add(wood);

  // A single sea-arch at the tip of the right-hand headland - a small nod toward
  // "rocks and caves" without reworking the whole rectangular map into a true
  // irregular bay (a much larger change - would touch the water sim's grid
  // indexing, spawn logic, and the ocean/skirt bounds). Purely decorative: two
  // rock stacks with a rough lintel bridging them, no collision.
  const archMat = new THREE.MeshStandardMaterial({ color: '#6b6a63', roughness: 0.97, flatShading: true });
  const archX = SIZE * 0.90;
  // The coastline itself now wanders a lot (real coves/points), so find where it
  // actually sits at this column rather than assuming the old flat ~0.62 cutoff.
  const archZ = SIZE * coastT(Math.round(archX / CELL));
  const archGroup = new THREE.Group();
  const stackGeo = new THREE.DodecahedronGeometry(1, 0);
  for (const side of [-1, 1]) {
    const sx = archX + side * 2.6;
    const sy = terrain.sampleHeightBilinear(sx, archZ);
    const stack = new THREE.Mesh(stackGeo, archMat);
    stack.position.set(sx, sy + 2.1, archZ + (Math.random() - 0.5) * 0.6);
    stack.scale.set(1.5, 2.4, 1.5);
    stack.rotation.set(Math.random() * 0.3, Math.random() * Math.PI, Math.random() * 0.2);
    stack.castShadow = true;
    stack.receiveShadow = true;
    archGroup.add(stack);
  }
  const lintelY = terrain.sampleHeightBilinear(archX, archZ) + 3.6;
  const lintel = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.35, 5.6, 7), archMat);
  lintel.rotation.z = Math.PI / 2;
  lintel.position.set(archX, lintelY, archZ);
  lintel.castShadow = true;
  archGroup.add(lintel);
  group.add(archGroup);

  return group;
}

// Builds a 1D list of sample coordinates covering [lo, hi]: a fine, uniform
// "core" band from coreLo to coreHi (coreStep apart), then geometrically
// growing steps out to lo/hi on either side. Used below so the skirt's mesh
// resolution is dense right where it actually has to trace the real terrain's
// warped boundary (see the TESTING_FEEDBACK.md note on a visible sky/gap seam
// there - the skirt used to be a uniform ~10m/cell grid, far too coarse to
// follow a boundary that moves by double-digit metres over a much shorter
// span) while staying cheap everywhere else (the distant decorative hills
// don't need to trace anything, just look plausible from a distance).
function buildAxisSamples(lo, hi, coreLo, coreHi, coreStep, growth) {
  const mid = [];
  for (let v = coreLo; v <= coreHi + 1e-6; v += coreStep) mid.push(v);
  const left = [];
  { let v = coreLo, step = coreStep; while (v > lo) { step *= growth; v -= step; left.push(v); } }
  left.reverse();
  const right = [];
  { let v = coreHi, step = coreStep; while (v < hi) { step *= growth; v += step; right.push(v); } }
  return [lo, ...left, ...mid, ...right, hi];
}

// A large low-poly surrounding landscape so zooming out reveals rolling hills
// rather than the hard edge of the terrain plane against the sky. Purely
// decorative - no simulation, no collision.
export function buildSkirt(terrain) {
  const span = SIZE * 5;
  const halfSpan = span / 2;
  // Dense core band spans a bit past the real terrain's own extent on every
  // side (where the warped boundary and the dune-line/sea-edge transitions
  // actually live) at ~1.5m/sample - roughly 7x finer than the old uniform
  // 56-segment grid (~10.25m/sample) - then grows geometrically out to the
  // full span, which only ever needs to look right from a distance.
  const coreStep = 1.5;
  const growth = 1.4;
  const xs = buildAxisSamples(SIZE / 2 - halfSpan, SIZE / 2 + halfSpan, -SIZE * 0.25, SIZE * 1.25, coreStep, growth);
  const zs = buildAxisSamples(SIZE / 2 - halfSpan, SIZE / 2 + halfSpan, -SIZE * 0.25, SIZE * 1.25, coreStep, growth);
  const nx = xs.length, nz = zs.length;

  const positions = new Float32Array(nx * nz * 3);
  const colors = new Float32Array(nx * nz * 3);
  const uvs = new Float32Array(nx * nz * 2);
  // This surround is what's actually visible flanking the beach at any real
  // distance, so it needs to read as the SAME coastline the real terrain
  // does (dark, strata-banded slate, grass only right at the top) rather than
  // a flat green wall - a real Cornish headland doesn't turn into a green
  // hillside a few metres past the sand, it keeps being cliff for a long way.
  // Palette matched to terrain.js's own upgraded rock/grass tones so the real
  // (simulated) terrain and this decorative surround read as one continuous
  // material, not two different-looking rock types stitched together.
  // Re-graded against actual reference photos (not a text description) - real
  // Mawgan Porth slate is a COOL charcoal/near-black, essentially no warm
  // brown in it. Matches terrain.js's own re-graded palette so the simulated
  // terrain and this decorative surround still read as one continuous
  // material.
  const rockDark = new THREE.Color('#121316');
  const rockMid = new THREE.Color('#3c3f42');
  const rockLight = new THREE.Color('#8b8d87');
  const grassPatch = new THREE.Color('#526b3a');
  const grassWarm = new THREE.Color('#8fa04a'); // warm, sun-bleached variant - see terrain.js's grassWarmth
  const farHill = new THREE.Color('#7f9296'); // distant hills, hazed by atmospheric perspective
  const tmpC = new THREE.Color();
  const tmpGrass = new THREE.Color();

  for (let jz = 0; jz < nz; jz++) {
    const z = zs[jz];
    // The real terrain's own left/right edges now taper inward toward the dune
    // line (see terrain.js warpX/insetCells) instead of running the full [0, SIZE]
    // width - use those exact same per-side warped bounds here (insetCells is
    // no longer symmetric - each side reads its own real coastline data), or
    // this hill rise would only start at the old, wider fixed edges and leave
    // a visible gap of nothing between the narrowed sand and the rising
    // background.
    const t = z / SIZE;
    const leftInset = insetCells(0, t) * 0.8 * CELL;
    const rightInset = insetCells(GRID - 1, t) * 0.8 * CELL;
    const left = leftInset, right = SIZE - rightInset;
    const dzLand = Math.max(0, -z);
    const dzSea = Math.max(0, z - SIZE);

    // The stream has to visibly come FROM somewhere: without this, the inland
    // edge (z<0, upstream of the simulated grid) rose into cliff exactly like
    // the lateral sides, so the river simply dead-ended into a flat rock wall
    // with a rectangular water-mesh cutoff - "why do the edges just stop".
    // streamCenterX(z) extrapolates smoothly for z<0, so sampling it out here
    // continues the same meander upstream and gives a valley mouth the water
    // plausibly flows out of, rather than a static slot.
    const streamXHere = streamCenterX(z);

    for (let ix = 0; ix < nx; ix++) {
      const x = xs[ix];
      const k = jz * nx + ix;
      const dxOut = Math.max(0, left - x, x - right);
      let dzLandEff = dzLand;
      if (dzLand > 0) {
        const distFromStream = Math.abs(x - streamXHere);
        const notchWidth = 9 + dzLand * 0.25; // widens gradually further upstream
        const notchFactor = THREE.MathUtils.clamp(1 - distFromStream / notchWidth, 0, 1);
        const eased = notchFactor * notchFactor * (3 - 2 * notchFactor);
        dzLandEff = dzLand * (1 - eased * 0.92);
      }
      const outside = Math.max(dxOut, dzLandEff);

      // The two real headlands are NOT symmetric (confirmed against an
      // eye-level reference photo showing both in one frame): the south end
      // (low x, Berryl's Point) is a smooth, rounded, mostly grassy hill;
      // the north end (high x, Trenance Point, where the stream enters) is
      // the genuinely jagged, fractured dark rock cliff. `rockJagged` fades
      // the fractured-silhouette ridge noise (and, below, the exposed-rock
      // strata/colour) down toward the south so that side reads as a rounded,
      // grassy hillside instead of an equally shattered dark cliff. Computed
      // once here so both the height rise and the colour pass below share it.
      const northT = THREE.MathUtils.clamp(x / SIZE, 0, 1);
      const rockJagged = 0.3 + 0.7 * (northT * northT * (3 - 2 * northT));

      let y;
      if (outside <= 0 && dzSea <= 0) {
        // directly under the real (simulated) terrain - hide it away entirely
        y = -60;
      } else if (dzSea > 0 && outside <= 0) {
        // seaward beyond the beach - sink below the ocean surface so it's hidden
        y = -6 - dzSea * 0.4;
      } else {
        // A real Cornish headland is a near-vertical rock face RIGHT at the sand,
        // not a hill that only reaches real height 100+ metres back - the old
        // single power curve normalised against SIZE*1.4 (~160m) meant the whole
        // visible foreground next to the beach was still under 10% risen, reading
        // as flat brown ground. `nearRise` reaches full height within ~15m so the
        // cliff is actually there in the same shot as the beach; `farRise` is the
        // much slower continued climb into believable distant hilltops beyond it.
        const nearRise = Math.pow(Math.min(1, outside / 15), 0.5);
        const farRise = Math.pow(Math.min(1, outside / (SIZE * 1.4)), 0.75);
        const rise = nearRise * 0.75 + farRise * 0.5;

        // Domain-warp the sampling coordinate before any ridge noise. Without
        // this, every ridge's amplitude is purely a function of distance from
        // the (smooth) boundary contour, so the whole face reads as concentric
        // rings/corduroy parallel to the coastline - a dead giveaway of
        // procedural code, and exactly the "still looks like shit" fan pattern.
        // Warping the noise INPUT (not the actual vertex position) breaks that
        // correlation while leaving the mesh topology untouched.
        const warpX_ = x + decoNoise.fbm(x * 0.008 + 1000, z * 0.008 + 1000, 3) * 55;
        const warpZ_ = z + decoNoise.fbm(x * 0.008 + 3000, z * 0.008 + 3000, 3) * 55;
        const n = decoNoise.fbm(warpX_ * 0.012, warpZ_ * 0.012, 4);
        // Ridged (1-|noise|) multifractal for actual fractured-rock silhouette -
        // sharp V ridges/valleys - instead of the smooth rolling swell plain fbm
        // gives, at two independent scales for big fracture lines plus finer
        // crumbled detail. Gated by nearRise so distant hills stay soft/hazy.
        const bigRock = decoNoise.ridged(warpX_ * 0.02 + 500, warpZ_ * 0.02 + 500, 4) - 0.5;
        const fineRock = decoNoise.ridged(warpX_ * 0.09 + 900, warpZ_ * 0.09 + 900, 3) - 0.5;
        const edgeY = terrain.sampleHeightBilinear(
          THREE.MathUtils.clamp(x, 1, SIZE - 1),
          THREE.MathUtils.clamp(z, 1, SIZE - 1),
        );
        y = edgeY + rise * (30 + n * 14) + bigRock * 22 * nearRise * rockJagged + fineRock * 7 * nearRise * rockJagged;
        if (dzSea > 0) y -= dzSea * 0.6; // taper down toward the sea horizon at the far corners
      }
      positions[k * 3] = x; positions[k * 3 + 1] = y; positions[k * 3 + 2] = z;
      uvs[k * 2] = ix / (nx - 1); uvs[k * 2 + 1] = jz / (nz - 1);

      // Haze only kicks in well past the near cliff face - the old divisor
      // (SIZE*1.1) meant most of the visible rock right next to the beach was
      // already >50% blended toward pale grey-blue, washing out all the color
      // and shadow contrast that makes rock read as rock.
      const distT = THREE.MathUtils.clamp((outside - 60) / (SIZE * 2.2), 0, 1);
      // Fine, closely-spaced diagonal strata - real slate here is thin, tightly
      // packed layering (like a stack of paper), not a handful of fat
      // alternating blobs - the old 0.3/2.4 frequency read as the latter.
      // Mixing x into the phase alongside height still tilts the bands into
      // sloped strata instead of horizontal rings.
      //
      // CAUGHT AND FIXED (same bug as terrain.js's _colorAt, worse here since
      // this mesh samples every ~1.5m instead of ~0.2m): a large HEIGHT
      // coefficient aliases into a regular checkerboard/moire on any
      // near-vertical rise, because y can change many metres between adjacent
      // samples there while x barely moves - a phase term that multiplies raw
      // height by anything sizeable completes several sine cycles between
      // samples, which is undersampling, not banding. Keep y's coefficient
      // small (a gentle diagonal tilt only) and let x - which always changes
      // smoothly and slowly per sample regardless of slope - carry the actual
      // fine-band frequency.
      const strataPhase = x * 0.85 + y * 1.4;
      const strata = Math.sin(strataPhase) * 0.5 + 0.5;
      const fineStrataPhase = x * 2.9 + y * 1.9 + 1.1;
      const fineStrata = Math.sin(fineStrataPhase) * 0.5 + 0.5;
      const heightT = THREE.MathUtils.clamp(y / 55, 0, 1);
      // Same south/north rock-vs-grass bias as the ridge-noise silhouette
      // above and terrain.js's own clifftop grass - south hill shows far less
      // bare rock strata and grasses over far more of its slope.
      const rockAllow = 0.28 + 0.72 * rockJagged;
      const southGrassBoost = 1 - rockAllow;
      tmpC.copy(rockMid).lerp(rockLight, heightT * 0.7);
      tmpC.lerp(rockDark, (strata * 0.34 + fineStrata * 0.15) * rockAllow);
      // Alternate bands lighten toward the drier, higher rock tone (matches the
      // same real-strata technique in terrain.js's _colorAt) instead of every band
      // only ever darkening toward black - reads as actual banded rock, not a smudge.
      tmpC.lerp(rockLight, (1 - strata) * 0.15 * heightT);
      // The south hill's default surface (before the patchy grass overlay below)
      // was still this same bare rock tone everywhere the patch noise hadn't
      // happened to fire - reading as a grey rock wall with a few green speckles
      // rather than a grassy hillside with occasional bare rock. A real turf-
      // covered hill is grass-covered BY DEFAULT, with rock the exception, not
      // the other way round - so give the base tone itself a continuous turf
      // undercoat proportional to southGrassBoost, independent of the patch mask.
      tmpC.lerp(grassPatch, southGrassBoost * 0.6);
      // Grass in noise-patches (not a uniform cap) atop the rise. The onset used
      // to be y>34 - given typical rise commonly only reaches y~20-30 short of
      // the very tallest peaks, that meant almost no visible cliff ever actually
      // showed grass, real Cornish clifftops are grassed well down from their
      // highest points, not just their summits. Mixed warm/cool per its own
      // noise field, same technique as the real terrain's clifftop grass, so
      // this decorative surround doesn't read as a flatter single-tone green
      // next to the real, richer-coloured terrain right beside it. The south
      // hill's onset height/density is boosted so it reads as a grassy hill
      // with only a rock outcrop at its base, not a bare cliff with a green cap.
      const grassPatchNoise = decoNoise.fbm(x * 0.09 + 400, z * 0.09 + 400, 3);
      const grassWarmthNoise = decoNoise.fbm(x * 0.05 + 900, z * 0.05 + 900, 3);
      const grassOnsetY = 16 - 13 * southGrassBoost;
      const grassAmount = THREE.MathUtils.clamp((y - grassOnsetY) / 12, 0, 1)
        * THREE.MathUtils.clamp((grassPatchNoise - 0.05 + southGrassBoost * 0.5) * 1.8, 0, 1);
      tmpGrass.copy(grassPatch).lerp(grassWarm, THREE.MathUtils.clamp((grassWarmthNoise - 0.1) * 1.6, 0, 1));
      tmpC.lerp(tmpGrass, grassAmount * 0.92);
      // Distance haze toward hazy far-hill blue-grey, and toward the sea horizon.
      tmpC.lerp(farHill, distT * distT * 0.55);
      colors[k * 3] = tmpC.r; colors[k * 3 + 1] = tmpC.g; colors[k * 3 + 2] = tmpC.b;
    }
  }

  const indices = [];
  for (let jz = 0; jz < nz - 1; jz++) {
    for (let ix = 0; ix < nx - 1; ix++) {
      const a = jz * nx + ix, b = jz * nx + ix + 1;
      const c = (jz + 1) * nx + ix, d = (jz + 1) * nx + ix + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, flatShading: true });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = false;
  mesh.renderOrder = -1;
  return mesh;
}

export function buildBirds(scene) {
  const group = new THREE.Group();
  const geo = new THREE.ConeGeometry(0.18, 0.5, 4);
  geo.rotateX(Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({ color: '#e8e8e2', roughness: 0.7 });
  const count = 6;
  const birds = [];
  for (let i = 0; i < count; i++) {
    const m = new THREE.Mesh(geo, mat);
    const radius = 26 + Math.random() * 30;
    const speed = 0.08 + Math.random() * 0.06;
    const height = 14 + Math.random() * 10;
    const phase = Math.random() * Math.PI * 2;
    const center = new THREE.Vector3(SIZE * 0.5 + (Math.random() - 0.5) * 40, 0, SIZE * 0.75 + (Math.random() - 0.5) * 30);
    birds.push({ mesh: m, radius, speed, height, phase, center });
    group.add(m);
  }
  scene.add(group);
  return {
    group,
    update(t) {
      for (const b of birds) {
        const a = t * b.speed + b.phase;
        const x = b.center.x + Math.cos(a) * b.radius;
        const z = b.center.z + Math.sin(a) * b.radius;
        const y = b.height + Math.sin(t * 0.6 + b.phase) * 1.5;
        b.mesh.position.set(x, y, z);
        b.mesh.rotation.y = -a + Math.PI / 2;
        b.mesh.rotation.z = Math.sin(t * 6 + b.phase) * 0.15;
      }
    },
  };
}
