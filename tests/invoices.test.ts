import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { createTestHarness, type TestHarness } from '@chrischall/mcp-utils/test';
import * as clientModule from '../src/client.js';
import { registerInvoiceTools } from '../src/tools/invoices.js';
import { bodyOf, callConfirmed, restoreConfirmEnv, textOf } from './confirm-helpers.js';

const INVOICE = {
  _id: 'inv1',
  file_title: 'Deposit Invoice',
  file_type: 'invoice',
  has_pending_payment: false,
};
const DEEP_LINK = 'https://thesilkveileventsbyivy.hbportal.co/app/workspace_file/inv1/invoice';

describe('pay_invoice', () => {
  let fakeClient: {
    request: ReturnType<typeof vi.fn>;
    scope: { portalOrigin: string; companyName: string; userId: string };
  };
  let harness: TestHarness;

  restoreConfirmEnv();

  beforeEach(async () => {
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
    harness = await createTestHarness((server) => registerInvoiceTools(server));
  });

  afterEach(async () => {
    await harness.close();
    vi.restoreAllMocks();
  });

  it('phase 1 returns a preview and a token, not the deep link', async () => {
    fakeClient.request.mockResolvedValue(INVOICE);
    const result = await harness.callTool('pay_invoice', { file_id: 'inv1' });
    const out = bodyOf(result);
    expect(out.status).toBe('confirmation-required');
    expect(out.confirmToken).toEqual(expect.any(String));
    expect(out.preview).toMatchObject({ file_id: 'inv1', file_title: 'Deposit Invoice', status: 'open' });
    expect(textOf(result)).not.toContain(DEEP_LINK);
  });

  it('phase 2 with the token returns the deep link', async () => {
    fakeClient.request.mockResolvedValue(INVOICE);
    const { result } = await callConfirmed(harness, 'pay_invoice', { file_id: 'inv1' });
    expect(textOf(result)).toContain(DEEP_LINK);
  });

  it('refuses when file is not an invoice', async () => {
    fakeClient.request.mockResolvedValue({ _id: 'x', file_type: 'agreement' });
    const result = await harness.callTool('pay_invoice', { file_id: 'x' });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/not an invoice/);
  });

  it('warns when invoice has a pending payment (but still returns deep link)', async () => {
    fakeClient.request.mockResolvedValue({ ...INVOICE, has_pending_payment: true });
    const { preview, result } = await callConfirmed(harness, 'pay_invoice', { file_id: 'inv1' });
    expect(preview.preview.has_pending_payment).toBe(true);
    expect(textOf(result)).toMatch(/pending payment/);
  });

  it('refuses a token when the invoice changed between the phases (DRAFT_CHANGED)', async () => {
    fakeClient.request.mockResolvedValueOnce(INVOICE);
    const phase1 = bodyOf(await harness.callTool('pay_invoice', { file_id: 'inv1' }));
    fakeClient.request.mockResolvedValueOnce({ ...INVOICE, file_title: 'Final Balance Invoice' });
    const result = await harness.callTool('pay_invoice', { file_id: 'inv1', confirmToken: phase1.confirmToken });
    expect(result.isError).toBe(true);
    expect(bodyOf(result).error).toBe('DRAFT_CHANGED');
    expect(textOf(result)).not.toContain(DEEP_LINK);
  });

  it('MCP_CONFIRM_MODE=refuse refuses without a deep link', async () => {
    process.env.MCP_CONFIRM_MODE = 'refuse';
    fakeClient.request.mockResolvedValue(INVOICE);
    const result = await harness.callTool('pay_invoice', { file_id: 'inv1' });
    expect(bodyOf(result)).toMatchObject({ reason: 'confirmation-unsupported', dispatched: false });
    expect(textOf(result)).not.toContain(DEEP_LINK);
  });

  it('a client that can be prompted gets the deep link on accept', async () => {
    fakeClient.request.mockResolvedValue(INVOICE);
    const h = await createTestHarness((server) => registerInvoiceTools(server), {
      elicitation: async () => ({ action: 'accept', content: { confirmed: true } }),
    });
    try {
      const result = await h.callTool('pay_invoice', { file_id: 'inv1' });
      expect(textOf(result)).toContain(DEEP_LINK);
    } finally {
      await h.close();
    }
  });

  it('a client that can be prompted gets no deep link on decline', async () => {
    fakeClient.request.mockResolvedValue(INVOICE);
    const h = await createTestHarness((server) => registerInvoiceTools(server), {
      elicitation: async () => ({ action: 'decline' }),
    });
    try {
      const result = await h.callTool('pay_invoice', { file_id: 'inv1' });
      expect(textOf(result)).not.toContain(DEEP_LINK);
    } finally {
      await h.close();
    }
  });
});
