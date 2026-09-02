import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import * as clientModule from '../src/client.js';
import { listTasks, toApiDate, today } from '../src/tools/tasks.js';
import { listNotes } from '../src/tools/notes.js';
import { listAttachments } from '../src/tools/attachments.js';
import { listPayments } from '../src/tools/payments.js';
import { listMeetings } from '../src/tools/meetings.js';
import { makeFeed, WORKSPACE_ID } from './fixtures/feed.js';

function parse(result: { content: Array<{ text?: string }> }): any {
  return JSON.parse(result.content[0].text as string);
}

describe('workspace tab tools', () => {
  let fakeClient: { request: ReturnType<typeof vi.fn>; scope: { portalOrigin: string; companyName: string; userId: string } };

  beforeEach(() => {
    fakeClient = {
      request: vi.fn(),
      scope: { portalOrigin: 'https://thesilkveileventsbyivy.hbportal.co', companyName: 'Silk Veil', userId: 'uid_24' },
    };
    vi.spyOn(clientModule, 'getActiveClient').mockResolvedValue(fakeClient as unknown as clientModule.HoneyBookClient);
  });
  afterEach(() => vi.restoreAllMocks());

  it('listTasks reads the paged task list, the counts and the task groups the Tasks tab loads', async () => {
    fakeClient.request
      .mockResolvedValueOnce([{ _id: 't1', title: 'Send guest list', due_date: '2026-09-10', is_completed: false }])
      .mockResolvedValueOnce({ all: 1, today: 0, this_week: 1, overdue: 0, completed: 0, tasks: 1, approvals: 0, total: 1 })
      .mockResolvedValueOnce([{ _id: 'g1', title: 'Before the wedding' }]);
    const out = parse(await listTasks({ workspace_id: WORKSPACE_ID, curr_date: '2026-09-02' }));
    expect(fakeClient.request.mock.calls[0]).toEqual([
      'GET',
      `/api/v2/tasks/workspaces/${WORKSPACE_ID}?page=1&perPage=50&sort_by=due_date&sort_desc=false&curr_date=09%2F02%2F2026`,
    ]);
    expect(fakeClient.request.mock.calls[1]).toEqual(['GET', `/api/v2/tasks/workspaces/${WORKSPACE_ID}/counts?curr_date=09%2F02%2F2026`]);
    expect(fakeClient.request.mock.calls[2]).toEqual(['GET', `/api/v2/workspaces/${WORKSPACE_ID}/taskgroup`]);
    expect(out.tasks).toHaveLength(1);
    expect(out.counts.total).toBe(1);
    expect(out.task_groups).toEqual([{ _id: 'g1', title: 'Before the wedding' }]);
    expect(out.page).toBe(1);
  });

  it('listTasks defaults curr_date to today (YYYY-MM-DD) and forwards paging', async () => {
    fakeClient.request.mockResolvedValue([]);
    await listTasks({ workspace_id: WORKSPACE_ID, page: 2, per_page: 10 });
    const url = fakeClient.request.mock.calls[0][1] as string;
    // the API wants MM/DD/YYYY; ISO answers 400 HBIllegalParamError
    expect(url).toMatch(/page=2&perPage=10&sort_by=due_date&sort_desc=false&curr_date=\d{2}%2F\d{2}%2F\d{4}$/);
  });

  it('today() is the LOCAL date, not the UTC one', () => {
    // 23:30 local on the 2nd; in any zone west of UTC the UTC date is already the 3rd
    const late = new Date(2026, 8, 2, 23, 30);
    expect(today(late)).toBe('2026-09-02');
    expect(today(new Date(2026, 0, 5, 0, 10))).toBe('2026-01-05');
  });

  it('toApiDate converts ISO to the MM/DD/YYYY the tasks API accepts and rejects anything else', () => {
    expect(toApiDate('2026-09-02')).toBe('09/02/2026');
    expect(() => toApiDate('09/02/2026')).toThrow(/YYYY-MM-DD/);
  });

  it('listNotes reads /notes/workspace/{id}', async () => {
    fakeClient.request.mockResolvedValueOnce([{ _id: 'n1', title: 'Walkthrough notes' }]);
    const out = parse(await listNotes({ workspace_id: WORKSPACE_ID }));
    expect(fakeClient.request).toHaveBeenCalledWith('GET', `/api/v2/notes/workspace/${WORKSPACE_ID}`);
    expect(out.notes).toEqual([{ _id: 'n1', title: 'Walkthrough notes' }]);
  });

  it('listAttachments reads /workspaces/{id}/attachments and flattens the three buckets', async () => {
    fakeClient.request.mockResolvedValueOnce({
      attachments: { images: [{ _id: 'i1' }], files: [{ _id: 'f1', name: 'timeline.pdf' }], bookmarks: [] },
    });
    const out = parse(await listAttachments({ workspace_id: WORKSPACE_ID }));
    expect(fakeClient.request).toHaveBeenCalledWith('GET', `/api/v2/workspaces/${WORKSPACE_ID}/attachments`);
    expect(out).toEqual({
      workspace_id: WORKSPACE_ID,
      images: [{ _id: 'i1' }],
      files: [{ _id: 'f1', name: 'timeline.pdf' }],
      bookmarks: [],
    });
  });

  it('listPayments reads /workspaces/{id}/payments and returns one row per payment', async () => {
    fakeClient.request.mockResolvedValueOnce({
      _id: WORKSPACE_ID,
      workspace_files: [
        { _id: 'brochure', file_title: 'Brochure', file_type: 'brochure', status: 'proposal_seen', payments_container: null, currency: 'USD', has_pending_payment: false },
        {
          _id: 'proposal',
          file_title: 'Wedding Proposal',
          file_type: 'proposal',
          status: 'payment_done',
          currency: 'USD',
          has_pending_payment: false,
          payments_container: {
            unpaid_payments_left: 0,
            payments: [
              {
                _id: 'p1',
                due_date: '2026-04-25',
                amount: 1350,
                grand_total: 1350,
                tip_paid: 0,
                is_paid: true,
                is_pending: null,
                charge_date: '2026-04-24T04:00:00.000+00:00',
                charge_description: 'ZELLE',
                count_description: '1 of 1 payments / Retainer',
                invoice: '72933-003067',
                payment_method_id: 'pm1',
                payout_arr: [{ noisy: true }],
              },
            ],
          },
        },
      ],
    });
    const out = parse(await listPayments({ workspace_id: WORKSPACE_ID }));
    expect(fakeClient.request).toHaveBeenCalledWith('GET', `/api/v2/workspaces/${WORKSPACE_ID}/payments`);
    expect(out.files).toEqual([
      { file_id: 'brochure', file_title: 'Brochure', file_type: 'brochure', status: 'proposal_seen', currency: 'USD', has_pending_payment: false, unpaid_payments_left: null, payments: [] },
      {
        file_id: 'proposal',
        file_title: 'Wedding Proposal',
        file_type: 'proposal',
        status: 'payment_done',
        currency: 'USD',
        has_pending_payment: false,
        unpaid_payments_left: 0,
        payments: [
          {
            _id: 'p1',
            description: '1 of 1 payments / Retainer',
            amount: 1350,
            grand_total: 1350,
            tip_paid: 0,
            due_date: '2026-04-25',
            is_paid: true,
            is_pending: null,
            charge_date: '2026-04-24T04:00:00.000+00:00',
            charge_description: 'ZELLE',
            invoice: '72933-003067',
          },
        ],
      },
    ]);
    expect(out.totals).toEqual({ USD: { paid: 1350, unpaid: 0 } });
  });

  it('listPayments keeps totals per currency when files disagree', async () => {
    fakeClient.request.mockResolvedValueOnce({
      workspace_files: [
        { _id: 'a', currency: 'USD', payments_container: { payments: [{ _id: 'p1', amount: 100, is_paid: true }] } },
        { _id: 'b', currency: 'EUR', payments_container: { payments: [{ _id: 'p2', amount: 40, is_paid: false }] } },
      ],
    });
    const out = parse(await listPayments({ workspace_id: WORKSPACE_ID }));
    expect(out.totals).toEqual({ USD: { paid: 100, unpaid: 0 }, EUR: { paid: 0, unpaid: 40 } });
  });

  it('listMeetings derives meetings from the feed, keeping the latest version of each calendar item', async () => {
    fakeClient.request.mockResolvedValueOnce(makeFeed());
    const out = parse(await listMeetings({ workspace_id: WORKSPACE_ID }));
    expect(fakeClient.request).toHaveBeenCalledWith('GET', `/api/v2/workspaces/${WORKSPACE_ID}/feed`);
    expect(out.meetings).toEqual([
      {
        _id: 'cal00000000000000000001',
        title: 'CHRIS AND MEREDITH ZOOM (moved)',
        type: 'video_call',
        start: '2026-10-12T22:00:00.000+00:00',
        end: '2026-10-12T23:00:00.000+00:00',
        timezone: 'EDT',
        all_day: false,
        location: undefined,
        description: undefined,
        phone_call_number: undefined,
        video_conference_type: 'zoom',
        video_meeting_link: 'https://zoom.example/j/1?pwd=abc',
        video_meeting_password: '974761',
        last_action: 'meeting_updated',
        last_action_at: '2026-08-30T16:00:00.000+00:00',
      },
    ]);
    expect(JSON.stringify(out)).not.toContain('HOST_SECRET');
  });
});
