/**
 * Proxy headers are attacker-controlled unless direct access is restricted to a
 * trusted reverse proxy and TRUST_PROXY_HEADERS is explicitly enabled. Proxies
 * such as Traefik append the observed client address to any inbound
 * x-forwarded-for value, so only the rightmost entry — the one written by the
 * trusted proxy itself — is authoritative; everything to its left is client
 * input. Without proxy trust, the socket address is the only honest source.
 */
export function resolveClientIp(getHeader, { trustProxyHeaders = false, getSocketAddress } = {}) {
  const socketAddress = () => getSocketAddress?.()?.trim() || "unknown";

  if (!trustProxyHeaders) {
    return socketAddress();
  }

  const forwarded = getHeader("x-forwarded-for");
  if (forwarded) {
    const entries = forwarded.split(",");
    const rightmost = entries[entries.length - 1].trim();
    if (rightmost) return rightmost;
  }

  return getHeader("x-real-ip")?.trim() || socketAddress();
}

/**
 * One IPv6 customer holds a whole /64, so a limiter keyed on the full address
 * hands out a fresh bucket per address. The key is the /64 prefix. IPv4 and
 * IPv4-mapped addresses key on the IPv4 address.
 * @param {string} ip
 */
export function toRateLimitKey(ip) {
  const address = String(ip).split("%")[0].toLowerCase();
  if (!address.includes(":")) return address;

  const mappedIpv4 = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(address);
  if (mappedIpv4) return mappedIpv4[1];

  const [head, tail] = address.split("::");
  const headGroups = head ? head.split(":") : [];
  const tailGroups = tail ? tail.split(":") : [];
  const zeroGroups =
    tail === undefined
      ? []
      : Array(Math.max(0, 8 - headGroups.length - tailGroups.length)).fill("0");
  const prefix = [...headGroups, ...zeroGroups, ...tailGroups]
    .slice(0, 4)
    .map((group) => group.replace(/^0+(?=.)/, ""));
  return `${prefix.join(":")}::/64`;
}
