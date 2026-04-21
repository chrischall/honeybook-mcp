import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { sessionStore } from '../sessions.js';
import { clearClientCache } from '../client.js';
import type { ToolResult } from '../types.js';

export async function useMagicLink(args: { magic_link_url: string }): Promise<ToolResult> {
  const session = await sessionStore.activate(args.magic_link_url);
  // Clear client cache so getActiveClient picks up the fresh fingerprint
  clearClientCache();
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            ok: true,
            portalOrigin: session.portalOrigin,
            companyName: session.companyName,
            capturedAt: new Date(session.capturedAt).toISOString(),
          },
          null,
          2
        ),
      },
    ],
  };
}

export async function listActiveSessions(): Promise<ToolResult> {
  const sessions = sessionStore.list().map((s) => ({
    portalOrigin: s.portalOrigin,
    companyName: s.companyName,
    capturedAt: new Date(s.capturedAt).toISOString(),
  }));
  return { content: [{ type: 'text', text: JSON.stringify(sessions, null, 2) }] };
}

export function registerSessionTools(server: McpServer): void {
  server.registerTool(
    'use_magic_link',
    {
      description:
        "Capture a HoneyBook client-portal session from a vendor's magic-link URL. Launches a headless browser, follows the link, extracts the auth state into memory (and ~/.honeybook-mcp/sessions.json). All other tools use the most-recently-activated session by default.",
      inputSchema: {
        magic_link_url: z
          .string()
          .url()
          .describe(
            "Full magic-link URL from the vendor's HoneyBook email, e.g. https://<vendor>.hbportal.co/app/workspace_file/<id>/..."
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
