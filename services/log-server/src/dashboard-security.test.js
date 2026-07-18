import { expect, test } from "bun:test";
import { createDashboardSecurityHeaders } from "./dashboard-security.js";

test("dashboard security headers block external scripts, framing, and caching", () => {
  const headers = createDashboardSecurityHeaders({ production: true });
  expect(headers["Content-Security-Policy"]).toContain("default-src 'none'");
  expect(headers["Content-Security-Policy"]).not.toContain("https:");
  expect(headers["Cache-Control"]).toContain("no-store");
  expect(headers["X-Frame-Options"]).toBe("DENY");
  expect(headers["Strict-Transport-Security"]).toContain("max-age=");
});

test("dashboard has no runtime third-party script dependency", async () => {
  const html = await Bun.file(new URL("./dashboard.html", import.meta.url)).text();
  expect(html).not.toMatch(/<script[^>]+src=/i);
  expect(html).not.toContain("cdn.jsdelivr.net");
});
