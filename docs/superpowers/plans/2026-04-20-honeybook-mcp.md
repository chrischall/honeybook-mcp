# honeybook-mcp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an MCP server that lets Claude read HoneyBook client-portal contracts and invoices (and, where reachable, sign/pay them) across multiple connected vendors.

**Architecture:** TypeScript ESM (NodeNext) + `@modelcontextprotocol/sdk` + stdio transport. Clones the `zola-mcp` project shape exactly. One `HoneyBookClient` class handles per-vendor auth-scope loading and request construction; tool modules under `src/tools/` register MCP tools. Auth is captured via a Puppeteer-driven `npm run auth` script that reads a vendor's magic-link session (localStorage + one captured network fingerprint header) and appends slugged `HB_<SLUG>_*` env vars to `.env`.

**Tech Stack:** TypeScript, `@modelcontextprotocol/sdk` v1.29+, `zod`, esbuild, vitest, `puppeteer-core` (auth script only), `dotenv`.

**Spec:** `docs/superpowers/specs/2026-04-20-honeybook-mcp-design.md`

---

## Endpoint reference (confirmed live, 2026-04-20)

All under `https://api.honeybook.com` with 8 required headers (see [Task 5](#task-5-request-headers-and-transport)). Path params use MongoDB ObjectIds (24-char hex).

| Method | Path                                       | Purpose                                           |
|--------|--------------------------------------------|---------------------------------------------------|
| GET    | `/api/v2/users/{uid}`                      | Current user profile                              |
| GET    | `/api/v2/users/{uid}/workspace_files`      | Paginated files across workspaces (contracts, invoices, brochures, proposals, etc.) |
| GET    | `/api/v2/workspace_files/{file_id}`        | Single file's full detail                         |
| GET    | `/api/v2/workspaces/{workspace_id}`        | Workspace detail with status flags                |
| GET    | `/api/v2/users/{uid}/payment_methods`      | Saved payment methods (array; possibly empty)     |
| GET    | `/api/gon?callback=parseGon`               | Public bootstrap JSONP — contains `api_version`   |

**Response envelope for paginated lists:** `{data: [...], cur_page, last_page, last_id}`.

**Distinguishing file types:** `file_type` field on each file. Observed values include `"brochure"`. Expected others: `"agreement"` (contracts), `"invoice"`. Tests mock all three.

**Unconfirmed endpoints** (to be captured via live-action sniff during Task 13 / Task 14): `sign` / `pay` write endpoints. Plan uses deep-link fallback until sniffed.

---

## Files map

```
src/
  index.ts              # MCP server entry; registers tool modules; stdio transport
  client.ts             # HoneyBookClient: per-vendor scope loading, header construction, request
  types.ts              # HBListEnvelope<T>, ToolResult, VendorScope, file type enums
  tools/
    vendors.ts          # list_vendors (env-only; no API call)
    workspace_files.ts  # list_workspace_files, get_workspace_file
    workspaces.ts       # get_workspace
    payment_methods.ts  # list_payment_methods
    contracts.ts        # sign_contract (deep-link fallback in v1)
    invoices.ts         # pay_invoice (deep-link fallback in v1)
tests/
  client.test.ts        # Client scope loading + header construction + error-path retries
  vendors.test.ts
  workspace_files.test.ts
  workspaces.test.ts
  payment_methods.test.ts
  contracts.test.ts
  invoices.test.ts
  setup-auth.test.ts    # Slug sanitization, env append, existing-vendor detection
scripts/
  setup-auth.mjs        # Puppeteer magic-link capture (installs puppeteer-core on first run)
  setup-auth.sh         # Thin wrapper
.claude-plugin/
  plugin.json
  marketplace.json
skills/honeybook/SKILL.md
.github/workflows/
  ci.yml
  tag-and-bump.yml
  release.yml
SKILL.md
README.md
CLAUDE.md
manifest.json
server.json
.mcp.json
.mcpbignore
.env.example
.gitignore  # already exists
tsconfig.json
vitest.config.ts
package.json
package-lock.json
```

---

## Task 1: Scaffold package, tsconfig, vitest, gitignore updates

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.env.example`, `.mcpbignore`
- Modify: `.gitignore` (already exists)

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "honeybook-mcp",
  "version": "0.1.0",
  "mcpName": "io.github.chrischall/honeybook-mcp",
  "description": "HoneyBook client-portal MCP server for Claude",
  "author": "Claude Code (AI) <https://www.anthropic.com/claude>",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/chrischall/honeybook-mcp.git"
  },
  "license": "MIT",
  "keywords": [
    "mcp",
    "honeybook",
    "wedding",
    "contracts",
    "invoices",
    "model-context-protocol",
    "claude"
  ],
  "files": [
    "dist",
    ".claude-plugin",
    "skills",
    ".mcp.json",
    "server.json"
  ],
  "engines": {
    "node": ">=20.6.0"
  },
  "type": "module",
  "bin": {
    "honeybook-mcp": "dist/index.js"
  },
  "scripts": {
    "build": "tsc && npm run bundle",
    "bundle": "esbuild src/index.ts --bundle --platform=node --format=esm --external:dotenv --outfile=dist/bundle.js",
    "dev": "node --env-file=.env dist/index.js",
    "auth": "node scripts/setup-auth.mjs",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.29.0",
    "dotenv": "^17.4.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/node": "^25.5.0",
    "@vitest/coverage-v8": "^4.1.2",
    "esbuild": "^0.28.0",
    "typescript": "^6.0.2",
    "vitest": "^4.1.2"
  }
}
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Write `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: { provider: 'v8' },
    exclude: ['**/node_modules/**', '**/.claude/**'],
  },
});
```

- [ ] **Step 4: Write `.env.example`**

```
# Comma-separated slugs, one per vendor you've connected.
HONEYBOOK_VENDORS=silk_veil

# Per-vendor secrets — run `npm run auth` to populate these.
HB_SILK_VEIL_LABEL=The Silk Veil Events by Ivy
HB_SILK_VEIL_PORTAL_ORIGIN=https://thesilkveileventsbyivy.hbportal.co
HB_SILK_VEIL_AUTH_TOKEN=
HB_SILK_VEIL_USER_ID=
HB_SILK_VEIL_TRUSTED_DEVICE=
HB_SILK_VEIL_FINGERPRINT=

# Optional: pin the API version instead of auto-fetching from /api/gon.
# HONEYBOOK_API_VERSION=2578
```

- [ ] **Step 5: Write `.mcpbignore`**

```
tests/
coverage/
docs/
scripts/
src/
.claude/
.github/
.env
.env.*
*.test.ts
tsconfig.json
vitest.config.ts
.mcpbignore
```

- [ ] **Step 6: Ensure `.gitignore` includes the right entries**

`.gitignore` was created during spec work and should contain: `node_modules/`, `dist/`, `.env`, `.env.local`, `*.log`, `.DS_Store`, `coverage/`, `*.mcpb`, `*.skill`. If any are missing, append them.

- [ ] **Step 7: Install dependencies**

Run: `npm install`
Expected: creates `node_modules/` and writes `package-lock.json`. No errors.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .env.example .mcpbignore .gitignore
git commit -m "scaffold: package.json, tsconfig, vitest, env example, mcpb ignore"
```

---

## Task 2: Core types

**Files:**
- Create: `src/types.ts`
- Test: `tests/types.test.ts` (type-only test, optional but useful)

- [ ] **Step 1: Write `src/types.ts`**

```ts
/**
 * Standard MCP tool return type. All tool handlers return a single text block.
 */
export type ToolResult = { content: [{ type: 'text'; text: string }] };

/**
 * Paginated list envelope returned by HoneyBook v2 list endpoints
 * (e.g. GET /api/v2/users/{uid}/workspace_files).
 */
export interface HBListEnvelope<T> {
  data: T[];
  cur_page: number | null;
  last_page: boolean;
  last_id?: string | null;
  total_count?: number;
}

/**
 * Per-vendor auth scope loaded from HB_<SLUG>_* env vars.
 * One of these per entry in HONEYBOOK_VENDORS.
 */
export interface VendorScope {
  slug: string;
  label: string;
  authToken: string;
  userId: string;
  trustedDevice: string;
  fingerprint: string;
  /** The vendor's branded portal origin, e.g. https://thesilkveileventsbyivy.hbportal.co */
  portalOrigin: string;
}

/**
 * Known file types. HoneyBook uses many; these are the ones this MCP cares about.
 */
export const FILE_TYPES = ['agreement', 'invoice', 'brochure', 'proposal'] as const;
export type FileType = (typeof FILE_TYPES)[number];
```

- [ ] **Step 2: Commit**

```bash
git add src/types.ts
git commit -m "feat: core types (ToolResult, HBListEnvelope, VendorScope, FileType)"
```

---

## Task 3: Vendor-scope loader (env parsing)

**Files:**
- Create: `src/client.ts` (stub with `loadVendorScopes` only; full client in Task 4-5)
- Test: `tests/client.test.ts`

- [ ] **Step 1: Write failing test for `loadVendorScopes`**

Create `tests/client.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadVendorScopes } from '../src/client.js';

describe('loadVendorScopes', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    for (const k of Object.keys(process.env)) {
      if (k.startsWith('HB_') || k === 'HONEYBOOK_VENDORS') delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of Object.keys(process.env)) {
      if (k.startsWith('HB_') || k === 'HONEYBOOK_VENDORS') delete process.env[k];
    }
    Object.assign(process.env, originalEnv);
  });

  it('returns empty map when HONEYBOOK_VENDORS is unset', () => {
    expect(loadVendorScopes()).toEqual({});
  });

  it('parses a single vendor from slug-prefixed env vars', () => {
    process.env.HONEYBOOK_VENDORS = 'silk_veil';
    process.env.HB_SILK_VEIL_LABEL = 'The Silk Veil Events by Ivy';
    process.env.HB_SILK_VEIL_AUTH_TOKEN = 'tok_43';
    process.env.HB_SILK_VEIL_USER_ID = 'uid_24';
    process.env.HB_SILK_VEIL_TRUSTED_DEVICE = 'td_64';
    process.env.HB_SILK_VEIL_FINGERPRINT = 'fp_32';
    process.env.HB_SILK_VEIL_PORTAL_ORIGIN = 'https://thesilkveileventsbyivy.hbportal.co';
    const scopes = loadVendorScopes();
    expect(scopes).toEqual({
      silk_veil: {
        slug: 'silk_veil',
        label: 'The Silk Veil Events by Ivy',
        authToken: 'tok_43',
        userId: 'uid_24',
        trustedDevice: 'td_64',
        fingerprint: 'fp_32',
        portalOrigin: 'https://thesilkveileventsbyivy.hbportal.co',
      },
    });
  });

  it('strips trailing slash from PORTAL_ORIGIN', () => {
    process.env.HONEYBOOK_VENDORS = 'x';
    process.env.HB_X_AUTH_TOKEN = 'a';
    process.env.HB_X_USER_ID = 'b';
    process.env.HB_X_TRUSTED_DEVICE = 'c';
    process.env.HB_X_FINGERPRINT = 'd';
    process.env.HB_X_PORTAL_ORIGIN = 'https://x.hbportal.co/';
    expect(loadVendorScopes().x?.portalOrigin).toBe('https://x.hbportal.co');
  });

  it('trims whitespace and ignores empty slugs', () => {
    process.env.HONEYBOOK_VENDORS = ' silk_veil , , photog ';
    process.env.HB_SILK_VEIL_AUTH_TOKEN = 'a';
    process.env.HB_SILK_VEIL_USER_ID = 'b';
    process.env.HB_SILK_VEIL_TRUSTED_DEVICE = 'c';
    process.env.HB_SILK_VEIL_FINGERPRINT = 'd';
    process.env.HB_SILK_VEIL_PORTAL_ORIGIN = 'https://sv.hbportal.co';
    process.env.HB_PHOTOG_AUTH_TOKEN = 'a2';
    process.env.HB_PHOTOG_USER_ID = 'b2';
    process.env.HB_PHOTOG_TRUSTED_DEVICE = 'c2';
    process.env.HB_PHOTOG_FINGERPRINT = 'd2';
    process.env.HB_PHOTOG_PORTAL_ORIGIN = 'https://p.hbportal.co';
    const scopes = loadVendorScopes();
    expect(Object.keys(scopes).sort()).toEqual(['photog', 'silk_veil']);
  });

  it('defaults label to slug when HB_<SLUG>_LABEL is missing', () => {
    process.env.HONEYBOOK_VENDORS = 'photog';
    process.env.HB_PHOTOG_AUTH_TOKEN = 'a';
    process.env.HB_PHOTOG_USER_ID = 'b';
    process.env.HB_PHOTOG_TRUSTED_DEVICE = 'c';
    process.env.HB_PHOTOG_FINGERPRINT = 'd';
    process.env.HB_PHOTOG_PORTAL_ORIGIN = 'https://p.hbportal.co';
    expect(loadVendorScopes().photog?.label).toBe('photog');
  });

  it('throws with a clear message when a required field is missing', () => {
    process.env.HONEYBOOK_VENDORS = 'venue';
    process.env.HB_VENUE_AUTH_TOKEN = 'a';
    // user_id, trusted_device, fingerprint all missing
    expect(() => loadVendorScopes()).toThrow(/venue.*HB_VENUE_USER_ID/);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run tests/client.test.ts`
Expected: FAIL — cannot find module `../src/client.js` (or equivalent).

- [ ] **Step 3: Write `src/client.ts` with just `loadVendorScopes`**

```ts
import type { VendorScope } from './types.js';

const REQUIRED_FIELDS = ['AUTH_TOKEN', 'USER_ID', 'TRUSTED_DEVICE', 'FINGERPRINT', 'PORTAL_ORIGIN'] as const;

export function loadVendorScopes(): Record<string, VendorScope> {
  const list = process.env.HONEYBOOK_VENDORS;
  if (!list) return {};
  const slugs = list
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const scopes: Record<string, VendorScope> = {};
  for (const slug of slugs) {
    const UP = slug.toUpperCase();
    const get = (suffix: string) => process.env[`HB_${UP}_${suffix}`];
    for (const field of REQUIRED_FIELDS) {
      if (!get(field)) {
        throw new Error(
          `Missing env var HB_${UP}_${field} for vendor "${slug}". ` +
            `Run \`npm run auth\` to capture credentials for this vendor.`
        );
      }
    }
    scopes[slug] = {
      slug,
      label: get('LABEL') || slug,
      authToken: get('AUTH_TOKEN')!,
      userId: get('USER_ID')!,
      trustedDevice: get('TRUSTED_DEVICE')!,
      fingerprint: get('FINGERPRINT')!,
      portalOrigin: get('PORTAL_ORIGIN')!.replace(/\/$/, ''),
    };
  }
  return scopes;
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run tests/client.test.ts`
Expected: PASS — all 5 cases pass.

- [ ] **Step 5: Commit**

```bash
git add src/client.ts tests/client.test.ts
git commit -m "feat(client): load per-vendor scopes from slug-prefixed env vars"
```

---

## Task 4: API-version bootstrap

**Files:**
- Modify: `src/client.ts`
- Modify: `tests/client.test.ts`

- [ ] **Step 1: Write failing test for `fetchApiVersion`**

Append to `tests/client.test.ts`:

```ts
import { vi } from 'vitest';
import { fetchApiVersion } from '../src/client.js';

describe('fetchApiVersion', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.HONEYBOOK_API_VERSION;
  });

  it('uses HONEYBOOK_API_VERSION when set', async () => {
    process.env.HONEYBOOK_API_VERSION = '9999';
    const spy = vi.spyOn(globalThis, 'fetch');
    expect(await fetchApiVersion()).toBe(9999);
    expect(spy).not.toHaveBeenCalled();
  });

  it('fetches /api/gon and parses the JSONP callback', async () => {
    const body = '/**/parseGon({"api_version":2578,"version":"36.122.376"})';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(body, { status: 200 })
    );
    expect(await fetchApiVersion()).toBe(2578);
  });

  it('throws when the callback body is unparseable', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('nope', { status: 200 })
    );
    await expect(fetchApiVersion()).rejects.toThrow(/api_version/);
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `npx vitest run tests/client.test.ts -t fetchApiVersion`
Expected: FAIL — `fetchApiVersion` not exported.

- [ ] **Step 3: Implement `fetchApiVersion` in `src/client.ts`**

Append to `src/client.ts`:

```ts
const API_BASE = 'https://api.honeybook.com';

export async function fetchApiVersion(): Promise<number> {
  const override = process.env.HONEYBOOK_API_VERSION;
  if (override) return Number(override);
  const res = await fetch(`${API_BASE}/api/gon?callback=parseGon`);
  const text = await res.text();
  const m = /"api_version":\s*(\d+)/.exec(text);
  if (!m) throw new Error(`Could not parse api_version from /api/gon response: ${text.slice(0, 200)}`);
  return Number(m[1]);
}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `npx vitest run tests/client.test.ts -t fetchApiVersion`
Expected: PASS — all 3 cases.

- [ ] **Step 5: Commit**

```bash
git add src/client.ts tests/client.test.ts
git commit -m "feat(client): fetch api_version from /api/gon with env override"
```

---

## Task 5: Request headers and transport

**Files:**
- Modify: `src/client.ts`
- Modify: `tests/client.test.ts`

- [ ] **Step 1: Write failing tests for `HoneyBookClient.request`**

Append to `tests/client.test.ts`:

```ts
import { HoneyBookClient } from '../src/client.js';

describe('HoneyBookClient.request', () => {
  const scope = {
    slug: 'silk_veil',
    label: 'Silk Veil',
    authToken: 'tok_43',
    userId: 'uid_24',
    trustedDevice: 'td_64',
    fingerprint: 'fp_32',
  };

  afterEach(() => vi.restoreAllMocks());

  it('sends the 8 required headers on a GET', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );
    const client = new HoneyBookClient(scope, 2578);
    await client.request('GET', '/api/v2/users/uid_24');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://api.honeybook.com/api/v2/users/uid_24');
    const h = init!.headers as Record<string, string>;
    expect(h['hb-api-auth-token']).toBe('tok_43');
    expect(h['hb-api-user-id']).toBe('uid_24');
    expect(h['hb-trusted-device']).toBe('td_64');
    expect(h['hb-api-client-version']).toBe('2578');
    expect(h['hb-api-fingerprint']).toBe('fp_32');
    expect(h['hb-admin-login']).toBe('false');
    expect(h['accept']).toBe('application/json, text/plain, */*');
    expect(h['hb-api-duplicate-calls-prevention-uuid']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  it('parses JSON response bodies', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ _id: 'abc' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );
    const client = new HoneyBookClient(scope, 2578);
    const res = await client.request<{ _id: string }>('GET', '/api/v2/users/uid_24');
    expect(res).toEqual({ _id: 'abc' });
  });

  it('sends JSON body on POST with content-type header', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    );
    const client = new HoneyBookClient(scope, 2578);
    await client.request('POST', '/api/v2/workspace_files/x/sign', { signature: 'yes' });
    const [, init] = fetchSpy.mock.calls[0];
    const h = init!.headers as Record<string, string>;
    expect(h['content-type']).toBe('application/json');
    expect(init!.body).toBe(JSON.stringify({ signature: 'yes' }));
  });

  it('throws on non-2xx with status and truncated body', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('server exploded', { status: 500, statusText: 'Internal Server Error' })
    );
    const client = new HoneyBookClient(scope, 2578);
    await expect(client.request('GET', '/api/v2/users/uid_24')).rejects.toThrow(
      /500 Internal Server Error.*server exploded/
    );
  });

  it('throws a clear auth message on 401', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{"error":true,"error_type":"HBAuthenticationError"}', {
        status: 401,
        headers: { 'content-type': 'application/json' },
      })
    );
    const client = new HoneyBookClient(scope, 2578);
    await expect(client.request('GET', '/api/v2/users/uid_24')).rejects.toThrow(
      /HoneyBook auth expired for vendor "silk_veil".*npm run auth/
    );
  });

  it('re-fetches api version and retries once on HBWrongAPIVersionError', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy.mockResolvedValueOnce(
      new Response('{"error":true,"error_type":"HBWrongAPIVersionError","error_data":{"server_api_version":9999}}', {
        status: 400,
        headers: { 'content-type': 'application/json' },
      })
    );
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ _id: 'ok' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );
    const client = new HoneyBookClient(scope, 2578);
    const res = await client.request<{ _id: string }>('GET', '/api/v2/users/uid_24');
    expect(res).toEqual({ _id: 'ok' });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const secondHeaders = fetchSpy.mock.calls[1]![1]!.headers as Record<string, string>;
    expect(secondHeaders['hb-api-client-version']).toBe('9999');
  });

  it('retries once after a 429 with a 2s backoff', async () => {
    vi.useFakeTimers();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy.mockResolvedValueOnce(new Response('', { status: 429 }));
    fetchSpy.mockResolvedValueOnce(
      new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    );
    const client = new HoneyBookClient(scope, 2578);
    const p = client.request('GET', '/api/v2/users/uid_24');
    await vi.advanceTimersByTimeAsync(2000);
    await p;
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run and confirm all 7 tests fail**

Run: `npx vitest run tests/client.test.ts -t "HoneyBookClient.request"`
Expected: FAIL — `HoneyBookClient` class not exported.

- [ ] **Step 3: Implement `HoneyBookClient` in `src/client.ts`**

Append to `src/client.ts`:

```ts
export class HoneyBookClient {
  constructor(
    private scope: VendorScope,
    private apiVersion: number
  ) {}

  async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
    path: string,
    body?: unknown,
    isVersionRetry = false,
    isRateRetry = false
  ): Promise<T> {
    const headers: Record<string, string> = {
      accept: 'application/json, text/plain, */*',
      'hb-api-auth-token': this.scope.authToken,
      'hb-api-user-id': this.scope.userId,
      'hb-trusted-device': this.scope.trustedDevice,
      'hb-api-client-version': String(this.apiVersion),
      'hb-api-fingerprint': this.scope.fingerprint,
      'hb-api-duplicate-calls-prevention-uuid': crypto.randomUUID(),
      'hb-admin-login': 'false',
    };
    if (body !== undefined) headers['content-type'] = 'application/json';

    const response = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

    if (response.status === 401) {
      throw new Error(
        `HoneyBook auth expired for vendor "${this.scope.slug}". ` +
          `Run \`npm run auth\` to capture a fresh session.`
      );
    }

    if (response.status === 429) {
      if (!isRateRetry) {
        await new Promise<void>((r) => setTimeout(r, 2000));
        return this.request<T>(method, path, body, isVersionRetry, true);
      }
      throw new Error('Rate limited by HoneyBook API');
    }

    if (!response.ok) {
      const text = await response.text();
      // Version drift — re-fetch and retry once
      if (text.includes('HBWrongAPIVersionError') && !isVersionRetry) {
        try {
          const parsed = JSON.parse(text) as { error_data?: { server_api_version?: number } };
          const fresh = parsed.error_data?.server_api_version ?? (await fetchApiVersion());
          this.apiVersion = fresh;
        } catch {
          this.apiVersion = await fetchApiVersion();
        }
        return this.request<T>(method, path, body, true, isRateRetry);
      }
      throw new Error(
        `HoneyBook API error ${response.status} ${response.statusText} for ${method} ${path}: ${text.slice(0, 200)}`
      );
    }

    const text = await response.text();
    return (text ? JSON.parse(text) : null) as T;
  }
}
```

- [ ] **Step 4: Run and confirm all 7 tests pass**

Run: `npx vitest run tests/client.test.ts -t "HoneyBookClient.request"`
Expected: PASS — all 7 cases.

- [ ] **Step 5: Commit**

```bash
git add src/client.ts tests/client.test.ts
git commit -m "feat(client): HoneyBookClient with 8-header request and retry logic"
```

---

## Task 6: Client singleton / factory for tools

**Files:**
- Modify: `src/client.ts`

- [ ] **Step 1: Write failing test for `getClientFor(vendor?)`**

Append to `tests/client.test.ts`:

```ts
import { getClientFor, resetClientsForTest } from '../src/client.js';

describe('getClientFor', () => {
  afterEach(() => {
    resetClientsForTest();
    for (const k of Object.keys(process.env)) {
      if (k.startsWith('HB_') || k === 'HONEYBOOK_VENDORS' || k === 'HONEYBOOK_API_VERSION') delete process.env[k];
    }
  });

  beforeEach(() => {
    process.env.HONEYBOOK_API_VERSION = '2578';
  });

  it('returns the only configured vendor when slug is omitted', async () => {
    process.env.HONEYBOOK_VENDORS = 'silk_veil';
    process.env.HB_SILK_VEIL_AUTH_TOKEN = 'a';
    process.env.HB_SILK_VEIL_USER_ID = 'b';
    process.env.HB_SILK_VEIL_TRUSTED_DEVICE = 'c';
    process.env.HB_SILK_VEIL_FINGERPRINT = 'd';
    const c = await getClientFor();
    expect((c as unknown as { scope: { slug: string } }).scope.slug).toBe('silk_veil');
  });

  it('throws when no vendors configured', async () => {
    await expect(getClientFor()).rejects.toThrow(/HONEYBOOK_VENDORS/);
  });

  it('throws when multiple vendors exist and slug is omitted', async () => {
    process.env.HONEYBOOK_VENDORS = 'a,b';
    for (const v of ['A', 'B']) {
      process.env[`HB_${v}_AUTH_TOKEN`] = 'x';
      process.env[`HB_${v}_USER_ID`] = 'x';
      process.env[`HB_${v}_TRUSTED_DEVICE`] = 'x';
      process.env[`HB_${v}_FINGERPRINT`] = 'x';
      process.env[`HB_${v}_PORTAL_ORIGIN`] = `https://${v.toLowerCase()}.hbportal.co`;
    }
    await expect(getClientFor()).rejects.toThrow(/specify the `vendor` argument/);
  });

  it('throws when slug is not in HONEYBOOK_VENDORS', async () => {
    process.env.HONEYBOOK_VENDORS = 'a';
    process.env.HB_A_AUTH_TOKEN = 'x';
    process.env.HB_A_USER_ID = 'x';
    process.env.HB_A_TRUSTED_DEVICE = 'x';
    process.env.HB_A_FINGERPRINT = 'x';
    process.env.HB_A_PORTAL_ORIGIN = 'https://a.hbportal.co';
    await expect(getClientFor('nonexistent')).rejects.toThrow(/nonexistent.*not in HONEYBOOK_VENDORS/);
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `npx vitest run tests/client.test.ts -t getClientFor`
Expected: FAIL — `getClientFor` not exported.

- [ ] **Step 3: Implement in `src/client.ts`**

Append:

```ts
const clientCache = new Map<string, HoneyBookClient>();
let apiVersionPromise: Promise<number> | null = null;

export function resetClientsForTest(): void {
  clientCache.clear();
  apiVersionPromise = null;
}

export async function getClientFor(vendor?: string): Promise<HoneyBookClient> {
  const scopes = loadVendorScopes();
  const slugs = Object.keys(scopes);
  if (slugs.length === 0) {
    throw new Error(
      'No HoneyBook vendors configured. Set HONEYBOOK_VENDORS and run `npm run auth` to populate credentials.'
    );
  }
  let slug: string;
  if (!vendor) {
    if (slugs.length > 1) {
      throw new Error(
        `Multiple vendors configured (${slugs.join(', ')}). Please specify the \`vendor\` argument.`
      );
    }
    slug = slugs[0]!;
  } else {
    if (!scopes[vendor]) {
      throw new Error(
        `Vendor "${vendor}" not in HONEYBOOK_VENDORS. Configured: ${slugs.join(', ') || '(none)'}.`
      );
    }
    slug = vendor;
  }
  const existing = clientCache.get(slug);
  if (existing) return existing;
  if (!apiVersionPromise) apiVersionPromise = fetchApiVersion();
  const apiVersion = await apiVersionPromise;
  const client = new HoneyBookClient(scopes[slug]!, apiVersion);
  clientCache.set(slug, client);
  return client;
}

export function listConfiguredVendors(): { slug: string; label: string }[] {
  const scopes = loadVendorScopes();
  return Object.values(scopes).map((s) => ({ slug: s.slug, label: s.label }));
}
```

- [ ] **Step 4: Run and confirm all 4 new tests pass**

Run: `npx vitest run tests/client.test.ts -t getClientFor`
Expected: PASS.

- [ ] **Step 5: Run the full test file to confirm no regressions**

Run: `npx vitest run tests/client.test.ts`
Expected: PASS — all tests so far.

- [ ] **Step 6: Commit**

```bash
git add src/client.ts tests/client.test.ts
git commit -m "feat(client): getClientFor factory with default-single-vendor logic"
```

---

## Task 7: `list_vendors` tool (no API)

**Files:**
- Create: `src/tools/vendors.ts`
- Create: `tests/vendors.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/vendors.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { listVendors } from '../src/tools/vendors.js';

describe('listVendors', () => {
  beforeEach(() => {
    for (const k of Object.keys(process.env)) {
      if (k.startsWith('HB_') || k === 'HONEYBOOK_VENDORS') delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of Object.keys(process.env)) {
      if (k.startsWith('HB_') || k === 'HONEYBOOK_VENDORS') delete process.env[k];
    }
  });

  it('returns configured vendors with slug and label', async () => {
    process.env.HONEYBOOK_VENDORS = 'silk_veil,photog';
    process.env.HB_SILK_VEIL_LABEL = 'Silk Veil Events';
    for (const v of ['SILK_VEIL', 'PHOTOG']) {
      process.env[`HB_${v}_AUTH_TOKEN`] = 'x';
      process.env[`HB_${v}_USER_ID`] = 'x';
      process.env[`HB_${v}_TRUSTED_DEVICE`] = 'x';
      process.env[`HB_${v}_FINGERPRINT`] = 'x';
      process.env[`HB_${v}_PORTAL_ORIGIN`] = `https://${v.toLowerCase()}.hbportal.co`;
    }
    const result = await listVendors();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toEqual([
      { slug: 'silk_veil', label: 'Silk Veil Events' },
      { slug: 'photog', label: 'photog' },
    ]);
  });

  it('returns empty array when no vendors configured', async () => {
    const result = await listVendors();
    expect(JSON.parse(result.content[0].text)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run and confirm fails**

Run: `npx vitest run tests/vendors.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/tools/vendors.ts`**

```ts
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
```

- [ ] **Step 4: Run and confirm passes**

Run: `npx vitest run tests/vendors.test.ts`
Expected: PASS — both cases.

- [ ] **Step 5: Commit**

```bash
git add src/tools/vendors.ts tests/vendors.test.ts
git commit -m "feat(tools): list_vendors (env-only, no API call)"
```

---

## Task 8: MCP server entry — minimal with `list_vendors`

**Files:**
- Create: `src/index.ts`

- [ ] **Step 1: Write `src/index.ts`**

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerVendorTools } from './tools/vendors.js';

const server = new McpServer({
  name: 'honeybook-mcp',
  version: '0.1.0',
});

registerVendorTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);
```

- [ ] **Step 2: Also load `.env` at startup — prepend to `src/index.ts`**

Prepend the dotenv-loading block (mirrors `zola-mcp/src/client.ts`):

```ts
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

try {
  const { config } = await import('dotenv');
  const __dirname = dirname(fileURLToPath(import.meta.url));
  config({ path: join(__dirname, '..', '.env'), override: false });
} catch {
  // bundled mode — rely on process.env
}
```

Place this BEFORE the `McpServer` import? No — these are ESM static imports and side-effecting dotenv needs to run before registerVendorTools. Put the dotenv block at the very top of the file, above the MCP imports. Since top-level `await import()` works in ESM, the file becomes:

```ts
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

try {
  const { config } = await import('dotenv');
  const __dirname = dirname(fileURLToPath(import.meta.url));
  config({ path: join(__dirname, '..', '.env'), override: false });
} catch {
  // bundled mode — rely on process.env
}

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerVendorTools } from './tools/vendors.js';

const server = new McpServer({ name: 'honeybook-mcp', version: '0.1.0' });
registerVendorTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);
```

Note: ESM hoists static imports, so the dotenv side effect runs BEFORE any import is resolved (the static imports just pull module records in; dotenv's `config()` executes inline). This matches `zola-mcp`'s pattern where the dotenv block is in `client.ts` at the top.

- [ ] **Step 3: Build and run a smoke test**

Run: `npm run build`
Expected: compiles to `dist/bundle.js` without errors.

Run: `echo '{"jsonrpc":"2.0","method":"initialize","id":1,"params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0.0.1"}}}' | node dist/bundle.js`
Expected: single-line JSON-RPC response with `serverInfo: { name: "honeybook-mcp", version: "0.1.0" }`.

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat: MCP server entry with list_vendors registered"
```

---

## Task 9: `list_workspace_files` + `get_workspace_file` tools

**Files:**
- Create: `src/tools/workspace_files.ts`
- Create: `tests/workspace_files.test.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/workspace_files.test.ts`:

```ts
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import * as clientModule from '../src/client.js';
import { listWorkspaceFiles, getWorkspaceFile } from '../src/tools/workspace_files.js';

const MOCK_FILE = {
  _id: '69db9c003d1e6f0030c46242',
  status: 1,
  status_cd: 'sent',
  status_name: 'Sent',
  created_at: '2026-04-12T13:19:52.838Z',
  file_title: 'Wedding Brochure',
  file_type: 'brochure',
  file_type_cd: 1,
  is_file_accepted: false,
  is_booked_version: true,
  has_pending_payment: false,
  is_canceled: false,
  event: { _id: 'event_id' },
  owner: { _id: 'owner_id', first_name: 'Ivy', last_name: 'Smith' },
  workspace: { _id: 'workspace_id', workspace_status_cd: 'lead' },
};

describe('workspace_files tools', () => {
  let fakeClient: { request: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    fakeClient = { request: vi.fn() };
    vi.spyOn(clientModule, 'getClientFor').mockResolvedValue(
      fakeClient as unknown as clientModule.HoneyBookClient
    );
    // Give the fake client a synthesized scope for url construction
    Object.assign(fakeClient, { scope: { slug: 'silk_veil', userId: 'uid_24' } });
  });

  afterEach(() => vi.restoreAllMocks());

  it('listWorkspaceFiles: hits /users/{uid}/workspace_files and returns the data array', async () => {
    fakeClient.request.mockResolvedValueOnce({
      data: [MOCK_FILE],
      cur_page: null,
      last_page: true,
    });
    const result = await listWorkspaceFiles({});
    expect(fakeClient.request).toHaveBeenCalledWith('GET', '/api/v2/users/uid_24/workspace_files');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].file_type).toBe('brochure');
  });

  it('listWorkspaceFiles: filters by file_type', async () => {
    fakeClient.request.mockResolvedValueOnce({
      data: [
        { ...MOCK_FILE, file_type: 'brochure' },
        { ...MOCK_FILE, _id: 'other_id', file_type: 'agreement' },
      ],
      cur_page: null,
      last_page: true,
    });
    const result = await listWorkspaceFiles({ file_type: 'agreement' });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]._id).toBe('other_id');
  });

  it('listWorkspaceFiles: passes vendor through to getClientFor', async () => {
    fakeClient.request.mockResolvedValueOnce({ data: [], cur_page: null, last_page: true });
    await listWorkspaceFiles({ vendor: 'photog' });
    expect(clientModule.getClientFor).toHaveBeenCalledWith('photog');
  });

  it('getWorkspaceFile: hits /workspace_files/{id}', async () => {
    fakeClient.request.mockResolvedValueOnce(MOCK_FILE);
    const result = await getWorkspaceFile({ file_id: '69db9c003d1e6f0030c46242' });
    expect(fakeClient.request).toHaveBeenCalledWith('GET', '/api/v2/workspace_files/69db9c003d1e6f0030c46242');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed._id).toBe('69db9c003d1e6f0030c46242');
  });
});
```

- [ ] **Step 2: Run and confirm fails**

Run: `npx vitest run tests/workspace_files.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/tools/workspace_files.ts`**

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getClientFor, type HoneyBookClient } from '../client.js';
import type { HBListEnvelope, ToolResult } from '../types.js';
import { FILE_TYPES } from '../types.js';

// The client's scope.userId is needed to build the listing URL. We expose it
// via a tiny accessor on the client to keep types clean.
interface ClientWithScope extends HoneyBookClient {
  scope: { userId: string; slug: string };
}

export async function listWorkspaceFiles(args: {
  vendor?: string;
  file_type?: string;
}): Promise<ToolResult> {
  const client = (await getClientFor(args.vendor)) as ClientWithScope;
  const res = await client.request<HBListEnvelope<Record<string, unknown>>>(
    'GET',
    `/api/v2/users/${client.scope.userId}/workspace_files`
  );
  const filtered = args.file_type
    ? res.data.filter((f) => f.file_type === args.file_type)
    : res.data;
  return { content: [{ type: 'text', text: JSON.stringify(filtered, null, 2) }] };
}

export async function getWorkspaceFile(args: {
  file_id: string;
  vendor?: string;
}): Promise<ToolResult> {
  const client = await getClientFor(args.vendor);
  const res = await client.request<Record<string, unknown>>(
    'GET',
    `/api/v2/workspace_files/${args.file_id}`
  );
  return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
}

export function registerWorkspaceFileTools(server: McpServer): void {
  server.registerTool(
    'list_workspace_files',
    {
      description:
        'List all files a vendor has shared with you (contracts, invoices, brochures, proposals). Optionally filter by file_type.',
      inputSchema: {
        vendor: z
          .string()
          .optional()
          .describe('Vendor slug from list_vendors. Required when multiple vendors are configured.'),
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
      description: 'Get full detail for one workspace file by its _id.',
      inputSchema: {
        file_id: z.string().describe('The file _id from list_workspace_files.'),
        vendor: z.string().optional().describe('Vendor slug. Optional when only one is configured.'),
      },
      annotations: { readOnlyHint: true },
    },
    getWorkspaceFile
  );
}
```

- [ ] **Step 4: Expose `scope` on the client**

In `src/client.ts`, make the constructor assign the scope as a public readonly field:

```ts
export class HoneyBookClient {
  public readonly scope: VendorScope;
  private apiVersion: number;
  constructor(scope: VendorScope, apiVersion: number) {
    this.scope = scope;
    this.apiVersion = apiVersion;
  }
  // ...request() unchanged; any reference to `this.scope.*` already works
}
```

- [ ] **Step 5: Run tests and confirm pass**

Run: `npx vitest run tests/workspace_files.test.ts`
Expected: PASS — all 4 cases.

Run: `npx vitest run tests/client.test.ts`
Expected: PASS — confirm client tests still pass after exposing `scope`.

- [ ] **Step 6: Register the tools in `src/index.ts`**

Add import and registration call:

```ts
import { registerWorkspaceFileTools } from './tools/workspace_files.js';
// ...
registerWorkspaceFileTools(server);
```

- [ ] **Step 7: Commit**

```bash
git add src/tools/workspace_files.ts tests/workspace_files.test.ts src/client.ts src/index.ts
git commit -m "feat(tools): list_workspace_files + get_workspace_file"
```

---

## Task 10: `get_workspace` tool

**Files:**
- Create: `src/tools/workspaces.ts`
- Create: `tests/workspaces.test.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Write failing test**

Create `tests/workspaces.test.ts`:

```ts
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import * as clientModule from '../src/client.js';
import { getWorkspace } from '../src/tools/workspaces.js';

describe('getWorkspace', () => {
  let fakeClient: { request: ReturnType<typeof vi.fn>; scope: { slug: string; userId: string } };

  beforeEach(() => {
    fakeClient = { request: vi.fn(), scope: { slug: 'silk_veil', userId: 'uid_24' } };
    vi.spyOn(clientModule, 'getClientFor').mockResolvedValue(
      fakeClient as unknown as clientModule.HoneyBookClient
    );
  });

  afterEach(() => vi.restoreAllMocks());

  it('hits /workspaces/{id} and returns the workspace', async () => {
    fakeClient.request.mockResolvedValueOnce({
      _id: 'workspace_id',
      workspace_status_cd: 'lead',
      has_sent_files: true,
      has_signed_files: false,
      has_paid_payments: false,
    });
    const result = await getWorkspace({ workspace_id: 'workspace_id' });
    expect(fakeClient.request).toHaveBeenCalledWith('GET', '/api/v2/workspaces/workspace_id');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.workspace_status_cd).toBe('lead');
    expect(parsed.has_sent_files).toBe(true);
  });
});
```

- [ ] **Step 2: Run and confirm fails**

Run: `npx vitest run tests/workspaces.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/tools/workspaces.ts`**

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getClientFor } from '../client.js';
import type { ToolResult } from '../types.js';

export async function getWorkspace(args: {
  workspace_id: string;
  vendor?: string;
}): Promise<ToolResult> {
  const client = await getClientFor(args.vendor);
  const res = await client.request<Record<string, unknown>>(
    'GET',
    `/api/v2/workspaces/${args.workspace_id}`
  );
  return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
}

export function registerWorkspaceTools(server: McpServer): void {
  server.registerTool(
    'get_workspace',
    {
      description:
        'Get full detail for a workspace (vendor project). Includes status flags like has_sent_files, has_signed_files, has_paid_payments.',
      inputSchema: {
        workspace_id: z.string().describe('The workspace _id (found on any workspace_file under .workspace._id).'),
        vendor: z.string().optional().describe('Vendor slug.'),
      },
      annotations: { readOnlyHint: true },
    },
    getWorkspace
  );
}
```

- [ ] **Step 4: Run tests and confirm pass**

Run: `npx vitest run tests/workspaces.test.ts`
Expected: PASS.

- [ ] **Step 5: Register in `src/index.ts`**

```ts
import { registerWorkspaceTools } from './tools/workspaces.js';
// ...
registerWorkspaceTools(server);
```

- [ ] **Step 6: Commit**

```bash
git add src/tools/workspaces.ts tests/workspaces.test.ts src/index.ts
git commit -m "feat(tools): get_workspace"
```

---

## Task 11: `list_payment_methods` tool

**Files:**
- Create: `src/tools/payment_methods.ts`
- Create: `tests/payment_methods.test.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Write failing test**

Create `tests/payment_methods.test.ts`:

```ts
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import * as clientModule from '../src/client.js';
import { listPaymentMethods } from '../src/tools/payment_methods.js';

describe('listPaymentMethods', () => {
  let fakeClient: { request: ReturnType<typeof vi.fn>; scope: { slug: string; userId: string } };

  beforeEach(() => {
    fakeClient = { request: vi.fn(), scope: { slug: 'silk_veil', userId: 'uid_24' } };
    vi.spyOn(clientModule, 'getClientFor').mockResolvedValue(
      fakeClient as unknown as clientModule.HoneyBookClient
    );
  });

  afterEach(() => vi.restoreAllMocks());

  it('hits /users/{uid}/payment_methods and returns the array', async () => {
    fakeClient.request.mockResolvedValueOnce([
      { _id: 'pm1', type: 'credit_card', last4: '4242' },
    ]);
    const result = await listPaymentMethods({});
    expect(fakeClient.request).toHaveBeenCalledWith('GET', '/api/v2/users/uid_24/payment_methods');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].last4).toBe('4242');
  });

  it('returns an empty array when no payment methods are saved', async () => {
    fakeClient.request.mockResolvedValueOnce([]);
    const result = await listPaymentMethods({});
    expect(JSON.parse(result.content[0].text)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run and confirm fails**

Run: `npx vitest run tests/payment_methods.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/tools/payment_methods.ts`:

```ts
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
```

- [ ] **Step 4: Run and confirm passes**

Run: `npx vitest run tests/payment_methods.test.ts`
Expected: PASS.

- [ ] **Step 5: Register in `src/index.ts`** and **Commit**

```ts
import { registerPaymentMethodTools } from './tools/payment_methods.js';
// ...
registerPaymentMethodTools(server);
```

```bash
git add src/tools/payment_methods.ts tests/payment_methods.test.ts src/index.ts
git commit -m "feat(tools): list_payment_methods"
```

---

## Task 12: `sign_contract` tool (deep-link fallback)

**Files:**
- Create: `src/tools/contracts.ts`
- Create: `tests/contracts.test.ts`
- Modify: `src/index.ts`

**Context:** The sign endpoint was not reachable during the static/logged-in probe (`/workspace_files/{id}/sign` returned SPA 404). Until a real signing action can be sniffed, the tool builds a deep-link to the vendor's portal signing page and returns it instead of hitting the API. The structure leaves room for a follow-up PR to wire the real endpoint.

- [ ] **Step 1: Write failing test**

Create `tests/contracts.test.ts`:

```ts
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import * as clientModule from '../src/client.js';
import { signContract } from '../src/tools/contracts.js';

describe('signContract', () => {
  let fakeClient: { request: ReturnType<typeof vi.fn>; scope: { slug: string; userId: string; label: string; portalOrigin: string } };

  beforeEach(() => {
    fakeClient = {
      request: vi.fn(),
      scope: {
        slug: 'silk_veil',
        userId: 'uid_24',
        label: 'Silk Veil Events',
        portalOrigin: 'https://thesilkveileventsbyivy.hbportal.co',
      },
    };
    vi.spyOn(clientModule, 'getClientFor').mockResolvedValue(
      fakeClient as unknown as clientModule.HoneyBookClient
    );
  });

  afterEach(() => vi.restoreAllMocks());

  it('returns a preview (not the deep-link yet) when confirm is missing', async () => {
    fakeClient.request.mockResolvedValueOnce({
      _id: 'file123',
      file_title: 'Wedding Contract',
      file_type: 'agreement',
      is_file_accepted: false,
      workspace: { _id: 'ws1' },
    });
    const result = await signContract({ file_id: 'file123' });
    expect(fakeClient.request).toHaveBeenCalledWith('GET', '/api/v2/workspace_files/file123');
    const text = result.content[0].text;
    expect(text).toContain('Wedding Contract');
    expect(text).toMatch(/confirm.*true/);
  });

  it('returns a deep link when confirm is true', async () => {
    fakeClient.request.mockResolvedValueOnce({
      _id: 'file123',
      file_title: 'Wedding Contract',
      file_type: 'agreement',
      is_file_accepted: false,
      workspace: { _id: 'ws1' },
    });
    const result = await signContract({ file_id: 'file123', confirm: true });
    const text = result.content[0].text;
    expect(text).toContain('https://thesilkveileventsbyivy.hbportal.co/app/workspace_file/file123/agreement');
  });

  it('refuses to sign a non-agreement file', async () => {
    fakeClient.request.mockResolvedValueOnce({
      _id: 'file456',
      file_title: 'Brochure',
      file_type: 'brochure',
    });
    await expect(signContract({ file_id: 'file456', confirm: true })).rejects.toThrow(
      /not an agreement/
    );
  });

  it('refuses to re-sign an already-accepted contract', async () => {
    fakeClient.request.mockResolvedValueOnce({
      _id: 'file123',
      file_type: 'agreement',
      is_file_accepted: true,
    });
    await expect(signContract({ file_id: 'file123', confirm: true })).rejects.toThrow(
      /already signed/
    );
  });
});
```

- [ ] **Step 2: Run and confirm fails**

Run: `npx vitest run tests/contracts.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/tools/contracts.ts`**

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getClientFor } from '../client.js';
import type { ToolResult } from '../types.js';

interface ContractFile {
  _id: string;
  file_title?: string;
  file_type?: string;
  is_file_accepted?: boolean;
  workspace?: { _id?: string };
  status_name?: string;
}

export async function signContract(args: {
  file_id: string;
  vendor?: string;
  confirm?: boolean;
}): Promise<ToolResult> {
  const client = await getClientFor(args.vendor);
  const file = await client.request<ContractFile>(
    'GET',
    `/api/v2/workspace_files/${args.file_id}`
  );
  if (file.file_type !== 'agreement') {
    throw new Error(
      `File ${args.file_id} is not an agreement (file_type=${file.file_type}). Only contracts can be signed.`
    );
  }
  if (file.is_file_accepted) {
    throw new Error(`Contract ${args.file_id} ("${file.file_title}") is already signed.`);
  }
  if (!args.confirm) {
    return {
      content: [
        {
          type: 'text',
          text:
            `About to sign "${file.file_title}" (${file.status_name || 'not signed'}).\n` +
            `Re-run sign_contract with { confirm: true } to proceed.`,
        },
      ],
    };
  }
  const url = `${client.scope.portalOrigin}/app/workspace_file/${file._id}/agreement`;
  return {
    content: [
      {
        type: 'text',
        text:
          `HoneyBook's signing flow requires a browser signature that this MCP cannot replay headlessly yet.\n\n` +
          `Open this link to sign the contract in your HoneyBook portal:\n\n${url}\n\n` +
          `(If you'd like the MCP to sign directly in a future version, sign one contract while running a network capture — see docs/risks.md.)`,
      },
    ],
  };
}

export function registerContractTools(server: McpServer): void {
  server.registerTool(
    'sign_contract',
    {
      description:
        'Sign a contract you received from a vendor. In v1 this returns a deep link to the HoneyBook portal instead of signing headlessly. Requires confirm:true.',
      inputSchema: {
        file_id: z.string().describe('The agreement file _id from list_workspace_files (file_type=agreement).'),
        vendor: z.string().optional().describe('Vendor slug.'),
        confirm: z.boolean().optional().describe('Must be true to proceed. Without this, tool returns a preview.'),
      },
      annotations: { destructiveHint: true },
    },
    signContract
  );
}
```

- [ ] **Step 4: Run and confirm passes**

Run: `npx vitest run tests/contracts.test.ts`
Expected: PASS — all 4 cases.

- [ ] **Step 5: Register in `src/index.ts`** and **Commit**

```ts
import { registerContractTools } from './tools/contracts.js';
// ...
registerContractTools(server);
```

```bash
git add src/tools/contracts.ts tests/contracts.test.ts src/index.ts
git commit -m "feat(tools): sign_contract with deep-link fallback + confirm guard"
```

---

## Task 13: `pay_invoice` tool (deep-link fallback)

**Files:**
- Create: `src/tools/invoices.ts`
- Create: `tests/invoices.test.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Write failing test**

Create `tests/invoices.test.ts`:

```ts
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import * as clientModule from '../src/client.js';
import { payInvoice } from '../src/tools/invoices.js';

describe('payInvoice', () => {
  let fakeClient: { request: ReturnType<typeof vi.fn>; scope: { slug: string; userId: string; label: string; portalOrigin: string } };

  beforeEach(() => {
    fakeClient = {
      request: vi.fn(),
      scope: {
        slug: 'silk_veil',
        userId: 'uid_24',
        label: 'Silk Veil Events',
        portalOrigin: 'https://thesilkveileventsbyivy.hbportal.co',
      },
    };
    vi.spyOn(clientModule, 'getClientFor').mockResolvedValue(
      fakeClient as unknown as clientModule.HoneyBookClient
    );
  });

  afterEach(() => vi.restoreAllMocks());

  it('returns a preview when confirm is missing', async () => {
    fakeClient.request.mockResolvedValueOnce({
      _id: 'inv1',
      file_title: 'Deposit Invoice',
      file_type: 'invoice',
      has_pending_payment: false,
    });
    const result = await payInvoice({ file_id: 'inv1' });
    expect(result.content[0].text).toMatch(/confirm.*true/);
  });

  it('returns a deep link when confirm is true', async () => {
    fakeClient.request.mockResolvedValueOnce({
      _id: 'inv1',
      file_title: 'Deposit Invoice',
      file_type: 'invoice',
      has_pending_payment: false,
    });
    const result = await payInvoice({ file_id: 'inv1', confirm: true });
    expect(result.content[0].text).toContain(
      'https://thesilkveileventsbyivy.hbportal.co/app/workspace_file/inv1/invoice'
    );
  });

  it('refuses when file is not an invoice', async () => {
    fakeClient.request.mockResolvedValueOnce({ _id: 'x', file_type: 'agreement' });
    await expect(payInvoice({ file_id: 'x', confirm: true })).rejects.toThrow(/not an invoice/);
  });

  it('warns when invoice has a pending payment (but still returns deep link)', async () => {
    fakeClient.request.mockResolvedValueOnce({
      _id: 'inv1',
      file_title: 'Deposit Invoice',
      file_type: 'invoice',
      has_pending_payment: true,
    });
    const result = await payInvoice({ file_id: 'inv1', confirm: true });
    expect(result.content[0].text).toMatch(/pending payment/);
  });
});
```

- [ ] **Step 2: Run and confirm fails**

Run: `npx vitest run tests/invoices.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/tools/invoices.ts`**

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getClientFor } from '../client.js';
import type { ToolResult } from '../types.js';

interface InvoiceFile {
  _id: string;
  file_title?: string;
  file_type?: string;
  has_pending_payment?: boolean;
  status_name?: string;
}

export async function payInvoice(args: {
  file_id: string;
  vendor?: string;
  confirm?: boolean;
}): Promise<ToolResult> {
  const client = await getClientFor(args.vendor);
  const file = await client.request<InvoiceFile>('GET', `/api/v2/workspace_files/${args.file_id}`);
  if (file.file_type !== 'invoice') {
    throw new Error(
      `File ${args.file_id} is not an invoice (file_type=${file.file_type}). Only invoices can be paid.`
    );
  }
  if (!args.confirm) {
    return {
      content: [
        {
          type: 'text',
          text:
            `About to pay "${file.file_title}" (${file.status_name || 'open'}).\n` +
            `Re-run pay_invoice with { confirm: true } to proceed.`,
        },
      ],
    };
  }
  const url = `${client.scope.portalOrigin}/app/workspace_file/${file._id}/invoice`;
  const pendingNote = file.has_pending_payment
    ? '\n\nNote: this invoice already has a pending payment — check the status before re-paying.'
    : '';
  return {
    content: [
      {
        type: 'text',
        text:
          `HoneyBook's payment flow requires browser-side card/SCA handling that this MCP cannot replay headlessly yet.\n\n` +
          `Open this link to pay the invoice in your HoneyBook portal:\n\n${url}${pendingNote}`,
      },
    ],
  };
}

export function registerInvoiceTools(server: McpServer): void {
  server.registerTool(
    'pay_invoice',
    {
      description:
        'Pay an invoice from a vendor. In v1 this returns a deep link to the HoneyBook portal instead of paying headlessly. Requires confirm:true.',
      inputSchema: {
        file_id: z.string().describe('The invoice file _id from list_workspace_files (file_type=invoice).'),
        vendor: z.string().optional().describe('Vendor slug.'),
        confirm: z.boolean().optional().describe('Must be true to proceed. Without this, tool returns a preview.'),
      },
      annotations: { destructiveHint: true },
    },
    payInvoice
  );
}
```

- [ ] **Step 4: Run and confirm passes**

Run: `npx vitest run tests/invoices.test.ts`
Expected: PASS — all 4 cases.

- [ ] **Step 5: Register in `src/index.ts`** and **Commit**

```ts
import { registerInvoiceTools } from './tools/invoices.js';
// ...
registerInvoiceTools(server);
```

```bash
git add src/tools/invoices.ts tests/invoices.test.ts src/index.ts
git commit -m "feat(tools): pay_invoice with deep-link fallback + confirm guard"
```

---

## Task 14: `scripts/setup-auth.mjs` — Puppeteer magic-link capture

**Files:**
- Create: `scripts/setup-auth.mjs`
- Create: `scripts/setup-auth.sh`
- Create: `tests/setup-auth.test.ts` (only tests non-browser helpers)

- [ ] **Step 1: Write failing test for slug/env helpers**

Create `tests/setup-auth.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  slugify,
  mergeEnvForVendor,
  parseExistingVendors,
} from '../scripts/setup-auth.mjs';

describe('slugify', () => {
  it('lowercases and replaces non-alphanumerics with underscores', () => {
    expect(slugify('The Silk Veil Events by Ivy LLC')).toBe('the_silk_veil_events_by_ivy_llc');
    expect(slugify('Joe & Jane Photography!')).toBe('joe_jane_photography');
    expect(slugify('  double  spaces  ')).toBe('double_spaces');
  });
});

describe('parseExistingVendors', () => {
  it('extracts comma-separated slugs from an env body', () => {
    const env = 'HONEYBOOK_VENDORS=a,b,c\nOTHER=x';
    expect(parseExistingVendors(env)).toEqual(['a', 'b', 'c']);
  });

  it('returns [] when HONEYBOOK_VENDORS is missing', () => {
    expect(parseExistingVendors('FOO=bar')).toEqual([]);
  });
});

describe('mergeEnvForVendor', () => {
  it('appends new HB_<SLUG>_* block and adds slug to HONEYBOOK_VENDORS', () => {
    const env = 'HONEYBOOK_VENDORS=existing\nHB_EXISTING_AUTH_TOKEN=x\n';
    const merged = mergeEnvForVendor(env, {
      slug: 'photog',
      label: 'Acme Photography',
      authToken: 't',
      userId: 'u',
      trustedDevice: 'd',
      fingerprint: 'f',
      portalOrigin: 'https://acme.hbportal.co',
    });
    expect(merged).toContain('HONEYBOOK_VENDORS=existing,photog');
    expect(merged).toContain('HB_PHOTOG_AUTH_TOKEN=t');
    expect(merged).toContain('HB_PHOTOG_LABEL=Acme Photography');
    expect(merged).toContain('HB_PHOTOG_PORTAL_ORIGIN=https://acme.hbportal.co');
  });

  it('replaces existing block when the slug already exists', () => {
    const env =
      'HONEYBOOK_VENDORS=photog\nHB_PHOTOG_LABEL=Old Label\nHB_PHOTOG_PORTAL_ORIGIN=https://old.hbportal.co\nHB_PHOTOG_AUTH_TOKEN=old\nHB_PHOTOG_USER_ID=u\nHB_PHOTOG_TRUSTED_DEVICE=d\nHB_PHOTOG_FINGERPRINT=f\n';
    const merged = mergeEnvForVendor(env, {
      slug: 'photog',
      label: 'New Label',
      authToken: 'new',
      userId: 'u2',
      trustedDevice: 'd2',
      fingerprint: 'f2',
      portalOrigin: 'https://new.hbportal.co',
    });
    expect(merged).toContain('HB_PHOTOG_AUTH_TOKEN=new');
    expect(merged).toContain('HB_PHOTOG_LABEL=New Label');
    expect(merged).toContain('HB_PHOTOG_PORTAL_ORIGIN=https://new.hbportal.co');
    expect(merged).not.toContain('HB_PHOTOG_AUTH_TOKEN=old');
    expect(merged).not.toContain('HB_PHOTOG_PORTAL_ORIGIN=https://old.hbportal.co');
    // Should only list photog once in the vendors list
    const vendorsLine = merged.split('\n').find((l) => l.startsWith('HONEYBOOK_VENDORS='))!;
    expect(vendorsLine).toBe('HONEYBOOK_VENDORS=photog');
  });

  it('creates the HONEYBOOK_VENDORS line when the file is empty', () => {
    const merged = mergeEnvForVendor('', {
      slug: 'photog',
      label: 'Acme',
      authToken: 't',
      userId: 'u',
      trustedDevice: 'd',
      fingerprint: 'f',
      portalOrigin: 'https://acme.hbportal.co',
    });
    expect(merged).toMatch(/^HONEYBOOK_VENDORS=photog\n/m);
  });
});
```

- [ ] **Step 2: Run and confirm fails**

Run: `npx vitest run tests/setup-auth.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helpers and the Puppeteer script in `scripts/setup-auth.mjs`**

```js
#!/usr/bin/env node
// @ts-check
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { execSync } from 'node:child_process';

export function slugify(input) {
  return String(input)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function parseExistingVendors(envBody) {
  const m = envBody.match(/^HONEYBOOK_VENDORS=(.*)$/m);
  if (!m) return [];
  return m[1]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function mergeEnvForVendor(envBody, captured) {
  const { slug, label, authToken, userId, trustedDevice, fingerprint, portalOrigin } = captured;
  const UP = slug.toUpperCase();
  const newBlock = [
    `HB_${UP}_LABEL=${label}`,
    `HB_${UP}_PORTAL_ORIGIN=${portalOrigin}`,
    `HB_${UP}_AUTH_TOKEN=${authToken}`,
    `HB_${UP}_USER_ID=${userId}`,
    `HB_${UP}_TRUSTED_DEVICE=${trustedDevice}`,
    `HB_${UP}_FINGERPRINT=${fingerprint}`,
  ].join('\n');

  // Strip any existing block for this slug
  const stripped = envBody.replace(new RegExp(`(^HB_${UP}_[A-Z_]+=.*\\n?)+`, 'gm'), '');

  // Update HONEYBOOK_VENDORS
  const existing = parseExistingVendors(stripped);
  const next = existing.includes(slug) ? existing : [...existing, slug];
  const vendorsLine = `HONEYBOOK_VENDORS=${next.join(',')}`;

  let updated;
  if (/^HONEYBOOK_VENDORS=/m.test(stripped)) {
    updated = stripped.replace(/^HONEYBOOK_VENDORS=.*$/m, vendorsLine);
  } else {
    updated = vendorsLine + '\n' + stripped;
  }
  if (!updated.endsWith('\n')) updated += '\n';
  return updated + newBlock + '\n';
}

// Everything below is only run when invoked directly.
const invokedAsScript = import.meta.url === `file://${process.argv[1]}`;

async function main() {
  const envPath = resolve(process.cwd(), '.env');
  const existingEnv = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';

  // Lazy-install puppeteer-core
  let puppeteer;
  try {
    ({ default: puppeteer } = await import('puppeteer-core'));
  } catch {
    console.log('Installing puppeteer-core (first-run only)…');
    execSync('npm install --no-save puppeteer-core@^24.0.0', { stdio: 'inherit' });
    ({ default: puppeteer } = await import('puppeteer-core'));
  }

  const profileDir = join(homedir(), '.honeybook-mcp', 'chrome-profile');
  mkdirSync(profileDir, { recursive: true });
  chmodSync(profileDir, 0o700);

  const chromePath = resolveChromePath();
  const browser = await puppeteer.launch({
    headless: false,
    executablePath: chromePath,
    userDataDir: profileDir,
    defaultViewport: null,
    args: ['--no-first-run', '--no-default-browser-check'],
  });

  const rl = createInterface({ input: stdin, output: stdout });
  let merged = existingEnv;

  try {
    while (true) {
      const url = (
        await rl.question(
          'Paste a magic-link URL from a vendor\'s HoneyBook email (or press Enter to open hbportal.co):\n> '
        )
      ).trim();
      const captured = await captureFromMagicLink(browser, url || 'https://www.hbportal.co');
      const suggestedSlug = slugify(captured.companyName || 'vendor');
      const slug = (
        (await rl.question(`Vendor slug [${suggestedSlug}]: `)).trim() || suggestedSlug
      );
      const label =
        (await rl.question(`Display label [${captured.companyName}]: `)).trim() || captured.companyName;
      merged = mergeEnvForVendor(merged, {
        slug,
        label,
        authToken: captured.authToken,
        userId: captured.userId,
        trustedDevice: captured.trustedDevice,
        fingerprint: captured.fingerprint,
        portalOrigin: captured.portalOrigin,
      });
      writeFileSync(envPath, merged, { mode: 0o600 });
      console.log(`✓ Saved credentials for "${slug}" to ${envPath}`);
      const more = (await rl.question('Add another vendor? [y/N] ')).trim().toLowerCase();
      if (more !== 'y' && more !== 'yes') break;
    }
  } finally {
    rl.close();
    await browser.close();
  }
  console.log('Done.');
}

async function captureFromMagicLink(browser, url) {
  const page = await browser.newPage();
  // Capture hb-api-fingerprint from the first api.honeybook.com request
  const fingerprintPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Timed out waiting for first api.honeybook.com request (30s).')),
      30000
    );
    const onRequest = (req) => {
      const u = req.url();
      if (u.includes('api.honeybook.com/api/v2/')) {
        const fp = req.headers()['hb-api-fingerprint'];
        if (fp) {
          clearTimeout(timer);
          page.off('request', onRequest);
          resolve(fp);
        }
      }
    };
    page.on('request', onRequest);
  });
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

  const fingerprint = await fingerprintPromise;
  const captured = await page.evaluate(() => {
    const j = JSON.parse(localStorage.getItem('jStorage') || '{}');
    const user = j.HB_CURR_USER || {};
    const company = (user.company && user.company.company_name) || '';
    return {
      authToken: j.HB_AUTH_TOKEN,
      userId: j.HB_AUTH_USER_ID,
      trustedDevice: j.HB_TRUSTED_DEVICE,
      companyName: company,
      portalOrigin: location.origin,
    };
  });
  await page.close();
  if (!captured.authToken) throw new Error('No HB_AUTH_TOKEN found — did the magic link fail to load?');
  return { ...captured, fingerprint };
}

function resolveChromePath() {
  const envPath = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (envPath) return envPath;
  const defaults = {
    darwin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    linux: '/usr/bin/google-chrome',
    win32: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  };
  const p = defaults[process.platform];
  if (!p || !existsSync(p)) {
    throw new Error(
      'Google Chrome not found. Install Chrome, or set PUPPETEER_EXECUTABLE_PATH to your Chrome binary.'
    );
  }
  return p;
}

if (invokedAsScript) {
  main().catch((err) => {
    console.error('setup-auth error:', err?.message || err);
    process.exit(1);
  });
}
```

- [ ] **Step 4: Write `scripts/setup-auth.sh`**

```sh
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
exec node scripts/setup-auth.mjs "$@"
```

Then: `chmod +x scripts/setup-auth.sh`

- [ ] **Step 5: Run helper tests and confirm pass**

Run: `npx vitest run tests/setup-auth.test.ts`
Expected: PASS — all cases (these don't invoke Puppeteer; they import only the exported helpers).

- [ ] **Step 6: Commit**

```bash
git add scripts/setup-auth.mjs scripts/setup-auth.sh tests/setup-auth.test.ts
git commit -m "feat(scripts): setup-auth.mjs captures magic-link credentials via Puppeteer"
```

---

## Task 15: Top-level docs (README, SKILL.md, skills/honeybook/SKILL.md, CLAUDE.md)

**Files:**
- Create: `README.md`, `SKILL.md`, `skills/honeybook/SKILL.md`, `CLAUDE.md`

- [ ] **Step 1: Write `CLAUDE.md`** (Claude-Code-facing docs; clone the `zola-mcp` shape)

```md
# honeybook-mcp

MCP server for the HoneyBook client portal — view contracts & invoices from
multiple vendors, with deep-link fallback for signing and paying.

## Commands

```bash
npm run build        # tsc + esbuild bundle
npm test             # vitest run
npm run test:watch   # vitest in watch mode
npm run auth         # Puppeteer magic-link capture
```

## Architecture

```
src/
  index.ts               MCP server entry — registers tool modules, stdio transport
  client.ts              HoneyBookClient — per-vendor auth, headers, request/retry
  types.ts               HBListEnvelope<T>, ToolResult, VendorScope, FileType
  tools/
    vendors.ts           list_vendors (env-only, no API call)
    workspace_files.ts   list_workspace_files, get_workspace_file
    workspaces.ts        get_workspace
    payment_methods.ts   list_payment_methods
    contracts.ts         sign_contract (deep-link fallback + confirm guard)
    invoices.ts          pay_invoice (deep-link fallback + confirm guard)
scripts/
  setup-auth.mjs         Puppeteer-based magic-link capture
```

## Environment

One HoneyBook vendor = one auth scope. Configure via slugged env vars:

```
HONEYBOOK_VENDORS=silk_veil,photog
HB_SILK_VEIL_LABEL=The Silk Veil Events by Ivy
HB_SILK_VEIL_PORTAL_ORIGIN=https://thesilkveileventsbyivy.hbportal.co
HB_SILK_VEIL_AUTH_TOKEN=<43 chars, from localStorage.jStorage.HB_AUTH_TOKEN>
HB_SILK_VEIL_USER_ID=<24-char ObjectId>
HB_SILK_VEIL_TRUSTED_DEVICE=<64 chars>
HB_SILK_VEIL_FINGERPRINT=<32-char FingerprintJS hash, captured from first API request>
# ...repeat per slug
```

`npm run auth` populates these automatically.

## Testing

Tests live in `tests/`. `client.request` is mocked via `vi.spyOn(globalThis, 'fetch')`;
tool handlers mock `getClientFor` to inject a fake client. No live API in CI.

## Plugin / Marketplace

```
.claude-plugin/
  plugin.json       Claude Code plugin manifest
  marketplace.json  Marketplace catalog entry
skills/
  honeybook/SKILL.md
SKILL.md            Full skill reference
manifest.json       mcpb bundle manifest
.mcp.json           MCP server configuration for Claude Code
```

## Versioning

Version appears in FOUR places — all must match:

1. `package.json` → `"version"`
2. `package-lock.json` (regenerated by `npm install --package-lock-only`)
3. `src/index.ts` → `McpServer` constructor `version` field
4. `manifest.json` → `"version"`

Handled automatically by the Cut & Bump GitHub Action. Do NOT manually bump.

## Gotchas

- **ESM + NodeNext**: `.ts` source imports use `.js` extensions.
- **`hb-api-fingerprint` is a FingerprintJS signal** — session-constant and captured once at auth time. If HoneyBook rotates accepted fingerprints, users re-run `npm run auth`.
- **`HB_AUTH_TOKEN` is opaque (not JWT)** — no client-side TTL; server can revoke at will. Expired sessions throw a clear "run npm run auth" error.
- **Write tools return deep links** to the portal in v1 (sign/pay flows require browser-side device/SCA handling that a headless MCP can't replay cleanly). Sniffing during a real sign/pay action is a v2 task.
- **Per-vendor tools** take an optional `vendor` arg. When only one vendor is configured, it's inferred.
```

- [ ] **Step 2: Write `README.md`** (user-facing, clone `zola-mcp/README.md` structure with HB-specific content)

Use the `zola-mcp` README as a template. The "What you can do" / "Requirements" / "Installation" / "Getting your refresh token" (renamed "Getting credentials") / "Credentials" / "Tools" / "Troubleshooting" / "Security" / "Development" sections all apply with minor wording changes.

Actual content:

```md
# HoneyBook MCP

A [Model Context Protocol](https://modelcontextprotocol.io) server that connects Claude to the [HoneyBook](https://www.honeybook.com) client portal, giving you natural-language access to contracts and invoices sent by your wedding vendors.

> [!WARNING]
> **AI-developed project.** This codebase was built and is actively maintained by [Claude Code](https://www.anthropic.com/claude). No human has audited the implementation. Review all code and tool permissions before use.

## What you can do

Ask Claude things like:

- *"List all the HoneyBook vendors I've connected."*
- *"Show me every unsigned contract across my vendors."*
- *"What invoices do I have due in the next month?"*
- *"Summarize the contract from Silk Veil Events."*
- *"Give me a deep link to sign the photographer's contract."*

## Requirements

- [Claude Desktop](https://claude.ai/download) or [Claude Code](https://docs.anthropic.com/en/docs/claude-code)
- [Node.js](https://nodejs.org) 20.6 or later
- Magic-link emails from the wedding vendors that use HoneyBook
- [Google Chrome](https://www.google.com/chrome/) — used by `npm run auth` to capture each vendor's session

## Installation

### From source

```bash
git clone https://github.com/chrischall/honeybook-mcp.git
cd honeybook-mcp
npm install
npm run build
npm run auth    # run once per vendor
```

Add to Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "honeybook": {
      "command": "node",
      "args": ["/absolute/path/to/honeybook-mcp/dist/bundle.js"],
      "env": {
        "HONEYBOOK_VENDORS": "silk_veil,photog",
        "HB_SILK_VEIL_AUTH_TOKEN": "…",
        "HB_SILK_VEIL_USER_ID": "…",
        "HB_SILK_VEIL_TRUSTED_DEVICE": "…",
        "HB_SILK_VEIL_FINGERPRINT": "…",
        "HB_PHOTOG_AUTH_TOKEN": "…"
        // …one block per vendor
      }
    }
  }
}
```

## Credentials

HoneyBook has no public client-portal API. This MCP reuses the same auth state your browser has after clicking a vendor's magic link.

**Per-vendor fields** (all captured by `npm run auth`):

| Env var                        | Source                                                              |
|--------------------------------|---------------------------------------------------------------------|
| `HB_<SLUG>_LABEL`              | Display name for the vendor (from `HB_CURR_USER.company.company_name`) |
| `HB_<SLUG>_PORTAL_ORIGIN`      | The vendor's branded portal origin (e.g. `https://acme.hbportal.co`) — captured from the magic-link URL at auth time |
| `HB_<SLUG>_AUTH_TOKEN`         | `localStorage.jStorage.HB_AUTH_TOKEN`                              |
| `HB_<SLUG>_USER_ID`            | `localStorage.jStorage.HB_AUTH_USER_ID`                            |
| `HB_<SLUG>_TRUSTED_DEVICE`     | `localStorage.jStorage.HB_TRUSTED_DEVICE`                          |
| `HB_<SLUG>_FINGERPRINT`        | `hb-api-fingerprint` header from the first API request after login  |

If you prefer to capture credentials manually, open the vendor's magic-link URL in Chrome, then in the DevTools console:

```js
JSON.parse(localStorage.jStorage).HB_AUTH_TOKEN // → auth token
JSON.parse(localStorage.jStorage).HB_AUTH_USER_ID
JSON.parse(localStorage.jStorage).HB_TRUSTED_DEVICE
```

For the `FINGERPRINT`, open Network tab, click any `api.honeybook.com/api/v2/…` request, and copy the `hb-api-fingerprint` request header.

## Available tools

Tools that touch a vendor take an optional `vendor` argument. When you've only configured one vendor, it's inferred.

| Tool                   | What it does                                              | Permission |
|------------------------|-----------------------------------------------------------|------------|
| `list_vendors`         | Connected vendors from `.env`                             | Auto       |
| `list_workspace_files` | Files from one vendor; filter by type                     | Auto       |
| `get_workspace_file`   | Full detail for one file                                  | Auto       |
| `get_workspace`        | Workspace detail + status flags                           | Auto       |
| `list_payment_methods` | Saved payment methods                                     | Auto       |
| `sign_contract`        | Returns deep link to sign in portal (v1; confirm:true)    | Confirm    |
| `pay_invoice`          | Returns deep link to pay in portal (v1; confirm:true)     | Confirm    |

## Troubleshooting

- **"HoneyBook auth expired for vendor X"** — re-run `npm run auth` for that vendor.
- **"Multiple vendors configured. Please specify the vendor argument."** — pass `vendor` explicitly in your Claude prompt.
- **"Google Chrome not found"** during `npm run auth` — set `PUPPETEER_EXECUTABLE_PATH` to your Chrome binary.

## Security

- Per-vendor tokens live only in your local `.env` or Claude Desktop config
- `.env` is created with `chmod 600`; Chrome profile directory with `chmod 700`
- Write tools (`sign_contract`, `pay_invoice`) require `confirm:true` and return portal deep links rather than signing/paying headlessly

## Development

```bash
npm test        # run tests
npm run build   # tsc + esbuild bundle
```

## License

MIT
```

- [ ] **Step 3: Write `SKILL.md`** (clone `zola-mcp/SKILL.md` trimmed for HB's tool list)

```md
---
name: honeybook-mcp
description: This skill should be used when the user asks about HoneyBook client-portal data. Triggers on phrases like "check HoneyBook", "sign contract", "pay invoice", "HoneyBook vendors", "unsigned contracts", "open invoices", or any request involving wedding-vendor contracts, invoices, brochures, proposals, or payments via HoneyBook.
---

# honeybook-mcp

MCP server for HoneyBook's client portal — 7 tools for viewing contracts and invoices across multiple wedding vendors, with deep-link fallback for signing and paying.

- **Source:** [github.com/chrischall/honeybook-mcp](https://github.com/chrischall/honeybook-mcp)

## Setup

### Option A — Claude Code

Run `npm run auth` to capture a magic-link session for each vendor, then add to `.mcp.json`:

```json
{
  "mcpServers": {
    "honeybook": {
      "command": "node",
      "args": ["/absolute/path/to/honeybook-mcp/dist/bundle.js"],
      "env": { "HONEYBOOK_VENDORS": "silk_veil" }
    }
  }
}
```

Per-vendor env vars (`HB_<SLUG>_*`) live in `.env` or Claude Desktop's env block.

### Option B — from source

```bash
git clone https://github.com/chrischall/honeybook-mcp
cd honeybook-mcp && npm install && npm run build && npm run auth
```

## Tools

| Tool                   | What it does                                          |
|------------------------|-------------------------------------------------------|
| `list_vendors`         | Connected vendors from env                            |
| `list_workspace_files` | All files one vendor has shared (filter by type)      |
| `get_workspace_file`   | Full detail for one file                              |
| `get_workspace`        | Workspace detail + status flags                       |
| `list_payment_methods` | Saved payment methods                                 |
| `sign_contract`        | Deep-link to sign in portal (requires confirm:true)   |
| `pay_invoice`          | Deep-link to pay in portal (requires confirm:true)    |

## Workflows

- **"What contracts haven't I signed?"** → `list_workspace_files` with `file_type=agreement`, filter `is_file_accepted=false`
- **"Summarize my HB status with Silk Veil"** → `get_workspace` (status flags) + `list_workspace_files`
- **"Send me a link to sign the photographer's contract"** → `list_workspace_files` → `sign_contract` with `confirm:true`
- **"Which invoices are overdue?"** → `list_workspace_files` with `file_type=invoice`, sort by due date

## Notes

- All tools hit `api.honeybook.com/api/v2/*` with 8 custom `hb-api-*` headers
- Each vendor = separate auth scope (per-vendor magic link)
- `sign_contract` / `pay_invoice` return deep links in v1 — actual signing/paying requires browser-side device/SCA handling
- Token expires → re-run `npm run auth`
```

- [ ] **Step 4: Write `skills/honeybook/SKILL.md`** — identical to top-level `SKILL.md` but with `name: honeybook` and trimmed tool table (mirror `zola/` skill pattern from `zola-mcp`).

Use the same content as Step 3 but change the frontmatter `name:` to `honeybook`.

- [ ] **Step 5: Build to verify nothing broke, then commit**

Run: `npm run build`
Expected: no errors.

```bash
git add README.md SKILL.md skills/honeybook/SKILL.md CLAUDE.md
git commit -m "docs: README, SKILL, CLAUDE.md"
```

---

## Task 16: Plugin + marketplace manifests

**Files:**
- Create: `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `.mcp.json`, `server.json`, `manifest.json`

- [ ] **Step 1: Write `.mcp.json`**

```json
{
  "mcpServers": {
    "honeybook": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/dist/bundle.js"],
      "env": {
        "HONEYBOOK_VENDORS": "${HONEYBOOK_VENDORS}"
      }
    }
  }
}
```

- [ ] **Step 2: Write `.claude-plugin/plugin.json`**

```json
{
  "name": "honeybook",
  "displayName": "HoneyBook",
  "version": "0.1.0",
  "description": "HoneyBook client-portal MCP for Claude — view wedding-vendor contracts and invoices via MCP",
  "author": {
    "name": "Chris Chall",
    "email": "chris.c.hall@gmail.com"
  },
  "homepage": "https://github.com/chrischall/honeybook-mcp",
  "repository": "https://github.com/chrischall/honeybook-mcp",
  "license": "MIT",
  "keywords": ["honeybook", "wedding", "contracts", "invoices", "mcp"],
  "skills": "./skills/",
  "mcp": "./.mcp.json"
}
```

- [ ] **Step 3: Write `.claude-plugin/marketplace.json`**

```json
{
  "$schema": "https://anthropic.com/claude-code/marketplace.schema.json",
  "name": "chrischall",
  "owner": { "name": "Chris Chall", "email": "chris.c.hall@gmail.com" },
  "metadata": {
    "description": "HoneyBook client-portal tools for Claude Code",
    "version": "0.1.0"
  },
  "plugins": [
    {
      "name": "honeybook",
      "displayName": "HoneyBook",
      "source": "./",
      "description": "HoneyBook client-portal MCP for Claude — view wedding-vendor contracts and invoices via MCP",
      "version": "0.1.0",
      "author": { "name": "Chris Chall" },
      "homepage": "https://github.com/chrischall/honeybook-mcp",
      "repository": "https://github.com/chrischall/honeybook-mcp",
      "license": "MIT",
      "keywords": ["honeybook", "wedding", "contracts", "invoices", "mcp"],
      "category": "productivity"
    }
  ]
}
```

- [ ] **Step 4: Write `server.json`**

```json
{
  "$schema": "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
  "name": "io.github.chrischall/honeybook-mcp",
  "description": "HoneyBook client-portal MCP server for Claude — view contracts and invoices from wedding vendors",
  "repository": { "url": "https://github.com/chrischall/honeybook-mcp", "source": "github" },
  "version": "0.1.0",
  "packages": [
    {
      "registryType": "npm",
      "identifier": "honeybook-mcp",
      "version": "0.1.0",
      "transport": { "type": "stdio" },
      "environmentVariables": [
        {
          "name": "HONEYBOOK_VENDORS",
          "description": "Comma-separated list of vendor slugs (e.g. silk_veil,photog). Each slug must have matching HB_<SLUG>_AUTH_TOKEN, HB_<SLUG>_USER_ID, HB_<SLUG>_TRUSTED_DEVICE, and HB_<SLUG>_FINGERPRINT env vars. Run `npm run auth` to capture.",
          "isRequired": true,
          "format": "string",
          "isSecret": false
        }
      ]
    }
  ]
}
```

- [ ] **Step 5: Write `manifest.json`** (mcpb bundle)

```json
{
  "$schema": "https://raw.githubusercontent.com/anthropics/dxt/main/dist/mcpb-manifest.schema.json",
  "manifest_version": "0.3",
  "name": "honeybook-mcp",
  "display_name": "HoneyBook",
  "version": "0.1.0",
  "description": "HoneyBook client-portal MCP — view wedding-vendor contracts and invoices",
  "author": {
    "name": "Chris Chall",
    "email": "chris.c.hall@gmail.com",
    "url": "https://github.com/chrischall"
  },
  "repository": { "type": "git", "url": "https://github.com/chrischall/honeybook-mcp" },
  "homepage": "https://github.com/chrischall/honeybook-mcp",
  "support": "https://github.com/chrischall/honeybook-mcp/issues",
  "license": "MIT",
  "keywords": ["honeybook", "wedding", "contracts", "invoices"],
  "server": {
    "type": "node",
    "entry_point": "dist/bundle.js",
    "mcp_config": {
      "command": "node",
      "args": ["${__dirname}/dist/bundle.js"],
      "env": {
        "HONEYBOOK_VENDORS": "${user_config.vendors}"
      }
    }
  },
  "user_config": {
    "vendors": {
      "type": "string",
      "title": "HoneyBook Vendors",
      "description": "Comma-separated slug list (e.g. silk_veil,photog). Per-vendor HB_<SLUG>_* secrets must be added to your Claude config's env block separately — see README.md for details.",
      "required": true,
      "sensitive": false
    }
  },
  "tools": [
    { "name": "list_vendors", "description": "Connected HoneyBook vendors" },
    { "name": "list_workspace_files", "description": "Files from one vendor (contracts, invoices, etc.)" },
    { "name": "get_workspace_file", "description": "One file's full detail" },
    { "name": "get_workspace", "description": "Workspace detail with status flags" },
    { "name": "list_payment_methods", "description": "Saved payment methods" },
    { "name": "sign_contract", "description": "Deep-link to sign a contract in the portal" },
    { "name": "pay_invoice", "description": "Deep-link to pay an invoice in the portal" }
  ],
  "compatibility": {
    "platforms": ["darwin", "win32", "linux"],
    "runtimes": { "node": ">=20.6.0" }
  }
}
```

- [ ] **Step 6: Commit**

```bash
git add .claude-plugin .mcp.json server.json manifest.json
git commit -m "feat: plugin / marketplace / mcpb / server.json manifests"
```

---

## Task 17: GitHub Actions (CI, Cut & Bump, Release)

**Files:**
- Create: `.github/workflows/ci.yml`, `.github/workflows/tag-and-bump.yml`, `.github/workflows/release.yml`

- [ ] **Step 1: Copy workflows from `zola-mcp` and rename references**

Copy the three files from `../zola-mcp/.github/workflows/` (CI, tag-and-bump, release). For each file:
1. Replace every occurrence of `zola-mcp` with `honeybook-mcp`
2. Replace every occurrence of `zola` (as package name) with `honeybook`
3. Replace `ZOLA_REFRESH_TOKEN` env references with placeholder/no-op (HB doesn't have a single secret that gates CI)

Concretely, write the files fresh to avoid copying verbatim without verification:

`.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  build-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run build
      - run: npm test
```

`.github/workflows/tag-and-bump.yml`:

```yaml
name: Cut & Bump

on:
  workflow_dispatch: {}

jobs:
  cut-and-bump:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0, token: ${{ secrets.GITHUB_TOKEN }} }
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'npm' }
      - run: npm ci
      - run: npm run build
      - run: npm test
      - name: Read current version
        id: ver
        run: echo "version=$(node -p "require('./package.json').version")" >> "$GITHUB_OUTPUT"
      - name: Tag current version
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git tag -a "v${{ steps.ver.outputs.version }}" -m "v${{ steps.ver.outputs.version }}"
      - name: Bump patch in all four files
        run: |
          npm version patch --no-git-tag-version
          NEW=$(node -p "require('./package.json').version")
          # Sync src/index.ts
          node -e "let f=require('fs');let p='src/index.ts';let s=f.readFileSync(p,'utf8');f.writeFileSync(p,s.replace(/version:\s*'[^']+'/,\"version: '$NEW'\"))"
          # Sync manifest.json
          node -e "let f=require('fs');let p='manifest.json';let m=JSON.parse(f.readFileSync(p,'utf8'));m.version='$NEW';f.writeFileSync(p,JSON.stringify(m,null,2)+'\n')"
      - name: Commit bump and push
        run: |
          git add package.json package-lock.json src/index.ts manifest.json
          git commit -m "chore: bump to $(node -p "require('./package.json').version")"
          git push origin HEAD --tags
```

`.github/workflows/release.yml`:

```yaml
name: Release

on:
  push:
    tags: ['v*']

jobs:
  release:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
        with: { ref: ${{ github.ref }} }
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'npm', registry-url: 'https://registry.npmjs.org' }
      - run: npm ci
      - run: npm run build
      - run: npm test
      - name: Package mcpb bundle
        run: npx -y @anthropic-ai/mcpb pack
      - name: Publish to npm
        run: npm publish
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
      - name: Create GitHub Release
        uses: softprops/action-gh-release@v2
        with:
          files: |
            *.mcpb
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows
git commit -m "ci: CI, Cut & Bump, and Release workflows"
```

---

## Task 18: Final verification

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all tests green across `client`, `vendors`, `workspace_files`, `workspaces`, `payment_methods`, `contracts`, `invoices`, `setup-auth`.

- [ ] **Step 2: Type-check and bundle**

Run: `npm run build`
Expected: `dist/bundle.js` exists; no TypeScript errors.

- [ ] **Step 3: End-to-end smoke — list_vendors on a real .env**

Ensure `.env` exists (either via `npm run auth` with a real magic link or by pasting known values). Then:

```bash
printf '%s\n%s\n' \
  '{"jsonrpc":"2.0","method":"initialize","id":1,"params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0.0.1"}}}' \
  '{"jsonrpc":"2.0","method":"tools/call","id":2,"params":{"name":"list_vendors","arguments":{}}}' \
  | node --env-file=.env dist/bundle.js | head -5
```

Expected: two JSON-RPC responses; the second contains a content block listing configured vendors.

- [ ] **Step 4: End-to-end smoke — list_workspace_files**

Run the same idiom with a tool call for `list_workspace_files`:

```bash
printf '%s\n%s\n' \
  '{"jsonrpc":"2.0","method":"initialize","id":1,"params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0.0.1"}}}' \
  '{"jsonrpc":"2.0","method":"tools/call","id":2,"params":{"name":"list_workspace_files","arguments":{}}}' \
  | node --env-file=.env dist/bundle.js | head -5
```

Expected: response includes a file list from HoneyBook, or a clear "auth expired" error.

- [ ] **Step 5: Commit the built dist (optional — zola-mcp doesn't; skip unless Claude config needs it)**

Not required — `dist/` is in `.gitignore`; the release workflow builds it fresh.

---

## Self-review — spec coverage map

| Spec requirement                                               | Task(s)                |
|----------------------------------------------------------------|------------------------|
| TypeScript ESM + MCP SDK + esbuild + stdio transport           | 1, 8                   |
| `HoneyBookClient` with 8 required headers and retry logic      | 5                      |
| Per-vendor scope loading from slugged env                      | 3                      |
| `list_vendors` env-only tool                                   | 7                      |
| Read tools for workspace_files, workspaces, payment methods    | 9, 10, 11              |
| Write tools with deep-link fallback + confirm guard            | 12, 13                 |
| `npm run auth` Puppeteer magic-link capture                    | 14                     |
| mcpb bundle, plugin, marketplace, server.json, .mcp.json       | 16                     |
| README, SKILL.md (top + skills/), CLAUDE.md                    | 15                     |
| CI, Cut & Bump, Release workflows                              | 17                     |
| Vitest coverage for client + every tool + setup-auth helpers   | 3, 5, 6, 7, 9, 10, 11, 12, 13, 14 |
| `HONEYBOOK_API_VERSION` override + `/api/gon` bootstrap        | 4, 5                   |
| Error handling: 401 → auth-expired, 429 retry, version retry   | 5                      |

All spec items mapped. No placeholders in plan steps. Types, method signatures, and env-var names consistent across tasks.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-20-honeybook-mcp.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
