# Narra Studio

Narra Studio là ứng dụng Electron chạy local để tự động hóa tạo ảnh và video, trọng tâm là Google Flow. Desktop source hiện tại nằm hoàn toàn trong `apps/desktop/src`; kiến trúc React/TypeScript, Remotion và project pipeline thử nghiệm trước đây không còn thuộc runtime.

## Chức năng được giữ

- Google Flow: đăng nhập bằng cửa sổ trình duyệt, nhiều account slot, tạo ảnh/video, upload reference, theo dõi task và tải kết quả.
- CAPTCHA bridge, session isolation và lớp hỗ trợ anti-detect cần cho automation.
- AI Agent với các profile OpenAI-compatible do người dùng cấu hình, xử lý media, FFmpeg, ONNX và workspace/canvas local.
- Cấu hình nhạy cảm đọc từ `.env`; không lưu mật khẩu Google, cookie hoặc mã 2FA trong repository.

## Thành phần đã loại bỏ

- License, kích hoạt, gói thuê bao và thanh toán phần mềm.
- Telemetry, auto-update, community/marketplace và collaboration server.
- Source, fixture, Remotion runtime, skill và database của kiến trúc Narra thử nghiệm cũ.

## Lệnh phát triển

```powershell
pnpm typecheck
pnpm test
pnpm build
pnpm package:win
```

Sao chép `.env.example` thành `.env` chỉ khi cần tinh chỉnh local inference runtime. Credential provider được cấu hình trong Provider Account và lưu bằng mã hóa hệ điều hành. Xem [kiến trúc runtime Narra local](docs/Kien_truc_Runtime_Narra_Local.md) để biết ranh giới local/remote.
