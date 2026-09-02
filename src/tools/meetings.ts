import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { textResult, schemaOrigin } from '@chrischall/mcp-utils';
import { getActiveClient } from '../client.js';
import { fetchWorkspaceFeed, compactCalendarItem, itemDate, type RawItem } from '../feed.js';
import type { ToolResult } from '../types.js';

/**
 * The portal has no meetings endpoint of its own: every scheduled /
 * rescheduled meeting arrives as an `activity` feed item whose data embeds
 * the full `calendar_item`. Folding those by calendar item id, latest wins,
 * gives the same list the Activity tab renders as "X scheduled for …".
 */
export function meetingsFromFeed(items: RawItem[]): RawItem[] {
  const byId = new Map<string, { at: string; meeting: RawItem }>();
  for (const item of items) {
    if (item.type !== 'activity') continue;
    const data = item.data as RawItem | undefined;
    const cal = data?.calendar_item as RawItem | undefined;
    if (!cal || typeof cal._id !== 'string') continue;
    const at = itemDate(item) ?? '';
    const prev = byId.get(cal._id);
    if (prev && prev.at > at) continue;
    byId.set(cal._id, {
      at,
      meeting: {
        ...compactCalendarItem(cal),
        last_action: data?.action_type,
        last_action_at: at,
      },
    });
  }
  return [...byId.values()]
    .map((m) => m.meeting)
    .sort((a, b) => String(a.start ?? '').localeCompare(String(b.start ?? '')));
}

export async function listMeetings(args: {
  workspace_id: string;
  origin?: string;
}): Promise<ToolResult> {
  const client = await getActiveClient(args.origin);
  const feed = await fetchWorkspaceFeed(client, args.workspace_id);
  return textResult({ workspace_id: args.workspace_id, meetings: meetingsFromFeed(feed.items) });
}

export function registerMeetingTools(server: McpServer): void {
  server.registerTool(
    'list_meetings',
    {
      description:
        'Meetings the vendor has scheduled in a workspace (consultations, Zoom calls, walkthroughs): ' +
        'title, start/end, timezone, join link and password. Derived from the workspace feed, ' +
        'so a rescheduled meeting shows its latest time. Sorted by start.',
      inputSchema: {
        workspace_id: z.string().describe('The workspace _id (from list_projects).'),
        origin: schemaOrigin.describe(
          'Portal origin (e.g. https://<vendor>.hbportal.co). Optional when only one session is active.'
        ),
      },
      annotations: { readOnlyHint: true },
    },
    listMeetings
  );
}
