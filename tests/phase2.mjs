import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

await mkdir("artifacts", { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  args: ["--enable-webgl", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
const report = {};
try {
  await page.goto(process.env.GAME_URL || "http://127.0.0.1:5174/", { waitUntil: "networkidle" });
  await page.waitForTimeout(700);
  await page.screenshot({ path: "artifacts/phase2-ready.png" });
  await page.click("#start");
  await page.waitForFunction(() => window.__sunny.game.state === "RACING");
  report.particles = await page.evaluate(() => {
    const { game: g, world: w } = window.__sunny, k = g.karts[0];
    k.drift = true; k.driftQuality = 0.9; k.driftAngle = 0.45; k.speed = 27;
    w.clearEffects();
    for (let i = 0; i < 10; i++) w.update(0, 1);
    const frozen = w.particleIndex;
    const counts = [30, 120].map((fps) => {
      w.clearEffects();
      for (let i = 0; i < fps; i++) w.update(1 / fps, 1);
      return w.particleIndex;
    });
    w.clearEffects(); k.drift = false;
    w.emit(k.x, 0.5, k.z, "smoke");
    const initial = w.sizes[0];
    w.update(0.5, 1);
    return { frozen, counts, smokeGrowth: w.sizes[0] / initial, faded: w.opacity[0] };
  });
  assert.equal(report.particles.frozen, 0, "zero elapsed time must not create particles");
  assert.ok(Math.abs(report.particles.counts[0] - report.particles.counts[1]) <= 2,
    "smoke emission must not depend on render FPS");
  assert.ok(report.particles.smokeGrowth > 1.5 && report.particles.faded < 0.4,
    "smoke must expand and fade during its lifetime");
  report.camera = await page.evaluate(() => {
    const { game: g, world: w } = window.__sunny, k = g.karts[0];
    k.drift = false; k.speed = 30;
    for (let i = 0; i < 120; i++) w.update(1 / 60, 1);
    const normal = w.camera.fov;
    k.boostTime = 2;
    for (let i = 0; i < 90; i++) w.update(1 / 60, 1);
    const boost = w.camera.fov;
    k.boostTime = 0;
    w.update(1 / 60, 1);
    const exit = w.camera.fov;
    for (let i = 0; i < 120; i++) w.update(1 / 60, 1);
    return { normal, boost, exit, settled: w.camera.fov };
  });
  assert.ok(report.camera.boost > report.camera.normal + 5);
  assert.ok(Math.abs(report.camera.exit - report.camera.boost) < 1);
  assert.ok(Math.abs(report.camera.settled - report.camera.normal) < 1);
  report.audio = await page.evaluate(async () => {
    const { audio: a, game: g } = window.__sunny;
    g.karts[0].boostTime = 2;
    a.cue("boost");
    await new Promise((r) => setTimeout(r, 160));
    const ducked = a.musicDuck.gain.value, rush = a.boostGain.gain.value;
    let peak = 0;
    for (let i = 0; i < 30; i++) {
      const samples = new Float32Array(2048);
      a.analyser.getFloatTimeDomainData(samples);
      for (const v of samples) peak = Math.max(peak, Math.abs(v));
      await new Promise((r) => setTimeout(r, 30));
    }
    g.karts[0].boostTime = 0;
    return { ducked, rush, peak, restored: a.musicDuck.gain.value };
  });
  assert.ok(report.audio.ducked < 0.65 && report.audio.restored > 0.9);
  assert.ok(report.audio.rush > 0.05 && report.audio.peak > 0.005 && report.audio.peak < 0.98);
  report.tour = [];
  for (const [name, s] of [["festival", 1690], ["windmill", 350], ["market", 860], ["balloons", 1230]]) {
    await page.evaluate((s) => {
      const { game: g, world: w } = window.__sunny, k = g.karts[0];
      k.safeS = s; g.respawn(k); k.speed = 24;
      w.snapCamera();
    }, s);
    await page.waitForTimeout(200);
    await page.screenshot({ path: `artifacts/phase2-${name}.png` });
    report.tour.push(await page.evaluate(async () => {
      const frames = []; let previous = performance.now();
      for (let i = 0; i < 90; i++) {
        await new Promise(requestAnimationFrame);
        const now = performance.now(); frames.push(now - previous); previous = now;
      }
      frames.sort((a, b) => a - b);
      const w = window.__sunny.world;
      return { medianMs: frames[45], p95Ms: frames[85], calls: w.renderer.info.render.calls,
        triangles: w.renderer.info.render.triangles };
    }));
  }
  report.batching = await page.evaluate(async () => {
    const T = await import("/node_modules/three/build/three.module.js");
    const w = window.__sunny.world, batches = [], expanded = [], matrix = new T.Matrix4();
    const g = window.__sunny.game;
    g.karts[0].safeS = g.track.length - 20;
    g.respawn(g.karts[0]); w.snapCamera(); w.update(0, 1);
    w.scene.traverse((o) => { if (o.name === "static-prop-batch") batches.push(o); });
    w.renderer.render(w.scene, w.camera);
    const batchedCalls = w.renderer.info.render.calls;
    for (const batch of batches) {
      batch.visible = false;
      for (let i = 0; i < batch.count; i++) {
        batch.getMatrixAt(i, matrix);
        const m = new T.Mesh(batch.geometry, batch.material);
        m.applyMatrix4(matrix); m.castShadow = batch.castShadow; m.receiveShadow = batch.receiveShadow;
        w.scene.add(m); expanded.push(m);
      }
    }
    w.renderer.render(w.scene, w.camera);
    const separateCalls = w.renderer.info.render.calls;
    for (const m of expanded) m.removeFromParent();
    for (const b of batches) b.visible = true;
    return { batchedCalls, separateCalls, instances: expanded.length };
  });
  assert.ok(report.batching.batchedCalls < report.batching.separateCalls);
  if (process.env.REALTIME === "1") {
    // Exercise real DOM keyboard input and the requestAnimationFrame game loop.
    // No simulation stepping, teleportation, or checkpoint/lap edits in this race.
    await page.keyboard.press("Escape");
    await page.click("#pause-restart");
    await page.evaluate(() => {
      const { game: g } = window.__sunny;
      const held = new Set(); let steeringCredit = 0;
      window.__pilotDone = false;
      const key = (code, down) => {
        if (held.has(code) === down) return;
        if (down) held.add(code); else held.delete(code);
        window.dispatchEvent(new KeyboardEvent(down ? "keydown" : "keyup", { code, bubbles: true }));
      };
      function pilot() {
        const k = g.karts[0];
        if (k.finished || g.time > 300) {
          for (const code of [...held]) key(code, false);
          window.__pilotDone = true;
          return;
        }
        if (g.state === "RACING") {
          const input = g.aiInput(k);
          steeringCredit += Math.abs(input.steer);
          const turn = steeringCredit >= 0.5;
          if (turn) steeringCredit -= 1;
          key("ArrowUp", input.throttle > 0.5);
          key("ArrowDown", input.brake > 0);
          key("ArrowLeft", turn && input.steer < 0);
          key("ArrowRight", turn && input.steer > 0);
          key("ControlLeft", input.boost);
        }
        requestAnimationFrame(pilot);
      }
      requestAnimationFrame(pilot);
    });
    await page.waitForFunction(() => window.__pilotDone, null, { timeout: 320000 });
    report.realtimeRace = await page.evaluate(() => {
      const g = window.__sunny.game, k = g.karts[0];
      return { state: g.state, time: k.finishTime, laps: k.lapTimes, wallHits: k.wallHits,
        ai: g.karts.slice(1).map((a) => ({ laps: a.laps, recovery: a.recoveryCount })) };
    });
    assert.equal(report.realtimeRace.state, "FINISHED");
    assert.equal(report.realtimeRace.laps.length, 3);
    await page.screenshot({ path: "artifacts/phase2-realtime-finish.png" });
    await page.click("#restart");
    await page.waitForFunction(() => window.__sunny.game.state === "COUNTDOWN");
    assert.equal(await page.evaluate(() => window.__sunny.game.time), 0);
  }
  assert.deepEqual(errors, []);
  report.result = "PASS";
  await writeFile("artifacts/phase2-report.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
