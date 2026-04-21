import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import * as clientModule from '../src/client.js';
import { getWorkspace } from '../src/tools/workspaces.js';

describe('getWorkspace', () => {
  let fakeClient: { request: ReturnType<typeof vi.fn>; scope: { slug: string; userId: string } };

  beforeEach(() => {
    fakeClient = { request: vi.fn(), scope: { slug: 'silk_veil', userId: 'uid_24' } };
    vi.spyOn(clientModule, 'getClientFor').mockResolvedValue(
      fakeClient as unknown as clientModule.HoneyBookClient
    );
  });

  afterEach(() => vi.restoreAllMocks());

  it('hits /workspaces/{id} and returns the workspace', async () => {
    fakeClient.request.mockResolvedValueOnce({
      _id: 'workspace_id',
      workspace_status_cd: 'lead',
      has_sent_files: true,
      has_signed_files: false,
      has_paid_payments: false,
    });
    const result = await getWorkspace({ workspace_id: 'workspace_id' });
    expect(fakeClient.request).toHaveBeenCalledWith('GET', '/api/v2/workspaces/workspace_id');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.workspace_status_cd).toBe('lead');
    expect(parsed.has_sent_files).toBe(true);
  });
});
