---
name: honeybook
description: This skill should be used when the user asks about HoneyBook client-portal data. Triggers on phrases like "check HoneyBook", "sign contract", "pay invoice", "HoneyBook vendors", "unsigned contracts", "open invoices", or any request involving wedding-vendor contracts, invoices, brochures, proposals, or payments via HoneyBook.
---

# honeybook-mcp

MCP server for HoneyBook's client portal — viewing contracts, invoices and questionnaires across multiple wedding vendors, with magic-link session capture and deep-link fallback for signing and paying.

## Tools

- `use_magic_link` — Capture a portal session from a vendor magic-link URL (`/app/link/resolve/…`)
- `use_flow_link` — Capture a questionnaire credential from a flow link (`/flow/<flowId>?hash=…`)
- `list_active_sessions` — Show active credentials, split into `portalSessions` and `flowCredentials`
- `get_flow` — Read one questionnaire (flow) and its answers (two calls: public `/minimal` for the vendor company id, then `/client/flow/<id>/active?ctxc=…`)
- `list_workspace_files` — All files one vendor has shared (filter by type)
- `get_workspace_file` — Full detail for one file
- `get_workspace` — Workspace detail + status flags
- `list_payment_methods` — Saved payment methods
- `sign_contract` — Deep link to sign in portal (requires `confirm:true`)
- `pay_invoice` — Deep link to pay in portal (requires `confirm:true`)

## Workflows

- **First time** → user pastes magic-link URL from vendor email → `use_magic_link` → session captured
- **"Fill in / read the vendor's questionnaire"** → user pastes the `/flow/<id>?hash=…` link → `use_flow_link` → `get_flow`
- **"What contracts haven't I signed?"** → `list_workspace_files` with `file_type=agreement`, filter by `is_file_accepted=false`
- **"Summarize my HB status with Silk Veil"** → `get_workspace` (status flags) + `list_workspace_files`
- **"Send me a link to sign the photographer's contract"** → `list_workspace_files` → `sign_contract` with `confirm:true`
- **"Which invoices are overdue?"** → `list_workspace_files` with `file_type=invoice`, sort by due date

## Notes

- Each vendor = separate session keyed by portal origin (e.g. `https://acme.hbportal.co`)
- Sessions cached in `~/.honeybook-mcp/sessions.json` (mode 0600)
- **Two credential kinds, not interchangeable.** A portal session reads workspaces/files/invoices; a flow credential is HoneyBook's "weak auth", scoped to ONE questionnaire, cached separately in `~/.honeybook-mcp/flows.json`. A portal tool refuses a flow credential by name rather than failing upstream
- The flow storage key contains the flow id, so the fetchproxy extension asks to re-approve the scope once per new questionnaire
- Write tools (`sign_contract`, `pay_invoice`) return deep links in v2
- Session expires → re-run `use_magic_link` with a fresh URL from the vendor's email
