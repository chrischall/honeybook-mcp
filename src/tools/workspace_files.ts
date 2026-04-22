import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getActiveClient } from '../client.js';
import type { HBListEnvelope, ToolResult } from '../types.js';
import { FILE_TYPES } from '../types.js';

/**
 * Vendor-side sub-fields on `company` that a CLIENT never needs but that
 * balloon the response (observed: `vendor_emails` alone was ~1.3 MB on a
 * single real proposal). Stripped by default; section='raw' keeps them.
 */
const HEAVY_COMPANY_FIELDS = [
  'vendor_emails',
  'workflow_automation_infos',
  'brochure_templates',
  'questionnaires',
  'lead_sources',
  'proposals',
  'agreements',
  'invoices',
  'vendor_packages',
  'contact_forms',
  'stripe_persons',
  'user_pipeline_stages',
  'project_types',
  'company_assets',
] as const;

export function pruneWorkspaceFile(file: Record<string, unknown>): Record<string, unknown> {
  if (!file || typeof file !== 'object') return file;
  const company = file.company as Record<string, unknown> | undefined;
  if (!company) return file;
  const pruned = { ...file, company: { ...company } };
  for (const key of HEAVY_COMPANY_FIELDS) {
    delete (pruned.company as Record<string, unknown>)[key];
  }
  return pruned;
}

export const WORKSPACE_FILE_SECTIONS = [
  'summary',
  'pricing',
  'agreement',
  'payments',
  'all',
  'raw',
] as const;
export type WorkspaceFileSection = (typeof WORKSPACE_FILE_SECTIONS)[number];

type RawFile = Record<string, unknown>;

// Short helpers
function getObj(o: RawFile | undefined, key: string): RawFile | undefined {
  const v = o?.[key];
  return v && typeof v === 'object' ? (v as RawFile) : undefined;
}
function getArr(o: RawFile | undefined, key: string): RawFile[] {
  const v = o?.[key];
  return Array.isArray(v) ? (v as RawFile[]) : [];
}
function getStr(o: RawFile | undefined, key: string): string | undefined {
  const v = o?.[key];
  return typeof v === 'string' ? v : undefined;
}
function getNum(o: RawFile | undefined, key: string): number | undefined {
  const v = o?.[key];
  return typeof v === 'number' ? v : undefined;
}

/**
 * Compact summary: ~5-15 kB even for proposal-class files. Contains everything
 * a caller typically needs up front (identity, status, vendor, event, totals,
 * payment schedule, package titles + pricing). For the contract text or the
 * full vendor_proposal, call again with section='agreement' or 'pricing'.
 */
export function buildSummary(file: RawFile): Record<string, unknown> {
  const vp = getObj(file, 'vendor_proposal') ?? {};
  const payments = getArr(getObj(file, 'payments_container'), 'payments');
  const paymentsTotal = payments.reduce((s, p) => s + (getNum(p, 'amount') ?? 0), 0);
  const paymentsPaid = payments
    .filter((p) => p.is_paid === true)
    .reduce((s, p) => s + (getNum(p, 'amount') ?? 0), 0);

  const owner = getObj(file, 'owner');
  const company = getObj(file, 'company');
  const event = getObj(file, 'event');
  const agreement = getObj(file, 'agreement');

  const packages = getArr(vp, 'vendor_packages').map((p) => ({
    title: getStr(p, 'title'),
    description: (getStr(p, 'description') ?? '').slice(0, 400),
    price: getNum(p, 'total_price') ?? getNum(p, 'sub_total'),
    quantity: getNum(p, 'quantity'),
  }));
  const services = getArr(vp, 'service_items').map((s) => ({
    title: getStr(s, 'title'),
    description: (getStr(s, 'description') ?? '').slice(0, 400),
    price: getNum(s, 'total_price') ?? getNum(s, 'sub_total'),
    quantity: getNum(s, 'quantity'),
  }));

  return {
    _id: file._id,
    file_title: file.file_title,
    file_type: file.file_type,
    status: file.status,
    status_name: file.status_name,
    status_type: file.status_type,
    sent_on: file.sent_on,
    created_at: file.created_at,
    auto_expiration: file.auto_expiration,
    is_file_accepted: file.is_file_accepted,
    is_booked_version: file.is_booked_version,
    is_canceled: file.is_canceled,
    has_pending_payment: file.has_pending_payment,
    currency: file.currency,
    workspace: {
      name: getStr(file, 'workspace_name'),
      status_type: getStr(file, 'workspace_status_type'),
      status_name: getStr(file, 'workspace_status_name'),
      active_state: getStr(file, 'workspace_active_state'),
    },
    vendor: {
      company_name: getStr(company, 'company_name'),
      owner_name: [getStr(owner, 'first_name'), getStr(owner, 'last_name')].filter(Boolean).join(' '),
      owner_email: getStr(owner, 'email'),
      owner_phone: getStr(owner, 'phone_number'),
    },
    event: event
      ? {
          _id: event._id,
          date: getStr(event, 'event_date'),
          type: getStr(event, 'type'),
          couple_names: getStr(event, 'couple_names'),
        }
      : null,
    pricing: {
      sub_total: getNum(vp, 'sub_total'),
      total_price: getNum(vp, 'total_price'),
      discount: getNum(vp, 'discount')
        ? { value: getNum(vp, 'discount'), type: getStr(vp, 'discount_type') }
        : null,
      tax: getNum(vp, 'tax') ? { value: getNum(vp, 'tax'), type: getStr(vp, 'tax_type') } : null,
      svc: getNum(vp, 'svc') ? { value: getNum(vp, 'svc'), type: getStr(vp, 'svc_type') } : null,
      total_tax: getNum(vp, 'total_tax'),
      total_svc: getNum(vp, 'total_svc'),
      packages,
      services,
    },
    payments: {
      total: paymentsTotal,
      paid: paymentsPaid,
      remaining: paymentsTotal - paymentsPaid,
      count: payments.length,
      schedule: payments.map((p) => ({
        due_date: getStr(p, 'due_date'),
        amount: getNum(p, 'amount'),
        count_description: getStr(p, 'count_description'),
        invoice: getStr(p, 'invoice'),
        is_paid: p.is_paid === true,
        is_pending: p.is_pending === true,
        is_milestone: p.is_milestone === true,
      })),
    },
    agreement: agreement
      ? {
          present: true,
          signatures: getArr(agreement, 'contract_signatures').map((s) => ({
            signed_by: getStr(s, 'signer_email') ?? getStr(s, 'signer_name'),
            signed_at: getStr(s, 'signed_at') ?? getStr(s, 'signature_date'),
            is_vendor: s.is_vendor === true,
          })),
          html_length: (getStr(agreement, 'html_body') ?? '').length,
        }
      : { present: false },
    sections_available: WORKSPACE_FILE_SECTIONS,
    hint:
      'Call get_workspace_file again with section="pricing" (full line items + tax/svc detail), "agreement" (contract HTML + signatures), "payments" (full payment-schedule detail), "all" (pruned full response), or "raw" (full unpruned response — may exceed MCP size limit).',
  };
}

function extractPricing(file: RawFile): Record<string, unknown> {
  return {
    _id: file._id,
    file_title: file.file_title,
    currency: file.currency,
    vendor_proposal: file.vendor_proposal,
  };
}

function extractAgreement(file: RawFile): Record<string, unknown> {
  return {
    _id: file._id,
    file_title: file.file_title,
    agreement: file.agreement,
  };
}

function extractPayments(file: RawFile): Record<string, unknown> {
  return {
    _id: file._id,
    file_title: file.file_title,
    currency: file.currency,
    payment_type: file.payment_type,
    has_milestone_payment: file.has_milestone_payment,
    has_pending_payment: file.has_pending_payment,
    payments_container: file.payments_container,
  };
}

export async function listWorkspaceFiles(args: {
  origin?: string;
  file_type?: string;
}): Promise<ToolResult> {
  const client = await getActiveClient(args.origin);
  const res = await client.request<HBListEnvelope<Record<string, unknown>>>(
    'GET',
    `/api/v2/users/${client.scope.userId}/workspace_files`
  );
  const filtered = args.file_type
    ? res.data.filter((f) => f.file_type === args.file_type)
    : res.data;
  const prefix =
    res.last_page === false
      ? '// NOTE: more results exist on later pages; pagination is not yet wired up.\n'
      : '';
  return { content: [{ type: 'text', text: prefix + JSON.stringify(filtered, null, 2) }] };
}

export async function getWorkspaceFile(args: {
  file_id: string;
  origin?: string;
  section?: WorkspaceFileSection;
}): Promise<ToolResult> {
  const section: WorkspaceFileSection = args.section ?? 'summary';
  const client = await getActiveClient(args.origin);
  const raw = await client.request<RawFile>('GET', `/api/v2/workspace_files/${args.file_id}`);

  let body: unknown;
  switch (section) {
    case 'raw':
      body = raw;
      break;
    case 'all':
      body = pruneWorkspaceFile(raw);
      break;
    case 'pricing':
      body = extractPricing(raw);
      break;
    case 'agreement':
      body = extractAgreement(raw);
      break;
    case 'payments':
      body = extractPayments(raw);
      break;
    case 'summary':
    default:
      body = buildSummary(raw);
      break;
  }

  return { content: [{ type: 'text', text: JSON.stringify(body, null, 2) }] };
}

export function registerWorkspaceFileTools(server: McpServer): void {
  server.registerTool(
    'list_workspace_files',
    {
      description:
        'List all files a vendor has shared with you (contracts, invoices, brochures, proposals). Optionally filter by file_type.',
      inputSchema: {
        origin: z
          .string()
          .optional()
          .describe(
            'Portal origin (e.g. https://<vendor>.hbportal.co) to target. Optional — defaults to the most recently activated session.'
          ),
        file_type: z
          .enum(FILE_TYPES)
          .optional()
          .describe('Filter to one file type. Omit to return all.'),
      },
      annotations: { readOnlyHint: true },
    },
    listWorkspaceFiles
  );
  server.registerTool(
    'get_workspace_file',
    {
      description:
        'Get detail for one workspace file. Returns a compact summary by default (metadata, vendor, event, pricing totals, payment schedule, agreement presence). Use `section` to drill into a specific part of the file: "pricing" for full line items + tax/svc detail, "agreement" for contract HTML + signatures, "payments" for full payment-schedule detail, "all" for the pruned full response, or "raw" for the entirely-unpruned response (may exceed MCP size limits on proposal-class files).',
      inputSchema: {
        file_id: z.string().describe('The file _id from list_workspace_files.'),
        origin: z
          .string()
          .optional()
          .describe(
            'Portal origin (e.g. https://<vendor>.hbportal.co). Optional when only one session is active.'
          ),
        section: z
          .enum(WORKSPACE_FILE_SECTIONS)
          .optional()
          .describe(
            'Which view to return. Default "summary" (~5-15 kB). Others return focused sections of the raw response.'
          ),
      },
      annotations: { readOnlyHint: true },
    },
    getWorkspaceFile
  );
}
