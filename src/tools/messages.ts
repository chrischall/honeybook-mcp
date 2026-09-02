import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { textResult, rawTextResult, schemaOrigin, schemaConfirm } from '@chrischall/mcp-utils';
import { getActiveClient } from '../client.js';
import {
  fetchWorkspaceFeed,
  isMessageItem,
  itemDate,
  summarizeMessage,
  summarizeActivity,
  expandMessage,
  type RawItem,
  type WorkspaceFeed,
} from '../feed.js';
import { runClientPendingTask } from '../pending-tasks.js';
import type { ToolResult } from '../types.js';

export const FEED_KINDS = ['messages', 'activity', 'all'] as const;
export type FeedKind = (typeof FEED_KINDS)[number];

const ORIGIN_DESC =
  'Portal origin (e.g. https://<vendor>.hbportal.co). Optional when only one session is active.';
const WORKSPACE_DESC =
  'The workspace _id (from list_projects, or .workspace._id on any workspace_file).';

function sortNewestFirst(items: RawItem[]): RawItem[] {
  return [...items].sort((a, b) => (itemDate(b) ?? '').localeCompare(itemDate(a) ?? ''));
}

function participants(feed: WorkspaceFeed, meId: string) {
  return Object.values(feed.users).map((u) => ({
    _id: u._id,
    name: u.name,
    email: u.email,
    ...(u.company ? { company: u.company } : {}),
    ...(u._id === meId ? { is_me: true } : {}),
  }));
}

export async function listMessages(args: {
  workspace_id: string;
  kind?: FeedKind;
  limit?: number;
  origin?: string;
}): Promise<ToolResult> {
  const client = await getActiveClient(args.origin);
  const meId = client.scope.userId;
  const feed = await fetchWorkspaceFeed(client, args.workspace_id);
  const kind = args.kind ?? 'messages';
  const limit = args.limit ?? 50;

  const selected = sortNewestFirst(
    feed.items.filter((item) => {
      if (kind === 'all') return true;
      return kind === 'messages' ? isMessageItem(item) : !isMessageItem(item);
    })
  );
  const items = selected
    .slice(0, limit)
    .map((item) =>
      isMessageItem(item) ? summarizeMessage(item, feed, meId) : summarizeActivity(item)
    );
  const unseen = selected.filter(
    (item) => isMessageItem(item) && !item.seen_at && item.sender_id !== meId
  ).length;

  return textResult({
    workspace_id: args.workspace_id,
    kind,
    participants: participants(feed, meId),
    total: selected.length,
    unseen_count: unseen,
    items,
  });
}

function findItem(feed: WorkspaceFeed, id: string): RawItem {
  const item = feed.items.find((i) => i._id === id);
  if (!item) {
    throw new Error(
      `No feed item "${id}" in workspace ${feed.workspaceId}. Use list_messages to find message ids.`
    );
  }
  return item;
}

export async function getMessage(args: {
  workspace_id: string;
  message_id: string;
  format?: 'text' | 'html';
  origin?: string;
}): Promise<ToolResult> {
  const client = await getActiveClient(args.origin);
  const feed = await fetchWorkspaceFeed(client, args.workspace_id);
  const item = findItem(feed, args.message_id);
  if (!isMessageItem(item)) {
    throw new Error(
      `Feed item "${args.message_id}" is a "${String(item.type)}" activity item, not a message. ` +
        `list_messages with kind="activity" already shows everything it carries.`
    );
  }
  return textResult(expandMessage(item, feed, client.scope.userId, args.format ?? 'text'));
}

/**
 * The composer sends HTML. Plain text is escaped and line breaks become
 * `<br>`; a body that already uses a real HTML tag is trusted as authored
 * HTML. The tag list is an allowlist on purpose: "<Ivy>" in a sentence is
 * prose, not markup.
 */
const HTML_TAG =
  /<\/?(p|br|div|a|b|i|u|strong|em|ul|ol|li|span|h[1-6]|table|tr|td|th|img|blockquote|pre|code|hr)\b[^>]*>/i;

export function bodyToHtml(body: string): string {
  if (HTML_TAG.test(body)) return body;
  return body
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\r?\n/g, '<br>');
}

interface SendResult {
  workspaces?: { result?: { failed?: boolean; send_results?: Array<Record<string, unknown>> } };
}

export async function sendMessage(args: {
  workspace_id: string;
  body: string;
  subject?: string;
  reply_to_message_id?: string;
  origin?: string;
  confirm?: boolean;
}): Promise<ToolResult> {
  const client = await getActiveClient(args.origin);
  const meId = client.scope.userId;
  const feed = await fetchWorkspaceFeed(client, args.workspace_id);

  let subject = args.subject?.trim();
  let replyTo: RawItem | undefined;
  if (args.reply_to_message_id) {
    replyTo = findItem(feed, args.reply_to_message_id);
    if (!isMessageItem(replyTo)) {
      throw new Error(
        `Cannot reply to "${args.reply_to_message_id}": it is a "${String(replyTo.type)}" activity item, not a message.`
      );
    }
    if (!subject) {
      const data = (replyTo.data ?? {}) as RawItem;
      subject = typeof data.subject === 'string' ? data.subject : undefined;
    }
  }
  if (!subject) {
    throw new Error('A subject is required for a new message (replies inherit the original subject).');
  }
  if (!args.body.trim()) throw new Error('The message body is empty.');

  const recipients = Object.values(feed.users).filter((u) => u._id !== meId);
  const recipientLine = recipients.map((u) => `${u.name}${u.email ? ` <${u.email}>` : ''}`).join(', ');

  if (!args.confirm) {
    return rawTextResult(
      `About to send a message in workspace ${args.workspace_id} via the HoneyBook portal.\n` +
        `To: ${recipientLine || '(everyone in the workspace)'}\n` +
        `Subject: ${subject}${replyTo ? ` (reply to "${String(replyTo._id)}")` : ''}\n\n` +
        `${args.body}\n\n` +
        `Re-run send_message with { confirm: true } to send it.`
    );
  }

  const taskData: Record<string, unknown> = {
    ws_id: args.workspace_id,
    subject,
    html_body: bodyToHtml(args.body),
    force: false,
    general_files: [],
    image_files: [],
    flow_attachments: [],
  };
  if (replyTo) taskData.feed_to_reply_id = replyTo._id;

  const { task_id, result } = await runClientPendingTask<SendResult | null>(
    client,
    'send_workspace_message',
    taskData
  );
  const sendResults = result?.workspaces?.result?.send_results;
  if (result?.workspaces?.result?.failed) {
    const failed = (sendResults ?? []).filter((r) => r.success === false);
    throw new Error(
      `HoneyBook reported the message as not delivered to every recipient: ${JSON.stringify(failed.length ? failed : sendResults)}`
    );
  }
  return textResult({
    status: 'sent',
    task_id,
    workspace_id: args.workspace_id,
    subject,
    to: recipients.map((u) => u.name),
    reply_to: replyTo ? replyTo._id : null,
    send_results: sendResults ?? null,
  });
}

export async function markMessagesSeen(args: {
  workspace_id: string;
  message_ids: string[];
  origin?: string;
}): Promise<ToolResult> {
  const client = await getActiveClient(args.origin);
  await client.request<unknown>('PUT', `/api/v2/workspaces/${args.workspace_id}/feed_items/seen`, {
    item_ids: args.message_ids,
  });
  return textResult({ workspace_id: args.workspace_id, marked: args.message_ids });
}

export function registerMessageTools(server: McpServer): void {
  server.registerTool(
    'list_messages',
    {
      description:
        'List the messages (and optionally the activity log) in a workspace — the portal\'s Activity tab. ' +
        'Returns compact cards (sender, subject, preview, seen state, attachments), newest first; ' +
        'call get_message for a full body. Reading does NOT mark anything as seen.',
      inputSchema: {
        workspace_id: z.string().describe(WORKSPACE_DESC),
        kind: z
          .enum(FEED_KINDS)
          .optional()
          .describe(
            '"messages" (default): emails and portal messages. "activity": everything else — ' +
              'meetings scheduled, files signed, payments, reminders, AI recaps. "all": both.'
          ),
        limit: z.number().int().positive().max(500).optional().describe('Max items to return (default 50).'),
        origin: schemaOrigin.describe(ORIGIN_DESC),
      },
      annotations: { readOnlyHint: true },
    },
    listMessages
  );

  server.registerTool(
    'get_message',
    {
      description:
        'Read one message in full: body (plain text by default, or the original HTML), sender, recipients, ' +
        'attachments and per-recipient delivery status.',
      inputSchema: {
        workspace_id: z.string().describe(WORKSPACE_DESC),
        message_id: z.string().describe('The message _id from list_messages.'),
        format: z.enum(['text', 'html']).optional().describe('Body format. Default "text".'),
        origin: schemaOrigin.describe(ORIGIN_DESC),
      },
      annotations: { readOnlyHint: true },
    },
    getMessage
  );

  server.registerTool(
    'send_message',
    {
      description:
        'Send a message to the vendor (and the other members of the workspace) through the HoneyBook portal, ' +
        'exactly as the Activity tab composer does. HoneyBook emails it to every recipient. ' +
        'Pass reply_to_message_id to reply in-thread (the subject is inherited). Requires confirm:true.',
      inputSchema: {
        workspace_id: z.string().describe(WORKSPACE_DESC),
        body: z
          .string()
          .describe('Message text. Plain text is sent as-is (line breaks preserved); HTML is passed through.'),
        subject: z.string().optional().describe('Required for a new message; optional on a reply.'),
        reply_to_message_id: z
          .string()
          .optional()
          .describe('A message _id from list_messages to reply to.'),
        origin: schemaOrigin.describe(ORIGIN_DESC),
        confirm: schemaConfirm.describe(
          'Must be true to actually send. Without it the tool returns a preview of what would go out.'
        ),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    sendMessage
  );

  server.registerTool(
    'mark_messages_seen',
    {
      description:
        'Mark feed items as seen (what the portal does when you open the Activity tab). ' +
        'list_messages and get_message never do this on their own.',
      inputSchema: {
        workspace_id: z.string().describe(WORKSPACE_DESC),
        message_ids: z.array(z.string()).min(1).describe('Feed item _ids from list_messages.'),
        origin: schemaOrigin.describe(ORIGIN_DESC),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    markMessagesSeen
  );
}
