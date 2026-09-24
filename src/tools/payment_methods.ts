import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { resolveView, schemaOrigin, viewParam, viewResult } from '@chrischall/mcp-utils';
import { apiPath, getActiveClient } from '../client.js';
import type { ToolResult } from '../types.js';

type Raw = Record<string, unknown>;

export const PAYMENT_METHOD_VIEWS = ['compact', 'raw'] as const;

/**
 * The fields that answer "which card/account is on file". HoneyBook's
 * payment-method records also carry the billing name and address and Stripe
 * customer / payment-method / connected-account references — none of which
 * that question needs, so they stay behind view="raw". A field the record
 * does not carry is omitted rather than emitted as null.
 */
const CARD_ON_FILE_FIELDS = ['_id', 'type', 'brand', 'last4', 'exp_month', 'exp_year', 'is_default'] as const;

function summarizePaymentMethod(pm: Raw): Raw {
  const out: Raw = {};
  for (const k of CARD_ON_FILE_FIELDS) {
    if (pm[k] !== undefined) out[k] = pm[k];
  }
  return out;
}

export async function listPaymentMethods(args: { view?: string; origin?: string }): Promise<ToolResult> {
  const view = resolveView(args.view, PAYMENT_METHOD_VIEWS);
  const client = await getActiveClient(args.origin);
  const res = await client.request<Raw[]>(
    'GET',
    apiPath`/api/v2/users/${client.scope.userId}/payment_methods`
  );
  return viewResult(view, view === 'raw' ? res : (res ?? []).map(summarizePaymentMethod));
}

export function registerPaymentMethodTools(server: McpServer): void {
  server.registerTool(
    'list_payment_methods',
    {
      description:
        'List saved payment methods for your client account with a vendor: id, type, brand, last 4, expiry ' +
        'and whether it is the default. Empty array if none are saved. view="raw" returns the untrimmed ' +
        'records (billing name/address and Stripe references).',
      inputSchema: z.object({
        view: viewParam(PAYMENT_METHOD_VIEWS, {
          note: 'compact returns only the card-on-file fields; "raw" returns the untrimmed records, including billing name/address and Stripe references.',
        }),
        origin: schemaOrigin.describe(
          'Portal origin (e.g. https://<vendor>.hbportal.co). Optional when only one session is active.'
        ),
      }),
      annotations: { readOnlyHint: true },
    },
    listPaymentMethods
  );
}
