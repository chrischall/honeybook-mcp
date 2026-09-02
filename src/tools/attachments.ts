import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { textResult, schemaOrigin } from '@chrischall/mcp-utils';
import { getActiveClient } from '../client.js';
import type { ToolResult } from '../types.js';

type Raw = Record<string, unknown>;

/**
 * The Files tab's "attachments" bucket: loose images, files and bookmarks
 * shared in the workspace. Contracts, invoices and proposals are NOT here —
 * those are workspace files (see list_workspace_files).
 */
export async function listAttachments(args: { workspace_id: string; origin?: string }): Promise<ToolResult> {
  const client = await getActiveClient(args.origin);
  const res = await client.request<{ attachments?: { images?: Raw[]; files?: Raw[]; bookmarks?: Raw[] } } | null>(
    'GET',
    `/api/v2/workspaces/${args.workspace_id}/attachments`
  );
  const a = res?.attachments ?? {};
  return textResult({
    workspace_id: args.workspace_id,
    images: a.images ?? [],
    files: a.files ?? [],
    bookmarks: a.bookmarks ?? [],
  });
}

export function registerAttachmentTools(server: McpServer): void {
  server.registerTool(
    'list_attachments',
    {
      description:
        'Loose images, files and bookmarks shared in a workspace — the portal\'s Files tab, minus the ' +
        'contracts/invoices/proposals that list_workspace_files covers.',
      inputSchema: {
        workspace_id: z.string().describe('The workspace _id (from list_projects).'),
        origin: schemaOrigin.describe(
          'Portal origin (e.g. https://<vendor>.hbportal.co). Optional when only one session is active.'
        ),
      },
      annotations: { readOnlyHint: true },
    },
    listAttachments
  );
}
