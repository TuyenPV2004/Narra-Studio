# Kiến trúc runtime Narra local

## Phạm vi

Narra Studio là ứng dụng Electron single-user. Renderer chính được build từ React/TypeScript source bằng Vite; Electron Main/Preload cung cấp IPC cho Google Flow, provider, media và lưu trữ local.

## Luồng giữ lại

- Google Flow qua `labs.google` và `aisandbox-pa.googleapis.com`.
- Nhiều tài khoản bằng Electron partition tách biệt; cookie không được chia sẻ giữa các slot.
- CAPTCHA bridge và lớp anti-detect phục vụ phiên automation do người dùng khởi tạo.
- Tạo ảnh/video, upload reference, polling, download media và lịch sử kết quả.
- AI Agent text qua các profile OpenAI-compatible do người dùng cấu hình; Google Flow vẫn là provider media riêng. Các provider voice/lip-sync local/tuỳ chọn giữ nguyên.
- Workspace/canvas lưu JSON và media trong Electron `userData`, không dùng team server.
- FFmpeg, ONNX, tách audio, chỉnh sửa video và các công cụ media local.

## Thành phần đã xóa

- License, activation, subscription và payment của phần mềm mẫu.
- Telemetry, auto-update và thông báo marketing từ xa.
- Community, marketplace, workflow cloud, team presence và collaboration server.
- Endpoint CMS/brand cũ và các trang UI tương ứng.

## Dữ liệu và bí mật

- `.env` không được commit.
- Không đặt mật khẩu Google, cookie, bearer token hoặc mã 2FA trong `.env`.
- Session Google được Electron lưu cục bộ trong partition tương ứng.
- API key của các custom AI provider profile, voice/lip-sync và Google Flow credits là tùy chọn, thuộc quyền sở hữu người dùng; key AI được lưu bằng mã hóa hệ điều hành.

## Source và build

- Source runtime: `apps/desktop/src`.
- Electron Main: `apps/desktop/src/electron/main.js`.
- Renderer React/TypeScript: `apps/desktop/src/renderer-source`.
- Vite build renderer source vào `dist`; Electron Main/config được sao chép nguyên trạng vào `dist-electron` và `config`.
- `.package-stage`, `release` và `release-*` là output tái tạo được, không phải source.

## Giới hạn kiểm chứng

Kiểm tra local có thể xác nhận cú pháp, nạp module khởi động, IPC workspace và nội dung package. Đăng nhập Google, CAPTCHA, provider trả phí và tiêu credit phải được người dùng kiểm tra bằng tài khoản của mình.
