# Narra Studio Frontend Refactor Plan

> Source of truth: repository state at `BASE_COMMIT=7d89b49fa484135019f08beeb3e0e1e2fc606d16`.
> This plan protects the recovered renderer and does not authorize changes to Electron Main, preload, IPC handlers, providers, CAPTCHA, authentication, generation, workspace, or media behavior.
>
> Source-recovery migration baseline: `SOURCE_RECOVERY_BASE_COMMIT=20d144c28465f3870fa22d1bd7d5fea4c2fc1fc0` on `develop`.

## 1. Baseline

| Item | Verified state |
| --- | --- |
| Target/current branch | `develop` |
| Base commit | `7d89b49fa484135019f08beeb3e0e1e2fc606d16` |
| Working tree before task | Clean |
| Runtime source | `apps/desktop/src` |
| Renderer | Recovered/compiled JavaScript and CSS output |
| Build behavior | `scripts/build-recovered-desktop.mjs` copies renderer and Electron source; it does not bundle or tree-shake |
| Renderer inventory | 89 files, 13.72 MiB total; 61 JS files (4.63 MiB); 12 CSS files (1,306.9 KiB) |
| Frontend IPC usage | 215 distinct direct static `window.api.*` method names; no direct static `window.electronAPI.*` usage detected |
| Lazy imports | 36 import targets found in the main renderer entry |
| Browser baseline | Not captured: `playwright-cli`, `node`, and `npm` are unavailable in the sandbox PATH; no browser test setup exists in the repository |

### Current validation state

Baseline command: `pnpm validate`

| Stage | Result | Classification |
| --- | --- | --- |
| Desktop typecheck/syntax check | PASS: 54 Electron files, renderer entry and startup voice cache | Baseline |
| Local workspace IPC smoke | PASS | Baseline |
| CAPTCHA extension tests | PASS | Baseline |
| CAPTCHA extension package staging | PASS | Baseline |
| Light theme UI contract | FAIL at `scripts/test-light-theme-ui.cjs:75` | **PRE-EXISTING FAILURE** |
| Build | NOT RUN by `validate` because the test chain stopped | Blocked by pre-existing failure |

The failing assertion requires `.sidebar { border-right: 0 !important; }`, while the current source uses a 2px hardcoded border. This is an implementation-detail assertion and no longer represents a stable behavior contract.

## 2. Backend protection boundary

### Prohibited files

- `apps/desktop/src/electron/**`
- Any generated/package copy of Electron Main or preload
- `.env`, credentials, cookies, sessions, projects, databases and user media

### Prohibited behavior changes

- No rename, removal or payload/response change to `window.api.*`.
- No IPC channel or handler changes.
- No provider, Google Flow, CAPTCHA, authentication/session, workspace or generation changes.
- No paid provider call, Google login, CAPTCHA solve or credit-consuming generation during validation.
- Existing callbacks remain attached to the same user actions when presentation is restyled.

### Static frontend IPC surface guard

Phase 0 adds a generated Frontend IPC Usage Manifest and a read-only surface-baseline check that:

1. scans every renderer `.js`/`.html` file for direct static `window.api.*` and `window.electronAPI.*` member access;
2. records method name and every frontend caller file;
3. extracts the methods exposed by `apps/desktop/src/electron/preload.js` without modifying it;
4. records the existing methods absent from preload and fails when that baseline or the direct static method-name surface changes;
5. records the dynamic-import target baseline and fails when it changes unexpectedly.

The guard does not validate argument order/count, payload or response schemas, callback semantics, indirect/aliased API access, or backend handler semantics. The canonical method-by-file inventory lives in `docs/frontend-ipc-usage-manifest.json`; this plan records its count and policy, while the generated file records all 215 entries without hand-maintained duplication.

## 3. Verified frontend architecture

- `apps/desktop/src/renderer/index.html` loads the main compiled entry, two preloaded chunks, the global compiled stylesheet and `light-theme.css`.
- There is no maintainable React/TypeScript renderer source tree in the current runtime.
- The main entry is about 804 KiB; `AgentPreviewModal` is about 1,335.5 KiB, `AIAgentPage` about 736.1 KiB and `CapcutVideoPage` about 552.5 KiB.
- The global compiled CSS is about 1,139.5 KiB and is followed by a 27.3 KiB compatibility/theme override.
- Component-library adoption cannot currently benefit from normal source compilation, type checking or reliable tree-shaking. UI work must therefore start with semantic CSS tokens and small recovered-bundle edits only when a string/function target is exact and testable.

## 4. Confirmed findings

| Priority | File/location | Evidence | Impact | Risk | Recommended action |
| --- | --- | --- | --- | --- | --- |
| P0 | `scripts/check-recovered-desktop.mjs:23-28` | Only the main renderer entry is syntax-checked | A broken lazy chunk can pass typecheck until opened | Low change risk | Check every renderer JS file as an ES module |
| P0 | `assets/index-JlIFz2Wa.js:23565-23721` | 36 dynamic imports; `HomePage-CmVI9USd.js`, `ExplorePage-Db5ZPOvh.js`, `CommunityPage-Cjuo0iuT.js`, and `WorkflowAppDetailPage-BPgOUN4a.js` do not exist | A reachable legacy page would fail at runtime | High deletion risk | Validate targets and route reachability; do not delete/rename routes yet |
| P0 | Renderer-wide IPC scan | 215 distinct direct static `window.api.*` method names across recovered chunks | Visual edits can accidentally alter the frontend IPC surface hidden inside minified code | High | Generate a surface manifest and enforce its baseline in validation |
| P1 | `scripts/test-light-theme-ui.cjs:75` | Test expects exact sidebar border value and currently fails | `pnpm validate` cannot complete; test protects implementation rather than behavior | Low | Replace with stable token/structure invariant and later add runtime behavior tests |
| P1 | `index.html:9-16`, `286-327` | Unused Google Fonts are injected in non-file mode; readiness polls `sheet.cssRules` every 50ms with a 3s fallback | Cross-origin styles can keep readiness false; startup may be artificially delayed | Medium | Remove unused remote font injection; use a root DOM mutation readiness heuristic, two-frame visual settling heuristic and time-based forced reveal fallback |
| P1 | `light-theme.css` and compiled page CSS | 795 `!important`, 203 `transition: all`, 398 gradients, 708 box-shadow declarations, 161 keyframes and 5,516 hardcoded hex occurrences | High cascade coupling, visual inconsistency and hover regressions | High if changed broadly | Introduce tokens and clean one shell/page slice at a time; no global regex replacement |
| P1 | `index.html:129-143` plus shell CSS | Sidebar width is hardcoded at 200px in critical CSS and shell dimensions/states also occur in compiled CSS | Duplicate layout sources and shifting risk | Medium | Define shell tokens once and consume them in the compatibility layer first |
| P1 | `assets/index-JlIFz2Wa.js:24134-24350` | Page IDs are repeated across allowed, provider-gated, CAPTCHA-exempt and provider-switch sets | Navigation policy is difficult to verify and easy to drift | High logic risk | Inventory and test IDs first; do not consolidate minified logic until semantics are proven |
| P2 | Renderer JS | 153 `localStorage.` references and 212 empty `catch` blocks found by static scan | Schema drift and silent UI failures | Medium | Add thin helpers only after call shapes are inventoried; preserve current fallback semantics |
| P2 | `index.html:212-216` and splash copy | A `:lang(zh)` compatibility rule remains while supported UI locale is `vi/en`; splash text is hardcoded Vietnamese | Dead locale styling and English startup locale flash | Low | Remove verified Chinese-only styling; initialize neutral/localized splash without expanding i18n scope |
| P3 | Renderer assets | Several multi-megabyte files have no literal-name reference in renderer text | Potential package bloat | Very high deletion risk | Candidate list only; runtime/Electron/CSS/dynamic-path verification required in Phase 9 |

Static counts are baselines, not deletion KPIs. They will be remeasured with the same scanner after each relevant phase.

## 5. CSS and App Shell audit direction

### App Shell target

```text
AppShell
├── Sidebar
├── Header
├── MainContent
└── OverlayRoot
```

The recovered DOM was not rewritten to this structure. Phases 2-3 completed CSS compatibility-layer normalization around the existing `.app`, `.sidebar`, `.main-content` and `.atelier-header-profile` structure: shared dimensions/design tokens, collapsed offsets and hover/active/focus states.

Not completed: a React `AppShell` component refactor, semantic Header markup, Sidebar information architecture, removal of `sidebar-*` class coupling from Header, `OverlayRoot` extraction or shared React primitives.

Required shell tokens:

```css
--sidebar-width
--sidebar-collapsed-width
--header-height
--background
--surface
--surface-muted
--surface-hover
--foreground
--muted-foreground
--border
--border-strong
--primary
--primary-foreground
--primary-muted
--success
--warning
--danger
--space-1 ... --space-6
--radius-sm
--radius-md
--radius-lg
--control-height-sm
--control-height-md
```

Typography will use role-specific classes/tokens instead of forcing all `h2`, `h3`, `p`, `span`, `strong`, `label`, `button` and `input` to one size and weight.

## 6. UI library evaluation

Current recommendation: **do not install a UI library during Phases 0-4**. Apply a shadcn-like design language using CSS tokens and existing React/Lucide output first.

| Option | Strengths | Cost/risk in this repository | Decision |
| --- | --- | --- | --- |
| shadcn/ui | Open component code, composable patterns, consistent design language | Requires maintainable React source and a normal component/build workflow; copying generated source into recovered chunks would be a rewrite hazard | Use as visual/design-system reference only for now |
| Radix Primitives | Mature unstyled accessible primitives; keyboard/focus management; incremental imports; MIT | Integration into recovered compiled output cannot be type-checked or tree-shaken by the current copy build | Preferred future primitive layer after a clean component boundary exists, starting with Dialog/Popover/Dropdown/Tooltip |
| Base UI | Unstyled, accessible, composable; React 17+; MIT; consolidated package | Newer API surface and still requires clean React source/build integration | Re-evaluate against Radix when the first maintainable source island exists; do not mix both |
| Sonner | Focused React toast API; MIT; mature adoption | Existing toast logic already works and changing it would touch global feedback semantics | Keep current toast behavior; standardize tokens/ARIA first; reconsider only if current implementation proves deficient |
| Existing/native controls | Zero dependency and lowest contract risk | More a11y work must be implemented locally for complex widgets | Default for Button/Input/Badge/Card/Tabs styling in current phases |

Dependency acceptance gate for any future phase: official maintenance status, compatible React version, license, dependency graph/lockfile diff, emitted bundle delta, accessibility behavior, Electron compatibility, rollback path and green contract tests.

Research basis checked on 2026-08-14: [shadcn/ui introduction](https://ui.shadcn.com/docs), [Radix introduction](https://www.radix-ui.com/primitives/docs/overview/introduction), [Radix accessibility](https://www.radix-ui.com/primitives/docs/overview/accessibility), [Base UI overview](https://base-ui.com/react/overview/about), [Base UI releases](https://base-ui.com/react/overview/releases), and [Sonner repository/license](https://github.com/emilkowalski/sonner). At audit time Radix and Base UI document MIT licensing and incremental/headless use; that does not override the repository-specific integration risk above.

## 7. Route and dead-functionality classification

| Candidate | Current classification | Evidence and required proof |
| --- | --- | --- |
| Dashboard, Image, Image Ultra, Video Pro/Standard, Upload/Library, Concat, Video Editor, Capcut/Gencut, Voice, Provider, CAPTCHA, Settings, Guide | **ACTIVE** | Present in the main allowed page set and/or current sidebar/provider flows |
| AI Agent and Workspaces | **ACTIVE** | Product rules mark them core; chunks exist and current navigation logic references them even though they are not in the initial allowed set |
| License/subscription/payment | **LIKELY_DEAD** | Product docs say removed and license branches include constant-false/constant-true gates; CSS/strings still exist. Runtime reachability is not yet fully proven |
| `CommunityPage-Cjuo0iuT.js` | **LIKELY_DEAD** | Target chunk is missing and no supported Sidebar/internal navigation producer was found; lazy mapping/render branch and `community*` API references remain |
| `ExplorePage-Db5ZPOvh.js` | **LIKELY_DEAD** | Target chunk is missing, the page is absent from the initial allowed set and Sidebar, and no direct internal navigation producer was found |
| `HomePage-CmVI9USd.js` | **LIKELY_DEAD** | Navigation normalizes `home` to `dashboard`, the target chunk is missing and the page is absent from the initial allowed set/Sidebar |
| `WorkflowAppDetailPage-BPgOUN4a.js` | **LIKELY_DEAD** | Target chunk is missing; its retained navigation callback is inside the missing/unreachable Home page branch, while lazy mapping/render code remains |
| Static asset candidates | **UNKNOWN** | Literal-name scan alone is insufficient; Electron, CSS URL and dynamic runtime path checks are pending |

Static producer analysis found one renderer dispatch of `genyu:navigate-page`, targeting `license`, and no producer targeting these four page IDs. The generic listener still accepts arbitrary `detail.page` values, so external/runtime producers cannot be proven absent and none of the four targets is `CONFIRMED_DEAD`. Only an item promoted to `CONFIRMED_DEAD` after `navigation → route → lazy mapping → component → runtime reference` proof can be removed. No backend IPC will be removed with frontend dead code.

## 8. Phase plan

### Phase 0 — Baseline and protection

- **Goal:** Pin evidence and add non-behavioral surface inventories.
- **Files allowed:** `FRONTEND_REFACTOR_PLAN.md`, `docs/frontend-ipc-usage-manifest.json`, new scripts under `scripts/`, root `package.json` scripts only if required.
- **Files prohibited:** `apps/desktop/src/electron/**`, renderer runtime files.
- **Exact changes:** Generate IPC manifest; add a static frontend IPC surface guard plus route/lazy target inventory checks; record metrics and tool limitations.
- **Risk:** Scanner false positives from minified syntax/dynamic property access.
- **Validation:** Run new checks, existing typecheck/test stages and inspect manifest diff.
- **Rollback condition:** Check cannot deterministically reproduce the same manifest or flags valid dynamic access as a hard failure.
- **Definition of Done:** 215 current methods are reproducibly inventoried; missing preload methods and missing lazy targets are reported distinctly; no runtime file changes.

### Phase 1 — Quality gate and startup safety

- **Goal:** Restore trustworthy validation and remove confirmed startup dead work.
- **Files allowed:** `scripts/check-recovered-desktop.mjs`, `scripts/test-light-theme-ui.cjs`, `apps/desktop/src/renderer/index.html`, `light-theme.css` only if a token invariant is needed.
- **Files prohibited:** Electron source, page chunks, route logic.
- **Exact changes:** Syntax-check all renderer JS; validate imports/assets; replace exact-border assertion with stable shell invariant; remove unused Google Fonts; use a root DOM mutation readiness heuristic, two-frame visual settling heuristic and time-based forced reveal fallback; remove verified `:lang(zh)` splash rule.
- **Risk:** Revealing root before compiled/page CSS is usable.
- **Validation:** `pnpm validate`, static import check, startup HTML contract, manual Electron smoke if executable tooling is available.
- **Rollback condition:** blank/unstyled first paint, new console exception, or validate regression.
- **Definition of Done:** Full validate passes or remaining failures are proven pre-existing and documented; every renderer JS file is syntax-checked.

### Phase 2 — Design tokens and shell foundation

- **Goal:** Establish a single visual vocabulary and shell dimensions without route/callback changes.
- **Files allowed:** `light-theme.css`, `index.html` critical CSS, UI contract tests.
- **Files prohibited:** Electron source and business page logic.
- **Exact changes:** Add semantic surface/text/state/spacing/radius/control/shell tokens; map legacy variables to them; set sidebar/header/main dimensions from tokens; define z-index and motion/focus tokens.
- **Risk:** Cascade changes across compiled page CSS.
- **Validation:** CSS contract, screenshots/manual smoke of all active top-level pages when tooling permits, reduced-motion check, before/after counts.
- **Rollback condition:** unreadable contrast, layout shift, overflow or control state regression.
- **Definition of Done:** The App Shell CSS compatibility layer consumes shared dimension tokens and token-driven active/hover/focus states.

### Phase 3 — Sidebar and Header visual normalization

- **Goal:** Calm visual hierarchy in the CSS compatibility layer while preserving markup, page IDs and handlers.
- **Files allowed:** `light-theme.css` and tests.
- **Files prohibited:** provider/CAPTCHA/auth callbacks, navigation page IDs, IPC calls, Electron source.
- **Exact changes:** Apply expanded/collapsed dimension tokens, calm hover/active/focus states, stable Header surface/border and collapsed offsets without editing recovered component markup.
- **Risk:** CSS cascade can alter shell alignment or collapsed behavior.
- **Validation:** Static IPC surface baseline unchanged, route inventory unchanged, keyboard/collapse/navigation smoke and visual baseline comparison when runtime tooling is available.
- **Rollback condition:** any changed API usage, page ID, provider gate, selected route, collapsed behavior or inaccessible control.
- **Definition of Done:** Sidebar/Header CSS states are visually consistent and the static frontend IPC surface baseline is unchanged.

### Phase 4 — Shared component consistency

- **Goal:** Standardize presentation of Button, Input, Card, Badge, Tabs, Dialog, Toast, Dropdown and Tooltip incrementally.
- **Files allowed:** `light-theme.css`, exact Settings/CAPTCHA/App Shell presentation regions and tests.
- **Files prohibited:** callback/IPC implementations and unrelated pages.
- **Exact changes:** Class/token normalization first; presentation extraction only where exact boundaries are recoverable.
- **Risk:** Global selector leakage.
- **Validation:** Settings/CAPTCHA/App Shell states, toast semantics, dialog focus/escape, no IPC diff.
- **Rollback condition:** behavior or focus regression.
- **Definition of Done:** First three surfaces share token-driven control states without a new dependency.

### Phase 5 — Page CSS cleanup

- **Goal:** Reduce cascade debt page-by-page: Settings → CAPTCHA → Dashboard → Image → Video → Voice → AI Agent → Library → Gencut → Concat.
- **Files allowed:** one page chunk/style group per sub-phase plus `light-theme.css` and its targeted test.
- **Files prohibited:** backend and unrelated page groups.
- **Exact changes:** Remove verified duplicate/overbroad declarations; replace hardcoded values with tokens; replace `transition: all`; reduce justified `!important` only when cascade is understood.
- **Risk:** visual regression in lazy states.
- **Validation:** targeted route/state screenshots and full validate after every page group.
- **Rollback condition:** untested state or route cannot be exercised.
- **Definition of Done:** Each completed page has a recorded before/after metric and green behavior checks; no global percentage KPI.

### Phase 6 — Accessibility and error feedback

- **Goal:** Improve semantics without mechanically changing all elements.
- **Files allowed:** exact verified interaction regions and accessibility tests.
- **Files prohibited:** action semantics and backend error shapes.
- **Exact changes:** Add `type="button"` where context proves non-submit; keyboard behavior for custom controls; focus-visible; aria-live; modal focus/escape; user-facing feedback for actionable swallowed errors.
- **Risk:** duplicate event firing or changed cancellation semantics.
- **Validation:** keyboard-only flows, focus restoration, screen-reader attributes and unchanged callback counts.
- **Rollback condition:** duplicate action, changed submit behavior or focus trap failure.
- **Definition of Done:** Audited interactions are keyboard-operable and async outcomes are announced without changing requests.

### Phase 7 — Storage and i18n cleanup

- **Goal:** Introduce thin safety helpers, not a state-management migration.
- **Files allowed:** new renderer helper only when import integration is safe, exact consumers, locale tests.
- **Files prohibited:** Redux/Zustand addition, backend persistence changes.
- **Exact changes:** Inventory keys, safe read/write/parse, version/fallback policy; consolidate vi/en UI copy opportunistically; preserve `document.lang`.
- **Risk:** changing fallback/stale-state semantics.
- **Validation:** key snapshot, malformed JSON cases, navigation/session persistence smoke.
- **Rollback condition:** existing stored data no longer loads identically.
- **Definition of Done:** Migrated keys preserve old values and hardcoded UI copy decreases without a locale rewrite.

### Phase 8 — Confirmed dead frontend

- **Goal:** Remove only runtime-proven unreachable frontend artifacts.
- **Files allowed:** exact confirmed route mappings, render branches, locale/CSS/chunks, tests and manifest.
- **Files prohibited:** all backend/IPC implementations.
- **Exact changes:** Remove one confirmed-dead feature family per sub-phase.
- **Risk:** hidden dynamic/runtime reachability.
- **Validation:** route graph, missing-target test, runtime navigation smoke, package inspection.
- **Rollback condition:** any `UNKNOWN`/`LIKELY_DEAD` dependency or runtime access remains.
- **Definition of Done:** Removal evidence is recorded and no active route/API behavior changes.

### Phase 9 — Asset garbage collection

- **Goal:** Remove runtime-proven unused assets as an isolated, reversible change.
- **Files allowed:** confirmed asset files and generated asset manifest.
- **Files prohibited:** Electron/user media and any unknown candidate.
- **Exact changes:** Cross-reference HTML/JS/CSS/Electron/dynamic paths, capture runtime access, delete only confirmed candidates.
- **Risk:** constructed paths and package-only references.
- **Validation:** build/package asset validation and route smoke.
- **Rollback condition:** runtime access cannot be observed or proven absent.
- **Definition of Done:** Every deleted file has explicit evidence and package still validates.

## 9. Global Definition of Done

- Exact base commit and baseline failures remain recorded.
- Direct static frontend IPC method-name usage is inventoried and its baseline guarded; Electron backend remains untouched.
- Lazy chunks and dynamic imports receive broader validation.
- App Shell dimensions and visual states use semantic tokens when safely implemented.
- Sidebar/Header improvements preserve route IDs, state flow, callbacks and provider/CAPTCHA gates.
- No `LIKELY_DEAD`, `UNKNOWN` code or asset is deleted.
- Accessibility improvements are interaction-aware and tested.
- `pnpm validate` is run after every implemented phase.
- Every failure is labeled `PRE-EXISTING FAILURE` or `REGRESSION INTRODUCED`.
- This document is updated with status, files, behavior preservation, tests, risks and deferred work after each phase.

## 10. Phase status log

### Phase 0

- **Status:** Completed
- **Files changed:** `FRONTEND_REFACTOR_PLAN.md`, `scripts/check-frontend-contract.mjs`, `docs/frontend-ipc-usage-manifest.json`, `package.json`
- **Why:** Pin verified source-of-truth evidence and add reproducible static IPC-surface/lazy-import guardrails before runtime edits
- **Behavior preserved:** No runtime source changed
- **Tests run:** `pnpm check:frontend-contract` PASS; post-phase `pnpm validate` reaches the same pre-existing light-theme assertion and introduces no earlier failure
- **Known risks:** Browser/Electron visual baseline not yet available; 15 distinct direct renderer method names across 16 static call sites are absent from preload and are frozen as baseline debt rather than altered. Breakdown: Community 3, Workflow App 8, Updater 3, Machine 1; `api.onUpdaterStatus` accounts for two call sites
- **Deferred:** Runtime reachability proof for the 15 mismatches and four `LIKELY_DEAD` missing lazy targets

### Phase 1

- **Status:** Completed
- **Files changed:** `scripts/check-recovered-desktop.mjs`, `scripts/test-light-theme-ui.cjs`, `apps/desktop/src/renderer/index.html`, `apps/desktop/src/renderer/light-theme.css`
- **Why:** Restore the main quality gate and remove confirmed startup dead work
- **Behavior preserved:** Renderer entry, route/state logic and IPC calls are unchanged; splash uses a root DOM mutation readiness heuristic, a two-frame visual settling heuristic and a 3-second time-based forced reveal fallback
- **Tests run:** Targeted renderer syntax/static IPC-surface/light-theme checks PASS; `pnpm validate` PASS including build
- **Known risks:** The startup heuristics do not confirm React readiness, stylesheet readiness, lazy-route completion or recovery from a renderer crash
- **Deferred:** Runtime startup trace and screenshot baseline

### Phase 2

- **Status:** Completed
- **Files changed:** `apps/desktop/src/renderer/light-theme.css`, `apps/desktop/src/renderer/index.html`, `scripts/test-light-theme-ui.cjs`
- **Why:** Establish semantic design tokens and shared Sidebar/Header/MainContent dimensions in the CSS compatibility layer
- **Behavior preserved:** No bundle, page ID, callback, navigation gate or IPC usage changed
- **Tests run:** Targeted UI/IPC checks PASS; `pnpm validate` PASS including build
- **Known risks:** Computed layout was not inspected in a live Electron window due unavailable visual automation
- **Deferred:** OverlayRoot markup and source-level React component extraction

### Phase 3

- **Status:** Completed within the safe CSS-only boundary
- **Files changed:** `apps/desktop/src/renderer/light-theme.css`, `scripts/test-light-theme-ui.cjs`
- **Why:** Replace noisy/transparent-only navigation states with calm token-driven hover/active/focus behavior and give Header a stable surface/border
- **Behavior preserved:** Static IPC surface manifest remains 215 distinct direct method names; route IDs, order, state flow, provider/CAPTCHA handlers and bundle JavaScript are unchanged
- **Tests run:** Targeted light-theme/static IPC-surface checks PASS; final `pnpm validate` PASS including build; `git diff --check` PASS
- **Measured result:** Renderer CSS `!important` 795 → 795, `transition: all` 203 → 203, gradients 398 → 398, hardcoded hex occurrences 5,516 → 5,512. Phase 3 did not claim page-level CSS reduction
- **Known risks:** No screenshot/collapse interaction capture; the visual result requires human smoke review
- **Deferred:** React `AppShell` component refactor, Sidebar information architecture, semantic Header markup, removal of Header `sidebar-*` class coupling, progressive disclosure, `OverlayRoot` extraction and shared React primitives

### Phase 3 Hardening

- **Status:** Documentation/static metadata corrections completed; Electron runtime smoke **BLOCKED BY ENVIRONMENT**
- **Files changed:** `apps/desktop/src/renderer/index.html`, `FRONTEND_REFACTOR_PLAN.md`, `scripts/check-frontend-contract.mjs`, `docs/frontend-ipc-usage-manifest.json`
- **Why:** Remove startup, IPC-guard and App Shell architecture overclaims; record exact missing-preload counts and conservative lazy-target reachability
- **Startup terminology:** Root DOM mutation readiness heuristic, two-frame visual settling heuristic and time-based forced reveal fallback; none is a confirmed React-ready or crash-recovery signal
- **IPC guard scope:** Direct static frontend method-name surface, missing-from-preload baseline and dynamic-import target baseline only; argument/payload/response/callback/backend semantics and indirect access are not covered
- **Counts:** 15 distinct missing-preload method names across 16 static call sites: Community 3, Workflow App 8, Updater 3, Machine 1; `api.onUpdaterStatus` has two call sites
- **Lazy targets:** `HomePage`, `ExplorePage`, `CommunityPage` and `WorkflowAppDetailPage` remain `LIKELY_DEAD`, not deleted; the generic `genyu:navigate-page` listener prevents `CONFIRMED_DEAD` classification
- **App Shell scope:** CSS compatibility-layer normalization only; no recovered React component/markup refactor
- **Runtime smoke:** **BLOCKED BY ENVIRONMENT**. Windows Computer Use could not connect to its native pipe; the installed Electron package lacks `dist/electron.exe`; existing `release` and `release-qa` executables predate this diff and are not valid evidence for the current source

### Phase 4

- **Status:** Deferred at the safety boundary
- **Files changed:** None
- **Why:** Installing Radix/Base UI/Sonner or extracting shared React components is not safely reviewable without maintainable React source, bundling/tree-shaking and visual interaction tooling
- **Behavior preserved:** Existing Button/Input/Dialog/Toast logic remains intact
- **Tests run:** Covered by the final Phase 3 validation
- **Known risks:** Existing shared component inconsistency remains outside App Shell/Settings/CAPTCHA compatibility styling
- **Deferred:** Re-evaluate only after a clean, isolated source component boundary and browser/Electron test harness exist

### Phase 4A â€” Runtime and visual smoke foundation

- **Status:** Harness and visual baseline completed; runtime quality gate currently fails on one confirmed missing renderer asset
- **Files allowed:** smoke/package scripts, root scripts/ignore rules, visual baseline artifacts and this plan
- **Files prohibited:** Electron source, renderer UI/route/IPC behavior, shared primitives and UI dependencies
- **Goal:** Package the current recovered runtime into an isolated unpacked Electron build, connect through local Chrome DevTools Protocol, verify startup/App Shell invariants and capture deterministic expanded/collapsed baselines
- **Smoke scope:** Root renders and splash hides; Settings App Shell renders at 1440 x 900; Sidebar expands/collapses/re-expands; Header offset tracks 236px/66px Sidebar widths; horizontal overflow and renderer console errors are reported
- **Safety:** Uses a temporary isolated Electron profile and the existing `genyu:navigate-page` event; no authentication, CAPTCHA, paid provider or generation action
- **Visual artifacts:** `tests/visual-baselines/app-shell-expanded.png` and `tests/visual-baselines/app-shell-collapsed.png`
- **Observed runtime PASS:** Root rendered; splash hidden; Sidebar 236px/66px expanded/collapsed; Header x-offset followed 236px/66px; re-expand restored layout; no horizontal overflow; two consecutive verification runs matched both visual baselines with 0/1,296,000 differing pixels
- **Observed runtime FAILURE:** `dist/assets/useHomeContent-CIQWzjFN.js` returned `net::ERR_FILE_NOT_FOUND`; the smoke remains red on `noRuntimeErrors` and does not whitelist this finding
- **Validation:** `pnpm package:electron-smoke`, `pnpm smoke:electron-ui:update`, `pnpm smoke:electron-ui`, `pnpm validate`, `git diff --check`, backend diff empty
- **Files changed:** `.gitignore`, `package.json`, `scripts/package-electron-smoke.mjs`, `scripts/smoke-electron-ui.mjs`, `scripts/smoke-electron-ui-cdp.mjs`, `tests/visual-baselines/*`, `FRONTEND_REFACTOR_PLAN.md`
- **Results:** Isolated unpacked package PASS; startup/App Shell/visual assertions PASS; full runtime smoke FAIL only on the confirmed missing asset (reported twice for one request through CDP network and log events); `pnpm validate` PASS; static frontend IPC surface guard PASS; `git diff --check` PASS; Electron backend diff empty
- **Deferred:** Do not begin shared UI primitives until the missing runtime asset is resolved in a separately scoped frontend task and this smoke returns fully green

### Phase 4A.1 — Missing renderer asset root cause and runtime gate recovery

- **Status:** Completed; Electron runtime and visual smoke gate restored to PASS
- **Root cause classification:** `LEGACY_UNREACHABLE_REFERENCE`. The active `ProviderHubPage` lazy preload list retained dependency index `13` (`useHomeContent-CIQWzjFN.js`), although `ProviderHubPage-D4vFdETf.js` does not import that module and renders without it
- **Evidence:** The pre-fix CDP report recorded one failed Script request at 495ms after launch, with two events sharing the same request ID; the root already contained one child and the splash was hidden while the Provider Hub component had not mounted, consistent with a modulepreload request. Repository search found the filename only in `index-JlIFz2Wa.js`; source, desktop dist and package stage all lacked the asset; Git object/history search found neither this filename nor an alternate `useHomeContent-<hash>.js`
- **Build/package finding:** `build-recovered-desktop.mjs` and `prepare-recovered-desktop-package.mjs` copy the renderer payload recursively. Matching source/dist/stage index hashes and identical asset absence rule out `BUILD_COPY_OMISSION`
- **Fix:** Removed only dependency index `13` from the `ProviderHubPage-D4vFdETf.js` preload array. The legacy Home preload map, Home/Explore/Community routes, lazy chunks and asset set were not deleted or renamed; no placeholder module was created
- **Files changed:** `apps/desktop/src/renderer/assets/index-JlIFz2Wa.js`, `scripts/smoke-electron-ui-cdp.mjs`, `FRONTEND_REFACTOR_PLAN.md`
- **Runtime result:** `pnpm package:electron-smoke` PASS; `pnpm smoke:electron-ui` PASS with zero renderer exceptions, console errors and network failures; root/splash/collapse/offset/overflow assertions PASS
- **Visual result:** Existing expanded and collapsed baselines both matched exactly at 0/1,296,000 differing pixels; baselines were not updated
- **Validation:** `pnpm validate` PASS; `pnpm check:frontend-contract` PASS; `git diff --check` PASS; Electron backend diff empty
- **Remaining risk:** Four conservatively classified missing lazy import targets remain baseline debt and were not changed. The static IPC guard continues to report 15 distinct missing-preload method names across 16 call sites; this task does not alter or resolve that separate contract debt

### Phase 4B — Shared visual primitives foundation

- **Status:** Completed within the recovered-renderer CSS boundary; Settings is the only page-specific pilot
- **Inventory:** The renderer already exposes `brand-button` variants (primary, secondary, ghost, danger and icon-only), `brand-icon-button`, `brand-input`/textarea, `brand-surface`, `brand-badge`, `brand-tabs` and `BrandButton-BUkBwN3T.js`. Page bundles still contain many parallel families for buttons, fields, cards, badges, switches, tooltips, dialogs and toasts. Settings used `brand-tabs`, but its remaining native buttons, inputs, folder surface and typography were controlled by page selectors plus a broad compatibility override
- **Selected contract:** Keep the existing `brand-*` primitives as the shared control contract; complete the semantic token set with `--primary-hover`, `--control-disabled-opacity` and `--shadow-sm`; add reusable typography roles for section title, control label, body and helper text. No recovered JavaScript bundle was rewritten solely to add classes
- **Library decision:** Adopted no dependency. Lucide remains the icon system. shadcn/ui is reference-only. Radix UI and Base UI are mutually exclusive future candidates for accessible overlay primitives; Sonner is deferred until the current toast behavior has a clean source boundary. `cmdk`, `react-resizable-panels` and TanStack Table remain deferred to feature-specific phases. The recovered output, existing working controls and lack of an immediate semantic gap do not justify bundle/dependency risk in Phase 4B
- **Settings application:** Replaced the subtree-wide typography rule with explicit page-title/section/control/body/helper selectors. Settings tabs, folder surface, native buttons and advanced inputs now consume semantic tokens and targeted focus/disabled states through the light-theme compatibility layer. Existing `type="button"` markup, callbacks, storage access and IPC calls were not changed
- **Cascade constraint:** Settings page CSS is loaded lazily after `light-theme.css`. Compatibility declarations that must preserve the light surface therefore retain narrowly scoped `!important`; removing them caused a reproduced dark-surface visual regression and was reverted. Shared primitive definitions themselves were not globally restyled, avoiding an unreviewed CAPTCHA or other consumer change
- **Files changed:** `apps/desktop/src/renderer/light-theme.css`, `scripts/test-light-theme-ui.cjs`, `FRONTEND_REFACTOR_PLAN.md`
- **Quality gate:** The stale Settings assertions that required exact hardcoded colors, broad selectors and `!important` were replaced by invariants for semantic tokens, existing shared primitive availability, explicit typography roles, visible focus, disabled state and the absence of the broad Settings typography selector
- **CSS metrics:** Across 12 renderer CSS files, `!important` 795 → 793, `transition: all` 203 → 203 and hardcoded hex occurrences 5,512 → 5,507. The Settings lazy CSS chunk itself remains unchanged (`!important` 1, `transition: all` 0, hardcoded hex 27); the measured improvement is limited to the compatibility layer. Selector-duplication counts were not reported because the recovered/minified mix makes a raw selector count misleading
- **Runtime/visual result:** Initial smoke correctly failed after non-important light overrides lost to lazy Settings CSS. After restoring narrowly scoped cascade compatibility, root/splash, expanded/collapsed/re-expanded Sidebar, Header/Main offsets, overflow and error/network assertions passed. Existing expanded and collapsed App Shell baselines each matched at 0/1,296,000 differing pixels; baselines were not updated
- **Settings baseline:** No separate baseline was added because the existing App Shell captures the Settings output-folder state and remained an exact match. Advanced-tab visual states are not covered by the current harness and remain a targeted follow-up risk
- **Behavior preserved:** No renderer JavaScript, route/page ID, callback, localStorage behavior, `window.api.*`, preload, Electron source, CAPTCHA or generation flow changed
- **Validation:** Targeted light-theme UI contract PASS; `pnpm validate` PASS; `pnpm check:frontend-contract` PASS with its unchanged baseline debt; `pnpm package:electron-smoke` PASS; `pnpm smoke:electron-ui` PASS; `git diff --check` PASS; Electron backend diff empty
- **Remaining risk/deferred:** Advanced Settings input/focus/disabled visuals are protected statically but not screenshot-tested. Select is absent from Settings. Dialog, modal, tooltip, toast, checkbox/switch and page-specific primitive migrations remain deferred; CAPTCHA is the next isolated consumer phase

### Phase 4C — CAPTCHA shared visual contract

- **Status:** Completed as an isolated CAPTCHA presentation/runtime phase on top of the Phase 4B checkpoint
- **Baseline:** `develop` at `71cc1c71905937649b93afdb5743cd4c0b79790f`; pre-change App Shell smoke PASS and Electron backend diff empty. The working tree already contained the three Phase 4B files and they were preserved
- **Inventory:** `CaptchaSetupPage-DbTYSglx.js` renders four semantic accordion steps, native `type="button"` summaries with `aria-expanded`/`aria-controls`, shared `BrandButton`, a refresh button and status/progress surfaces. Direct page actions remain `openExtensionFolder`, `copyToClipboard` and `openExternalUrl`; `captchaSetup.refresh/verify` stay parent-provided. The renderer bundle was not edited
- **Confirmed visual debt:** Lazy `management-atelier-CiGbOadK.css` changed the wizard to a two-column grid. Runtime evidence showed four 474.5px cards and one overflowing action group; the first expanded card visibly clipped its secondary action. CAPTCHA compatibility CSS also retained small 11–12px content text and hardcoded green/dark step-number colors
- **Implementation:** Force the CAPTCHA wizard back to a single-column flex accordion, preserve four cards and callback semantics, map progress/cards/current/done/panel/refresh states to shared surface, primary, success, radius, spacing, shadow and focus tokens, and establish 16/600 step titles with 14/500 supporting text. Action groups now fit without horizontal clipping
- **Accessibility:** Existing semantic buttons and accordion ARIA attributes were preserved. Step-summary and refresh focus rings use `--focus-ring`; done/current state keeps icon/number plus semantic color rather than color-only meaning; reduced-motion behavior and clockwise refresh animation remain guarded
- **Runtime gate:** The Electron smoke harness now accepts a bounded `--page=settings|captcha-setup` target. CAPTCHA capture records page visibility, four-step count, computed wizard layout and action overflow; the gate requires a visible four-step single-column flex layout with zero overflowing action groups. Startup waits were increased from 10s+1s to 15s+5s after a reproduced App Shell mount timeout; assertions were not removed or bypassed
- **Visual baselines:** Added `captcha-setup-expanded.png` and `captcha-setup-collapsed.png`. The pre-change two-column state was captured first. The baseline was updated only after manual review confirmed the intentional one-column layout and the existing App Shell/Settings baseline still matched. Final CAPTCHA compare matched both images at 0/1,296,000 differing pixels
- **Files changed:** `apps/desktop/src/renderer/light-theme.css`, `scripts/test-light-theme-ui.cjs`, `scripts/smoke-electron-ui-cdp.mjs`, `package.json`, `tests/visual-baselines/captcha-setup-expanded.png`, `tests/visual-baselines/captcha-setup-collapsed.png`, `FRONTEND_REFACTOR_PLAN.md`
- **CSS metrics:** CAPTCHA compatibility block: `!important` 191 → 196, `transition: all` 0 → 0, hardcoded hex 7 → 2. Across all 12 renderer CSS files relative to Phase 4B: `!important` 793 → 798, `transition: all` 203 → 203, hardcoded hex 5,507 → 5,502. The five additional priorities are the documented compatibility cost of overriding later-loaded management layout; no global regex cleanup was used
- **Behavior preserved:** No renderer JavaScript, page ID, extension detection, verification, refresh callback, clipboard/folder/external URL action, CAPTCHA IPC, provider flow or Electron source changed
- **Validation:** Targeted UI contract PASS; `pnpm validate` PASS; `pnpm check:frontend-contract` PASS with unchanged baseline debt; `pnpm package:electron-smoke` PASS; `pnpm smoke:electron-ui` PASS; `pnpm smoke:electron-ui:captcha` PASS; `git diff --check` PASS; Electron backend diff empty
- **Remaining risk/deferred:** The smoke covers the deterministic disconnected/setup-required state without clicking folder, clipboard, external URL or verification actions. Connected/outdated-extension/token-error states require controlled fixtures or a safe state injector before visual baselines can be added; no live Google account or provider action was used

### Phase 4D — Sidebar/Header semantic and information architecture recovery

- **Status:** Completed within a targeted recovered-renderer boundary
- **Baseline:** `develop` at `71cc1c71905937649b93afdb5743cd4c0b79790f`; pre-change Settings and CAPTCHA Electron smoke both PASS, and Electron backend diff was empty
- **Confirmed inventory:** The Sidebar already used `<aside>` and `<nav>`, but exposed 11 VEO3 navigation entries as one flat list. The fixed Header was a generic `<section>` and its presentation contract used only `sidebar-*` class names. Navigation buttons lacked an explicit non-submit type and did not expose current/locked state through ARIA
- **Information architecture:** The existing destinations are now presented in four localized groups: Create (`image-ultra` generate, `video-pro`, `voice`), Edit (`image-ultra` edit, `capcut-video`, `concat`), Assets (`upload`) and System (`provider-account`, conditional VEO3 `webview`/`captcha-setup`, `settings`). Image Editor moves ahead of Quick Cut and Scene Merge inside Edit; no page ID, selection callback, provider condition or route mapping changed
- **Semantic recovery:** The fixed status/account region now renders as `<header class="app-header atelier-header-profile">`; Sidebar, navigation and Header receive localized accessible labels; each visual navigation group is a labelled `role="group"`; navigation buttons use `type="button"`, `data-page`, `aria-current` and `aria-disabled`. Header-owned elements receive `header-*` aliases
- **Compatibility constraint:** Legacy `atelier-header-profile` and nested `sidebar-*` Header classes remain on the recovered markup because compiled base CSS still consumes them. The light compatibility layer now keys its Header layout from `.app-header`; this is semantic namespace recovery, not full deletion of recovered class coupling
- **Visual treatment:** Expanded Sidebar shows calm uppercase group labels. Collapsed mode hides duplicate visual labels while preserving group ARIA labels and uses subtle group separators. A reproduced collapsed-nav horizontal scrollbar was fixed with local `overflow-x: hidden` and added to the runtime contract
- **Runtime guard:** The Electron smoke now records Header/Aside/Nav tag names and labels, four group IDs, per-group item counts, exact VEO3 page order, one current page, semantic Header aliases and collapsed/expanded nav overflow behavior. It also normalizes a reproduced harness race where React could read the default collapsed state before the smoke wrote localStorage; the harness now requests expansion once through the real collapse button after mount instead of weakening the wait. The pre-existing dimension, offset, collapse/re-expand, target-page, console/network and visual assertions remain active
- **Visual baselines:** Settings and CAPTCHA expanded/collapsed baselines were refreshed only after manual inspection confirmed that the intentional diff was confined to Sidebar grouping/order and that Header/page layout remained stable. Final compare reported MATCH for all four images: Settings expanded/collapsed differed by 0 pixels, CAPTCHA collapsed differed by 0 pixels and CAPTCHA expanded differed by 5 of 1,296,000 pixels within the existing tolerance
- **Files changed:** `apps/desktop/src/renderer/assets/index-JlIFz2Wa.js`, `apps/desktop/src/renderer/light-theme.css`, `scripts/test-light-theme-ui.cjs`, `scripts/smoke-electron-ui-cdp.mjs`, the four Settings/CAPTCHA visual baselines and `FRONTEND_REFACTOR_PLAN.md`
- **CSS metrics:** Across 12 renderer CSS files, `!important` 798 → 798, `transition: all` 203 → 203 and hardcoded hex occurrences 5,502 → 5,502. Phase 4D adds no hardcoded color and does not claim page-level CSS cleanup
- **Behavior preserved:** Static frontend IPC surface remains 215 direct method names; window API usage, preload, Electron Main, provider/CAPTCHA handlers, generation flows, collapsed-state storage and navigation callbacks are unchanged
- **Validation:** Targeted recovered-renderer syntax/UI contract PASS; `pnpm validate` PASS; `pnpm check:frontend-contract` PASS with unchanged baseline debt; `pnpm package:electron-smoke` PASS; Settings and CAPTCHA Electron runtime/visual smoke PASS; `git diff --check` PASS; Electron backend diff empty
- **Remaining risk/deferred:** Runtime smoke covers the deterministic VEO3 System group (four entries), Settings and CAPTCHA routes. The Avis System variant (two entries), keyboard activation of every destination and actual provider/account menu actions are not exercised. Full removal of legacy Header class aliases requires a separate, source-recovery-safe CSS phase

### Historical Phases 5-9 — retired as the primary roadmap

- **Status:** Retired/deferred as standalone cleanup phases; retained here as historical context
- **Files changed:** None
- **Why:** Page CSS, accessibility, storage/i18n, dead-code and asset cleanup are now cross-cutting work performed only inside a verified source-migration slice. Recovered output is no longer the target codebase
- **Behavior preserved:** No page bundle, localStorage schema, locale dictionary, candidate route, chunk or asset was changed/deleted
- **Tests run:** Not applicable beyond the final full validation
- **Known risks:** The audited debt remains documented in Sections 4 and 7 and in the IPC manifest
- **Deferred:** Cleanup follows each active page into maintainable source; legacy asset GC remains after runtime cutover

## 11. Frontend Source Recovery Roadmap

Phase 0–4 completed stabilization, contract protection and runtime/visual gates. From Phase 5 onward, the primary goal is to reconstruct a maintainable React/TypeScript frontend source codebase. The recovered renderer is the behavior reference, visual reference and temporary compatibility runtime; it is not the destination architecture.

The migration follows a strangler sequence:

```text
Recovered renderer oracle
  -> parallel source frontend
  -> one verified vertical slice at a time
  -> runtime parity
  -> source runtime cutover
  -> recovered runtime removal
```

The default effort split is approximately 80% source reconstruction and 20% legacy stabilization required to keep the migration gates green. The old Phase 5–9 cleanup roadmap is retired as the primary plan; its valid work moves into the source slice that owns the relevant page or component.

### Source-recovery baseline

| Item | Verified state |
| --- | --- |
| Branch | `develop` |
| Source recovery base | `SOURCE_RECOVERY_BASE_COMMIT=20d144c28465f3870fa22d1bd7d5fea4c2fc1fc0` |
| Working tree before Phase 5 | Clean |
| `pnpm validate` | PASS |
| `pnpm check:frontend-contract` | PASS; unchanged baseline debt: 15 distinct missing-preload methods across 16 call sites |
| `pnpm package:electron-smoke` | PASS |
| `pnpm smoke:electron-ui` | PASS |
| `pnpm smoke:electron-ui:captcha` | PASS |
| Electron backend diff | Empty |

The production renderer remains `apps/desktop/src/renderer`, copied by `scripts/build-recovered-desktop.mjs` to `apps/desktop/dist`. Electron continues to load `dist/index.html`. No maintainable React/TypeScript renderer source, TypeScript config or Vite config existed at this baseline.

### Phase 5 — Frontend source architecture bootstrap

- **Goal:** Establish a real React/TypeScript/Vite source tree, typed route/page inventory, shared token source and thin frontend-only Electron API boundary without changing the production renderer entry.
- **Files allowed:** `apps/desktop/src/renderer-source/**`, its isolated generated output ignore rule, frontend-only validation scripts, package manifests/lockfile and this plan.
- **Files prohibited:** `apps/desktop/src/electron/**`, `apps/desktop/src/renderer/**`, preload/IPC contracts, recovered routes/chunks/assets and visual baselines.
- **Exact changes:** Add a parallel Vite build and strict TypeScript config; bootstrap `app`, `components/ui`, `pages`, `services/electron-api`, `styles` and `types`; carry the verified recovered allowed-page inventory as compatibility data; add provider/CAPTCHA adapters that forward exact existing calls; extend validation to typecheck/build and statically guard source IPC usage and runtime isolation.
- **Runtime coexistence:** Source output is generated to a non-production directory. Neither Electron Main nor `build-recovered-desktop.mjs` loads or packages it in Phase 5.
- **Type strategy:** Use evidence from preload and current callers. Unknown response shapes remain `unknown`; no speculative response schema or argument normalization.
- **Risk:** Toolchain drift, accidental import from recovered bundles, accidental source cutover or an adapter method not exposed by preload.
- **Validation:** Source typecheck, source architecture/IPC guard, source production build, all recovered validation and Electron Settings/CAPTCHA smoke gates, backend diff and `git diff --check`.
- **Rollback condition:** Any production entry/path changes, source call absent from preload, recovered smoke/visual regression, backend diff or inability to remove source output without affecting recovered runtime.
- **Definition of Done:** Source app builds from readable React/TypeScript, direct Electron calls are confined to the adapter boundary, source output is isolated, all existing gates remain green and Electron still runs the recovered renderer.

### Phase 6 — App Shell source recovery

Migrate AppShell, Sidebar, Header, MainContent and navigation configuration into source. Preserve the verified page IDs, provider/CAPTCHA gates, callback semantics, collapsed storage key and route behavior. Compare expanded/collapsed layout, offsets, groups, active/disabled states, overflow and accessibility against the existing runtime/visual oracle before any cutover.

- **Status:** `RUNTIME_VERIFIED`; remains parallel and is not the production cutover
- **Source:** `app/AppShell.tsx`, typed `app/navigation.ts`, semantic `components/Sidebar` and `components/Header`, `hooks/useAppRuntime.ts`, locale/storage helpers and provider-hub bridge
- **Behavior preserved:** Exact 16-page inventory, provider-specific navigation filtering, AVIS route normalization, provider/CAPTCHA gates, `genyu:navigate-page`, `genyu-navigation-v1` and `narra-atelier-dock-collapsed`
- **Runtime gate:** Added an isolated Electron package that keeps the current Main/preload and replaces only the temporary staged renderer with the Vite source output. It does not change production packaging or Electron source
- **Visual evidence:** Dedicated reviewed source baselines cover expanded 236px and collapsed 66px states. Header/Main offsets, navigation order, active item, semantic landmarks and horizontal overflow are runtime assertions
- **Validation:** Source typecheck/build/guard PASS; source Electron smoke PASS twice with baseline MATCH and no runtime/network/console error; recovered Settings and CAPTCHA smokes remain PASS; `pnpm validate`, frontend contract guard and `git diff --check` PASS; backend diff empty
- **Known risk:** Active feature bodies remain migration placeholders. Provider response shape validation is deliberately conservative and the source shell has not cut over
- **Deferred:** Phase 7 migrates Settings and CAPTCHA as independent source slices with their own runtime targets and baselines

### Phase 7 — Settings and CAPTCHA source recovery

Migrate Settings and CAPTCHA as separate checkpointable slices. Each slice owns its clean CSS, accessibility, storage/i18n/error-handling cleanup and exact IPC adapter calls. Existing Settings and CAPTCHA runtime/visual smoke remain required.

- **Status:** Settings and CAPTCHA are `RUNTIME_VERIFIED` in the parallel source runtime; not cut over
- **Settings:** Migrated output-folder loading/change/open operations and exact manual-auth payload through `services/electron-api/settings.ts`. VEO3-only advanced controls, semantic tabs, labels, error/status feedback and CAPTCHA bridge check are source-owned
- **CAPTCHA:** Migrated the four-step setup state, refresh/verify, Extension folder, clipboard and external Flow actions through the existing preload surface. Step titles/actions preserve the approved Vietnamese UI contract and clockwise refresh state
- **Visual evidence:** Dedicated Settings and CAPTCHA expanded/collapsed baselines were reviewed and MATCH. App Shell baseline remains independently MATCH because it targets an unmigrated provider-account placeholder
- **Validation:** `pnpm validate` and both source guards PASS; source App Shell/Settings/CAPTCHA Electron smokes PASS with no runtime/network/console errors; recovered CAPTCHA PASS and recovered Settings PASS twice after one isolated harness timeout; `git diff --check` PASS; backend diff empty
- **Known risks:** The advanced Settings CAPTCHA check protects the active Extension bridge path but cannot use the recovered hidden-webview fallback until Google Flow itself is migrated. Folder picker/open and external URL actions are not clicked by smoke because they cause OS side effects
- **Deferred:** Provider account and Google Flow must migrate before cutover even though the original high-level phase list did not name them separately

### Phase 8 — Core generation source recovery

Migrate one active feature per sub-phase: Phase 8A Image, Phase 8B Voice, Phase 8C Video. Inventory state, polling, provider behavior, upload/download and IPC semantics before moving each boundary. No multi-feature rewrite.

- **Status:** Image, Voice and Video are `CUT_OVER` in the production source runtime
- **Recovered behavior:** Image supports dynamic Avis models, VEO/Avis reference upload, generation, upscale and local save; Voice preserves Flow preview and desktop save-dialog semantics; Video preserves VEO text/start/start+end, Character Sync and edit-video generation, polling/download and Avis create/poll behavior. The source Video page now owns a sequential 20-item queue with pause-between-jobs, retry, result cleanup and versioned success/error history
- **Runtime evidence:** Dedicated expanded/collapsed baselines and non-credit-consuming interaction checks PASS for all three routes with no renderer/network/console errors
- **Recovered edit path:** Image annotation now flattens the local canvas and preserves the exact user-triggered VEO3 chain `uploadImage({imageBytes,...})` → `editImage({prompt,captchaToken,baseMediaId})`. Runtime smoke verifies canvas/flatten controls without uploading user data or invoking the provider
- **Remaining risk:** Video in-progress provider calls cannot be cancelled/resumed after restart and persisted history intentionally excludes unserializable `File` inputs. Provider-paid success paths remain intentionally outside automated smoke

### Phase 9 — Editing and media source recovery

Migrate the actual active page IDs corresponding to Image Editor, Quick Cut, Scene Merge and Media Vault. Display names do not replace route IDs as the source of truth.

- **Status:** Image Editor, Media Vault, Scene Merge, Video Editor and CapCut Editor are `CUT_OVER` to source. Native file dialogs and real media export remain manual-risk boundaries rather than recovered-runtime dependencies
- **Route correction:** `capcut-video` is no longer incorrectly mapped to the Quick Cut page. It now owns a source project picker/editor with exact project list/get/save/delete/duplicate calls, media import, ordered timeline, local persistence and FFmpeg export. Selected clips persist source trim, speed, brightness, contrast, saturation, audio fades, text overlay, emoji/image/GIF sticker, recovered transition metadata and the verified basic effect preset schema. Version-1 user transition/effect presets are loaded, validated, imported/exported and merged through the existing local preset IPC. Export preprocesses through the existing `applyVideoFilters` contract and uses `concatVideosWithTransitions` when applicable. `video-editor` remains the lightweight trim route
- **Runtime evidence:** All editing/media routes render inside the source App Shell, preserve 236px/66px shell geometry, have reviewed baselines and pass strict runtime smoke. The editor smoke persists a two-clip project, Dissolve transition, text overlay, audio fade, emoji sticker and Soft Focus effect through the real project store without opening OS dialogs or exporting media. It also seeds user presets and proves project/state/clip/caption fields unknown to the source UI survive an open/save round trip. Scene Merge smoke hydrates and deletes the recovered-compatible `concat-history` schema through real history IPC
- **Verified boundary correction:** The recovered export builds its work list only from visible `trackType === "video"` clips. Audio tracks are played by hidden preview `<audio>` elements but are not mapped into `applyVideoFilters`; recovered `muteAudio` is also ignored because that handler does not destructure it. Multitrack audio export is therefore confirmed legacy preview-only behavior, not a source cutover parity claim. Captions/Effects/Filters/Templates/AI Avatar top-level tabs are disabled as coming-soon in the recovered runtime. The backend does support local `image`/`gif` sticker paths; the source adapter and inspector now preserve and select those exact formats without external upload
- **Runtime hardening:** Timeline clip ordering supports both keyboard move controls and HTML drag/drop; smoke performs an A↔B reorder round trip. The source owns variable-speed keyframes, transform, crop, blend/opacity, clip-volume and multi-track/layer timing. Timeline-to-source mapping now integrates variable-speed curves before flattening overlapping visible layers. Deflicker, local audio extraction, Ollama suggestion, local Piper TTS, Sync.so lip sync, project rename and show-result-in-folder use the exact existing frontend IPC surface. Production smoke proves project/state/clip/track/deflicker/lip-sync and unknown-field round trips without invoking AI, provider or native-dialog actions
- **Video Editor recovery:** `video-editor` no longer renders the trim-only Quick Cut implementation. Its source boundary now owns the recovered project list/save/load/delete contract, trim/speed/rotate/flip, subtitle and BGM references, watermark regions, audio fades, multi-clip transition metadata, merge/export/output-folder boundaries and lossless unknown project fields. A dedicated production Electron smoke exercises project persistence, trim and transition edits, all four inspector panels and legacy-field preservation without invoking AI, export or native dialogs; reviewed expanded/collapsed baselines MATCH

### Phase 10 — AI Agent source recovery

Migrate AI Agent near the end and split it by verified vertical boundaries rather than one rewrite. Do not introduce state or panel libraries without measured need.

- **Status:** Source Chat, Workflow, Director, Media Tools, Skills and Workspace panels are on the production runtime, but overall AI Agent parity remains `IN_PROGRESS`; provider-paid KYC/reference orchestration and remaining legacy preview helpers still require explicit classification
- **Recovered behavior:** Typed source adapters preserve non-stream/stream chat and local versioned chat persistence. Workflow exposes intent/deep-analysis/plan/polish boundaries; Director owns local story scene/capture persistence; Skills imports and reads folders; Media Tools owns crop/depth/demux/stem boundaries plus local audio metadata/trim. Workspace lists/creates/renames/deletes workspaces and canvases, synchronizes snapshots, manages local assets, exposes revision restore, persists Episode status/order, brings assets onto Canvas with clone records, and persists Workspace Toolboxes through the existing local handlers. Manual Image/Video/Note/Audio nodes use the recovered `runItems` snapshot shape and source generation adapters behind the existing local node lock/complete/release surface. Workspace JSON/folder backup import/export now wraps the exact existing `workspace-*` IPC surface, recreates local workspaces/Episodes/assets, remaps canvas ownership and embeds verified backup media. Canvas nodes persist recovered-compatible `dependsOnSceneId` plus local group metadata, and execution refuses a dependent node until its upstream node is done
- **Runtime evidence:** Dedicated expanded/collapsed baseline and production Electron smoke PASS without invoking the provider. A temporary profile verifies three conversations, JSON package import with workflow/group preservation, all six tabs, workspace/Episode CRUD, revision restore and lossless unknown `runItems` fields
- **Recovered orchestration:** Multi-conversation management/package import/export, explicit-credit workflow rendering and dependency-aware batch group execution are source-owned. Workspace package OS-dialog flows and provider-paid execution remain manual verification risks and are intentionally not invoked by smoke
- **Continuation slices:** Image Editor now exposes the recovered VEO `transformImage` crop contract with media/workflow response normalization and local save. Avis Image generation has a user-triggered cancel action backed by the existing `requestId`/AbortController contract. Cloud Media items have explicit user-triggered image/video download actions. AI Agent smoke verifies Toolbox save/insert dependency remapping and Workspace Asset-to-Canvas clone persistence; audio nodes render with `<audio>` and Note `textOutput` is visible
- **Safety boundary:** Automatic Avis KYC asset creation/upload remains deferred. The recovered path uploads generated/local media to Cloudflare/Avis and polls provider KYC state; it requires an explicit external-side-effect approval before source integration. No placeholder KYC module or silent network-error bypass was added

### Phase 11 — Runtime cutover

Cut Electron from recovered `dist/index.html` to the source-built renderer only after active-page parity, source typecheck/build/tests, all relevant runtime/visual smoke, local-asset checks, IPC surface checks and backend diff gates pass. Recovered files remain available for rollback in the cutover checkpoint.

- **Current status:** Production loader is `CUT_OVER` to source, but the final behavior-parity audit is `IN_PROGRESS`; route/render smoke alone is not accepted as proof that every active page capability has migrated
- **Implementation:** `apps/desktop` production build now runs `scripts/build-source-desktop.mjs`; Vite emits `apps/desktop/dist/index.html` from `renderer-source` while the Electron Main/preload/config inputs remain unchanged
- **Evidence:** The production `.runtime-smoke-build` passed all 15 route smokes, expanded/collapsed App Shell assertions, visual baselines, local persistence checks and zero renderer/network/console-error gates

### Phase 12 — Recovered runtime removal

Only after stable source cutover, remove recovered bundles, compatibility CSS, proven-dead mappings/chunks/locales/assets and copy-only build machinery. Asset GC remains isolated and reversible. `HomePage`, `ExplorePage`, `CommunityPage` and `WorkflowAppDetailPage` stay `LIKELY_DEAD` until runtime reachability is proven; they are not migrated or deleted merely because their targets are missing.

- **Status:** Recovered runtime files are removed from the working tree and no longer on the critical runtime path; Phase 12 completion remains `IN_PROGRESS` until the active-capability parity audit and replacement behavior gates are complete
- **Reachability proof:** Production navigation accepts only the typed 17-page `sourcePageIds` set; the generic `genyu:navigate-page` listener ignores unknown IDs. The four missing recovered lazy pages therefore have no producer, route entry, component mapping or runtime target after cutover
- **Removed:** `apps/desktop/src/renderer`, copy-only recovered build/package/smoke/check scripts, compatibility `light-theme.css`, recovered-only visual baselines and five unreachable source-bootstrap placeholders
- **Replacement gates:** Source IPC manifest/checker, source UI contract, source-built renderer syntax validation and production 15-route Electron visual/runtime suite
- **Completion checkpoint:** Branch `develop`, `SOURCE_RECOVERY_FINAL_BASE=cbaa2d9c8f54770bd942da99dec67482f658c57b`; no commit or push performed
- **Latest validation:** Source formatting, TypeScript, source IPC contract, source frontend guard, UI contract, local workspace IPC, CAPTCHA extension, package staging and Windows resolver checks PASS. `pnpm check:frontend-contract` also PASS when run with `--config.confirmModulesPurge=false`; pnpm still prunes the root dev graph as an environment-side effect, so the frozen dev graph was restored immediately afterward. Source Vite build, desktop package preparation and Electron smoke packaging PASS after hardening both source build scripts to use Vite's `--configLoader runner` (avoids the environment's unwritable `.vite-temp` config cache). The rebuilt executable passed the complete 15-route production suite: every route reported PASS, expanded/collapsed baselines MATCH, shell geometry/semantic assertions PASS, no renderer exceptions, console errors, failed requests or horizontal overflow. The canonical `pnpm validate` command remains unsuitable in this environment because its dependency status check attempts the same production prune before validation; equivalent validation stages were run directly after restoring the frozen dev dependency graph.
- **Packaged renderer:** `dist/index.html`, one source-built CSS chunk, one source-built JS chunk and `brand/narra-mark.svg`; no recovered chunk, lazy target or compatibility stylesheet remains on the critical path
- **Known manual risks:** Provider-paid success paths, Google Flow image upload/edit response, native OS folder/file dialogs and media export with real user files were not invoked by automated smoke
- **Final continuation note:** `scripts/build-source-desktop.mjs` and `scripts/build-source-renderer.mjs` now invoke Vite with `--configLoader runner`; this is a build reproducibility fix only and does not alter renderer behavior. Automatic Avis KYC/reference upload remains explicitly deferred because it uploads user/generated media to external providers and requires separate user authorization; it is the remaining capability-level blocker before claiming absolute active-feature parity.
- **Backend verification note:** The Git executable is unavailable in this environment, so native `git diff` output cannot be produced. As a read-only fallback, the current index entries were compared with the `cbaa2d9c` HEAD tree for all 54 tracked `apps/desktop/src/electron/**` files; the available HEAD/index blob IDs match, and every worktree file matches its indexed blob after CRLF→LF normalization. This proves no backend semantic/content change; the raw worktree difference is line-ending representation only.

#### Active capability audit (completion gate)

| Capability group | Current classification | Evidence | Source-recovery action |
| --- | --- | --- | --- |
| KYC/reference upload (`avisGetKycStatus`, `avisCreateKycAsset`, `avisGetKycAsset`, `avisUploadVideoReference`, `cloudflareR2UploadMedia`) | **DEFERRED — AUTHORIZATION REQUIRED** | No source route or adapter currently invokes these methods; the historical recovered flow would upload local/generated media to external Avis/Cloudflare endpoints and poll provider state | Do not add an automatic upload path without explicit user authorization and a reviewed privacy/side-effect contract |
| Image/audio preview helpers (`avisPollImage`, `extractThumbnail`, `imageThumbnail`, `imageGridSegment`, `readLocalAudioFile`, `selectAudioUploadFile`) | **LIKELY_LEGACY / NOT ACTIVE** | No source page, adapter or route references these methods; current source uses direct media URLs, canvas preview and `selectAudioFile`/`getAudioInfo` for the active Audio tools flow | Keep preload methods for compatibility; do not migrate unreferenced helpers into source merely to inflate IPC parity |
| Workspace collaboration/audit stubs (`teamWorkspaceAccept`, `teamWorkspaceActivity`, `teamNodeAudit*`, `teamPresence*`) | **LIKELY_LEGACY / BACKEND STUBS** | No source consumer; prior audit records empty/no-op backend behavior | Preserve preload surface; no source migration or backend change |

This audit is why the source frontend is runtime-complete for all reachable production routes but the absolute feature-parity claim remains gated on the explicit KYC authorization decision.

### Migration ledger

| Component/Page | Recovered source | New source | Status | Behavior parity | Visual parity | IPC parity | Legacy dependency | Cutover status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Source frontend | N/A | `apps/desktop/src/renderer-source` | `IN_PROGRESS` | Production build and 17-page typed inventory PASS; active-capability parity audit ongoing | 15 runtime route baselines MATCH | 177 direct adapter methods exposed by preload | None | Production runtime |
| Recovered runtime oracle | `apps/desktop/src/renderer` | N/A | `LEGACY_REMOVED` | Historical Phase 0–10 evidence retained above | Replaced by source baselines | Historical manifest replaced by source manifest | None | Removed |
| AppShell / Sidebar / Header | Recovered main bundle + compatibility CSS | `app/AppShell.tsx`, `components/Sidebar`, `components/Header` | `CUT_OVER` | Routing/gates/collapse/provider state verified | 236px/66px baselines MATCH | Guarded adapters only | None | Production runtime |
| Settings / CAPTCHA | Recovered lazy chunks | `pages/Settings`, `pages/CaptchaSetup` | `CUT_OVER` | Folder/auth/four-step setup/verification recovered | Dedicated baselines MATCH | Exact Settings/CAPTCHA adapters | OS/external actions manually verified only | Production runtime |
| Image / Voice / Video | Recovered generation chunks | `pages/Image`, `pages/Voice`, `pages/Video` | `CUT_OVER` | Generation/reference/edit/upscale/queue/history orchestration source-owned | Dedicated baselines MATCH | Exact generation adapters | Paid success paths excluded from smoke | Production runtime |
| Editing / media | Recovered editor/upload/concat chunks | `pages/MediaLibrary`, `pages/VideoEditor`, `pages/SceneMerge`, `pages/CapcutEditor` | `CUT_OVER` | Video Editor project/subtitle/BGM/watermark/multi-clip state and CapCut CRUD/tracks/layers/transitions/effects/variable-speed/transform/crop/audio/deflicker/lip-sync persistence verified; Image Editor VEO crop and Cloud Media download boundaries are source-owned | Dedicated baselines MATCH | Exact migrated editor/media/project/history/preset/tool adapters are inside the 177-method guarded surface | Real native pickers, export and paid AI execution excluded from automation | Production runtime |
| AI Agent | Recovered AI Agent chunks | `pages/AIAgent` | `IN_PROGRESS` | Conversations, package, six source panels, workspace graph/revisions, Note/Image/Video/Audio node controls, Toolbox/Asset clone persistence and local audio trim verified locally; provider KYC/reference and legacy preview boundaries remain classified/deferred | Dedicated baseline MATCH | Exact agent/workspace/media adapters inside the 177-method guarded source surface | Paid execution, OS dialogs and explicit KYC upload approval | Production runtime |
| Home/Explore/Community/Workflow detail | Missing recovered lazy targets | None | `CONFIRMED_DEAD` | Rejected by typed source navigation; no source producer/route/component | Not applicable | No source adapter calls | Recovered runtime removed | Removed |

### Phase 5 verified route and contract inputs

- Recovered allowed-page set: `provider-hub`, `dashboard`, `image`, `image-ultra`, `video-pro`, `video-standard`, `upload`, `concat`, `video-editor`, `capcut-video`, `voice`, `provider-account`, `webview`, `captcha-setup`, `settings`, `guide`.
- The 15 missing-preload legacy methods are baseline debt, not source migration requirements. A method enters new source only after its caller is proven active and the existing preload exposes it.
- Source adapters may organize frontend calls, but must preserve method name, argument order/count, payload, response and callback semantics. Static guards protect names/surface only; they are not behavioral/schema validation.

### Phase 5 status

- **Status:** `SOURCE_READY`; not cut over to Electron runtime
- **Architecture:** Added a parallel source tree under `apps/desktop/src/renderer-source` with `app`, `components/ui`, `pages`, `services/electron-api`, `styles` and `types`. `App.tsx`, bootstrap and a typed source-only route registry compile from readable React/TypeScript
- **Build system:** React 19.2.8, TypeScript 7.0.2, Vite 8.2.1 and `@vitejs/plugin-react` 6.0.5 are root development dependencies. `pnpm build:source` emits an isolated relative-base build to ignored `apps/desktop/dist-source-renderer`; the deployable desktop package retains its original production dependencies and recovered build command
- **Type strategy:** Strict TypeScript with bundler resolution, DOM/ES2022 libraries, exact optional properties and unchecked-index protection. Provider/CAPTCHA response shapes remain `unknown`; only confirmed request payloads and provider IDs are typed
- **Frontend API boundary:** Added a single guarded preload accessor plus Provider and CAPTCHA adapters. Eight direct adapter method names with existing recovered callers are checked against the actual preload surface. No adapter changes argument order, payload shape or response semantics, and direct `window.api` access outside the adapter client is rejected statically
- **Design system source:** Semantic tokens copy the verified Phase 4 compatibility values into maintainable source CSS. `Surface` and `Badge` are the only initial shared primitives and both have a real bootstrap-page consumer. No UI, routing or state library was installed
- **Route inventory:** The source compatibility inventory freezes the 16 recovered allowed page IDs. The four missing lazy targets remain separate legacy debt and are not migrated or removed
- **Runtime coexistence:** Electron Main still loads recovered `dist/index.html`; source output is absent from Electron files, recovered build input and recovered package staging. The packaged production dependency tree does not contain source-only React
- **Tests added:** `scripts/check-source-frontend.mjs` verifies required source boundaries, rejects direct API usage outside the adapter, rejects recovered imports, checks adapter method names against preload, freezes the allowed-page inventory and fails on any Electron/recovered-build source cutover
- **Files changed:** Root/desktop package manifests and lockfile; `.gitignore`; `scripts/check-source-frontend.mjs`; `apps/desktop/src/renderer-source/**`; this plan
- **Validation:** `pnpm validate` PASS including source typecheck/build; `pnpm check:frontend-contract` PASS; `pnpm package:electron-smoke` PASS; Settings Electron smoke PASS with expanded/collapsed baselines at 0 differing pixels; CAPTCHA Electron smoke PASS with expanded/collapsed baselines at 5/0 differing pixels within the existing tolerance; no renderer errors or failed requests; Electron backend diff empty
- **Known risks:** The source bootstrap page is intentionally not an Electron production route and therefore has build evidence, not Electron runtime parity. Adapter response schemas and behavior are not validated by the static surface guard. No AppShell or active page has migrated yet
- **Deferred:** Phase 6 recovers AppShell/Sidebar/Header and adds runtime comparison for the new source entry without changing active feature behavior
