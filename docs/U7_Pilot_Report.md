# Báo cáo U7 — Pilot và đóng gói

**Ngày kiểm tra:** 2026-08-10  
**Kết luận:** implementation/packaging đã hoàn thành; full live pilot 7–9 phút chưa hoàn thành.

## 1. Phạm vi đã hoàn thành

- Thêm tab System với diagnostics cho workspace, Codex App Server/model, Kokoro, Remotion và FFmpeg.
- Thêm backup project dạng folder copy có kiểm tra lại `project.json`, chặn đích nằm trong project và bỏ file render `.working.`.
- Thêm preload/IPC contract version 13 cho diagnostics và backup.
- Đóng gói Electron cho Windows dạng `win-unpacked` và portable.
- Bundle Electron Main và deploy Remotion production runtime bằng pnpm hoisted, không còn symlink ra `%TEMP%` hoặc repository máy build.
- Sửa local render worker để tiến trình con dùng `ELECTRON_RUN_AS_NODE=1` trong Electron packaged mode.

## 2. Project pilot hiện có

Project: `projects/the-physical-limits-of-ai-9e1bfa84`

| Thuộc tính | Giá trị |
|---|---|
| Tiêu đề | The AI Grid Queue: Who Gets Power First? |
| Target | 480 giây |
| Gate hiện tại | `THESIS_APPROVED` |
| Sources | 9 |
| Facts | 19 |
| Topic candidates | 3 |
| Thesis candidates | 3 |
| Claims | 20 |
| Script draft | khoảng 1.267 từ |
| Scenes / shots | 0 / 0 |
| Assets / narration / captions | 0 / 0 / 0 |
| Media và final MP4 | chưa có |

Project đã có research, thesis, outline, script draft và claim mapping. Creator chưa duyệt Script, chưa tạo Storyboard và chưa import media thật, vì vậy Narra không tự vượt gate để tạo một “pilot hoàn tất” giả.

## 3. Bằng chứng validation U7

| Hạng mục | Kết quả |
|---|---|
| Codex live smoke | PASS: signed in, `gpt-5.6-sol` available, turn completed |
| Remotion runtime staged | PASS: package 4.0.507 đồng bộ, CLI chạy được |
| Runtime portability | PASS: hoisted tree có 0 reparse point/symlink |
| Electron `win-unpacked` smoke | PASS: renderer `Narra Studio`, preload API 13, 1 project |
| System UI smoke | PASS: 5 diagnostic cards, backup action, không overflow |
| Portable artifact | Tạo thành công; khoảng 128 MB |
| Portable semantic smoke | PASS: marker desktop và System được làm mới lúc 19:00 ngày 2026-08-10 |
| Portable cold start | Khoảng 200 giây trên máy kiểm tra; dùng `win-unpacked` cho chạy hằng ngày |
| Voice render smoke | PASS: 90 frame, H.264 1920×1080 30fps, audio AAC |
| ffprobe voice render | PASS: video 3,00 giây; audio 3,050667 giây, 48 kHz stereo |
| Artifact validator ở gate hiện tại | PASS ở stage `script`: project, sources, facts, research packet, thesis, claims và script hợp lệ |
| Full repository quality gate | PASS: lint, typecheck, production build; 47 test pass và 1 optional render smoke skip |
| Flow manual smoke với output thật | PENDING creator |
| Final 7–9 phút và ffprobe final | PENDING creator |

## 4. Thời gian và thao tác theo stage

Các lượt U0–U6 trước đây chưa có event telemetry/timer theo stage. Vì vậy không thể suy ngược thời gian hay số click chính xác mà không bịa dữ liệu. Trong live pilot tiếp theo, creator cần ghi:

| Stage | Bắt đầu | Kết thúc | Thao tác creator | Retry | Ghi chú |
|---|---|---|---:|---:|---|
| Prompt / Discover |  |  |  |  |  |
| Topic approval |  |  |  |  |  |
| Research |  |  |  |  |  |
| Thesis approval |  |  |  |  |  |
| Script approval |  |  |  |  |  |
| Storyboard approval |  |  |  |  |  |
| Flow image/video |  |  |  |  |  |
| Asset approval |  |  |  |  |  |
| Voice/caption |  |  |  |  |  |
| Rough/final render |  |  |  |  |  |

## 5. Phần full pilot còn thiếu

Creator cần thực hiện trên giao diện Narra:

1. Review/sửa script và duyệt `SCRIPT_APPROVED`.
2. Sinh scene/shot plan, review và duyệt `STORYBOARD_APPROVED`.
3. Dùng Flow Assisted cho ít nhất một ảnh Nano Banana và một clip Veo thật; import, map đúng shot, ghi provenance và QA.
4. Tạo toàn bộ narration tiếng Anh bằng Kokoro local; nghe và duyệt từng segment.
5. Sửa lại tối thiểu một source/claim, một asset và một voice segment để kiểm tra stale scope/incremental render.
6. Hoàn tất caption/timeline, rough cut, rough approval, final render và final review.
7. Chạy ffprobe final MP4 và checklist provenance/license.
8. Điền thời gian/thao tác thực tế vào bảng trên.

U7 chỉ đạt exit criterion toàn phần khi creator hoàn thành video 7–9 phút và chỉ rời Narra cho thao tác generation/download trong Google Flow. Trạng thái hiện tại không đáp ứng điều kiện đó.
