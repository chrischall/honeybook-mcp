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
});
