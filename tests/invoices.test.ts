import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import * as clientModule from '../src/client.js';
import { payInvoice } from '../src/tools/invoices.js';

describe('payInvoice', () => {
  let fakeClient: {
    request: ReturnType<typeof vi.fn>;
    scope: { slug: string; userId: string; label: string; portalOrigin: string };
  };

  beforeEach(() => {
    fakeClient = {
      request: vi.fn(),
      scope: {
        slug: 'silk_veil',
        userId: 'uid_24',
        label: 'Silk Veil Events',
        portalOrigin: 'https://thesilkveileventsbyivy.hbportal.co',
      },
    };
    vi.spyOn(clientModule, 'getClientFor').mockResolvedValue(
      fakeClient as unknown as clientModule.HoneyBookClient
    );
  });

  afterEach(() => vi.restoreAllMocks());

  it('returns a preview when confirm is missing', async () => {
    fakeClient.request.mockResolvedValueOnce({
      _id: 'inv1',
      file_title: 'Deposit Invoice',
      file_type: 'invoice',
      has_pending_payment: false,
    });
    const result = await payInvoice({ file_id: 'inv1' });
    expect(result.content[0].text).toMatch(/confirm.*true/);
  });

  it('returns a deep link when confirm is true', async () => {
    fakeClient.request.mockResolvedValueOnce({
      _id: 'inv1',
      file_title: 'Deposit Invoice',
      file_type: 'invoice',
      has_pending_payment: false,
    });
    const result = await payInvoice({ file_id: 'inv1', confirm: true });
    expect(result.content[0].text).toContain(
      'https://thesilkveileventsbyivy.hbportal.co/app/workspace_file/inv1/invoice'
    );
  });

  it('refuses when file is not an invoice', async () => {
    fakeClient.request.mockResolvedValueOnce({ _id: 'x', file_type: 'agreement' });
    await expect(payInvoice({ file_id: 'x', confirm: true })).rejects.toThrow(/not an invoice/);
  });

  it('warns when invoice has a pending payment (but still returns deep link)', async () => {
    fakeClient.request.mockResolvedValueOnce({
      _id: 'inv1',
      file_title: 'Deposit Invoice',
      file_type: 'invoice',
      has_pending_payment: true,
    });
    const result = await payInvoice({ file_id: 'inv1', confirm: true });
    expect(result.content[0].text).toMatch(/pending payment/);
  });
});
