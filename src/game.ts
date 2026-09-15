import { CatmullRomCurve3, Vector3 } from "three";

export const DT = 1 / 60;
export const clamp = (v: number, a: number, b: number) =>
  Math.max(a, Math.min(b, v));
export const angle = (v: number) => Math.atan2(Math.sin(v), Math.cos(v));
export const wrap = (v: number, n: number) => ((v % n) + n) % n;
export type Input = {
  throttle: number;
  brake: number;
  steer: number;
  drift: boolean;
  boost: boolean;
};
export const idle: Input = {
  throttle: 0,
  brake: 0,
  steer: 0,
  drift: false,
  boost: false,
};
export type State =
  | "LOADING"
  | "READY"
  | "COUNTDOWN"
  | "RACING"
  | "PAUSED"
  | "FINISHED";
export type Sample = {
  x: number;
  z: number;
  tx: number;
  tz: number;
  nx: number;
  nz: number;
  yaw: number;
  s: number;
};

export class Track {
  width = 17;
  count = 900;
  curve = new CatmullRomCurve3(
    [
      [0, 0],
      [0, 100],
      [30, 185],
      [115, 220],
      [185, 175],
      [185, 85],
      [245, 50],
      [290, 100],
      [340, 105],
      [390, 35],
      [380, -70],
      [280, -145],
      [165, -125],
      [100, -180],
      [5, -180],
      [-65, -120],
      [0, -80],
    ].map(([x, z]) => new Vector3(x * 1.12, 0, z * 1.12)),
    true,
    "centripetal",
  );
  length: number;
  samples: Sample[] = [];
  constructor() {
    this.curve.arcLengthDivisions = 4000;
    this.length = this.curve.getLength();
    for (let i = 0; i < this.count; i++) {
      const p = this.curve.getPointAt(i / this.count),
        t = this.curve.getTangentAt(i / this.count);
      this.samples.push({
        x: p.x,
        z: p.z,
        tx: t.x,
        tz: t.z,
        nx: t.z,
        nz: -t.x,
        yaw: Math.atan2(t.x, t.z),
        s: (i / this.count) * this.length,
      });
    }
  }
  at(s: number): Sample {
    const f = (wrap(s, this.length) / this.length) * this.count,
      i = Math.floor(f),
      a = this.samples[i],
      b = this.samples[(i + 1) % this.count],
      t = f - i;
    const yaw = a.yaw + angle(b.yaw - a.yaw) * t,
      tx = Math.sin(yaw),
      tz = Math.cos(yaw);
    return {
      x: a.x + (b.x - a.x) * t,
      z: a.z + (b.z - a.z) * t,
      tx,
      tz,
      nx: tz,
      nz: -tx,
      yaw,
      s: wrap(s, this.length),
    };
  }
  nearest(x: number, z: number, hint?: number): Sample & { lateral: number } {
    let best = Infinity,
      index = 0;
    const center =
      hint === undefined
        ? 0
        : Math.floor((wrap(hint, this.length) / this.length) * this.count);
    const reach = hint === undefined ? this.count : 28;
    for (let j = hint === undefined ? 0 : -reach; j < reach; j++) {
      const i = wrap(center + j, this.count),
        a = this.samples[i];
      const d = (x - a.x) ** 2 + (z - a.z) ** 2;
      if (d < best) {
        best = d;
        index = i;
      }
    }
    if (hint !== undefined && best > 2500) return this.nearest(x, z);
    let s = this.samples[index].s;
    const a = this.samples[index];
    s += (x - a.x) * a.tx + (z - a.z) * a.tz;
    const p = this.at(s);
    return { ...p, lateral: (x - p.x) * p.nx + (z - p.z) * p.nz };
  }
}

export class Kart {
  id: number;
  name: string;
  color: number;
  x = 0;
  z = 0;
  prevX = 0;
  prevZ = 0;
  yaw = 0;
  prevYaw = 0;
  moveYaw = 0;
  speed = 0;
  steer = 0;
  s = 0;
  lateral = 0;
  safeS = 0;
  lastS = 0;
  started = false;
  nextCheckpoint = 1;
  laps = 0;
  lapStart = 0;
  lapTimes: number[] = [];
  finished = false;
  finishTime = 0;
  finishPlace = 0;
  drift = false;
  driftState: "GRIP" | "DRIFT_ENTER" | "DRIFT" | "DRIFT_EXIT" = "GRIP";
  driftQuality = 0;
  longitudinalAcceleration = 0;
  driftSign = 0;
  driftDuration = 0;
  driftAngle = 0;
  driftDistance = 0;
  driftSpeed = 0;
  charge = 0;
  nitro = 0;
  boostTime = 0;
  boostHeld = false;
  miniTime = 0;
  hit = 0;
  wallHits = 0;
  stuck = 0;
  recoveryCount = 0;
  wrongWay = 0;
  maxSpeed: number;
  acceleration: number;
  confidence: number;
  lane: number;
  response: number;
  constructor(id: number) {
    this.id = id;
    this.name = ["YOU", "MANGO", "MOCHI", "PIP", "CLOVER", "BUBBLE"][id];
    this.color = [0xffc641, 0xff677c, 0xa797ff, 0x55c9f4, 0x74d892, 0xffa668][
      id
    ];
    this.maxSpeed = id === 0 ? 31.5 : [29.2, 29.6, 30.2, 29.8, 30.5][id - 1];
    this.acceleration = id === 0 ? 13.8 : 11.8 + id * 0.32;
    this.confidence = id === 0 ? 1.04 : 0.88 + id * 0.014;
    this.lane = (id % 2 ? 1 : -1) * (1.3 + id * 0.17);
    this.response = 3.3 + id * 0.12;
  }
}

export class Game {
  track = new Track();
  karts: Kart[] = [];
  state: State = "READY";
  previousState: State = "RACING";
  time = 0;
  countdown = 3;
  finishCount = 0;
  events: string[] = [];
  constructor() {
    this.reset();
  }
  reset() {
    this.karts = Array.from({ length: 6 }, (_, id) => new Kart(id));
    this.time = 0;
    this.countdown = 3;
    this.finishCount = 0;
    this.events = [];
    for (const k of this.karts) {
      const s = this.track.length - 14 - Math.floor(k.id / 2) * 6;
      const p = this.track.at(s),
        lane = k.id % 2 === 0 ? -2.8 : 2.8;
      k.x = p.x + p.nx * lane;
      k.z = p.z + p.nz * lane;
      k.yaw = k.moveYaw = p.yaw;
      k.s = k.safeS = k.lastS = s;
      k.prevX = k.x;
      k.prevZ = k.z;
      k.prevYaw = k.yaw;
    }
  }
  start() {
    this.reset();
    this.state = "COUNTDOWN";
    this.events.push("3");
  }
  pause() {
    if (this.state === "PAUSED") {
      this.state = this.previousState;
      return;
    }
    if (this.state === "RACING" || this.state === "COUNTDOWN") {
      this.previousState = this.state;
      this.state = "PAUSED";
    }
  }
  respawn(k: Kart) {
    const p = this.track.at(k.safeS);
    k.x = k.prevX = p.x;
    k.z = k.prevZ = p.z;
    k.yaw = k.prevYaw = k.moveYaw = p.yaw;
    k.s = k.lastS = p.s;
    k.speed = 0;
    k.drift = false;
    k.driftState = "GRIP";
    k.driftQuality = k.driftAngle = k.driftDuration = k.driftDistance = k.driftSpeed = 0;
    k.longitudinalAcceleration = k.steer = 0;
    k.driftSign = 0;
    k.boostTime = 0;
    k.miniTime = 0;
    k.stuck = 0;
    k.wrongWay = 0;
  }
  turnRate(k: Kart) {
    return (
      (1.65 - 0.38 * clamp(Math.abs(k.speed) / 40, 0, 1)) *
      clamp(Math.abs(k.speed) / 7, 0, 1)
    );
  }
  aiInput(k: Kart): Input {
    const near = this.track.nearest(k.x, k.z, k.s);
    const look = 9 + Math.abs(k.speed) * 0.6,
      p = this.track.at(near.s + look);
    let lane = k.lane;
    for (const other of this.karts) {
      if (other === k) continue;
      const ahead = (other.x - k.x) * near.tx + (other.z - k.z) * near.tz;
      if (ahead > 0 && ahead < 12 && Math.abs(other.lateral - k.lateral) < 2.4)
        lane += k.id % 2 ? 1.5 : -1.5;
    }
    lane = clamp(lane, -4, 4);
    const target = Math.atan2(p.x + p.nx * lane - k.x, p.z + p.nz * lane - k.z);
    let curve = 0;
    for (const d of [8, 20, 35, 50]) {
      const a = this.track.at(near.s + d),
        b = this.track.at(near.s + d + 8);
      curve = Math.max(curve, Math.abs(angle(b.yaw - a.yaw)) / 8);
    }
    const targetSpeed = Math.min(
      k.maxSpeed * 0.99,
      Math.sqrt(12 / (curve + 0.001)) * k.confidence,
    );
    const steer = clamp(
      (angle(target - k.yaw) * k.response) / Math.max(0.5, this.turnRate(k)),
      -1,
      1,
    );
    return {
      throttle: k.speed < targetSpeed ? 1 : 0.16,
      brake: k.speed > targetSpeed + 1.5 ? 0.7 : 0,
      steer,
      drift: false,
      boost: k.nitro > 0 && curve < 0.006,
    };
  }
  drive(k: Kart, input: Input) {
    k.prevX = k.x;
    k.prevZ = k.z;
    k.prevYaw = k.yaw;
    k.hit = Math.max(0, k.hit - DT * 3);
    k.boostTime = Math.max(0, k.boostTime - DT);
    k.miniTime = Math.max(0, k.miniTime - DT);
    if (input.boost && !k.boostHeld && k.nitro > 0 && k.boostTime === 0) {
      k.nitro--;
      k.boostTime = 2.15;
      if (k.id === 0) this.events.push("boost");
    }
    k.boostHeld = input.boost;
    const canDrift =
      input.drift && k.speed > 10 && (Math.abs(input.steer) > 0.12 || k.drift);
    if (canDrift && !k.drift) {
      k.driftSign = Math.sign(input.steer);
      k.driftDuration = 0;
      k.driftDistance = 0;
      k.driftState = "DRIFT_ENTER";
    }
    if (!canDrift && k.drift) {
      k.driftState = "DRIFT_EXIT";
      if (k.driftDuration > 0.65 && k.driftDistance > 12 && k.driftQuality > 0.35) {
        k.miniTime = 0.3;
        if (k.id === 0) this.events.push("mini");
      }
    }
    k.drift = canDrift;
    k.steer += (input.steer - k.steer) * (1 - Math.exp(-(k.id === 0 ? 22 : 16) * DT));
    const boosting = k.boostTime > 0,
      max = k.maxSpeed + (boosting ? 13 : k.miniTime > 0 ? 2.5 : 0);
    let acceleration = input.throttle * k.acceleration * (boosting ? 1.75 : 1);
    if (input.brake)
      acceleration -= k.speed > 1 ? 25 * input.brake : 9 * input.brake;
    if (k.miniTime > 0) acceleration += 15;
    acceleration -= k.speed * 0.11 + k.speed * Math.abs(k.speed) * 0.003;
    if (input.throttle === 0 && input.brake === 0)
      acceleration -= Math.sign(k.speed) * 1.2;
    if (k.drift) acceleration -= 1.2;
    const previousSpeed = k.speed;
    k.speed = clamp(
      k.speed + acceleration * DT,
      -7,
      boosting ? max : Math.max(max, k.speed - 14 * DT),
    );
    k.longitudinalAcceleration = (k.speed - previousSpeed) / DT;
    const turn = this.turnRate(k) * (k.drift ? 1.2 : 1) * Math.sign(k.speed);
    const yawStep = k.steer * turn * DT;
    k.yaw += yawStep;
    if (k.drift) {
      // Carry turn motion into the trajectory so steady yaw cannot accumulate extra slip.
      // Opposite steering reduces the target slip without flipping its direction.
      const slipTarget =
        k.driftSign * (0.3 + 0.2 * clamp(k.steer * k.driftSign, -0.8, 1));
      const desired = k.yaw - slipTarget;
      k.moveYaw += yawStep;
      k.moveYaw += angle(desired - k.moveYaw) * (1 - Math.exp(-9 * DT));
    } else k.moveYaw += angle(k.yaw - k.moveYaw) * (1 - Math.exp(-10 * DT));
    k.driftAngle = Math.abs(angle(k.yaw - k.moveYaw));
    k.driftSpeed = Math.max(0, k.speed);
    k.driftQuality = 0;
    if (k.drift) {
      k.driftDuration += DT;
      k.driftDistance += k.speed * DT;
      if (k.driftDuration >= 0.12) k.driftState = "DRIFT";
      k.driftQuality =
        clamp((k.driftSpeed - 10) / 16, 0, 1) * clamp(k.driftAngle / 0.42, 0, 1) *
        clamp(k.driftDuration / 0.3, 0, 1) * clamp(k.driftDistance / 5, 0, 1);
      if (k.nitro < 2) k.charge += k.driftQuality * DT * 0.36;
      if (k.charge >= 1) {
        k.nitro++;
        k.charge -= 1;
        if (k.id === 0) this.events.push("charged");
      }
    } else if (k.driftAngle < 0.025) k.driftState = "GRIP";
    k.x += Math.sin(k.moveYaw) * k.speed * DT;
    k.z += Math.cos(k.moveYaw) * k.speed * DT;
    const p = this.track.nearest(k.x, k.z, k.s),
      limit = this.track.width / 2 - 0.95;
    if (Math.abs(p.lateral) > limit) {
      const sign = Math.sign(p.lateral),
        out = (Math.sin(k.moveYaw) * p.nx + Math.cos(k.moveYaw) * p.nz) * sign;
      k.x = p.x + p.nx * limit * sign;
      k.z = p.z + p.nz * limit * sign;
      if (out > 0) {
        const severity = Math.abs(out * k.speed);
        k.speed *= 1 - clamp(out * 0.2, 0, 0.22);
        k.moveYaw += angle(p.yaw - k.moveYaw) * 0.38;
        k.yaw += angle(p.yaw - k.yaw) * 0.12;
        if (k.hit === 0 && severity > 3) {
          k.hit = 1;
          k.wallHits++;
          if (k.id === 0) this.events.push("hit");
        }
      }
    }
  }
  contacts() {
    for (let i = 0; i < 6; i++)
      for (let j = i + 1; j < 6; j++) {
        const a = this.karts[i],
          b = this.karts[j],
          dx = b.x - a.x,
          dz = b.z - a.z,
          d = Math.hypot(dx, dz);
        if (d >= 2.4) continue;
        const nx = d > 0.001 ? dx / d : 1,
          nz = d > 0.001 ? dz / d : 0,
          push = (2.4 - d) * 0.5;
        a.x -= nx * push;
        a.z -= nz * push;
        b.x += nx * push;
        b.z += nz * push;
        const relative =
          (Math.sin(a.moveYaw) * a.speed - Math.sin(b.moveYaw) * b.speed) * nx +
          (Math.cos(a.moveYaw) * a.speed - Math.cos(b.moveYaw) * b.speed) * nz;
        if (relative > 1) {
          const impulse = relative * 0.52;
          a.speed -=
            impulse * (Math.sin(a.moveYaw) * nx + Math.cos(a.moveYaw) * nz);
          b.speed +=
            impulse * (Math.sin(b.moveYaw) * nx + Math.cos(b.moveYaw) * nz);
          if ((a.id === 0 || b.id === 0) && a.hit === 0 && b.hit === 0)
            this.events.push("hit");
          a.hit = b.hit = 0.6;
        }
      }
  }
  updateProgress(k: Kart) {
    const p = this.track.nearest(k.x, k.z, k.s);
    let delta = p.s - k.lastS;
    if (delta > this.track.length / 2) delta -= this.track.length;
    if (delta < -this.track.length / 2) delta += this.track.length;
    const previous = k.lastS;
    k.s = p.s;
    k.lastS = p.s;
    k.lateral = p.lateral;
    if (k.finished) return;
    if (Math.abs(delta) > 4 || Math.abs(p.lateral) > this.track.width / 2 + 1)
      return;
    if (delta < -0.015) k.wrongWay += DT;
    else k.wrongWay = Math.max(0, k.wrongWay - DT * 2);
    if (delta <= 0) return;
    if (!k.started && previous > this.track.length - 10 && p.s < 10) {
      k.started = true;
    }
    if (!k.started) return;
    const gate = (k.nextCheckpoint * this.track.length) / 24;
    const toGate = wrap(gate - previous, this.track.length);
    if (toGate <= delta + 0.001) {
      k.safeS = wrap(gate + 1, this.track.length);
      if (k.nextCheckpoint === 24) {
        k.laps++;
        k.lapTimes.push(this.time - k.lapStart);
        k.lapStart = this.time;
        k.nextCheckpoint = 1;
        if (k.id === 0) this.events.push("lap");
        if (k.laps === 3) {
          k.finished = true;
          k.finishTime = this.time;
          k.finishPlace = ++this.finishCount;
          if (k.id === 0) {
            this.state = "FINISHED";
            this.events.push("finish");
          }
        }
      } else k.nextCheckpoint++;
    }
    // Only update recovery within the validated checkpoint interval.
    if (
      p.s >= ((k.nextCheckpoint - 1) * this.track.length) / 24 &&
      p.s < (k.nextCheckpoint * this.track.length) / 24 &&
      Math.abs(p.lateral) < 5
    )
      k.safeS = p.s;
  }
  ranking() {
    const score = (k: Kart) =>
      k.started
        ? k.laps * this.track.length +
          Math.min(k.s, (k.nextCheckpoint * this.track.length) / 24)
        : k.s - this.track.length;
    return [...this.karts].sort((a, b) =>
      a.finished && b.finished
        ? a.finishPlace - b.finishPlace
        : a.finished
          ? -1
          : b.finished
            ? 1
            : score(b) - score(a),
    );
  }
  step(input: Input = idle) {
    if (this.state === "COUNTDOWN") {
      const old = Math.ceil(this.countdown);
      this.countdown -= DT;
      if (this.countdown <= 0) {
        this.state = "RACING";
        this.events.push("go");
      } else if (Math.ceil(this.countdown) !== old)
        this.events.push(String(Math.ceil(this.countdown)));
      return;
    }
    if (this.state !== "RACING" && this.state !== "FINISHED") return;
    this.time += DT;
    for (const k of this.karts) {
      this.drive(k, k.id === 0 && !k.finished ? input : this.aiInput(k));
      if (k.id > 0) {
        k.stuck = k.speed < 3 ? k.stuck + DT : 0;
        if (k.stuck > 3.5) {
          this.respawn(k);
          k.recoveryCount++;
        }
      }
    }
    this.contacts();
    for (const k of this.karts) this.updateProgress(k);
  }
}
