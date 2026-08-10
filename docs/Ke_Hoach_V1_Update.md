# Kế hoạch cập nhật luồng Narra Studio V1

## 1. Mục tiêu

Tài liệu này điều chỉnh lộ trình sau các giai đoạn đã triển khai trong [Ke_Hoach_V1.md](Ke_Hoach_V1.md). Mục tiêu mới là biến Narra từ công cụ đọc/ghi artifact do Codex tạo ở cửa sổ khác thành một desktop tool có trải nghiệm vận hành thống nhất:

`Prompt trong Narra → Codex research → creator chọn topic/thesis/outline → script/storyboard → Google Flow Assisted → English TTS local → caption/timeline → Remotion preview/render`

Các quyết định khóa cho bản cập nhật:

- Gọi model qua `codex app-server` và đăng nhập bằng ChatGPT subscription; không dùng OpenAI API key.
- Mặc định yêu cầu `gpt-5.6-sol` với reasoning `medium`, nhưng luôn xác nhận khả năng thực tế bằng `model/list`.
- Không điều khiển ChatGPT Web.
- Dùng Google Flow theo phương án **Flow Assisted** để tận dụng Google AI Pro credits; không gọi Gemini API trong critical path.
- Video hướng tới khán giả quốc tế; narration mặc định là tiếng Anh.
- Kokoro là English TTS local mặc định; Chatterbox tùy chọn cho voice cloning/biểu cảm; Piper là fallback có kiểm tra license voice.
- Narration là master clock; Remotion chịu trách nhiệm caption, title, graphic và final composition.
- Giữ toàn bộ human gate: `TOPIC`, `THESIS`, `SCRIPT`, `STORYBOARD`, `ASSETS`, `ROUGH_CUT`, `FINAL`.

## 2. Phạm vi kế thừa

Không triển khai lại các năng lực đã có:

- Electron + React + TypeScript desktop shell.
- ProjectStore, SQLite state/index, filesystem artifact/media.
- Contract và provenance `source → fact → claim → scene → shot → asset`.
- Storyboard/asset manager, local media preview và QA.
- Narration segment, caption artifact và audio-master timeline.
- Approval workflow, render snapshot/version/log.
- Local job runner, retry/cancel/recovery.
- Remotion/FFmpeg render pipeline.
- Narra skill và validator artifact.

Các phần trên là nền tảng. Kế hoạch cập nhật chỉ thay đổi cách creator tương tác với AI, Flow và English voice.

## 3. Nguyên tắc triển khai

1. Mỗi thay đổi phải giữ khả năng mở project cũ.
2. Codex App Server chạy ở Electron Main Process; renderer không trực tiếp spawn process hoặc đọc credential.
3. Không đọc, copy hoặc quản lý token ChatGPT; App Server sở hữu luồng đăng nhập và refresh.
4. Mọi output AI phải đi qua schema validation trước khi ghi artifact nghiệp vụ.
5. Một project dùng một Codex thread ổn định; mỗi stage dùng một turn có input snapshot.
6. Creator nhìn thấy nguồn, tiến trình và approval request; không chạy AI như black box.
7. Flow Assisted luôn cần thao tác xác nhận generation/download của creator.
8. File vừa tải về chỉ là candidate; phải gán shot và qua asset QA.
9. Voice model là adapter thay thế được; không khóa ProjectStore hoặc UI vào một runtime Python cụ thể.
10. Không tự động vượt creative gate hoặc publish YouTube.

## 4. Các giai đoạn cập nhật

### U0 — Contract, migration và đặc tả giao diện AI

**Trạng thái:** Hoàn thành ngày 10/08/2026.

**Mục tiêu:** bổ sung hợp đồng dữ liệu trước khi nối model thật.

**Công việc:**

- Kiểm kê contract/project state hiện có và xác định migration tương thích ngược.
- Bổ sung cấu hình AI ở cấp project/workspace:
  - model mong muốn;
  - reasoning effort;
  - Codex thread ID;
  - trạng thái đăng nhập/kết nối chỉ lưu dưới dạng metadata không nhạy cảm;
  - stage/turn gần nhất.
- Đặc tả cấu trúc cho:
  - research run và search activity;
  - source card;
  - topic candidate;
  - thesis candidate;
  - outline section;
  - AI run status/error/usage snapshot.
- Định nghĩa output schema riêng cho `discover`, `research`, `thesis`, `outline`, `script` và `storyboard`.
- Thiết kế error state: Codex chưa cài, chưa đăng nhập, model không khả dụng, rate limit, network/tool failure, schema invalid và turn bị hủy.
- Giữ artifact cũ đọc được; không đổi ID đã duyệt.

**Validation:**

- Unit test schema hợp lệ và fixture sai có chủ đích.
- Migration/open-project test với project cũ.
- Typecheck, lint, test và build.

**Exit criterion:** contract mới validate được, project cũ mở được và chưa cần gọi Codex thật.

**Kết quả triển khai:**

- Thêm contract AI workspace cho project settings, run, search activity, source card, topic candidate, thesis candidate, outline section, usage snapshot và error state.
- Thêm output schema riêng cho `discover`, `research`, `thesis`, `outline`, `script` và `storyboard`.
- Thêm bảy artifact portable dưới `ai/`, `research/`, `thesis/` và `script/`; không lưu credential hoặc email tài khoản.
- Project cũ được tự bổ sung artifact U0 khi mở nếu file chưa từng được theo dõi; file đã bị xóa sau khi track không bị âm thầm tái tạo.
- Validation kiểm tra từng file, cùng project và quan hệ từ activity/source card/topic/thesis/outline đến AI run.
- Giữ nguyên `project.json` schema v1 và SQLite schema hiện tại vì U0 chưa cần thay đổi database; tránh migration không tạo giá trị.

**Bằng chứng validation:** typecheck contracts/project-store và toàn bộ 28 test pass; một render smoke test tùy chọn được skip theo thiết kế.

### U1 — CodexBridge proof of concept

**Trạng thái:** Hoàn thành ngày 10/08/2026.

**Mục tiêu:** chứng minh Narra gọi được Codex bằng ChatGPT subscription từ giao diện local.

**Công việc:**

- Tạo `CodexBridge` trong Electron Main Process.
- Spawn `codex app-server` bằng `stdio`; triển khai JSON-RPC request/response/notification correlation.
- Thực hiện handshake `initialize`/`initialized`.
- Dùng `account/read` để kiểm tra đăng nhập.
- Hỗ trợ browser login hoặc device-code login do App Server quản lý.
- Gọi `model/list`, hiển thị model và effort được hỗ trợ.
- Chọn `gpt-5.6-sol` + `medium` khi hợp lệ; nếu không, dừng và báo lựa chọn khả dụng.
- Tạo/resume thread theo project và gửi turn thử nghiệm.
- Stream agent message, web search, tool progress, completion và error qua IPC.
- Hỗ trợ stop/interrupt turn và đóng App Server sạch khi thoát ứng dụng.
- Hiển thị ChatGPT rate-limit snapshot nếu endpoint cung cấp.

**Không làm trong giai đoạn này:**

- Không ghi research artifact thật.
- Không điều khiển ChatGPT Web.
- Không tự lấy hoặc lưu credential.

**Validation:**

- Unit test JSON-RPC parser/correlation bằng fake process.
- Integration test bằng fake App Server cho login/model/thread/turn/error.
- Manual smoke với Codex thật: gửi một prompt, thấy stream và kết thúc turn trong Narra.
- Xác nhận không có API key trong config/log/artifact.

**Exit criterion:** từ Narra có thể đăng nhập ChatGPT, chọn model hợp lệ, gửi prompt và xem streaming response.

**Kết quả triển khai:**

- Thêm `CodexBridge` chạy trong Electron Main Process, giao tiếp JSONL/JSON-RPC với `codex app-server` và thực hiện handshake chuẩn.
- Hỗ trợ kiểm tra tài khoản, browser/device login, danh sách model/effort, rate limit, tạo/resume thread, start/interrupt turn và chuyển tiếp toàn bộ notification qua IPC.
- Khóa mặc định `gpt-5.6-sol` + `medium`; nếu model hoặc effort không có thì dừng với lỗi `MODEL_UNAVAILABLE`, không tự fallback.
- Lưu `threadId`, `lastTurnId` và trạng thái kết nối không nhạy cảm trong `ai/settings.json` theo từng project; không lưu email, token hay API key.
- Bổ sung cách khởi động tương thích App Execution Alias của Codex Desktop trên Windows và đóng child process khi Narra thoát.
- API preload tăng lên version 7; renderer chỉ gọi các thao tác Codex đã định nghĩa, không thể truyền command tùy ý để spawn process.

**Bằng chứng validation:** fake App Server test bao phủ handshake/login/model/thread/turn/stream/error/interrupt/rate-limit; toàn bộ 32 test pass, một render smoke tùy chọn được skip; lint, typecheck và build pass. Smoke với Codex CLI 0.147.0 thật xác nhận tài khoản đã đăng nhập, `gpt-5.6-sol` khả dụng và turn `medium` phát `turn/completed`.

### U2 — AI Workspace trong Narra

**Trạng thái:** Hoàn thành ngày 10/08/2026.

**Mục tiêu:** biến prompt và tiến trình AI thành trải nghiệm desktop đầy đủ.

**Công việc:**

- Tạo prompt composer trong Narra với audience, language, duration, format và style.
- Tạo model/effort selector dựa trên `model/list`; mặc định hiển thị Sol Medium khi có.
- Tạo run panel gồm trạng thái, elapsed time, stop/retry và lỗi có hướng xử lý.
- Hiển thị activity stream cho web search/tool progress ở mức người dùng có thể hiểu.
- Hiển thị source cards và link mở nguồn.
- Lưu prompt/run metadata không nhạy cảm để có thể truy vết và tiếp tục project.
- Hỗ trợ creator trả lời approval/request-user-input của Codex ngay trong Narra.
- Không hiển thị hoặc lưu raw reasoning nội bộ; chỉ dùng message/progress phù hợp cho UI.

**Validation:**

- Component test cho loading, streaming, error, cancel và retry.
- IPC test không cho renderer gọi process tùy ý.
- Electron smoke cho prompt → stream → completed.

**Exit criterion:** creator không phải mở Codex Desktop để nhập prompt và theo dõi research run.

**Kết quả triển khai:**

- Thêm tab `AI workspace` trực tiếp trong project với prompt composer gồm stage, yêu cầu, audience, language, duration, format và style.
- Kết nối account/model/rate-limit qua API preload giới hạn; model và effort lấy từ `model/list`, mặc định giữ `gpt-5.6-sol` + `medium` khi khả dụng.
- Thêm run panel với elapsed time, trạng thái, streaming agent message, stop, retry, lỗi có hướng xử lý và lịch sử run theo project.
- Hiển thị web search, tool progress và nguồn đã mở bằng activity/source card; link nguồn được mở qua Electron Main Process.
- Hỗ trợ browser/device-code login và server request cho approval hoặc `requestUserInput` ngay trong Narra.
- Lưu prompt, model/effort, stage, thread/turn, trạng thái và lỗi không nhạy cảm trong `ai/runs.json`; không lưu credential hoặc raw reasoning.
- Chặn reasoning event tại Electron Main trước khi chuyển sang renderer; phản hồi creator-facing được render an toàn, không dùng `dangerouslySetInnerHTML`.
- Preload API tăng lên version 8 và không cung cấp primitive spawn/process tùy ý cho renderer.

**Bằng chứng validation:** 38 test pass, một render smoke tùy chọn được skip; lint, typecheck và build pass. Electron smoke với Codex thật đã mở tab AI, xác nhận Plus connected, chạy prompt research qua `gpt-5.6-sol` + `medium`, nhận stream có web-search activity và kết thúc `Completed`. Ảnh smoke được kiểm tra trực quan ở theme sáng, trạng thái ready và bố cục desktop hai cột.

### U3 — Editorial workflow có cấu trúc

**Mục tiêu:** hoàn thành research, lựa chọn và viết nội dung trong Narra.

**Công việc:**

- Nối Narra skill qua App Server cho từng stage.
- `Discover/Research`:
  - lập câu hỏi nghiên cứu;
  - web search và source table;
  - fact/counterpoint/confidence;
  - evidence checklist.
- `Topic`:
  - topic grid có điểm và lý do;
  - creator chọn/sửa;
  - ghi `TOPIC_APPROVED` qua workflow hiện có.
- `Thesis`:
  - hiển thị 2–3 thesis candidate;
  - creator chọn/sửa;
  - giữ gate `THESIS`.
- `Outline`:
  - section/chapter, mục tiêu, claim, source và duration;
  - kéo thả, sửa trực tiếp và yêu cầu AI viết lại từng phần.
- `Script`:
  - sinh draft từ outline đã chọn;
  - source/claim side panel;
  - unsupported-claim và pacing QA;
  - giữ gate `SCRIPT`.
- `Storyboard`:
  - sinh scene/shot từ script đã duyệt;
  - validate trước khi ghi artifact;
  - giữ gate `STORYBOARD`.
- Khi upstream đổi sau approval, version artifact và đánh dấu downstream stale như workflow hiện có.

**Validation:**

- Chạy một topic thật qua toàn bộ `prompt → storyboard`.
- Validator Narra pass ở từng stage.
- Test từ chối output schema sai và không ghi đè artifact đã duyệt.
- Test approval/revoke và stale propagation.

**Exit criterion:** toàn bộ công việc research, topic, thesis, outline, script và storyboard được thực hiện/duyệt trong Narra.

#### Kết quả triển khai U3

**Trạng thái implementation:** hoàn thành. **Trạng thái full live pilot:** chờ creator đi qua các gate Topic → Thesis → Script; ứng dụng không tự duyệt thay creator.

- CodexBridge gọi `skills/list`, tìm repo-scoped skill `narra`, gửi cả `$narra` và skill input chính thức vào `turn/start`.
- Mỗi stage dùng `outputSchema` sinh từ Zod. Các field artifact tùy chọn được biểu diễn nullable ở ranh giới Structured Outputs, bỏ `null` trước local validation để không ép model bịa metadata chưa biết.
- Electron Main chỉ nhận JSON trong sandbox read-only; ProjectStore kiểm tra stage/run/project owner, schema và provenance trước khi ghi artifact. Output sai không làm thay đổi file hiện có.
- Discover/Research ghi topic candidate, source/fact/source card, research packet và evidence checklist. Topic grid cho sửa/chọn riêng với thao tác approve riêng.
- Thesis hiển thị 2–3 candidate và chỉ ghi `thesis.json` sau khi creator chọn. Outline cho sửa trực tiếp, kéo-thả, nút lên/xuống và rewrite từng section. Script hiển thị claim/source mapping, unsupported claim và pacing QA. Storyboard chỉ ghi scene/shot sau validation.
- AI không thể thay artifact của gate đang `APPROVED`; creator phải revoke có chủ đích. Mọi write upstream revoke chuỗi approval và đánh dấu media scope downstream stale.
- Preload API tăng lên version 9; renderer không nhận primitive process/file tùy ý.

**Bằng chứng validation:** 40 test pass, một render smoke tùy chọn được skip; lint, typecheck và build pass. Fake App Server test xác nhận `skills/list`, skill input và `outputSchema`. App Server thật trên Codex CLI 0.147.0 tìm thấy 26 skill và đúng skill `narra`; một Discover thật bằng `gpt-5.6-sol` + `medium` hoàn tất trong khoảng 92 giây, trả 3 candidate, ghi artifact và project validator báo `VALID`. Electron semantic smoke xác nhận 6 tab editorial, 3 topic card, đúng 1 topic selected và không tràn ngang. `capturePage()` của môi trường trả `UnknownVizError`, nên chưa có ảnh smoke mới; lỗi này không ảnh hưởng startup/IPC/DOM smoke.

### U4 — Google Flow Assisted

**Mục tiêu:** tận dụng Google AI Pro mà không phụ thuộc Gemini API hoặc browser automation dễ vỡ.

**Công việc:**

- Tạo provider `FlowAssistedProvider` theo interface media provider.
- Với mỗi shot, sinh:
  - image prompt cho Nano Banana;
  - video prompt cho Veo 3.1;
  - aspect ratio, duration, reference ingredients và negative guidance;
  - tên file/shot token đề xuất để dễ gán.
- UI asset card có `Copy prompt`, `Mở Flow`, `Đánh dấu đang tạo`, `Import kết quả` và `Tạo lại prompt`.
- Mở Google Flow bằng browser hệ thống; không nhúng credential và không tự click generation.
- Cho creator cấu hình một thư mục import/download; watcher chỉ đề xuất file mới, không tự duyệt.
- Hiển thị preview và dialog gán candidate vào shot.
- Copy file đã xác nhận vào project; lưu provider, model do creator chọn, prompt, thời điểm, source path và technical metadata.
- Hỗ trợ nhiều candidate/version, select/reject/regenerate và asset QA.
- Giữ import file picker/drag-drop hiện có làm fallback.

**Validation:**

- Unit test watcher/dedup và mapping file → candidate.
- Test không tự gán/QA_PASS khi chưa có xác nhận.
- Test ảnh/video import, probe, thumbnail và stale propagation.
- Manual smoke: copy prompt → mở Flow → download → Narra phát hiện → gán shot → QA_PASS.

**Exit criterion:** creator dùng credit Google AI Pro trong Flow và đưa output trở lại đúng shot mà không nhập đường dẫn hoặc sửa manifest thủ công.

#### Kết quả triển khai U4

**Trạng thái implementation:** hoàn thành. **Trạng thái live Flow smoke:** chờ creator tự xác nhận generation/download trong Google Flow để tránh tự tiêu credit hoặc điều khiển tài khoản ngoài ý muốn.

- Thêm `FlowAssistedProvider` sinh prompt package có version cho từng shot: image prompt, video prompt, negative guidance, aspect ratio, thời lượng Flow hỗ trợ, model mặc định và shot token.
- Model mặc định hiện tại là `Nano Banana 2` cho ảnh và `Veo 3.1 Lite` cho video. Thời lượng generation được ánh xạ về `4/6/8 giây`, là các lựa chọn được Google Flow Help công bố; Narra không hard-code giá credit.
- Asset workspace có thao tác chuẩn bị/tạo lại prompt, copy prompt, mở Google Flow, đánh dấu đang tạo, chọn thư mục download và quét thủ công. File picker/drag-drop cũ vẫn là fallback.
- Watcher polling chỉ phát hiện ảnh/video mới trong thư mục creator chọn. File được deduplicate bằng SHA-256; đường dẫn và kích thước được kiểm tra trước để không băm lại video không đổi ở mỗi vòng quét.
- Tên file chứa `shotToken` hoặc `shotId` được đề xuất về đúng shot. Candidate chưa khớp vẫn xuất hiện để creator tự map; hệ thống không tự import, tự chọn hoặc tự QA.
- Dialog xác nhận hiển thị preview và asset đích. Chỉ sau xác nhận, Narra mới copy media vào project, probe technical metadata và lưu provenance gồm provider, model, prompt version, prompt, tên file nguồn và thời điểm import.
- Asset sau import dừng ở `SELECTED`; creator vẫn phải review rồi chuyển `QA_PASS`. Reject candidate không xóa file gốc trong thư mục download.
- Thông tin máy cục bộ như watch directory và source path nằm trong SQLite workspace; manifest portable chỉ giữ provenance cần thiết, không phụ thuộc đường dẫn máy nguồn.
- Preload API tăng lên version 10; renderer không nhận quyền filesystem tùy ý và chỉ dùng IPC theo nghiệp vụ Flow.

**Bằng chứng validation:** `pnpm validate` pass gồm lint, typecheck, 42 test pass, 1 render smoke tùy chọn skip và production build pass. Test U4 xác nhận prompt/provenance contract, gate `STORYBOARD`, watcher/dedup, shot mapping, explicit confirmation, import/probe, trạng thái `SELECTED` và không tự `QA_PASS`. Electron startup smoke pass với renderer `Narra Studio`, preload API version 10 và ProjectStore phản hồi bình thường. Semantic Flow UI smoke trên project seed xác nhận panel Flow, đúng 2 prompt card, 1 candidate, watch folder và không tràn ngang. `capturePage()` của môi trường vẫn trả `UnknownVizError` như U3 nên chưa có ảnh smoke; semantic DOM smoke và startup/IPC không bị ảnh hưởng.

**Phần cần creator kiểm thử thủ công:** dùng một shot thật để copy prompt → mở Flow → tự chọn model/generate/download → Narra phát hiện → xác nhận gán → review và QA_PASS. Bước này cố ý không tự chạy trong validation vì có thể tiêu Google AI credits và cần quyết định sáng tạo của creator.

### U5 — English Voice Studio local

**Mục tiêu:** thay ElevenLabs bằng narration tiếng Anh local có thể nghe thử và sửa theo segment.

**Công việc:**

- Tạo interface `VoiceProvider` độc lập với UI/ProjectStore.
- Tích hợp Kokoro làm provider mặc định:
  - preset voice;
  - speed/style có kiểm soát;
  - generate/preview/save theo segment;
  - ghi model/version/config vào artifact.
- Đánh giá Chatterbox adapter tùy chọn cho voice cloning và biểu cảm.
- Đánh giá Piper làm CPU fallback; lập danh sách voice được phép phân phối/sử dụng.
- Thêm English text normalization và pronunciation dictionary cho tên riêng, chữ viết tắt, số và đơn vị.
- Generate/re-generate từng segment, không làm lại toàn script.
- Chuẩn hóa output về WAV phù hợp render pipeline; FFmpeg normalize loudness ở bước có kiểm soát.
- Tích hợp faster-whisper local cho transcript QA/word timestamps khi cần.
- Hiển thị waveform/player, planned/actual duration, mismatch và pronunciation note.

**Validation:**

- Benchmark tối thiểu một voice trên CPU của máy mục tiêu.
- Nghe kiểm tra một bộ câu tiếng Anh gồm tên riêng, số, acronym và câu dài.
- Test thay một segment không đổi audio version của segment khác.
- Test word timestamp/caption alignment và render voice smoke.
- Ghi rõ license của code và từng model/voice được đóng gói.

**Exit criterion:** Narra tạo được narration tiếng Anh local cho toàn project, creator nghe duyệt/sửa từng segment và timeline cập nhật đúng.

#### Kết quả triển khai U5

**Trạng thái implementation:** hoàn thành. **Trạng thái full-project listening pilot:** chờ creator nghe và duyệt narration của một documentary thật; ứng dụng không tự quyết định chất lượng giọng thay creator.

- Thêm interface `VoiceProvider` độc lập và `KokoroOnnxProvider` mặc định. Provider chạy worker Python riêng, không đưa Python/ONNX vào Electron renderer và không gọi API TTS.
- Thêm script setup idempotent tạo `.runtime/voice/.venv`, pin `kokoro-onnx==0.5.0` và `soundfile==0.13.1`, tải Kokoro v1.0 cùng voice pack từ GitHub release chính thức. `.runtime/` được gitignore.
- Bổ sung bốn preset English có kiểm soát: documentary neutral/warm US, documentary male US và documentary neutral UK; speed bị giới hạn `0.8–1.2`.
- English normalization xử lý typography, phần trăm, một số đơn vị và initialism phổ biến. Pronunciation dictionary dùng cú pháp `term=spoken form`, lưu theo segment và áp dụng trước synthesis.
- Generate/re-generate hoạt động từng segment; batch `Generate missing` chỉ tạo segment chưa có audio. Audio version của segment khác không thay đổi.
- Output Kokoro được FFmpeg chuẩn hóa thành WAV PCM 16-bit, 48 kHz, stereo, target −16 LUFS trước khi import. Artifact lưu provider, model/version, voice, language, preset, speed, normalized text, dictionary, format và generation time.
- Voice Studio hiển thị runtime diagnostic/license, preset, speed, pronunciation field, generation feedback, waveform thật từ audio, player, planned/actual duration, metadata, provenance, transcript QA và timeline mismatch. Import audio thủ công vẫn là fallback.
- SRT, WebVTT và word timestamp JSON tiếp tục được hỗ trợ cho transcript QA/caption alignment. `faster-whisper` được giữ là adapter STT tùy chọn; U5 không tự tải thêm model STT lớn khi chưa có nhu cầu cấu hình cụ thể.
- Chatterbox không được bật mặc định vì runtime/model nặng hơn và voice cloning cần consent. Piper không được bundle vì engine hiện hành GPL-3.0 và từng voice có license riêng cần duyệt. Chi tiết nằm trong `docs/Voice_Runtime_Licenses.md`.
- Preload API tăng lên version 11; renderer chỉ gọi IPC nghiệp vụ và không nhận quyền chạy process hoặc đọc filesystem tùy ý.

**Benchmark local:** trên máy hiện tại, một câu thử English dài có tên riêng, năm, phần trăm, initialism và đơn vị tạo thành audio `13,93 giây` trong khoảng `16,9 giây` bằng CPU. File probe được xác nhận là WAVE/PCM 16-bit, `48.000 Hz`, stereo; pronunciation/provenance được lưu trong segment artifact. Benchmark là một lần đo tham khảo, không phải cam kết hiệu năng cho mọi CPU hoặc độ dài câu.

**Bằng chứng validation ở vòng triển khai:** `pnpm validate` pass gồm lint, typecheck, 44 test pass, 1 render smoke tùy chọn skip và production build. Test provider giả xác nhận normalization, gate `STORYBOARD`, generate/regenerate riêng lẻ, batch chỉ tạo phần thiếu và giữ version segment không liên quan. Word timestamp/caption alignment và timeline retiming tiếp tục được test trong suite hiện có. Narra artifact validator báo `VALID` cho project benchmark ở stage `voice`. Electron semantic smoke xác nhận API version 11, runtime ready, generation controls, waveform, provenance và không tràn ngang. Electron generation smoke thực sự bấm `Regenerate segment` và đi qua renderer → preload/IPC → Kokoro → FFmpeg → ProjectStore thành công, tăng đúng `Audio version 1` lên `Audio version 2`. Creator vẫn cần nghe benchmark và một project thật để đánh giá giọng, tên riêng, pacing và quyết định preset cuối.

### U6 — Timeline, caption và asset integration

**Mục tiêu:** ghép output Flow và English narration thành rough cut ổn định.

**Công việc:**

- Dùng narration audio làm master clock.
- Fit scene/shot duration theo segment và cảnh báo coverage thiếu/thừa.
- Sinh caption từ script/timestamps; hỗ trợ chỉnh cue trong UI.
- Render title, lower-third, quotation, chart/map và caption bằng Remotion.
- Không dựa vào Veo để tạo text cần đọc chính xác trong hình.
- Hỗ trợ audio layer gồm narration, Veo native audio nếu được chọn, music và SFX.
- Thêm ducking rule để narration luôn rõ; cho phép mute audio gốc của video theo shot.
- Tạo render preflight kiểm tra asset QA, audio, caption, source và license note.

**Validation:**

- Render smoke có ảnh Nano Banana import, video Veo import, English TTS và caption.
- ffprobe xác nhận preset output.
- Visual QA caption/title safe area.
- Audio QA cho clipping, silence và narration/music balance.

**Exit criterion:** rough cut có media, narration và text đồng bộ; thay một asset hoặc voice segment chỉ làm stale/re-render phạm vi liên quan.

**Trạng thái implementation:** hoàn thành. **Trạng thái live Flow media pilot:** chờ creator import một ảnh Nano Banana và một clip Veo thật từ Flow; validation tự động hiện dùng fixture image/video do repository tạo nên không được trình bày như output thật của Google Flow. Tab `Timeline` dùng narration đã import làm master clock, hiển thị scene/caption track, tạo cue xác định từ nội dung và thời lượng narration, cho sửa trực tiếp text/start/end của từng cue, và chỉ đánh dấu scope `RENDER` stale khi chỉnh timeline. Video source audio mặc định `MUTE`; creator có thể chọn `DUCK` hoặc `KEEP` và mức âm theo từng shot. Music/SFX được import local trên giao diện, lưu vào asset manifest với role, metadata, rights note và mức âm; music có ducking cap khi narration hiện diện.

Render preflight chặn rough/final render khi thiếu narration, caption, file media, asset QA hoặc timeline không khớp; cảnh báo caption quá dày/chồng lấn và audio layer thiếu role. Remotion dùng narration làm master duration, render caption trong safe area và mix narration, native video audio, music/SFX theo artifact đã khóa trong snapshot. Preload API hiện là version 13.

**Bằng chứng validation ở vòng triển khai:** `pnpm validate` pass gồm lint, typecheck, 46 test pass, 1 render smoke tùy chọn skip và production build. Remotion preflight pass; render smoke thật tạo H.264 `1920×1080`, `30fps`, dài `3,05 giây`, có AAC `48kHz` stereo. PCM giải mã có peak `−3,59 dBFS`, RMS `−22,77 dBFS`, không clipping. Still frame được kiểm tra trực quan cho title/caption safe area. Electron semantic smoke trên project benchmark thực sự bấm `Generate cues`, tạo 4 cue qua renderer → preload/IPC → ProjectStore, xác nhận Timeline/preflight/shot-audio controls xuất hiện và không tràn ngang.

### U7 — Pilot và đóng gói bản cập nhật

**Mục tiêu:** chứng minh luồng mới trên một documentary tiếng Anh hoàn chỉnh.

**Công việc:**

- Chạy một project 7–9 phút từ prompt trong Narra.
- Ghi nhận thời gian và số thao tác ở từng stage.
- Sử dụng ít nhất một ảnh Nano Banana và một video Veo qua Flow Assisted.
- Tạo toàn bộ narration bằng English TTS local.
- Sửa lại tối thiểu một source/claim, một asset và một voice segment để kiểm tra incremental workflow.
- Render rough cut, final review và final MP4.
- Bổ sung diagnostics cho Codex CLI/App Server, voice runtime, FFmpeg và Remotion.
- Cập nhật hướng dẫn setup/backup/troubleshooting; không ghi credential vào tài liệu hoặc log.

**Validation:**

- Tất cả artifact validator, lint, typecheck, test và build pass.
- Electron smoke trên bản đóng gói.
- Codex login/model/turn smoke.
- Flow Assisted manual smoke.
- Voice benchmark và render smoke.
- ffprobe final output và checklist provenance/license.

**Exit criterion:** creator hoàn thành video tiếng Anh 7–9 phút từ prompt đến final export trong workflow Narra, chỉ rời Narra để xác nhận generation/download trong Google Flow.

**Trạng thái implementation/packaging:** hoàn thành. Narra có System diagnostics, backup project đã xác minh, Windows `win-unpacked` và portable package dùng Remotion runtime hoisted không symlink. Codex live smoke, Electron packaged smoke, System UI smoke, Remotion voice render và ffprobe đều pass. Chi tiết setup và kết quả nằm ở `docs/Setup_Backup_Troubleshooting.md` và `docs/U7_Pilot_Report.md`.

**Trạng thái full live pilot:** chưa hoàn thành. Project 480 giây hiện dừng tại `THESIS_APPROVED`; chưa có storyboard, Flow media thật, narration đầy đủ, caption, rough/final MP4 hoặc số liệu thời gian/thao tác theo stage. Không tự duyệt gate hoặc dùng fixture để trình bày như Nano Banana/Veo output thật.

## 5. Dependency và thứ tự

```text
Nền tảng hiện có P0–P8
        ↓
U0 Contract/Migration
        ↓
U1 CodexBridge
        ↓
U2 AI Workspace
        ↓
U3 Editorial Workflow
        ├─────────────┐
        ↓             ↓
U4 Flow Assisted   U5 English Voice
        └──────┬──────┘
               ↓
U6 Timeline/Caption Integration
               ↓
U7 Pilot/Packaging
```

U4 và U5 có thể triển khai song song sau khi contract tương ứng ở U0 ổn định. U6 chỉ bắt đầu khi đã có ít nhất một asset Flow import và một narration segment local được QA.

## 6. Quality gate xuyên suốt

| Gate | Bằng chứng tối thiểu |
|---|---|
| Codex protocol | Fake-server tests và một real smoke qua App Server |
| Authentication | ChatGPT login do App Server quản lý; không có credential trong repo/log |
| Model selection | `model/list` xác nhận model/effort trước turn |
| Structured output | Output schema pass; invalid response không ghi artifact |
| Research | Source URL mở được, claim quan trọng có provenance |
| Human approval | Không stage nào tự vượt gate |
| Flow Assisted | Creator xác nhận generation, import, mapping và QA |
| Voice | Local generation, license record, segment replacement test |
| Timeline | Audio master, caption alignment và incremental stale test |
| Render | Remotion smoke và ffprobe output |
| Compatibility | Project cũ mở được sau migration |
| Desktop | Lint, typecheck, tests, build và Electron smoke |

## 7. Rủi ro và cách xử lý

| Rủi ro | Cách xử lý |
|---|---|
| Codex App Server thay đổi schema theo phiên bản | Generate/pin schema theo CLI đang cài; bọc giao thức sau `CodexBridge` |
| Model Sol/Medium tạm không khả dụng | Kiểm tra `model/list`, báo rõ và yêu cầu creator chọn; không fallback ngầm |
| ChatGPT rate limit | Hiển thị usage/rate-limit state, cho resume/retry sau |
| AI output không đúng contract | `outputSchema` + Zod validation + retry có feedback; không ghi artifact lỗi |
| Flow thay đổi giao diện | Chỉ mở browser/copy prompt/import file; không phụ thuộc DOM |
| File download gán nhầm shot | Dùng candidate dialog, shot token và xác nhận thủ công |
| Voice local không tự nhiên | Cho nghe A/B preset, pronunciation dictionary và Chatterbox adapter tùy chọn |
| License voice/model không rõ | Không bundle/use cho pilot kiếm tiền cho đến khi license được ghi nhận |
| TTS/STT runtime nặng | Tách provider process, preflight và cache model local; Kokoro là mặc định nhẹ |

## 8. Ngoài phạm vi bản cập nhật

- OpenAI API key hoặc Gemini API billing trong critical path.
- Tự động điều khiển ChatGPT Web.
- Browser automation tự click Google Flow.
- Tự động mua hoặc tiêu credit mà không có thao tác của creator.
- Voice tiếng Việt.
- n8n, cloud backend, multi-user và render farm.
- Tự động publish YouTube.

## 9. Nguồn kỹ thuật chính

- [OpenAI Codex App Server](https://developers.openai.com/codex/app-server)
- [OpenAI Codex authentication](https://developers.openai.com/codex/auth)
- [Google Flow models and supported features](https://support.google.com/flow/answer/16352836?hl=en)
- [Create images in Google Flow](https://support.google.com/flow/answer/16729550?hl=en)
- [Create videos in Google Flow](https://support.google.com/flow/answer/16353334?hl=en)
- [Manage and download Flow media](https://support.google.com/flow/answer/16935308?co=GENIE.Platform%3DDesktop&hl=en)
- [Google Flow credits](https://support.google.com/flow/answer/16526234?hl=en)
- [Gemini API billing](https://ai.google.dev/gemini-api/docs/billing)
- [Kokoro](https://github.com/hexgrad/kokoro)
- [Chatterbox](https://github.com/resemble-ai/chatterbox)
- [Piper](https://github.com/OHF-voice/piper1-gpl)
- [faster-whisper](https://github.com/SYSTRAN/faster-whisper)
- [Remotion documentation](https://www.remotion.dev/docs/)
- [FFmpeg documentation](https://ffmpeg.org/documentation.html)
