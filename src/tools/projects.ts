import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { textResult, schemaOrigin } from '@chrischall/mcp-utils';
import { getActiveClient } from '../client.js';
import type { ToolResult } from '../types.js';

type Raw = Record<string, unknown>;

interface ClientEventsPage {
  data?: Raw[];
  cur_page?: number | null;
  total_pages?: number;
  last_page?: boolean;
}

/**
 * HoneyBook calls a client's project an **event** (`/api/v2/client/events`);
 * each has exactly one client-portal workspace, whose id is what every other
 * tool here takes. The portal's project switcher (top-left) is this list.
 */
export async function listProjects(args: { page?: number; origin?: string }): Promise<ToolResult> {
  const client = await getActiveClient(args.origin);
  const path = args.page ? `/api/v2/client/events?page=${args.page}` : '/api/v2/client/events';
  const res = await client.request<ClientEventsPage>('GET', path);
  return textResult({
    projects: (res.data ?? []).map((e) => ({
      project_id: e._id,
      workspace_id: e.workspace_id,
      name: e.event_name,
      date: e.event_date ?? null,
      is_booked: e.is_booked,
      created_at: e.created_at,
    })),
    cur_page: res.cur_page ?? null,
    total_pages: res.total_pages ?? null,
    last_page: res.last_page ?? true,
  });
}

/** A string field, with the API's empty-string "unset" folded into undefined. */
function str(o: Raw | undefined, k: string): string | undefined {
  const v = o?.[k];
  return typeof v === 'string' && v !== '' ? v : undefined;
}

/**
 * `event_users` lists the same person more than once when they sit on the
 * project through more than one path (observed live: the signed-in client
 * appeared twice). One row per _id.
 */
function uniqueById(users: Raw[]): Raw[] {
  const seen = new Set<unknown>();
  return users.filter((u) => {
    if (seen.has(u._id)) return false;
    seen.add(u._id);
    return true;
  });
}

function summarizeProject(d: Raw): Raw {
  const users = Array.isArray(d.event_users) ? (d.event_users as Raw[]) : [];
  const custom = Array.isArray(d.custom_project_fields_v2) ? (d.custom_project_fields_v2 as Raw[]) : [];
  const image = d.event_image as Raw | undefined;
  return {
    _id: d._id,
    name: d.event_name,
    type: d.event_type ?? d.project_type,
    date: d.event_date ?? null,
    end_date: d.event_end_date ?? null,
    time_start: d.event_time_start ?? null,
    time_end: d.event_time_end ?? null,
    timezone: d.event_timezone_iana ?? d.event_timezone ?? null,
    location: d.event_location ?? null,
    venue_name: d.venue_name ?? null,
    guests: d.event_guests ?? null,
    budget: d.event_budget ?? null,
    details: d.event_details ?? null,
    project_dates: d.project_dates ?? [],
    custom_fields: custom
      .filter((f) => f.value !== null && f.value !== undefined && f.value !== '')
      .map((f) => ({ label: f.label ?? f.name, value: f.value })),
    image_url: str(image, 'url') ?? null,
    people: uniqueById(users).map((u) => ({
      _id: u._id,
      name: str(u, 'full_name') ?? [str(u, 'first_name'), str(u, 'last_name')].filter(Boolean).join(' '),
      email: str(u, 'email'),
      phone: str(u, 'phone_number'),
      role: str(u, 'system_user_type') ?? str(u, 'user_type'),
      job_title: str(u, 'job_title'),
      company: str(u.company as Raw | undefined, 'company_name'),
    })),
    last_activity_date: d.last_activity_date ?? null,
  };
}

export async function getProject(args: {
  project_id: string;
  section?: 'summary' | 'raw';
  origin?: string;
}): Promise<ToolResult> {
  const client = await getActiveClient(args.origin);
  const res = await client.request<Raw>('GET', `/api/v2/events/${args.project_id}/details`);
  return textResult(args.section === 'raw' ? res : summarizeProject(res));
}

export function registerProjectTools(server: McpServer): void {
  server.registerTool(
    'list_projects',
    {
      description:
        'List your projects with a vendor (HoneyBook calls them events): name, date, booked flag and the ' +
        'workspace_id that every other workspace tool takes. This is the portal\'s project switcher.',
      inputSchema: {
        page: z.number().int().positive().optional().describe('Page number; omit for the first page.'),
        origin: schemaOrigin.describe(
          'Portal origin (e.g. https://<vendor>.hbportal.co). Optional when only one session is active.'
        ),
      },
      annotations: { readOnlyHint: true },
    },
    listProjects
  );

  server.registerTool(
    'get_project',
    {
      description:
        'Project details — the portal\'s Overview "Project details" card plus the people on it: name, date, ' +
        'time, timezone, location, guest count, custom fields, cover image, and each participant\'s name / ' +
        'email / phone / role. section="raw" returns the untrimmed response (large: it embeds the vendor\'s account).',
      inputSchema: {
        project_id: z.string().describe('The project (event) _id from list_projects.'),
        section: z.enum(['summary', 'raw']).optional().describe('Default "summary".'),
        origin: schemaOrigin.describe(
          'Portal origin (e.g. https://<vendor>.hbportal.co). Optional when only one session is active.'
        ),
      },
      annotations: { readOnlyHint: true },
    },
    getProject
  );
}
