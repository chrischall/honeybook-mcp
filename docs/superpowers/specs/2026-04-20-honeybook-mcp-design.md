# honeybook-mcp — design

MCP server for the HoneyBook **client portal** (couple side), giving Claude natural-language access to contracts and invoices that wedding vendors send via HoneyBook.

Matches the artifacts, coding style, and distribution model of the existing `zola-mcp` / `ofw-mcp` family.

## Goals

- View and sign contracts that vendors share with the user via HoneyBook
- View and pay invoices on those same contracts
- One MCP server covering **multiple vendors** (each vendor = separate auth scope)

## Non-goals

- Pro/vendor-side HoneyBook features (managing your own clients, pipelines, brochures, etc.)
- Messaging, meetings, questionnaires, files-other-than-contracts/invoices (deferred to v2)
- Using HoneyBook's official partner API (requires developer program access the user does not have)

## Architecture

TypeScript ESM (NodeNext), `@modelcontextprotocol/sdk`, stdio transport, esbuild bundle to `dist/bundle.js`. Identical shape to `zola-mcp`:

```
src/
  index.ts          MCP server entry; registers tool modules; stdio transport
  client.ts         HoneyBookClient — per-vendor auth, header construction, request wrapper
  types.ts          { HBEnvelope<T>, ToolResult, VendorScope }
  tools/
    vendors.ts      list_vendors (lists connected vendors from env; no API call)
    workspaces.ts   list_workspaces, get_workspace
    contracts.ts    list_contracts, get_contract, sign_contract
    invoices.ts     list_invoices, get_invoice, list_payments, pay_invoice
tests/              one *.test.ts per tool module + client.test.ts + setup-auth.test.ts
scripts/
  setup-auth.mjs    Puppeteer-based magic-link capture (see below)
  setup-auth.sh     thin wrapper
.claude-plugin/     plugin.json + marketplace.json
skills/honeybook/SKILL.md
SKILL.md            top-level skill reference
manifest.json       mcpb bundle manifest
server.json         MCP registry manifest
.mcp.json           Claude Code plugin mcp config
```

Build pipeline, version-bumping (four-file sync via Cut & Bump workflow), CI, release workflow, and `.mcpbignore` all mirror `zola-mcp` exactly.

## Auth model

Each HoneyBook vendor sends the user a **branded client portal** at `<vendor-slug>.hbportal.co`. Clicking the vendor's magic link exchanges a URL token for a localStorage-based auth bundle scoped to that vendor's workspace. There is no unified client account; the user is effectively a separate identity for each vendor.

### Secrets per vendor

Captured once per vendor via `npm run auth`:

| Source                                | Env var (per slug)                          |
|---------------------------------------|---------------------------------------------|
| `localStorage.jStorage.HB_AUTH_TOKEN`     | `HB_<SLUG>_AUTH_TOKEN` (43 chars, opaque)   |
| `localStorage.jStorage.HB_AUTH_USER_ID`   | `HB_<SLUG>_USER_ID` (24-char ObjectId)      |
| `localStorage.jStorage.HB_TRUSTED_DEVICE` | `HB_<SLUG>_TRUSTED_DEVICE` (64 chars)       |
| Captured from first live request        | `HB_<SLUG>_FINGERPRINT` (32-char FingerprintJS hash, session-constant) |

`HB_API_VERSION` (currently `2578`) is not a per-vendor secret — it's fetched at runtime from `https://api.honeybook.com/api/gon` (JSONP, parses as `parseGon({...})`). Env var `HB_API_VERSION_OVERRIDE` may override the auto-fetched value for pinning during testing.

### Per-vendor registration env

```
HONEYBOOK_VENDORS=silk_veil,photog,venue        # comma-separated slugs
HB_SILK_VEIL_LABEL=The Silk Veil Events by Ivy  # display name shown to Claude
HB_SILK_VEIL_AUTH_TOKEN=…
HB_SILK_VEIL_USER_ID=…
HB_SILK_VEIL_TRUSTED_DEVICE=…
HB_SILK_VEIL_FINGERPRINT=…
# …repeat for each slug
```

Loading logic in `client.ts` parses `HONEYBOOK_VENDORS`, then for each slug reads `HB_<SLUG>_*` variables into a `VendorScope` record. Missing required fields throw a clear error naming the missing var and pointing at `npm run auth`.

### Request shape

Every call to `https://api.honeybook.com/api/v2/*` attaches these headers (confirmed live against `/api/v2/users/{id}` → 200):

```
hb-api-auth-token:                         <HB_<SLUG>_AUTH_TOKEN>
hb-api-user-id:                            <HB_<SLUG>_USER_ID>
hb-trusted-device:                         <HB_<SLUG>_TRUSTED_DEVICE>
hb-api-client-version:                     <api_version>
hb-api-fingerprint:                        <HB_<SLUG>_FINGERPRINT>
hb-api-duplicate-calls-prevention-uuid:    <new UUIDv4 per request>
hb-admin-login:                            false
accept:                                    application/json, text/plain, */*
```

`content-type: application/json` added for POST/PUT. No cookies; CORS is effectively irrelevant from a Node server since the browser isn't involved.

### Error handling

| Server response                                    | Client behavior                                                   |
|----------------------------------------------------|--------------------------------------------------------------------|
| `401` or `error_type: "HBAuthenticationError"`     | Throw with message pointing at `npm run auth -- <slug>`            |
| `error_type: "HBWrongAPIVersionError"`             | Re-fetch `/api/gon`, retry once; if still fails, throw clearly     |
| `429`                                              | Sleep 2s, retry once; second 429 throws                            |
| Any non-2xx otherwise                              | Throw with `${status} ${statusText}: ${body.slice(0,200)}`         |

## `npm run auth` — setup flow

Puppeteer-driven, mirrors the `zola-mcp` script pattern at `scripts/setup-auth.mjs`:

1. Launch Chrome with a dedicated profile at `~/.honeybook-mcp/chrome-profile` (persists login state between runs, so users don't re-auth every time).
2. Prompt the user: "Paste a magic-link URL from a vendor's HoneyBook email, or press Enter to open `hbportal.co` to request one."
3. Navigate to the pasted URL (or a blank start).
4. Inject a fetch/XHR tap via `page.evaluateOnNewDocument` that records any `api.honeybook.com/api/v2/*` request's headers to a window global.
5. Wait up to 30s for the first such request; extract `hb-api-fingerprint` from its headers.
6. Read `localStorage.jStorage` and extract `HB_AUTH_TOKEN`, `HB_AUTH_USER_ID`, `HB_TRUSTED_DEVICE`, `HB_API_VERSION`. Also read `HB_CURR_USER.company.company_name` (used to suggest a default slug and label).
7. Prompt for slug (default: sanitized company name); confirm.
8. Append the new `HB_<SLUG>_*` vars to `.env` and add the slug to `HONEYBOOK_VENDORS`.
9. Prompt: "Add another vendor? [y/N]". Loop or exit.

Script has no bundled dependencies — installs `puppeteer-core` on first run (same pattern as `zola-mcp`'s `setup-auth.mjs`).

## Tool surface (v1)

Unless noted, read-only tools carry `annotations.readOnlyHint: true`; write tools carry `annotations.destructiveHint: true`.

Tools that touch per-vendor state take a required `vendor` argument (slug from `HONEYBOOK_VENDORS`). When exactly one vendor is configured, `vendor` defaults to that slug and becomes optional.

| Tool              | Purpose                                                              | Endpoint(s)                                                    |
|-------------------|----------------------------------------------------------------------|---------------------------------------------------------------|
| `list_vendors`    | Connected vendors + labels. No API call. Always available.            | (local env)                                                   |
| `list_workspaces` | Projects in one vendor's account (usually just one per vendor).       | `GET /users/{uid}/workspaces` (confirmed reachable)           |
| `get_workspace`   | Workspace detail including files, contacts, key dates.                | `GET /workspaces/{id}` (expected)                             |
| `list_contracts`  | Contracts in a workspace; status (unsigned/signed/declined).          | `GET /workspaces/{id}/files?type=agreement` (expected)        |
| `get_contract`    | Contract content, signing status, signed timestamp.                   | `GET /files/{id}` (expected)                                  |
| `sign_contract`   | Sign a contract. Confirmation arg required.                           | `POST /files/{id}/sign` (to be sniffed during implementation) |
| `list_invoices`   | Invoices in a workspace; amounts, due dates, payment status.          | `GET /workspaces/{id}/files?type=invoice` (expected)          |
| `get_invoice`     | Invoice detail: line items, payments, balance.                        | `GET /files/{id}` (expected)                                  |
| `list_payments`   | Payment history for an invoice.                                       | `GET /files/{id}/payments` (expected)                         |
| `pay_invoice`     | Pay an invoice with a saved payment method. Confirmation arg required.| `POST /files/{id}/payments` (to be sniffed during implementation) |

"Expected" endpoints are best-guess names based on HoneyBook's internal nomenclature (workspaces, files, agreements) and the one confirmed endpoint (`/users/{uid}/workspaces`). The implementation plan includes a brief browser-sniff spike to lock in exact shapes before coding each tool.

### Confirmation semantics for destructive tools

`sign_contract` and `pay_invoice` require an explicit boolean argument `confirm: true` in the input schema. If `confirm` is missing or false, the tool returns a structured preview (what would be signed/paid) without hitting the write endpoint. This is a belt-and-suspenders layer on top of the `destructiveHint` annotation Claude already uses for user confirmation UX.

### Fallback when a write endpoint can't be reproduced cleanly

If `sign_contract` or `pay_invoice` turns out to require device attestation, Stripe SCA, or anything else the MCP can't replay headlessly, the tool's implementation returns a deep link to the portal action URL (e.g., `https://<vendor>.hbportal.co/app/workspace_file/{id}/agreement`) instead of failing. The tool is still useful — Claude guides the user to the right page rather than leaving them to hunt.

## Testing

Vitest, mirroring `zola-mcp`'s conventions:

- `tests/client.test.ts` — header construction, per-vendor selection, error-path branches. `vi.spyOn(global, 'fetch')` to intercept, never hitting the real API.
- One `tests/<domain>.test.ts` per tool module. `vi.spyOn(client, 'request')` to drive each tool handler with fixture responses.
- `tests/setup-auth.test.ts` — unit tests for the non-browser parts of the auth script (env parsing, slug sanitization, existing-vendor detection).

No integration tests against live HoneyBook in CI. A manual smoke script (documented in README) runs `list_vendors` + `list_workspaces` for local sanity checks.

## Artifacts & distribution

Identical to `zola-mcp`:

- `package.json` with `bin: honeybook-mcp`, esbuild bundle, vitest scripts.
- `manifest.json` (mcpb bundle) with `user_config` prompts for `HONEYBOOK_VENDORS` + one group per slug (dynamic — manifest prompts once for a comma-separated slug list, and the `npm run auth` flow is still the recommended path; the manifest prompts are the escape hatch for users who already have credentials).
- `server.json` for the MCP registry.
- `.mcp.json` + `.claude-plugin/plugin.json` + `.claude-plugin/marketplace.json` for Claude Code plugin distribution.
- `skills/honeybook/SKILL.md` and top-level `SKILL.md`.
- GitHub Actions: `ci.yml`, `tag-and-bump.yml`, `release.yml` cloned from `zola-mcp`.

Four-place version sync (package.json / package-lock.json / src/index.ts / manifest.json) handled by Cut & Bump.

## Security notes

- Tokens stored in `.env` (or plaintext manifest env) only; never logged, never echoed in error messages.
- Puppeteer profile stored under `~/.honeybook-mcp/chrome-profile`, chmod 700.
- `hb-api-fingerprint` is a FingerprintJS signal intended to detect non-browser automation. Our use is a direct reuse of a real captured fingerprint, not a forgery, so this is on par with how the `zola-mcp` approach reuses iOS-app session tokens. If HoneyBook rotates fingerprint validity, users re-run `npm run auth`.
- Write tools (`sign_contract`, `pay_invoice`) carry `destructiveHint: true` AND require explicit `confirm: true` argument.

## Risks & open questions

1. **Token lifetime is unverified.** jStorage has no TTL set locally, but server-side invalidation is unknown. Implementation plan should observe behavior over a week and document whatever lifetime emerges.
2. **Multi-vendor capture UX.** Each vendor requires its own magic-link click. First-run flow must make this clear.
3. **`sign_contract` / `pay_invoice` reproducibility.** Reliability depends on whether HoneyBook gates these writes with device attestation or Stripe SCA. Design intentionally includes a deep-link fallback.
4. **FingerprintJS rotation.** If HoneyBook starts rotating accepted fingerprints (e.g., hourly), the session-constant assumption breaks and the script needs a refresh mechanism.
5. **Endpoints beyond `/users/{uid}/workspaces`** are inferred, not confirmed. The implementation plan's first step is a targeted browser-sniff to lock down the exact shapes.

## Out of scope for v1

- Messaging vendors from Claude
- Meeting/calendar management
- File downloads (PDFs of contracts/invoices)
- Questionnaires
- Proposals
- Pro/vendor-side features
