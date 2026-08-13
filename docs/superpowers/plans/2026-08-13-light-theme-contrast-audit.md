# Narra Studio Light Theme Contrast Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hoàn thiện light theme trên mọi application surface, loại bỏ sidebar captions, sửa chữ/icon mờ và trạng thái hover trắng, đồng thời giữ dark theme chỉ trong media/canvas surfaces.

**Architecture:** Giữ nguyên bundle renderer và toàn bộ handler. Xóa đúng ba caption trong JSX bundle, sau đó mở rộng stylesheet compatibility được nạp cuối theo semantic token và component families; regression test kiểm tra contract nguồn còn visual QA kiểm tra computed style trong Electron.

**Tech Stack:** Electron 43, compiled JavaScript renderer, CSS, Node.js `node:assert/strict`, pnpm.

## Global Constraints

- Toàn bộ application chrome, sidebar, trang, form, menu, modal và text dùng light theme.
- Nền tối chỉ tồn tại trong video/image preview, canvas editor, timeline kỹ thuật, thumbnail overlay và controls trực tiếp trên media.
- Text/icon trên light surface đạt tối thiểu 4.5:1; hover không chuyển chữ/icon sang trắng.
- Không đổi IPC, navigation handlers, provider, dữ liệu người dùng hoặc logic tạo media.
- Không thêm dependency, theme switcher, commit, push hoặc gọi provider trả phí.
- Mọi sửa đổi bundle phải nhỏ, có selector/chuỗi mục tiêu và regression assertion.

---

### Task 1: Regression contract cho sidebar và semantic light theme

**Files:**
- Modify: `scripts/test-light-theme-ui.cjs`
- Test: `scripts/test-light-theme-ui.cjs`

**Interfaces:**
- Consumes: compiled main JS và `light-theme.css` dưới dạng UTF-8.
- Produces: exit code 0 khi caption đã bị xóa và các contract sidebar/component light theme hiện diện.

- [ ] **Step 1: Thêm assertions đang thất bại**

Thêm assertions độc lập cho:

```js
for (const sectionKey of [
  'sidebar.sections.create',
  'sidebar.sections.finish',
  'sidebar.sections.manage',
]) {
  assert.equal(mainJs.includes(`children: U("${sectionKey}")`), false);
}
assert.match(lightCss, /--surface-media:\s*#11131a/);
assert.match(lightCss, /\.sidebar\{[^}]*background:var\(--bg-0\)!important[^}]*border-right:0!important/);
assert.match(lightCss, /\.nav-item:hover :is\(\.nav-icon,\.nav-label\)\{color:var\(--brand-primary-hover\)!important/);
assert.match(lightCss, /\/\* Light typography compatibility \*\//);
assert.match(lightCss, /\/\* Light component compatibility \*\//);
assert.match(lightCss, /\/\* Intentional dark media surfaces \*\//);
```

- [ ] **Step 2: Chạy test để xác nhận RED**

Run: `node scripts/test-light-theme-ui.cjs`

Expected: FAIL vì caption vẫn tồn tại và compatibility sections chưa có.

### Task 2: Sidebar liền mạch và không còn caption/hover trắng

**Files:**
- Modify: `apps/desktop/src/renderer/assets/index-JlIFz2Wa.js:20990-21055`
- Modify: `apps/desktop/src/renderer/light-theme.css`
- Test: `scripts/test-light-theme-ui.cjs`

**Interfaces:**
- Consumes: `Jw` sidebar component và các class `.sidebar`, `.nav-item`, `.nav-icon`, `.nav-label`.
- Produces: cùng navigation behavior, không có caption nodes, sidebar light surface liền mạch.

- [ ] **Step 1: Xóa đúng ba caption nodes**

Xóa ba `s.jsx("span", { className: "atelier-nav-caption", ... })` dùng keys `create`, `finish`, `manage`; không xóa navigation item hoặc translation data.

- [ ] **Step 2: Thêm sidebar compatibility rules**

```css
.sidebar {
  background: var(--bg-0) !important;
  border-right: 0 !important;
  box-shadow: none !important;
}
.sidebar-nav { gap: 4px; padding-top: 10px; }
.nav-item:hover,
.nav-item.active { color: var(--brand-primary-hover) !important; }
.nav-item:hover :is(.nav-icon, .nav-label),
.nav-item.active :is(.nav-icon, .nav-label) {
  color: var(--brand-primary-hover) !important;
}
```

Bao phủ thêm collapse button, collapsed tooltip, provider/account menu và status controls bằng light tokens; icon trắng chỉ được giữ trong avatar media overlay.

- [ ] **Step 3: Chạy regression test**

Run: `node scripts/test-light-theme-ui.cjs`

Expected: caption/sidebar assertions PASS; test vẫn FAIL nếu Task 3 sections chưa hoàn chỉnh.

### Task 3: Typography, controls và containers trên light surfaces

**Files:**
- Modify: `apps/desktop/src/renderer/light-theme.css`
- Test: `scripts/test-light-theme-ui.cjs`

**Interfaces:**
- Consumes: semantic tokens `--text*`, `--bg*`, `--border*`, component class families trong compiled CSS.
- Produces: compatibility sections có phạm vi cho typography, controls, containers và state colors.

- [ ] **Step 1: Bổ sung semantic surface/status tokens**

```css
--surface-raised: #ffffff;
--surface-sunken: #f3f0f8;
--surface-media: #11131a;
--success-text: #087a55;
--success-bg: #e5f7ef;
--warning-text: #8a4b00;
--warning-bg: #fff3d6;
--danger-text: #b42318;
--danger-bg: #fdecea;
```

- [ ] **Step 2: Thêm `Light typography compatibility`**

Ánh xạ subtitle/helper/metadata/placeholder/empty-state/code/path ở các họ `vpro`, `img`, `workspace`, `account`, `settings`, `captcha`, `provider`, `ccp`, `voice`, `agent` về `--text-2/3/4`; không chọn overlay nằm trong media surface.

- [ ] **Step 3: Thêm `Light component compatibility`**

Ánh xạ menu, popover, modal, toast, card, tab, chip, search, input và icon buttons về surface/border tokens. Hover dùng `--bg-hover` và text/icon tím; primary/danger buttons giữ on-color trắng trên nền đậm. Success/warning/danger dùng semantic pastel tokens.

- [ ] **Step 4: Chạy test để xác nhận GREEN**

Run: `node scripts/test-light-theme-ui.cjs`

Expected: PASS, exit code 0.

### Task 4: Dark media allowlist và audit selector

**Files:**
- Modify: `apps/desktop/src/renderer/light-theme.css`
- Modify: `scripts/test-light-theme-ui.cjs`
- Test: `scripts/test-light-theme-ui.cjs`

**Interfaces:**
- Consumes: media/canvas/timeline selectors.
- Produces: dark surfaces explicit, reviewable; controls ngoài media vẫn sáng.

- [ ] **Step 1: Thêm `Intentional dark media surfaces`**

Chỉ áp `--surface-media` và chữ trắng cho selectors media đã xác định như preview/canvas/viewer/timeline/thumbnail overlays. Không đưa menu, modal, form, settings hoặc sidebar vào section này.

- [ ] **Step 2: Thêm audit assertions**

Test xác nhận section dark allowlist không chứa `.sidebar`, `.modal`, `.menu`, `.settings`, `.account`; xác nhận các section compatibility không dùng `color:#fff` ngoài primary/danger/media blocks được đặt tên.

- [ ] **Step 3: Chạy regression test**

Run: `node scripts/test-light-theme-ui.cjs`

Expected: PASS.

### Task 5: Source gates và Electron visual QA

**Files:**
- Verify: toàn bộ files Task 1–4
- Test: project scripts và Electron runtime/package

**Interfaces:**
- Consumes: updated renderer source.
- Produces: bằng chứng syntax/test/build và visual states thực tế.

- [ ] **Step 1: Chạy source gates**

```powershell
pnpm typecheck
pnpm test
pnpm build
```

Nếu pnpm gặp khóa Windows, chạy trực tiếp `check-recovered-desktop.mjs`, bốn smoke tests và `build-recovered-desktop.mjs`, đồng thời báo rõ giới hạn.

- [ ] **Step 2: Khởi động Electron không gọi provider**

Mở app local/package và chỉ điều hướng các trang; không submit generation hoặc kiểm tra account bằng request trả phí.

- [ ] **Step 3: Visual QA**

Kiểm tra sidebar expanded/collapsed, hover/active icon, top header, image/video page, concat/library, account/settings/CAPTCHA, menu/modal và AI Agent. Ghi nhận computed foreground/background representative và xác minh text/icon rõ trên light surfaces.

- [ ] **Step 4: Diff/cleanup verification**

Run: `git diff --check` và review targeted diff. Không commit hoặc sửa file ngoài phạm vi.
