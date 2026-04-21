import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { listConfiguredVendors } from '../client.js';
import type { ToolResult } from '../types.js';

export async function listVendors(): Promise<ToolResult> {
  return {
    content: [{ type: 'text', text: JSON.stringify(listConfiguredVendors(), null, 2) }],
  };
}

export function registerVendorTools(server: McpServer): void {
  server.registerTool(
    'list_vendors',
    {
      description: 'List the HoneyBook vendors connected to this MCP (from .env). No API call.',
      annotations: { readOnlyHint: true },
    },
    listVendors
  );
}
