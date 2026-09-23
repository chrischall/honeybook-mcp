import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { minifiedResult, schemaOrigin } from '@chrischall/mcp-utils';
import { apiPath, getActiveClient } from '../client.js';
import type { ToolResult } from '../types.js';

export async function getWorkspace(args: {
  workspace_id: string;
  origin?: string;
}): Promise<ToolResult> {
  const client = await getActiveClient(args.origin);
  const res = await client.request<Record<string, unknown>>(
    'GET',
    apiPath`/api/v2/workspaces/${args.workspace_id}`
  );
  return minifiedResult(res);
}

export function registerWorkspaceTools(server: McpServer): void {
  server.registerTool(
    'get_workspace',
    {
      description:
        'Get full detail for a workspace (vendor project). Includes status flags like has_sent_files, has_signed_files, has_paid_payments.',
      inputSchema: z.object({
        workspace_id: z
          .string()
          .describe('The workspace _id (found on any workspace_file under .workspace._id).'),
        origin: schemaOrigin.describe(
          'Portal origin (e.g. https://<vendor>.hbportal.co). Optional when only one session is active.'
        ),
      }),
      annotations: { readOnlyHint: true },
    },
    getWorkspace
  );
}
