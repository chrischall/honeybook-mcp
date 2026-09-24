import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import * as clientModule from '../src/client.js';
import { listPaymentMethods } from '../src/tools/payment_methods.js';

describe('listPaymentMethods', () => {
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

  it('hits /users/{uid}/payment_methods and returns the array', async () => {
    fakeClient.request.mockResolvedValueOnce([
      { _id: 'pm1', type: 'credit_card', last4: '4242' },
    ]);
    const result = await listPaymentMethods({});
    expect(fakeClient.request).toHaveBeenCalledWith('GET', '/api/v2/users/uid_24/payment_methods');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].last4).toBe('4242');
  });

  it('returns an empty array when no payment methods are saved', async () => {
    fakeClient.request.mockResolvedValueOnce([]);
    const result = await listPaymentMethods({});
    expect(JSON.parse(result.content[0].text)).toEqual([]);
  });

  // A saved card as HoneyBook returns it carries far more than "which card is
  // on file": billing name/address and Stripe customer/payment-method refs.
  // All values below are synthetic.
  const rawCard = {
    _id: 'pm1',
    type: 'credit_card',
    brand: 'visa',
    last4: '4242',
    exp_month: 12,
    exp_year: 2030,
    is_default: true,
    billing_name: 'Test Person',
    billing_address: { line1: '1 Example St', city: 'Exampletown', postal_code: '00000' },
    stripe_customer_id: 'cus_TEST',
    stripe_payment_method_id: 'pm_TEST',
    stripe_account_id: 'acct_TEST',
  };

  it('projects each method to the card-on-file fields by default', async () => {
    fakeClient.request.mockResolvedValueOnce([rawCard]);
    const result = await listPaymentMethods({});
    const text = result.content[0].text;
    expect(JSON.parse(text)).toEqual([
      {
        _id: 'pm1',
        type: 'credit_card',
        brand: 'visa',
        last4: '4242',
        exp_month: 12,
        exp_year: 2030,
        is_default: true,
      },
    ]);
    for (const leaked of ['Test Person', 'Example St', 'cus_TEST', 'pm_TEST', 'acct_TEST']) {
      expect(text).not.toContain(leaked);
    }
  });

  it('omits projected fields the record does not carry', async () => {
    fakeClient.request.mockResolvedValueOnce([{ _id: 'pm2', type: 'bank_account', last4: '6789' }]);
    const result = await listPaymentMethods({});
    expect(JSON.parse(result.content[0].text)).toEqual([
      { _id: 'pm2', type: 'bank_account', last4: '6789' },
    ]);
  });

  it('returns the untrimmed records only with view="raw"', async () => {
    fakeClient.request.mockResolvedValueOnce([rawCard]);
    const result = await listPaymentMethods({ view: 'raw' });
    expect(result.content[0].text).toContain('cus_TEST');
  });

  it('falls back to the projected view for an unknown view value', async () => {
    fakeClient.request.mockResolvedValueOnce([rawCard]);
    const result = await listPaymentMethods({ view: 'bogus' });
    expect(result.content[0].text).not.toContain('cus_TEST');
  });
});
