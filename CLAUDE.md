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
  sessions.ts            Thin adapter over the disk-persisted SessionStore from
                         @chrischall/mcp-utils/session (this repo was the donor it
                         was extracted from); re-exports normalizeOrigin and the
                         configured sessionStore singleton
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
   - `declare.captureHeaders: [{ host: 'api.honeybook.com', path: '/api/v2/*',
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

<!-- pr-workflow:v2 -->
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

**Exception for first-party dependency bumps.** When bumping a package we own (currently `@fetchproxy/bootstrap` — anything published from a chrischall-owned repo), label the PR `enhancement` or `bug` instead of `dependencies`, and use the matching commit prefix (`feat:` or `fix:`) instead of `chore:`. Those bumps deliver real product fixes or features through us, so they should drive a release-please version bump and show up under Features/Bug Fixes in the release notes — not get hidden under "Dependencies" (which doesn't trigger a release).

The **PR title MUST be a Conventional Commit**, written user-facing (`fix(scope): …`, `feat(scope): …`), not internal shorthand. Because the repo squash-merges, the PR title *becomes the squash commit's subject line* — the only thing release-please parses to pick the version bump and changelog section. Only `feat` (minor), `fix` (patch), and `!`/`BREAKING CHANGE` (major) cut a release; `perf`/`refactor`/`docs` show in the changelog without bumping; `ci`/`test`/`build`/`chore` are recognised but hidden (see `release-please-config.json` → `changelog-sections`). A title without a conventional type is invisible to release-please — no bump, no changelog line. Prefixes in *individual commits* don't help; squash keeps only the title.

### How PRs merge

**Don't run `gh pr merge` yourself.** The automation does it:

1. `pr-auto-review.yml` runs a Claude review on every PR **except** the release-please release PR (which it deliberately skips). A `pass` **or** `warn` verdict adds the `ready-to-merge` label; `warn` and `fail` also open/update an `auto-review-followup` issue capturing the findings (see [Auto-review follow-up issues](#auto-review-follow-up-issues)). Only `fail` blocks the merge.
2. `auto-merge.yml`, on the `ready-to-merge` label (or on a dependabot PR), arms `gh pr merge --auto --squash`. The moment CI is green the PR squash-merges itself.

For ordinary feature/fix PRs, opening with `gh pr create --label <label>` (or `--label ignore-for-release` for chores not worth a release-notes line) is the whole job. `pass`/`warn` self-arm; if the verdict was `fail` but you've decided to ship anyway, add the label yourself: `gh pr edit <num> --add-label ready-to-merge`.

### Auto-review follow-up issues

When a PR's auto-review verdict is `warn` or `fail`, the `chrischall/workflows` pipeline opens or updates a single `auto-review-followup` issue ("Auto-review follow-ups for PR #N") whose checklist captures every finding, and links it from the PR's `<!-- auto-review-verdict -->` comment (`📋 Tracking follow-ups: #N`). `warn` (nits only) still auto-merges — the issue carries the nits forward, so most nits are fixed in a *later* PR; `fail` blocks until the important findings are addressed on the PR itself.

When asked to address the auto-review comments / review findings on a PR:

1. Read the verdict comment, open the linked `auto-review-followup` issue, and treat its checklist as the work list (alongside any inline review comments).
2. Resolve each item, checking off only what you've **verified** is genuinely fixed.
3. If every item is resolved on the current PR, add `Closes #<issue>` to that PR's body so the merge closes it; if some are deferred, check off only the resolved ones and leave the issue open.
4. For nits whose `warn` PR already auto-merged, address them in a follow-up PR that references `Closes #<issue>`.

(Mirrors the fleet-wide convention in `~/.claude/CLAUDE.md`.)

### PR timing — only open when the feature is done

Because PRs auto-merge as soon as auto-review passes, **do not open a PR until the feature is genuinely complete**. There's no draft-PR safety net here:

- Don't open a PR to "stage" work while live verification, follow-up fixes, or final passes are still pending — by the time you finish those, the half-baked PR may already be in `main`.
- Push commits to the branch first; only run `gh pr create` once tests pass, live verification (if applicable) is green, and you'd be comfortable with the change shipping as-is.
- If follow-ups land after a PR is already open, they need to land on the same branch *before* auto-review flips to `pass`. Once the PR squash-merges, late commits orphan onto a stale branch and become their own follow-up PR.
- If you genuinely need a checkpoint review without shipping, open the PR as a GitHub draft (`gh pr create --draft …`) — auto-review skips drafts. Mark it ready-for-review only when the feature is truly done.

**Release PRs are the one manual touch.** release-please opens its own release PR and leaves it open as your staging artifact — `pr-auto-review.yml` skips it on purpose, so it sits there accumulating changes until you decide to ship. When you're ready, add `ready-to-merge` to it the same way: `gh pr edit <num> --add-label ready-to-merge`. The `auto-merge.yml` arm then takes over and the publish job fires the moment the release PR lands.

The repo allows squash-merge only — `--merge` and `--rebase` are blocked at the branch-protection ruleset level.
