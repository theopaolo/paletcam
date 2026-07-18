import { expect, test } from "@playwright/test";
import { installRecoveringCamera } from "./support/browser-fixtures.js";

test("recovers after denial and applies the platform background policy", async ({
  page,
  browserName,
}) => {
  await installRecoveringCamera(page);
  await page.goto("/");

  await expect.poll(() => page.evaluate(() => window.__cameraTestState.attempts)).toBe(1);
  const captureButton = page.locator(".btn-capture");
  await expect(captureButton).toBeEnabled();

  await captureButton.click();
  await expect.poll(() => page.evaluate(() => window.__cameraTestState.attempts)).toBe(2);
  await expect
    .poll(() => page.evaluate(() => window.__cameraTestState.playCount))
    .toBeGreaterThan(0);

  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide")));

  if (browserName === "webkit") {
    await expect.poll(() => page.evaluate(() => window.__cameraTestState.stopCount)).toBe(1);
  } else {
    expect(await page.evaluate(() => window.__cameraTestState.stopCount)).toBe(0);
  }

  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow")));

  if (browserName === "webkit") {
    await expect.poll(() => page.evaluate(() => window.__cameraTestState.attempts)).toBe(3);
  } else {
    await page.waitForTimeout(700);
    const finalState = await page.evaluate(() => ({ ...window.__cameraTestState }));
    expect([2, 3]).toContain(finalState.attempts);
    expect(finalState.stopCount).toBe(finalState.attempts === 3 ? 1 : 0);
  }
});
