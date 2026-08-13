# Narra Studio Light Theme UI Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chuyển toàn bộ renderer Narra Studio sang light theme nhất quán, bỏ các nhãn trang trí được chỉ định, dùng sentence case và sửa nhóm nút đường dẫn đầu ra bị chồng icon/chữ.

**Architecture:** Giữ nguyên renderer bundle đã biên dịch và mọi handler nghiệp vụ. Thay đổi source-of-truth của brand, critical CSS và một lớp override CSS có phạm vi rõ ràng; thay đúng các đoạn JSX đã biên dịch tạo wordmark/footer, được bảo vệ bằng smoke test đọc artifact trực tiếp.

**Tech Stack:** Electron 43, JavaScript bundle đã biên dịch, CSS, Node.js `node:assert/strict`, pnpm.

## Global Constraints

- Áp dụng light theme cho toàn bộ renderer Electron hiện hành trong `apps/desktop/src/renderer`.
- Giữ màu tím Narra làm primary/accent; chữ chính trên nền sáng phải đạt độ tương phản tối thiểu 4.5:1.
- Không khôi phục source React cũ và không thay đổi IPC, Google Flow/CAPTCHA, provider, dữ liệu người dùng hoặc kiến trúc.
- Không thêm theme switcher, dependency, navigation mới, deploy, package, commit hoặc đọc secret.
- Renderer là bundle đã biên dịch: mọi thay đổi bundle phải nhỏ, có mục tiêu và có assertion chính xác.

---

### Task 1: Regression contract cho light theme và UI cleanup

**Files:**
- Create: `scripts/test-light-theme-ui.cjs`
- Modify: `package.json:13`
- Test: `scripts/test-light-theme-ui.cjs`

**Interfaces:**
- Consumes: UTF-8 text của brand JSON, `index.html`, bundle chính và CSS chính.
- Produces: smoke-test process trả exit code 0 khi các contract UI đều đúng.

- [ ] **Step 1: Viết smoke test đang thất bại**

```js
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const renderer = path.join(root, 'apps', 'desktop', 'src', 'renderer');
const mainJs = fs.readFileSync(path.join(renderer, 'assets', 'index-JlIFz2Wa.js'), 'utf8');
const mainCss = fs.readFileSync(path.join(renderer, 'assets', 'index-DNnmb74c.css'), 'utf8');
const html = fs.readFileSync(path.join(renderer, 'index.html'), 'utf8');
const brand = JSON.parse(fs.readFileSync(path.join(renderer, 'brand', 'brand.generated.json'), 'utf8'));

assert.equal(brand.displayNameUpper, 'Narra Studio');
assert.equal(brand.theme.background0, '#f8f7fc');
assert.equal(mainJs.includes('children: "LOCAL ONLY"'), false);
assert.equal(mainJs.includes('className: "sidebar-footer"'), false);
assert.equal(mainCss.includes('content:"IMAGE STUDIO"'), false);
assert.match(mainCss, /Narra light theme/);
assert.match(mainCss, /\.vpro-output-open\{[^}]*display:inline-flex[^}]*gap:/);
assert.match(html, /body\s*\{[^}]*background:\s*#f8f7fc/s);
```

- [ ] **Step 2: Chạy test và xác nhận RED**

Run: `node scripts/test-light-theme-ui.cjs`

Expected: FAIL ở assertion `displayNameUpper` hoặc light background vì bundle vẫn dùng dark theme.

- [ ] **Step 3: Đưa test vào quality gate hiện hành**

Sửa script `test` trong `package.json` bằng cách nối `&& node scripts/test-light-theme-ui.cjs` sau các test hiện có; không xóa hoặc sắp xếp lại thay đổi CAPTCHA đang có trong working tree.

### Task 2: Brand và critical surfaces dùng light palette

**Files:**
- Modify: `apps/desktop/src/renderer/brand/brand.generated.json`
- Modify: `apps/desktop/src/config/brand.generated.json`
- Modify: `apps/desktop/src/electron/runtime/brand.js`
- Modify: `apps/desktop/src/electron/runtime/lifecycle-local.js`
- Modify: `apps/desktop/src/renderer/index.html`
- Test: `scripts/test-light-theme-ui.cjs`

**Interfaces:**
- Consumes: tên/token brand hiện hành.
- Produces: cùng schema brand, với `displayNameUpper: "Narra Studio"` và palette light tương thích mọi consumer hiện có.

- [ ] **Step 1: Đổi đồng bộ source-of-truth brand**

Dùng các token sau ở cả hai JSON và `runtime/brand.js`:

```text
primary #7c3aed       primaryHover #6d28d9
primarySoft #ede9fe   onPrimary #ffffff
background0 #f8f7fc  background1 #ffffff
background2 #f3f0f8  background3 #ebe7f2
background4 #ded8e8  backgroundHover #f0ebf8
border #d8d1e2       borderSubtle #e8e3ee
text #211a2b         textSecondary #51465f
textMuted #71667e    textQuiet #857a91
```

Đổi giá trị `displayNameUpper` thành `Narra Studio` nhưng giữ nguyên tên field để không đổi public contract nội bộ.

- [ ] **Step 2: Chuyển critical CSS và splash/fallback sang light**

Trong `index.html`, đổi nền body/root/splash/fallback/panel/button sang token light tương đương; giữ tím làm focus/primary và giữ nguyên logic splash/diagnostics.

- [ ] **Step 3: Đồng bộ loading window của Electron**

Trong `lifecycle-local.js`, đổi nền loading sang `brand.theme.background0`, chữ sang `brand.theme.text`, track sang border sáng và dùng `brand.displayNameUpper` đã sentence-case; không đổi lifecycle hoặc timing.

- [ ] **Step 4: Chạy smoke test để theo dõi tiến độ**

Run: `node scripts/test-light-theme-ui.cjs`

Expected: vẫn FAIL ở footer, pseudo-element hoặc layout nút; các assertion brand/HTML đã PASS.

### Task 3: Xóa nhãn thừa, sentence case và sửa output buttons

**Files:**
- Modify: `apps/desktop/src/renderer/assets/index-JlIFz2Wa.js:12196-12217, 21086-21099`
- Modify: `apps/desktop/src/renderer/assets/index-DNnmb74c.css`
- Test: `scripts/test-light-theme-ui.cjs`

**Interfaces:**
- Consumes: component `YS`, sidebar JSX đã biên dịch và class hiện có của renderer.
- Produces: cùng React component signatures/handlers; chỉ khác nội dung hiển thị và CSS presentation.

- [ ] **Step 1: Chuyển wordmark sang sentence case**

Trong component `YS`, thay `bt.displayNameUpper` bằng `bt.displayName`; không đổi prop `compact`, `suffix`, asset hoặc accessibility attributes.

- [ ] **Step 2: Xóa footer sidebar khỏi JSX bundle**

Xóa child `div.sidebar-footer` chứa `sidebar-trust-label` và `sidebar-version`. Không xóa biến phiên bản hoặc footer ở ngữ cảnh khác.

- [ ] **Step 3: Thêm lớp override light theme cuối CSS chính**

Thêm block comment `/* Narra light theme */` ở cuối CSS. Block phải:

- khai báo lại các custom properties light;
- đặt `color-scheme: light`;
- ánh xạ app, sidebar, header, panel, card, form control, menu, modal, toast và workspace surface về nền sáng/token;
- bỏ `text-transform: uppercase` trên wordmark, navigation captions, section labels, button labels và metadata giao diện thông thường;
- vô hiệu hóa `.narra-image-studio .img-page-header:after` bằng `content:none`;
- đặt `.vpro-output-open` thành `display:inline-flex; align-items:center; justify-content:center; gap:6px; min-height:32px; padding:6px 10px; white-space:nowrap` và đảm bảo icon `flex:0 0 auto`;
- giữ focus-visible ring tím và `prefers-reduced-motion` hiện có.

- [ ] **Step 4: Chạy regression test để xác nhận GREEN**

Run: `node scripts/test-light-theme-ui.cjs`

Expected: PASS, exit code 0.

### Task 4: Quality gates và visual validation

**Files:**
- Verify: toàn bộ file ở Task 1–3
- Test: `package.json` quality gates và ứng dụng Electron local

**Interfaces:**
- Consumes: renderer đã chỉnh.
- Produces: bằng chứng build/test và danh sách giới hạn kiểm tra runtime nếu có.

- [ ] **Step 1: Chạy các quality gate của dự án**

Run lần lượt:

```powershell
pnpm typecheck
pnpm test
pnpm build
```

Expected: cả ba exit code 0, không làm yếu hoặc bỏ test hiện có.

- [ ] **Step 2: Khởi động ứng dụng cho visual QA**

Run: `pnpm --filter @narra/desktop dev`

Expected: Electron mở renderer local, không gọi generation/provider trả phí.

- [ ] **Step 3: Kiểm tra giao diện thực tế**

Kiểm tra sidebar, trang tạo ảnh/video, popup tài khoản, Settings và một modal ở viewport desktop mặc định. Xác nhận không còn `IMAGE STUDIO`, footer local/version, chữ trang trí viết hoa hoặc icon phủ chữ `Đổi/Mở`; không có nền dark nổi bật và focus ring vẫn thấy rõ.

- [ ] **Step 4: Kiểm tra diff và báo cáo**

Run: `git diff --check` và `git diff -- apps/desktop/src/renderer apps/desktop/src/config apps/desktop/src/electron/runtime scripts/test-light-theme-ui.cjs package.json`.

Expected: không có whitespace error; diff chỉ gồm phạm vi UI/test đã duyệt và giữ nguyên thay đổi có sẵn của người dùng.
