import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import * as clientModule from '../src/client.js';
import { signContract } from '../src/tools/contracts.js';

describe('signContract', () => {
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

  it('returns a preview (not the deep-link yet) when confirm is missing', async () => {
    fakeClient.request.mockResolvedValueOnce({
      _id: 'file123',
      file_title: 'Wedding Contract',
      file_type: 'agreement',
      is_file_accepted: false,
      workspace: { _id: 'ws1' },
    });
    const result = await signContract({ file_id: 'file123' });
    expect(fakeClient.request).toHaveBeenCalledWith('GET', '/api/v2/workspace_files/file123');
    const text = result.content[0].text;
    expect(text).toContain('Wedding Contract');
    expect(text).toMatch(/confirm.*true/);
  });

  it('returns a deep link when confirm is true', async () => {
    fakeClient.request.mockResolvedValueOnce({
      _id: 'file123',
      file_title: 'Wedding Contract',
      file_type: 'agreement',
      is_file_accepted: false,
      workspace: { _id: 'ws1' },
    });
    const result = await signContract({ file_id: 'file123', confirm: true });
    const text = result.content[0].text;
    expect(text).toContain('https://thesilkveileventsbyivy.hbportal.co/app/workspace_file/file123/agreement');
  });

  it('refuses to sign a non-agreement file', async () => {
    fakeClient.request.mockResolvedValueOnce({
      _id: 'file456',
      file_title: 'Brochure',
      file_type: 'brochure',
    });
    await expect(signContract({ file_id: 'file456', confirm: true })).rejects.toThrow(
      /not an agreement/
    );
  });

  it('refuses to re-sign an already-accepted contract', async () => {
    fakeClient.request.mockResolvedValueOnce({
      _id: 'file123',
      file_type: 'agreement',
      is_file_accepted: true,
    });
    await expect(signContract({ file_id: 'file123', confirm: true })).rejects.toThrow(
      /already signed/
    );
  });
});
