import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withCallSignal } from '@chrischall/mcp-utils';
import {
  HoneyBookClient,
  fetchApiVersion,
  getActiveClient,
  httpTimeouts,
  resetClientsForTest,
} from '../src/client.js';
import { fetchFlowMinimal } from '../src/flow-client.js';
import { runClientPendingTask, pendingTaskPolling } from '../src/pending-tasks.js';
import { sessionStore } from '../src/sessions.js';
import type { CapturedSession } from '../src/types.js';

// fleet-audit#137: no HoneyBook fetch had a timeout or honoured the tool
// call's cancellation, so a stalled connection hung the call — and a hung
// /api/gon hung every later call behind the memoized version promise.

const SESSION: CapturedSession = {
  portalOrigin: 'https://acme.hbportal.co',
  companyName: 'Acme',
  authToken: 't',
  userId: 'u',
  capturedAt: 0,
};

/** A fetch that never answers, and rejects only when its signal aborts. */
function hangingFetch() {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(
    (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = (init as RequestInit | undefined)?.signal;
        if (!signal) return; // hangs forever — the bug
        if (signal.aborted) return reject(signal.reason);
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      })
  );
}

describe('HoneyBook request timeouts and cancellation', () => {
  const original = { ...httpTimeouts };

  beforeEach(() => {
    httpTimeouts.requestMs = 30;
    delete process.env.HONEYBOOK_API_VERSION;
  });
  afterEach(() => {
    Object.assign(httpTimeouts, original);
    vi.restoreAllMocks();
    resetClientsForTest();
  });

  it('an API request that never answers fails with a timeout error', async () => {
    hangingFetch();
    const client = new HoneyBookClient(SESSION, 1);
    await expect(client.request('GET', '/api/v2/users/u')).rejects.toThrow(/did not respond within/i);
  });

  it("an API request is aborted when the tool call's caller cancels", async () => {
    httpTimeouts.requestMs = 60_000;
    const fetchSpy = hangingFetch();
    const controller = new AbortController();
    const client = new HoneyBookClient(SESSION, 1);
    const p = withCallSignal(controller.signal, () => client.request('GET', '/api/v2/users/u'));
    controller.abort(new Error('caller went away'));
    await expect(p).rejects.toThrow(/caller went away/);
    const signal = (fetchSpy.mock.calls[0]![1] as RequestInit).signal!;
    expect(signal.aborted).toBe(true);
  });

  it('a hung /api/gon times out, and the memo clears so the next call retries', async () => {
    sessionStore.resetForTest();
    sessionStore.add(SESSION);
    const fetchSpy = hangingFetch();
    await expect(fetchApiVersion()).rejects.toThrow(/did not respond within/i);
    await expect(getActiveClient()).rejects.toThrow(/did not respond within/i);
    fetchSpy.mockResolvedValueOnce(new Response('parseGon({"api_version":42})', { status: 200 }));
    const client = await getActiveClient();
    expect(client.getApiVersion()).toBe(42);
    sessionStore.resetForTest();
  });

  it('the public flow /minimal read times out too', async () => {
    hangingFetch();
    await expect(fetchFlowMinimal('flow1', { apiVersion: 1 })).rejects.toThrow(/did not respond within/i);
  });

  it('the pending-task poll loop stops as soon as the caller cancels', async () => {
    pendingTaskPolling.intervalMs = 0;
    pendingTaskPolling.maxPolls = 50;
    try {
      const controller = new AbortController();
      const request = vi.fn(async (method: string) => {
        if (method === 'POST') return { task_id: 't' };
        controller.abort(new Error('caller went away'));
        return [{ _id: 't', pending_task_state_cd: 1 }];
      });
      await expect(
        withCallSignal(controller.signal, () => runClientPendingTask({ request } as never, 'x', {}))
      ).rejects.toThrow(/caller went away/);
      expect(request).toHaveBeenCalledTimes(2);
    } finally {
      pendingTaskPolling.intervalMs = 1000;
      pendingTaskPolling.maxPolls = 60;
    }
  });
});
