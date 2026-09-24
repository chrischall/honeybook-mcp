// Drives the confirm-token flow the way a client that cannot show an MCP
// elicitation prompt does (a harness created WITHOUT an elicitation handler):
// phase 1 returns a preview and a confirmToken, phase 2 repeats the call with it.
import { afterEach, beforeEach } from 'vitest';
import type { CallToolResult } from '@modelcontextprotocol/server';
import type { TestHarness } from '@chrischall/mcp-utils/test';

export function bodyOf(result: CallToolResult): any {
  const block = result.content[0] as { type: string; text?: string };
  return JSON.parse(block.text as string);
}

export function textOf(result: CallToolResult): string {
  return (result.content[0] as { text?: string }).text ?? '';
}

/** Phase 1 (preview + token), then phase 2 with that token. */
export async function callConfirmed(
  harness: TestHarness,
  name: string,
  args: Record<string, unknown>
): Promise<{ preview: any; result: CallToolResult }> {
  const phase1 = await harness.callTool(name, args);
  const preview = bodyOf(phase1);
  if (preview.status !== 'confirmation-required') {
    throw new Error(`expected confirmation-required from ${name}, got: ${textOf(phase1)}`);
  }
  const result = await harness.callTool(name, { ...args, confirmToken: preview.confirmToken });
  return { preview, result };
}

/** Snapshot and restore the MCP_CONFIRM_* env vars around each test. */
export function restoreConfirmEnv(): void {
  const KEYS = ['MCP_CONFIRM_MODE', 'MCP_CONFIRM_TTL_SECONDS', 'MCP_CONFIRM_SECRET'] as const;
  let saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
    for (const k of KEYS) delete process.env[k];
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });
}
