import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as clientModule from '../src/client.js';
import { apiPath, HoneyBookClient } from '../src/client.js';
import { markMessagesSeen, listMessages } from '../src/tools/messages.js';
import { listAttachments } from '../src/tools/attachments.js';
import { listNotes } from '../src/tools/notes.js';
import { listPayments } from '../src/tools/payments.js';
import { listTasks } from '../src/tools/tasks.js';
import { getWorkspace } from '../src/tools/workspaces.js';
import { getWorkspaceFile } from '../src/tools/workspace_files.js';
import { signContract } from '../src/tools/contracts.js';
import { payInvoice } from '../src/tools/invoices.js';
import { getProject } from '../src/tools/projects.js';
import { listMeetings } from '../src/tools/meetings.js';

// fleet-audit#138: model-supplied ids were interpolated raw into API paths, so
// `x/../../users/me/something?` walked the request onto an arbitrary
// api.honeybook.com endpoint under the user's token.
const EVIL = 'x/../../users/me/something?';
const EVIL_ENC = encodeURIComponent(EVIL);

describe('apiPath', () => {
  it('encodes every interpolated segment', () => {
    expect(apiPath`/api/v2/workspaces/${EVIL}/feed`).toBe(`/api/v2/workspaces/${EVIL_ENC}/feed`);
    expect(apiPath`/api/v2/workspaces/${'abc123'}/feed`).toBe('/api/v2/workspaces/abc123/feed');
  });

  it.each(['', '.', '..'])('refuses the dot/empty segment %j', (bad) => {
    expect(() => apiPath`/api/v2/workspaces/${bad}/feed`).toThrow(/not a valid HoneyBook id/);
  });
});

describe('hbApiRequest path guard', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([
    '/api/v2/workspaces/x/../../users/me',
    '/api/v2/workspaces/./feed',
    '/api/v2/workspaces/%2e%2e/users',
    '/api/v2/workspaces/x\\..\\..\\users',
  ])('refuses %j before any request is sent', async (path) => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const client = new HoneyBookClient(
      {
        portalOrigin: 'https://acme.hbportal.co',
        companyName: 'Acme',
        authToken: 't',
        userId: 'u',
        capturedAt: 0,
      },
      1
    );
    await expect(client.request('GET', path)).rejects.toThrow(/path traversal/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('tools encode ids into their request paths', () => {
  let request: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    request = vi.fn().mockResolvedValue(null);
    vi.spyOn(clientModule, 'getActiveClient').mockResolvedValue({
      request,
      scope: { portalOrigin: 'https://acme.hbportal.co', companyName: 'Acme', userId: 'me' },
    } as unknown as clientModule.HoneyBookClient);
  });
  afterEach(() => vi.restoreAllMocks());

  const cases: Array<[string, () => Promise<unknown>, string]> = [
    ['mark_messages_seen', () => markMessagesSeen({ workspace_id: EVIL, message_ids: ['m'] }), `/api/v2/workspaces/${EVIL_ENC}/feed_items/seen`],
    ['list_messages', () => listMessages({ workspace_id: EVIL }), `/api/v2/workspaces/${EVIL_ENC}/feed`],
    ['list_meetings', () => listMeetings({ workspace_id: EVIL }), `/api/v2/workspaces/${EVIL_ENC}/feed`],
    ['list_attachments', () => listAttachments({ workspace_id: EVIL }), `/api/v2/workspaces/${EVIL_ENC}/attachments`],
    ['list_notes', () => listNotes({ workspace_id: EVIL }), `/api/v2/notes/workspace/${EVIL_ENC}`],
    ['list_payments', () => listPayments({ workspace_id: EVIL }), `/api/v2/workspaces/${EVIL_ENC}/payments`],
    ['list_tasks', () => listTasks({ workspace_id: EVIL }), `/api/v2/tasks/workspaces/${EVIL_ENC}?`],
    ['get_workspace', () => getWorkspace({ workspace_id: EVIL }), `/api/v2/workspaces/${EVIL_ENC}`],
    ['get_workspace_file', () => getWorkspaceFile({ file_id: EVIL }), `/api/v2/workspace_files/${EVIL_ENC}`],
    ['sign_contract', () => signContract({ file_id: EVIL }), `/api/v2/workspace_files/${EVIL_ENC}`],
    ['pay_invoice', () => payInvoice({ file_id: EVIL }), `/api/v2/workspace_files/${EVIL_ENC}`],
    ['get_project', () => getProject({ project_id: EVIL }), `/api/v2/events/${EVIL_ENC}/details`],
  ];

  it.each(cases)('%s', async (_name, run, expectedPrefix) => {
    await run().catch(() => undefined);
    expect(request).toHaveBeenCalled();
    const path = request.mock.calls[0][1] as string;
    expect(path.startsWith(expectedPrefix)).toBe(true);
    expect(path).not.toContain('/../');
  });

  it('list_tasks encodes the id in every request it makes', async () => {
    await listTasks({ workspace_id: EVIL }).catch(() => undefined);
    for (const call of request.mock.calls) expect(call[1]).toContain(EVIL_ENC);
  });
});
