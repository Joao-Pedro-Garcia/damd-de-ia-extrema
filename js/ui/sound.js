// Efeitos sonoros sintetizados com Web Audio (sem arquivos externos).

export class Sound {
  constructor(enabled = true) {
    this.enabled = enabled;
    this.ctx = null;
  }

  ensure() {
    if (!this.enabled) return null;
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  tone(freq, dur, { type = 'sine', gain = 0.18, delay = 0, slide = 0 } = {}) {
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(ctx.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  click(delay = 0) {
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const len = Math.floor(ctx.sampleRate * 0.05);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 4);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1800;
    f.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.value = 0.6;
    src.connect(f).connect(g).connect(ctx.destination);
    src.start(t);
  }

  select() { this.tone(660, 0.06, { type: 'triangle', gain: 0.08 }); }
  move() { this.click(); this.tone(220, 0.08, { type: 'sine', gain: 0.1 }); }
  capture(n = 1) {
    for (let i = 0; i < n; i++) {
      this.click(i * 0.26);
      this.tone(180, 0.14, { type: 'triangle', gain: 0.16, delay: i * 0.26, slide: -80 });
    }
  }
  promote() {
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.18, { type: 'triangle', gain: 0.12, delay: i * 0.07 }));
  }
  illegal() { this.tone(140, 0.12, { type: 'square', gain: 0.05 }); }
  win() { [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(f, 0.25, { type: 'triangle', gain: 0.13, delay: i * 0.11 })); }
  lose() { [392, 330, 262, 196].forEach((f, i) => this.tone(f, 0.3, { type: 'sine', gain: 0.13, delay: i * 0.16 })); }
  draw() { [440, 440].forEach((f, i) => this.tone(f, 0.2, { type: 'sine', gain: 0.1, delay: i * 0.2 })); }
}
