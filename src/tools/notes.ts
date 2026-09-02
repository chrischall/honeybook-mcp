import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { textResult, schemaOrigin } from '@chrischall/mcp-utils';
import { getActiveClient } from '../client.js';
import type { ToolResult } from '../types.js';

export async function listNotes(args: { workspace_id: string; origin?: string }): Promise<ToolResult> {
  const client = await getActiveClient(args.origin);
  const notes = await client.request<Array<Record<string, unknown>> | null>(
    'GET',
    `/api/v2/notes/workspace/${args.workspace_id}`
  );
  return textResult({ workspace_id: args.workspace_id, notes: notes ?? [] });
}

export function registerNoteTools(server: McpServer): void {
  server.registerTool(
    'list_notes',
    {
      description:
        'Notes the vendor has shared with you in a workspace (meeting notes, AI recaps) — the portal\'s Notes tab.',
      inputSchema: {
        workspace_id: z.string().describe('The workspace _id (from list_projects).'),
        origin: schemaOrigin.describe(
          'Portal origin (e.g. https://<vendor>.hbportal.co). Optional when only one session is active.'
        ),
      },
      annotations: { readOnlyHint: true },
    },
    listNotes
  );
}
