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
