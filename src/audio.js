// Procedural ambient audio via Web Audio API - no external sound files needed.

export class AudioSystem {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.master = null;
    this.started = false;
  }

  start() {
    if (this.started) return;
    this.started = true;
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.85;
    this.master.connect(ctx.destination);

    this._noiseBuffer = this._makeNoiseBuffer(2);

    this.ocean = this._makeOceanBed();
    this.stream = this._makeStreamBed();
    this.wind = this._makeWindBed();
  }

  _makeNoiseBuffer(seconds) {
    const ctx = this.ctx;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  _loopingNoise() {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer;
    src.loop = true;
    src.start();
    return src;
  }

  _makeOceanBed() {
    const ctx = this.ctx;
    const src = this._loopingNoise();
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 480;
    const gain = ctx.createGain();
    gain.gain.value = 0.22;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.09;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.09;
    lfo.connect(lfoGain).connect(gain.gain);
    lfo.start();
    src.connect(filter).connect(gain).connect(this.master);
    return { gain, filter };
  }

  _makeStreamBed() {
    const ctx = this.ctx;
    const src = this._loopingNoise();
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1400;
    filter.Q.value = 0.6;
    const gain = ctx.createGain();
    gain.gain.value = 0.05;
    src.connect(filter).connect(gain).connect(this.master);
    return { gain, filter };
  }

  _makeWindBed() {
    const ctx = this.ctx;
    const src = this._loopingNoise();
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 900;
    const gain = ctx.createGain();
    gain.gain.value = 0.03;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.045;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 260;
    lfo.connect(lfoGain).connect(filter.frequency);
    lfo.start();
    src.connect(filter).connect(gain).connect(this.master);
    return { gain, filter };
  }

  setStreamIntensity(v) {
    if (!this.stream) return;
    const target = 0.03 + Math.min(0.16, v * 0.16);
    this.stream.gain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.4);
  }

  footstep() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 700 + Math.random() * 400;
    filter.Q.value = 1.2;
    const gain = ctx.createGain();
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.09, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
    src.connect(filter).connect(gain).connect(this.master);
    src.start(now);
    src.stop(now + 0.12);
  }

  digScrape() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1800 + Math.random() * 600;
    filter.Q.value = 0.8;
    const gain = ctx.createGain();
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.14, now + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
    src.connect(filter).connect(gain).connect(this.master);
    src.start(now);
    src.stop(now + 0.3);
  }

  rockScrape() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 420;
    const gain = ctx.createGain();
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.1, now + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);
    src.connect(filter).connect(gain).connect(this.master);
    src.start(now);
    src.stop(now + 0.55);
  }

  splash() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 900;
    const gain = ctx.createGain();
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.12, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
    src.connect(filter).connect(gain).connect(this.master);
    src.start(now);
    src.stop(now + 0.22);
  }

  setEnabled(v) {
    this.enabled = v;
    if (this.master) this.master.gain.setTargetAtTime(v ? 0.85 : 0, this.ctx.currentTime, 0.2);
  }
}
