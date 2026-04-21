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
| `sign_contract`        | Deep link to sign in portal (requires `confirm:true`) |
| `pay_invoice`          | Deep link to pay in portal (requires `confirm:true`)  |

## Workflows

- **"What contracts haven't I signed?"** → `list_workspace_files` with `file_type=agreement`, filter by `is_file_accepted=false`
- **"Summarize my HB status with Silk Veil"** → `get_workspace` (status flags) + `list_workspace_files`
- **"Send me a link to sign the photographer's contract"** → `list_workspace_files` → `sign_contract` with `confirm:true`
- **"Which invoices are overdue?"** → `list_workspace_files` with `file_type=invoice`, sort by due date

## Notes

- All tools hit `api.honeybook.com/api/v2/*` with 8 custom `hb-api-*` headers
- Each vendor = separate auth scope (per-vendor magic link)
- `sign_contract` / `pay_invoice` return deep links in v1 — actual signing/paying requires browser-side device/SCA handling
- Token expires → re-run `npm run auth`
