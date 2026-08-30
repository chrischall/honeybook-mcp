import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerCredentialHealthcheckTool } from '@chrischall/mcp-utils/healthcheck';
import { getActiveClient } from '../client.js';
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
        // Same wording getActiveClient throws, so the fix is identical
        // wherever the user meets it.
        throw new Error(
          'No active HoneyBook session. Use the `use_magic_link` tool with a magic-link URL from a vendor\'s email to activate one.',
        );
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
      // 404 + HBUnauthorizedError is HoneyBook's expiry signal. Gated on the
      // body as well as the status so a genuinely missing resource stays a
      // plain 404.
      if (/HBUnauthorizedError/.test(msg)) {
        return {
          kind: 'credential_rejected',
          hint: 'HoneyBook rejected the session (it answers a revoked token with 404 + HBUnauthorizedError, not 401). Re-run `use_magic_link` with a fresh link from a vendor email.',
        };
      }
      return undefined;
    },
  });
}
