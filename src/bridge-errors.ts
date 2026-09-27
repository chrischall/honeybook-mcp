// fetchproxy 3.3+ distinguishes "this browser cannot serve a capability"
// (e.g. Safari lacking a WebExtension API) from a scope/pairing problem. That
// is the browser's limitation — not the MCP's fault, and not fixed by
// re-approving or retrying — so callers surface the library's own message
// verbatim instead of appending their generic "open the link, then retry".
//
// Matched on the class NAME rather than `instanceof` so a duplicated
// @fetchproxy/server copy in the dependency tree cannot defeat the check.
export function isBrowserCapabilityGap(e: unknown): boolean {
  const err = e as { name?: string; unavailableCapabilities?: unknown } | null;
  if (err?.name === 'FetchproxyCapabilityUnavailableError') return true;
  return (
    err?.name === 'FetchproxyHelloRejectedError' &&
    Array.isArray(err.unavailableCapabilities) &&
    err.unavailableCapabilities.length > 0
  );
}
