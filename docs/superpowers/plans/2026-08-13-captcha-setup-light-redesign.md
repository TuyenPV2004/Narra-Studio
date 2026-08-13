# CAPTCHA Setup Light Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thiết kế lại trang thiết lập CAPTCHA thành accordion light-theme dễ đọc, sửa khả năng thu gọn, chuẩn hóa toast trắng có icon màu và căn lại icon sidebar “Thư viện”.

**Architecture:** Giữ nguyên bundle React đã khôi phục và toàn bộ IPC CAPTCHA. Thay đổi hành vi tối thiểu trong chunk `CaptchaSetupPage`, còn giao diện được áp dụng bằng lớp override có phạm vi rõ trong `light-theme.css`; kiểm thử hợp đồng đọc source bundle để bảo vệ các hành vi và selector bắt buộc.

**Tech Stack:** Electron renderer bundle, React JSX đã biên dịch, Lucide icons, CSS semantic tokens, Node.js `assert` contract tests.

## Global Constraints

- Không thêm dependency mới và không thay đổi Electron IPC/CAPTCHA provider flow.
- Không đọc hoặc thao tác token, cookie, tài khoản Google hay CAPTCHA thật.
- Nền giao diện CAPTCHA phải sáng; vùng CAPTCHA không được đưa vào allowlist media tối.
- Toast nền trắng, chữ gần đen, icon Lucide màu nằm bên trái.
- Không commit, push, tạo branch hoặc sửa lịch sử Git.

---

### Task 1: Regression contract cho CAPTCHA, toast và nav icon

**Files:**
- Modify: `scripts/test-light-theme-ui.cjs`
- Test: `scripts/test-light-theme-ui.cjs`

**Interfaces:**
- Consumes: renderer bundle `CaptchaSetupPage-DbTYSglx.js`, `index-JlIFz2Wa.js`, `light-theme.css`.
- Produces: assertions bảo vệ toggle accordion, accessibility linkage, nhãn phụ bị xóa, toast flex/icon và nav-icon alignment.

- [ ] **Step 1: Viết assertions thất bại**

Thêm kiểm tra source cho các hợp đồng sau:

```js
assert.equal(captchaJs.includes('[x.displayName," · VEO3"]'), false);
assert.match(captchaJs, /onClick:\(\)=>y\(u\?-1:r\)/);
assert.match(captchaJs, /aria-controls:`captcha-step-\$\{a\.id\}`/);
assert.match(captchaJs, /id:`captcha-step-\$\{a\.id\}`/);
assert.match(lightCss, /\/\* CAPTCHA light redesign \*\//);
assert.match(lightCss, /\.toast\s*\{[^}]*display:\s*flex\s*!important;[^}]*gap:\s*8px\s*!important;/s);
assert.match(lightCss, /\.toast\.success\s*>\s*svg[^}]*color:\s*var\(--success-text\)/s);
assert.match(lightCss, /\.nav-icon\s*\{[^}]*display:\s*grid\s*!important;[^}]*place-items:\s*center/s);
```

- [ ] **Step 2: Chạy test và xác nhận RED**

Run:

```powershell
node scripts/test-light-theme-ui.cjs
```

Expected: FAIL vì toggle, ARIA linkage và CAPTCHA-specific light CSS chưa tồn tại.

### Task 2: Sửa hành vi và markup CAPTCHA

**Files:**
- Modify: `apps/desktop/src/renderer/assets/CaptchaSetupPage-DbTYSglx.js`
- Test: `scripts/test-light-theme-ui.cjs`

**Interfaces:**
- Consumes: state `S`, setter `y`, step index `r`, step id `a.id`.
- Produces: toggle `y(u ? -1 : r)` và quan hệ `aria-controls`/`id` cho panel.

- [ ] **Step 1: Xóa nhãn phụ**

Xóa node `captcha-setup-eyebrow` chứa `[x.displayName, " · VEO3"]`, giữ nguyên `h1` và mô tả.

- [ ] **Step 2: Sửa toggle và accessibility**

Đổi click handler thành:

```js
onClick: () => y(u ? -1 : r)
```

Thêm vào summary:

```js
"aria-controls": `captcha-step-${a.id}`
```

Thêm vào panel:

```js
id: `captcha-step-${a.id}`
```

- [ ] **Step 3: Chạy contract test**

Run: `node scripts/test-light-theme-ui.cjs`

Expected: JS behavior assertions PASS; CSS redesign assertions vẫn FAIL.

### Task 3: Áp dụng light design system và toast dùng Lucide

**Files:**
- Modify: `apps/desktop/src/renderer/light-theme.css`
- Test: `scripts/test-light-theme-ui.cjs`

**Interfaces:**
- Consumes: semantic tokens `--bg-*`, `--text*`, `--border*`, `--brand-primary*`, `--success-*`, `--danger-*`.
- Produces: một section `/* CAPTCHA light redesign */` và một section toast/nav alignment có selector rõ ràng.

- [ ] **Step 1: Viết CAPTCHA light surfaces**

Override `.captcha-setup-page`, hero, progress, step, current/done state và panel bằng surface sáng. Dùng một cột tối đa 960px, border/shadow nhẹ, bỏ dark gradient/glow và bỏ uppercase cho step labels/status.

- [ ] **Step 2: Chuẩn hóa interaction và responsive**

Giữ summary tối thiểu 64px, focus-visible rõ, chevron transition 200ms, nội dung mô tả wrap, action wrap ở viewport nhỏ và reduced-motion tắt animation.

- [ ] **Step 3: Chuẩn hóa toast**

Giữ icon semantic từ Lucide: `CircleCheck` cho success, `CircleX` cho error và `Info` cho info. Đặt `.toast` thành flex, `align-items:center`, `gap:8px`, nền trắng, chữ `--text`, icon 18px/flex none. Màu icon theo `.success`, `.error`, `.info`; không tô toàn bộ toast bằng màu trạng thái.

- [ ] **Step 4: Căn icon sidebar**

Đặt `.nav-icon` thành grid `place-items:center`, kích thước ổn định; SVG `display:block`, giữ stroke và hover light-theme.

- [ ] **Step 5: Chạy contract test và xác nhận GREEN**

Run: `node scripts/test-light-theme-ui.cjs`

Expected: `Narra light theme UI contract is valid.`

### Task 4: Quality gates và visual QA

**Files:**
- Verify: toàn bộ file đã sửa ở Task 1–3.

**Interfaces:**
- Consumes: source renderer đã sửa.
- Produces: build desktop và bằng chứng kiểm tra trực quan.

- [ ] **Step 1: Chạy kiểm tra dự án**

Run:

```powershell
pnpm typecheck
pnpm test
pnpm build
```

Expected: cả ba lệnh exit 0.

- [ ] **Step 2: Kiểm tra source build**

Xác nhận `apps/desktop/dist/light-theme.css` chứa section CAPTCHA/toast mới và bundle dist chứa toggle/ARIA linkage.

- [ ] **Step 3: Visual QA Electron**

Mở build local, kiểm tra trang CAPTCHA ở kích thước desktop: nền/card sáng, chữ rõ, nhãn phụ không còn, card đóng/mở được, toast trắng/icon màu và nav icon thẳng hàng. Không kích hoạt CAPTCHA thật hoặc thao tác tài khoản.

- [ ] **Step 4: Rà diff**

Chỉ báo cáo file thuộc phạm vi; giữ nguyên các thay đổi người dùng đã có và không commit.
