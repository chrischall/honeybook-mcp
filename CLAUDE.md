# honeybook-mcp

MCP server for the HoneyBook client portal — view contracts & invoices from
multiple vendors (each vendor = one captured session), with deep-link fallback
for signing and paying.

## Commands

```bash
npm run build        # tsc + esbuild bundle → dist/bundle.js
npm run bundle       # esbuild only (no tsc check)
npm test             # vitest run
npm run test:watch   # vitest in watch mode
npm run dev          # node --env-file=.env dist/index.js (requires built dist)
```

## Architecture

```
src/
  index.ts               MCP server entry — registers tool modules, stdio transport
  client.ts              HoneyBookClient — per-session auth headers, fetch wrapper,
                         401/429/HBWrongAPIVersion retry; getActiveClient() resolves
                         a session from sessionStore and caches a client per origin
  auth.ts                captureSessionViaFetchproxy() — one-shot @fetchproxy/bootstrap
                         call that reads localStorage["jStorage"] + the
                         hb-api-fingerprint request header out of the user's signed-in
                         portal tab, then closes the bridge. See "Auth flow" below.
  sessions.ts            SessionStore — disk-persisted session cache; pure helpers
                         (normalizeOrigin, serializeSessions, deserializeSessions) are
                         exported for unit tests
  types.ts               HBListEnvelope<T>, ToolResult, CapturedSession, FileType
  tools/
    sessions.ts          use_magic_link, list_active_sessions
    workspace_files.ts   list_workspace_files, get_workspace_file (+ section
                         filtering + heavy-field pruning to keep responses small)
    workspaces.ts        get_workspace
    payment_methods.ts   list_payment_methods
    contracts.ts         sign_contract (deep-link fallback + confirm guard)
    invoices.ts          pay_invoice (deep-link fallback + confirm guard)
```

Each tool module exports a `register*Tools(server)` function called from `src/index.ts`.

## Auth flow

No env vars required for HoneyBook itself. Sessions are captured at runtime
via the [fetchproxy browser extension](https://github.com/chrischall/fetchproxy)
(installed once per browser, Chrome Web Store / Safari .dmg). The MCP exercises
TWO capabilities at once: `read_local_storage` AND
`capture_request_header`.

1. User clicks a vendor's HoneyBook magic-link in their real Chrome (extension
   installed). The link signs them into `*.hbportal.co`.
2. User calls `use_magic_link` with the magic-link URL. `src/tools/sessions.ts`
   derives the portalOrigin and calls `captureSessionViaFetchproxy` in
   `src/auth.ts`.
3. `captureSessionViaFetchproxy` invokes `@fetchproxy/bootstrap` with:
   - `domains: ['honeybook.com', 'hbportal.co']` (multi-domain; extension
     suffix-matches)
   - `declare.localStorage: ['jStorage']` — single key holding HB_AUTH_TOKEN,
     HB_AUTH_USER_ID, HB_TRUSTED_DEVICE, HB_CURR_USER
   - `declare.captureHeaders: [{ urlPattern: 'https://api.honeybook.com/api/v2/*',
     headerName: 'hb-api-fingerprint' }]` — captures the per-device
     FingerprintJS signal off the page's next outgoing API request
4. Bootstrap snapshots both buckets in one round-trip, closes the bridge.
5. The synthesized `CapturedSession` is persisted to
   `~/.honeybook-mcp/sessions.json` (mode 0600, directory mode 0700).
6. All subsequent API calls go via plain Node `fetch` to api.honeybook.com —
   fetchproxy is NOT in the request hot path.

Tools default to the most-recently-activated session; pass `origin` to target
a specific vendor when multiple sessions are active.

Optional env vars:

```
HONEYBOOK_API_VERSION=2578         # pin instead of auto-fetching from /api/gon
HONEYBOOK_DISABLE_FETCHPROXY=1     # refuse to call bootstrap (CI / headless)
```

`readEnv()` in `client.ts`/`auth.ts` treats blank strings and unsubstituted
`${FOO}` placeholders as unset — defends against MCP hosts that pass `.mcp.json`
env blocks through unexpanded.

## Testing

Tests live in `tests/`. `client.request` is exercised by mocking
`globalThis.fetch` with `vi.spyOn`; tool handlers mock `getActiveClient` to
inject a fake client. `@fetchproxy/bootstrap` is mocked at the module
boundary in `tests/auth.test.ts` so capture flows never hit a real WebSocket.
No live API calls in CI. `sessions.ts` pure helpers
(`normalizeOrigin`, `serialize/deserializeSessions`) are unit-tested directly.

`vitest.config.ts` configures the v8 coverage provider but does NOT enforce
thresholds — CI runs `npm test` (no coverage gate).

## Plugin / Marketplace

```
.claude-plugin/
  plugin.json       Claude Code plugin manifest (points at .mcp.json + skills/)
  marketplace.json  Marketplace catalog entry
skills/
  honeybook/SKILL.md
SKILL.md            Top-level skill reference (also packaged into the .skill bundle)
manifest.json       mcpb bundle manifest
.mcp.json           MCP server configuration for Claude Code
server.json         modelcontextprotocol/registry manifest
```

## Publishing constraints

The MCP Registry's [server.schema.json](https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json) caps `server.json`'s `description` at **100 characters**. Values over that fail `mcp-publisher publish` with HTTP 422 (`validation failed: expected length <= 100, location: body.description`). The other description fields (`manifest.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`) have no published length constraint and can stay longer.

Sanity-check before committing a description change:

```bash
jq -r '.description | length' server.json
```

## Versioning

Version appears in SEVEN places — all must match:

1. `package.json` → `"version"`
2. `package-lock.json` (regenerated by `npm install --package-lock-only`)
3. `src/index.ts` → `McpServer` constructor `version` field
4. `manifest.json` → `"version"`
5. `server.json` → `"version"` and `packages[0].version`
6. `.claude-plugin/plugin.json` → `"version"`
7. `.claude-plugin/marketplace.json` → `metadata.version` and `plugins[0].version`

Handled automatically by the **Tag & Bump** GitHub Action
(`.github/workflows/tag-and-bump.yml`). Do NOT manually bump versions or create
tags unless the user explicitly asks.

### Release workflow

Main is always one version ahead of the latest tag. Trigger **Tag & Bump** to:

1. Run CI (build + test)
2. Tag the current commit with the current `package.json` version
3. Bump patch via `npm version patch` + an inline Node script that walks every
   JSON version field (and `sed` for `src/index.ts`)
4. Rebuild, commit, and push main + tag

The tag push triggers the **Release** workflow (`.github/workflows/release.yml`)
which builds, publishes to npm with provenance, packages a `.skill` and `.mcpb`
bundle, publishes to the MCP registry via `mcp-publisher` (GitHub OIDC),
optionally pushes the skill to ClawHub (if `CLAWHUB_TOKEN` is set), and creates
a GitHub Release with auto-generated notes (see `.github/release.yml`).

## Gotchas

- **ESM + NodeNext**: `.ts` source imports use `.js` extensions
  (e.g. `import { sessionStore } from './sessions.js'`).
- **`hb-api-fingerprint` is a FingerprintJS signal** — session-constant and
  captured once at auth time off a real outgoing request via the fetchproxy
  `captureHeaders` declaration. If HoneyBook rotates accepted fingerprints,
  users re-run `use_magic_link`.
- **`HB_AUTH_TOKEN` is opaque (not JWT)** — no client-side TTL; server can
  revoke at will. Expired sessions throw a clear "re-run use_magic_link" error.
- **Write tools return deep links** — `sign_contract` and `pay_invoice` produce
  portal URLs instead of signing/paying headlessly (browser-side device/SCA
  handling cannot be replayed). Both require `confirm: true`.
- **Per-vendor tools** take an optional `origin` arg. When only one session is
  active, it is inferred. With multiple, callers must pass `origin`.
- **No Puppeteer in the bundle.** v0.2 replaced the embedded headless Chrome
  flow with a one-shot `@fetchproxy/bootstrap` call. The bundle has no native
  binary, no lazy install, and no `vendor/` directory to manage.
- **`use_magic_link` does NOT navigate to the URL.** The arg is used only to
  derive the portalOrigin. The user must already have the link open in their
  signed-in Chrome (with the fetchproxy extension) before calling the tool.
- **API version auto-refresh**: on `HBWrongAPIVersionError`, `client.request`
  re-reads the version from the error body (or `/api/gon`) and retries once.
- **Rate limiting**: 429 responses trigger a single 2-second retry before
  surfacing.
- **stdio transport**: server only writes to stderr (`process.stderr.write`);
  stdout is reserved for JSON-RPC. `dotenv` is imported dynamically and only
  loaded if present (bundled mode falls back to `process.env`).
- **Heavy-field pruning**: `workspace_files.ts#pruneWorkspaceFile` strips
  vendor-side fields like `vendor_emails` (observed ~1.3 MB on a single real
  proposal) by default. Pass `section: 'raw'` to keep them.
- **Sessions persist across restarts**: `~/.honeybook-mcp/sessions.json` is
  re-loaded on startup; most-recent origin = last in insertion order.

<!-- pr-workflow:v1 -->
## Pull requests & release notes

**Default workflow: branch + PR, even for solo work.** Direct pushes to `main` skip review *and* skip auto-generated release notes — GitHub's `generate_release_notes` (configured in `.github/release.yml`) only picks up merged PRs. Push directly to `main` only when the user explicitly asks for it (e.g. emergency hotfix).

For every PR, apply exactly one label so it lands in the right release-notes section:

| Label                | Section in release notes |
|----------------------|--------------------------|
| `enhancement`        | Features                 |
| `bug`                | Bug Fixes                |
| `security`           | Security                 |
| `refactor`           | Refactor                 |
| `documentation`      | Documentation            |
| `test`               | Tests                    |
| `dependencies`       | Dependencies             |
| `ci` / `github_actions` | CI & Build            |
| *(none / unmatched)* | Other Changes            |
| `ignore-for-release` | Hidden from notes        |

The **PR title** becomes the bullet — write it like a user-facing changelog entry (`ck_set_session: refuse stale refresh tokens`), not internal shorthand (`auth tweaks`). Conventional-commit prefixes (`feat:`, `fix:`, `chore:`) are still fine in commit messages, but the PR title should read clean.

Open with `gh pr create --label <label>` (or `--label ignore-for-release` for chores not worth a line), then **immediately** run `gh pr merge <num> --auto --merge` so the PR merges as soon as CI passes. The repo allows merge commits only (no squash, no rebase) — don't pass `--squash`/`--rebase` or the call will fail.
