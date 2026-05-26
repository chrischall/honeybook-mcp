# Changelog

## [0.2.3](https://github.com/chrischall/honeybook-mcp/compare/v0.2.2...v0.2.3) (2026-05-26)


### Documentation

* **claude:** warn against early PRs and call out first-party dep bumps ([#39](https://github.com/chrischall/honeybook-mcp/issues/39)) ([6e1cfdf](https://github.com/chrischall/honeybook-mcp/commit/6e1cfdf67e72efc3d154c63e87eeb20e17a8a8d4))

## [0.2.2](https://github.com/chrischall/honeybook-mcp/compare/v0.2.1...v0.2.2) (2026-05-25)


### Bug Fixes

* **ci:** prevent labeled event from cancelling auto-review ([#36](https://github.com/chrischall/honeybook-mcp/issues/36)) ([99724b5](https://github.com/chrischall/honeybook-mcp/commit/99724b51c8ca02d0acb0ef1a5e64e1ffc8ea5d2c))

## [0.2.1](https://github.com/chrischall/honeybook-mcp/compare/v0.2.0...v0.2.1) (2026-05-24)


### Documentation

* add Acknowledgement of Terms section to README ([#32](https://github.com/chrischall/honeybook-mcp/issues/32)) ([514567f](https://github.com/chrischall/honeybook-mcp/commit/514567fc670317082d1c6fd7a79aa856f133ae4e))
* canonical auto-merge guidance ([#34](https://github.com/chrischall/honeybook-mcp/issues/34)) ([caf45da](https://github.com/chrischall/honeybook-mcp/commit/caf45dafaf5f98413e49716c8fbbb903abb9a2f7))
* **claude-md:** call out 100-char limit on server.json description ([8861683](https://github.com/chrischall/honeybook-mcp/commit/88616839749eb96984914d1b14b4dcd604cd5220))
* **claude-md:** call out 100-char limit on server.json description ([0427799](https://github.com/chrischall/honeybook-mcp/commit/042779949dfff54c5f3e908f58ba7efaca4b9f96))

## [0.2.0](https://github.com/chrischall/honeybook-mcp/compare/v0.1.14...v0.2.0) (2026-05-22)


### Features

* @fetchproxy/bootstrap replaces Puppeteer for session capture ([4024ab7](https://github.com/chrischall/honeybook-mcp/commit/4024ab7459d41241800039ffabffe6d1c07744d2))
* **client:** fetch api_version from /api/gon with env override ([7600d0a](https://github.com/chrischall/honeybook-mcp/commit/7600d0aced2cb72080c4e37aafee1cdb806ebdc5))
* **client:** getClientFor factory with default-single-vendor logic ([8aad876](https://github.com/chrischall/honeybook-mcp/commit/8aad87649c4619863d56094de98fbcbb946ff456))
* **client:** HoneyBookClient with 8-header request and retry logic ([72aebf2](https://github.com/chrischall/honeybook-mcp/commit/72aebf2bfe4651b3f4f42c14da65ad85edec4ab3))
* **client:** load per-vendor scopes from slug-prefixed env vars ([2296610](https://github.com/chrischall/honeybook-mcp/commit/229661021a99195674adccc1528730233e86847f))
* core types (ToolResult, HBListEnvelope, VendorScope, FileType) ([e7fce8a](https://github.com/chrischall/honeybook-mcp/commit/e7fce8a74655b2c3ab8785aaa6b5f11f1650049d))
* MCP server entry with list_vendors registered ([6c02a0a](https://github.com/chrischall/honeybook-mcp/commit/6c02a0a6f60b0009653cd3d8e03bb304872d9198))
* plugin / marketplace / mcpb / server.json manifests ([2c9e330](https://github.com/chrischall/honeybook-mcp/commit/2c9e330ada4a39a50cb6ff7cc70155f72295b115))
* replace Puppeteer with @fetchproxy/bootstrap for session capture ([c23bb74](https://github.com/chrischall/honeybook-mcp/commit/c23bb7496218a0d4330ded235a70358c7ce82e92))
* **scripts:** setup-auth.mjs captures magic-link credentials via Puppeteer ([b84efef](https://github.com/chrischall/honeybook-mcp/commit/b84efef6fdfcfb057e16352624da4bdf65f3138b))
* **tools:** enrich summary — include base_services, package_services, full descriptions ([649db77](https://github.com/chrischall/honeybook-mcp/commit/649db77b4fedc83006ddcc3e76d07b00be9751fa))
* **tools:** get_workspace ([3222e34](https://github.com/chrischall/honeybook-mcp/commit/3222e3496a66b5b657602c399ba6a591cef13514))
* **tools:** list_payment_methods ([97bb636](https://github.com/chrischall/honeybook-mcp/commit/97bb636617ffa0adb9c3a9ba3dc36aba52fe4b1c))
* **tools:** list_vendors (env-only, no API call) ([4cb6818](https://github.com/chrischall/honeybook-mcp/commit/4cb68189fb67266c8ad0a9b3a3a70e48fcd67eea))
* **tools:** list_workspace_files + get_workspace_file ([ed45b2b](https://github.com/chrischall/honeybook-mcp/commit/ed45b2b125d57ec5d48ba4772812336d807434cf))
* **tools:** pay_invoice with deep-link fallback + confirm guard ([ef6f892](https://github.com/chrischall/honeybook-mcp/commit/ef6f892650bec5ab62d5ddf00f344264a7cbf937))
* **tools:** sectional retrieval for get_workspace_file (1.45 MB → 4 kB default) ([3dcdece](https://github.com/chrischall/honeybook-mcp/commit/3dcdece37c21581e2da431fb128221f97bd105b8))
* **tools:** sign_contract with deep-link fallback + confirm guard ([62ea1d6](https://github.com/chrischall/honeybook-mcp/commit/62ea1d6d74fc0574641a39cd59f059ad3493f990))
* use_magic_link delegates to captureSessionViaFetchproxy ([1da0b72](https://github.com/chrischall/honeybook-mcp/commit/1da0b72fdc58babcbb8dc0e79cdf14d86d5aa0d0))


### Bug Fixes

* address final code-review findings ([012f587](https://github.com/chrischall/honeybook-mcp/commit/012f587a44a91473b406bec024012cd524184ff1))
* **auth:** storageDomain selector + restore createRequire bundle shim ([4fe3e27](https://github.com/chrischall/honeybook-mcp/commit/4fe3e27e9068256847b531fd2235391f53a2a95c))
* **client:** seed moduleState on version-retry; avoid env-reload on cache hit; restore timers in finally ([b890f86](https://github.com/chrischall/honeybook-mcp/commit/b890f86ce10a7aebc7538b46c9c6ae9549d81e5d))
* **env:** also reject literal "undefined"/"null" in readVar ([9b8b048](https://github.com/chrischall/honeybook-mcp/commit/9b8b048cf3b622babc458aa882f9b8d5920a248b))
* **env:** treat blank/whitespace/placeholder env vars as unset ([dbb0968](https://github.com/chrischall/honeybook-mcp/commit/dbb09682e3d954339dd34a8d7aa2e58ade995dc8))
* **sessions:** fall back to portal subdomain when HB_CURR_USER isn't loaded yet ([10a7aa4](https://github.com/chrischall/honeybook-mcp/commit/10a7aa473890a3b7042acaa9931a57d2fbf2a510))
* **sessions:** lazy-install puppeteer-core when sibling node_modules is absent ([35a3eca](https://github.com/chrischall/honeybook-mcp/commit/35a3ecaa6e793b2c0efd9b9cd458f825af8855fc))
* **tools:** strip heavy vendor-side fields from get_workspace_file response ([885ad77](https://github.com/chrischall/honeybook-mcp/commit/885ad77034813bf9c2ef97432345e48e17585513))


### Refactor

* **auth:** use 0.4.0 JSON-pointer extraction + pair/wait callbacks ([2a3b6ef](https://github.com/chrischall/honeybook-mcp/commit/2a3b6efc2a0821427218165718fedf620e5aaa80))
* **client:** switch client factory from env-based vendor scopes to session store ([c07b7d0](https://github.com/chrischall/honeybook-mcp/commit/c07b7d0651f9a3c5f8bcca0ce88e5a562b823653))
* drop Puppeteer code from sessions.ts; add SessionStore.add() ([9455119](https://github.com/chrischall/honeybook-mcp/commit/945511943733e5210a759e0de740942c0f1cc653))
* **sessions:** add session store with Puppeteer capture and disk cache ([2d6c39d](https://github.com/chrischall/honeybook-mcp/commit/2d6c39dcaafac962177628a0a02f44e0c151010d))
* **tools:** switch all tools from vendor slug to origin + add session tools ([e1de31f](https://github.com/chrischall/honeybook-mcp/commit/e1de31f75044a900f529335009810257d858c299))


### Documentation

* add implementation plan for honeybook-mcp ([8659019](https://github.com/chrischall/honeybook-mcp/commit/8659019568d5560c9617f4a8eded6c0e2f57a062))
* add initial design spec for honeybook-mcp ([715a6dc](https://github.com/chrischall/honeybook-mcp/commit/715a6dc4a98ec7fe518faab3718124f400c9bfa4))
* **CLAUDE.md:** drop hardcoded fetchproxy 0.3.0 version refs ([3c63f33](https://github.com/chrischall/honeybook-mcp/commit/3c63f3392b270ad7475151cf87866d9f5a32a99a))
* ensure CLAUDE.md is current and complete ([b0efa59](https://github.com/chrischall/honeybook-mcp/commit/b0efa590a735dc00df4fefd5897c40e157cace16))
* README, SKILL.md (top + skills/honeybook), CLAUDE.md ([6d4a00f](https://github.com/chrischall/honeybook-mcp/commit/6d4a00f6d528a5451b8c7c060d586a0fd43b3e51))
* rewrite README + CLAUDE.md for fetchproxy-based onboarding ([37820ac](https://github.com/chrischall/honeybook-mcp/commit/37820acf9ed06905335cca6a19241ea5455d2f94))
