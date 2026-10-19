import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

await mkdir("artifacts", { recursive: true });
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ||
    // CI uses Playwright's bundled Chromium.
    (process.env.CI
      ? undefined
      : "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
  headless: true,
  args: ["--enable-webgl", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({
  // CI renders WebGL in software; a smaller canvas keeps the sim near real time.
  viewport: process.env.CI ? { width: 960, height: 600 } : { width: 1440, height: 900 },
  deviceScaleFactor: 1,
});
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
const report = {};
try {
  await page.goto(process.env.GAME_URL || "http://127.0.0.1:5174/", {
    waitUntil: "networkidle",
  });
  await page.waitForFunction(
    () => window.__sunny?.world.renderer.info.render.calls > 0,
  );
  // Drop shadows on CI without changing world.quality, which the #quality checks below read.
  if (process.env.CI)
    await page.evaluate(() => (window.__sunny.world.renderer.shadowMap.enabled = false));
  await page.screenshot({ path: "artifacts/01-ready.png" });
  assert.equal(await page.locator("#ready").isVisible(), true);
  await page.click("#music");
  await page.click("#sound");
  await page.click("#start");
  await page.waitForFunction(() => window.__sunny.game.state === "COUNTDOWN");
  assert.equal(
    await page.evaluate(() => window.__sunny.audio.master.gain.value),
    0,
  );
  assert.equal(
    await page.evaluate(() => window.__sunny.audio.music.gain.value),
    0,
  );
  await page.click("#music");
  await page.click("#sound");
  await page.keyboard.down("ArrowUp");
  // Sample each frame while still in COUNTDOWN: slow CI renderers can end the 3 s countdown early.
  assert.equal(
    await page.evaluate(
      () =>
        new Promise((resolve) => {
          const t0 = performance.now();
          let moved = 0;
          const tick = () => {
            const g = window.__sunny.game;
            if (g.state !== "COUNTDOWN" || performance.now() - t0 > 800)
              return resolve(moved);
            moved ||= g.karts[0].speed;
            requestAnimationFrame(tick);
          };
          tick();
        }),
    ),
    0,
  );
  await page.screenshot({ path: "artifacts/02-countdown.png" });
  await page.waitForFunction(() => window.__sunny.game.state === "RACING");
  await page.waitForTimeout(1800);
  await page.keyboard.up("ArrowUp");
  report.acceleration = await page.evaluate(
    () => window.__sunny.game.karts[0].speed,
  );
  assert.ok(report.acceleration > 15);
  report.audio = await page.evaluate(async () => {
    const a = window.__sunny.audio;
    const t0 = a.ctx.currentTime;
    let music = 0,
      engine = 0;
    for (let i = 0; i < 12; i++) {
      const x = new Float32Array(2048),
        y = new Float32Array(2048);
      a.musicAnalyser.getFloatTimeDomainData(x);
      a.engineAnalyser.getFloatTimeDomainData(y);
      music = Math.max(
        music,
        Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length),
      );
      engine = Math.max(
        engine,
        Math.sqrt(y.reduce((s, v) => s + v * v, 0) / y.length),
      );
      await new Promise((r) => setTimeout(r, 30));
    }
    return {
      state: a.ctx.state,
      musicRMS: music,
      engineRMS: engine,
      clockAdvance: a.ctx.currentTime - t0,
    };
  });
  assert.equal(report.audio.state, "running");
  assert.ok(report.audio.musicRMS > 0.001, JSON.stringify(report.audio));
  assert.ok(report.audio.engineRMS > 0.001, JSON.stringify(report.audio));
  await page.keyboard.down("ArrowDown");
  await page.waitForTimeout(650);
  await page.keyboard.up("ArrowDown");
  report.braking = await page.evaluate(
    () => window.__sunny.game.karts[0].speed,
  );
  assert.ok(report.braking < report.acceleration);
  await page.keyboard.press("KeyR");
  await page.keyboard.down("KeyW");
  await page.waitForTimeout(1800);
  const yaw = await page.evaluate(() => window.__sunny.game.karts[0].yaw);
  await page.keyboard.down("Shift");
  await page.keyboard.down("KeyD");
  await page.waitForTimeout(550);
  report.drift = await page.evaluate(() => {
    const k = window.__sunny.game.karts[0];
    return {
      drift: k.drift,
      angle: k.driftAngle,
      charge: k.charge,
      yaw: k.yaw,
    };
  });
  assert.ok(
    report.drift.drift && report.drift.angle > 0.2 && report.drift.charge > 0,
  );
  assert.ok(Math.abs(report.drift.yaw - yaw) > 0.1);
  await page.screenshot({ path: "artifacts/03-drifting.png" });
  await page.keyboard.up("Shift");
  await page.keyboard.up("KeyD");
  await page.keyboard.up("KeyW");
  await page.keyboard.press("KeyR");
  await page.waitForTimeout(50);
  assert.ok(
    Math.abs(await page.evaluate(() => window.__sunny.game.karts[0].speed)) < 1,
  );
  report.nitro = await page.evaluate(() => {
    const g = window.__sunny.game,
      k = g.karts[0];
    let ticks = 0;
    while (k.nitro === 0 && ticks++ < 10000) {
      const input = g.aiInput(k);
      input.drift = Math.abs(input.steer) > 0.12;
      g.step(input);
    }
    window.__sunny.world.snapCamera();
    return { nitro: k.nitro, charge: k.charge, ticks };
  });
  assert.ok(report.nitro.nitro > 0);
  await page.keyboard.down("Control");
  await page.keyboard.down("KeyW");
  await page.waitForTimeout(200);
  report.boost = await page.evaluate(() => ({
    remaining: window.__sunny.game.karts[0].boostTime,
    flames: window.__sunny.world.flames[0].every((f) => f.visible),
    fov: window.__sunny.world.camera.fov,
  }));
  assert.ok(report.boost.remaining > 1);
  assert.ok(report.boost.flames);
  assert.equal(
    await page
      .locator("body")
      .evaluate((e) => e.classList.contains("boosting")),
    true,
  );
  await page.screenshot({ path: "artifacts/04-nitro.png" });
  await page.keyboard.up("Control");
  await page.keyboard.up("KeyW");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(80);
  const pausedTime = await page.evaluate(() => window.__sunny.game.time);
  await page.waitForTimeout(250);
  assert.equal(await page.evaluate(() => window.__sunny.game.time), pausedTime);
  await page.click("#resume");
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => window.__sunny.game.state), "RACING");
  report.performance = await page.evaluate(async () => {
    const times = [];
    let before = performance.now();
    for (let i = 0; i < 120; i++) {
      await new Promise(requestAnimationFrame);
      const n = performance.now();
      times.push(n - before);
      before = n;
    }
    times.sort((a, b) => a - b);
    return {
      medianMs: times[60],
      p95Ms: times[114],
      drawCalls: window.__sunny.world.renderer.info.render.calls,
      triangles: window.__sunny.world.renderer.info.render.triangles,
    };
  });
  // Same controller, fixed timestep and gates as the race; no teleportation or lap edits.
  report.race = await page.evaluate(() => {
    const g = window.__sunny.game;
    g.start();
    let ticks = 0;
    while (g.karts.some((k) => !k.finished) && ticks++ < 60 * 330)
      g.step(g.aiInput(g.karts[0]));
    return {
      state: g.state,
      time: g.time,
      racers: g.karts.map((k) => ({
        name: k.name,
        laps: k.laps,
        times: k.lapTimes,
        finished: k.finished,
        place: k.finishPlace,
        recoveries: k.recoveryCount,
        wallHits: k.wallHits,
      })),
    };
  });
  assert.equal(report.race.state, "FINISHED");
  assert.ok(report.race.racers.every((k) => k.finished && k.laps === 3));
  assert.ok(report.race.racers.every((k) => k.recoveries === 0));
  await page.waitForTimeout(200);
  assert.equal(await page.locator("#finished").isVisible(), true);
  await page.screenshot({ path: "artifacts/05-finish.png" });
  assert.equal(await page.locator("#countdown").textContent(), "");
  await page.click("#restart");
  await page.waitForTimeout(120);
  report.restart = await page.evaluate(() => ({
    state: window.__sunny.game.state,
    time: window.__sunny.game.time,
    karts: window.__sunny.game.karts.map((k) => ({
      laps: k.laps,
      nitro: k.nitro,
      charge: k.charge,
      checkpoint: k.nextCheckpoint,
    })),
  }));
  assert.equal(report.restart.state, "COUNTDOWN");
  assert.equal(report.restart.time, 0);
  assert.ok(
    report.restart.karts.every(
      (k) =>
        k.laps === 0 && k.nitro === 0 && k.charge === 0 && k.checkpoint === 1,
    ),
  );
  await page.click("#music");
  assert.equal(
    await page.locator("#music").getAttribute("aria-pressed"),
    "false",
  );
  await page.click("#music");
  await page.click("#sound");
  assert.equal(
    await page.locator("#sound").getAttribute("aria-pressed"),
    "false",
  );
  await page.click("#sound");
  await page.click("#quality");
  assert.equal(
    await page.locator("#quality").getAttribute("aria-pressed"),
    "false",
  );
  await page.click("#quality");
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.waitForTimeout(100);
  await page.screenshot({ path: "artifacts/06-small-desktop.png" });
  assert.deepEqual(errors, []);
  report.errors = errors;
  report.result = "PASS";
  console.log(JSON.stringify(report, null, 2));
  await writeFile(
    "artifacts/browser-report.json",
    JSON.stringify(report, null, 2),
  );
} finally {
  await browser.close();
}
