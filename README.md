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
2. In Claude, call `use_magic_link` with the magic-link URL — the tool asks the fetchproxy extension to snapshot the page's `localStorage["jStorage"]` and the `hb-api-fingerprint` request header, then closes the bridge. No headless browser is spawned.
3. All other tools use the most-recently-activated session by default. Pass `origin` explicitly when multiple vendors are active.

Sessions are stored in memory and persisted to `~/.honeybook-mcp/sessions.json` (mode 0600) so they survive MCP restarts. Re-run `use_magic_link` when a session expires.

## Available tools

Tools that touch a vendor accept an optional `origin` argument (e.g. `https://acme.hbportal.co`). When only one session is active it is inferred.

| Tool                   | What it does                                              | Permission |
|------------------------|-----------------------------------------------------------|------------|
| `use_magic_link`       | Capture a session from a magic-link URL                   | Confirm    |
| `list_active_sessions` | Show currently active portal sessions                     | Auto       |
| `list_workspace_files` | Files from one vendor; filter by type                     | Auto       |
| `get_workspace_file`   | Full detail for one file                                  | Auto       |
| `get_workspace`        | Workspace detail + status flags                           | Auto       |
| `list_payment_methods` | Saved payment methods                                     | Auto       |
| `sign_contract`        | Deep link to sign in portal (requires `confirm:true`)     | Confirm    |
| `pay_invoice`          | Deep link to pay in portal (requires `confirm:true`)      | Confirm    |

## Troubleshooting

- **"HoneyBook auth expired"** — re-open the vendor's magic link in Chrome and re-run `use_magic_link`.
- **"No active HoneyBook session"** — call `use_magic_link` first.
- **"fetchproxy capture failed"** — install the [fetchproxy 0.3.0 extension](https://github.com/chrischall/fetchproxy), then open the vendor's magic link in that browser.
- **"hb-api-fingerprint header not captured"** — refresh the portal tab so the page makes an `api.honeybook.com/api/v2/*` request, then retry.

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
