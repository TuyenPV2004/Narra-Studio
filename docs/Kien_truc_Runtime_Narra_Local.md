# Kiến trúc runtime Narra local

## Phạm vi

Narra Studio là ứng dụng Electron single-user. Renderer chính được build từ React/TypeScript source bằng Vite; Electron Main/Preload cung cấp IPC cho Google Flow, provider, media và lưu trữ local.

## Luồng giữ lại

- Google Flow qua `labs.google` và `aisandbox-pa.googleapis.com`.
- Nhiều tài khoản bằng Electron partition tách biệt; cookie không được chia sẻ giữa các slot.
- CAPTCHA bridge và lớp anti-detect phục vụ phiên automation do người dùng khởi tạo.
- Tạo ảnh/video, upload reference, polling, download media và lịch sử kết quả.
- Trang Giọng nói dùng XTTS-v2 chạy trong Python runtime local; WAV được lưu tại thư mục Voice chọn trong Cài đặt, mặc định là `Music/Narra Studio/Voice`. Luồng này không dùng Google Flow, account slot hoặc credit.
- AI Agent Text/Vision, TTS và lip-sync dùng custom provider profile mã hóa, được chọn theo capability/protocol; các luồng này độc lập với trang Giọng nói. Google Flow vẫn là provider ảnh/video riêng.
- Workspace/canvas lưu JSON và media trong Electron `userData`, không dùng team server.
- FFmpeg, ONNX, tách audio, chỉnh sửa video và các công cụ media local.

## Runtime XTTS-v2

- Electron Main dùng Python tương thích (3.10 đến 3.14) để tạo môi trường riêng tại `userData/xtts-v2` khi người dùng chủ động yêu cầu.
- Renderer chỉ gửi contract typed qua preload; không nhận đường dẫn tùy ý. Giọng mẫu được chọn bằng dialog, kiểm tra signature/dung lượng rồi sao chép vào thư viện local do Narra sở hữu.
- Tác vụ chạy trong subprocess không dùng shell, có thể hủy thật bằng cách kết thúc process và giữ trạng thái queue ở cấp ứng dụng khi chuyển trang.
- Model là `tts_models/multilingual/multi-dataset/xtts_v2` từ Coqui TTS. Danh sách speaker dựng sẵn và ngôn ngữ được đọc từ checkpoint sau khi tải.
- Worker dùng nguyên cơ chế thiết bị của model: toàn bộ model chuyển sang CUDA khi `torch.cuda.is_available()` trả về `true`, nếu không toàn bộ model chạy trên CPU; Narra không chia model hoặc offload giữa GPU và CPU. Worker tự giải phóng sau thời gian rảnh để không giữ VRAM.
- Văn bản dài được Narra chia thành các đoạn ổn định để checkpoint và tiếp tục sau gián đoạn; mỗi đoạn gọi XTTS-v2 với `split_sentences=False`, sau đó các WAV cùng định dạng được nối theo đúng thứ tự. Chế độ clone chỉ nhận file audio đã được nhập vào thư viện local của Narra.
- Máy không có CUDA vẫn dùng profile CPU. UI phải hiển thị profile thực tế; không được âm thầm báo hybrid khi PyTorch chỉ là bản CPU.

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
- Renderer React/TypeScript: `apps/desktop/src/ui`.
- Vite build renderer source vào `dist`; Electron Main/config được sao chép nguyên trạng vào `dist-electron` và `config`.
- `.package-stage`, `release` và `release-*` là output tái tạo được, không phải source.

## Nguồn tham khảo bên ngoài

- Khi review, audit hoặc đề xuất hướng triển khai cho Google Flow, CAPTCHA, extension, session,
  tạo ảnh/video hay kiến trúc liên quan, luôn đối chiếu với phiên bản hiện tại của repository
  [flowkit](https://github.com/crisng95/flowkit). Bắt đầu từ
  [flowkit/PLAN.md](https://github.com/crisng95/flowkit/blob/main/PLAN.md), sau đó kiểm tra source và tài liệu
  liên quan trong repository để tránh dựa riêng vào kế hoạch.
- Mục đích của việc đối chiếu là tìm bằng chứng, phương án thay thế, khoảng trống và trade-off để đưa ra hướng
  review cùng đề xuất tốt nhất cho Narra Studio. Kết quả phải phân biệt rõ điểm tương đồng, khác biệt, phần có thể
  áp dụng, phần không nên áp dụng và lý do.
- Flowkit là nguồn tham khảo bắt buộc cho quá trình đối chiếu, không phải source of truth của Narra Studio.
  Không mặc định tin tưởng, sao chép hoặc áp dụng nguyên trạng code, kiến trúc, endpoint, payload, header,
  khóa/model identifier, quy trình xác thực, CAPTCHA hay nhận định kỹ thuật từ nguồn này.
- Mọi thông tin lấy từ flowkit phải được kiểm tra độc lập với yêu cầu mới nhất của người dùng, tài liệu kiến trúc
  này, source thực tế trong `apps/desktop/src` và hành vi runtime đã được xác minh. Khi có mâu thuẫn, source of
  truth của Narra Studio được ưu tiên; báo cáo phải ghi rõ khác biệt, phần chưa xác minh và rủi ro liên quan.
- Nếu không thể truy cập flowkit, phải nêu rõ giới hạn, tiếp tục bằng bằng chứng local tốt nhất hiện có và không
  tuyên bố một đề xuất là “tốt nhất” khi chưa hoàn tất phần đối chiếu bắt buộc.

## Giới hạn kiểm chứng

Kiểm tra local có thể xác nhận cú pháp, nạp module khởi động, IPC workspace và nội dung package. Đăng nhập Google, CAPTCHA, provider trả phí và tiêu credit phải được người dùng kiểm tra bằng tài khoản của mình.
