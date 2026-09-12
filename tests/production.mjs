import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }),
  errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
try {
  await page.goto(process.env.GAME_URL || "http://127.0.0.1:4174/", {
    waitUntil: "networkidle",
  });
  assert.equal(await page.evaluate(() => typeof window.__sunny), "undefined");
  await page.click("#start");
  await page.waitForTimeout(3300);
  await page.keyboard.down("KeyW");
  await page.waitForTimeout(2000);
  await page.keyboard.up("KeyW");
  const speed = Number(await page.locator("#speed").textContent());
  assert.ok(speed > 50);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(100);
  assert.equal(await page.locator("#paused").isVisible(), true);
  await page.click("#resume");
  await page.waitForTimeout(100);
  assert.equal(await page.locator("#paused").isVisible(), false);
  await mkdir("artifacts", { recursive: true });
  await page.screenshot({ path: "artifacts/07-production.png" });
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      result: "PASS",
      productionSpeedKmh: speed,
      debugHookAbsent: true,
      errors,
    }),
  );
} finally {
  await browser.close();
}
