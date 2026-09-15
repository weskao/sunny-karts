import { test } from "node:test";
import assert from "node:assert/strict";
import { Game, Track, DT, idle, angle, clamp } from "../src/game.ts";

test("countdown gates motion and timers, then resets all six racers", () => {
  const g = new Game();
  g.start();
  const x = g.karts[0].x;
  for (let i = 0; i < 120; i++) g.step({ ...idle, throttle: 1 });
  assert.equal(g.time, 0);
  assert.equal(g.karts[0].x, x);
  for (let i = 0; i < 70; i++) g.step(idle);
  assert.equal(g.state, "RACING");
  for (let i = 0; i < 120; i++) g.step({ ...idle, throttle: 1 });
  assert.ok(g.karts[0].speed > 15);
  assert.ok(g.time > 1);
  g.start();
  assert.equal(g.time, 0);
  assert.equal(g.karts.length, 6);
  assert.ok(
    g.karts.every((k) => k.laps === 0 && k.nitro === 0 && k.charge === 0),
  );
});

test("track is closed and checkpoints reject backwards travel and skipped gates", () => {
  const t = new Track();
  assert.ok(t.length > 1100 && t.length < 2300);
  assert.ok(
    Math.hypot(t.at(0).x - t.at(t.length).x, t.at(0).z - t.at(t.length).z) <
      0.01,
  );
  const g = new Game();
  const k = g.karts[0];
  const p = t.at(t.length * 0.5);
  k.x = p.x;
  k.z = p.z;
  g.updateProgress(k);
  assert.equal(k.laps, 0);
  assert.equal(k.nextCheckpoint, 1);
  for (let i = 0; i < 3; i++) {
    const q = t.at(t.length - 2);
    k.x = q.x;
    k.z = q.z;
    g.updateProgress(k);
    const r = t.at(2);
    k.x = r.x;
    k.z = r.z;
    g.updateProgress(k);
  }
  assert.equal(k.laps, 0);
});

test("six normal controllers complete three valid laps without teleporting", () => {
  const g = new Game();
  g.start();
  let elapsed = 0;
  while (g.karts.some((k) => !k.finished) && elapsed < 330) {
    g.step(g.aiInput(g.karts[0]));
    elapsed += DT;
  }
  assert.ok(
    g.karts.every((k) => k.finished),
    JSON.stringify(
      g.karts.map((k) => ({
        name: k.name,
        laps: k.laps,
        cp: k.nextCheckpoint,
        s: k.s,
        wall: k.wallHits,
      })),
    ),
  );
  assert.equal(g.state, "FINISHED");
  assert.equal(g.karts[0].lapTimes.length, 3);
  assert.ok(g.karts[0].lapTimes.every((t) => t > 40 && t < 100));
  assert.deepEqual(
    [...g.karts.map((k) => k.finishPlace)].sort(),
    [1, 2, 3, 4, 5, 6],
  );
});

test("sustained drift earns finite nitro; brake, recovery, and wall contacts remain stable", () => {
  const g = new Game();
  g.start();
  for (let i = 0; i < 190; i++) g.step(idle);
  const k = g.karts[0];
  for (let i = 0; i < 12000 && k.nitro === 0; i++) {
    const input = g.aiInput(k);
    input.drift = Math.abs(input.steer) > 0.12;
    g.step(input);
  }
  assert.ok(k.nitro > 0, "good drifting must award nitro");
  const stored = k.nitro;
  g.step({ ...idle, throttle: 1, boost: true });
  assert.equal(k.nitro, stored - 1);
  assert.ok(k.boostTime > 1.5);
  g.step({ ...idle, throttle: 1, boost: true });
  assert.equal(k.nitro, stored - 1, "held control does not consume twice");
  g.respawn(k);
  assert.equal(k.speed, 0);
  assert.equal(k.boostTime, 0);
  for (let i = 0; i < 90; i++) g.step({ ...idle, throttle: 1 });
  const speed = k.speed;
  for (let i = 0; i < 30; i++) g.step({ ...idle, brake: 1 });
  assert.ok(k.speed < speed);
  const p = g.track.at(k.s);
  k.x = p.x + p.nx * 20;
  k.z = p.z + p.nz * 20;
  k.yaw = k.moveYaw = p.yaw + Math.PI / 4;
  k.speed = 20;
  k.hit = 0;
  g.step(idle);
  assert.ok(Math.abs(g.track.nearest(k.x, k.z).lateral) < g.track.width / 2);
  assert.ok(Number.isFinite(k.yaw));
  assert.ok(k.wallHits > 0);
});

test("kart contacts separate bodies and transfer forward momentum without reversing racers", () => {
  const g = new Game(),
    a = g.karts[0],
    b = g.karts[1];
  a.x = b.x = 0;
  a.z = 0;
  b.z = 2;
  a.yaw = b.yaw = a.moveYaw = b.moveYaw = 0;
  a.speed = 28;
  b.speed = 12;
  g.contacts();
  assert.ok(b.z - a.z >= 2.39);
  assert.ok(a.speed < 28 && a.speed > 0);
  assert.ok(b.speed > 12);
});

test("counter-steer changes drift rotation and release restores grip", () => {
  const g = new Game();
  const k = g.karts[0];
  const p = g.track.at(40);
  k.x = p.x;
  k.z = p.z;
  k.s = p.s;
  k.yaw = k.moveYaw = p.yaw;
  k.speed = 24;
  for (let i = 0; i < 15; i++)
    g.drive(k, { ...idle, throttle: 1, steer: 0.6, drift: true });
  assert.ok(k.driftAngle > 0.2);
  const yaw = k.yaw;
  for (let i = 0; i < 15; i++)
    g.drive(k, { ...idle, throttle: 1, steer: -0.6, drift: true });
  assert.ok(k.yaw < yaw, "counter-steering must change rotation");
  const slip = k.driftAngle;
  for (let i = 0; i < 30; i++) g.drive(k, { ...idle, throttle: 1 });
  assert.equal(k.drift, false);
  assert.ok(k.driftAngle < slip * 0.15);
});

test("reverse driving does not award laps and validated progress determines rank", () => {
  const g = new Game(),
    a = g.karts[0],
    b = g.karts[1];
  a.started = b.started = true;
  a.s = 500;
  a.nextCheckpoint = 8;
  b.s = 400;
  b.nextCheckpoint = 7;
  assert.equal(g.ranking()[0].id, 0);
  b.laps = 1;
  assert.equal(g.ranking()[0].id, 1);
  a.laps = 0;
  a.nextCheckpoint = 24;
  a.lastS = 2;
  const p = g.track.at(g.track.length - 1);
  a.x = p.x;
  a.z = p.z;
  a.s = p.s;
  g.updateProgress(a);
  assert.equal(a.laps, 0);
});

test("pause freezes race simulation and empty nitro cannot boost", () => {
  const g = new Game();
  g.start();
  for (let i = 0; i < 190; i++) g.step(idle);
  g.pause();
  const before = g.time,
    x = g.karts[0].x;
  for (let i = 0; i < 120; i++) g.step({ ...idle, throttle: 1 });
  assert.equal(g.time, before);
  assert.equal(g.karts[0].x, x);
  g.pause();
  g.step({ ...idle, throttle: 1, boost: true });
  assert.equal(g.karts[0].boostTime, 0);
});

test("drift has a bounded slip angle, responds to correction, and resets its feedback", () => {
  const g = new Game(), k = g.karts[0];
  g.track.width = 1000; // Isolate handling from barriers.
  k.speed = 27;
  g.drive(k, { ...idle, throttle: 1, steer: 1, drift: true });
  assert.equal(k.driftState, "DRIFT_ENTER");
  for (let i = 0; i < 60; i++) g.drive(k, { ...idle, throttle: 1, steer: 1, drift: true });
  assert.equal(k.driftState, "DRIFT");
  assert.ok(k.driftAngle > 0.25 && k.driftAngle < 0.65, `bounded slip: ${k.driftAngle}`);
  assert.ok(k.driftQuality > 0.5 && k.charge > 0.15);
  const slip = k.driftAngle;
  for (let i = 0; i < 18; i++) g.drive(k, { ...idle, throttle: 1, steer: -1, drift: true });
  assert.ok(k.driftAngle < slip * 0.75, "counter-steering must reduce slip");
  g.drive(k, { ...idle, throttle: 1 });
  assert.equal(k.driftState, "DRIFT_EXIT");
  assert.ok(k.miniTime > 0, "a good exit rewards acceleration");
  for (let i = 0; i < 35; i++) g.drive(k, { ...idle, throttle: 1 });
  assert.equal(k.driftState, "GRIP");
  assert.ok(k.driftAngle < 0.02);
  g.respawn(k);
  assert.equal(k.driftQuality, 0);
  assert.equal(k.driftDuration, 0);
  assert.equal(k.driftAngle, 0);
});

test("nitro rapidly exceeds cruising speed and fades without a speed snap", () => {
  const g = new Game(), k = g.karts[0];
  g.track.width = 1000;
  k.speed = k.maxSpeed;
  k.nitro = 1;
  for (let i = 0; i < 60; i++) g.drive(k, { ...idle, throttle: 1, boost: true });
  assert.ok(k.speed > k.maxSpeed + 12, "nitro must give a large speed burst within one second");
  while (k.boostTime > 0) {
    const before = k.speed;
    g.drive(k, { ...idle, throttle: 1 });
    assert.ok(Math.abs(k.speed - before) < 0.6, "no sudden speed loss when boost expires");
  }
  assert.equal(k.nitro, 0);
});

test("a clean drift-exit kick still accelerates at normal cruising speed", () => {
  const g = new Game(), k = g.karts[0];
  g.track.width = 1000;
  k.speed = k.maxSpeed;
  for (let i = 0; i < 65; i++) g.drive(k, { ...idle, throttle: 1, steer: 0.5, drift: true });
  for (let i = 0; i < 12; i++) g.drive(k, { ...idle, throttle: 1 });
  assert.ok(k.speed > k.maxSpeed + 1, "exit kick must not be swallowed by the normal speed cap");
  assert.equal(k.nitro, 0, "mini boost does not grant stored nitro");
});

test("a drift-aware racing line completes three laps with earned boosts and no wall impacts", () => {
  const g = new Game();
  g.start();
  let driftTicks = 0, boosts = 0;
  for (let i = 0; i < 60 * 300 && !g.karts[0].finished; i++) {
    const k = g.karts[0], n = g.track.nearest(k.x, k.z, k.s);
    const p = g.track.at(n.s + 9 + Math.abs(k.speed) * 0.6);
    const curve = angle(g.track.at(n.s + 26).yaw - n.yaw) / 26;
    const input = g.aiInput(k);
    input.drift = k.speed > 18 && Math.abs(curve) > 0.005 && Math.abs(curve) < 0.026;
    if (input.drift) {
      const sign = k.drift ? k.driftSign : Math.sign(curve);
      const target = Math.atan2(p.x + p.nx * k.lane - k.x, p.z + p.nz * k.lane - k.z);
      input.steer = clamp(angle(target + sign * 0.34 - k.yaw) * 3.3 / g.turnRate(k) / 1.2, -1, 1);
      driftTicks++;
    }
    g.step(input);
    boosts += g.events.filter((e) => e === "boost").length;
    g.events.length = 0;
  }
  assert.ok(g.karts[0].finished);
  assert.equal(g.karts[0].laps, 3);
  assert.equal(g.karts[0].wallHits, 0);
  assert.ok(driftTicks > 60 * 30 && boosts >= 3, `drift ticks ${driftTicks}, earned boosts ${boosts}`);
});
