import * as THREE from 'three';
import { GRID, CELL, SIZE, streamCenterX, coastT } from './terrain.js?v=36';

// A shallow-water "virtual pipes" style grid simulation: cheap, stable, and
// visually convincing rather than physically exact. Water flows downhill
// through 4-neighbour flux, erodes soft sand, deposits sediment, and the
// seaward edge is coupled to the tide so the ocean can push back upriver.

const N = GRID;
const CELL_AREA = CELL * CELL;
const G = 9.8;
const PIPE_LEN = CELL;
// Average fallback used only by the shader's cosmetic surf-crest timing (porting
// the coastline's noise into GLSL isn't worth it for a purely visual effect) -
// every FUNCTIONAL sea-zone check below uses the real per-column coastT(i)
// instead, so the sim's idea of "where the sea starts" actually matches the
// rendered coastline's coves and points rather than a flat cutoff.
const SEA_ROW_T = 0.60;

function idx(i, j) { return j * N + i; }

export class WaterSim {
  constructor(terrain) {
    this.terrain = terrain;
    this.depth = new Float32Array(N * N);
    this.sediment = new Float32Array(N * N);
    this.flowSpeed = new Float32Array(N * N); // scalar magnitude, for erosion + rendering
    this.velX = new Float32Array(N * N);
    this.velZ = new Float32Array(N * N);

    // flux to +x, -x, +z, -z neighbours
    this.fR = new Float32Array(N * N);
    this.fL = new Float32Array(N * N);
    this.fU = new Float32Array(N * N);
    this.fD = new Float32Array(N * N);

    this.tideLevel = 0.4;
    this.tidePhase = Math.random() * Math.PI * 2;
    this.tidePeriod = 260; // seconds for a full tidal cycle - slow enough to notice, fast enough to see in one session
    this.tideRange = 1.9;  // metres of vertical rise/fall

    // Per-column coastline threshold, precomputed once - every functional sea-zone
    // check below reads this instead of recomputing the noise or using a flat cutoff.
    this._coastT = new Float32Array(N);
    for (let i = 0; i < N; i++) this._coastT[i] = coastT(i);

    this._seedSource();
    this._seedChannel(terrain);
    this._buildMesh();

    this._accum = 0;
    this.stepDt = 1 / 30; // fixed sim step, decoupled from render framerate
    this.elapsed = 0;
  }

  _seedSource() {
    // A few cells at the inland edge act as the stream's spring, feeding water
    // in at a steady rate as if from off-map upstream.
    this.sourceCells = [];
    for (let j = 0; j < 4; j++) {
      const z = j * CELL;
      const cx = streamCenterX(z);
      const ci = Math.round(cx / CELL);
      for (let di = -1; di <= 1; di++) {
        const i = ci + di;
        if (i >= 0 && i < N) this.sourceCells.push(idx(i, j));
      }
    }
  }

  // Precompute the channel's baseline depth profile once (reused every step as a
  // gentle "seepage" top-up - see _step) and seed it immediately so the stream
  // reads as continuous from the very first frame rather than needing the sim to
  // build it up from zero through a single fragile point source.
  _seedChannel(terrain) {
    this._seepProfile = [];
    for (let j = 0; j < N; j++) {
      const z = j * CELL;
      const t = z / SIZE;
      const ci = streamCenterX(z) / CELL;
      const channelCoastT = this._coastT[Math.round(THREE.MathUtils.clamp(ci, 0, N - 1))];
      if (t > channelCoastT) break; // the sea zone fills itself via tide relaxation
      const width = 2.4 + 2.4 * t;
      const i0 = Math.max(0, Math.floor(ci - width * 1.6));
      const i1 = Math.min(N - 1, Math.ceil(ci + width * 1.6));
      const row = [];
      for (let i = i0; i <= i1; i++) {
        const k = idx(i, j);
        if (terrain.blocked[k]) continue;
        const d = Math.abs(i - ci);
        const falloff = Math.exp(-Math.pow(d / width, 2));
        const target = 0.1 * falloff;
        row.push({ k, target });
        this.depth[k] = Math.max(this.depth[k], target);
      }
      this._seepProfile.push(row);
    }
    this._seepRows = this._seepProfile.length;
  }

  _buildMesh() {
    this.geometry = new THREE.PlaneGeometry(SIZE, SIZE, N - 1, N - 1);
    this.geometry.rotateX(-Math.PI / 2);
    this.geometry.translate(SIZE / 2, 0, SIZE / 2);
    this.depthAttr = new THREE.BufferAttribute(new Float32Array(N * N), 1);
    this.geometry.setAttribute('aDepth', this.depthAttr);
    this.flowAttr = new THREE.BufferAttribute(new Float32Array(N * N), 1);
    this.geometry.setAttribute('aFlow', this.flowAttr);
    this.flowDirAttr = new THREE.BufferAttribute(new Float32Array(N * N * 2), 2);
    this.geometry.setAttribute('aFlowDir', this.flowDirAttr);

    // The surf/wave-crest effect below needs to know where the REAL (per-column,
    // irregular) coastline is, not a flat cutoff - otherwise the breaking-wave
    // line shows up at the wrong depth in every cove and point, as a comb of
    // bumps in the wrong place rather than tracking the actual shore. This is a
    // constant per column, so it's set once here rather than every frame.
    const coastZArr = new Float32Array(N * N);
    for (let i = 0; i < N; i++) {
      const z = this._coastT[i] * SIZE;
      for (let j = 0; j < N; j++) coastZArr[idx(i, j)] = z;
    }
    this.geometry.setAttribute('aCoastZ', new THREE.BufferAttribute(coastZArr, 1));

    this.uniforms = {
      uTime: { value: 0 },
      uTideLevel: { value: this.tideLevel },
      uShallowColor: { value: new THREE.Color('#5cd0cc') },
      uDeepColor: { value: new THREE.Color('#1b6f8c') },
      uFoam: { value: new THREE.Color('#eef6f2') },
      uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.3).normalize() },
    };

    this.material = new THREE.ShaderMaterial({
      transparent: true,
      uniforms: this.uniforms,
      vertexShader: /* glsl */`
        attribute float aDepth;
        attribute float aFlow;
        attribute vec2 aFlowDir;
        attribute float aCoastZ;
        varying float vDepth;
        varying float vFlow;
        varying vec2 vFlowDir;
        varying float vCrest;
        varying vec3 vWorldPos;
        varying vec3 vNormal;
        uniform float uTime;
        void main() {
          vDepth = aDepth;
          vFlow = aFlow;
          vFlowDir = aFlowDir;
          vec3 pos = position;
          float ripple = sin(pos.x * 1.3 + uTime * 1.6) * 0.02 + cos(pos.z * 1.1 - uTime * 1.3) * 0.02;
          pos.y += (aDepth > 0.002) ? ripple * min(1.0, aDepth * 4.0) : 0.0;
          // Surf: wave crests travel toward shore (-z) and rear up as the water shoals,
          // giving the breaking-wave line a slight rolling bump right where it foams.
          // Anchored to aCoastZ (this column's REAL coastline, not a flat cutoff) -
          // the coastline now varies by tens of metres between coves and points, so
          // a fixed z-threshold put the whole surf effect at the wrong depth almost
          // everywhere, showing up as a comb of bumps on dry sand in every cove.
          float shoreZone = smoothstep(aCoastZ - 10.0, aCoastZ + ${(SIZE * (1 - SEA_ROW_T)).toFixed(1)}, pos.z);
          float wavePhase = fract((pos.z - uTime * 5.5) / 7.5);
          float crest = pow(max(0.0, sin(wavePhase * 6.28318)), 5.0);
          pos.y += crest * shoreZone * 0.16 * min(1.0, aDepth * 6.0);
          vCrest = crest * shoreZone;
          vec4 world = modelMatrix * vec4(pos, 1.0);
          vWorldPos = world.xyz;
          vNormal = normalize(mat3(modelMatrix) * normal);
          gl_Position = projectionMatrix * viewMatrix * world;
        }
      `,
      fragmentShader: /* glsl */`
        varying float vDepth;
        varying float vFlow;
        varying vec2 vFlowDir;
        varying float vCrest;
        varying vec3 vWorldPos;
        varying vec3 vNormal;
        uniform float uTime;
        uniform vec3 uShallowColor;
        uniform vec3 uDeepColor;
        uniform vec3 uFoam;
        uniform vec3 uSunDir;

        // Cheap hash noise for foam texture - no extra texture upload, just enough
        // to break up a flat colour band into something bubbly/mottled.
        float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
        float valueNoise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          float a = hash21(i), b = hash21(i + vec2(1.0, 0.0));
          float c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
        }

        // Underwater caustics - the rippled-light pattern sunlight makes on a shallow,
        // clear riverbed (the sharpest, most recognisable "quality water" cue in
        // every reference from crystal-clear streams to sunlit shallows). Two
        // overlapping, independently-drifting sine grids create wavering, crossing
        // light bands rather than a static pattern - cheap (no textures) but reads
        // immediately as "sunlight through moving water" rather than a flat tint.
        float caustics(vec2 p, float t) {
          vec2 p1 = p * 0.55 + vec2(t * 0.12, t * 0.07);
          vec2 p2 = p * 0.5 - vec2(t * 0.09, t * -0.11) + 19.0;
          float c1 = sin(p1.x * 3.1 + sin(p1.y * 2.6 + t * 0.4));
          float c2 = sin(p2.y * 3.4 + sin(p2.x * 2.3 - t * 0.3));
          return pow(clamp(c1 * c2, 0.0, 1.0), 2.2);
        }

        void main() {
          if (vDepth < 0.0015) discard;
          float depthN = clamp(vDepth / 3.2, 0.0, 1.0);
          vec3 base = mix(uShallowColor, uDeepColor, depthN);
          float shimmer = sin(vWorldPos.x * 2.2 + uTime * 1.8) * cos(vWorldPos.z * 2.0 - uTime * 1.4);
          base += shimmer * 0.02;
          // Streaks of surface texture travel WITH the actual current (vFlowDir, the
          // sim's real per-cell velocity), not just a fixed ambient shimmer pattern -
          // that's what actually reads as "the river is moving" rather than the
          // water just sitting there changing color in place.
          float flowMag = length(vFlowDir);
          vec2 dir = flowMag > 0.02 ? vFlowDir / flowMag : vec2(0.0, 1.0);
          float along = dot(vWorldPos.xz, dir);
          float across = dot(vWorldPos.xz, vec2(-dir.y, dir.x));
          float streakSpeed = 1.6 + min(flowMag, 3.0) * 1.8;
          float streak = sin(along * 1.4 - uTime * streakSpeed) * 0.5 + 0.5;
          streak *= 0.6 + 0.4 * sin(across * 2.6 + uTime * 0.6);
          float streakVis = smoothstep(0.62, 0.95, streak) * smoothstep(0.015, 0.3, vDepth) * clamp(flowMag * 0.6, 0.0, 1.0);
          base = mix(base, uShallowColor * 1.25 + 0.05, streakVis * 0.5);
          // Caustics only read in shallow, clear water - fade out with depth and
          // under foam (broken, aerated water doesn't hold a sharp light pattern).
          float causticVis = caustics(vWorldPos.xz, uTime) * smoothstep(0.9, 0.05, vDepth);
          base += causticVis * 0.22;
          float fresnel = pow(1.0 - clamp(dot(normalize(vNormal), vec3(0.0,1.0,0.0)), 0.0, 1.0), 3.0);
          vec3 sky = vec3(0.72, 0.80, 0.82);
          base = mix(base, sky, fresnel * 0.35);
          float diff = clamp(dot(normalize(vNormal), uSunDir), 0.0, 1.0);
          base *= (0.95 + diff * 0.55);
          float foamEdge = smoothstep(0.14, 0.0, vDepth);
          float foamFlow = smoothstep(0.55, 1.4, vFlow) * smoothstep(0.02, 0.25, vDepth);
          float surfFoam = smoothstep(0.3, 0.85, vCrest) * smoothstep(0.02, 0.2, vDepth);
          float foam = clamp(foamEdge * 0.85 + foamFlow * 0.6 + surfFoam * 0.9 + streakVis * 0.25, 0.0, 1.0);
          // Break the foam up into a mottled, bubbly texture instead of a flat tint -
          // two noise octaves drifting at slightly different speeds so it looks like
          // it's actually churning, not a static painted-on band.
          vec2 foamUv = vWorldPos.xz * 2.4 + vec2(uTime * 0.3, -uTime * 0.22);
          float foamTex = valueNoise(foamUv) * 0.6 + valueNoise(foamUv * 2.3 + 5.0) * 0.4;
          foam *= 0.55 + foamTex * 0.75;
          foam = clamp(foam, 0.0, 1.0);
          vec3 color = mix(base, uFoam, foam);
          // Genuinely translucent - a submerged rock or the riverbed underneath
          // should still read through the surface, not vanish under it.
          float alpha = mix(0.32, 0.62, depthN);
          alpha = mix(alpha, 0.88, foam * 0.55);
          gl_FragColor = vec4(color, alpha);
        }
      `,
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.renderOrder = 2;
  }

  tideHeight(t) {
    return this.tideLevel + Math.sin(t / this.tidePeriod * Math.PI * 2 + this.tidePhase) * this.tideRange * 0.5;
  }

  addWaterAt(x, z, amount, radius = 1.4) {
    const i0 = Math.max(0, Math.floor((x - radius) / CELL));
    const i1 = Math.min(N - 1, Math.ceil((x + radius) / CELL));
    const j0 = Math.max(0, Math.floor((z - radius) / CELL));
    const j1 = Math.min(N - 1, Math.ceil((z + radius) / CELL));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const dx = i * CELL - x, dz = j * CELL - z;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d > radius) continue;
        this.depth[idx(i, j)] += amount * (1 - d / radius);
      }
    }
  }

  update(dt, terrain) {
    this._accum += dt;
    let steps = 0;
    while (this._accum >= this.stepDt && steps < 4) {
      this._step(this.stepDt, terrain);
      this._accum -= this.stepDt;
      this.elapsed += this.stepDt;
      steps++;
    }
    this.uniforms.uTime.value = this.elapsed;
    this.uniforms.uTideLevel.value = this.tideHeight(this.elapsed);
    this._syncMeshAttrs(terrain);
  }

  _step(dt, terrain) {
    const h = terrain.height;
    const depth = this.depth;
    const blocked = terrain.blocked;
    const tide = this.tideHeight(this.elapsed);

    // Source inflow (the stream's origin, feeding from off-map) - a modest trickle,
    // not a flood: enough to keep a small stream visibly running.
    for (const k of this.sourceCells) depth[k] += 0.34 * dt;

    // Channel seepage: real streams gain flow from side tributaries and groundwater
    // along their whole length, not only from one point source. Gently top the
    // channel back up toward a shallow baseline wherever it's run thinner than
    // that - it only ever pulls depth UP (never down), so player-dug diversions
    // and pooling still behave normally; this just guarantees the stream can never
    // fully dry out from the diffusion scheme draining a thin sheet faster than a
    // single spring can refill it.
    //
    // This profile is a frozen snapshot of the AS-GENERATED channel, taken once at
    // world creation, and _seepProfile is ordered source-to-sea. A per-cell dam
    // check alone (comparing current height to the untouched bedrock) stops THAT
    // cell from being re-flooded, but every other row still tops itself up from
    // its own original bedrock regardless of whether anything upstream can still
    // reach it - so damming the channel at one crossing left the entire rest of
    // its length seeping exactly as before, and a full diversion could never
    // actually dry the old course out. A real dammed river dries out everywhere
    // downstream of the dam, not just at the dam itself - so once a row is found
    // where EVERY cell is dammed, stop seeping that row and all rows after it
    // (further toward the sea) for this step; a still-open row anywhere upstream
    // of a dam keeps seeping normally.
    let damBlocked = false;
    for (let j = 0; j < this._seepRows; j++) {
      const row = this._seepProfile[j];
      if (!damBlocked && row.length > 0) {
        damBlocked = true;
        for (let n = 0; n < row.length; n++) {
          const { k } = row[n];
          if (h[k] - terrain.bedrock[k] <= 0.6) { damBlocked = false; break; }
        }
      }
      if (damBlocked) continue;
      for (let n = 0; n < row.length; n++) {
        const { k, target } = row[n];
        if (blocked[k]) continue;
        if (h[k] - terrain.bedrock[k] > 0.6) continue;
        const deficit = target - depth[k];
        if (deficit > 0) depth[k] += deficit * Math.min(1, 0.35 * dt);
      }
    }

    // Sea coupling: relax cells in the open-sea zone toward the tide level. Each
    // column has its own coastline threshold (a cove's sea starts sooner, a
    // point's later), so this checks per-cell rather than a single shared row.
    const coastCol = this._coastT;
    for (let j = 0; j < N; j++) {
      const t = (j * CELL) / SIZE;
      for (let i = 0; i < N; i++) {
        const colT = coastCol[i];
        if (t < colT) continue;
        const zoneT = THREE.MathUtils.clamp((t - colT) / Math.max(0.05, 1 - colT), 0, 1);
        const strength = THREE.MathUtils.clamp(0.06 + zoneT * 0.5, 0.06, 0.6);
        const k = idx(i, j);
        const target = Math.max(0, tide - h[k]);
        depth[k] += (target - depth[k]) * Math.min(1, strength * dt * 6);
      }
    }

    // --- local, unconditionally-stable transfer scheme ---
    // Each cell hands a bounded share of its water to lower neighbours: never more
    // than it has, and never more than would overshoot the level between the two
    // cells. This sacrifices true momentum/inertia for guaranteed stability - water
    // just can't blow up or go negative - while still producing believable flow,
    // pooling, splitting and backflow.
    const fR = this.fR, fL = this.fL, fU = this.fU, fD = this.fD;
    fR.fill(0); fL.fill(0); fU.fill(0); fD.fill(0);
    const RATE = 22; // responsive enough that even a gentle streambed grade visibly carries water

    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const k = idx(i, j);
        if (blocked[k] || depth[k] <= 1e-5) continue;
        const H = h[k] + depth[k];
        const available = depth[k] * CELL_AREA;

        let dR = 0, dL = 0, dU = 0, dD = 0;
        if (i + 1 < N && !blocked[idx(i + 1, j)]) dR = Math.max(0, H - (h[idx(i + 1, j)] + depth[idx(i + 1, j)]));
        if (i - 1 >= 0 && !blocked[idx(i - 1, j)]) dL = Math.max(0, H - (h[idx(i - 1, j)] + depth[idx(i - 1, j)]));
        if (j + 1 < N && !blocked[idx(i, j + 1)]) dU = Math.max(0, H - (h[idx(i, j + 1)] + depth[idx(i, j + 1)]));
        if (j - 1 >= 0 && !blocked[idx(i, j - 1)]) dD = Math.max(0, H - (h[idx(i, j - 1)] + depth[idx(i, j - 1)]));

        const sumD = dR + dL + dU + dD;
        if (sumD <= 1e-6) continue;
        // Capped well under the 2D explicit-diffusion stability limit (~0.25 of available
        // water moving per step) - above that, simultaneous 4-neighbour transfers overshoot
        // and ping-pong into a checkerboard oscillation instead of settling.
        const rate = Math.min(0.22, RATE * dt);

        if (dR > 0) fR[k] = Math.min(available * (dR / sumD) * rate, dR * CELL_AREA * 0.5);
        if (dL > 0) fL[k] = Math.min(available * (dL / sumD) * rate, dL * CELL_AREA * 0.5);
        if (dU > 0) fU[k] = Math.min(available * (dU / sumD) * rate, dU * CELL_AREA * 0.5);
        if (dD > 0) fD[k] = Math.min(available * (dD / sumD) * rate, dD * CELL_AREA * 0.5);
      }
    }

    // --- apply transfers to depth, track flow speed & velocity ---
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const k = idx(i, j);
        if (blocked[k]) { depth[k] = 0; this.flowSpeed[k] *= 0.9; continue; }
        let inflow = 0;
        if (i + 1 < N) inflow += fL[idx(i + 1, j)];
        if (i - 1 >= 0) inflow += fR[idx(i - 1, j)];
        if (j + 1 < N) inflow += fD[idx(i, j + 1)];
        if (j - 1 >= 0) inflow += fU[idx(i, j - 1)];
        const outflow = fR[k] + fL[k] + fU[k] + fD[k];
        depth[k] = THREE.MathUtils.clamp(depth[k] + (inflow - outflow) / CELL_AREA, 0, 8); // safety clamp

        const vx = (fR[k] - fL[k]) / CELL_AREA / dt;
        const vz = (fU[k] - fD[k]) / CELL_AREA / dt;
        this.velX[k] = vx; this.velZ[k] = vz;
        const speed = Math.sqrt(vx * vx + vz * vz);
        this.flowSpeed[k] = this.flowSpeed[k] * 0.85 + Math.min(speed, 4) * 0.15;
      }
    }

    // A touch of numerical damping: the 4-neighbour Jacobi update above is prone to a
    // standing checkerboard oscillation (odd/even cells ping-ponging water back and
    // forth without settling). A light blur toward the local average kills exactly
    // that highest-frequency pattern without visibly affecting real flow or pooling.
    const smoothed = this._depthScratch || (this._depthScratch = new Float32Array(N * N));
    smoothed.set(depth);
    for (let j = 1; j < N - 1; j++) {
      for (let i = 1; i < N - 1; i++) {
        const k = idx(i, j);
        // Only smooth substantial water (pools, the sea) - a thin trickle relies on
        // its exact depth to keep propagating across dry ground, so leave it alone.
        if (blocked[k] || depth[k] <= 0.25) continue;
        let sum = depth[k], count = 1;
        if (!blocked[idx(i + 1, j)]) { sum += depth[idx(i + 1, j)]; count++; }
        if (!blocked[idx(i - 1, j)]) { sum += depth[idx(i - 1, j)]; count++; }
        if (!blocked[idx(i, j + 1)]) { sum += depth[idx(i, j + 1)]; count++; }
        if (!blocked[idx(i, j - 1)]) { sum += depth[idx(i, j - 1)]; count++; }
        smoothed[k] = depth[k] * 0.55 + (sum / count) * 0.45;
      }
    }
    depth.set(smoothed);

    this._erode(dt, terrain);
    terrain.markDirty();
  }

  _erode(dt, terrain) {
    const h = terrain.height;
    const hardness = terrain.hardness;
    const depth = this.depth;
    const sediment = this.sediment;
    const blocked = terrain.blocked;
    const Kc = 1.1;      // capacity constant
    const Ke = 0.9;      // erosion rate
    const Kd = 0.55;     // deposition rate
    const MAX_RATE = 0.045; // hard ceiling on height change per second - keeps erosion a slow, minutes-scale process

    // No erosion out in each column's own open-sea relaxation zone (a cove's sea
    // starts sooner than a point's, so this is checked per-cell, not one shared row).
    for (let j = 1; j < N - 1; j++) {
      const t = (j * CELL) / SIZE;
      for (let i = 1; i < N - 1; i++) {
        if (t > this._coastT[i]) continue;
        const k = idx(i, j);
        if (blocked[k] || depth[k] < 0.004) continue;

        const hL = h[idx(i - 1, j)], hR = h[idx(i + 1, j)];
        const hD = h[idx(i, j - 1)], hU = h[idx(i, j + 1)];
        const slope = (Math.abs(hR - hL) + Math.abs(hU - hD)) / (4 * CELL);
        const speed = this.flowSpeed[k];
        const depthFactor = Math.min(1, depth[k] * 3.0);

        const capacity = Kc * speed * (0.15 + slope * 6.0) * depthFactor;
        const carried = sediment[k];

        if (carried < capacity) {
          const resist = 1 - Math.min(0.97, hardness[k]);
          const amt = Math.min((capacity - carried) * Ke * dt, MAX_RATE * dt) * resist;
          h[k] -= amt;
          sediment[k] += amt;
        } else {
          const amt = Math.min((carried - capacity) * Kd * dt, MAX_RATE * dt, carried);
          h[k] += amt;
          sediment[k] -= amt;
        }
      }
    }

    // Advect sediment along the same flux fractions as the water (cheap upwind transport).
    const next = this._sedScratch || (this._sedScratch = new Float32Array(N * N));
    next.set(sediment);
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const k = idx(i, j);
        if (blocked[k]) continue;
        const outTotal = this.fR[k] + this.fL[k] + this.fU[k] + this.fD[k];
        const vol = Math.max(depth[k] * CELL_AREA, 1e-5);
        const frac = Math.min(1, outTotal / vol);
        const carry = sediment[k] * frac * 0.6;
        if (carry <= 0) continue;
        const shareTotal = outTotal || 1;
        if (i + 1 < N && this.fR[k] > 0) next[idx(i + 1, j)] += carry * (this.fR[k] / shareTotal);
        if (i - 1 >= 0 && this.fL[k] > 0) next[idx(i - 1, j)] += carry * (this.fL[k] / shareTotal);
        if (j + 1 < N && this.fU[k] > 0) next[idx(i, j + 1)] += carry * (this.fU[k] / shareTotal);
        if (j - 1 >= 0 && this.fD[k] > 0) next[idx(i, j - 1)] += carry * (this.fD[k] / shareTotal);
        next[k] -= carry;
      }
    }
    sediment.set(next);

    // Moisture trace for terrain shading: wet where water is/has recently been.
    for (let k = 0; k < N * N; k++) {
      const wet = depth[k] > 0.003 ? 1 : 0;
      terrain.moisture[k] = terrain.moisture[k] * 0.995 + wet * 0.06;
    }
  }

  _syncMeshAttrs(terrain) {
    const depthArr = this.depthAttr.array;
    const flowArr = this.flowAttr.array;
    const flowDirArr = this.flowDirAttr.array;
    const pos = this.geometry.attributes.position;
    const th = terrain.height;
    const blocked = terrain.blocked;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const k = idx(i, j);
        let d = this.depth[k];
        if (blocked[k]) {
          // A rock forces sim depth to 0 here, but that creates a sheer cliff in the
          // water MESH against deep neighbours (renders as thin black spikes). The
          // rock already reads as an obstacle via its own model, so let the water
          // surface stay smooth underneath it - average whatever nearby open water is.
          let sum = 0, count = 0;
          if (i + 1 < N && !blocked[idx(i + 1, j)]) { sum += this.depth[idx(i + 1, j)]; count++; }
          if (i - 1 >= 0 && !blocked[idx(i - 1, j)]) { sum += this.depth[idx(i - 1, j)]; count++; }
          if (j + 1 < N && !blocked[idx(i, j + 1)]) { sum += this.depth[idx(i, j + 1)]; count++; }
          if (j - 1 >= 0 && !blocked[idx(i, j - 1)]) { sum += this.depth[idx(i, j - 1)]; count++; }
          d = count > 0 ? sum / count : 0;
        }
        depthArr[k] = d;
        flowArr[k] = this.flowSpeed[k];
        flowDirArr[k * 2] = this.velX[k];
        flowDirArr[k * 2 + 1] = this.velZ[k];
        pos.setY(k, th[k] + d + 0.006);
      }
    }
    this.depthAttr.needsUpdate = true;
    this.flowAttr.needsUpdate = true;
    this.flowDirAttr.needsUpdate = true;
    pos.needsUpdate = true;
    if ((this._normAccum = (this._normAccum || 0) + 1) % 6 === 0) {
      this.geometry.computeVertexNormals();
    }
  }

  depthAt(x, z) {
    const k = this.terrain.cellIndexAt(x, z);
    return k >= 0 ? this.depth[k] : 0;
  }

  flowAt(x, z) {
    const k = this.terrain.cellIndexAt(x, z);
    return k >= 0 ? { speed: this.flowSpeed[k], vx: this.velX[k], vz: this.velZ[k] } : { speed: 0, vx: 0, vz: 0 };
  }
}

export { idx };
