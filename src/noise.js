// Compact seeded 2D gradient noise (Perlin-like) with fbm helper. No external deps.

function makePermutation(seed) {
  let s = seed >>> 0;
  const rand = () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = p[i]; p[i] = p[j]; p[j] = t;
  }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  return perm;
}

const grad2 = [
  [1, 1], [-1, 1], [1, -1], [-1, -1],
  [1, 0], [-1, 0], [0, 1], [0, -1],
];

function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
function lerp(a, b, t) { return a + t * (b - a); }

export class Noise2D {
  constructor(seed = 1337) {
    this.perm = makePermutation(seed);
  }
  grad(hash, x, y) {
    const g = grad2[hash & 7];
    return g[0] * x + g[1] * y;
  }
  noise(x, y) {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
    const xf = x - Math.floor(x), yf = y - Math.floor(y);
    const u = fade(xf), v = fade(yf);
    const p = this.perm;
    const aa = p[p[X] + Y], ab = p[p[X] + Y + 1];
    const ba = p[p[X + 1] + Y], bb = p[p[X + 1] + Y + 1];
    const x1 = lerp(this.grad(aa, xf, yf), this.grad(ba, xf - 1, yf), u);
    const x2 = lerp(this.grad(ab, xf, yf - 1), this.grad(bb, xf - 1, yf - 1), u);
    return lerp(x1, x2, v); // roughly [-1, 1]
  }
  fbm(x, y, octaves = 4, lacunarity = 2.0, gain = 0.5) {
    let amp = 0.5, freq = 1.0, sum = 0, norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * this.noise(x * freq, y * freq);
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }
  ridged(x, y, octaves = 4, lacunarity = 2.0, gain = 0.5) {
    let amp = 0.5, freq = 1.0, sum = 0, norm = 0;
    for (let i = 0; i < octaves; i++) {
      const n = 1 - Math.abs(this.noise(x * freq, y * freq));
      sum += amp * (n * n);
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }
}
