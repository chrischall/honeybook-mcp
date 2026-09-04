# Changelog

## [0.10.0](https://github.com/chrischall/honeybook-mcp/compare/v0.9.0...v0.10.0) (2026-09-04)


### Features

* **tools:** minify every response — no formatting whitespace on any payload ([#189](https://github.com/chrischall/honeybook-mcp/issues/189)) ([1751df9](https://github.com/chrischall/honeybook-mcp/commit/1751df9baedba4e426df02bbe0d92d14cade5a10))
* **tools:** put get_project and get_flow on the fleet `view` vocabulary ([#193](https://github.com/chrischall/honeybook-mcp/issues/193)) ([1f078a4](https://github.com/chrischall/honeybook-mcp/commit/1f078a46872a0a0e7f091c487a68bd11acc823c5))


### Refactor

* **tools:** drop the unwired view.ts — `section` already does this job ([#192](https://github.com/chrischall/honeybook-mcp/issues/192)) ([96a9d20](https://github.com/chrischall/honeybook-mcp/commit/96a9d2095c48ca01cdbc9a5929f23a93cd826edb))

## [0.9.0](https://github.com/chrischall/honeybook-mcp/compare/v0.8.2...v0.9.0) (2026-09-02)


### Features

* messaging, projects, meetings, tasks, notes, attachments and payments tools ([#182](https://github.com/chrischall/honeybook-mcp/issues/182)) ([1337b18](https://github.com/chrischall/honeybook-mcp/commit/1337b18ac548442540f0d9b95f885048d3b8ebf1))


### Bug Fixes

* **messages:** keep paragraph breaks, scrub host links everywhere, local today, per-currency totals ([#185](https://github.com/chrischall/honeybook-mcp/issues/185)) ([eda664d](https://github.com/chrischall/honeybook-mcp/commit/eda664dc8fcbcadb65f515f8bd12f2091839510d))

## [0.8.2](https://github.com/chrischall/honeybook-mcp/compare/v0.8.1...v0.8.2) (2026-08-31)


### Bug Fixes

* **flows:** offer Grant before revoke when the extension refuses a flow scope ([#174](https://github.com/chrischall/honeybook-mcp/issues/174)) ([f8f9ab6](https://github.com/chrischall/honeybook-mcp/commit/f8f9ab6489702d543a968fdfe7eadecc78649b84))

## [0.8.1](https://github.com/chrischall/honeybook-mcp/compare/v0.8.0...v0.8.1) (2026-08-31)


### Bug Fixes

* **flows:** stop refusing a flow read for want of a ctxc the API ignores ([#169](https://github.com/chrischall/honeybook-mcp/issues/169)) ([d7a5a5f](https://github.com/chrischall/honeybook-mcp/commit/d7a5a5fadc79613d6c3da2e1f0fb5eeda24cf937))


### Documentation

* **flows:** stop fetchFlowMinimal's error calling ctxc required ([#172](https://github.com/chrischall/honeybook-mcp/issues/172)) ([f78b3c9](https://github.com/chrischall/honeybook-mcp/commit/f78b3c9a793f57f2ed71546f7df9da65fdc2d981))

## [0.8.0](https://github.com/chrischall/honeybook-mcp/compare/v0.7.1...v0.8.0) (2026-08-31)


### Features

* **flows:** support questionnaire (/flow/) magic links as their own credential kind ([#158](https://github.com/chrischall/honeybook-mcp/issues/158)) ([daf9a05](https://github.com/chrischall/honeybook-mcp/commit/daf9a057a991bb8aca9d24c4f9b3c4a2eec0c1e6))


### Bug Fixes

* **flows:** bound get_flow's payload, and report the field it captured ([#161](https://github.com/chrischall/honeybook-mcp/issues/161)) ([db40779](https://github.com/chrischall/honeybook-mcp/commit/db4077991e1f6819f8618b4e4c78d924ef307817))
* **flows:** get_flow must call /api/v2/client/flow/&lt;id&gt;/active?ctxc=&lt;companyId&gt; ([#164](https://github.com/chrischall/honeybook-mcp/issues/164)) ([f398ffd](https://github.com/chrischall/honeybook-mcp/commit/f398ffdad697004d5f09b1d819b8673918504c5b))
* **flows:** keep /minimal's error body, and pin the header that broke get_flow ([#166](https://github.com/chrischall/honeybook-mcp/issues/166)) ([1a40d65](https://github.com/chrischall/honeybook-mcp/commit/1a40d6576938516907a7b1e0d65ed9d37feeffa5))


### Documentation

* **flows:** put the MAX_FLOW_BYTES const before getFlow's docblock ([#163](https://github.com/chrischall/honeybook-mcp/issues/163)) ([b8ca9a9](https://github.com/chrischall/honeybook-mcp/commit/b8ca9a95b7eebbcb84ec235617b576487815253f))
* rewrap the flow-client.ts architecture-map entry ([#168](https://github.com/chrischall/honeybook-mcp/issues/168)) ([df29253](https://github.com/chrischall/honeybook-mcp/commit/df2925301b6febf31e6286e445879557f38f1383))

## [0.7.1](https://github.com/chrischall/honeybook-mcp/compare/v0.7.0...v0.7.1) (2026-08-31)


### Bug Fixes

* **healthcheck:** a missing session is not a rejected one ([#156](https://github.com/chrischall/honeybook-mcp/issues/156)) ([67c29c7](https://github.com/chrischall/honeybook-mcp/commit/67c29c76946c06ab45974a0bbf214be5168efb78))

## [0.7.0](https://github.com/chrischall/honeybook-mcp/compare/v0.6.0...v0.7.0) (2026-08-30)


### Features

* add honeybook_healthcheck ([#151](https://github.com/chrischall/honeybook-mcp/issues/151)) ([efe9ae6](https://github.com/chrischall/honeybook-mcp/commit/efe9ae683abc5f7447c503c90b16c5787d0cbc5a)), closes [#152](https://github.com/chrischall/honeybook-mcp/issues/152)

## [0.6.0](https://github.com/chrischall/honeybook-mcp/compare/v0.5.0...v0.6.0) (2026-08-29)


### Features

* **deps:** take @fetchproxy/server 2.2.0 so the concentrator can bind its sandbox address ([#147](https://github.com/chrischall/honeybook-mcp/issues/147)) ([ae79feb](https://github.com/chrischall/honeybook-mcp/commit/ae79febca049a23eaf78a2a5d14f864972cc737d))

## [0.5.0](https://github.com/chrischall/honeybook-mcp/compare/v0.4.6...v0.5.0) (2026-08-26)


### Features

* **release:** publish honeybook-fpx alongside honeybook ([#144](https://github.com/chrischall/honeybook-mcp/issues/144)) ([a0f75cf](https://github.com/chrischall/honeybook-mcp/commit/a0f75cfc6b117859e3ee18c50712e58bd6b989ac))

## [0.4.6](https://github.com/chrischall/honeybook-mcp/compare/v0.4.5...v0.4.6) (2026-08-11)


### Documentation

* tell 0.4.4 users they must re-approve the extension scope ([#132](https://github.com/chrischall/honeybook-mcp/issues/132)) ([72dc609](https://github.com/chrischall/honeybook-mcp/commit/72dc609cd90a88e9cb172b0511586f2719db3636))

## [0.4.5](https://github.com/chrischall/honeybook-mcp/compare/v0.4.4...v0.4.5) (2026-08-11)


### Bug Fixes

* **auth:** read the portal session from HONEYBOOK_REACT_CURR_USER ([#126](https://github.com/chrischall/honeybook-mcp/issues/126)) ([6c47171](https://github.com/chrischall/honeybook-mcp/commit/6c47171408292f639d49afccf86528bcd9fa364b))
* **auth:** surface the re-pair remedy when the extension refuses a new scope ([#131](https://github.com/chrischall/honeybook-mcp/issues/131)) ([0a8a069](https://github.com/chrischall/honeybook-mcp/commit/0a8a06917210d0f9a5f2d0154a6952a1969a528d))


### Documentation

* drop the removed jStorage + fingerprint capture from README and skill ([#129](https://github.com/chrischall/honeybook-mcp/issues/129)) ([362f414](https://github.com/chrischall/honeybook-mcp/commit/362f4144dd5064c2b77280664a25da823e20b7ee))
* **skill:** stop sending unset fingerprint/trusted-device headers in hb_get ([#130](https://github.com/chrischall/honeybook-mcp/issues/130)) ([5cb4cfc](https://github.com/chrischall/honeybook-mcp/commit/5cb4cfc09e572aa655f9d29b11eac194e6410ac3))

## [0.4.4](https://github.com/chrischall/honeybook-mcp/compare/v0.4.3...v0.4.4) (2026-08-06)


### Bug Fixes

* **deps:** move to @fetchproxy/server 2.0.0 for the v3 handshake ([#123](https://github.com/chrischall/honeybook-mcp/issues/123)) ([b6d6742](https://github.com/chrischall/honeybook-mcp/commit/b6d67423d6f0cedb7b0047e102a9d9bf4b235a0d))

## [0.4.3](https://github.com/chrischall/honeybook-mcp/compare/v0.4.2...v0.4.3) (2026-07-30)


### Bug Fixes

* **deps:** bump @fetchproxy/* to 1.7.0 and @chrischall/mcp-utils to 0.14.0 ([#116](https://github.com/chrischall/honeybook-mcp/issues/116)) ([395af80](https://github.com/chrischall/honeybook-mcp/commit/395af80a91a8a834513b0633af2df4673378e5c9))

## [0.4.2](https://github.com/chrischall/honeybook-mcp/compare/v0.4.1...v0.4.2) (2026-07-27)


### Bug Fixes

* **release:** indent skill-path into the with: block ([#113](https://github.com/chrischall/honeybook-mcp/issues/113)) ([9e83a07](https://github.com/chrischall/honeybook-mcp/commit/9e83a07cfa150884f00b65ea17b9d3e54e027848))
* **release:** restore the skill-path pin dropped by the pipeline sweep ([#112](https://github.com/chrischall/honeybook-mcp/issues/112)) ([06bff6f](https://github.com/chrischall/honeybook-mcp/commit/06bff6fccd9a28be4404f6cca233a20c60570219))

## [0.4.1](https://github.com/chrischall/honeybook-mcp/compare/v0.4.0...v0.4.1) (2026-07-19)


### Bug Fixes

* **release:** pin skill-path so the publish job can resolve SKILL.md ([#101](https://github.com/chrischall/honeybook-mcp/issues/101)) ([17c4d42](https://github.com/chrischall/honeybook-mcp/commit/17c4d426275413c0d863507311e0d255c8ae2a70))


### Documentation

* replace duplicated fleet policy with a pointer ([#104](https://github.com/chrischall/honeybook-mcp/issues/104)) ([70d6b06](https://github.com/chrischall/honeybook-mcp/commit/70d6b06d38be907326ec6a37c3088797eca71828))

## [0.4.0](https://github.com/chrischall/honeybook-mcp/compare/v0.3.6...v0.4.0) (2026-07-13)


### Features

* **skill:** add honeybook fpx access skill ([#98](https://github.com/chrischall/honeybook-mcp/issues/98)) ([e4abb69](https://github.com/chrischall/honeybook-mcp/commit/e4abb69f6796116779aa00fd3579c792f634227b))


### Refactor

* **skill:** move root SKILL.md into skills/, point plugin.json at ./skills/ ([#100](https://github.com/chrischall/honeybook-mcp/issues/100)) ([9cfee10](https://github.com/chrischall/honeybook-mcp/commit/9cfee1053dffbb2c67d5fafdbd89b9ca792c99ae))

## [0.3.6](https://github.com/chrischall/honeybook-mcp/compare/v0.3.5...v0.3.6) (2026-07-07)


### Bug Fixes

* bump @chrischall/mcp-utils to 0.12.0 ([#93](https://github.com/chrischall/honeybook-mcp/issues/93)) ([ae5b619](https://github.com/chrischall/honeybook-mcp/commit/ae5b619e5a1ff18f5df51d9ac4d4115d70ce0b70))

## [0.3.5](https://github.com/chrischall/honeybook-mcp/compare/v0.3.4...v0.3.5) (2026-06-16)


### Bug Fixes

* **auth:** give actionable guidance when fingerprint capture times out ([#83](https://github.com/chrischall/honeybook-mcp/issues/83)) ([1d25014](https://github.com/chrischall/honeybook-mcp/commit/1d25014f6d8c48bd8dcdf18649269de8f679c31d))


### Documentation

* document auto-review follow-up issue convention ([#82](https://github.com/chrischall/honeybook-mcp/issues/82)) ([e379b67](https://github.com/chrischall/honeybook-mcp/commit/e379b6791cc021b9fd36dd5ae2bdcab5fc0d66e5))
* require Conventional Commit PR titles for release-please ([#78](https://github.com/chrischall/honeybook-mcp/issues/78)) ([574adbd](https://github.com/chrischall/honeybook-mcp/commit/574adbda60637d406155e4aa0a43f845466604d0))

## [0.3.4](https://github.com/chrischall/honeybook-mcp/compare/v0.3.3...v0.3.4) (2026-06-13)


### Bug Fixes

* bot PRs bypass the CI gate unconditionally (upstream curtaincall[#86](https://github.com/chrischall/honeybook-mcp/issues/86) review) ([#74](https://github.com/chrischall/honeybook-mcp/issues/74)) ([e83a384](https://github.com/chrischall/honeybook-mcp/commit/e83a38468c489dfdb808d02c5ac36314b2c852c3))


### Documentation

* add MIT LICENSE file and README badges ([#72](https://github.com/chrischall/honeybook-mcp/issues/72)) ([d33bd1d](https://github.com/chrischall/honeybook-mcp/commit/d33bd1db362e8534c71f43359f4a29ab0c5e4b68))
* correct release flow to describe release-please ([#70](https://github.com/chrischall/honeybook-mcp/issues/70)) ([93b5d1f](https://github.com/chrischall/honeybook-mcp/commit/93b5d1f1900f464b327dd1633dc6143b4e9cfc01))

## [0.3.3](https://github.com/chrischall/honeybook-mcp/compare/v0.3.2...v0.3.3) (2026-06-10)


### Bug Fixes

* clear cached api-version promise on rejection so fetch retries ([#66](https://github.com/chrischall/honeybook-mcp/issues/66)) ([9ce9c76](https://github.com/chrischall/honeybook-mcp/commit/9ce9c76c1fa976fa24582cec4231ffdd7284f31f))

## [0.3.2](https://github.com/chrischall/honeybook-mcp/compare/v0.3.1...v0.3.2) (2026-06-04)


### Bug Fixes

* adopt @fetchproxy/server 0.13.0 (bridge host failover + re-pairing) ([#60](https://github.com/chrischall/honeybook-mcp/issues/60)) ([b92c7f6](https://github.com/chrischall/honeybook-mcp/commit/b92c7f633585781f43afed9b49956b444fc7c7a0))
* migrate captureHeaders to [@fetchproxy](https://github.com/fetchproxy) 1.0.0 { host, path?, headerName } ([#62](https://github.com/chrischall/honeybook-mcp/issues/62)) ([d89ef2e](https://github.com/chrischall/honeybook-mcp/commit/d89ef2e1d57f4ddc809df7d4b917d3f6de746c59))

## [0.3.1](https://github.com/chrischall/honeybook-mcp/compare/v0.3.0...v0.3.1) (2026-05-29)


### Bug Fixes

* **ci:** auto-merge arm guards ([#46](https://github.com/chrischall/honeybook-mcp/issues/46)) ([20ddc89](https://github.com/chrischall/honeybook-mcp/commit/20ddc89401fc3b82bf7291da416000c46cb8e61f))

## [0.3.0](https://github.com/chrischall/honeybook-mcp/compare/v0.2.4...v0.3.0) (2026-05-28)


### Features

* **deps:** bump @fetchproxy/bootstrap to ^0.8.0 + surface SW-eviction hint ([#44](https://github.com/chrischall/honeybook-mcp/issues/44)) ([2d9c698](https://github.com/chrischall/honeybook-mcp/commit/2d9c6984ec3ef6a080fc7bbad6178d0a4be3ca0c))

## [0.2.4](https://github.com/chrischall/honeybook-mcp/compare/v0.2.3...v0.2.4) (2026-05-26)


### Bug Fixes

* **ci:** substitute repo name in publish workflow ([#41](https://github.com/chrischall/honeybook-mcp/issues/41)) ([8a73398](https://github.com/chrischall/honeybook-mcp/commit/8a73398bf6e8ce1cd47637428c18b3895a249766))

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
