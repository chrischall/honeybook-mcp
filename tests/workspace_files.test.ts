import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import * as clientModule from '../src/client.js';
import {
  listWorkspaceFiles,
  getWorkspaceFile,
  pruneWorkspaceFile,
} from '../src/tools/workspace_files.js';

const MOCK_FILE = {
  _id: '69db9c003d1e6f0030c46242',
  status: 1,
  status_cd: 'sent',
  status_name: 'Sent',
  created_at: '2026-04-12T13:19:52.838Z',
  file_title: 'Wedding Brochure',
  file_type: 'brochure',
  file_type_cd: 1,
  is_file_accepted: false,
  is_booked_version: true,
  has_pending_payment: false,
  is_canceled: false,
  event: { _id: 'event_id' },
  owner: { _id: 'owner_id', first_name: 'Ivy', last_name: 'Smith' },
  workspace: { _id: 'workspace_id', workspace_status_cd: 'lead' },
};

describe('workspace_files tools', () => {
  let fakeClient: {
    request: ReturnType<typeof vi.fn>;
    scope: { portalOrigin: string; companyName: string; userId: string };
  };

  beforeEach(() => {
    fakeClient = {
      request: vi.fn(),
      scope: {
        portalOrigin: 'https://thesilkveileventsbyivy.hbportal.co',
        companyName: 'The Silk Veil Events by Ivy',
        userId: 'uid_24',
      },
    };
    vi.spyOn(clientModule, 'getActiveClient').mockResolvedValue(
      fakeClient as unknown as clientModule.HoneyBookClient
    );
  });

  afterEach(() => vi.restoreAllMocks());

  it('listWorkspaceFiles: hits /users/{uid}/workspace_files and returns the data array', async () => {
    fakeClient.request.mockResolvedValueOnce({
      data: [MOCK_FILE],
      cur_page: null,
      last_page: true,
    });
    const result = await listWorkspaceFiles({});
    expect(fakeClient.request).toHaveBeenCalledWith('GET', '/api/v2/users/uid_24/workspace_files');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].file_type).toBe('brochure');
  });

  it('listWorkspaceFiles: filters by file_type', async () => {
    fakeClient.request.mockResolvedValueOnce({
      data: [
        { ...MOCK_FILE, file_type: 'brochure' },
        { ...MOCK_FILE, _id: 'other_id', file_type: 'agreement' },
      ],
      cur_page: null,
      last_page: true,
    });
    const result = await listWorkspaceFiles({ file_type: 'agreement' });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]._id).toBe('other_id');
  });

  it('listWorkspaceFiles: passes origin through to getActiveClient', async () => {
    fakeClient.request.mockResolvedValueOnce({ data: [], cur_page: null, last_page: true });
    await listWorkspaceFiles({ origin: 'https://photog.hbportal.co' });
    expect(clientModule.getActiveClient).toHaveBeenCalledWith('https://photog.hbportal.co');
  });

  it('listWorkspaceFiles: prepends a pagination notice when last_page is false', async () => {
    fakeClient.request.mockResolvedValueOnce({
      data: [MOCK_FILE],
      cur_page: 1,
      last_page: false,
    });
    const result = await listWorkspaceFiles({});
    expect(result.content[0].text).toMatch(/more results exist/);
  });

  it('getWorkspaceFile: hits /workspace_files/{id}', async () => {
    fakeClient.request.mockResolvedValueOnce(MOCK_FILE);
    const result = await getWorkspaceFile({ file_id: '69db9c003d1e6f0030c46242' });
    expect(fakeClient.request).toHaveBeenCalledWith('GET', '/api/v2/workspace_files/69db9c003d1e6f0030c46242');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed._id).toBe('69db9c003d1e6f0030c46242');
  });

  it('getWorkspaceFile: strips heavy company.* fields by default', async () => {
    fakeClient.request.mockResolvedValueOnce({
      ...MOCK_FILE,
      file_title: 'Proposal',
      company: {
        company_name: 'Acme Weddings',
        vendor_emails: new Array(100).fill({ subject: 'template', body: 'x'.repeat(5000) }),
        brochure_templates: [{ html: 'x'.repeat(10000) }],
        workflow_automation_infos: [{ a: 1 }],
        questionnaires: [{ q: 1 }],
        agreements: [{ a: 1 }],
        vendor_packages: [{ p: 1 }],
      },
    });
    const result = await getWorkspaceFile({ file_id: 'f1' });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.company.company_name).toBe('Acme Weddings');
    expect(parsed.company.vendor_emails).toBeUndefined();
    expect(parsed.company.brochure_templates).toBeUndefined();
    expect(parsed.company.workflow_automation_infos).toBeUndefined();
    expect(parsed.company.questionnaires).toBeUndefined();
    expect(parsed.company.agreements).toBeUndefined();
    expect(parsed.company.vendor_packages).toBeUndefined();
  });

  it('getWorkspaceFile: keeps heavy fields when include_raw=true', async () => {
    fakeClient.request.mockResolvedValueOnce({
      ...MOCK_FILE,
      company: { company_name: 'Acme', vendor_emails: [{ a: 1 }] },
    });
    const result = await getWorkspaceFile({ file_id: 'f1', include_raw: true });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.company.vendor_emails).toEqual([{ a: 1 }]);
  });

  it('pruneWorkspaceFile: no-op when company is missing', () => {
    expect(pruneWorkspaceFile({ _id: 'x' })).toEqual({ _id: 'x' });
  });

  it('pruneWorkspaceFile: does not mutate the input', () => {
    const original = {
      _id: 'x',
      company: { company_name: 'Acme', vendor_emails: [{ a: 1 }] },
    };
    const snapshot = JSON.parse(JSON.stringify(original));
    pruneWorkspaceFile(original);
    expect(original).toEqual(snapshot);
  });
});
