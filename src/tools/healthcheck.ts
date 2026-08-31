import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerCredentialHealthcheckTool } from '@chrischall/mcp-utils/healthcheck';
import { getActiveClient, NO_ACTIVE_SESSION_MESSAGE } from '../client.js';
import { sessionStore } from '../sessions.js';

/**
 * Register `honeybook_healthcheck` — checks for an active portal session, then
 * makes one authenticated call.
 *
 * HoneyBook's credential is a session captured from a magic link, so its
 * failures are: no session was ever activated, the session has lapsed and
 * HoneyBook rejects it, or HoneyBook is down. Those need different responses
 * and all three previously surfaced as the same opaque tool error.
 *
 * HoneyBook answers a revoked token with **404 + HBUnauthorizedError**, not
 * 401, so `classifyThrown` re-kinds that as a rejection. Without it a lapsed
 * session reads as "that resource does not exist", which sends people looking
 * for a missing workspace instead of re-activating their link.
 */
export function registerHealthcheckTools(server: McpServer): void {
  registerCredentialHealthcheckTool({
    server,
    prefix: 'honeybook',
    hostLabel: 'api.honeybook.com',
    probePath: '/api/v2/users/{id}/payment_methods',
    resolveCredential: async () => {
      const active = sessionStore.list();
      if (active.length === 0) {
        // The SAME constant getActiveClient throws, so the two cannot drift.
        throw new Error(NO_ACTIVE_SESSION_MESSAGE);
      }
      return {
        source: 'magic-link session',
        detail: { origins: active.map((s) => s.portalOrigin) },
      };
    },
    probeFn: async () => {
      const client = await getActiveClient();
      return client.request('GET', `/api/v2/users/${client.scope.userId}/payment_methods`);
    },
    classifyThrown: (err) => {
      const msg = err instanceof Error ? err.message : String(err);
      // "No active session" is NOT a rejection — there was nothing to reject.
      // It has to be excluded explicitly because the message names
      // `use_magic_link` as the FIX, and the regex below matches that literal
      // as a symptom. The two only stopped colliding by luck: this classifier
      // was never consulted for a `resolveCredential` throw until mcp-utils
      // 0.19.3, and that is the exact path this message arrives on. Without
      // this guard, a user who never connected is told their session expired.
      if (msg === NO_ACTIVE_SESSION_MESSAGE) return undefined;
      // Match the message the CLIENT throws, not HoneyBook's wire error.
      //
      // `HoneyBookClient.request()` already converts both 401 and
      // 404+`HBUnauthorizedError` into one "auth expired … use_magic_link"
      // error (`authExpiredError`), so nothing carrying the literal
      // `HBUnauthorizedError` ever reaches here. An earlier version matched
      // that literal and therefore never fired in production — the mock in its
      // test bypassed the very transformation that made it dead.
      //
      // `HBUnauthorizedError` is kept as a second alternative only for a raw
      // error that has not been through `request()`.
      if (/auth expired|use_magic_link|HBUnauthorizedError/.test(msg)) {
        return {
          kind: 'credential_rejected',
          hint: 'HoneyBook rejected the session — it has expired. Re-run `use_magic_link` with a fresh link from a vendor email. (HoneyBook signals this with 404 + HBUnauthorizedError rather than 401; the client normalises both.)',
        };
      }
      return undefined;
    },
  });
}
