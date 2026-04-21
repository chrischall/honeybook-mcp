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
        "HB_SILK_VEIL_PORTAL_ORIGIN": "https://thesilkveileventsbyivy.hbportal.co",
        "HB_SILK_VEIL_AUTH_TOKEN": "...",
        "HB_SILK_VEIL_USER_ID": "...",
        "HB_SILK_VEIL_TRUSTED_DEVICE": "...",
        "HB_SILK_VEIL_FINGERPRINT": "...",
        "HB_PHOTOG_PORTAL_ORIGIN": "https://photog.hbportal.co",
        "HB_PHOTOG_AUTH_TOKEN": "..."
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
| `HB_<SLUG>_LABEL`              | Display name (from `HB_CURR_USER.company.company_name`)             |
| `HB_<SLUG>_PORTAL_ORIGIN`      | The vendor's branded portal origin (e.g. `https://acme.hbportal.co`) |
| `HB_<SLUG>_AUTH_TOKEN`         | `localStorage.jStorage.HB_AUTH_TOKEN`                               |
| `HB_<SLUG>_USER_ID`            | `localStorage.jStorage.HB_AUTH_USER_ID`                             |
| `HB_<SLUG>_TRUSTED_DEVICE`     | `localStorage.jStorage.HB_TRUSTED_DEVICE`                           |
| `HB_<SLUG>_FINGERPRINT`        | `hb-api-fingerprint` request header from the first API call        |

If you prefer to capture credentials manually, open the vendor's magic-link URL in Chrome, then in the DevTools console:

```js
JSON.parse(localStorage.jStorage).HB_AUTH_TOKEN      // → auth token
JSON.parse(localStorage.jStorage).HB_AUTH_USER_ID
JSON.parse(localStorage.jStorage).HB_TRUSTED_DEVICE
```

For the `FINGERPRINT`, open the Network tab, click any `api.honeybook.com/api/v2/…` request, and copy the `hb-api-fingerprint` request header.

## Available tools

Tools that touch a vendor take an optional `vendor` argument. When you've only configured one vendor, it's inferred.

| Tool                   | What it does                                              | Permission |
|------------------------|-----------------------------------------------------------|------------|
| `list_vendors`         | Connected vendors from `.env`                             | Auto       |
| `list_workspace_files` | Files from one vendor; filter by type                     | Auto       |
| `get_workspace_file`   | Full detail for one file                                  | Auto       |
| `get_workspace`        | Workspace detail + status flags                           | Auto       |
| `list_payment_methods` | Saved payment methods                                     | Auto       |
| `sign_contract`        | Deep link to sign in portal (v1; requires `confirm:true`) | Confirm    |
| `pay_invoice`          | Deep link to pay in portal (v1; requires `confirm:true`)  | Confirm    |

## Troubleshooting

- **"HoneyBook auth expired for vendor X"** — re-run `npm run auth` for that vendor.
- **"Multiple vendors configured. Please specify the `vendor` argument."** — pass `vendor` explicitly in your Claude prompt.
- **"Google Chrome not found"** during `npm run auth` — set `PUPPETEER_EXECUTABLE_PATH` to your Chrome binary.

## Security

- Per-vendor tokens live only in your local `.env` or Claude Desktop config
- `.env` is written with `chmod 600`; Chrome profile directory with `chmod 700`
- Write tools (`sign_contract`, `pay_invoice`) require `confirm:true` and return portal deep links rather than signing/paying headlessly

## Development

```bash
npm test        # run tests
npm run build   # tsc + esbuild bundle
```

## License

MIT
