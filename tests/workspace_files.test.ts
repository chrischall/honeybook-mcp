import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import * as clientModule from '../src/client.js';
import {
  listWorkspaceFiles,
  getWorkspaceFile,
  pruneWorkspaceFile,
  buildSummary,
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

const MOCK_PROPOSAL = {
  _id: 'file_proposal',
  file_title: 'Wedding Proposal',
  file_type: 'proposal',
  status: 1,
  status_name: 'Proposal Sent',
  status_type: 'sent',
  sent_on: '2026-04-21T11:51:02.816Z',
  created_at: '2026-04-21T10:00:00Z',
  is_file_accepted: false,
  is_booked_version: false,
  has_pending_payment: false,
  currency: 'USD',
  workspace: { _id: 'ws1' },
  workspace_name: 'Meredith + Chris',
  event: { _id: 'ev1', event_date: '2026-10-17' },
  owner: {
    _id: 'owner1',
    first_name: 'Ivy',
    last_name: 'Honeycutt',
    email: 'ivy@example.com',
    phone_number: '555-555-0000',
  },
  company: {
    company_name: 'The Silk Veil Events by Ivy',
    vendor_emails: [{ body: 'x'.repeat(10000) }],
  },
  vendor_proposal: {
    sub_total: 1150,
    total_price: 1035,
    discount: 10,
    discount_type: 'relative',
    tax: 7.25,
    tax_type: 'relative',
    svc: 18,
    svc_type: 'relative',
    total_tax: 78.2,
    total_svc: 186,
    vendor_packages: [
      {
        title: '2026 Day of Coordination',
        description: 'Day of Coordination service description',
        total_price: 900,
        quantity: 1,
      },
    ],
    service_items: [],
  },
  payments_container: {
    payments: [
      { _id: 'p1', due_date: '2026-04-21', amount: 258.75, count_description: '1 of 6', invoice: 'inv-1', is_paid: false, is_pending: false },
      { _id: 'p2', due_date: '2026-05-15', amount: 155.25, count_description: '2 of 6', invoice: 'inv-2', is_paid: true, is_pending: false },
      { _id: 'p3', due_date: '2026-06-15', amount: 155.25, count_description: '3 of 6', invoice: 'inv-3', is_paid: false, is_pending: false },
    ],
  },
  agreement: {
    html_body: '<p>Contract text</p>',
    contract_signatures: [
      { signer_email: 'ivy@example.com', signed_at: '2026-04-21T12:00:00Z', is_vendor: true },
    ],
  },
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
    await getWorkspaceFile({ file_id: '69db9c003d1e6f0030c46242' });
    expect(fakeClient.request).toHaveBeenCalledWith(
      'GET',
      '/api/v2/workspace_files/69db9c003d1e6f0030c46242'
    );
  });

  it('getWorkspaceFile: default section is "summary" with compact shape', async () => {
    fakeClient.request.mockResolvedValueOnce(MOCK_PROPOSAL);
    const result = await getWorkspaceFile({ file_id: 'file_proposal' });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.file_title).toBe('Wedding Proposal');
    expect(parsed.vendor.company_name).toBe('The Silk Veil Events by Ivy');
    expect(parsed.vendor.owner_name).toBe('Ivy Honeycutt');
    expect(parsed.event.date).toBe('2026-10-17');
    expect(parsed.pricing.sub_total).toBe(1150);
    expect(parsed.pricing.total_price).toBe(1035);
    expect(parsed.pricing.packages).toHaveLength(1);
    expect(parsed.pricing.packages[0].title).toBe('2026 Day of Coordination');
    expect(parsed.payments.total).toBeCloseTo(569.25);
    expect(parsed.payments.paid).toBe(155.25);
    expect(parsed.payments.remaining).toBeCloseTo(414);
    expect(parsed.payments.count).toBe(3);
    expect(parsed.agreement.present).toBe(true);
    expect(parsed.agreement.html_length).toBe(20);
    // vendor_emails should be gone (summary skips the raw blob entirely)
    expect(JSON.stringify(parsed)).not.toContain('vendor_emails');
    // summary response stays tiny
    expect(result.content[0].text.length).toBeLessThan(5000);
  });

  it('getWorkspaceFile: section="pricing" returns vendor_proposal', async () => {
    fakeClient.request.mockResolvedValueOnce(MOCK_PROPOSAL);
    const result = await getWorkspaceFile({ file_id: 'f1', section: 'pricing' });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.vendor_proposal.sub_total).toBe(1150);
    expect(parsed.currency).toBe('USD');
    expect(parsed.agreement).toBeUndefined();
    expect(parsed.payments_container).toBeUndefined();
  });

  it('getWorkspaceFile: section="agreement" returns agreement only', async () => {
    fakeClient.request.mockResolvedValueOnce(MOCK_PROPOSAL);
    const result = await getWorkspaceFile({ file_id: 'f1', section: 'agreement' });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.agreement.html_body).toBe('<p>Contract text</p>');
    expect(parsed.vendor_proposal).toBeUndefined();
    expect(parsed.payments_container).toBeUndefined();
  });

  it('getWorkspaceFile: section="payments" returns payments_container only', async () => {
    fakeClient.request.mockResolvedValueOnce(MOCK_PROPOSAL);
    const result = await getWorkspaceFile({ file_id: 'f1', section: 'payments' });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.payments_container.payments).toHaveLength(3);
    expect(parsed.agreement).toBeUndefined();
    expect(parsed.vendor_proposal).toBeUndefined();
  });

  it('getWorkspaceFile: section="all" strips heavy company.* fields', async () => {
    fakeClient.request.mockResolvedValueOnce(MOCK_PROPOSAL);
    const result = await getWorkspaceFile({ file_id: 'f1', section: 'all' });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.company.company_name).toBe('The Silk Veil Events by Ivy');
    expect(parsed.company.vendor_emails).toBeUndefined();
    expect(parsed.vendor_proposal).toBeDefined();
    expect(parsed.agreement).toBeDefined();
  });

  it('getWorkspaceFile: section="raw" keeps everything including vendor_emails', async () => {
    fakeClient.request.mockResolvedValueOnce(MOCK_PROPOSAL);
    const result = await getWorkspaceFile({ file_id: 'f1', section: 'raw' });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.company.vendor_emails).toBeDefined();
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

  it('buildSummary: handles a brochure (no pricing, no agreement)', () => {
    const summary = buildSummary(MOCK_FILE);
    expect(summary.file_title).toBe('Wedding Brochure');
    expect((summary.pricing as Record<string, unknown>).packages).toEqual([]);
    expect((summary.agreement as Record<string, unknown>).present).toBe(false);
    expect((summary.payments as Record<string, unknown>).count).toBe(0);
  });
});
