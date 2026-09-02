# HoneyBook MCP

[![CI](https://github.com/chrischall/honeybook-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/chrischall/honeybook-mcp/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/honeybook-mcp)](https://www.npmjs.com/package/honeybook-mcp)
[![license](https://img.shields.io/npm/l/honeybook-mcp)](LICENSE)

A [Model Context Protocol](https://modelcontextprotocol.io) server that connects Claude to the [HoneyBook](https://www.honeybook.com) client portal, giving you natural-language access to contracts and invoices sent by your wedding vendors.

> [!WARNING]
> **AI-developed project.** This codebase was built and is actively maintained by [Claude Code](https://www.anthropic.com/claude). No human has audited the implementation. Review all code and tool permissions before use.

## What you can do

Ask Claude things like:

- *"Paste your magic link — I'll connect to your HoneyBook portal."*
- *"Show me every unsigned contract."*
- *"What invoices do I have due in the next month?"*
- *"Summarize the contract from Silk Veil Events."*
- *"Give me a deep link to sign the photographer's contract."*
- *"What has the planner sent me this month? Read me the checklist."*
- *"Reply to Ivy's last message and ask about the rehearsal time."*
- *"When is my next Zoom with the planner, and what's the link?"*
- *"What have I paid so far, and what's still owed?"*

## Requirements

- [Claude Desktop](https://claude.ai/download) or [Claude Code](https://docs.anthropic.com/en/docs/claude-code)
- [Node.js](https://nodejs.org) 20.6 or later
- Magic-link emails from the wedding vendors that use HoneyBook
- [fetchproxy 0.3.0 browser extension](https://github.com/chrischall/fetchproxy) — installed in Chrome (Web Store) or Safari (.dmg). Used by `use_magic_link` to snapshot the session out of your signed-in vendor portal tab.

## Acknowledgement of Terms

By using this MCP server, you acknowledge and agree to the following:

**1. This server accesses your own HoneyBook workspace.** Every request is dispatched through your own signed-in browser session via the fetchproxy extension. It does not — and cannot — access anyone else's workspace.

**2. [HoneyBook's Terms of Service](https://www.honeybook.com/legal/terms-of-service) govern your use of this server**, just as they govern your direct use of honeybook.com. The clauses most relevant here:

> In connection with your use of the Service you will not engage in or use any data mining, robots, scraping or similar data gathering or extraction methods.

And: users may not "modify, copy, frame, scrape, rent, lease, loan, sell, distribute or create derivative works based on the Service or the Service Content."

You are agreeing to those terms — read by the maintainer 2026-05-23 — every time you invoke a tool in this server. HoneyBook's ToS broadly prohibits data mining and scraping; this MCP is an unofficial automation tool and HoneyBook has not granted it an exception.

**3. Personal, single-business use only.** This project is not affiliated with, endorsed by, sponsored by, or in partnership with HoneyBook, Inc. It is a personal automation tool that an individual HoneyBook account holder can use to drive their own workspace. Do not use it on behalf of another business, do not bulk-extract HoneyBook's directory or template content, and do not create a derivative SaaS product on top of it.

**4. Stability is not guaranteed.** This server calls internal HoneyBook endpoints that HoneyBook may change without notice. It may break.

**5. You accept full responsibility** for any consequences of using this server in connection with your HoneyBook account — rate limiting, account warnings, suspension, or any enforcement action HoneyBook takes. HoneyBook can detect automated traffic and may block your IP or workspace. If HoneyBook objects to your use, stop using this server.

This section is the maintainer's good-faith summary of the terms — it is not legal advice and does not modify or supersede HoneyBook's actual ToS.

## Installation

### From source

```bash
git clone https://github.com/chrischall/honeybook-mcp.git
cd honeybook-mcp
npm install
npm run build
```

Add to Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "honeybook": {
      "command": "node",
      "args": ["/absolute/path/to/honeybook-mcp/dist/bundle.js"]
    }
  }
}
```

No environment variables are required.

## Sessions

HoneyBook has no public client-portal API. This MCP reuses the same auth state your browser has after clicking a vendor's magic link, via the [fetchproxy 0.3.0 browser extension](https://github.com/chrischall/fetchproxy).

**One-time setup:**

1. Install the fetchproxy 0.3.0 extension in Chrome (Web Store) or Safari (.dmg).
2. Click each vendor's magic link in your normal browser. That signs you into their `*.hbportal.co` portal.

**Per-vendor activation:**

1. Make sure the vendor's portal tab is open (the magic link from their email).
2. In Claude, call `use_magic_link` with the magic-link URL — the tool asks the fetchproxy extension to snapshot the auth fields out of the page's `localStorage["HONEYBOOK_REACT_CURR_USER"]`, then closes the bridge. The tab only has to be open and signed in; nothing is read off a live request. No headless browser is spawned.
3. All other tools use the most-recently-activated session by default. Pass `origin` explicitly when multiple vendors are active.

Sessions are stored in memory and persisted to `~/.honeybook-mcp/sessions.json` (mode 0600) so they survive MCP restarts. Re-run `use_magic_link` when a session expires.

### Questionnaire ("flow") links

A vendor can send a second, different shape of link:

```
https://<vendor>.hbportal.co/flow/<flowId>?hash=…&userId=…
```

That one does **not** sign you into the portal. It opens a single questionnaire and stores a per-flow credential — HoneyBook calls it *weak auth* — under `localStorage["HONEYBOOK_REACT_WEAK_AUTH_<flowId>"]`. Capture it with `use_flow_link` and read it with `get_flow`.

The two credential kinds are kept apart on purpose, in two files and two stores:

| | portal session | flow credential |
|---|---|---|
| capture tool | `use_magic_link` | `use_flow_link` |
| link shape | `/app/link/resolve/…` | `/flow/<flowId>?hash=…` |
| stored in | `~/.honeybook-mcp/sessions.json` | `~/.honeybook-mcp/flows.json` |
| can read | workspaces, files, invoices, payment methods | that one questionnaire |

Each tool refuses the other's link shape by name, and a portal tool asked to run with only a flow credential says so rather than failing later with an opaque HoneyBook error. `list_active_sessions` reports both kinds, separately.

`get_flow` makes the same two calls the questionnaire page does: the public `GET /api/v2/flow/<flowId>/minimal` for the vendor company id, then `GET /api/v2/client/flow/<flowId>/active?ctxc=<companyId>`. If the first does not carry a company id it stops there and says so — calling `/active` without `ctxc` answers a bare `400` that reads like an expired credential.

One thing to expect: the storage key contains the flow id, so every new questionnaire is a **new key in the declared fetchproxy scope**. The extension gates on the scope you approved at pair time, so it asks you to re-approve once per questionnaire. That is the extension working, not a fault.

## Available tools

Tools that touch a vendor accept an optional `origin` argument (e.g. `https://acme.hbportal.co`). When only one session is active it is inferred.

| Tool                   | What it does                                              | Permission |
|------------------------|-----------------------------------------------------------|------------|
| `use_magic_link`       | Capture a session from a magic-link URL                   | Confirm    |
| `list_active_sessions` | Show active credentials, split by kind                    | Auto       |
| `use_flow_link`        | Capture a questionnaire (flow) credential                 | Confirm    |
| `get_flow`             | Read one questionnaire and its answers                    | Auto       |
| `list_workspace_files` | Files from one vendor; filter by type                     | Auto       |
| `get_workspace_file`   | Full detail for one file                                  | Auto       |
| `get_workspace`        | Workspace detail + status flags                           | Auto       |
| `list_payment_methods` | Saved payment methods                                     | Auto       |
| `sign_contract`        | Deep link to sign in portal (requires `confirm:true`)     | Confirm    |
| `pay_invoice`          | Deep link to pay in portal (requires `confirm:true`)      | Confirm    |
| `list_projects`        | Your projects with a vendor + their workspace ids         | Auto       |
| `get_project`          | Project details: date, location, people, custom fields    | Auto       |
| `list_messages`        | Messages (or the activity log) in a workspace, newest first | Auto     |
| `get_message`          | One message in full: body, attachments, delivery status   | Auto       |
| `send_message`         | Send or reply through the portal (requires `confirm:true`) | Confirm   |
| `mark_messages_seen`   | Mark feed items seen (reads never do this on their own)   | Auto       |
| `list_meetings`        | Scheduled meetings with join links, latest time wins      | Auto       |
| `list_tasks`           | Tasks the vendor assigned you, with counts                | Auto       |
| `list_notes`           | Notes the vendor shared                                   | Auto       |
| `list_attachments`     | Loose images, files and bookmarks in a workspace          | Auto       |
| `list_payments`        | Payment schedule with paid/unpaid totals                  | Auto       |

`send_message` is the one tool that acts on your behalf: it creates the same
`send_workspace_message` job the portal's Activity composer creates and waits
for HoneyBook to finish it, so the vendor receives a normal HoneyBook email.
Without `confirm:true` it only previews the recipients, subject and body.

## Troubleshooting

- **"HoneyBook auth expired"** — re-open the vendor's magic link in Chrome and re-run `use_magic_link`.
- **"No active HoneyBook session"** — call `use_magic_link` first.
- **"No active HoneyBook portal session. N flow (questionnaire) credentials are active"** — you captured a `/flow/` link but the tool you called needs a client-portal one. Run `use_magic_link` with an `/app/link/resolve/…` link, or use `get_flow` to read the questionnaire.
- **"that is a questionnaire (flow) link, not a client-portal link"** — use `use_flow_link` for it.
- **"no auth hash for flow …"** — the link you passed had lost its `?hash=` parameter (the page rewrites the URL after it loads). Re-copy the original link out of the vendor email.
- **"HoneyBook error 400 … NOT an auth failure"** on `get_flow` — a required input was missing, not your credential. Usually a pinned `HONEYBOOK_API_VERSION` that has gone stale: unset it so the live value is read from `/api/gon`. Re-running `use_flow_link` will not help.
- **"no context id for flow …"** — HoneyBook's public `/minimal` route did not return the vendor company id the questionnaire read needs. Also not a credential problem.
- **"fetchproxy capture failed"** — install the [fetchproxy 0.3.0 extension](https://github.com/chrischall/fetchproxy), then open the vendor's magic link in that browser.
- **"fetchproxy capture timed out"** — the extension found no signed-in portal tab to read. Open the vendor's magic link, confirm the portal page has loaded, then retry.
- **"no confirmed browser session"** — the extension is connected but has not approved this MCP. Open the Transporter popup and approve the pair code it shows, then retry.
- **"localStorage keys not in declared set"** — the MCP now reads a storage key your existing pairing doesn't cover. See [Upgrading from 0.4.4 or earlier](#upgrading-from-044-or-earlier). Retrying will not help, and this is not a version problem.

## Upgrading from 0.4.4 or earlier

**0.4.5 requires a one-time re-approval in the browser extension.** HoneyBook moved the client-portal session out of `localStorage["jStorage"]` into `localStorage["HONEYBOOK_REACT_CURR_USER"]`, so 0.4.5 reads a different storage key. The extension approves a MCP's declared scope *at pair time*, so an existing pairing does not cover the new key and every capture is refused with:

```
localStorage keys not in declared set: HONEYBOOK_REACT_CURR_USER
```

To fix it, once:

1. Open the **Transporter** extension popup.
2. **Revoke** `honeybook-mcp`.
3. Re-run `use_magic_link` — a fresh pair code appears.
4. Approve it in the popup. You are approving the new scope.

Nothing else changes: existing sessions in `~/.honeybook-mcp/sessions.json` keep working, and a re-capture is only needed if the session itself has expired.

## Security

- Sessions are captured locally — auth tokens never leave your machine
- `~/.honeybook-mcp/sessions.json` is written with mode 0600; directory with mode 0700
- Write tools (`sign_contract`, `pay_invoice`) require `confirm:true` and return portal deep links rather than signing/paying headlessly

## Development

```bash
npm test        # run tests
npm run build   # tsc + esbuild bundle
```

## License

MIT
