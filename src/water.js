import * as THREE from 'three';
import {
  GRID, CELL, SIZE, streamCenterX, coastT, warpX,
  getActiveLevel, L2_LIP_X, L2_T_FALL0, L2_T_FALL1,
  L2_LAKE_CENTER_Z, L2_LAKE_RADIUS_X, L2_LAKE_RADIUS_Z,
} from './terrain.js?v=103';

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

// The VISIBLE water mesh is rendered at a finer resolution than the physics grid -
// playtesting showed the river/sea edge reading as a chunky staircase because the
// mesh literally only had a vertex every ~0.82m (one per sim cell). The simulation
// itself stays untouched at N x N (full CPU-cost budget preserved) - only the
// render mesh is denser.
//
// First attempt at this did the upsample on the CPU (bilinear-interpolating the
// coarse depth/flow arrays into a finer JS array every frame) - measured at
// ~34ms/frame for a 2x-denser mesh (see the water.flowSpeed/_syncMeshAttrs
// profiling notes in the fix history), which alone would cap the game under
// 30fps. That's real CPU cost from a "just rendering" feature, exactly the
// mistake the performance notes warn against. Moved the upsampling onto the GPU
// instead: the coarse fields are uploaded as small textures once per frame (a
// cheap copy over the N x N grid, not the finer render grid), and the vertex
// shader samples them with hardware bilinear filtering (effectively free) to
// place each fine vertex and derive its depth/flow. Confirmed this drops the
// per-frame JS cost to a small fraction of a millisecond (see fix history).
const RENDER_SS = 2;
const RN = (N - 1) * RENDER_SS + 1;

function idx(i, j) { return j * N + i; }
function fidx(i, j) { return j * RN + i; }

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
    // Waterfall source inflow rate (depth/second at each source cell) - see
    // _seedSource/_step. Level 1's own 0.34 stays a literal inline constant in
    // _step (untouched); this is a SEPARATE, level-gated value so level 2's
    // single concentrated source can feed at a different rate without
    // changing level 1's tuned number at all.
    this._sourceRate = 0.34;

    // Level 2 ("Highfall Gorge"): no tide at all - a still mountain lake at
    // the valley's exit instead of the sea, reusing the exact same coastT/
    // sea-relaxation machinery below with tideRange=0 (a flat, non-oscillating
    // level) rather than adding a parallel "lake" code path. Level 1's own
    // tide numbers above are left completely untouched.
    if (getActiveLevel() === 'level2') {
      this.tideLevel = 1.1;
      this.tideRange = 0;
      this.tidePeriod = 1;
      this._sourceRate = 1.1; // a real waterfall's volume reads as much more than a gentle spring trickle
    }

    // Per-column coastline threshold, precomputed once - every functional sea-zone
    // check below reads this instead of recomputing the noise or using a flat cutoff.
    this._coastT = new Float32Array(N);
    for (let i = 0; i < N; i++) this._coastT[i] = coastT(i);

    this._seedSource();
    this._seedChannel(terrain);
    this._seedLake(terrain);
    this._buildMesh();

    this._accum = 0;
    this.stepDt = 1 / 30; // fixed sim step, decoupled from render framerate
    this.elapsed = 0;
  }

  _seedSource() {
    if (getActiveLevel() === 'level2') {
      // Feeds the lake basin above the falls (see terrain.js's L2_LAKE_*),
      // not the falls' lip directly any more - the lake fills from its own
      // deepest point and spills wherever its rim is lowest, same as any
      // real lake, so a player-dug notch elsewhere in the rim can carry
      // water too without a separate scripted path for it.
      this.sourceCells = [];
      const j0 = Math.round(L2_LAKE_CENTER_Z / CELL);
      const ci = Math.round(L2_LIP_X / CELL);
      for (let di = -1; di <= 1; di++) {
        const i = ci + di;
        if (i >= 0 && i < N) this.sourceCells.push(idx(i, j0));
      }
      return;
    }
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
    // Level 2's diggable seep channel only starts BELOW the landing pool - the
    // falls' own near-vertical face isn't a channel, it's fed purely by the
    // concentrated source cells above (see _seedSource) and the flux sim
    // carrying that water straight down the drop.
    const j0 = getActiveLevel() === 'level2' ? Math.round((L2_T_FALL1 * SIZE) / CELL) : 0;
    for (let j = j0; j < N; j++) {
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

  // The upper lake (terrain.js's L2_LAKE_* basin) needs to read as a real,
  // already-full lake from frame one - the single point source alone
  // (see _seedSource) would take a very long time to fill a basin this size
  // from empty, same reasoning as _seedChannel pre-seeding the river. A
  // one-time direct fill (not a per-step top-up like the channel's seepage -
  // that mechanism is ordered source-to-sea for a dam-detection pass along a
  // single channel, which doesn't map onto a wide 2D basin) rather than
  // waiting on the sim.
  _seedLake(terrain) {
    if (getActiveLevel() !== 'level2') return;
    const j0 = Math.max(0, Math.floor((L2_LAKE_CENTER_Z - L2_LAKE_RADIUS_Z) / CELL));
    const j1 = Math.min(N - 1, Math.ceil((L2_LAKE_CENTER_Z + L2_LAKE_RADIUS_Z) / CELL));
    const i0 = Math.max(0, Math.floor((L2_LIP_X - L2_LAKE_RADIUS_X) / CELL));
    const i1 = Math.min(N - 1, Math.ceil((L2_LIP_X + L2_LAKE_RADIUS_X) / CELL));
    for (let j = j0; j <= j1; j++) {
      const z = j * CELL;
      for (let i = i0; i <= i1; i++) {
        const x = i * CELL;
        const ellip = Math.sqrt(
          ((x - L2_LIP_X) / L2_LAKE_RADIUS_X) ** 2 + ((z - L2_LAKE_CENTER_Z) / L2_LAKE_RADIUS_Z) ** 2
        );
        if (ellip >= 1) continue;
        const k = idx(i, j);
        if (terrain.blocked[k]) continue;
        const target = (1 - ellip) * 1.6;
        this.depth[k] = Math.max(this.depth[k], target);
      }
    }
  }

  _buildMesh() {
    // Rendered at RN x RN (RENDER_SS x finer than the N x N sim grid) purely for
    // visual smoothness - see RENDER_SS comment above. Depth/flow/height are NOT
    // per-vertex attributes any more (that was the CPU-expensive version) - the
    // vertex shader instead samples the coarse sim fields as small textures
    // (created just below, uploaded fresh each frame in _syncMeshAttrs), using
    // the GPU's own bilinear filtering to do the upsampling for free. aFieldUV
    // is the only thing each vertex needs to know: its own (u,v) position in
    // that coarse N x N field, set once here since it never changes.
    this.geometry = new THREE.PlaneGeometry(SIZE, SIZE, RN - 1, RN - 1);
    this.geometry.rotateX(-Math.PI / 2);
    this.geometry.translate(SIZE / 2, 0, SIZE / 2);

    const fineCell = CELL / RENDER_SS;
    const fieldUV = new Float32Array(RN * RN * 2);

    // Match the terrain mesh's inland-neck taper (see terrain.js warpX) - the
    // water surface needs the same x warp or it'd float over ground that no
    // longer lines up with it near the dune line. warpX takes real world
    // coordinates, not grid indices, so it works fine at the finer spacing too.
    {
      const pos = this.geometry.attributes.position;
      for (let j = 0; j < RN; j++) {
        const z = j * fineCell;
        const v = (j / RENDER_SS + 0.5) / N; // +0.5: sample texel centres, not edges
        for (let i = 0; i < RN; i++) {
          const k = fidx(i, j);
          pos.setX(k, warpX(i * fineCell, z));
          pos.setY(k, 0); // fully overwritten in the vertex shader every frame
          fieldUV[k * 2] = (i / RENDER_SS + 0.5) / N;
          fieldUV[k * 2 + 1] = v;
        }
      }
    }
    this.geometry.setAttribute('aFieldUV', new THREE.BufferAttribute(fieldUV, 2));

    // The surf/wave-crest effect below needs to know where the REAL (per-column,
    // irregular) coastline is, not a flat cutoff - otherwise the breaking-wave
    // line shows up at the wrong depth in every cove and point, as a comb of
    // bumps in the wrong place rather than tracking the actual shore. This is a
    // constant per column, so it's set once here rather than every frame.
    // coastT() only resolves at integer sim columns - linearly interpolate
    // between the two bracketing columns for the in-between fine columns so
    // this doesn't reintroduce its own per-column staircase at the finer res.
    const coastZArr = new Float32Array(RN * RN);
    const coastZByCol = new Float32Array(RN);
    for (let i = 0; i < RN; i++) {
      const ci = i / RENDER_SS;
      const i0 = Math.floor(ci), i1 = Math.min(N - 1, i0 + 1);
      const t = ci - i0;
      const z0 = this._coastT[i0] * SIZE, z1 = this._coastT[i1] * SIZE;
      coastZByCol[i] = z0 + (z1 - z0) * t;
    }
    for (let j = 0; j < RN; j++) {
      for (let i = 0; i < RN; i++) coastZArr[fidx(i, j)] = coastZByCol[i];
    }
    this.geometry.setAttribute('aCoastZ', new THREE.BufferAttribute(coastZArr, 1));

    // The three coarse (N x N) sim fields the vertex shader needs, each uploaded
    // fresh every frame in _syncMeshAttrs - see the RENDER_SS comment up top for
    // why this replaced a CPU-side per-vertex upsample. RGBAFormat/FloatType for
    // broad support; only R/G channels are actually used per texture.
    // NEAREST, not LINEAR: hardware linear filtering on a FLOAT texture needs the
    // OES_texture_float_linear extension, which is NOT universally supported on
    // mobile GPUs - when it's missing, most drivers silently ignore the filter
    // request rather than erroring, so this used to just... work, until it didn't.
    // Confirmed live on an actual iPhone: a severe, perfectly regular banded/
    // striped pattern across the whole water surface, absent on every desktop
    // browser tested (which do support it) - exactly what nearest-neighbour
    // upsampling of a coarse 140x140 grid looks like. Fixed properly below by
    // doing the bilinear interpolation manually in the shader (sampleBilinear),
    // which only ever does plain NEAREST texel fetches - no dependency on any
    // GPU filtering extension at all, so this can't silently regress again on
    // some other device.
    const mkFieldTexture = () => {
      const tex = new THREE.DataTexture(new Float32Array(N * N * 4), N, N, THREE.RGBAFormat, THREE.FloatType);
      tex.minFilter = THREE.NearestFilter;
      tex.magFilter = THREE.NearestFilter;
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.generateMipmaps = false;
      return tex;
    };
    this._depthFlowTex = mkFieldTexture(); // r=depth, g=flowSpeed
    this._velTex = mkFieldTexture();       // r=velX, g=velZ
    this._heightTex = mkFieldTexture();    // r=terrain height

    this.uniforms = {
      uTime: { value: 0 },
      uTideLevel: { value: this.tideLevel },
      uShallowColor: { value: new THREE.Color('#5cd0cc') },
      uDeepColor: { value: new THREE.Color('#1b6f8c') },
      uFoam: { value: new THREE.Color('#eef6f2') },
      uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.3).normalize() },
      uDepthFlowTex: { value: this._depthFlowTex },
      uVelTex: { value: this._velTex },
      uHeightTex: { value: this._heightTex },
    };

    this.material = new THREE.ShaderMaterial({
      transparent: true,
      uniforms: this.uniforms,
      vertexShader: /* glsl */`
        attribute vec2 aFieldUV;
        attribute float aCoastZ;
        uniform sampler2D uDepthFlowTex;
        uniform sampler2D uVelTex;
        uniform sampler2D uHeightTex;
        varying float vDepth;
        varying float vFlow;
        varying vec2 vFlowDir;
        varying float vCrest;
        varying vec3 vWorldPos;
        uniform float uTime;

        // Manual bilinear sample - textures are NEAREST-filtered (see mkFieldTexture
        // in water.js for why), so this does the interpolation in plain arithmetic
        // instead of depending on hardware LINEAR filtering support.
        vec4 sampleBilinear(sampler2D tex, vec2 uv) {
          float texN = ${N.toFixed(1)};
          vec2 tc = uv * texN - 0.5;
          vec2 i = floor(tc);
          vec2 f = tc - i;
          vec2 uv00 = clamp((i + vec2(0.5, 0.5)) / texN, 0.0, 1.0);
          vec2 uv10 = clamp((i + vec2(1.5, 0.5)) / texN, 0.0, 1.0);
          vec2 uv01 = clamp((i + vec2(0.5, 1.5)) / texN, 0.0, 1.0);
          vec2 uv11 = clamp((i + vec2(1.5, 1.5)) / texN, 0.0, 1.0);
          vec4 c00 = texture2D(tex, uv00), c10 = texture2D(tex, uv10);
          vec4 c01 = texture2D(tex, uv01), c11 = texture2D(tex, uv11);
          return mix(mix(c00, c10, f.x), mix(c01, c11, f.x), f.y);
        }

        void main() {
          // The coarse N x N sim fields (depth/flow/velocity/terrain height),
          // bilinear-sampled here instead of CPU-upsampled per vertex every
          // frame - see the RENDER_SS comment at the top of water.js for why.
          vec2 depthFlow = sampleBilinear(uDepthFlowTex, aFieldUV).rg;
          float aDepth = depthFlow.r;
          vDepth = aDepth;
          vFlow = depthFlow.g;
          vFlowDir = sampleBilinear(uVelTex, aFieldUV).rg;
          float terrainH = sampleBilinear(uHeightTex, aFieldUV).r;

          vec3 pos = position;
          pos.y = terrainH + aDepth + 0.006;
          float ripple = sin(pos.x * 1.3 + uTime * 1.6) * 0.02 + cos(pos.z * 1.1 - uTime * 1.3) * 0.02;
          pos.y += (aDepth > 0.002) ? ripple * min(1.0, aDepth * 4.0) : 0.0;
          // Surf: wave crests travel toward shore (-z) and rear up as the water shoals,
          // giving the breaking-wave line a slight rolling bump right where it foams.
          // Anchored to aCoastZ (this column's REAL coastline, not a flat cutoff) -
          // the coastline now varies by tens of metres between coves and points, so
          // a fixed z-threshold put the whole surf effect at the wrong depth almost
          // everywhere, showing up as a comb of bumps on dry sand in every cove.
          float shoreZone = smoothstep(aCoastZ - 10.0, aCoastZ + ${(SIZE * (1 - SEA_ROW_T)).toFixed(1)}, pos.z);
          // z=0 is inland/dunes, z=SIZE is open sea (see terrain.js's own header
          // comment) - a real wave travels from offshore (high z) toward the
          // shore (low z), so the phase must shift toward DECREASING z as uTime
          // grows. The previous pos.z minus uTime version did the opposite,
          // sending crests visibly retreating out to sea instead of breaking onto it.
          float wavePhase = fract((pos.z + uTime * 5.5) / 7.5);
          float crest = pow(max(0.0, sin(wavePhase * 6.28318)), 5.0);
          pos.y += crest * shoreZone * 0.16 * min(1.0, aDepth * 6.0);
          vCrest = crest * shoreZone;
          vec4 world = modelMatrix * vec4(pos, 1.0);
          vWorldPos = world.xyz;
          // Position.y is now driven entirely by the vertex shader (from the
          // sampled fields above), so the CPU-side geometry never touches its own
          // Y and the imported "normal" attribute is meaningless (computed for a
          // flat, all-zero-Y plane) - the fragment shader reconstructs a real
          // normal from screen-space derivatives of vWorldPos instead (see
          // below), which is also cheaper than a periodic CPU
          // computeVertexNormals() pass over the whole (now much denser) mesh.
          gl_Position = projectionMatrix * viewMatrix * world;
        }
      `,
      fragmentShader: /* glsl */`
        varying float vDepth;
        varying float vFlow;
        varying vec2 vFlowDir;
        varying float vCrest;
        varying vec3 vWorldPos;
        uniform float uTime;
        uniform vec3 uShallowColor;
        uniform vec3 uDeepColor;
        uniform vec3 uFoam;
        uniform vec3 uSunDir;

        // Cheap hash noise for foam/flow-streak texture - no extra texture upload,
        // just enough to break up a flat colour band into something bubbly/mottled.
        //
        // The classic fract(sin(dot(p,...))*43758.5) hash is a well-known trap on
        // mobile GPUs: fragment shaders there commonly run at mediump (~10 bits of
        // mantissa) regardless of what precision the shader requests, and sin()
        // loses essentially all useful precision once its argument gets into the
        // hundreds/thousands - which dot(p, vec2(127.1,311.7)) reaches almost
        // immediately at these world-space coordinate scales. The result isn't
        // random at all any more, it's a coarse, highly-periodic repeating pattern
        // - rendered directly as regular parallel stripes across the whole water
        // surface (confirmed live on an actual iPhone: an obvious, perfectly even
        // "football pitch" hatching, completely absent on desktop). This
        // reformulation (fract/dot/multiply only, no sin, no large magic constant)
        // is the standard mobile-safe replacement - same visual job, no precision
        // cliff at any GPU's mediump range.
        float hash21(vec2 p) {
          vec3 p3 = fract(vec3(p.xyx) * 0.1031);
          p3 += dot(p3, p3.yzx + 33.33);
          return fract((p3.x + p3.y) * p3.z);
        }
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
          // Raised from 0.0015: at that threshold, sub-centimetre trace moisture
          // sitting in incidental terrain dips (nowhere near the actual river or
          // coastline) was rendering as full-brightness foam lines (see foamEdge
          // below) - stray white threads disconnected from the real water. 0.01
          // (1cm) hides that trace-level noise while a real flowing edge, which
          // the sim actually seeds/relaxes to a meaningful depth, is unaffected.
          if (vDepth < 0.01) discard;
          float depthN = clamp(vDepth / 3.2, 0.0, 1.0);
          vec3 base = mix(uShallowColor, uDeepColor, depthN);
          float shimmer = sin(vWorldPos.x * 2.2 + uTime * 1.8) * cos(vWorldPos.z * 2.0 - uTime * 1.4);
          base += shimmer * 0.02;
          // Streaks of surface texture travel WITH the actual current (vFlowDir, the
          // sim's real per-cell velocity), not just a fixed ambient shimmer pattern -
          // that's what actually reads as "the river is moving" rather than the
          // water just sitting there changing color in place.
          // Tuned against measured live sim values (window.__game.water.flowSpeed
          // in the actual river channel): typical flowMag there is ~0.1-0.65, only
          // occasionally higher - the old clamp(flowMag*0.6) and narrow 0.62-0.95
          // streak gate meant real river cells almost never crossed into visible
          // territory, and a static-vs-2-seconds-later screenshot comparison
          // confirmed nothing was visibly moving. Rescaled so that measured range
          // actually reads as a moving current, and sped up so the motion is
          // obvious within a couple of seconds rather than a slow crawl.
          float flowMag = length(vFlowDir);
          vec2 dir = flowMag > 0.02 ? vFlowDir / flowMag : vec2(0.0, 1.0);
          float along = dot(vWorldPos.xz, dir);
          float across = dot(vWorldPos.xz, vec2(-dir.y, dir.x));
          float streakSpeed = 2.2 + min(flowMag, 3.0) * 3.2;
          // A pure sin(along) gave perfectly even, parallel, barcode-spaced lines -
          // real current lines break, merge, taper and vary in width, they never
          // read as a clean repeating pattern. Warp the along-flow coordinate with
          // noise before scrolling it (so lines aren't dead straight either), then
          // build the streak itself from two independently-scaled, independently-
          // drifting noise layers instead of a sine wave - thresholding noise gives
          // organic blob/streak shapes with irregular length and spacing for free.
          float warpN = valueNoise(vec2(along * 0.05, across * 0.08) + uTime * 0.045);
          float alongWarped = along + (warpN - 0.5) * 5.0;
          float streakA = valueNoise(vec2(alongWarped * 0.32, across * 0.46) - vec2(uTime * streakSpeed * 0.13, 0.0));
          float streakB = valueNoise(vec2(alongWarped * 0.85 + 50.0, across * 1.2 + 50.0) - vec2(uTime * streakSpeed * 0.21, 0.0));
          float streak = clamp(streakA * 0.6 + streakB * 0.55, 0.0, 1.0);
          // The sim's flow-transfer scheme has real per-cell numerical noise in
          // wide/still water (see water.js's own comments on checkerboard
          // oscillation) - it was always there, just inaudible under the old,
          // much less sensitive gating. Cranking sensitivity up to make the real
          // river read as flowing also picked up that noise as a chaotic,
          // flickering moiré everywhere the water is deep and slow (i.e. the open
          // sea/tidal reach, not the actual river) - confirmed by look at exactly
          // that depth range. Fading the whole effect out with depth keeps it
          // where it means something (the shallow, coherently-flowing channel)
          // and off where it was just amplifying static.
          float depthFade = smoothstep(2.0, 0.25, vDepth);
          // Measured live in the actual channel (window.__game.water.flowSpeed
          // at the deepest/fastest part of a mid-river cell): flowMag there
          // typically sits around 0.2-0.3, not the 0.5+ this originally assumed -
          // lowered the ramp so that realistic range actually lands mid-to-high
          // on the visibility curve instead of near its bottom.
          float flowVisibility = smoothstep(0.08, 0.4, flowMag) * depthFade;
          float streakVis = smoothstep(0.45, 0.85, streak) * smoothstep(0.01, 0.25, vDepth) * flowVisibility;
          base = mix(base, uShallowColor * 1.3 + 0.06, streakVis * 0.65);
          // Caustics only read in shallow, clear water - fade out with depth and
          // under foam (broken, aerated water doesn't hold a sharp light pattern).
          float causticVis = caustics(vWorldPos.xz, uTime) * smoothstep(0.9, 0.05, vDepth);
          base += causticVis * 0.22;
          // The real per-vertex normal used to come from THREE's computeVertexNormals
          // on the CPU - but position.y is now driven entirely by the vertex shader
          // (see RENDER_SS notes above), so the CPU-side geometry is flat and that
          // normal would be meaningless. Reconstructing it here from screen-space
          // derivatives of vWorldPos is both correct (it sees the real ripple/crest
          // bumps the shader just applied) and cheaper than a periodic CPU pass over
          // a mesh that's now denser than it used to be.
          vec3 fdx = dFdx(vWorldPos), fdy = dFdy(vWorldPos);
          vec3 nrm = normalize(cross(fdx, fdy));
          if (nrm.y < 0.0) nrm = -nrm;
          float fresnel = pow(1.0 - clamp(dot(nrm, vec3(0.0,1.0,0.0)), 0.0, 1.0), 3.0);
          vec3 sky = vec3(0.72, 0.80, 0.82);
          base = mix(base, sky, fresnel * 0.35);
          float diff = clamp(dot(nrm, uSunDir), 0.0, 1.0);
          base *= (0.95 + diff * 0.55);
          // A deliberate wet-edge BAND, not "brightest at the thinnest possible
          // sliver of water": the old smoothstep(0.14, 0.0, vDepth) peaked at
          // vDepth==0 (right at the discard cutoff), which meant literally any
          // trace of water - however inconsequential - rendered at maximum foam
          // brightness. That's what made a stray, physically-negligible puddle
          // (found by inspecting the live depth field) glow as a solid white
          // thread with no relation to the real shoreline. Zero right at the
          // cutoff, ramping up over the next few cm and fading out by ~0.4m gives
          // a real, deliberate "just past the water's edge" foam line instead.
          float foamEdge = smoothstep(0.01, 0.05, vDepth) * smoothstep(0.42, 0.05, vDepth);
          float foamFlow = smoothstep(0.55, 1.4, vFlow) * smoothstep(0.02, 0.25, vDepth);
          float surfFoam = smoothstep(0.3, 0.85, vCrest) * smoothstep(0.02, 0.2, vDepth);
          float foam = clamp(foamEdge * 0.9 + foamFlow * 0.6 + surfFoam * 0.9 + streakVis * 0.25, 0.0, 1.0);
          // Break the foam up into a mottled, bubbly texture instead of a flat tint -
          // two noise octaves drifting at slightly different speeds so it looks like
          // it's actually churning, not a static painted-on band.
          vec2 foamUv = vWorldPos.xz * 2.4 + vec2(uTime * 0.3, -uTime * 0.22);
          float foamTex = valueNoise(foamUv) * 0.6 + valueNoise(foamUv * 2.3 + 5.0) * 0.4;
          foam *= 0.55 + foamTex * 0.75;
          foam = clamp(foam, 0.0, 1.0);
          vec3 color = mix(base, uFoam, foam);
          // Genuinely translucent in the shallows - a submerged rock or the
          // riverbed underneath should still read through the surface there.
          // But in genuinely deep water (depthN -> 1, i.e. the open sea, well
          // past the shallow river) this used to cap at 0.62, letting the muddy
          // seabed colour bleed through right where this mesh's far edge meets
          // buildOcean()'s separate distant-sea backdrop plane (environment.js) -
          // a visible seam where two different, differently-tinted "sea" surfaces
          // showed through each other. Raising the deep ceiling to near-opaque
          // makes the open-sea reach of this mesh read as solid water, matching
          // how the backdrop plane already reads, without touching the shallow
          // end's deliberate translucency at all (depthN is ~0 there).
          float alpha = mix(0.32, 0.92, depthN);
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

    // Source inflow (the stream's/waterfall's origin, feeding from off-map) - a
    // modest trickle for level 1's gentle spring, more for level 2's single
    // concentrated waterfall point (see this._sourceRate, set once in the
    // constructor - level 1's own rate here is unchanged from before).
    for (const k of this.sourceCells) depth[k] += this._sourceRate * dt;

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
    const obstruction = terrain.obstruction;

    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const k = idx(i, j);
        if (blocked[k] || depth[k] <= 1e-5) continue;
        const H = h[k] + depth[k];
        const available = depth[k] * CELL_AREA;
        const obK = obstruction[k];

        let dR = 0, dL = 0, dU = 0, dD = 0, kR = -1, kL = -1, kU = -1, kD = -1;
        if (i + 1 < N && !blocked[kR = idx(i + 1, j)]) dR = Math.max(0, H - (h[kR] + depth[kR]));
        if (i - 1 >= 0 && !blocked[kL = idx(i - 1, j)]) dL = Math.max(0, H - (h[kL] + depth[kL]));
        if (j + 1 < N && !blocked[kU = idx(i, j + 1)]) dU = Math.max(0, H - (h[kU] + depth[kU]));
        if (j - 1 >= 0 && !blocked[kD = idx(i, j - 1)]) dD = Math.max(0, H - (h[kD] + depth[kD]));

        const sumD = dR + dL + dU + dD;
        if (sumD <= 1e-6) continue;
        // Lowered from 0.22 (see the per-link equalisation-cap fix just below for the actual
        // root-cause fix - this alone is a real but insufficient improvement, kept for its own
        // sake). For a plain linear 4-neighbour diffusion update, the highest-frequency
        // (Nyquist, alternating +/- every cell) error mode has amplification factor
        // (1 - 8*rate) per step: 0.25 is only where the mode stops being BOUNDED, but anywhere
        // in (0.125, 0.25) it still decays only by flipping sign every step. Measured live
        // this shrinks the checkerboard's amplitude but does not remove it, because the actual
        // mechanism (below) isn't this linear mode at all.
        const rate = Math.min(0.12, RATE * dt);

        // How many neighbours this cell is simultaneously sending to. Matters for the
        // per-link cap just below - see its comment for why.
        const activeCount = (dR > 0 ? 1 : 0) + (dL > 0 ? 1 : 0) + (dU > 0 ? 1 : 0) + (dD > 0 ? 1 : 0);

        // ROOT-CAUSE FIX for the persistent river checkerboard/crenellation (confirmed live,
        // repeatedly, at multiple cells far from the source: window.__game.water/terrain
        // instrumented step-by-step showed a cell's own H alternating in a clean, UNDAMPED
        // period-2 cycle - e.g. 3.079, 3.086, 3.079, 3.085, ... - forever, not decaying, at
        // any rate cap or with the post-update blur pass further down both already in place).
        // That blur pass (and the rate cap above) only fight the SYMPTOM after the fact; this
        // is the actual source. The per-link cap used to be a flat `dR * CELL_AREA * 0.5`:
        // for an ISOLATED pair of cells with only ONE active downhill link, moving exactly
        // half of a height difference in one step is provably exact - it lands precisely on
        // the two cells' shared equilibrium, no more, no less (H_new_A - H_new_B algebraically
        // simplifies to exactly 0). The bug: this per-link cap was computed independently for
        // EACH of up to 4 directions, all from the same start-of-step H - so a cell with two or
        // more simultaneously active downhill neighbours sends each of them "half of MY
        // difference with THEM" without accounting for the water it's ALSO handing to the
        // OTHER neighbour(s) at the same time. Each individual link is safe in isolation, but
        // the combination overshoots the true multi-way equilibrium (the sender's H drops by
        // more than any one neighbour's calculation assumed), and next step the roles reverse -
        // a real, self-sustaining relay, not a decaying transient. It's not the classic
        // Nyquist/diffusion mode the `rate` cap above targets, which is why lowering that
        // alone couldn't remove it; and it's driven fresh every step by whatever is currently
        // perturbing H (channel-carving erosion changes bedrock height every single step), so
        // a periodic corrective blur fighting it from OUTSIDE the transfer step can damp the
        // symptom but can't outrun a continuously-regenerating source - confirmed live: with
        // only the blur+rate-cap fixes, the checkerboard visibly regrew to full severity after
        // several real minutes of play as erosion kept re-perturbing the bed. Dividing the cap
        // by activeCount gives each simultaneously-active link its fair share of the sender's
        // one-step "equalising budget" instead of letting each claim a full independent half-
        // share, so the joint result can no longer overshoot the true multi-way equilibrium
        // regardless of how long erosion keeps disturbing it. Reduces to the exact original,
        // already-correct behaviour whenever only one direction is active (the common case).
        const linkCap = (CELL_AREA * 0.5) / activeCount;

        // A rock's obstruction halo resists flow along a link if EITHER end sits in
        // it - not just flow leaving an obstructed cell, but flow trying to enter one
        // too, or water would only "feel" the rock one hop late. This is what turns a
        // large boulder into a real partial dam: flow toward/through its halo is
        // throttled, so water backs up on the upstream side and gets pushed toward
        // whatever unobstructed link is left (splitting around it, or a new route).
        if (dR > 0) fR[k] = Math.min(available * (dR / sumD) * rate, dR * linkCap) * (1 - Math.max(obK, obstruction[kR]) * 0.92);
        if (dL > 0) fL[k] = Math.min(available * (dL / sumD) * rate, dL * linkCap) * (1 - Math.max(obK, obstruction[kL]) * 0.92);
        if (dU > 0) fU[k] = Math.min(available * (dU / sumD) * rate, dU * linkCap) * (1 - Math.max(obK, obstruction[kU]) * 0.92);
        if (dD > 0) fD[k] = Math.min(available * (dD / sumD) * rate, dD * linkCap) * (1 - Math.max(obK, obstruction[kD]) * 0.92);
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

    // A touch of numerical damping, kept as a SECONDARY safety net after the real fix above
    // (the per-link `linkCap` division by `activeCount`). This blur was the first fix tried
    // for the reported river checkerboard/crenellation, and on its own it looked like it had
    // worked (confirmed live right after landing) - but verified over a much longer live
    // session (~470s+ of real play), the checkerboard fully regrew to its original severity.
    // Root cause turned out to be upstream of this pass entirely (see the long comment on
    // `linkCap` above): a genuine, UNDAMPED per-step relay in the primary transfer step
    // itself, continuously re-excited by erosion changing bedrock height every step, which
    // this after-the-fact blur could only ever partially cancel each step - fine while the
    // relay was weak, overwhelmed once erosion had run long enough to keep driving it harder.
    // With `linkCap` fixing that at the source (verified: a cell's own H no longer alternates
    // step to step, and the channel-wide oscillation metric stays flat over 600+s of simulated
    // time instead of growing), this pass is no longer load-bearing for the original bug - but
    // it's cheap, provably mass-conserving (see below), and a reasonable extra safety margin
    // for whatever small residual noise remains, so it stays.
    //
    // Confirmed live (window.__game.water.depth sampled through the river channel) that this
    // was previously gated to depth > 0.25, specifically to protect a thin trickle crossing
    // dry ground, which relies on its own exact depth to keep advancing - blurring it toward
    // a dry (depth ~ 0) neighbour would visibly stall/shrink the advancing edge. But the
    // river's own body typically sits at ~0.1-0.25, i.e. almost always UNDER that threshold,
    // so it was never smoothed at all - exactly where the reported checkerboard (and, per a
    // raking-camera screenshot, literal crenellation geometry, since pos.y in the vertex
    // shader is driven straight off this depth field - see _buildMesh) was showing up.
    //
    // Fix: gate on TOPOLOGY instead of absolute depth, AND do the exchange as an exactly
    // mass-conserving transfer between cell PAIRS rather than an every-cell "blend toward the
    // neighbourhood average". That distinction matters a lot here: the original per-cell
    // formula pulls a fraction of each neighbour's CURRENT value into this cell without
    // deducting it from that neighbour - fine when almost every neighbour of a smoothed cell
    // is ALSO being smoothed (a big pool, only leaking a little at its rim), but a first
    // attempt at reusing that formula here (gated to "cell and all 4 neighbours are wet",
    // covering the whole river width) measured a real ~17% total-water increase over the
    // deterministic 40s pre-warm (10813.7 -> 12671.9, same seed) - every river cell borders
    // an excluded dry bank on at least one side, so that leak, negligible for a wide pool,
    // compounds every step across the river's entire narrow width. A per-EDGE symmetric
    // exchange (subtract from the giver, add to the receiver, once per link) cannot leak by
    // construction, so it works equally safely on a wide pool or a one-cell-wide trickle.
    //
    // A genuine advancing wetting front always has at least one neighbour that's dry (or
    // negligibly damp) - that's what "the front" means - so by only exchanging across a link
    // where BOTH ends already carry real water, a front cell's exact depth is left untouched
    // on that side (same protection the old code intended), while an interior cell fully
    // surrounded by real water - whether a 2m pool or this 0.1-0.25m river - isn't relying on
    // its own exact depth to reach anywhere new, so it's safe to blur.
    const WET = 0.015; // "real water" vs. the negligible wetting-front edge; matches the
                        // fragment shader's own vDepth < 0.01 discard cutoff, with a touch of
                        // margin so this doesn't fight that boundary.
    // Same effective strength as the old formula in its fully-interior case (self*0.55 +
    // neighbourhood-average*0.45 with 4 neighbours algebraically reduces to depth[k] +=
    // 0.09 * sum(neighbour - depth[k])) - just applied as a real symmetric flux instead of a
    // one-sided borrow, so the coefficient (and thus the smoothing strength) is unchanged
    // from what already-working pools/sea code relied on; only the conservation is fixed.
    const BLUR_K = 0.09;
    const delta = this._blurDelta || (this._blurDelta = new Float32Array(N * N));
    delta.fill(0);
    for (let j = 1; j < N - 2; j++) {
      for (let i = 1; i < N - 2; i++) {
        const k = idx(i, j);
        if (blocked[k] || depth[k] <= WET) continue;
        const kR = idx(i + 1, j);
        if (!blocked[kR] && depth[kR] > WET) {
          const d = BLUR_K * (depth[kR] - depth[k]);
          delta[k] += d; delta[kR] -= d;
        }
        const kU = idx(i, j + 1);
        if (!blocked[kU] && depth[kU] > WET) {
          const d = BLUR_K * (depth[kU] - depth[k]);
          delta[k] += d; delta[kU] -= d;
        }
      }
    }
    for (let k = 0; k < N * N; k++) depth[k] += delta[k];

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

    // Sand slumping: real loose sand can't hold an arbitrarily steep face - past
    // its natural angle of repose it slides until it's shallow enough to stay
    // put. Without this, ongoing erosion above has no slope limit of its own and
    // can carve a bank arbitrarily steep over time - confirmed live: a stream
    // bank generated at a stable, capped ~35 degree slope (see terrain.js's
    // MAX_CROSS_SLOPE, the world-generation-time fix for the same underlying
    // "tooth/staircase" report) had eroded back up to ~70+ degrees after only
    // ~45s of simulated flow, entirely from this function running with no slope
    // constraint of its own. Only affects low-hardness (sandy) ground - rock
    // keeps whatever slope it already has, same as a real cliff face holds one
    // sand never could.
    const MAX_SAND_SLOPE = 0.7; // matches terrain.js's MAX_CROSS_SLOPE, so a
                                 // slumped bank reads the same as a freshly-
                                 // generated one, not steeper or gentler.
    const maxStepPerCell = MAX_SAND_SLOPE * CELL;
    const SLUMP_RATE = 0.5; // fraction of the excess moved per second - fast enough
                             // that a freshly over-steepened bank visibly settles
                             // within a second or two, gentle enough it never
                             // fights actively-flowing water for the same cells.
    for (let j = 1; j < N - 1; j++) {
      for (let i = 1; i < N - 1; i++) {
        const k = idx(i, j);
        if (blocked[k]) continue;
        const soft = 1 - hardness[k]; // 0 = rigid rock, 1 = loose sand
        if (soft <= 0) continue;
        const hk = h[k];
        // +x and +z neighbours only (each undirected edge visited once per
        // step) - move a fraction of whatever sits above the max-slope step
        // from whichever side is higher toward whichever is lower, same as a
        // real slump would.
        const kR = idx(i + 1, j);
        if (!blocked[kR]) {
          const diff = hk - h[kR];
          if (Math.abs(diff) > maxStepPerCell) {
            const move = (Math.abs(diff) - maxStepPerCell) * 0.5 * Math.min(1, SLUMP_RATE * dt) * soft;
            if (diff > 0) { h[k] -= move; h[kR] += move; } else { h[k] += move; h[kR] -= move; }
          }
        }
        const kU = idx(i, j + 1);
        if (!blocked[kU]) {
          const diff = hk - h[kU];
          if (Math.abs(diff) > maxStepPerCell) {
            const move = (Math.abs(diff) - maxStepPerCell) * 0.5 * Math.min(1, SLUMP_RATE * dt) * soft;
            if (diff > 0) { h[k] -= move; h[kU] += move; } else { h[k] += move; h[kU] -= move; }
          }
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
    // ROOT CAUSE of a SEPARATE reported artifact (a regular "comb" of small sandbar
    // teeth with visible shadows along the bank - confirmed, via extensive live
    // instrumentation, to be UNRELATED to the flux-transfer checkerboard fixed
    // above: both terrain.height and water.depth are smooth right through this
    // exact area, at both coarse and fine/render resolution, and the fine mesh's
    // NORMALS/geometry match that smoothness - so the visible "teeth" cannot be
    // geometry. Directly inspecting the fine mesh's baked vertex COLOUR (not its
    // height) at the same live location showed a discrete jump between rows,
    // traced back to THIS moisture update: a hard depth > 0.003 threshold fed
    // into an exponential filter whose old gain (0.06) has a fixed point of
    // 0.06 / (1 - 0.995) = 12, not 1 - so a cell continuously wet saturates at
    // 12 and takes ~16s of being dry just to fall back under 1 (where the clamp
    // in _colorAt's `wetT` actually starts changing), a far longer "sticky" memory
    // than the decay time-constant alone (~6.6s) suggests. Right at the channel's
    // marginal, near-threshold cells - confirmed live sampling several adjacent
    // rows all sitting at depth 0.002-0.003, i.e. within noise of each other and
    // of the 0.003 cutoff - this sub-millimetre, visually meaningless difference
    // was enough to flip the binary target, and the saturating filter then froze
    // whichever side a cell first landed on for a long time. The result: a
    // persistent, essentially frozen wet/dry (P.mud/P.wetSand vs dry sand) mosaic
    // along the bank, unrelated to any real depth difference, rendering as a
    // "toothy" shadowed edge on geometrically smooth ground.
    //
    // Fix: (1) replace the hard threshold with a smooth ramp over a small depth
    // range, so a marginal, near-constant depth produces a correspondingly small,
    // stable moisture target instead of a coin-flip between 0 and 1; (2) fix the
    // gain so the filter's own fixed point is exactly 1 (matching the clamp range
    // _colorAt actually uses), removing the multi-second-long hysteresis that let
    // a stale classification linger. Decay (0.995) is unchanged, so the ~6.6s
    // "stays damp-looking for a while after the water recedes" feel is preserved -
    // only the oversized ceiling and the hard edge are fixed.
    for (let k = 0; k < N * N; k++) {
      const wetTarget = THREE.MathUtils.smoothstep(depth[k], 0.001, 0.01);
      terrain.moisture[k] = terrain.moisture[k] * 0.995 + wetTarget * 0.005;
    }
  }

  // Uploads the coarse (N x N) sim fields into the three small textures the
  // vertex shader samples - see the RENDER_SS comment near the top of this file.
  // Only ever loops over N*N (19600 cells), never the finer RN*RN render grid -
  // the GPU's own texture filtering does the upsampling, not this loop.
  _syncMeshAttrs(terrain) {
    const th = terrain.height;
    const blocked = terrain.blocked;

    const dfData = this._depthFlowTex.image.data;
    const velData = this._velTex.image.data;
    const hData = this._heightTex.image.data;

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
        const p = k * 4;
        dfData[p] = d;
        dfData[p + 1] = this.flowSpeed[k];
        velData[p] = this.velX[k];
        velData[p + 1] = this.velZ[k];
        hData[p] = th[k];
      }
    }

    this._depthFlowTex.needsUpdate = true;
    this._velTex.needsUpdate = true;
    this._heightTex.needsUpdate = true;
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
