/** Procedural engine + tyre-skid audio synthesised with the WebAudio API, so it
 * responds continuously to speed / throttle / slip (much more satisfying than a
 * looped clip). One-shot SFX and music are played through Phaser separately. */
export class EngineAudio {
  private ctx: AudioContext;
  private master: GainNode;

  // engine: two detuned saws through a lowpass, pitch tracks speed
  private oscA!: OscillatorNode;
  private oscB!: OscillatorNode;
  private engineFilter!: BiquadFilterNode;
  private engineGain!: GainNode;

  // tyre skid: looping noise through a bandpass
  private skidGain!: GainNode;

  private started = false;
  private muted = false;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.0;
    this.master.connect(ctx.destination);
  }

  /** Build & start the oscillators. Call once, after a user gesture. */
  start(): void {
    if (this.started) return;
    this.started = true;
    const ctx = this.ctx;

    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = "lowpass";
    this.engineFilter.frequency.value = 420;
    this.engineFilter.Q.value = 0.6;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0.0;

    // oscA: main body (sawtooth, slightly detuned for a thick rumble)
    this.oscA = ctx.createOscillator();
    this.oscA.type = "sawtooth";
    this.oscA.frequency.value = 45;
    this.oscA.detune.value = -6;
    // oscB: sub-octave triangle for low-end weight (smooth, not buzzy)
    this.oscB = ctx.createOscillator();
    this.oscB.type = "triangle";
    this.oscB.frequency.value = 22;
    this.oscA.connect(this.engineFilter);
    this.oscB.connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain);
    this.engineGain.connect(this.master);
    this.oscA.start();
    this.oscB.start();

    // skid noise
    const noise = ctx.createBufferSource();
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    noise.buffer = buf;
    noise.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 1800;
    band.Q.value = 0.8;
    this.skidGain = ctx.createGain();
    this.skidGain.gain.value = 0.0;
    noise.connect(band);
    band.connect(this.skidGain);
    this.skidGain.connect(this.master);
    noise.start();

    this.master.gain.linearRampToValueAtTime(this.muted ? 0 : 0.9, ctx.currentTime + 0.4);
  }

  /** speed01: 0..1 of top speed. throttle: -1..1. */
  setEngine(speed01: number, throttle: number): void {
    if (!this.started) return;
    const t = this.ctx.currentTime;
    // Lower, mellower pitch range than before; tracks speed but stays rumbly.
    const rpm = 38 + Math.min(1, speed01) * 120 + Math.max(0, throttle) * 18;
    this.oscA.frequency.setTargetAtTime(rpm, t, 0.06);
    this.oscB.frequency.setTargetAtTime(rpm * 0.5, t, 0.06);
    // keep the lowpass low so harmonics stay soft, not screechy
    this.engineFilter.frequency.setTargetAtTime(360 + speed01 * 900, t, 0.06);
    const load = 0.06 + Math.max(0, throttle) * 0.06 + speed01 * 0.05;
    this.engineGain.gain.setTargetAtTime(load, t, 0.08);
  }

  /** amount: 0..1 of how hard the car is sliding. */
  setSkid(amount: number): void {
    if (!this.started) return;
    this.skidGain.gain.setTargetAtTime(Math.min(1, amount) * 0.22, this.ctx.currentTime, 0.05);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.started) {
      this.master.gain.setTargetAtTime(muted ? 0 : 0.9, this.ctx.currentTime, 0.1);
    }
  }
  isMuted(): boolean {
    return this.muted;
  }
}
