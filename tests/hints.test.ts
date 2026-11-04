// Context-group hints (`_meta.mint`, the mcp-host context-groups contract),
// asserted against the SERVED tool list — what a host actually sees — for
// every registrar the server runs, so a new tool cannot skip the decision.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTestHarness } from '@chrischall/mcp-utils/test';
import * as clientModule from '../src/client.js';
import { registrars } from '../src/tools/index.js';
import {
  buildProjectDirectory,
  loadProjectDirectory,
  type ProjectDirectory,
  type ProjectRow,
} from '../src/tools/project-labels.js';
import { briefPaymentLine } from '../src/tools/payments.js';
import { listAllProjects } from '../src/tools/project-labels.js';
import { sessionStore } from '../src/sessions.js';

type Listed = {
  name: string;
  annotations?: { readOnlyHint?: boolean };
  inputSchema: { properties?: Record<string, any>; required?: string[] };
  _meta?: { mint?: Record<string, any> };
};

async function served(projects: ProjectDirectory | null = null): Promise<Listed[]> {
  const h = await createTestHarness((server) => {
    for (const register of registrars) register(server, { projects });
  });
  try {
    // The raw tools/list reply: the harness's listTools() summary drops _meta.
    return (await h.client.listTools()).tools as Listed[];
  } finally {
    await h.close();
  }
}

const DOMAINS = ['school', 'home', 'work', 'family', 'health', 'money', 'travel', 'food'];
const INTENTS = ['whats-new', 'whats-due', 'whats-on', 'lookup', 'turn-on-off', 'send', 'change', 'other'];
const CANONICAL_INTENTS = ['whats-new', 'whats-due', 'whats-on'];
const KEYS = ['domain', 'intent', 'canonical', 'subject', 'when', 'aliases'];

/** The intent every tool declares — this table is the assertion. */
const EXPECTED_INTENT: Record<string, string> = {
  use_magic_link: 'other',
  list_active_sessions: 'lookup',
  use_flow_link: 'other',
  get_flow: 'lookup',
  list_workspace_files: 'lookup',
  get_workspace_file: 'lookup',
  get_workspace: 'lookup',
  list_payment_methods: 'lookup',
  sign_contract: 'other',
  pay_invoice: 'other',
  list_projects: 'lookup',
  get_project: 'lookup',
  list_messages: 'whats-new',
  get_message: 'lookup',
  send_message: 'send',
  mark_messages_seen: 'change',
  list_meetings: 'whats-on',
  list_tasks: 'whats-due',
  list_notes: 'lookup',
  list_attachments: 'lookup',
  list_payments: 'whats-due',
};

const BRIEF_LINE = /^.+ — (\d{4}-\d{2}-\d{2}|no date) — (paid|pending|unpaid|overdue)$/;

describe('_meta.mint on the served tool list', () => {
  it('names every served tool, so a new tool cannot skip the decision', async () => {
    const names = (await served()).map((t) => t.name).sort();
    expect(names).toEqual([...Object.keys(EXPECTED_INTENT), 'honeybook_healthcheck'].sort());
  });

  it('every tool but the healthcheck is in the money group with the intent that fits', async () => {
    for (const t of await served()) {
      const m = t._meta?.mint;
      if (t.name === 'honeybook_healthcheck') {
        // Registered by mcp-utils, which takes no _meta: it joins no group.
        expect(m, t.name).toBeUndefined();
        continue;
      }
      expect(m, t.name).toBeDefined();
      expect(Object.keys(m!).filter((k) => !KEYS.includes(k)), t.name).toEqual([]);
      expect(DOMAINS).toContain(m!.domain);
      expect(m!.domain, t.name).toBe('money');
      expect(INTENTS, t.name).toContain(m!.intent);
      expect(m!.intent, t.name).toBe(EXPECTED_INTENT[t.name]);
    }
  });

  it('every hint is shaped per the host contract', async () => {
    for (const t of await served()) {
      const m = t._meta?.mint;
      if (!m) continue;
      const props = t.inputSchema.properties ?? {};
      if ('canonical' in m) {
        expect(m.canonical, t.name).toBe(true);
        expect(t.annotations?.readOnlyHint, t.name).toBe(true);
        expect(CANONICAL_INTENTS, t.name).toContain(m.intent);
      }
      if ('subject' in m) expect(props, t.name).toHaveProperty(m.subject);
      if ('when' in m) {
        expect(Object.keys(m.when).sort(), t.name).toEqual(['end', 'start']);
        expect(props, t.name).toHaveProperty(m.when.start);
        expect(props, t.name).toHaveProperty(m.when.end);
      }
      if ('aliases' in m) {
        expect(m.aliases.length, t.name).toBeLessThanOrEqual(8);
        for (const a of m.aliases as string[]) {
          expect(a.length, t.name).toBeLessThanOrEqual(40);
          expect(a, t.name).toBe(a.toLowerCase());
          expect(EXPECTED_INTENT, `${t.name}: alias "${a}" is a tool name`).not.toHaveProperty(a);
        }
      }
    }
  });

  it('marks at most one canonical read per what’s-new/due/on: the payment schedule for what’s due', async () => {
    const tools = await served();
    const canonical = tools.filter((t) => t._meta?.mint?.canonical === true);
    for (const intent of CANONICAL_INTENTS) {
      expect(canonical.filter((t) => t._meta!.mint!.intent === intent).length, intent).toBeLessThanOrEqual(1);
    }
    expect(canonical.map((t) => [t.name, t._meta!.mint!.intent])).toEqual([['list_payments', 'whats-due']]);
    expect(canonical[0]._meta!.mint).toEqual({
      domain: 'money',
      intent: 'whats-due',
      canonical: true,
      subject: 'workspace_id',
      aliases: ['payments', 'payment due', 'what do i owe', 'deposit', 'balance due', 'installment', 'vendor bill'],
    });
  });

  it('every canonical read accepts view: "brief"', async () => {
    for (const t of (await served()).filter((x) => x._meta?.mint?.canonical === true)) {
      expect(t.inputSchema.properties?.view?.enum, t.name).toContain('brief');
    }
  });
});

describe('list_payments view: "brief"', () => {
  let fakeClient: { request: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    fakeClient = { request: vi.fn() };
    vi.spyOn(clientModule, 'getActiveClient').mockResolvedValue(fakeClient as unknown as clientModule.HoneyBookClient);
  });
  afterEach(() => vi.restoreAllMocks());

  const PAYMENTS = {
    workspace_files: [
      { _id: 'brochure', file_title: 'Brochure', file_type: 'brochure', currency: 'USD', payments_container: null },
      {
        _id: 'proposal',
        file_title: 'Photography Proposal',
        file_type: 'proposal',
        currency: 'USD',
        payments_container: {
          payments: [
            { _id: 'p1', due_date: '2026-04-25', amount: 500, is_paid: true, count_description: '1 of 3 payments / Retainer' },
            { _id: 'p2', due_date: '2026-06-01T00:00:00.000+00:00', amount: 750, is_paid: false, is_pending: true, count_description: '2 of 3 payments' },
            { _id: 'p3', due_date: null, amount: 750, is_paid: false, count_description: '3 of 3 payments' },
          ],
        },
      },
    ],
  };

  it('answers one line per payment, ≤ 120 chars, "title — <ISO date | no date> — <status>"', async () => {
    fakeClient.request.mockResolvedValueOnce(PAYMENTS);
    const h = await createTestHarness((server) => {
      for (const register of registrars) register(server, { projects: null });
    });
    try {
      const res = (await h.callTool('list_payments', { workspace_id: 'ws_1', view: 'brief' })) as {
        content: Array<{ text: string }>;
      };
      const lines = res.content[0].text.split('\n');
      expect(lines).toEqual([
        'Photography Proposal: 1 of 3 payments / Retainer (500 USD) — 2026-04-25 — paid',
        'Photography Proposal: 2 of 3 payments (750 USD) — 2026-06-01 — pending',
        'Photography Proposal: 3 of 3 payments (750 USD) — no date — unpaid',
      ]);
      for (const line of lines) {
        expect(line.length).toBeLessThanOrEqual(120);
        expect(line).toMatch(BRIEF_LINE);
      }
    } finally {
      await h.close();
    }
  });

  it('calls an unpaid payment past its due date overdue, and shortens a long title to fit 120', () => {
    const file = { file_title: 'X'.repeat(200), currency: 'EUR' };
    const line = briefPaymentLine(file, { due_date: '2026-01-02', amount: 10, is_paid: false }, '2026-03-01');
    expect(line.length).toBeLessThanOrEqual(120);
    expect(line).toMatch(BRIEF_LINE);
    expect(line.endsWith(' — 2026-01-02 — overdue')).toBe(true);
    expect(briefPaymentLine({}, {}, '2026-03-01')).toBe('(untitled) — no date — unpaid');
  });
});

describe('project labels on list_payments’ workspace_id', () => {
  const ROWS: ProjectRow[] = [
    { label: 'Spring Gala', workspace_id: 'aaaaaaaaaaaaaaaaaaaaaaaa', origin: 'https://vendor-one.hbportal.co' },
    { label: 'Office Party', workspace_id: 'bbbbbbbbbbbbbbbbbbbbbbbb', origin: 'https://vendor-one.hbportal.co' },
    { label: 'Spring Gala', workspace_id: 'cccccccccccccccccccccccc', origin: 'https://vendor-two.hbportal.co' },
  ];

  it('labels each project once, disambiguating a shared name with the vendor', () => {
    expect(buildProjectDirectory(ROWS)!.labels).toEqual([
      'Spring Gala (vendor-one)',
      'Office Party',
      'Spring Gala (vendor-two)',
    ]);
  });

  it('never builds an empty directory', () => {
    expect(buildProjectDirectory([])).toBeNull();
  });

  it('resolves a label (any case) to its workspace and portal, passes a raw id through, refuses anything else', () => {
    const dir = buildProjectDirectory(ROWS)!;
    expect(dir.resolve(' office party ')).toEqual({ workspace_id: 'bbbbbbbbbbbbbbbbbbbbbbbb', origin: 'https://vendor-one.hbportal.co' });
    expect(dir.resolve('cccccccccccccccccccccccc')).toEqual({ workspace_id: 'cccccccccccccccccccccccc', origin: 'https://vendor-two.hbportal.co' });
    expect(dir.resolve('dddddddddddddddddddddddd')).toEqual({ workspace_id: 'dddddddddddddddddddddddd' });
    expect(() => dir.resolve('Birthday')).toThrow(/No HoneyBook project named "Birthday".*Office Party/);
  });

  it('answers null — no enum — when the listing fails, is empty or misses its deadline', async () => {
    expect(await loadProjectDirectory(async () => { throw new Error('no session'); })).toBeNull();
    expect(await loadProjectDirectory(async () => [])).toBeNull();
    expect(await loadProjectDirectory(() => new Promise<ProjectRow[]>(() => {}), 10)).toBeNull();
    expect((await loadProjectDirectory(async () => ROWS))!.labels).toHaveLength(3);
  });

  it('publishes the labels as an enum on workspace_id, and the plain property without a listing', async () => {
    const dir = buildProjectDirectory(ROWS);
    const withEnum = (await served(dir)).find((t) => t.name === 'list_payments')!;
    expect(withEnum.inputSchema.properties!.workspace_id.enum).toEqual(dir!.labels);
    const plain = (await served(null)).find((t) => t.name === 'list_payments')!;
    expect(plain.inputSchema.properties!.workspace_id).not.toHaveProperty('enum');
    expect(plain.inputSchema.properties!.workspace_id.type).toBe('string');
  });

  it('a label reads that project’s workspace on its own portal', async () => {
    const fakeClient = { request: vi.fn().mockResolvedValue({ workspace_files: [] }) };
    const spy = vi
      .spyOn(clientModule, 'getActiveClient')
      .mockResolvedValue(fakeClient as unknown as clientModule.HoneyBookClient);
    const dir = buildProjectDirectory(ROWS);
    const h = await createTestHarness((server) => {
      for (const register of registrars) register(server, { projects: dir });
    });
    try {
      await h.callTool('list_payments', { workspace_id: 'Spring Gala (vendor-two)' });
      expect(spy).toHaveBeenCalledWith('https://vendor-two.hbportal.co');
      expect(fakeClient.request).toHaveBeenCalledWith('GET', '/api/v2/workspaces/cccccccccccccccccccccccc/payments');
    } finally {
      await h.close();
      vi.restoreAllMocks();
    }
  });

  it('carries the id too when one vendor repeats a project name', () => {
    const o = 'https://vendor-one.hbportal.co';
    expect(
      buildProjectDirectory([
        { label: 'Gala', workspace_id: 'eeeeeeeeeeeeeeeeeeeeeeee', origin: o },
        { label: 'gala', workspace_id: 'ffffffffffffffffffffffff', origin: o },
      ])!.labels
    ).toEqual(['Gala (vendor-one, eeeeeeeeeeeeeeeeeeeeeeee)', 'gala (vendor-one, ffffffffffffffffffffffff)']);
  });

  it('lists every page of every captured portal session', async () => {
    sessionStore.resetForTest();
    sessionStore.add({ portalOrigin: 'https://vendor-one.hbportal.co', companyName: 'One', authToken: 't1', userId: 'u1', capturedAt: 1 });
    sessionStore.add({ portalOrigin: 'https://vendor-two.hbportal.co', companyName: 'Two', authToken: 't2', userId: 'u2', capturedAt: 2 });
    const pages: Record<string, unknown[]> = {
      'https://vendor-one.hbportal.co': [
        { data: [{ workspace_id: 'aaaaaaaaaaaaaaaaaaaaaaaa', event_name: ' Spring Gala ' }], last_page: false, total_pages: 2 },
        { data: [{ workspace_id: 'bbbbbbbbbbbbbbbbbbbbbbbb', event_name: '' }, { event_name: 'no workspace' }], last_page: true },
      ],
      'https://vendor-two.hbportal.co': [{ data: [{ workspace_id: 'cccccccccccccccccccccccc', event_name: 'Office Party' }] }],
    };
    const spy = vi.spyOn(clientModule, 'getActiveClient').mockImplementation(async (origin?: string) => {
      const queue = pages[origin!];
      return { request: vi.fn(async () => queue.shift()) } as unknown as clientModule.HoneyBookClient;
    });
    try {
      expect(await listAllProjects()).toEqual([
        { label: 'Spring Gala', workspace_id: 'aaaaaaaaaaaaaaaaaaaaaaaa', origin: 'https://vendor-one.hbportal.co' },
        { label: 'bbbbbbbbbbbbbbbbbbbbbbbb', workspace_id: 'bbbbbbbbbbbbbbbbbbbbbbbb', origin: 'https://vendor-one.hbportal.co' },
        { label: 'Office Party', workspace_id: 'cccccccccccccccccccccccc', origin: 'https://vendor-two.hbportal.co' },
      ]);
      expect(spy).toHaveBeenCalledTimes(2);
    } finally {
      vi.restoreAllMocks();
      sessionStore.resetForTest();
    }
  });
});
