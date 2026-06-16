import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { textResult } from '@chrischall/mcp-utils';
import { sessionStore, normalizeOrigin } from '../sessions.js';
import { clearClientCache } from '../client.js';
import { captureSessionViaFetchproxy } from '../auth.js';
import type { ToolResult } from '../types.js';

/**
 * Capture (or refresh) a HoneyBook portal session from a vendor's
 * magic-link URL.
 *
 * v3 behavior: the tool no longer drives Puppeteer. Instead, the user is
 * expected to have already opened the magic link in their real Chrome
 * (with the fetchproxy 0.3.0 extension installed). This tool then asks
 * the extension to snapshot the page's `localStorage["jStorage"]` and the
 * `hb-api-fingerprint` header off the first api.honeybook.com request,
 * via `@fetchproxy/bootstrap`. The result is persisted to
 * `~/.honeybook-mcp/sessions.json` and used by every other tool.
 *
 * The `magic_link_url` arg is used only to derive the portalOrigin (the
 * cache key); we do NOT navigate to it. If the user hasn't actually
 * opened the link in Chrome yet, `captureSessionViaFetchproxy()` will
 * fail with an actionable error telling them to do so.
 */
export async function useMagicLink(args: { magic_link_url: string }): Promise<ToolResult> {
  const portalOrigin = normalizeOrigin(args.magic_link_url);
  const session = await captureSessionViaFetchproxy({ portalOrigin });
  // Clear client cache so getActiveClient picks up the fresh fingerprint.
  clearClientCache();
  return textResult({
    ok: true,
    portalOrigin: session.portalOrigin,
    companyName: session.companyName,
    capturedAt: new Date(session.capturedAt).toISOString(),
  });
}

export async function listActiveSessions(): Promise<ToolResult> {
  const sessions = sessionStore.list().map((s) => ({
    portalOrigin: s.portalOrigin,
    companyName: s.companyName,
    capturedAt: new Date(s.capturedAt).toISOString(),
  }));
  return textResult(sessions);
}

export function registerSessionTools(server: McpServer): void {
  server.registerTool(
    'use_magic_link',
    {
      description:
        "Capture a HoneyBook client-portal session via the fetchproxy 0.3.0 browser extension. Prerequisites: install the fetchproxy extension in Chrome/Safari, then open the vendor's magic-link URL in that browser so you're signed into their portal. This tool then snapshots the page's localStorage[\"jStorage\"] and the hb-api-fingerprint header into ~/.honeybook-mcp/sessions.json. IMPORTANT: the hb-api-fingerprint header is sniffed off the next live api.honeybook.com request, so a portal tab that has already finished loading (and gone idle) yields nothing and the capture times out. While this tool is running, refresh the portal tab (or open a workspace/file) so the page issues a fresh API request. All other tools use the most-recently-activated session by default. The magic_link_url arg is used only to derive the portalOrigin (cache key) — the tool does NOT open or navigate to it.",
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
        'List the HoneyBook portal sessions currently active in this MCP (captured via use_magic_link). No API call.',
      annotations: { readOnlyHint: true },
    },
    listActiveSessions
  );
}
