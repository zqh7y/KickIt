// Procedural sound: every effect is synthesised with WebAudio at runtime.
export class Sfx {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private rollGain!: GainNode;
  private rollFilter!: BiquadFilterNode;
  private lastPop = 0;

  /** Call from a user gesture. Safe to call repeatedly. */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      try {
        this.ctx = new AC({ latencyHint: 'interactive' });
      } catch {
        return;
      }
      const c = this.ctx;
      const comp = c.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      this.master = c.createGain();
      this.master.gain.value = 0.8;
      this.master.connect(comp).connect(c.destination);
      this.noise = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let k = 0; k < d.length; k++) d[k] = Math.random() * 2 - 1;
      // continuous rolling rumble, gain driven by ball speed
      const src = c.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      this.rollFilter = c.createBiquadFilter();
      this.rollFilter.type = 'lowpass';
      this.rollFilter.frequency.value = 300;
      this.rollGain = c.createGain();
      this.rollGain.gain.value = 0;
      src.connect(this.rollFilter).connect(this.rollGain).connect(this.master);
      src.start();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  suspend() {
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend();
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private get t() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  /** Only schedule sounds on a running context; a suspended one would play them all at once later. */
  private get live() {
    return this.ctx && this.ctx.state === 'running' ? this.ctx : null;
  }

  private tone(type: OscillatorType, f0: number, f1: number, dur: number, gain: number, delay = 0, attack = 0.004) {
    const c = this.live;
    if (!c) return;
    const t = this.t + delay;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private hiss(dur: number, gain: number, type: BiquadFilterType, f0: number, f1 = f0, q = 0.8, delay = 0, attack = 0.005) {
    const c = this.live;
    if (!c) return;
    const t = this.t + delay;
    const s = c.createBufferSource();
    s.buffer = this.noise;
    s.loop = true; // long swells outlast the 2 s buffer
    const f = c.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.master);
    s.start(t, Math.random() * 1.5);
    s.stop(t + dur + 0.05);
  }

  kick(power: number) {
    const p = Math.max(0.15, power);
    this.tone('sine', 160, 48, 0.2, 0.55 + p * 0.45);
    this.tone('triangle', 520, 210, 0.06, 0.18 + p * 0.12);
    this.hiss(0.04, 0.25 + p * 0.2, 'highpass', 2200);
    if (power > 0.7) this.hiss(0.18, 0.08, 'bandpass', 700, 300, 0.7, 0.01);
  }

  land(speed: number) {
    const v = Math.min(1, speed / 5);
    if (v < 0.05) return;
    this.tone('sine', 130, 55, 0.13, 0.2 + v * 0.45);
    this.hiss(0.05, 0.05 + v * 0.1, 'lowpass', 900);
  }

  wall(speed: number) {
    const v = Math.min(1, speed / 5);
    this.tone('sine', 360, 170, 0.09, 0.15 + v * 0.35);
    this.hiss(0.05, 0.06 + v * 0.12, 'bandpass', 1300, 900, 1.2);
  }

  /** Wooden clack of a fence board. */
  fence(speed: number) {
    const v = Math.min(1, speed / 5);
    this.tone('triangle', 620, 340, 0.07, 0.12 + v * 0.25);
    this.hiss(0.04, 0.05 + v * 0.1, 'bandpass', 2200, 1600, 2);
  }

  /** Trampoline: a springy boing. */
  tramp() {
    const c = this.live;
    if (!c) return;
    const t = this.t;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(160, t);
    o.frequency.exponentialRampToValueAtTime(520, t + 0.16);
    o.frequency.exponentialRampToValueAtTime(380, t + 0.38);
    const lfo = c.createOscillator();
    lfo.frequency.value = 18;
    const depth = c.createGain();
    depth.gain.value = 26;
    lfo.connect(depth).connect(o.frequency);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.32, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
    o.connect(g).connect(this.master);
    o.start(t);
    lfo.start(t);
    o.stop(t + 0.45);
    lfo.stop(t + 0.45);
  }

  /** Boost pad: a quick rising whoosh. */
  boost() {
    this.hiss(0.32, 0.16, 'bandpass', 500, 3200, 1.4, 0, 0.02);
    this.tone('sawtooth', 220, 880, 0.24, 0.05);
  }

  /** Portal: a warbling warp. */
  portal() {
    this.tone('sine', 1200, 260, 0.22, 0.14);
    this.tone('sine', 300, 1400, 0.26, 0.12, 0.12);
    this.hiss(0.4, 0.05, 'highpass', 2500, 5000, 0.7);
  }

  /** Pinball bumper: a bright ding. */
  bumper() {
    this.tone('triangle', 1320, 1300, 0.28, 0.16);
    this.tone('sine', 1980, 1960, 0.2, 0.08, 0.005);
    this.tone('sine', 140, 70, 0.1, 0.25);
  }

  /** Rolling rumble level (ball speed in tiles/s, 0 when still or airborne). */
  roll(speed: number) {
    if (!this.ctx) return;
    const v = Math.min(1, speed / 6);
    this.rollGain.gain.setTargetAtTime(v > 0.01 ? 0.05 + v * 0.16 : 0, this.t, 0.05);
    this.rollFilter.frequency.setTargetAtTime(220 + v * 900, this.t, 0.05);
  }

  vanish() {
    this.tone('sine', 380, 1700, 0.22, 0.16);
    this.tone('triangle', 900, 2600, 0.18, 0.06, 0.03);
    this.hiss(0.25, 0.05, 'highpass', 3000, 6000);
  }

  appear() {
    this.tone('sine', 1900, 520, 0.24, 0.15);
    for (let k = 0; k < 4; k++) this.tone('sine', 1800 + k * 420, 1700 + k * 400, 0.09, 0.05, 0.05 + k * 0.045);
  }

  /** Countdown tick; `urgent` in the last seconds. */
  tick(urgent: boolean) {
    this.tone('square', urgent ? 1500 : 1100, urgent ? 1400 : 1000, 0.035, urgent ? 0.06 : 0.035);
  }

  /** Referee whistle: short pip, long blast, or the full-time three. */
  whistle(kind: 'pip' | 'long' | 'full') {
    const c = this.live;
    if (!c) return;
    const blasts = kind === 'pip' ? [[0, 0.16]] : kind === 'long' ? [[0, 0.7]] : [[0, 0.22], [0.3, 0.22], [0.6, 0.75]];
    for (const [delay, dur] of blasts) {
      const t = this.t + delay;
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.value = 2850;
      const lfo = c.createOscillator();
      lfo.frequency.value = 34;
      const depth = c.createGain();
      depth.gain.value = 160;
      lfo.connect(depth).connect(o.frequency);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.11, t + 0.02);
      g.gain.setValueAtTime(0.11, t + dur - 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(this.master);
      o.start(t);
      lfo.start(t);
      o.stop(t + dur + 0.02);
      lfo.stop(t + dur + 0.02);
      this.hiss(dur, 0.03, 'bandpass', 2900, 2900, 3, delay);
    }
  }

  win() {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, k) => this.tone('triangle', f, f, 0.35, 0.16, k * 0.075, 0.006));
    [1046.5, 1318.5, 1568].forEach((f, k) => this.tone('sine', f, f * 1.002, 0.9, 0.06, 0.3 + k * 0.01, 0.02));
    // crowd roar: a swell of band-passed noise
    this.hiss(1.7, 0.2, 'bandpass', 700, 1100, 0.5, 0.05, 0.22);
    this.hiss(1.4, 0.08, 'bandpass', 2200, 1800, 0.9, 0.12, 0.2);
  }

  fail() {
    this.tone('sawtooth', 330, 300, 0.22, 0.06);
    this.tone('sawtooth', 262, 180, 0.42, 0.07, 0.18);
    // crowd "ohh"
    this.hiss(1.1, 0.12, 'lowpass', 1300, 260, 0.7, 0.02, 0.12);
  }

  fall() {
    this.tone('sine', 700, 120, 0.7, 0.13);
  }

  pop() {
    const now = performance.now();
    if (now - this.lastPop < 28) return;
    this.lastPop = now;
    const f = 520 + Math.random() * 380;
    this.tone('sine', f, f * 1.6, 0.07, 0.035);
  }

  tap() {
    this.tone('sine', 700, 980, 0.06, 0.08);
  }

  /** Short notch while aiming, rising with power. */
  notch(power: number) {
    const f = 600 + power * 900;
    this.tone('sine', f, f, 0.025, 0.03);
  }
}
