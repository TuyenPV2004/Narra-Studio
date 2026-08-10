# Setup, backup và troubleshooting Narra Studio

## 1. Phạm vi

Tài liệu này áp dụng cho Narra Studio chạy local trên Windows x64. Narra không cần OpenAI API key cho luồng Codex và không tự động điều khiển Google Flow. Creator chỉ rời Narra để xác nhận generation và tải media từ Flow.

Không ghi token, cookie, nội dung `.env` hoặc thông tin đăng nhập vào log, screenshot hay bản backup project.

## 2. Chuẩn bị môi trường phát triển

Yêu cầu chính:

- Windows 10/11 x64.
- Node.js 24 trở lên và pnpm 11.16 theo `packageManager` của repository.
- Codex CLI/App Server đã đăng nhập bằng tài khoản ChatGPT và có model mong muốn trong `model/list`.
- Google AI Pro chỉ cần khi creator tạo ảnh/video trong Flow.
- Kokoro runtime nếu muốn tạo narration local.

Tại thư mục repository:

```powershell
pnpm install
pnpm validate
pnpm dev
```

`pnpm validate` chạy lint, typecheck, test và production build. Không chạy Narra bằng cách mở trực tiếp file HTML trong `dist`; ứng dụng cần Electron Main/Preload để truy cập project store, Codex, filesystem và local jobs.

## 3. Voice runtime

Thiết lập Kokoro local:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/setup-voice-runtime.ps1
```

Voice runtime mặc định nằm trong `.runtime/voice` và không được commit. Nếu đặt ở nơi khác, khai báo đường dẫn bằng biến môi trường `NARRA_VOICE_RUNTIME_ROOT`; không ghi credential vào biến này. Mở tab **System** và kiểm tra `Kokoro voice runtime` trước khi tạo narration.

## 4. Chạy và đóng gói desktop

Build bản portable Windows:

```powershell
pnpm package:win
```

Kết quả:

- `release/win-unpacked/Narra Studio.exe`: bản thư mục, khởi động nhanh hơn và phù hợp chạy hằng ngày.
- `release/Narra-Studio-0.1.0-portable-x64.exe`: một file dễ chuyển máy nhưng cold start chậm hơn vì phải giải nén Electron và Remotion runtime.

Runtime package dùng pnpm `node-linker=hoisted` để không phụ thuộc symlink hoặc đường dẫn `%TEMP%` của máy build. Electron core không tự cung cấp packager, vì vậy Narra dùng electron-builder và target Windows portable.

## 5. System diagnostics

Mở một project, chọn tab **System**, rồi bấm **Run diagnostics**. Narra kiểm tra:

1. Workspace đọc/ghi được và số project đã index.
2. Codex App Server đăng nhập và `gpt-5.6-sol` có trong model catalog.
3. Kokoro model/runtime local.
4. Remotion CLI trong repository hoặc packaged resources.
5. FFmpeg đi kèm Remotion.

Kết quả chỉ hiển thị trạng thái kỹ thuật và hướng khắc phục; không hiển thị email, token hay cookie. `WARNING` cho phép tiếp tục các phần không phụ thuộc thành phần đó; `FAIL` cần xử lý trước khi chạy stage tương ứng.

## 6. Backup và restore project

Trong tab **System**, chọn **Choose destination** ở thẻ Project backup. Narra sẽ:

- Tạo một thư mục có project ID và timestamp ở ngoài project đang mở.
- Copy artifact, approvals, media, narration, caption và render history theo đường dẫn tương đối.
- Bỏ qua file render tạm có `.working.` trong tên.
- Đọc lại `project.json` của bản copy và xác nhận đúng project ID.
- Báo số file, tổng dung lượng và đường dẫn backup.

Backup project không gồm `.env`, credential, cookie hoặc database index `.narra` của workspace. Để restore, dùng **Open project folder** và chọn thư mục backup chứa `project.json`; Narra sẽ index lại project. Nên mở và chạy **Refresh** trước khi tiếp tục render.

Không chọn thư mục đích nằm bên trong project nguồn. ProjectStore chặn trường hợp này để tránh backup đệ quy.

## 7. Google Flow Assisted

Luồng đúng:

1. Narra tạo prompt package cho shot.
2. Creator copy prompt hoặc mở Flow.
3. Creator chọn model, xác nhận generation và tải output bằng tài khoản Google của mình.
4. Creator quay lại Narra, import candidate, xác nhận đúng shot, model/provenance và visual QA.

Nếu file không xuất hiện, kiểm tra đúng thư mục download/import, định dạng được hỗ trợ và thời điểm file. Narra không đọc session trình duyệt và không tự click nút generation.

## 8. Lỗi thường gặp

| Hiện tượng | Kiểm tra | Cách xử lý |
|---|---|---|
| Codex unavailable hoặc signed out | Tab System và AI workspace | Mở Codex/ChatGPT, đăng nhập lại, refresh diagnostics; không thêm OpenAI API key để lách luồng đã thiết kế |
| `gpt-5.6-sol` không có | `model/list` trong diagnostics | Chờ quota/model trở lại hoặc chọn model được UI báo hỗ trợ; Narra không fallback ngầm |
| Kokoro missing | Voice diagnostic và `.runtime/voice/runtime-ready.json` | Chạy lại script setup hoặc cấu hình `NARRA_VOICE_RUNTIME_ROOT` |
| Remotion/FFmpeg fail | Hai diagnostic tương ứng | Ở dev chạy `pnpm install`; với package, chạy lại `pnpm package:win` và kiểm tra `resources/narra-runtime/remotion` |
| Render bị chặn | Preflight trong Review/Timeline | Hoàn tất narration, caption, media mapping, asset QA, rights note và duration alignment |
| Job render bị ngắt | Job log trong Review | Retry đúng job; worker khôi phục job bị ngắt và không tự thay đổi approval gate |
| Portable mở chậm | Cold start phải giải nén runtime | Dùng `release/win-unpacked/Narra Studio.exe` cho công việc hằng ngày |
| Portable không vào app | Marker/log không được tạo | Thử `win-unpacked`; build lại bằng script hiện tại và xác nhận runtime có 0 reparse point |
| Backup không tạo được | Đích backup và quyền ghi | Chọn thư mục ngoài project nguồn, còn đủ dung lượng và có quyền ghi |

## 9. Kiểm tra sau sửa lỗi

Chạy lại theo thứ tự:

```powershell
pnpm validate
node scripts/smoke-codex-bridge.mjs
pnpm --filter @narra/render render:voice-smoke
pnpm package:win
```

Codex smoke dùng một turn ngắn qua App Server và tài khoản đã đăng nhập; nó không dùng OpenAI API key. Flow vẫn là manual smoke vì generation/download cần quyết định trực tiếp của creator.
