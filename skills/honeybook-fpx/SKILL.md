---
name: honeybook-fpx
description: >-
  Read HoneyBook client-portal data (contracts, invoices, proposals, payment
  methods, workspace status) from a shell with the fpx CLI (@fetchproxy/cli)
  instead of running the honeybook-mcp server — capture a vendor session once
  via the signed-in browser tab, then curl api.honeybook.com directly. Use
  when you want HoneyBook data without the MCP, in a script, or on a machine
  where the MCP isn't installed.
---

# HoneyBook via fpx + curl (no MCP)

HoneyBook has **no server-side login** a script can drive — a client never
gets a password, only a magic-link email per vendor. The credential is
whatever the signed-in `*.hbportal.co` portal tab already holds: a bearer
token + user id + device id in `localStorage["jStorage"]`, plus a per-device
`hb-api-fingerprint` request header that only appears on a live outgoing
`api.honeybook.com/api/v2/*` call (it's FingerprintJS, not stored anywhere).
There's no bot wall on the API itself once you have those — `honeybook-mcp`'s
own `client.ts` proves plain Node `fetch` works fine against
`api.honeybook.com`. So this skill is **hybrid**: `fpx` captures the session
**once** (per vendor), then plain `curl` does every read from then on.

This mirrors `src/auth.ts` (`captureSessionViaFetchproxy`) and `src/client.ts`
(`HoneyBookClient.request`) in `honeybook-mcp` — same headers, same base URL,
same retry rules.

## Multi-domain scope

Two apexes are declared on one profile:
- `hbportal.co` — the vendor's branded portal (e.g. `acme.hbportal.co`),
  where `jStorage` lives.
- `honeybook.com` — required so the extension is allowed to capture the
  `hb-api-fingerprint` header off requests to `api.honeybook.com`.

## One-time setup

```sh
npm install -g @fetchproxy/cli   # provides `fpx`
fpx profile add honeybook --domain honeybook.com --domain hbportal.co
fpx profile declare honeybook \
  --local-storage jStorage \
  --capture-header 'hb-api-fingerprint@api.honeybook.com/api/v2/*'
fpx pair -p honeybook            # prints a pair code → approve in Transporter
```

Requirements: the **Transporter** browser extension installed, its Chrome
**Site access** allowing both `honeybook.com` and `hbportal.co`, and a vendor
magic-link URL already open (signed in) in that browser. Pairing persists —
after the first approval every later `fpx` call reuses it.

## Capture a vendor session (once per vendor, and again when it expires)

1. Click the vendor's HoneyBook magic-link email in the browser with
   Transporter installed. This signs you into `<vendor>.hbportal.co`.
2. **While that tab is open**, run:

```sh
fpx session -p honeybook --storage-domain hbportal.co > /tmp/hb-session.json
```

**The fingerprint capture needs a FRESH request, not a loaded page.** A
portal tab that finished loading and went idle has no outgoing
`api.honeybook.com/api/v2/*` call left to sniff, so the capture times out.
While `fpx session` is waiting (~30s window), refresh the portal tab or open
a workspace/file so the page issues a new API call.

3. Extract the fields `client.ts` needs (`jStorage` is one raw localStorage
   value packing several keys as JSON — parse it with `fromjson`):

```sh
AUTH_TOKEN=$(jq -r '.localStorage.jStorage | fromjson | .HB_AUTH_TOKEN' /tmp/hb-session.json)
USER_ID=$(jq -r '.localStorage.jStorage | fromjson | .HB_AUTH_USER_ID' /tmp/hb-session.json)
TRUSTED_DEVICE=$(jq -r '.localStorage.jStorage | fromjson | .HB_TRUSTED_DEVICE' /tmp/hb-session.json)
FINGERPRINT=$(jq -r '.capturedHeaders["hb-api-fingerprint"]' /tmp/hb-session.json)
PORTAL_ORIGIN='https://<vendor>.hbportal.co'   # the magic-link URL's origin
```

If any of `AUTH_TOKEN`/`USER_ID`/`TRUSTED_DEVICE`/`FINGERPRINT` come back
empty/`null`, the capture didn't see what it needed — re-open the magic link
(or interact with the tab) and re-run step 2.

With more than one vendor tab open at once, disambiguate with
`--storage-subdomain <vendor>` (e.g. `--storage-subdomain acme`).

4. Get the current API version (`client.ts`'s `fetchApiVersion` parses this
   same endpoint):

```sh
API_VERSION=$(curl -s 'https://api.honeybook.com/api/gon?callback=parseGon' \
  | grep -oE '"api_version":[[:space:]]*[0-9]+' | grep -oE '[0-9]+$')
```

## Core call pattern

Every real request carries the same eight headers
(`client.ts`'s `HoneyBookClient.request`):

```sh
curl -s "https://api.honeybook.com/api/v2/users/$USER_ID/workspace_files" \
  -H 'accept: application/json, text/plain, */*' \
  -H "hb-api-auth-token: $AUTH_TOKEN" \
  -H "hb-api-user-id: $USER_ID" \
  -H "hb-trusted-device: $TRUSTED_DEVICE" \
  -H "hb-api-client-version: $API_VERSION" \
  -H "hb-api-fingerprint: $FINGERPRINT" \
  -H "hb-api-duplicate-calls-prevention-uuid: $(uuidgen)" \
  -H 'hb-admin-login: false' \
  | jq '.data'
```

`hb-api-duplicate-calls-prevention-uuid` must be a **fresh random UUID on
every request** — the MCP mints one with `crypto.randomUUID()` per call, not
once per session. Reusing a value risks HoneyBook treating a legitimate
repeat as a duplicate.

Ready-to-run commands for all four read endpoints are in
`references/requests.md`.

## The rules that matter

- **401 → session expired.** Re-run the capture (magic link tab must still
  be open and signed in).
- **429 → rate limited.** `client.ts` waits 2s and retries once; do the same
  before giving up.
- **Body contains `"HBWrongAPIVersionError"` → stale `hb-api-client-version`.**
  The error body itself carries the correct value at
  `.error_data.server_api_version` — read that (or re-run the `/api/gon`
  fetch above) and retry the SAME request with the fresh version.
- **`sign_contract` / `pay_invoice` are not real API calls.** `honeybook-mcp`
  can't replay HoneyBook's browser-side signing/SCA flow, so those tools just
  return a deep link — `$PORTAL_ORIGIN/app/workspace_file/<file_id>/agreement`
  (sign) or `/invoice` (pay) — for the user to open themselves. There's no
  POST body to transcribe for either; don't invent one.

## Output / exit-code contract

- `fpx session`/`fpx pair`/`fpx health` are bridge round-trips: exit `0` on a
  successful bridge read regardless of upstream status, `1` on a usage error
  (bad flag, undeclared scope), `2` if the bridge/extension is unreachable or
  pairing is still pending. There's no bot-wall (`3`)/upstream-HTTP (`4`)
  exit code on these — HoneyBook's own API isn't bridge-walled.
- The actual reads go through plain `curl` afterward — check the HTTP status
  and the `HBWrongAPIVersionError` body text yourself, as above.

## Notes

- Session data (`AUTH_TOKEN`, `TRUSTED_DEVICE`, `FINGERPRINT`) is opaque and
  long-lived server-side (no client-visible JWT expiry) — keep it in shell
  variables, not a world-readable file, if you must persist it at all.
- This project is developed and maintained by AI (Claude).
