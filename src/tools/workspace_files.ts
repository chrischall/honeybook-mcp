import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getClientFor } from '../client.js';
import type { HBListEnvelope, ToolResult } from '../types.js';
import { FILE_TYPES } from '../types.js';

export async function listWorkspaceFiles(args: {
  vendor?: string;
  file_type?: string;
}): Promise<ToolResult> {
  const client = await getClientFor(args.vendor);
  const res = await client.request<HBListEnvelope<Record<string, unknown>>>(
    'GET',
    `/api/v2/users/${client.scope.userId}/workspace_files`
  );
  const filtered = args.file_type
    ? res.data.filter((f) => f.file_type === args.file_type)
    : res.data;
  const prefix = res.last_page === false ? '// NOTE: more results exist on later pages; pagination is not yet wired up.\n' : '';
  return { content: [{ type: 'text', text: prefix + JSON.stringify(filtered, null, 2) }] };
}

export async function getWorkspaceFile(args: {
  file_id: string;
  vendor?: string;
}): Promise<ToolResult> {
  const client = await getClientFor(args.vendor);
  const res = await client.request<Record<string, unknown>>(
    'GET',
    `/api/v2/workspace_files/${args.file_id}`
  );
  return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
}

export function registerWorkspaceFileTools(server: McpServer): void {
  server.registerTool(
    'list_workspace_files',
    {
      description:
        'List all files a vendor has shared with you (contracts, invoices, brochures, proposals). Optionally filter by file_type.',
      inputSchema: {
        vendor: z
          .string()
          .optional()
          .describe('Vendor slug from list_vendors. Required when multiple vendors are configured.'),
        file_type: z
          .enum(FILE_TYPES)
          .optional()
          .describe('Filter to one file type. Omit to return all.'),
      },
      annotations: { readOnlyHint: true },
    },
    listWorkspaceFiles
  );
  server.registerTool(
    'get_workspace_file',
    {
      description: 'Get full detail for one workspace file by its _id.',
      inputSchema: {
        file_id: z.string().describe('The file _id from list_workspace_files.'),
        vendor: z.string().optional().describe('Vendor slug. Optional when only one is configured.'),
      },
      annotations: { readOnlyHint: true },
    },
    getWorkspaceFile
  );
}
