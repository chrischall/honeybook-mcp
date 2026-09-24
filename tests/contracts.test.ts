import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { createTestHarness, type TestHarness } from '@chrischall/mcp-utils/test';
import * as clientModule from '../src/client.js';
import { registerContractTools } from '../src/tools/contracts.js';
import { bodyOf, callConfirmed, restoreConfirmEnv, textOf } from './confirm-helpers.js';

const CONTRACT = {
  _id: 'file123',
  file_title: 'Wedding Contract',
  file_type: 'agreement',
  is_file_accepted: false,
  workspace: { _id: 'ws1' },
};
const DEEP_LINK = 'https://thesilkveileventsbyivy.hbportal.co/app/workspace_file/file123/agreement';

describe('sign_contract', () => {
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
    harness = await createTestHarness((server) => registerContractTools(server));
  });

  afterEach(async () => {
    await harness.close();
    vi.restoreAllMocks();
  });

  it('advertises confirmToken and no confirm parameter', async () => {
    const { tools } = await harness.client.listTools();
    const tool = tools.find((t) => t.name === 'sign_contract')!;
    const props = Object.keys((tool.inputSchema as { properties: object }).properties);
    expect(props).toContain('confirmToken');
    expect(props).not.toContain('confirm');
  });

  it('phase 1 returns a preview and a token, not the deep link', async () => {
    fakeClient.request.mockResolvedValue(CONTRACT);
    const result = await harness.callTool('sign_contract', { file_id: 'file123' });
    expect(fakeClient.request).toHaveBeenCalledWith('GET', '/api/v2/workspace_files/file123');
    const out = bodyOf(result);
    expect(out.status).toBe('confirmation-required');
    expect(out.dispatched).toBe(false);
    expect(out.confirmToken).toEqual(expect.any(String));
    expect(out.preview).toMatchObject({
      file_id: 'file123',
      file_title: 'Wedding Contract',
      status: 'not signed',
    });
    expect(textOf(result)).not.toContain(DEEP_LINK);
  });

  it('phase 2 with the token returns the deep link exactly once', async () => {
    fakeClient.request.mockResolvedValue(CONTRACT);
    const { result } = await callConfirmed(harness, 'sign_contract', { file_id: 'file123' });
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toContain(DEEP_LINK);
  });

  it('refuses a replayed token with TOKEN_REUSED', async () => {
    fakeClient.request.mockResolvedValue(CONTRACT);
    const { preview } = await callConfirmed(harness, 'sign_contract', { file_id: 'file123' });
    const replay = await harness.callTool('sign_contract', {
      file_id: 'file123',
      confirmToken: preview.confirmToken,
    });
    expect(replay.isError).toBe(true);
    expect(bodyOf(replay).error).toBe('TOKEN_REUSED');
    expect(textOf(replay)).not.toContain(DEEP_LINK);
  });

  it('refuses to sign a non-agreement file', async () => {
    fakeClient.request.mockResolvedValue({ _id: 'file456', file_title: 'Brochure', file_type: 'brochure' });
    const result = await harness.callTool('sign_contract', { file_id: 'file456' });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/not an agreement/);
  });

  it('refuses to re-sign an already-accepted contract, even with a token', async () => {
    fakeClient.request.mockResolvedValueOnce(CONTRACT);
    const phase1 = bodyOf(await harness.callTool('sign_contract', { file_id: 'file123' }));
    fakeClient.request.mockResolvedValueOnce({ ...CONTRACT, is_file_accepted: true });
    const result = await harness.callTool('sign_contract', {
      file_id: 'file123',
      confirmToken: phase1.confirmToken,
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/already signed/);
  });
});
