import { chromium } from "@playwright/test";
import assert from "node:assert/strict";

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
try {
  for (const [up, left, down, right] of [["ArrowUp", "ArrowLeft", "ArrowDown", "ArrowRight"], ["w", "a", "s", "d"]]) {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(process.env.GAME_URL || "http://127.0.0.1:5174/");
    // Hold through Start without relying on OS key-repeat events.
    await page.keyboard.down(up);
    await page.click("#start");
    await page.waitForFunction(() => window.__sunny.game.state === "RACING");
    await page.waitForTimeout(1000);
    const speed = await page.evaluate(() => window.__sunny.game.karts[0].speed);
    assert.ok(speed > 8, `Held ${up} must accelerate after Start; got ${speed}`);

    // Increasing yaw turns left, so left steers positive and right negative.
    for (const [key, sign, way] of [[left, 1, "left"], [right, -1, "right"]]) {
      const yaw = await page.evaluate(() => window.__sunny.game.karts[0].yaw);
      await page.keyboard.down(key);
      await page.waitForTimeout(200);
      const nextYaw = await page.evaluate(() => window.__sunny.game.karts[0].yaw);
      const delta = nextYaw - yaw;
      assert.ok(delta * sign > 0.05,
        `${key} must turn the kart ${way} (yaw delta ${delta.toFixed(3)})`);
      await page.keyboard.up(key);
    }
    await page.keyboard.up(up);
    const beforeBrake = await page.evaluate(() => window.__sunny.game.karts[0].speed);
    await page.keyboard.down(down);
    await page.waitForTimeout(300);
    assert.ok(await page.evaluate(() => window.__sunny.game.karts[0].speed) < beforeBrake - 3);
    await page.keyboard.up(down);

    await page.keyboard.down(up);
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => window.__sunny.game.state === "PAUSED");
    const pausedSpeed = await page.evaluate(() => window.__sunny.game.karts[0].speed);
    await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => window.__sunny.game.karts[0].speed), pausedSpeed);
    await page.click("#resume");
    await page.waitForTimeout(500);
    assert.ok(await page.evaluate(() => window.__sunny.game.karts[0].speed) > pausedSpeed + 3);
    await page.keyboard.up(up);
    assert.deepEqual(errors, []);
    console.log(`PASS: ${up}/${left}/${down}/${right} drive, stay held through Start/resume, and pause freezes physics.`);
    await page.close();
  }

  // A blocked autoplay policy leaves AudioContext.resume() pending forever; the
  // race must still start and stay drivable.
  {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
      AudioContext.prototype.resume = () => new Promise(() => {});
    });
    await page.goto(process.env.GAME_URL || "http://127.0.0.1:5174/");
    await page.click("#start");
    await page.waitForFunction(() => window.__sunny.game.state === "RACING", null, { timeout: 10000 });
    await page.keyboard.down("ArrowUp");
    await page.waitForTimeout(1200);
    const speed = await page.evaluate(() => window.__sunny.game.karts[0].speed);
    await page.keyboard.up("ArrowUp");
    assert.ok(speed > 8, `Audio must not gate the race; got ${speed}`);
    assert.deepEqual(errors, []);
    console.log("PASS: a never-resolving AudioContext.resume() still starts and drives the race.");
    await page.close();
  }
} finally {
  await browser.close();
}
