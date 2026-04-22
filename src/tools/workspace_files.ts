import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getActiveClient } from '../client.js';
import type { HBListEnvelope, ToolResult } from '../types.js';
import { FILE_TYPES } from '../types.js';

/**
 * Vendor-side sub-fields on `company` that a CLIENT never needs but that
 * balloon the response (observed: `vendor_emails` alone was ~1.3 MB on a
 * single real proposal). Stripped by default; pass include_raw=true to keep.
 */
const HEAVY_COMPANY_FIELDS = [
  'vendor_emails',
  'workflow_automation_infos',
  'brochure_templates',
  'questionnaires',
  'lead_sources',
  'proposals',
  'agreements',
  'invoices',
  'vendor_packages',
  'contact_forms',
  'stripe_persons',
  'user_pipeline_stages',
  'project_types',
  'company_assets',
] as const;

export function pruneWorkspaceFile(file: Record<string, unknown>): Record<string, unknown> {
  if (!file || typeof file !== 'object') return file;
  const company = file.company as Record<string, unknown> | undefined;
  if (!company) return file;
  const pruned = { ...file, company: { ...company } };
  for (const key of HEAVY_COMPANY_FIELDS) {
    delete (pruned.company as Record<string, unknown>)[key];
  }
  return pruned;
}

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
  include_raw?: boolean;
}): Promise<ToolResult> {
  const client = await getActiveClient(args.origin);
  const res = await client.request<Record<string, unknown>>(
    'GET',
    `/api/v2/workspace_files/${args.file_id}`
  );
  const body = args.include_raw ? res : pruneWorkspaceFile(res);
  return { content: [{ type: 'text', text: JSON.stringify(body, null, 2) }] };
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
      description:
        'Get full detail for one workspace file by its _id. The vendor-side admin blob inside `company` (email templates, brochure templates, etc., which can be >1 MB) is stripped by default; pass include_raw:true to keep it.',
      inputSchema: {
        file_id: z.string().describe('The file _id from list_workspace_files.'),
        origin: z
          .string()
          .optional()
          .describe(
            'Portal origin (e.g. https://<vendor>.hbportal.co). Optional when only one session is active.'
          ),
        include_raw: z
          .boolean()
          .optional()
          .describe(
            'If true, return the full unpruned response. Default false — strips heavy vendor-side fields under `company`.'
          ),
      },
      annotations: { readOnlyHint: true },
    },
    getWorkspaceFile
  );
}
