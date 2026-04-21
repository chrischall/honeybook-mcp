import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getActiveClient } from '../client.js';
import type { ToolResult } from '../types.js';

export async function listPaymentMethods(args: { origin?: string }): Promise<ToolResult> {
  const client = await getActiveClient(args.origin);
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
        origin: z
          .string()
          .optional()
          .describe(
            'Portal origin (e.g. https://<vendor>.hbportal.co). Optional when only one session is active.'
          ),
      },
      annotations: { readOnlyHint: true },
    },
    listPaymentMethods
  );
}
