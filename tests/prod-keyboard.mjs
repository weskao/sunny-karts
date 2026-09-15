// End-to-end keyboard control check against the PRODUCTION bundle.
// Uses only what a player can see (HUD speed + minimap dot) because the
// window.__sunny inspection hook is stripped from production builds.
// BLOCK_AUDIO=1 mimics an autoplay policy whose resume() never settles.
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";

const URL = process.env.GAME_URL || "http://127.0.0.1:5180/";
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  args: ["--enable-webgl", "--ignore-gpu-blocklist"],
});
const errors = [];

// Centroid of the player's yellow (#ffc641) minimap dot, in canvas pixels.
const dot = (page) => page.evaluate(() => {
  const c = document.getElementById("map");
  const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
  let sx = 0, sy = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (Math.abs(d[i] - 255) <= 6 && Math.abs(d[i + 1] - 198) <= 6 &&
        Math.abs(d[i + 2] - 65) <= 6 && d[i + 3] > 200) {
      const p = i / 4; sx += p % c.width; sy += Math.floor(p / c.width); n++;
    }
  }
  return n ? { x: sx / n, y: sy / n } : null;
});
const speed = async (page) => Number(await page.textContent("#speed"));

// A fresh page sitting on the grid with the countdown finished.
async function race() {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  if (process.env.BLOCK_AUDIO === "1")
    await page.addInitScript(() => {
      AudioContext.prototype.resume = () => new Promise(() => {});
    });
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.click("#start");
  await page.waitForFunction(
    () => document.getElementById("time").textContent !== "00:00.000",
    null, { timeout: 15000 });
  return page;
}

// Hold throttle (+ optional steer) for 1.4s from an identical standing start.
async function run(up, steer) {
  const page = await race();
  const from = await dot(page);
  await page.keyboard.down(up);
  if (steer) await page.keyboard.down(steer);
  await page.waitForTimeout(1400);
  if (steer) await page.keyboard.up(steer);
  await page.keyboard.up(up);
  const to = await dot(page);
  await page.close();
  assert.ok(from && to, "minimap must show the player dot");
  return { dx: to.x - from.x, dy: to.y - from.y };
}

try {
  for (const [up, left, down, right, label] of [
    ["ArrowUp", "ArrowLeft", "ArrowDown", "ArrowRight", "Arrow keys"],
    ["w", "a", "s", "d", "WASD"],
  ]) {
    // --- throttle + brake, on one page ---
    const page = await race();
    assert.equal(await speed(page), 0, "kart must be stationary before input");
    await page.keyboard.down(up);
    await page.waitForTimeout(1500);
    const fast = await speed(page);
    await page.keyboard.up(up);
    assert.ok(fast > 30, `${up} must accelerate; got ${fast} km/h`);
    await page.keyboard.down(down);
    await page.waitForTimeout(600);
    const slowed = await speed(page);
    await page.keyboard.up(down);
    await page.close();
    assert.ok(slowed < fast - 10, `${down} must brake; ${fast} -> ${slowed} km/h`);

    // --- steering: each direction from its own identical standing start, so
    // wall contacts and track curvature cannot contaminate the comparison ---
    const straight = await run(up, null);
    const l = await run(up, left);
    const r = await run(up, right);
    // The minimap draws world +X rightwards and world +Z downwards, so this
    // cross product is the deflection along the kart's OWN right-hand side:
    // positive means it went right, negative means it went left.
    const side = (v) => straight.dx * v.dy - straight.dy * v.dx;
    const sl = side(l), sr = side(r);
    assert.ok(sl < -1,
      `${left} must steer LEFT, but deflection along the kart's right was ${sl.toFixed(2)}`);
    assert.ok(sr > 1,
      `${right} must steer RIGHT, but deflection along the kart's right was ${sr.toFixed(2)}`);

    console.log(`PASS: ${label} — throttle ${fast} km/h, brake -> ${slowed} km/h, ${left} deflects ${sl.toFixed(1)} (left), ${right} deflects ${sr.toFixed(1)} (right).`);
  }
  assert.deepEqual(errors, [], `page errors: ${errors.join(" | ")}`);
  console.log("PASS: no console or page errors.");
} finally {
  await browser.close();
}
