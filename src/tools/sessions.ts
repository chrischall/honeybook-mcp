import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { textResult } from '@chrischall/mcp-utils';
import { sessionStore, normalizeOrigin } from '../sessions.js';
import { clearClientCache } from '../client.js';
import { captureSessionViaFetchproxy } from '../auth.js';
import { flowStore, isFlowLinkUrl } from '../flows.js';
import type { ToolResult } from '../types.js';

/**
 * Capture (or refresh) a HoneyBook portal session from a vendor's
 * magic-link URL.
 *
 * v3 behavior: the tool no longer drives Puppeteer. Instead, the user is
 * expected to have already opened the magic link in their real Chrome
 * (with the fetchproxy 0.3.0 extension installed). This tool then asks
 * the extension to snapshot the auth fields out of the page's
 * `localStorage["HONEYBOOK_REACT_CURR_USER"]` via `@fetchproxy/bootstrap`.
 * The result is persisted to `~/.honeybook-mcp/sessions.json` and used by
 * every other tool.
 *
 * The `magic_link_url` arg is used only to derive the portalOrigin (the
 * cache key); we do NOT navigate to it. If the user hasn't actually
 * opened the link in Chrome yet, `captureSessionViaFetchproxy()` will
 * fail with an actionable error telling them to do so.
 */
export async function useMagicLink(args: { magic_link_url: string }): Promise<ToolResult> {
  // A questionnaire link writes a per-flow weak-auth record and never touches
  // HONEYBOOK_REACT_CURR_USER, so this capture would time out waiting for a key
  // the page never sets — which reads as "you aren't signed in" rather than
  // "wrong tool". Refused here, from the SAME predicate `use_flow_link` uses.
  if (isFlowLinkUrl(args.magic_link_url)) {
    throw new Error(
      'HoneyBook auth: that is a questionnaire (flow) link, not a client-portal link. It writes ' +
        'a per-flow weak-auth credential rather than a portal session — use the `use_flow_link` ' +
        'tool for it.'
    );
  }
  const portalOrigin = normalizeOrigin(args.magic_link_url);
  const session = await captureSessionViaFetchproxy({ portalOrigin });
  // Clear client cache so getActiveClient rebuilds against the fresh token.
  clearClientCache();
  return textResult({
    ok: true,
    portalOrigin: session.portalOrigin,
    companyName: session.companyName,
    capturedAt: new Date(session.capturedAt).toISOString(),
  });
}

/**
 * List both credential kinds, kept apart in the response.
 *
 * They are NOT interchangeable — a portal session reads workspaces, files,
 * invoices and payment methods; a flow credential reads one questionnaire and
 * nothing else — so a flat list would invite exactly the substitution the
 * refusals in `client.ts` and `flow-client.ts` exist to prevent. Each entry
 * carries its own `kind` so a reader that only looks at rows still sees it.
 * Neither the portal auth token nor the flow hash is ever returned.
 */
export async function listActiveSessions(): Promise<ToolResult> {
  const portalSessions = sessionStore.list().map((s) => ({
    kind: 'portal-session' as const,
    portalOrigin: s.portalOrigin,
    companyName: s.companyName,
    capturedAt: new Date(s.capturedAt).toISOString(),
  }));
  const flowCredentials = flowStore.list().map((c) => ({
    kind: 'flow-credential' as const,
    flowId: c.flowId,
    portalOrigin: c.portalOrigin,
    companyName: c.companyName,
    email: c.email ?? null,
    // Same reason as the capture result: a field captured and never surfaced is
    // a claim the code does not keep. `null` when the blob carried none.
    isRealChargeableUser: c.isRealChargeableUser ?? null,
    capturedAt: new Date(c.capturedAt).toISOString(),
  }));
  return textResult({ portalSessions, flowCredentials });
}

export function registerSessionTools(server: McpServer): void {
  server.registerTool(
    'use_magic_link',
    {
      description:
        "Capture a HoneyBook client-portal session via the fetchproxy 0.3.0 browser extension. Prerequisites: install the fetchproxy extension in Chrome/Safari, then open the vendor's magic-link URL in that browser so you're signed into their portal and leave that tab open. This tool then snapshots the auth fields out of the page's localStorage[\"HONEYBOOK_REACT_CURR_USER\"] into ~/.honeybook-mcp/sessions.json. The tab only needs to be open and signed in — nothing is sniffed off a live request, so it does not matter whether the page is idle. All other tools use the most-recently-activated session by default. The magic_link_url arg is used only to derive the portalOrigin (cache key) — the tool does NOT open or navigate to it. For a QUESTIONNAIRE link (https://<vendor>.hbportal.co/flow/<flowId>?hash=…) use `use_flow_link` instead — that link writes a different, flow-scoped credential and this tool refuses it.",
      inputSchema: {
        magic_link_url: z
          .string()
          .url()
          .describe(
            "Full magic-link URL from the vendor's HoneyBook email, e.g. https://<vendor>.hbportal.co/app/workspace_file/<id>/...  Used only to derive the portal origin; you must already have this URL open in a Chrome tab with the fetchproxy extension installed."
          ),
      },
      annotations: { readOnlyHint: false },
    },
    useMagicLink
  );

  server.registerTool(
    'list_active_sessions',
    {
      description:
        'List the HoneyBook credentials currently active in this MCP, split by kind: `portalSessions` (captured via use_magic_link — read workspaces, files, invoices, payment methods) and `flowCredentials` (captured via use_flow_link — weak auth scoped to ONE questionnaire). The two are not interchangeable. No API call.',
      annotations: { readOnlyHint: true },
    },
    listActiveSessions
  );
}
