import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { textResult, schemaOrigin } from '@chrischall/mcp-utils';
import { getActiveClient } from '../client.js';
import type { ToolResult } from '../types.js';

type Raw = Record<string, unknown>;

/** Today in the caller's LOCAL timezone — the UTC date is a day off for an evening west of Greenwich. */
export function today(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * The API wants `curr_date` as MM/DD/YYYY (what the portal sends; the ISO
 * form answers `400 HBIllegalParamError`, verified live 2026-09-02). Callers
 * pass ISO because that is the form every other date in this MCP uses.
 */
export function toApiDate(isoDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) throw new Error(`curr_date must be YYYY-MM-DD, got "${isoDate}"`);
  return `${m[2]}/${m[3]}/${m[1]}`;
}

/**
 * The portal's Tasks tab makes three calls; all three are returned so the
 * result matches the page. `curr_date` is what the API buckets "today" /
 * "this week" / "overdue" against, so it is sent explicitly rather than left
 * to the server's clock.
 */
export async function listTasks(args: {
  workspace_id: string;
  page?: number;
  per_page?: number;
  curr_date?: string;
  origin?: string;
}): Promise<ToolResult> {
  const client = await getActiveClient(args.origin);
  const page = args.page ?? 1;
  const perPage = args.per_page ?? 50;
  const currDate = args.curr_date ?? today();
  const apiDate = encodeURIComponent(toApiDate(currDate));
  const base = `/api/v2/tasks/workspaces/${args.workspace_id}`;
  const tasks = await client.request<Raw[] | null>(
    'GET',
    `${base}?page=${page}&perPage=${perPage}&sort_by=due_date&sort_desc=false&curr_date=${apiDate}`
  );
  const counts = await client.request<Raw | null>('GET', `${base}/counts?curr_date=${apiDate}`);
  const groups = await client.request<Raw[] | null>(
    'GET',
    `/api/v2/workspaces/${args.workspace_id}/taskgroup`
  );
  return textResult({
    workspace_id: args.workspace_id,
    page,
    per_page: perPage,
    curr_date: currDate,
    counts: counts ?? {},
    task_groups: groups ?? [],
    tasks: tasks ?? [],
  });
}

export function registerTaskTools(server: McpServer): void {
  server.registerTool(
    'list_tasks',
    {
      description:
        'Tasks the vendor has assigned to you in a workspace — the portal\'s Tasks tab — with the ' +
        'today / this week / overdue / completed counts and any task groups. Sorted by due date.',
      inputSchema: {
        workspace_id: z.string().describe('The workspace _id (from list_projects).'),
        page: z.number().int().positive().optional().describe('Page number (default 1).'),
        per_page: z.number().int().positive().max(200).optional().describe('Page size (default 50).'),
        curr_date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe('YYYY-MM-DD the counts are bucketed against (default: today).'),
        origin: schemaOrigin.describe(
          'Portal origin (e.g. https://<vendor>.hbportal.co). Optional when only one session is active.'
        ),
      },
      annotations: { readOnlyHint: true },
    },
    listTasks
  );
}
