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
                         401 + 404/HBUnauthorizedError, 429, HBWrongAPIVersion
                         handling; getActiveClient() resolves
                         a session from sessionStore and caches a client per origin
  auth.ts                captureSessionViaFetchproxy() — one-shot @fetchproxy/bootstrap
                         call that reads localStorage["HONEYBOOK_REACT_CURR_USER"]
                         out of the user's signed-in portal tab, then closes the
                         bridge. See "Auth flow" below.
  flows.ts               Questionnaire ("flow") links: parseFlowLink /
                         isFlowLinkUrl / flowStorageKey, and the flowStore
                         (own file, ~/.honeybook-mcp/flows.json)
  flow-auth.ts           captureFlowCredentialViaFetchproxy() — same lift as
                         auth.ts, pointed at HONEYBOOK_REACT_WEAK_AUTH_<flowId>
  flow-client.ts         FlowClient — weak-auth headers over the shared
                         hbApiRequest; getActiveFlowClient()
  sessions.ts            Thin adapter over the disk-persisted SessionStore from
                         @chrischall/mcp-utils/session (this repo was the donor it
                         was extracted from); re-exports normalizeOrigin and the
                         configured sessionStore singleton
  types.ts               HBListEnvelope<T>, ToolResult, CapturedSession, CapturedFlowCredential, FileType
  tools/
    sessions.ts          use_magic_link, list_active_sessions (both kinds)
    flows.ts             use_flow_link, get_flow
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
a single capability: `read_local_storage`.

1. User clicks a vendor's HoneyBook magic-link in their real Chrome (extension
   installed). The link signs them into `*.hbportal.co`.
2. User calls `use_magic_link` with the magic-link URL. `src/tools/sessions.ts`
   derives the portalOrigin and calls `captureSessionViaFetchproxy` in
   `src/auth.ts`.
3. `captureSessionViaFetchproxy` invokes `@fetchproxy/bootstrap` with:
   - `domains: ['honeybook.com', 'hbportal.co']` (multi-domain; extension
     suffix-matches)
   - `declare.localStoragePointers` into `HONEYBOOK_REACT_CURR_USER`:
     `/authentication_token`, `/_id`, `/trusted_device`,
     `/company/company_name`, plus a legacy `jStorage./HB_TRUSTED_DEVICE`
     fallback
   - `declare.captureHeaders: []` — nothing is sniffed off a live request
4. Bootstrap snapshots the declared fields in one round-trip, closes the bridge.
5. The synthesized `CapturedSession` is persisted to
   `~/.honeybook-mcp/sessions.json` (mode 0600, directory mode 0700).
6. All subsequent API calls go via plain Node `fetch` to api.honeybook.com —
   fetchproxy is NOT in the request hot path.

Tools default to the most-recently-activated session; pass `origin` to target
a specific vendor when multiple sessions are active.

### The second link shape: questionnaires ("flows")

A vendor also sends `/flow/<flowId>?hash=…` links. They do NOT sign anyone into
the portal — the page writes a per-flow **weak auth** record instead:

```
localStorage["HONEYBOOK_REACT_WEAK_AUTH_<flowId>"] =
  {"hash": <?hash= from the URL>, "_id": …, "email": …, "is_real_chargeable_user": …}
```

and sends it as `HB-Api-W-Hash` / `HB-Api-W-User-Id` / `HB-Api-W-Email` — never
`HB-Api-Auth-Token`. (Key name and JSON shape from `getLimitedAuthStorageKey` /
`setWeakTokenInStorage` / `getHeaders` in the shipped flow app at
`public.honeybook.com/public_react_flow_app/<build>/main.<hash>.js`; header
names from `hb_api_headers.weak_auth_*` in `https://api.honeybook.com/api/gon`.
Both read 2026-08-31.)

`use_flow_link` captures it into `~/.honeybook-mcp/flows.json`; `get_flow`
performs the read the questionnaire page makes to render — **two calls**:

```
GET /api/v2/flow/<flowId>/minimal?user_id=<userId>      public, no credential
GET /api/v2/client/flow/<flowId>/active?ctxc=<companyId>
    headers: hb-api-w-hash, hb-api-w-user-id, hb-api-client-version
```

Three traps, all of them things a static read of the app's adapter gets wrong
(0.8.0's unreleased first cut got all three; a HAR of the live questionnaire on
2026-08-31 settled them):

- **`/client/` is injected below the adapter.** `_fetchFlow` composes
  `/api/v2/flow/<id>/active`; the shared interceptor then applies
  `addClientToUrl(u) => u.replace('/api/v2/', '/api/v2/client/')`. Grepping the
  bundle for the literal path finds only the pre-rewrite form.
- **`ctxc` is required**, set by that same interceptor from
  `clientPortalConfigStore.clientPortalCompanyId`. It is
  `branding_data.company_id` in the `/minimal` response — the only 24-hex value
  there. `/minimal` takes `user_id` as a QUERY param, not a header, and needs no
  credential, so it is not given one.
- **`hb-api-client-version` is required**, isolated by elimination: hash +
  user-id alone is a 400, adding `hb-api-fingerprint` is still a 400, adding the
  version makes it a 200 (96,246 bytes).

None of this is visible by probing without a credential: BOTH `/api/v2/flow/…`
and `/api/v2/client/flow/…` answer 404 + `HBUnauthorizedError` unauthenticated,
so only a real 200 tells the two apart.

Optional env vars:

```
HONEYBOOK_API_VERSION=2601         # pin instead of auto-fetching from /api/gon
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
No live API calls in CI. `tests/sessions.test.ts` asserts the adapter wiring
(`normalizeOrigin` re-export, store key normalization, persistence, hardened
file perms, corrupt-file preservation) against a temp-path store.

`vitest.config.ts` configures the v8 coverage provider but does NOT enforce
thresholds — CI runs `npm test` (no coverage gate).

## Plugin / Marketplace

```
.claude-plugin/
  plugin.json       Claude Code plugin manifest (points at .mcp.json + skills/)
  marketplace.json  Marketplace catalog entry
skills/
  honeybook/SKILL.md
  honeybook-fpx/SKILL.md
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

Handled automatically by release-please. Do NOT manually bump versions or create
tags unless the user explicitly asks.

### Release flow

Commits land on `main` via PR. release-please
(`.github/workflows/release-please.yml`) opens or updates a
`chore(main): release X.Y.Z` PR whenever Conventional-Commit messages (`feat:`,
`fix:`, etc.) accumulate. Merging the release PR (arm `ready-to-merge`) creates
the tag and a GitHub Release; the `publish` job then packs `.mcpb` + `.skill`,
publishes to npm with provenance, and pushes to the MCP Registry.

## Gotchas

- **ESM + NodeNext**: `.ts` source imports use `.js` extensions
  (e.g. `import { sessionStore } from './sessions.js'`).
- **Auth lives in `HONEYBOOK_REACT_CURR_USER`, not `jStorage`.** HoneyBook
  migrated the client-portal session out of the AngularJS `jStorage` blob;
  only `HB_TRUSTED_DEVICE` survived there. Pointing at the old keys broke
  every capture (fixed in 0.4.5).
- **Changing `declare` in `auth.ts` is a BREAKING change for existing users.**
  The extension approves a scope at pair time, so any new/renamed storage key
  is refused (`keys not in declared set`) until the user revokes this MCP in
  the Transporter popup and re-approves. 0.4.5 did exactly that — see
  "Upgrading from 0.4.4 or earlier" in README.md. Ship a scope change with an
  upgrade note, and test it by revoking and re-pairing, not just by running a
  capture on an already-approved machine.
- **`hb-api-fingerprint` and `hb-trusted-device` are optional.** The API
  answers 200 without either, verified against
  `/api/v2/users/{uid}/workspace_files`. Only `hb-api-auth-token`,
  `hb-api-user-id` and a current `hb-api-client-version` are load-bearing, so
  neither is required at capture time and both are sent only when present.
  Sessions captured by <=0.4.4 still carry a fingerprint and keep working.
- **The auth token is opaque (not JWT)** — no client-side TTL; server can
  revoke at will. Expired sessions throw a clear "re-run use_magic_link" error.
- **A dead token returns 404, not 401.** The API answers `404` with an
  `HBUnauthorizedError` body, so `client.request` reroutes that specific
  combination to the expired-session error; other 404s stay plain API errors.
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
- **Two credential kinds, two stores, no fallback between them.** A portal
  session (`sessionStore`, `sessions.json`) and a flow credential (`flowStore`,
  `flows.json`) authorise different things, so they are separate types in
  separate files. That is what makes "a portal tool cannot silently accept a
  flow credential" structural rather than a check each call site has to
  remember: `sessionStore.get()` cannot return one. The refusals name the kind
  present and the kind required, and each capture tool refuses the other's link
  shape via the ONE shared `isFlowLinkUrl` predicate.
- **`isNoPortalSessionError`, never a message match.** The "no portal session"
  refusal names `use_magic_link` as the REMEDY and the healthcheck's rejection
  regex matches that same literal as a SYMPTOM. `client.ts` exports the error
  class and the predicate; `tools/healthcheck.ts` imports the predicate. An
  equality check against one message (what shipped in 0.7.1) would have stopped
  covering the flow-credential variant of the same condition silently.
- **A flow's declared scope contains the flow id**, so each new questionnaire
  is a new key the extension has not approved. The re-approval prompt is
  expected once per flow, and `flow-auth.ts` says so in the scope-error branch
  rather than reusing the generic "open the link in Chrome" copy.
- **`hbApiRequest` is shared by both clients** (`client.ts`). The 401, the
  404 + `HBUnauthorizedError` disguise, the 429 backoff and the
  `HBWrongAPIVersionError` refresh are identical for both credential kinds;
  only the identity headers and the "re-capture it" error differ, and those are
  the `HbApiCaller` seam. Verified live that a flow route answers the same 404
  disguise: an unauthenticated `GET /api/v2/client/flow/<id>/active` returns
  `404 {"error_type":"HBUnauthorizedError"}`.
- **A bare 400 from a flow read is NOT an auth failure.** A missing or stale
  `hb-api-client-version`, or a missing `ctxc`, answers `400 "Unexpected server
  error"` with no `error_type` — which reads exactly like a dead credential and
  sends people to re-capture a working one. `hbApiRequest` throws a typed
  `HoneyBookApiError` carrying `.status`, and `FlowClient.request` branches on
  that status (never on the message) to name both causes and deny the auth
  reading. `get_flow` refuses up front when `/minimal` carries no `ctxc`, rather
  than making the call and inheriting the same ambiguous 400.

<!-- pr-workflow:v3 -->
## Pull requests & release notes

Fleet policy — Conventional-Commit PR titles, labels, the auto-review /
auto-merge ladder, auto-review follow-up issues, PR timing, and release PRs —
lives in `~/.claude/CLAUDE.md`. Don't restate it here; the copies drifted.

Shared technical conventions (publishing, bundling, versioning guards,
write-verification, transport archetypes, testing traps) live in
[`chrischall/workflows`](https://github.com/chrischall/workflows):
`docs/fleet-conventions.md`, plus `README.md` for the CI pipeline contract.

