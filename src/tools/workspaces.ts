import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getClientFor } from '../client.js';
import type { ToolResult } from '../types.js';

export async function getWorkspace(args: {
  workspace_id: string;
  vendor?: string;
}): Promise<ToolResult> {
  const client = await getClientFor(args.vendor);
  const res = await client.request<Record<string, unknown>>(
    'GET',
    `/api/v2/workspaces/${args.workspace_id}`
  );
  return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
}

export function registerWorkspaceTools(server: McpServer): void {
  server.registerTool(
    'get_workspace',
    {
      description:
        'Get full detail for a workspace (vendor project). Includes status flags like has_sent_files, has_signed_files, has_paid_payments.',
      inputSchema: {
        workspace_id: z.string().describe('The workspace _id (found on any workspace_file under .workspace._id).'),
        vendor: z.string().optional().describe('Vendor slug.'),
      },
      annotations: { readOnlyHint: true },
    },
    getWorkspace
  );
}
