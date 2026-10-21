export class SoundEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.engineGain = null;
    this.engineOsc = null;
    this.engineSub = null;
    this.windGain = null;
    this.enabled = true;
    this.failed = false;
  }

  get available() {
    return !this.failed && typeof AudioContext !== 'undefined';
  }

  ensure() {
    if (this.ctx || !this.available) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.enabled ? 0.42 : 0;
      this.master.connect(this.ctx.destination);

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 780;
      filter.Q.value = 3.5;
      this.engineGain = this.ctx.createGain();
      this.engineGain.gain.value = 0;
      filter.connect(this.engineGain).connect(this.master);

      this.engineOsc = this.ctx.createOscillator();
      this.engineOsc.type = 'sawtooth';
      this.engineOsc.frequency.value = 62;
      this.engineSub = this.ctx.createOscillator();
      this.engineSub.type = 'square';
      this.engineSub.frequency.value = 31;
      const subGain = this.ctx.createGain();
      subGain.gain.value = 0.4;
      this.engineOsc.connect(filter);
      this.engineSub.connect(subGain).connect(filter);
      this.engineOsc.start();
      this.engineSub.start();

      const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate * 2, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      this.noiseBuffer = buffer;
      const wind = this.ctx.createBufferSource();
      wind.buffer = buffer;
      wind.loop = true;
      const windFilter = this.ctx.createBiquadFilter();
      windFilter.type = 'bandpass';
      windFilter.frequency.value = 620;
      windFilter.Q.value = 0.6;
      this.windGain = this.ctx.createGain();
      this.windGain.gain.value = 0;
      wind.connect(windFilter).connect(this.windGain).connect(this.master);
      wind.start();
    } catch {
      this.failed = true;
    }
  }

  resume() {
    this.ensure();
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    if (this.ctx && this.master) this.master.gain.setTargetAtTime(enabled ? 0.42 : 0, this.ctx.currentTime, 0.05);
  }

  startRace() {
    this.resume();
    if (this.ctx && this.engineGain) {
      this.engineGain.gain.setTargetAtTime(0.12, this.ctx.currentTime, 0.1);
    }
  }

  stopRace() {
    if (this.ctx && this.engineGain) {
      this.engineGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.15);
      if (this.windGain) this.windGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.15);
    }
  }

  update(speedRatio, throttle, boosting) {
    if (!this.ctx || !this.engineOsc || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    const rpm = 52 + speedRatio * 145 + throttle * 12 + (boosting ? 16 : 0);
    this.engineOsc.frequency.setTargetAtTime(rpm, now, 0.08);
    this.engineSub.frequency.setTargetAtTime(rpm * 0.5, now, 0.09);
    this.engineGain.gain.setTargetAtTime(0.08 + speedRatio * 0.1 + throttle * 0.03, now, 0.1);
    if (this.windGain) this.windGain.gain.setTargetAtTime(speedRatio * 0.13, now, 0.2);
  }

  beep(frequency = 660, duration = 0.12, volume = 0.2) {
    if (!this.ctx || !this.enabled) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    osc.connect(gain).connect(this.master);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  crash(intensity = 1) {
    if (!this.ctx || !this.enabled || !this.noiseBuffer) return;
    const now = this.ctx.currentTime;
    const source = this.ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(900 * intensity, now);
    filter.frequency.exponentialRampToValueAtTime(90, now + 0.4);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.4 * intensity, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
    source.connect(filter).connect(gain).connect(this.master);
    source.start(now);
    source.stop(now + 0.5);
  }

  whoosh() {
    if (!this.ctx || !this.enabled || !this.noiseBuffer) return;
    const now = this.ctx.currentTime;
    const source = this.ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 1.2;
    filter.frequency.setValueAtTime(500, now);
    filter.frequency.exponentialRampToValueAtTime(2400, now + 0.14);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.28, now + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    source.connect(filter).connect(gain).connect(this.master);
    source.start(now);
    source.stop(now + 0.2);
  }

  hit(intensity = 1) {
    if (!this.ctx || !this.enabled) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(190, now);
    osc.frequency.exponentialRampToValueAtTime(45, now + 0.18);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.38 * intensity, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
    osc.connect(gain).connect(this.master);
    osc.start(now);
    osc.stop(now + 0.25);
    this.crash(0.35 * intensity);
  }

  siren() {
    if (!this.ctx || !this.enabled) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.14, now + 0.08);
    gain.gain.setValueAtTime(0.14, now + 1.3);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 1.6);
    for (let i = 0; i < 4; i++) {
      osc.frequency.setValueAtTime(i % 2 ? 640 : 900, now + i * 0.4);
    }
    osc.connect(gain).connect(this.master);
    osc.start(now);
    osc.stop(now + 1.65);
  }

  finish() {
    if (!this.ctx || !this.enabled) return;
    [523, 659, 784].forEach((frequency, index) => {
      setTimeout(() => this.beep(frequency, 0.28, 0.16), index * 120);
    });
  }
}
