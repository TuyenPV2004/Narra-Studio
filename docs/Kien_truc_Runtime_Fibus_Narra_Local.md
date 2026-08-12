# Kiến trúc runtime Fibus → Narra local

## 1. Nguồn triển khai

Narra Desktop không còn dùng UI thử nghiệm được viết lại từ đầu. `apps/desktop/src` hiện chứa JavaScript/CSS/HTML đã truy hồi tĩnh từ payload Electron của Fibus Studio và được chỉnh trực tiếp. Đây là mã bundle đã biên dịch/minify, không phải source TypeScript gốc hay source map đầy đủ.

Các vùng chính:

- `src/electron`: Main Process, preload, IPC, worker, Google Flow automation và provider.
- `src/renderer`: renderer bundle và tài nguyên giao diện thực tế của phần mềm mẫu.
- `src/config`: branding và endpoint runtime local.
- `scripts/build-recovered-desktop.mjs`: tạo `dist`, `dist-electron`, `config` từ source nói trên.
- `scripts/prepare-recovered-desktop-package.mjs`: deploy runtime dependency và tạo package staging.

## 2. Chức năng được giữ

- Google Flow WebView và tự động điền/gửi prompt.
- Tối đa nhiều account slot với Electron partition tách biệt.
- Bắt session/Bearer token trong đúng partition của tài khoản.
- CAPTCHA bridge, chẩn đoán DOM và page-generation fallback.
- Tạo ảnh/video, queue, tải kết quả và thư viện media local.
- Avis image/video/text khi người dùng tự cấu hình API key.
- FFmpeg, CapCut/Gencut, nối/cắt/chỉnh video, voice và worker ONNX/Transformers.
- Workspace/canvas cho Agent, nhưng được thay backend bằng JSON/media local.

Không chia sẻ cookie giữa account; không lưu Google password hoặc 2FA secret; không tự vượt bước xác minh do Google yêu cầu.

## 3. Chức năng và đường chạy đã loại

| Thành phần mẫu | Xử lý trong Narra |
|---|---|
| Gói, thanh toán, kích hoạt License | Không còn route/menu/IPC thực thi; provider không kiểm tra license |
| Telemetry `/events` | Import được chuyển sang `trackEvent-local.js` no-op; chunk gửi event bị loại khỏi build nguồn |
| Auto-update | Lifecycle local không tải update; IPC cài update và preload API không được đăng ký |
| Team realtime/WebSocket | Không dùng `ws`, license hay server; IPC tương thích ghi local và ACK local |
| Community/marketplace/cloud workflow | Không có navigation public và không đăng ký IPC cloud |
| CMS cấu hình AI | Không fetch CMS; Ollama/Avis đọc từ local settings hoặc environment |
| Profile Fibus/Skyverses | Sidebar dùng danh tính local, không tải hồ sơ từ server mẫu |

Một số tên IPC `team-*` được giữ để tương thích với renderer đã biên dịch. Tên không đồng nghĩa với kết nối từ xa; implementation nằm trong `electron/ipc/collaboration-local.js` và chỉ ghi `narra-local-workspaces.json` cùng `narra-local-media` dưới Electron `userData`.

## 4. Endpoint còn được phép

- `https://labs.google/fx` và Google API phục vụ Flow, credits, media generation.
- `https://api.avis.xyz` khi người dùng chọn Avis và cung cấp key.
- Ollama/OpenAI-compatible endpoint do người dùng cấu hình.
- Cloudflare R2/Images chỉ khi workflow Avis cần media URL trung gian và người dùng cấu hình credential.
- Voice/lip-sync/model endpoints chỉ khi người dùng chủ động dùng tính năng tương ứng.

Không endpoint Fibus/Skyverses nào cần thiết cho startup, provider selection hoặc Google Flow.

## 5. Bí mật và `.env`

Narra đọc `.env` ở thư mục chạy hoặc cạnh executable. Không bundle `.env` vào EXE. Các biến tùy chọn được liệt kê trong `.env.example`; giá trị thật phải ở `.env` đã Git-ignore. Google login vẫn diễn ra trong cửa sổ Flow, không qua `.env`.

## 6. Build và kiểm chứng

```powershell
pnpm install
pnpm --filter @narra/desktop typecheck
pnpm --filter @narra/desktop build
node scripts/smoke-local-workspace.cjs
pnpm package:win
```

`typecheck` ở đây là syntax check cho các file JavaScript đã truy hồi. Package Windows phải chứa `ffmpeg.exe`, ONNX Runtime và Sharp trong `app.asar.unpacked`. Artifact mặc định: `release/Narra-Studio-0.1.0-portable-x64.exe`.

## 7. Giới hạn còn lại

- Vì renderer là bundle đã biên dịch, việc bảo trì khó hơn source React/TypeScript gốc.
- Google Flow có thể đổi DOM/selector; cần smoke test đăng nhập, nhập prompt, submit và download sau mỗi thay đổi lớn của Flow.
- Kiểm thử hiện tại không đăng nhập tài khoản Google và không gọi API trả phí; các bước đó cần người dùng kiểm chứng trên tài khoản của mình.
