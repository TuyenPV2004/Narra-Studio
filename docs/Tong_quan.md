# Tổng quan Narra Studio V1

## 1. Trạng thái của tài liệu

Tài liệu này là bản tổng hợp quyết định hiện hành của Narra Studio sau khi rà soát và điều chỉnh từ [Narra_Studio_Blueprint_V1.md](Narra_Studio_Blueprint_V1.md). Khi hai tài liệu khác nhau, `Tong_quan.md` là định hướng được ưu tiên cho V1; Blueprint gốc được giữ lại làm tài liệu khám phá và tham chiếu lịch sử. Các bước nâng cấp từ implementation hiện tại sang luồng mới được quản lý trong [Ke_Hoach_V1_Update.md](Ke_Hoach_V1_Update.md); [Ke_Hoach_V1.md](Ke_Hoach_V1.md) tiếp tục ghi nhận lịch sử các giai đoạn nền tảng đã hoàn thành.

Narra Studio có tagline **From question to documentary.** Đây là công cụ desktop chạy local dành cho một creator/editor, hỗ trợ sản xuất video YouTube tiếng Anh dạng faceless cinematic explainer hoặc mini-documentary. Narra không phải website, SaaS, hệ thống multi-tenant hay dây chuyền tự động xuất bản hàng loạt.

## 2. Các quyết định đã thống nhất

### 2.1 Công cụ local thay cho web application

V1 được triển khai như một desktop application:

- UI chạy local, ưu tiên Electron + React + TypeScript.
- Dữ liệu có cấu trúc lưu bằng SQLite hoặc JSON có schema.
- Media và artifact dung lượng lớn lưu trực tiếp trong thư mục project.
- Giao tiếp giữa UI và tiến trình local dùng Electron IPC hoặc lời gọi module nội bộ; không cần xây REST API chỉ để các thành phần trên cùng máy nói chuyện với nhau.
- Remotion và FFmpeg chạy local để preview, probe, transcode và render.
- Không đưa Supabase, backend server, cloud storage, auth, HTTPS, multi-user hoặc hạ tầng production vào V1 khi chưa có nhu cầu thực tế.

Khi chạy từ repository, workspace local được tách thành `projects/` cho artifact/media và `database/workspace.sqlite` cho index/state; cả hai đều được Git ignore. Có thể cấu hình lại bằng `NARRA_STORAGE_ROOT`, `NARRA_WORKSPACE_ROOT` và `NARRA_DATABASE_ROOT`. Bản cài đặt nằm ngoài repository dùng Electron `userData` làm fallback để không phụ thuộc Documents hoặc OneDrive.

### 2.2 Codex App Server là lớp AI operator tích hợp

Các bước cần OpenAI model được thực hiện từ chính giao diện Narra thông qua `codex app-server`, đăng nhập bằng tài khoản ChatGPT hiện có:

- Model mặc định: **GPT-5.6 Sol**.
- Reasoning mặc định: **Medium**.
- Có thể chuyển sang High hoặc xHigh cho research khó, kiểm tra xung đột nguồn hoặc lỗi render phức tạp.
- Không gọi OpenAI API theo cơ chế API key và không lưu OpenAI API key.
- Việc sử dụng chịu hạn mức của tài khoản ChatGPT/Codex; không được coi là tài nguyên vô hạn.

Electron Main Process khởi chạy `codex app-server` như tiến trình con và giao tiếp bằng JSON-RPC qua `stdio`. Narra kiểm tra trạng thái đăng nhập, lấy danh sách model/effort thực tế bằng `model/list`, tạo hoặc tiếp tục một Codex thread cho từng project, gửi prompt bằng `turn/start` và stream agent message, web search, tool progress, approval request cùng lỗi về UI. Kết quả có cấu trúc được ràng buộc bằng `outputSchema`, validate rồi mới ghi thành artifact Markdown/JSON.

Narra không lấy cookie, token hoặc điều khiển DOM của ChatGPT Web. Nếu `gpt-5.6-sol` hoặc `medium` không có trong catalog của tài khoản tại thời điểm chạy, UI phải báo rõ và yêu cầu creator chọn một cấu hình được hỗ trợ; không âm thầm đổi model.

### 2.3 Skill điều khiển workflow bên trong Narra

Quy trình lặp lại tiếp tục được đóng gói thành Codex skill Narra, nhưng creator không phải chuyển sang cửa sổ Codex để gọi skill. Narra gửi skill input cùng prompt, project path, stage và output schema qua App Server. Lệnh `$narra` trong Codex Desktop vẫn được giữ như đường vận hành và chẩn đoán dự phòng.

Danh mục skill, input, output và nhiệm vụ được mô tả trong [SKILL.md](SKILL.md).

### 2.4 Không dùng n8n trong V1

n8n không cần thiết cho kiến trúc hiện tại vì:

- Chỉ có một người dùng và mọi thứ chạy trên một máy.
- Các bước AI đã được điều phối bởi Codex skill.
- Các bước media có thể chạy bằng local job runner đơn giản.
- Workflow có nhiều creative gate cần con người duyệt, không phải chuỗi webhook/service cần orchestration server.
- Đưa n8n vào sớm tạo thêm runtime, cấu hình, trạng thái và điểm lỗi mà chưa đem lại giá trị tương xứng.

V1 dùng một local job queue có trạng thái như `QUEUED`, `RUNNING`, `COMPLETED`, `RETRYABLE_FAILED`, `TERMINAL_FAILED`, kèm input snapshot và log. Chỉ đánh giá lại n8n khi xuất hiện nhu cầu chạy lịch nền, nhiều máy render, nhiều provider bất đồng bộ, webhook phức tạp hoặc workflow cần người không viết code tự chỉnh sửa.

### 2.5 Vai trò của Remotion plugin

Plugin Remotion đã cài trong Codex được dùng như lớp hướng dẫn chuyên môn để Codex:

- Tạo và chỉnh sửa composition, scene, caption và animation.
- Đồng bộ narration với timeline.
- Kiểm tra cách dùng media trong Remotion.
- Chạy Remotion Studio, render và xử lý lỗi render theo workflow phù hợp.

Plugin không thay thế Remotion runtime trong repository, không tự cài Node.js/Chromium/FFmpeg và không phải dịch vụ tạo video AI. Repository Narra vẫn phải khai báo các package Remotion cần thiết và cung cấp composition thực tế. Giấy phép của plugin cũng không thay thế điều khoản cấp phép của Remotion runtime.

## 3. Mục tiêu và phạm vi V1

### 3.1 Kết quả cần đạt

Narra V1 phải đưa một project documentary 7–9 phút, mặc định 8 phút, qua toàn bộ chuỗi:

`Prompt → Research → Topic selection → Thesis → Outline → Script → Storyboard → Flow-assisted assets → English voice/captions → Rough cut → Human review → Final export`

Sản phẩm phải:

- Giảm công việc lặp lại nhưng giữ quyết định sáng tạo quan trọng cho con người.
- Truy ngược được `source → fact → claim → scene → shot → asset`.
- Cho phép sửa hoặc tạo lại một shot/segment mà không chạy lại toàn dự án.
- Tránh nội dung generic, one-source rewrite và random B-roll.
- Tạo video H.264/AAC 1920×1080, 30 fps có thể đưa sang DaVinci Resolve, CapCut hoặc upload YouTube.

### 3.2 Không nằm trong V1

- Website public, SaaS, tài khoản người dùng, billing và collaboration.
- Tự động xuất bản public hoặc sản xuất hàng loạt không có human gate.
- Điều khiển ngầm ChatGPT Web hoặc tự động click toàn bộ Google Flow bằng browser automation không được xem là luồng ổn định của V1.
- Gọi Gemini/Nano Banana/Veo API có tính phí; V1 dùng Google Flow Assisted để tận dụng quyền lợi Google AI Pro.
- Bắt buộc dùng OpenAI API, Supabase, n8n hoặc cloud render.
- Tạo 100% footage bằng AI.
- Tự động lấy media không rõ quyền sử dụng.
- Analytics feedback loop, multi-channel và render farm.

## 4. Kiến trúc logic V1

```text
Narra Desktop
  ├─ AI Workspace
  │   └─ CodexBridge → codex app-server → ChatGPT subscription
  │                      └─ GPT-5.6 Sol Medium + web search + Narra skill
  ├─ Editorial Workspace
  │   └─ topic → thesis → outline → script → claim/source
  ├─ Storyboard & Asset Studio
  │   └─ Flow Assisted → Google Flow → download/import → shot
  ├─ Voice Studio
  │   └─ Kokoro / Chatterbox / Piper → narration → captions
  ├─ ProjectStore + approval gates + local job runner
  ├─ SQLite cho index/state nhỏ
  └─ Filesystem cho media/artifact
          ├─ Remotion runtime
          └─ FFmpeg/ffprobe
                    ↓
               MP4 rough/final
```

### 4.1 Stack đề xuất

| Thành phần | Lựa chọn V1 | Trách nhiệm |
|---|---|---|
| Desktop shell | Electron | Cửa sổ desktop, filesystem, process và IPC local |
| UI | React + TypeScript | Project editor, approvals, asset manager, preview |
| Validation | Zod/JSON Schema | Hợp đồng artifact giữa Codex, UI và renderer |
| State/index | SQLite | Project index, trạng thái, job, approval và phiên bản |
| Media storage | Filesystem local | Image, video, audio, caption và render |
| AI operator | Codex App Server + Narra skill | Prompt, research, topic, thesis, outline, script, storyboard và QA ngay trong UI |
| Render | Remotion | Composition và timeline programmatic |
| Media utilities | FFmpeg/ffprobe | Probe, transcode, normalize, proxy và post-process |
| Image/video AI | Google Flow Assisted | Narra tạo prompt, mở Flow, theo dõi import và gán output vào shot |
| Voice | Kokoro mặc định; Chatterbox tùy chọn; Piper fallback | Tạo narration tiếng Anh local, không phụ thuộc ElevenLabs |
| Alignment/STT | faster-whisper local | Transcript QA và word timestamps khi cần |

Không chọn framework backend, database server hoặc API layer trước khi một yêu cầu cụ thể chứng minh chúng cần thiết.

## 5. Luồng hoạt động chính

### 5.1 Khởi tạo project và kết nối Codex

Narra tạo project ID, metadata, preset 8 phút, ngôn ngữ tiếng Anh, tỷ lệ khung hình, audience/style profile và cấu trúc thư mục. AI Workspace kiểm tra `codex app-server`, trạng thái đăng nhập ChatGPT, model catalog và hạn mức. Mỗi project giữ một Codex thread ID để tiếp tục đúng ngữ cảnh; creator nhập prompt và theo dõi tiến trình ngay trong Narra.

### 5.2 Nghiên cứu và đề xuất chủ đề

Từ prompt ban đầu, Codex lập câu hỏi nghiên cứu, tìm nguồn có cơ sở uy tín, lưu source/fact/counterpoint và hiển thị source cards trong Narra. Sau khi evidence đạt yêu cầu, Codex đề xuất topic candidate và chấm điểm view potential, story depth, visual potential, source quality, evergreen value, original angle và ad safety. Creator chọn topic/angle trực tiếp trên topic grid và duyệt `TOPIC_APPROVED`.

### 5.3 Research packet

Codex hoàn thiện research packet cho topic đã chọn, bao gồm metadata nguồn, fact, ngày tháng, con số, counterpoint, mức tin cậy và khoảng trống bằng chứng. Mọi fact quan trọng phải có source ID; xung đột giữa nguồn phải được đánh dấu thay vì âm thầm chọn một phía. Creator có thể yêu cầu nghiên cứu bổ sung từ cùng màn hình.

### 5.4 Thesis

Codex đề xuất 2–3 thesis có thể chứng minh. Creator chọn hoặc sửa. Thesis chỉ mô tả “video nói về X” không đạt; thesis phải đưa ra một lập luận cụ thể. Gate: `THESIS_APPROVED`.

### 5.5 Outline và script

Codex tạo outline có chapter, mục tiêu, claim, nguồn và thời lượng dự kiến. Creator duyệt, chỉnh sửa hoặc yêu cầu GPT viết lại từng phần trong UI. Chỉ sau đó Codex mới viết draft dựa trên research packet và outline đã chọn. Claim quan trọng được nối với fact/source. Script QA kiểm tra unsupported claim, logic, repetition, pacing, hook và kết luận. Creator duyệt `SCRIPT_APPROVED`.

### 5.6 Storyboard và shot plan

Codex chia script thành scene và nhiều shot. Mỗi shot có mục đích hình ảnh, duration, visual type, motion, evidence requirement và asset route. Không đồng nhất một scene với một ảnh. Gate: `STORYBOARD_APPROVED`.

### 5.7 Asset production bằng Google Flow Assisted

Narra tạo `asset task`, prompt ảnh tiếng Anh cho Nano Banana và prompt video cho Veo 3.1 theo từng shot. Creator bấm `Copy prompt` hoặc `Mở trong Flow`; Narra mở Google Flow bằng trình duyệt hệ thống nhưng không điều khiển ngầm thao tác generation. Creator xác nhận model/generation bằng quyền lợi Google AI Pro, tải output về, rồi Narra phát hiện file mới trong thư mục import/download đã cấu hình và đề xuất gán vào đúng shot.

Creator xác nhận việc gán; Narra copy media vào project, probe metadata kỹ thuật, lưu prompt/model/provenance, tạo thumbnail/preview và hỗ trợ select, reject, regenerate cùng visual QA. File không được tự động coi là đạt chỉ vì vừa tải xuống. Gate: `ASSETS_APPROVED`.

### 5.8 English voice và caption local

Narra tạo narration tiếng Anh theo segment để có thể nghe thử, sửa cách đọc hoặc sinh lại từng đoạn. Kokoro là provider local mặc định vì nhẹ và có giấy phép Apache 2.0; Chatterbox là lựa chọn cho voice cloning/biểu cảm; Piper là fallback CPU và phải kiểm tra license của voice model cụ thể trước khi phân phối. ElevenLabs không nằm trong critical path.

Audio thật là master timeline. Narra lưu voice profile, speed, pronunciation note, model/version và audio version cho từng segment. `faster-whisper` local có thể tạo word timestamps và so sánh transcript với script; sai tên riêng hoặc keyword được đánh dấu để nghe lại. Caption/title/lower-third do Remotion render, không giao cho model video tạo chữ trong footage.

Trong tab `Timeline`, creator có thể sinh cue ban đầu từ narration đã có thời lượng mà không gọi API, sau đó chỉnh text và mốc start/end của từng cue. Nếu có word timestamps từ STT thì vẫn có thể import SRT, WebVTT hoặc JSON để thay cue ước lượng. Narration là master clock; scene/shot được fit theo audio thay vì kéo audio để khớp một timeline giả định.

### 5.9 Preview và render

Remotion dựng timeline từ artifact đã validate. Các renderer tối thiểu gồm AI image, video, text/data, chart/map và evidence/document. FFmpeg xử lý probe, normalize, proxy và post-process. Output có version; render lỗi chỉ retry job hoặc scene liên quan.

Âm gốc của video mặc định bị tắt. Creator có thể chọn `Mute`, `Duck under narration` hoặc `Keep` theo từng shot và chỉnh level ngay trong Timeline. Music/SFX được import local; music được hạ mức khi narration chạy. Render preflight kiểm tra narration, caption range, scene/shot duration, media tồn tại, asset QA và rights note trước khi cho vào local render queue.

### 5.10 Final review và publish

Creator kiểm tra pacing, caption, audio, quyền media, disclosure, title và thumbnail. V1 có thể dừng ở file final; upload YouTube thực hiện thủ công. YouTube API private upload chỉ thêm khi thực sự đem lại giá trị và không bao giờ bỏ qua lệnh publish rõ ràng của con người.

## 6. State machine và creative gates

```text
NEW
→ TOPIC_SELECTED
→ RESEARCH_READY
→ THESIS_APPROVED
→ SCRIPT_APPROVED
→ STORYBOARD_APPROVED
→ ASSETS_READY
→ VOICE_READY
→ CAPTIONS_READY
→ ROUGH_CUT_READY
→ ROUGH_CUT_APPROVED
→ FINAL_APPROVED
→ EXPORTED
```

Các trạng thái `RESEARCHING`, `SCRIPTING`, `STORYBOARDING`, `RENDERING` và trạng thái lỗi thuộc job. Thay đổi upstream sau approval phải đánh dấu artifact downstream là `STALE`. Không được tự động vượt qua các gate topic, thesis, script, storyboard, asset, rough cut và final.

## 7. Hợp đồng artifact

```text
projects/{project_id}/
├─ project.json
├─ ai/
│  ├─ settings.json
│  ├─ runs.json
│  ├─ search_activity.json
│  └─ source_cards.json
├─ research/
│  ├─ sources.json
│  ├─ facts.json
│  ├─ topic_candidates.json
│  └─ research_packet.md
├─ thesis/
│  ├─ thesis_candidates.json
│  └─ thesis.json
├─ script/
│  ├─ outline.json
│  ├─ script_v1.md
│  └─ claims.json
├─ storyboard/
│  ├─ scenes.json
│  └─ shots.json
├─ assets/
│  ├─ manifest.json
│  ├─ images/
│  └─ videos/
├─ audio/
│  ├─ narration/
│  │  ├─ segments.json
│  │  └─ {segment_id}-v{n}.wav
│  └─ music/
├─ captions/
│  └─ captions.json
└─ renders/
   ├─ rough/
   └─ final/
```

Mỗi artifact có schema version, project ID, thời điểm cập nhật và quan hệ ID rõ ràng. Đường dẫn file chỉ là location; trạng thái và quan hệ không được suy luận từ tên file. SQLite giữ index/state, còn artifact là hợp đồng trao đổi có thể review bằng Git.

Desktop UI quản lý trực tiếp các artifact biên tập và bảy creative gate, vì vậy creator không cần mở SQLite hoặc sửa JSON bằng tay. Mỗi yêu cầu render có input snapshot bất biến, target rough/final, version, log và output path. Từ Giai đoạn 7, worker local tự động chạy Remotion/FFmpeg, cập nhật tiến độ, hỗ trợ cancel/retry từng job và phục hồi job bị ngắt; gắn output thủ công vẫn là đường dự phòng.

## 8. API và chi phí

| Năng lực | Có bắt buộc API không? | Hướng V1 |
|---|---:|---|
| OpenAI research/script | Không cần API key | Narra gọi Codex App Server, đăng nhập bằng ChatGPT subscription |
| Remotion render | Không | Chạy local |
| FFmpeg | Không | Chạy local |
| Google Flow | Không | Flow Assisted: Narra chuẩn bị prompt/mở Flow/phát hiện import; creator xác nhận generation và download |
| Nano Banana/Veo API | Không | Không dùng trong V1; Gemini API là adapter có tính phí tùy chọn về sau |
| English TTS | Không | Kokoro local mặc định; Chatterbox/Piper là adapter tùy chọn |
| Caption alignment | Không | faster-whisper local khi cần word timestamps |
| YouTube upload | Không | Upload thủ công trước; API là tùy chọn |

“Không dùng API” không đồng nghĩa mọi dịch vụ đều miễn phí; Google Flow và ChatGPT vẫn chịu credit hoặc hạn mức của gói thuê bao. Google AI Pro credits dùng trong Flow không được giả định là Gemini API credits.

## 9. Tiêu chí hoàn thành V1

- Tạo và mở lại được một project documentary local.
- Artifact có schema và provenance tối thiểu xuyên suốt source đến asset.
- Các creative gate hoạt động và downstream được đánh dấu stale khi upstream đổi.
- Một project mẫu 60–90 giây render được trước khi mở rộng lên 8 phút.
- Một project 8 phút chạy end-to-end từ artifact đến rough cut.
- Có thể thay một asset hoặc narration segment rồi render lại mà không tái tạo research/script.
- Creator nhập prompt, xem web research, chọn topic/thesis/outline và duyệt script ngay trong Narra.
- Narra dùng Codex App Server với đăng nhập ChatGPT; không cần copy dữ liệu qua lại với ChatGPT Web/Codex Desktop.
- Flow Assisted tạo được prompt package, mở Flow và đưa media đã tải về đúng shot bằng bước xác nhận rõ ràng.
- Narration tiếng Anh được tạo local bằng provider adapter và thay riêng từng segment được.
- Remotion render kết hợp ảnh, video, text/data, caption và narration.
- Output đạt preset kỹ thuật và có log/version đủ để tái hiện lỗi.
- Không có OpenAI API dependency, n8n dependency hoặc auto-publication trong V1.

## 10. Nguồn tham khảo chính

- [OpenAI Codex Skills](https://developers.openai.com/codex/skills)
- [OpenAI Codex App Server](https://developers.openai.com/codex/app-server)
- [OpenAI Codex authentication](https://developers.openai.com/codex/auth)
- [OpenAI model catalog](https://developers.openai.com/api/docs/models)
- [Google Flow models and supported features](https://support.google.com/flow/answer/16352836?hl=en)
- [Google Flow credits](https://support.google.com/flow/answer/16526234?hl=en)
- [Gemini API image generation](https://ai.google.dev/gemini-api/docs/image-generation)
- [Gemini API Veo 3.1](https://ai.google.dev/gemini-api/docs/video)
- [Kokoro](https://github.com/hexgrad/kokoro)
- [Chatterbox](https://github.com/resemble-ai/chatterbox)
- [Piper](https://github.com/OHF-voice/piper1-gpl)
- [faster-whisper](https://github.com/SYSTRAN/faster-whisper)
- [Remotion documentation](https://www.remotion.dev/docs/)
- [Remotion audio volume and mute](https://www.remotion.dev/docs/html5-audio)
- [Remotion caption display](https://www.remotion.dev/docs/captions/displaying)
- [Remotion Sequence](https://www.remotion.dev/docs/sequence)
- [FFmpeg documentation](https://ffmpeg.org/documentation.html)
- [FFmpeg audio filters: loudnorm, sidechaincompress and silencedetect](https://ffmpeg.org/ffmpeg-filters.html)
- [Electron documentation](https://www.electronjs.org/docs/latest/)
- [SQLite documentation](https://www.sqlite.org/docs.html)
- [YouTube monetization policies](https://support.google.com/youtube/answer/1311392)

## 11. Vận hành và đóng gói local từ U7

Tab `System` kiểm tra workspace, Codex login/model catalog, Kokoro, Remotion và FFmpeg mà không hiển thị credential. Cùng tab này cho phép tạo folder backup đã xác minh của project; backup giữ artifact/media/approval/render history, bỏ file `.working.` và không copy `.env` hay database index của workspace.

Bản Windows được đóng gói bằng electron-builder. Remotion production runtime dùng pnpm hoisted để artifact không chứa symlink về `%TEMP%` hoặc repository máy build. `release/win-unpacked/Narra Studio.exe` phù hợp chạy hằng ngày; file portable một-file thuận tiện chuyển máy nhưng cold start chậm hơn vì phải giải nén runtime. Hướng dẫn đầy đủ nằm ở `docs/Setup_Backup_Troubleshooting.md`.

Implementation U7 đã qua packaged smoke và local runtime checks. Exit criterion video 7–9 phút vẫn phụ thuộc creator duyệt các creative gate và cung cấp output Nano Banana/Veo thật từ Flow; trạng thái chi tiết nằm ở `docs/U7_Pilot_Report.md`.
