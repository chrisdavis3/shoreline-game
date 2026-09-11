import * as THREE from 'three';
import { GRID, CELL, SIZE, coastT } from './terrain.js?v=21';
import { Noise2D } from './noise.js?v=21';

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
        float wavePhase = fract((pos.z - uTime * 5.5) / 7.5);
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
  const pebbleMat = new THREE.MeshStandardMaterial({ color: '#8a8477', roughness: 0.95, flatShading: true });
  const pebbleCount = 900;
  const pebbles = new THREE.InstancedMesh(pebbleGeo, pebbleMat, pebbleCount);
  pebbles.castShadow = true;
  pebbles.receiveShadow = true;
  const dummy = new THREE.Object3D();
  let pc = 0;
  for (let n = 0; n < pebbleCount * 3 && pc < pebbleCount; n++) {
    const x = Math.random() * SIZE, z = Math.random() * SIZE * 0.85 + SIZE * 0.05;
    const t = z / SIZE;
    const density = decoNoise.fbm(x * 0.05, z * 0.05, 3);
    // Coves and points shift where land actually ends at this x - use the real
    // coastline instead of a flat cutoff, or pebbles end up floating in the sea
    // (in a cove) or missing from newly-exposed sand (on a point).
    if (density < 0.05 || t > coastT(Math.round(x / CELL))) continue;
    const y = terrain.sampleHeightBilinear(x, z);
    const scale = 0.08 + Math.random() * 0.16;
    dummy.position.set(x, y + scale * 0.3, z);
    dummy.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
    dummy.scale.set(scale, scale * 0.7, scale);
    dummy.updateMatrix();
    pebbles.setMatrixAt(pc++, dummy.matrix);
  }
  pebbles.count = pc;
  group.add(pebbles);

  // Marram-grass tufts on the dunes: small tapered blades, low and dense so they
  // read as ground texture rather than as standalone objects.
  const bladeGeo = new THREE.ConeGeometry(0.035, 0.34, 3, 1, true);
  bladeGeo.translate(0, 0.17, 0);
  const grassMat = new THREE.MeshStandardMaterial({
    color: '#748254', roughness: 0.95, flatShading: true, side: THREE.DoubleSide,
  });
  const grassCount = 1900;
  const grass = new THREE.InstancedMesh(bladeGeo, grassMat, grassCount);
  let gc = 0;
  for (let n = 0; n < grassCount * 2.2 && gc < grassCount; n++) {
    const cx = Math.random() * SIZE, cz = Math.random() * SIZE * 0.42;
    const t = cz / SIZE;
    const duneMask = Math.exp(-Math.pow((t - 0.12) / 0.11, 2)) + Math.exp(-Math.pow((t - 0.30) / 0.09, 2)) * 0.6;
    const density = decoNoise.fbm(cx * 0.06 + 12, cz * 0.06 + 12, 3) * 0.5 + 0.5;
    if (duneMask * density < 0.48) continue;
    // small clumps: place a handful of blades close together per accepted spot
    const clumpSize = 1 + Math.floor(Math.random() * 2);
    for (let c = 0; c < clumpSize && gc < grassCount; c++) {
      const x = cx + (Math.random() - 0.5) * 0.55;
      const z = cz + (Math.random() - 0.5) * 0.55;
      const y = terrain.sampleHeightBilinear(x, z);
      const scaleY = 0.55 + Math.random() * 0.75;
      const scaleXZ = 0.7 + Math.random() * 0.6;
      dummy.position.set(x, y, z);
      dummy.rotation.set((Math.random() - 0.5) * 0.5, Math.random() * Math.PI, (Math.random() - 0.5) * 0.5);
      dummy.scale.set(scaleXZ, scaleY, scaleXZ);
      dummy.updateMatrix();
      grass.setMatrixAt(gc, dummy.matrix);
      gc++;
    }
  }
  grass.count = gc;
  grass.castShadow = false;
  group.add(grass);

  // Driftwood
  const woodGeo = new THREE.CylinderGeometry(0.09, 0.13, 2.4, 6);
  const woodMat = new THREE.MeshStandardMaterial({ color: '#a08662', roughness: 0.85, flatShading: true });
  const woodCount = 14;
  const wood = new THREE.InstancedMesh(woodGeo, woodMat, woodCount);
  wood.castShadow = true;
  for (let n = 0; n < woodCount; n++) {
    const x = Math.random() * SIZE, z = SIZE * 0.42 + Math.random() * SIZE * 0.22;
    const y = terrain.sampleHeightBilinear(x, z);
    dummy.position.set(x, y + 0.1, z);
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

// A large low-poly surrounding landscape so zooming out reveals rolling hills
// rather than the hard edge of the terrain plane against the sky. Purely
// decorative - no simulation, no collision.
export function buildSkirt(terrain) {
  const span = SIZE * 5;
  const seg = 56;
  const geo = new THREE.PlaneGeometry(span, span, seg, seg);
  geo.rotateX(-Math.PI / 2);
  geo.translate(SIZE / 2, 0, SIZE / 2);

  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const grass = new THREE.Color('#5e6b48');
  const farHill = new THREE.Color('#7c8d84');
  const cliff = new THREE.Color('#6b6660');

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const dxOut = Math.max(0, -x, x - SIZE);
    const dzLand = Math.max(0, -z);
    const dzSea = Math.max(0, z - SIZE);
    const outside = Math.max(dxOut, dzLand);

    let y;
    if (outside <= 0 && dzSea <= 0) {
      // directly under the real (simulated) terrain - hide it away entirely
      y = -60;
    } else if (dzSea > 0 && outside <= 0) {
      // seaward beyond the beach - sink below the ocean surface so it's hidden
      y = -6 - dzSea * 0.4;
    } else {
      const n = decoNoise.fbm(x * 0.012, z * 0.012, 4);
      const rise = Math.pow(Math.min(1, outside / (SIZE * 1.4)), 0.75);
      const edgeY = terrain.sampleHeightBilinear(
        THREE.MathUtils.clamp(x, 1, SIZE - 1),
        THREE.MathUtils.clamp(z, 1, SIZE - 1),
      );
      y = edgeY + rise * (26 + n * 14);
      if (dzSea > 0) y -= dzSea * 0.6; // taper down toward the sea horizon at the far corners
    }
    pos.setY(i, y);

    const t = THREE.MathUtils.clamp(outside / (SIZE * 1.1), 0, 1);
    const c = grass.clone().lerp(farHill, t).lerp(cliff, Math.max(0, Math.min(1, (y - 30) / 20)));
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true });
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
