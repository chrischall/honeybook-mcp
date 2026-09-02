import type { HoneyBookClient } from './client.js';

/**
 * The workspace feed — `GET /api/v2/workspaces/<id>/feed` — is the one
 * response behind the portal's Overview "Messages" card, the Activity tab,
 * and (indirectly) the meetings it lists. Messages, activity and meetings
 * tools all read it, so the fetch and the item summarizer live here and each
 * tool shapes the same items its own way.
 */

export type RawItem = Record<string, unknown>;

export interface FeedUser {
  _id: string;
  name: string;
  email?: string;
  phone?: string;
  company?: string;
}

export interface WorkspaceFeed {
  workspaceId: string;
  users: Record<string, FeedUser>;
  items: RawItem[];
}

/**
 * The feed item types that are messages a person reads, as opposed to
 * activity. `workspace_file_email` is the email that delivers a file
 * (brochure, proposal, contract) — it carries a subject, a body and the
 * files it sent, so it reads as a message with attachments.
 */
export const MESSAGE_TYPES = new Set(['feed_message', 'workspace_email', 'workspace_file_email']);

/** A string field, with the API's empty-string "unset" folded into undefined. */
function str(o: RawItem | undefined, k: string): string | undefined {
  const v = o?.[k];
  return typeof v === 'string' && v !== '' ? v : undefined;
}
function obj(o: RawItem | undefined, k: string): RawItem | undefined {
  const v = o?.[k];
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as RawItem) : undefined;
}
function arr(o: RawItem | undefined, k: string): RawItem[] {
  const v = o?.[k];
  return Array.isArray(v) ? (v as RawItem[]) : [];
}

export async function fetchWorkspaceFeed(
  client: HoneyBookClient,
  workspaceId: string
): Promise<WorkspaceFeed> {
  const res = await client.request<RawItem>('GET', `/api/v2/workspaces/${workspaceId}/feed`);
  const feed = obj(res, 'feed');
  const users: Record<string, FeedUser> = {};
  const feedUsers = obj(feed, 'feed_users') ?? {};
  for (const [id, raw] of Object.entries(feedUsers)) {
    const u = raw as RawItem;
    users[id] = {
      _id: id,
      name:
        str(u, 'full_name') ??
        ([str(u, 'first_name'), str(u, 'last_name')].filter(Boolean).join(' ') || id),
      email: str(u, 'email'),
      phone: str(u, 'phone_number'),
      company: str(obj(u, 'company'), 'company_name'),
    };
  }
  return { workspaceId, users, items: arr(feed, 'feed_items') };
}

/** The timestamp a human would sort by: when it was sent, else when it happened. */
export function itemDate(item: RawItem): string | undefined {
  const data = obj(item, 'data');
  return str(data, 'sent_on') ?? str(item, 'origin_date') ?? str(item, 'created_at');
}

export function isMessageItem(item: RawItem): boolean {
  return MESSAGE_TYPES.has(str(item, 'type') ?? '');
}

/**
 * Attachments on a message, when the API includes any. The composer's
 * request carries `general_files` / `image_files` / `flow_attachments`; a
 * stored email exposes them under `file_attachments` / `image_attachments`
 * (the composer reads the same names off the item it is replying to).
 */
export function itemAttachments(item: RawItem): RawItem[] | undefined {
  const data = obj(item, 'data');
  const all = [
    ...arr(data, 'file_attachments'),
    ...arr(data, 'image_attachments'),
    ...arr(data, 'attachments'),
  ];
  if (all.length === 0) return undefined;
  return all.map((a) => ({
    _id: a._id,
    name: a.name ?? a.file_name ?? a.title,
    url: a.url ?? a.file_url,
    size: a.size ?? a.file_size,
    asset_type: a.asset_type,
  }));
}

export function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** Collapse runs of spaces but keep paragraph breaks (at most one blank line). */
export function collapseHorizontalWhitespace(s: string): string {
  return s
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const PREVIEW_CHARS = 240;

/** Compact card for a message item. Bodies are deliberately left out. */
export function summarizeMessage(item: RawItem, feed: WorkspaceFeed, meId: string): RawItem {
  const data = obj(item, 'data');
  const senderId = str(item, 'sender_id') ?? str(data, 'sender_user_id');
  const sender = senderId ? feed.users[senderId] : undefined;
  const plain = str(data, 'plain_text') ?? '';
  const collapsed = collapseWhitespace(plain);
  const preview =
    collapsed.length > PREVIEW_CHARS ? collapsed.slice(0, PREVIEW_CHARS) + '…' : collapsed;
  let to = arr(item, 'to_users_full_names') as unknown as string[];
  // A file email carries its recipients only as a `to` header string.
  if (to.length === 0 && str(data, 'to')) to = [str(data, 'to') as string];
  const out: RawItem = {
    _id: item._id,
    type: item.type,
    date: itemDate(item),
    from: sender
      ? { _id: sender._id, name: sender.name, email: sender.email }
      : senderId
        ? { _id: senderId }
        : null,
    is_from_me: senderId === meId,
    to,
    subject: str(data, 'subject') ?? str(data, 'title') ?? null,
    preview,
    seen_at: item.seen_at ?? null,
    reply_to: item.feed_item_reply_id ?? null,
  };
  if (str(item, 'from_workflow_title')) out.from_workflow_title = item.from_workflow_title;
  const attachments = itemAttachments(item);
  if (attachments) out.attachments = attachments;
  const files = arr(data, 'workspace_files');
  if (files.length > 0) {
    out.files = files.map((f) => ({ _id: f._id, file_title: f.file_title, file_type: f.file_type }));
  }
  return out;
}

/** Everything a person needs to read one message. */
export function expandMessage(
  item: RawItem,
  feed: WorkspaceFeed,
  meId: string,
  format: 'text' | 'html'
): RawItem {
  const data = obj(item, 'data');
  const summary = summarizeMessage(item, feed, meId);
  delete summary.preview;
  // `str` folds '' to undefined, so an empty plain_text falls through to the
  // html_body rather than returning an empty body next to a real one.
  const body =
    format === 'html'
      ? (str(data, 'html_body') ?? str(data, 'plain_text') ?? '')
      : (str(data, 'plain_text') ?? htmlToText(str(data, 'html_body') ?? ''));
  const delivery = arr(item, 'email_tracking').map((t) => ({
    recipient: t.recipient_name,
    status: t.status,
    date: t.date ?? null,
  }));
  return { ...summary, body_format: format, body: body.trim(), delivery };
}

/** Last-resort text for an item whose `plain_text` is missing. Paragraph breaks survive. */
export function htmlToText(html: string): string {
  return collapseHorizontalWhitespace(
    html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h\d|tr)>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
  );
}

/**
 * A calendar item as the feed embeds it, minus the vendor's host link
 * (`video_meeting_host_link` carries the host's Zoom `zak` token — it is
 * the vendor's credential, not something a client should be handed).
 */
export function compactCalendarItem(c: RawItem): RawItem {
  const opt = (k: string) => {
    const v = str(c, k);
    return v ? v : undefined;
  };
  return {
    _id: c._id,
    title: c.title,
    type: c.type,
    start: c.date_time_start ?? c.item_date_start,
    end: c.date_time_end ?? c.item_date_end,
    timezone: c.timezone,
    all_day: c.all_day,
    location: opt('location'),
    description: opt('description'),
    phone_call_number: opt('phone_call_number'),
    video_conference_type: opt('video_conference_type'),
    video_meeting_link: opt('video_meeting_link'),
    video_meeting_password: opt('video_meeting_password'),
  };
}

/**
 * Fields that are the VENDOR's credentials, never a client's business. The
 * known carrier is `calendar_item.video_meeting_host_link` (a Zoom host link
 * with a `zak` token); `compactCalendarItem` never copies it, and this
 * denylist covers every other path a payload can take through the
 * summarizer, so the property does not depend on which item type carried it.
 */
export const VENDOR_SECRET_KEYS = new Set([
  'video_meeting_host_link',
  'video_meeting_host_url',
  'host_link',
  'zak',
]);

/** Deep-copy `v` with every {@link VENDOR_SECRET_KEYS} key removed. */
export function scrubVendorSecrets<T>(v: T): T {
  if (Array.isArray(v)) return v.map(scrubVendorSecrets) as unknown as T;
  if (v && typeof v === 'object') {
    const out: RawItem = {};
    for (const [k, val] of Object.entries(v as RawItem)) {
      if (VENDOR_SECRET_KEYS.has(k)) continue;
      out[k] = scrubVendorSecrets(val);
    }
    return out as T;
  }
  return v;
}

/** Compact card for a non-message item (activity, recap, anything else). */
export function summarizeActivity(item: RawItem): RawItem {
  const data = obj(item, 'data') ?? {};
  const type = str(item, 'type');
  const base: RawItem = {
    _id: item._id,
    type,
    date: itemDate(item),
    seen_at: item.seen_at ?? null,
  };
  if (type === 'activity') {
    base.action = data.action_type;
    base.object_type = data.object_type;
    if (data.sub_object_type) base.sub_object_type = data.sub_object_type;
    base.actor = str(obj(data, 'user'), 'full_name');
    const target = str(obj(data, 'target'), 'full_name');
    if (target) base.target = target;
    base.detail = activityDetail(data);
    return base;
  }
  if (type === 'ai_meeting_recap_generated') {
    base.detail = {
      meeting_name: data.meeting_name,
      start: data.meeting_start_date,
      end: data.meeting_end_date,
      meeting_note_id: data.meeting_note_id,
    };
    return base;
  }
  base.detail = scrubVendorSecrets(data);
  return base;
}

const ACTIVITY_ENVELOPE_KEYS = new Set([
  'user',
  'target',
  'done_on',
  'on_object_id',
  'object_type',
  'sub_object_type',
  'action_type',
]);

function activityDetail(data: RawItem): RawItem {
  const detail: RawItem = {};
  for (const [k, v] of Object.entries(data)) {
    if (ACTIVITY_ENVELOPE_KEYS.has(k)) continue;
    if (k === 'calendar_item' && v && typeof v === 'object') {
      Object.assign(detail, compactCalendarItem(v as RawItem));
    } else if (k === 'workspace_file' && v && typeof v === 'object') {
      const f = v as RawItem;
      detail.file_id = f._id;
      detail.file_title = f.file_title;
    } else if (k === 'payment' && v && typeof v === 'object') {
      const p = v as RawItem;
      detail.amount = p.amount;
      detail.count_description = p.count_description;
      detail.charge_description = p.charge_description;
      detail.payment_method_type = p.payment_method_type;
      if (p.tip_paid) detail.tip_paid = p.tip_paid;
    } else if (v && typeof v === 'object' && !Array.isArray(v)) {
      // Unknown nested object: keep its scalar fields, drop nested blobs.
      const flat: RawItem = {};
      for (const [k2, v2] of Object.entries(v as RawItem)) {
        if (VENDOR_SECRET_KEYS.has(k2)) continue;
        if (v2 === null || typeof v2 !== 'object') flat[k2] = v2;
      }
      detail[k] = flat;
    } else {
      detail[k] = scrubVendorSecrets(v);
    }
  }
  return detail;
}
