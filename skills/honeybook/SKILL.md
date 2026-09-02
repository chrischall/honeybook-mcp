---
name: honeybook
description: This skill should be used when the user asks about HoneyBook client-portal data. Triggers on phrases like "check HoneyBook", "sign contract", "pay invoice", "HoneyBook vendors", "unsigned contracts", "open invoices", "message the planner", "reply to my vendor", "next meeting with the planner", or any request involving wedding-vendor contracts, invoices, brochures, proposals, payments, messages, meetings or tasks via HoneyBook.
---

# honeybook-mcp

MCP server for HoneyBook's client portal — contracts, invoices, questionnaires, messages, meetings, tasks and payments across multiple wedding vendors, with magic-link session capture, in-portal messaging, and deep-link fallback for signing and paying.

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
- `list_projects` — Your projects (HoneyBook "events") with a vendor, each with the `workspace_id` the tools below take
- `get_project` — Project details: date, time, location, guests, custom fields, people (name/email/phone/role)
- `list_messages` — Messages in a workspace (`kind=activity` for the activity log, `kind=all` for both): compact cards, newest first; never marks anything seen
- `get_message` — One message in full (`format=text` default, or `html`) with attachments and delivery status
- `send_message` — Send a new message (`subject` + `body`) or reply (`reply_to_message_id`, subject inherited) through the portal; requires `confirm:true`
- `mark_messages_seen` — Mark feed items seen, the way opening the Activity tab does
- `list_meetings` — Meetings the vendor scheduled (consultations, Zoom calls): time, join link, password; rescheduled meetings show their latest time
- `list_tasks` — Tasks assigned to you with today/this-week/overdue counts and task groups
- `list_notes` — Notes the vendor shared (meeting notes, AI recaps)
- `list_attachments` — Loose images, files and bookmarks (not contracts/invoices — those are workspace files)
- `list_payments` — Every payment on every file in a workspace, with paid/unpaid totals

## Workflows

- **First time** → user pastes magic-link URL from vendor email → `use_magic_link` → session captured
- **"Fill in / read the vendor's questionnaire"** → user pastes the `/flow/<id>?hash=…` link → `use_flow_link` → `get_flow`
- **"What contracts haven't I signed?"** → `list_workspace_files` with `file_type=agreement`, filter by `is_file_accepted=false`
- **"Summarize my HB status with Silk Veil"** → `get_workspace` (status flags) + `list_workspace_files`
- **"Send me a link to sign the photographer's contract"** → `list_workspace_files` → `sign_contract` with `confirm:true`
- **"Which invoices are overdue?"** → `list_workspace_files` with `file_type=invoice`, sort by due date
- **"What did the planner send me?" / "Read me the latest checklist"** → `list_projects` → `list_messages` → `get_message`
- **"Reply to Ivy and ask about the rehearsal"** → `list_messages` (find the message) → `send_message` with `reply_to_message_id` and no `confirm` (preview) → re-run with `confirm:true`
- **"When is my next Zoom with the planner?"** → `list_meetings`; the join link and password are in the row
- **"What have I paid and what's left?"** → `list_payments` (`totals.paid` / `totals.unpaid`); to pay one, `pay_invoice`
- **"Do I have anything to do?"** → `list_tasks` (`counts.overdue`, `counts.today`)

## Notes

- Each vendor = separate session keyed by portal origin (e.g. `https://acme.hbportal.co`)
- Sessions cached in `~/.honeybook-mcp/sessions.json` (mode 0600)
- **Two credential kinds, not interchangeable.** A portal session reads workspaces/files/invoices; a flow credential is HoneyBook's "weak auth", scoped to ONE questionnaire, cached separately in `~/.honeybook-mcp/flows.json`. A portal tool refuses a flow credential by name rather than failing upstream
- The flow storage key contains the flow id, so the fetchproxy extension asks to re-approve the scope once per new questionnaire
- Write tools (`sign_contract`, `pay_invoice`) return deep links in v2
- Session expires → re-run `use_magic_link` with a fresh URL from the vendor's email
- `send_message` goes out as a real HoneyBook email to everyone in the workspace (the vendor and any co-clients). Always show the preview (no `confirm`) before sending
- `list_messages` / `get_message` read the same feed the Activity tab renders and do not mark items seen; `unseen_count` counts messages from other people you have not opened
