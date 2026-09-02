import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import * as clientModule from '../src/client.js';
import {
  listMessages,
  getMessage,
  sendMessage,
  markMessagesSeen,
  bodyToHtml,
} from '../src/tools/messages.js';
import { htmlToText, scrubVendorSecrets, summarizeActivity } from '../src/feed.js';
import { pendingTaskPolling } from '../src/pending-tasks.js';
import { makeFeed, WORKSPACE_ID, VENDOR_ID, CLIENT_ID, ME_ID } from './fixtures/feed.js';

type FakeClient = {
  request: ReturnType<typeof vi.fn>;
  scope: { portalOrigin: string; companyName: string; userId: string };
};

function parse(result: { content: Array<{ text?: string }> }): any {
  return JSON.parse(result.content[0].text as string);
}

describe('messages tools', () => {
  let fakeClient: FakeClient;

  beforeEach(() => {
    fakeClient = {
      request: vi.fn(),
      scope: {
        portalOrigin: 'https://thesilkveileventsbyivy.hbportal.co',
        companyName: 'The Silk Veil Events by Ivy',
        userId: ME_ID,
      },
    };
    vi.spyOn(clientModule, 'getActiveClient').mockResolvedValue(
      fakeClient as unknown as clientModule.HoneyBookClient
    );
    pendingTaskPolling.intervalMs = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    pendingTaskPolling.intervalMs = 1000;
  });

  describe('listMessages', () => {
    it('reads the workspace feed and returns messages only, newest first, with compact previews', async () => {
      fakeClient.request.mockResolvedValueOnce(makeFeed());
      const out = parse(await listMessages({ workspace_id: WORKSPACE_ID }));
      expect(fakeClient.request).toHaveBeenCalledWith('GET', `/api/v2/workspaces/${WORKSPACE_ID}/feed`);

      expect(out.items.map((i: any) => i._id)).toEqual([
        'item_my_reply',
        'item_email_checklist',
        'item_msg_login',
        'item_file_email',
      ]);
      const fileEmail = out.items[3];
      expect(fileEmail.type).toBe('workspace_file_email');
      expect(fileEmail.subject).toBe('My Services');
      expect(fileEmail.to).toEqual(['Chris and Meredith <chris@example.com>']);
      expect(fileEmail.files).toEqual([{ _id: 'file_brochure', file_title: "Meredith Hall's Wedding Brochure", file_type: 'brochure' }]);
      expect(fileEmail.preview).toBe('Hi,Chris Thanks for your interest! Here are my packages.');
      const email = out.items[1];
      expect(email.type).toBe('workspace_email');
      expect(email.from).toEqual({ _id: VENDOR_ID, name: 'Ivy Honeycutt', email: 'ivy@example.com' });
      expect(email.to).toEqual(['Meredith Hall', 'Chris Hall']);
      expect(email.subject).toBe('1 - 2 months Checklist');
      expect(email.from_workflow_title).toBe('Workflow-Month of Coordination');
      // preview is whitespace-collapsed and capped
      expect(email.preview.startsWith('Checklist time. We are on the home stretch.')).toBe(true);
      expect(email.preview.length).toBeLessThanOrEqual(241);
      expect(email.preview).not.toContain('\n');
      expect(email.attachments).toEqual([
        { _id: 'att1', name: 'checklist.pdf', url: 'https://files.example/checklist.pdf', size: 1234 },
      ]);
      expect(email.seen_at).toBeNull();
      // bodies are NOT in the list — that is get_message's job
      expect(email.html_body).toBeUndefined();
      expect(email.body).toBeUndefined();

      const reply = out.items[0];
      // the signed-in client is not in feed_users, so `from` is id-only
      expect(reply.from).toEqual({ _id: ME_ID });
      expect(reply.is_from_me).toBe(true);
      expect(reply.reply_to).toBe('item_email_checklist');
      expect(reply.attachments).toBeUndefined();
    });

    it('reports participants and the count of unseen messages from other people', async () => {
      fakeClient.request.mockResolvedValueOnce(makeFeed());
      const out = parse(await listMessages({ workspace_id: WORKSPACE_ID }));
      expect(out.participants).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ _id: VENDOR_ID, name: 'Ivy Honeycutt', company: 'The Silk Veil Events by Ivy LLC' }),
          // a user with no name fields falls back to their id, never ''
          expect.objectContaining({ _id: CLIENT_ID + '_noname', name: CLIENT_ID + '_noname' }),
        ])
      );
      expect(out.participants.map((p: any) => p._id)).not.toContain(ME_ID);
      // item_email_checklist is unseen and from the vendor; item_my_reply is unseen but mine
      expect(out.unseen_count).toBe(1);
      expect(out.total).toBe(4);
    });

    it('kind=activity summarizes calendar, payment and recap items without dumping the raw objects', async () => {
      fakeClient.request.mockResolvedValueOnce(makeFeed());
      const out = parse(await listMessages({ workspace_id: WORKSPACE_ID, kind: 'activity' }));
      const ids = out.items.map((i: any) => i._id);
      expect(ids).toEqual([
        'item_meeting_1_updated',
        'item_meeting_1',
        'item_payment',
        'item_recap',
        'item_activity_added',
      ]);
      const meeting = out.items[1];
      expect(meeting.action).toBe('meeting_scheduled');
      expect(meeting.object_type).toBe('calendar_item');
      expect(meeting.actor).toBe('Ivy Honeycutt');
      expect(meeting.detail).toEqual(
        expect.objectContaining({
          _id: 'cal00000000000000000001',
          title: 'CHRIS AND MEREDITH ZOOM',
          start: '2026-10-12T21:00:00.000+00:00',
          end: '2026-10-12T22:00:00.000+00:00',
          video_meeting_link: 'https://zoom.example/j/1?pwd=abc',
        })
      );
      // the vendor's host link carries a host token; it is never exposed
      expect(JSON.stringify(meeting)).not.toContain('HOST_SECRET');

      const payment = out.items[2];
      expect(payment.action).toBe('set_as_paid');
      expect(payment.detail).toEqual(
        expect.objectContaining({ amount: 1350, count_description: '1 of 1 payments / Retainer', file_title: 'Meredith & Chris Wedding Proposal' })
      );

      const recap = out.items[3];
      expect(recap.type).toBe('ai_meeting_recap_generated');
      expect(recap.detail).toEqual(expect.objectContaining({ meeting_name: 'Meredith Hall - Free Consultation' }));

      const added = out.items[4];
      expect(added.action).toBe('added_user');
      expect(added.target).toBe('Meredith Hall');
    });

    it('kind=all returns everything and honors limit', async () => {
      fakeClient.request.mockResolvedValueOnce(makeFeed());
      const out = parse(await listMessages({ workspace_id: WORKSPACE_ID, kind: 'all', limit: 2 }));
      expect(out.total).toBe(9);
      expect(out.items).toHaveLength(2);
      // the Aug 30 meeting update outranks the Aug 19 reply
      expect(out.items.map((i: any) => i._id)).toEqual(['item_meeting_1_updated', 'item_meeting_1']);
    });
  });

  describe('getMessage', () => {
    it('returns the plain-text body by default and html on request', async () => {
      fakeClient.request.mockResolvedValue(makeFeed());
      const text = parse(await getMessage({ workspace_id: WORKSPACE_ID, message_id: 'item_email_checklist' }));
      expect(text.subject).toBe('1 - 2 months Checklist');
      expect(text.body).toContain('Checklist time.');
      expect(text.body).not.toContain('<p>');
      expect(text.delivery).toEqual([
        { recipient: 'Meredith Hall', status: 'viewed', date: '2026-08-18T14:10:33.000+00:00' },
        { recipient: 'Chris Hall', status: 'sent', date: null },
      ]);

      const html = parse(await getMessage({ workspace_id: WORKSPACE_ID, message_id: 'item_email_checklist', format: 'html' }));
      expect(html.body).toContain('<p>Checklist time.</p>');
    });

    it('falls back to html_body when plain_text is empty, keeping paragraph breaks', async () => {
      const feed = makeFeed() as any;
      const item = feed.feed.feed_items.find((i: any) => i._id === 'item_email_checklist');
      item.data.plain_text = '';
      fakeClient.request.mockResolvedValueOnce(feed);
      const out = parse(await getMessage({ workspace_id: WORKSPACE_ID, message_id: 'item_email_checklist' }));
      expect(out.body).toBe('Checklist time.\nWe are on the home stretch.\nContact the newspaper');
    });

    it('throws a clear error for an unknown id', async () => {
      fakeClient.request.mockResolvedValueOnce(makeFeed());
      await expect(getMessage({ workspace_id: WORKSPACE_ID, message_id: 'nope' })).rejects.toThrow(/nope/);
    });

    it('refuses to treat an activity item as a message', async () => {
      fakeClient.request.mockResolvedValueOnce(makeFeed());
      await expect(getMessage({ workspace_id: WORKSPACE_ID, message_id: 'item_payment' })).rejects.toThrow(/not a message/i);
    });
  });

  describe('htmlToText', () => {
    it('keeps line and paragraph breaks while collapsing runs of spaces', () => {
      expect(htmlToText('<p>a   b</p>\n\n\n<p>c</p><br>d<br><br><br>e')).toBe('a b\n\nc\n\nd\n\ne');
    });
  });

  describe('vendor secret scrubbing', () => {
    it('drops the host link from an unknown item type and from unknown nested objects', () => {
      const unknown = summarizeActivity({
        _id: 'x',
        type: 'some_new_type',
        created_at: '2026-01-01T00:00:00Z',
        data: { thing: { video_meeting_host_link: 'zak', title: 't' }, video_meeting_host_link: 'zak2' },
      });
      expect(JSON.stringify(unknown)).not.toContain('zak');
      expect((unknown.detail as any).thing.title).toBe('t');

      const nested = summarizeActivity({
        _id: 'y',
        type: 'activity',
        created_at: '2026-01-01T00:00:00Z',
        data: { action_type: 'x', object_type: 'y', renamed_item: { video_meeting_host_link: 'zak', title: 't' }, list: [{ zak: 'z' }] },
      });
      expect(JSON.stringify(nested)).not.toContain('zak');

      // a top-level scalar under a secret name on a KNOWN activity item
      const topLevel = summarizeActivity({
        _id: 'z',
        type: 'activity',
        created_at: '2026-01-01T00:00:00Z',
        data: { action_type: 'x', object_type: 'y', video_meeting_host_link: 'zak-leak', zak: ['zak-leak'], title: 't' },
      });
      expect(JSON.stringify(topLevel)).not.toContain('zak-leak');
      expect((topLevel.detail as any).title).toBe('t');
      expect(scrubVendorSecrets({ a: [{ host_link: 1, b: 2 }] })).toEqual({ a: [{ b: 2 }] });
    });
  });

  describe('bodyToHtml', () => {
    it('escapes plain text and turns newlines into <br>', () => {
      expect(bodyToHtml('Hi <Ivy> & co,\nSee you\n\nthen')).toBe('Hi &lt;Ivy&gt; &amp; co,<br>See you<br><br>then');
    });
    it('passes html through untouched', () => {
      expect(bodyToHtml('<p>Hi</p>')).toBe('<p>Hi</p>');
      expect(bodyToHtml('Line one<br>Line two')).toBe('Line one<br>Line two');
      expect(bodyToHtml('See <a href="https://x">this</a>')).toBe('See <a href="https://x">this</a>');
    });
  });

  describe('sendMessage', () => {
    it('previews without sending when confirm is missing', async () => {
      fakeClient.request.mockResolvedValueOnce(makeFeed());
      const result = await sendMessage({ workspace_id: WORKSPACE_ID, subject: 'Question', body: 'Hi Ivy' });
      const text = result.content[0].text as string;
      expect(text).toContain('Question');
      expect(text).toContain('Ivy Honeycutt');
      expect(text).toMatch(/confirm.*true/);
      expect(fakeClient.request).toHaveBeenCalledTimes(1);
      expect(fakeClient.request.mock.calls[0][0]).toBe('GET');
    });

    it('requires a subject on a new (non-reply) message', async () => {
      fakeClient.request.mockResolvedValueOnce(makeFeed());
      await expect(sendMessage({ workspace_id: WORKSPACE_ID, body: 'Hi', confirm: true })).rejects.toThrow(/subject/i);
    });

    it('creates a send_workspace_message pending task and polls it to Finished', async () => {
      fakeClient.request
        .mockResolvedValueOnce(makeFeed()) // GET feed
        .mockResolvedValueOnce({ task_id: 'task1' }) // POST client_pending_task
        .mockResolvedValueOnce([{ _id: 'task1', pending_task_state_cd: 1 }]) // Started
        .mockResolvedValueOnce([
          {
            _id: 'task1',
            pending_task_state_cd: 2,
            pending_task_result: { workspaces: { result: { failed: false, send_results: [{ success: true }] } } },
          },
        ]);
      const out = parse(
        await sendMessage({ workspace_id: WORKSPACE_ID, subject: 'Question', body: 'Hi Ivy,\nQuick one.', confirm: true })
      );
      expect(out.status).toBe('sent');
      expect(out.task_id).toBe('task1');

      const post = fakeClient.request.mock.calls[1];
      expect(post[0]).toBe('POST');
      expect(post[1]).toBe('/api/v2/client_pending_task');
      expect(post[2]).toEqual({
        task_type: 'send_workspace_message',
        task_data: {
          ws_id: WORKSPACE_ID,
          subject: 'Question',
          html_body: 'Hi Ivy,<br>Quick one.',
          force: false,
          general_files: [],
          image_files: [],
          flow_attachments: [],
        },
      });
      expect(fakeClient.request.mock.calls[2]).toEqual(['GET', '/api/v2/client_pending_tasks?task_ids[]=task1']);
      expect(fakeClient.request).toHaveBeenCalledTimes(4);
    });

    it('replies to an existing message: inherits its subject and sets feed_to_reply_id', async () => {
      fakeClient.request
        .mockResolvedValueOnce(makeFeed())
        .mockResolvedValueOnce({ task_id: 'task2' })
        .mockResolvedValueOnce([{ _id: 'task2', pending_task_state_cd: 2, pending_task_result: {} }]);
      const out = parse(
        await sendMessage({ workspace_id: WORKSPACE_ID, body: 'Thanks!', reply_to_message_id: 'item_email_checklist', confirm: true })
      );
      expect(out.status).toBe('sent');
      const body = fakeClient.request.mock.calls[1][2] as any;
      expect(body.task_data.subject).toBe('1 - 2 months Checklist');
      expect(body.task_data.feed_to_reply_id).toBe('item_email_checklist');
    });

    it('rejects a reply to an id that is not in the feed', async () => {
      fakeClient.request.mockResolvedValueOnce(makeFeed());
      await expect(
        sendMessage({ workspace_id: WORKSPACE_ID, body: 'x', reply_to_message_id: 'ghost', confirm: true })
      ).rejects.toThrow(/ghost/);
      expect(fakeClient.request).toHaveBeenCalledTimes(1);
    });

    it('surfaces an aborted task with the server error message', async () => {
      fakeClient.request
        .mockResolvedValueOnce(makeFeed())
        .mockResolvedValueOnce({ task_id: 'task3' })
        .mockResolvedValueOnce([{ _id: 'task3', pending_task_state_cd: 3, pending_task_error_message: 'Recipient bounced' }]);
      await expect(
        sendMessage({ workspace_id: WORKSPACE_ID, subject: 's', body: 'x', confirm: true })
      ).rejects.toThrow(/Recipient bounced/);
    });

    it('surfaces per-recipient failures reported inside a Finished result', async () => {
      fakeClient.request
        .mockResolvedValueOnce(makeFeed())
        .mockResolvedValueOnce({ task_id: 'task4' })
        .mockResolvedValueOnce([
          {
            _id: 'task4',
            pending_task_state_cd: 2,
            pending_task_result: {
              workspaces: { result: { failed: true, send_results: [{ success: false, error: 'invalid email' }] } },
            },
          },
        ]);
      await expect(
        sendMessage({ workspace_id: WORKSPACE_ID, subject: 's', body: 'x', confirm: true })
      ).rejects.toThrow(/invalid email/);
    });
  });

  describe('markMessagesSeen', () => {
    it('PUTs the item ids to feed_items/seen', async () => {
      fakeClient.request.mockResolvedValueOnce({ ok: true });
      const out = parse(await markMessagesSeen({ workspace_id: WORKSPACE_ID, message_ids: ['a', 'b'] }));
      expect(fakeClient.request).toHaveBeenCalledWith('PUT', `/api/v2/workspaces/${WORKSPACE_ID}/feed_items/seen`, {
        item_ids: ['a', 'b'],
      });
      expect(out.marked).toEqual(['a', 'b']);
    });
  });
});
