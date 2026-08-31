import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerCredentialHealthcheckTool } from '@chrischall/mcp-utils/healthcheck';
import { getActiveClient, isNoPortalSessionError, noPortalSessionError } from '../client.js';
import { sessionStore } from '../sessions.js';
import { flowStore } from '../flows.js';

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
        // The SAME constructor getActiveClient throws, so the two cannot drift
        // — including on the flow-credential branch, where the message has to
        // say which kind IS present.
        throw noPortalSessionError();
      }
      const flowCount = flowStore.list().length;
      return {
        // The label names the KIND, so a reader can tell this apart from the
        // flow (weak-auth) credential rather than seeing one generic "session".
        source: 'magic-link portal session',
        detail: {
          origins: active.map((s) => s.portalOrigin),
          // Count only. A healthcheck result is what people paste into chats,
          // and a flow id is half of a flow credential.
          ...(flowCount > 0 ? { flowCredentials: flowCount } : {}),
        },
      };
    },
    probeFn: async () => {
      const client = await getActiveClient();
      return client.request('GET', `/api/v2/users/${client.scope.userId}/payment_methods`);
    },
    classifyThrown: (err) => {
      const msg = err instanceof Error ? err.message : String(err);
      // "No portal session" is NOT a rejection — there was nothing to reject.
      // It has to be excluded explicitly because the message names
      // `use_magic_link` as the FIX, and the regex below matches that literal
      // as a symptom. The two only stopped colliding by luck: this classifier
      // was never consulted for a `resolveCredential` throw until mcp-utils
      // 0.19.3, and that is the exact path this message arrives on. Without
      // this guard, a user who never connected is told their session expired.
      //
      // Keyed off the error TYPE, never its prose. An equality check against
      // one message was already fragile; it would have silently stopped
      // covering the flow-credential variant of the same condition, which is a
      // DIFFERENT message that also names `use_magic_link`.
      if (isNoPortalSessionError(err)) {
        // Same arm and same hint as the unclassified path — this branch exists
        // only to carry the count, so the report distinguishes "nothing
        // captured" from "the wrong credential kind is captured".
        return err.flowCredentialCount > 0
          ? { kind: 'no_credential', detail: { flowCredentials: err.flowCredentialCount } }
          : undefined;
      }
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
