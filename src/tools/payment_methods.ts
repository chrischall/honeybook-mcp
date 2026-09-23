import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { minifiedResult, schemaOrigin } from '@chrischall/mcp-utils';
import { apiPath, getActiveClient } from '../client.js';
import type { ToolResult } from '../types.js';

export async function listPaymentMethods(args: { origin?: string }): Promise<ToolResult> {
  const client = await getActiveClient(args.origin);
  const res = await client.request<Array<Record<string, unknown>>>(
    'GET',
    apiPath`/api/v2/users/${client.scope.userId}/payment_methods`
  );
  return minifiedResult(res);
}

export function registerPaymentMethodTools(server: McpServer): void {
  server.registerTool(
    'list_payment_methods',
    {
      description:
        'List saved payment methods for your client account with a vendor. Empty array if none are saved.',
      inputSchema: z.object({
        origin: schemaOrigin.describe(
          'Portal origin (e.g. https://<vendor>.hbportal.co). Optional when only one session is active.'
        ),
      }),
      annotations: { readOnlyHint: true },
    },
    listPaymentMethods
  );
}
