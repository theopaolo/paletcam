import { expect, test } from "bun:test";
import { resolveClientIp } from "./client-ip.js";

const headers = new Map([
  ["x-forwarded-for", "203.0.113.7, 10.0.0.4"],
  ["x-real-ip", "203.0.113.8"],
]);
const getHeader = (name) => headers.get(name) || "";

test("ignores spoofable forwarding headers by default and keys on the socket address", () => {
  expect(resolveClientIp(getHeader, { getSocketAddress: () => "198.51.100.9" })).toBe(
    "198.51.100.9",
  );
});

test("falls back to unknown without proxy trust when no socket address is available", () => {
  expect(resolveClientIp(getHeader)).toBe("unknown");
});

test("uses the rightmost forwarded value after explicit trust — the one the proxy appended", () => {
  expect(resolveClientIp(getHeader, { trustProxyHeaders: true })).toBe("10.0.0.4");
});

test("client-supplied forwarded prefixes cannot displace the proxy-appended address", () => {
  const spoofed = (name) => (name === "x-forwarded-for" ? "1.2.3.4, 5.6.7.8, 10.0.0.4" : "");
  expect(resolveClientIp(spoofed, { trustProxyHeaders: true })).toBe("10.0.0.4");
});

test("uses x-real-ip when trusted and no forwarded header is present", () => {
  const realIpOnly = (name) => (name === "x-real-ip" ? "203.0.113.8" : "");
  expect(resolveClientIp(realIpOnly, { trustProxyHeaders: true })).toBe("203.0.113.8");
});

test("falls back to the socket address when trusted but no forwarding headers arrive", () => {
  expect(
    resolveClientIp(() => "", { trustProxyHeaders: true, getSocketAddress: () => "198.51.100.9" }),
  ).toBe("198.51.100.9");
});
