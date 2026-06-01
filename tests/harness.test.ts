// Smoke-tests the full tool-registration path via the shared
// @chrischall/mcp-utils/test harness: registerSessionTools wires the tools onto
// a real McpServer, and we drive them through the MCP call path (schema
// validation + content envelopes + parseToolResult) rather than invoking the
// handler functions directly. This complements the per-handler unit tests by
// proving the registrar shape (names, input schemas, result envelopes) is
// wired up correctly end-to-end.
import { describe, it, expect, beforeEach } from 'vitest';
import { createTestHarness, parseToolResult } from '@chrischall/mcp-utils/test';
import { registerSessionTools } from '../src/tools/sessions.js';
import { sessionStore } from '../src/sessions.js';

describe('session tools via test harness', () => {
  beforeEach(() => sessionStore.resetForTest());

  it('registers the session tools and list_active_sessions returns an empty array when none are active', async () => {
    const harness = await createTestHarness((server) => registerSessionTools(server));
    try {
      const names = (await harness.listTools()).map((t) => t.name);
      expect(names).toContain('use_magic_link');
      expect(names).toContain('list_active_sessions');

      const result = await harness.callTool('list_active_sessions', {});
      expect(parseToolResult(result)).toEqual([]);
    } finally {
      await harness.close();
    }
  });
});
