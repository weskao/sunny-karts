import { test } from "node:test";
import assert from "node:assert/strict";
import { Game, Track, DT, idle } from "../src/game.ts";

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
