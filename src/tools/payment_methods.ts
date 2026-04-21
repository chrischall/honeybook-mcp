import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getClientFor } from '../client.js';
import type { ToolResult } from '../types.js';

export async function listPaymentMethods(args: { vendor?: string }): Promise<ToolResult> {
  const client = await getClientFor(args.vendor);
  const res = await client.request<Array<Record<string, unknown>>>(
    'GET',
    `/api/v2/users/${client.scope.userId}/payment_methods`
  );
  return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
}

export function registerPaymentMethodTools(server: McpServer): void {
  server.registerTool(
    'list_payment_methods',
    {
      description:
        'List saved payment methods for your client account with a vendor. Empty array if none are saved.',
      inputSchema: {
        vendor: z.string().optional().describe('Vendor slug.'),
      },
      annotations: { readOnlyHint: true },
    },
    listPaymentMethods
  );
}
