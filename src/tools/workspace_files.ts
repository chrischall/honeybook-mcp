import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getActiveClient } from '../client.js';
import type { HBListEnvelope, ToolResult } from '../types.js';
import { FILE_TYPES } from '../types.js';

export async function listWorkspaceFiles(args: {
  origin?: string;
  file_type?: string;
}): Promise<ToolResult> {
  const client = await getActiveClient(args.origin);
  const res = await client.request<HBListEnvelope<Record<string, unknown>>>(
    'GET',
    `/api/v2/users/${client.scope.userId}/workspace_files`
  );
  const filtered = args.file_type
    ? res.data.filter((f) => f.file_type === args.file_type)
    : res.data;
  const prefix =
    res.last_page === false
      ? '// NOTE: more results exist on later pages; pagination is not yet wired up.\n'
      : '';
  return { content: [{ type: 'text', text: prefix + JSON.stringify(filtered, null, 2) }] };
}

export async function getWorkspaceFile(args: {
  file_id: string;
  origin?: string;
}): Promise<ToolResult> {
  const client = await getActiveClient(args.origin);
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
        origin: z
          .string()
          .optional()
          .describe(
            'Portal origin (e.g. https://<vendor>.hbportal.co) to target. Optional — defaults to the most recently activated session.'
          ),
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
        origin: z
          .string()
          .optional()
          .describe(
            'Portal origin (e.g. https://<vendor>.hbportal.co). Optional when only one session is active.'
          ),
      },
      annotations: { readOnlyHint: true },
    },
    getWorkspaceFile
  );
}
