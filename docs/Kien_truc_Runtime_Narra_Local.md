# Kiến trúc runtime Narra local

## Phạm vi

Narra Studio là ứng dụng Electron single-user. Renderer chính được build từ React/TypeScript source bằng Vite; Electron Main/Preload cung cấp IPC cho Google Flow, provider, media và lưu trữ local.

## Luồng giữ lại

- Google Flow qua `labs.google` và `aisandbox-pa.googleapis.com`.
- Nhiều tài khoản bằng Electron partition tách biệt; cookie không được chia sẻ giữa các slot.
- CAPTCHA bridge và lớp anti-detect phục vụ phiên automation do người dùng khởi tạo.
- Tạo ảnh/video, upload reference, polling, download media và lịch sử kết quả.
- AI Agent Text/Vision, TTS và lip-sync dùng custom provider profile mã hóa, được chọn theo capability/protocol; Google Flow vẫn là provider media riêng.
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
- API key của custom provider profile thuộc quyền sở hữu người dùng và được lưu bằng mã hóa hệ điều hành; `.env` không còn chứa credential provider.

## Source và build

- Source runtime: `apps/desktop/src`.
- Electron Main: `apps/desktop/src/electron/main.js`.
- Renderer React/TypeScript: `apps/desktop/src/renderer-source`.
- Vite build renderer source vào `dist`; Electron Main/config được sao chép nguyên trạng vào `dist-electron` và `config`.
- `.package-stage`, `release` và `release-*` là output tái tạo được, không phải source.

## Nguồn tham khảo bên ngoài

- Repository [flowkit](https://github.com/crisng95/flowkit) và tài liệu [flowkit/PLAN.md](https://github.com/crisng95/flowkit/blob/main/PLAN.md) chỉ là nguồn tham khảo để tìm ý tưởng và đối chiếu hướng triển khai; chúng không phải source of truth của Narra Studio.
- Không mặc định tin tưởng hoặc áp dụng nguyên trạng code, kiến trúc, endpoint, payload, khóa/model identifier, quy trình xác thực, CAPTCHA, header hay nhận định kỹ thuật từ các nguồn này.
- Trước khi sử dụng bất kỳ thông tin nào từ flowkit, phải kiểm tra độc lập với yêu cầu mới nhất của người dùng, tài liệu kiến trúc này, source thực tế trong `apps/desktop/src` và hành vi runtime đã được xác minh.
- Khi nguồn tham khảo mâu thuẫn với source of truth hoặc chưa thể kiểm chứng, không áp dụng vào Narra Studio; phải ghi rõ phần chưa xác minh và rủi ro liên quan.

## Giới hạn kiểm chứng

Kiểm tra local có thể xác nhận cú pháp, nạp module khởi động, IPC workspace và nội dung package. Đăng nhập Google, CAPTCHA, provider trả phí và tiêu credit phải được người dùng kiểm tra bằng tài khoản của mình.
