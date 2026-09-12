import { clamp, type Kart } from "./game.ts";

export class AudioEngine {
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
  music: GainNode | null = null;
  sfx: GainNode | null = null;
  engine: OscillatorNode | null = null;
  engine2: OscillatorNode | null = null;
  engineGain: GainNode | null = null;
  skidGain: GainNode | null = null;
  analyser: AnalyserNode | null = null;
  musicAnalyser: AnalyserNode | null = null;
  engineAnalyser: AnalyserNode | null = null;
  muted = false;
  musicEnabled = true;
  active = false;
  nextNote = 0;
  step = 0;
  timer = 0;
  noise: AudioBuffer | null = null;
  async start() {
    if (!this.ctx) {
      const c = (this.ctx = new AudioContext());
      this.master = c.createGain();
      this.master.gain.value = this.muted ? 0 : 0.65;
      this.master.connect(c.destination);
      this.analyser = c.createAnalyser();
      this.master.connect(this.analyser);
      this.music = c.createGain();
      this.music.gain.value = this.musicEnabled ? 0.18 : 0;
      this.music.connect(this.master);
      this.musicAnalyser = c.createAnalyser();
      this.music.connect(this.musicAnalyser);
      this.sfx = c.createGain();
      this.sfx.gain.value = 0.8;
      this.sfx.connect(this.master);
      this.noise = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      this.engineGain = c.createGain();
      this.engineGain.gain.value = 0;
      const filter = c.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 700;
      this.engine = c.createOscillator();
      this.engine.type = "sawtooth";
      this.engine.frequency.value = 55;
      this.engine2 = c.createOscillator();
      this.engine2.type = "triangle";
      this.engine2.frequency.value = 82;
      this.engine.connect(filter);
      this.engine2.connect(filter);
      filter.connect(this.engineGain);
      this.engineGain.connect(this.sfx);
      this.engineAnalyser = c.createAnalyser();
      this.engineGain.connect(this.engineAnalyser);
      this.engine.start();
      this.engine2.start();
      const skid = c.createBufferSource();
      skid.buffer = this.noise;
      skid.loop = true;
      const band = c.createBiquadFilter();
      band.type = "bandpass";
      band.frequency.value = 1700;
      band.Q.value = 0.75;
      this.skidGain = c.createGain();
      this.skidGain.gain.value = 0;
      skid.connect(band);
      band.connect(this.skidGain);
      this.skidGain.connect(this.sfx);
      skid.start();
      this.timer = window.setInterval(() => this.schedule(), 35);
    }
    await this.ctx.resume();
    this.active = true;
    this.nextNote = this.ctx.currentTime + 0.08;
  }
  tone(
    freq: number,
    time: number,
    duration: number,
    volume: number,
    type: OscillatorType = "sine",
    music = false,
    end?: number,
  ) {
    const c = this.ctx;
    if (!c) return;
    const o = c.createOscillator(),
      g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, time);
    if (end) o.frequency.exponentialRampToValueAtTime(end, time + duration);
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(Math.max(0.001, volume), time + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    o.connect(g);
    g.connect((music ? this.music : this.sfx)!);
    o.start(time);
    o.stop(time + duration + 0.02);
    o.onended = () => {
      o.disconnect();
      g.disconnect();
    };
  }
  hiss(
    time: number,
    duration: number,
    volume: number,
    freq: number,
    music = false,
  ) {
    const c = this.ctx;
    if (!c) return;
    const n = c.createBufferSource(),
      g = c.createGain(),
      f = c.createBiquadFilter();
    n.buffer = this.noise;
    f.type = "highpass";
    f.frequency.value = freq;
    g.gain.setValueAtTime(volume, time);
    g.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    n.connect(f);
    f.connect(g);
    g.connect((music ? this.music : this.sfx)!);
    n.start(time);
    n.stop(time + duration);
    n.onended = () => {
      n.disconnect();
      f.disconnect();
      g.disconnect();
    };
  }
  schedule() {
    if (!this.ctx || !this.active || this.ctx.state !== "running") return;
    const c = this.ctx,
      beat = 60 / 148 / 2;
    if (this.nextNote < c.currentTime) this.nextNote = c.currentTime + 0.03;
    // Original 8-bar composition, "Sunbeam Sprint", in D major. All notes synthesized locally.
    const melody = [
      74, 78, 81, 78, 76, 74, 69, 73, 74, 78, 83, 81, 78, 76, 74, 0, 71, 74, 78,
      81, 83, 81, 78, 76, 73, 76, 81, 85, 83, 81, 76, 0, 74, 81, 78, 86, 85, 81,
      78, 76, 71, 78, 74, 83, 81, 78, 76, 74, 67, 71, 74, 79, 78, 74, 71, 69,
      69, 73, 76, 81, 78, 76, 73, 0,
    ];
    const roots = [50, 47, 55, 57, 50, 47, 55, 57];
    const hz = (n: number) => 440 * 2 ** ((n - 69) / 12);
    while (this.nextNote < c.currentTime + 0.15) {
      const s = this.step % 64,
        t = this.nextNote,
        note = melody[s],
        root = roots[Math.floor(s / 8)];
      if (note) this.tone(hz(note), t, beat * 0.82, 0.11, "triangle", true);
      if (s % 2 === 0)
        this.tone(
          hz(root + (s % 8 === 4 ? 12 : 0)),
          t,
          beat * 1.5,
          0.17,
          "triangle",
          true,
        );
      if (s % 4 === 0) this.tone(140, t, 0.18, 0.45, "sine", true, 42);
      if (s % 4 === 2) {
        this.hiss(t, 0.12, 0.09, 1300, true);
        this.tone(180, t, 0.1, 0.12, "triangle", true, 80);
      }
      this.hiss(t, 0.045, s % 2 ? 0.028 : 0.018, 6800, true);
      if (s % 8 === 0)
        for (const interval of [0, 4, 7])
          this.tone(hz(root + 12 + interval), t, beat * 5, 0.022, "sine", true);
      this.step++;
      this.nextNote += beat;
    }
  }
  cue(name: string) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (["3", "2", "1"].includes(name)) this.tone(640, t, 0.2, 0.45, "sine");
    if (name === "go") {
      this.tone(960, t, 0.42, 0.45, "square");
      this.tone(1440, t + 0.05, 0.4, 0.15);
    }
    if (name === "boost") {
      this.hiss(t, 0.75, 0.4, 420);
      this.tone(160, t, 0.7, 0.25, "sawtooth", false, 920);
    }
    if (name === "hit") {
      this.hiss(t, 0.12, 0.35, 300);
      this.tone(100, t, 0.14, 0.3, "triangle", false, 35);
    }
    if (name === "charged" || name === "lap")
      [660, 880, 1100].forEach((f, i) =>
        this.tone(f, t + i * 0.08, 0.16, 0.18),
      );
    if (name === "finish")
      [587, 740, 880, 1174, 1108, 1174].forEach((f, i) =>
        this.tone(f, t + i * 0.15, 0.4, 0.25, "triangle"),
      );
  }
  update(k: Kart, running: boolean) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const rpm = 58 + Math.abs(k.speed) * 4.1 + (k.boostTime > 0 ? 40 : 0);
    this.engine!.frequency.setTargetAtTime(rpm, t, 0.08);
    this.engine2!.frequency.setTargetAtTime(rpm * 1.505, t, 0.08);
    this.engineGain!.gain.setTargetAtTime(
      running ? 0.027 + clamp(Math.abs(k.speed) / 32, 0, 1) * 0.027 : 0,
      t,
      0.1,
    );
    this.skidGain!.gain.setTargetAtTime(
      running && k.drift ? clamp(k.driftAngle, 0.1, 0.7) * 0.2 : 0,
      t,
      0.07,
    );
  }
  setPaused(paused: boolean) {
    this.active = !paused;
    if (this.ctx) {
      if (paused) void this.ctx.suspend();
      else void this.start();
    }
  }
  toggleMute() {
    this.muted = !this.muted;
    if (this.master && this.ctx)
      this.master.gain.setTargetAtTime(
        this.muted ? 0 : 0.65,
        this.ctx.currentTime,
        0.04,
      );
  }
  toggleMusic() {
    this.musicEnabled = !this.musicEnabled;
    if (this.music && this.ctx)
      this.music.gain.setTargetAtTime(
        this.musicEnabled ? 0.18 : 0,
        this.ctx.currentTime,
        0.05,
      );
  }
}
