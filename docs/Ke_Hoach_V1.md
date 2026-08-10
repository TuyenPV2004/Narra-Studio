# Kế hoạch triển khai Narra Studio V1

## 1. Mục tiêu kế hoạch

Xây Narra Studio thành công cụ desktop local có thể biến một bộ artifact có cấu trúc thành rough cut documentary 7–9 phút. Thứ tự triển khai ưu tiên chứng minh media pipeline trước, sau đó mới tự động hóa các bước trí tuệ bằng Codex skill.

Mỗi giai đoạn chỉ hoàn thành khi có artifact chạy được và bằng chứng validation. Không đánh dấu hoàn thành dựa trên mockup hoặc tài liệu đơn thuần.

## Trạng thái triển khai

### Giai đoạn 0 — Hoàn thành

Đã hoàn thành ngày 2026-08-09:

- Khởi tạo pnpm workspace gồm `apps/desktop` và `packages/contracts`.
- Chốt Node.js 24+, pnpm 11.16.0, Electron, React, TypeScript 6, Vite, Zod, Vitest và ESLint.
- Tạo desktop shell có Electron main/preload và React renderer.
- Tạo contract V1 cho project, source, fact, claim, scene, shot, asset, job và approval.
- Tạo validation provenance xuyên `source → fact → claim → scene → shot → asset`.
- Tạo fixture documentary 90 giây hợp lệ, có image, video, narration, music bed và caption dùng được.
- Tạo fixture sai có broken source reference để chứng minh negative validation.
- Thiết lập `.env.example`; `.env` và `.env.*` được Git ignore, không có credential thật trong repository.
- Quality gate đã pass: peer dependency check, lint, typecheck, contract tests và production build.

Exit criterion của Giai đoạn 0 đã đạt: repository build được; fixture hợp lệ được chấp nhận và fixture có broken source reference bị từ chối đúng chủ đích. Desktop smoke test trên Electron window được giữ lại cho giai đoạn tích hợp UI/đóng gói, khi ứng dụng đã có luồng mở project và preview thực tế.

### Giai đoạn 1 — Hoàn thành

Đã hoàn thành ngày 2026-08-09:

- Tích hợp Remotion 4.0.507 thành package `@narra/render` trong pnpm workspace.
- Tạo composition `DocumentaryFixture` dài 90 giây, 1920×1080, 30fps và composition phụ tạo video fixture local.
- Render đủ bốn loại nội dung: ảnh, video, text/data và evidence có source URL.
- Dùng narration làm timeline 2.700 frame; thêm caption theo timestamp và trộn narration với music bed mức thấp.
- Tạo preflight đọc bundle bằng Zod, kiểm tra đường dẫn media và báo lỗi kèm đúng `shotId`/`assetId`.
- Tạo narration fixture bằng Windows SAPI và media phụ bằng FFmpeg tích hợp trong Remotion; không dùng API.
- Render rough cut thành công tại `fixtures/documentary-90s/renders/rough/rough-cut-v1.mp4`.
- Kiểm tra hình ảnh tại ba mốc đại diện để sửa vùng an toàn caption, vị trí tiêu đề, evidence và nhãn biểu đồ.
- `ffprobe` xác nhận output H.264 1920×1080, 30fps, dài 90,05 giây; audio AAC 48kHz stereo.
- Quality gate đã pass: peer dependency check, lint, typecheck, 6 tests và production build.

Lệnh tái tạo và validation:

```powershell
pnpm render:fixture
pnpm --filter @narra/render probe
pnpm peers check
pnpm validate
```

Giới hạn còn lại ngoài phạm vi Giai đoạn 1:

- Narration và music bed hiện là media fixture local để chứng minh pipeline, chưa phải giọng đọc/chất lượng âm thanh cuối.
- Render Core chưa được nối vào desktop Player hoặc workflow quản lý project; các phần này thuộc Giai đoạn 2, 4 và 5.

### Giai đoạn 2 — Hoàn thành

Đã hoàn thành ngày 2026-08-09:

- Tạo package `@narra/project-store` cô lập filesystem và SQLite khỏi Electron/UI.
- Tạo/open/duplicate/archive project local; archive chỉ đổi trạng thái và không xóa thư mục.
- Tạo cấu trúc project chuẩn gồm research, thesis, script, storyboard, assets, audio, captions và renders.
- Dùng SQLite workspace lưu project index/state cùng bảng approval, job và artifact version; database có migration bằng `PRAGMA user_version`.
- Artifact collection có `schemaVersion`, `projectId`, `updatedAt` và `items`; artifact phiên bản tương lai bị từ chối với hướng xử lý rõ ràng.
- Thêm nút `Refresh artifacts` rõ ràng thay cho filesystem watcher để nhận artifact Codex vừa ghi mà không tạo race hoặc dependency nền ở V1.
- Màn hình desktop cho phép tạo project, mở thư mục project đã di chuyển, duplicate, archive, xem metadata và lỗi validation có file/path/suggestion.
- Electron IPC/preload giữ renderer tách khỏi filesystem/SQLite; preload được build CommonJS tương thích sandbox.
- Vite dùng đường dẫn asset tương đối để production build chạy đúng qua `file://` trong Electron.
- Test xác nhận đóng/mở store không mất index, duplicate đổi project ID, archive giữ file, project di chuyển vẫn mở được và schema mới hơn báo lỗi có thể hành động.
- Desktop smoke test xác nhận React renderer, preload API v2, IPC `listProjects` và SQLite hoạt động trong Electron thực tế.
- Quality gate đã pass: lint, typecheck, 10 tests, production build và Electron smoke test.

Lệnh validation đã dùng:

```powershell
pnpm validate
$env:NARRA_WORKSPACE_ROOT='D:\Project\Youtube\.smoke\projects'
$env:NARRA_SMOKE_TEST='1'
apps\desktop\node_modules\electron\dist\electron.exe apps\desktop --enable-logging
```

Giới hạn còn lại ngoài phạm vi Giai đoạn 2:

- Approval/job mới có schema và bảng SQLite; workflow thao tác đầy đủ sẽ được nối ở Giai đoạn 5 và 7.
- V1 dùng explicit refresh; chỉ thêm filesystem watcher khi thử nghiệm thực tế chứng minh cần cập nhật tự động.
- `node:sqlite` trong Node 24.17 của Electron 43 đang ở mức release candidate; adapter đã được cô lập trong `project-store` để có thể thay thế mà không đổi UI/IPC.

## 2. Nguyên tắc triển khai

- V1 local-first, single-user và offline-friendly cho dữ liệu/media đã có.
- Không triển khai website, backend cloud, auth, Supabase hoặc n8n.
- Không dùng OpenAI API; các bước AI chạy trong Codex với GPT-5.6 Sol Medium.
- Schema artifact phải được chốt trước UI phức tạp.
- Render core được chứng minh bằng project 60–90 giây trước project 8 phút.
- Mỗi phase có demo nhỏ, test và exit criterion riêng.
- Human approval là domain rule, không chỉ là checkbox UI.

## 3. Các giai đoạn

### Giai đoạn 0 — Foundation và quyết định kỹ thuật

**Mục tiêu:** tạo nền tảng repository và chốt các contract tối thiểu.

**Công việc:**

- Chốt Electron + React + TypeScript và cách đóng gói local.
- Khởi tạo workspace/package layout tối thiểu.
- Chốt Node.js, package manager và convention code sau khi kiểm tra môi trường máy.
- Tạo schema cho `project`, `source`, `fact`, `claim`, `scene`, `shot`, `asset`, `job`, `approval`.
- Tạo project fixture 60–90 giây có ảnh, video, narration và caption mẫu.
- Thiết lập test, lint, typecheck và build cơ bản.

**Exit criterion:** repository build được; schema validate fixture hợp lệ và từ chối fixture sai có chủ đích.

### Giai đoạn 1 — Render core proof of concept

**Mục tiêu:** chứng minh JSON + media local có thể tạo MP4 ổn định.

**Công việc:**

- Tích hợp Remotion runtime và composition gốc.
- Tạo renderer tối thiểu cho image, video, text/data và evidence.
- Dùng narration làm master timeline.
- Thêm caption đơn giản và audio mix cơ bản.
- Tích hợp ffprobe kiểm tra media input.
- Render project fixture 60–90 giây.

**Validation:** typecheck, unit test tính duration, Remotion composition check, render smoke test và ffprobe output.

**Exit criterion:** tạo được MP4 1080p/30fps có đủ image, video, narration và caption; lỗi input báo được shot/asset liên quan.

### Giai đoạn 2 — Project workspace và local state

**Mục tiêu:** người dùng quản lý project mà không sửa JSON thủ công.

**Công việc:**

- Tạo/open/duplicate/archive project local.
- Triển khai cấu trúc thư mục chuẩn.
- Dùng SQLite lưu project index, state, approval, job và version.
- Dùng filesystem watcher hoặc refresh rõ ràng để nhận artifact Codex vừa cập nhật.
- Thêm schema migration/version strategy cho artifact.
- Hiển thị lỗi validation dễ hành động.

**Exit criterion:** đóng/mở lại ứng dụng không mất trạng thái; project có thể di chuyển cùng toàn bộ artifact/media trong một thư mục.

### Giai đoạn 3 — Storyboard và asset manager

**Mục tiêu:** quản lý scene, shot và media theo provenance.

**Công việc:**

- Xây scene/shot list hoặc timeline editor đơn giản.
- Import `scenes.json` và `shots.json` do Codex tạo.
- Tạo asset task, prompt package và trạng thái asset.
- Kéo thả/import media vào đúng shot.
- Probe duration, resolution, codec và aspect ratio.
- Preview, select, reject và QA asset.
- Đánh dấu downstream stale khi storyboard/asset thay đổi.

**Exit criterion:** một shot đi được từ `PLANNED` → `AWAITING_HUMAN` → `IMPORTED` → `QA_PASS` → xuất hiện trong render.

#### Kết quả triển khai Giai đoạn 3

Trạng thái: **Hoàn thành ngày 10/08/2026.**

- Thêm Storyboard Workspace dạng scene/shot list và inspector, giữ bố cục phù hợp công cụ desktop nhiều dữ liệu.
- Import đồng thời `scenes.json` và `shots.json`; chấp nhận collection có wrapper hoặc mảng thuần, đồng thời kiểm tra project ID, ID trùng và liên kết scene/shot/asset trước khi ghi.
- Tạo asset task kèm provider, brief, prompt, negative prompt và rights note; quản lý state machine có kiểm tra transition.
- Hỗ trợ chọn file hoặc kéo thả media vào đúng asset/shot qua preload API v3, không cấp quyền filesystem trực tiếp cho renderer.
- Dùng Mediabunny để đọc duration, container, MIME, video/audio codec, resolution và thông tin audio; ảnh PNG/JPEG/SVG được đọc kích thước local.
- Preview ảnh/video qua protocol local `narra-media://`; chỉ cho `QA_PASS` khi file, metadata và kích thước bắt buộc tồn tại.
- Thêm stale scope `ASSETS`, `AUDIO`, `CAPTIONS`, `RENDER`; thay đổi storyboard/asset đánh dấu đúng downstream, toàn bộ asset bắt buộc QA_PASS mới làm `ASSETS` fresh.
- Thêm `StoryboardPreview` của Remotion: duyệt toàn bộ shot theo scene/order, chỉ đưa media `QA_PASS` vào composition và hiển thị placeholder rõ ràng cho media chưa được duyệt.
- Có nút xuất `renders/rough/storyboard-input.json` làm snapshot tái tạo được cho Remotion; snapshot đã được test chứa asset QA_PASS.
- UI bổ sung semantic color token, focus rõ, target tối thiểu 44px, loading feedback và chế độ reduced motion.

Validation đã chạy thành công:

```powershell
pnpm validate
pnpm --filter @narra/render still:storyboard
$env:NARRA_WORKSPACE_ROOT='D:\Project\Youtube\.smoke\projects'
$env:NARRA_SMOKE_TEST='1'
apps\desktop\node_modules\electron\dist\electron.exe apps\desktop --enable-logging
```

Kết quả: lint, typecheck, 12 tests, production build, Remotion still và Electron smoke (`NARRA_DESKTOP_SMOKE_OK`) đều pass. Probe trực tiếp video fixture trả về MP4, 40,043 giây, 1920×1080, 16:9, AVC/AAC. Exit criterion đã được chứng minh bằng integration test `PLANNED → AWAITING_HUMAN → IMPORTED → QA_PASS`, snapshot render và ảnh still của composition.

Giới hạn chủ đích của Giai đoạn 3: chưa chạy render job trực tiếp từ UI; nút hiện tại xuất input snapshot để Giai đoạn 5/7 nối job queue và progress. Audio/caption sync thuộc Giai đoạn 4.

### Giai đoạn 4 — Voice, caption và timeline sync

**Mục tiêu:** narration thực tế điều khiển duration cuối.

**Công việc:**

- Quản lý narration theo segment.
- Cho phép import audio tạo thủ công từ provider web.
- Import SRT/VTT hoặc word timestamps JSON.
- So sánh script với transcript khi có dữ liệu word-level.
- Cho phép thay một segment mà không làm lại toàn bộ audio.
- Fit scene/shot duration theo audio thật và cảnh báo timeline thiếu/thừa.

**Exit criterion:** thay narration segment cập nhật đúng timeline/caption và render lại thành công.

#### Kết quả triển khai Giai đoạn 4

Trạng thái: **Hoàn thành ngày 10/08/2026.**

- Thêm artifact có schema cho `audio/narration/segments.json` và `captions/captions.json`; project cũ được bổ sung hai artifact rỗng khi chưa từng được theo dõi, nhưng file đã bị xóa sau khi track vẫn được báo lỗi.
- Đồng bộ một narration segment ổn định theo mỗi scene; giữ nguyên audio/version hiện có và đánh dấu review khi narration text thay đổi.
- Import hoặc thay riêng audio của từng segment. File mới dùng tên version tăng dần, file segment khác không bị tạo lại hay ghi đè.
- Probe audio bằng Mediabunny, lưu duration, container, codec, sample rate và channels. Audio thực tế được dùng làm master duration.
- Import SRT, WebVTT và word timestamps JSON. JSON hỗ trợ `startMs/endMs`, `start/end` tính theo giây và `timebase: "segment"` cho timestamp bắt đầu lại từ zero ở từng segment.
- Khi thay segment đã có audio, cue/word timestamp gắn segment đó được scale theo duration mới và caption của các segment phía sau được dịch theo delta; caption scope vẫn stale để yêu cầu creator kiểm tra lại nội dung/phát âm.
- So sánh narration với transcript word-level, tính similarity và báo missing key term theo segment; segment có mismatch chuyển sang `NEEDS_REVIEW`.
- Hiển thị Voice & Captions workspace: danh sách segment, player local, planned/actual timing, metadata, cảnh báo thiếu/thừa, transcript QA và hành động fit timeline.
- Fit scene duration theo tổng audio segment và scale các shot trong scene theo tỷ lệ cũ; thay đổi audio/caption đánh dấu đúng `AUDIO`, `CAPTIONS` và `RENDER` stale scope.
- Render input snapshot chứa narration segments và captions. `StoryboardPreview` stitch audio segment bằng `Sequence`, render caption và lấy tổng narration làm master composition duration; bundle cũ vẫn fallback về shot duration.
- Preload/IPC tăng lên API v4; narration preview được phục vụ qua protocol local `narra-media://narration/...`.

Validation đã chạy thành công:

```powershell
pnpm validate
pnpm --filter @narra/render render:voice-smoke
remotion ffprobe -v error -show_entries stream,format fixtures/documentary-90s/renders/check/voice-smoke.mp4
pnpm --filter @narra/render still:storyboard
$env:NARRA_WORKSPACE_ROOT='D:\Project\Youtube\.smoke\projects'
$env:NARRA_SMOKE_TEST='1'
apps\desktop\node_modules\electron\dist\electron.exe apps\desktop --enable-logging
```

Kết quả: lint, typecheck, 17 tests, production build và Electron smoke (`NARRA_DESKTOP_SMOKE_OK`) đều pass. Voice render smoke dài 3,051 giây có H.264 1920×1080 và AAC 48 kHz stereo; ảnh still xác nhận caption xuất hiện trong composition. Integration test chứng minh thay segment 1 từ 1 giây thành 1,5 giây không đổi segment 2, sau đó scene/shot cập nhật thành 1,5 giây và render snapshot vẫn chứa đủ narration/caption.

Giới hạn chủ đích: V1 chưa tự gọi TTS/STT provider; creator tạo audio/transcript thủ công rồi import. Transcript diff hiện là lexical QA để bắt thiếu key term, không thay thế review phát âm bằng tai. Chạy render job trực tiếp từ UI vẫn thuộc Giai đoạn 5/7.

### Giai đoạn 5 — Desktop UI và approval workflow

**Mục tiêu:** cung cấp trải nghiệm vận hành end-to-end trong công cụ local.

**Màn hình tối thiểu:**

- Dashboard/project list.
- Research/thesis viewer.
- Script editor và claim/source panel.
- Storyboard/shot editor.
- Asset manager.
- Voice/caption panel.
- Render queue, version và log.

**Approval gates:** topic, thesis, script, storyboard, assets, rough cut và final. Mỗi approval có timestamp/note và quy tắc unlock downstream.

**Exit criterion:** creator có thể vận hành project fixture mà không mở SQLite hoặc chỉnh artifact máy đọc bằng tay.

#### Kết quả triển khai Giai đoạn 5

Đã hoàn thành desktop workflow local qua năm khu vực chính: Overview, Editorial, Storyboard & assets, Voice & captions, Review & render. Editorial cho phép đọc/lưu `research_packet.md`, chọn thesis qua UI (ứng dụng tự quản lý `thesis.json`), sửa `script_v1.md`, đồng thời đối chiếu fact/source hoặc claim ngay bên cạnh. Creator không cần mở SQLite hay sửa JSON bằng tay.

Bảy approval gate `TOPIC → THESIS → SCRIPT → STORYBOARD → ASSETS → ROUGH_CUT → FINAL` đã có quy tắc unlock tuần tự, readiness check theo artifact/output thực tế, timestamp, note và thao tác revoke. Khi thesis hoặc script thay đổi, các gate downstream bị thu hồi và trạng thái project lùi về mốc đã duyệt gần nhất; các scope audio, caption và render được đánh dấu stale mà không xóa media.

Render queue tạo snapshot bất biến theo target/version, ví dụ `renders/rough/render-v1-input.json`, cùng log riêng và bản ghi SQLite. UI cho phép gắn video render hoàn tất vào đúng job; rough/final gate chỉ sẵn sàng khi output tương ứng thực sự tồn tại. Giai đoạn 5 chủ đích quản lý request, version, output và log; worker tự chạy Remotion, progress, retry và recovery vẫn thuộc Giai đoạn 7.

Kiểm chứng:

```powershell
pnpm validate
$env:NARRA_SMOKE_TEST='1'
apps\desktop\node_modules\electron\dist\electron.exe apps\desktop --disable-gpu
```

Kết quả: lint, typecheck, 18 tests, production build và Electron smoke IPC v5 (`NARRA_DESKTOP_SMOKE_OK`) đều pass. Integration test chứng minh không thể duyệt sai thứ tự, chuỗi duyệt đi tới final, mỗi render có snapshot/version/log/output riêng và sửa script sẽ revoke từ `SCRIPT` tới `FINAL`. Exit criterion của Giai đoạn 5 đã đạt.

### Giai đoạn 6 — Bộ Codex skill Narra

**Mục tiêu:** chuẩn hóa các bước AI không dùng OpenAI API.

**Công việc:**

- Cài đặt hoặc đóng gói các skill được đặc tả tại [SKILL.md](SKILL.md).
- Ép output bám schema và đường dẫn project.
- Tạo checklist chất lượng cho research, thesis, script và storyboard.
- Yêu cầu citation/provenance và cảnh báo xung đột nguồn.
- Kết hợp các Remotion skill đã cài cho tác vụ render.
- Thử trên ít nhất một topic thật và so sánh artifact giữa hai lần chạy.

**Exit criterion:** từ một project ID, Codex tạo được research packet, thesis candidate, script và storyboard hợp lệ; Narra mở được mà không cần sửa cấu trúc thủ công.

#### Kết quả triển khai Giai đoạn 6

Đã đóng gói skill repo-scoped tên `narra` tại `.agents/skills/narra/` theo cấu trúc Codex hiện hành. Skill xuất hiện trong danh sách khi gõ `/` và có thể gọi chắc chắn bằng `$narra`. Một dispatcher duy nhất nhận `stage=init|discover|research|thesis|script|storyboard|assets|voice|render|review|pipeline`; reference về contract, editorial gate và render chỉ được nạp khi stage cần đến.

Skill ép đường dẫn/schema theo `packages/contracts`, giữ provenance, dừng tại bảy human approval gate, không gọi OpenAI API và không tự publish. Model không thể được skill tự đổi; cấu hình sử dụng vẫn là GPT-5.6 Sol + Medium do creator chọn qua `/model` và `/reasoning`. Nếu Remotion skill/plugin khả dụng thì Narra dùng hướng dẫn đó; nếu không, skill dùng các script Remotion/FFmpeg local đã kiểm thử trong repository.

Đã thêm hai script deterministic:

- `validate-artifacts.ts`: validate artifact theo stage, project ID và quan hệ `source → fact → claim → scene → shot`.
- `compare-runs.ts`: so sánh source/fact overlap, thesis, độ dài script và coverage scene/shot giữa hai lần chạy.

Đánh giá trên topic thật “Why is AI increasing data-center electricity demand even as computing becomes more efficient?” dùng nguồn IEA 2026 và Berkeley Lab 2026. Hai run cùng đạt validation `VALID`, cùng 100% URL nguồn, giữ 2/3 fact giống nhau (`0.667`) nhưng tạo hai thesis có chủ đích khác nhau. Script dài 150/160 từ; storyboard có 2 scene/4 shot và 3 scene/5 shot. Fixture sai provenance bị từ chối đúng tại `fact-broken → source-missing`. `ProjectStore.openProjectDirectory()` mở được cả hai run với trạng thái validation `VALID` mà không sửa cấu trúc thủ công.

Kiểm chứng:

```powershell
pnpm exec tsx .agents/skills/narra/scripts/validate-artifacts.ts --project fixtures/skill-eval/run-a --stage full
pnpm exec tsx .agents/skills/narra/scripts/validate-artifacts.ts --project fixtures/skill-eval/run-b --stage full
pnpm exec tsx .agents/skills/narra/scripts/compare-runs.ts --left fixtures/skill-eval/run-a --right fixtures/skill-eval/run-b
pnpm validate
```

`quick_validate.py` của `skill-creator` không chạy vì runtime hiện thiếu module `PyYAML`; không cài thêm dependency. Kiểm tra fallback đã xác nhận frontmatter chỉ có `name`/`description`, tên folder khớp `narra`, không còn placeholder, đủ metadata/resources và `SKILL.md` dài 83 dòng. Exit criterion Giai đoạn 6 đã đạt.

### Giai đoạn 7 — Local job runner và khả năng phục hồi

**Mục tiêu:** chạy các tác vụ media dài có trạng thái và retry rõ ràng.

**Công việc:**

- Job queue local cho probe, proxy, render và post-process.
- Capture input snapshot, stdout/stderr, thời gian và output.
- Idempotency để double-click không tạo hai job tương đương.
- Cancel/retry job an toàn.
- Retry theo job/scene, không chạy lại toàn pipeline.
- Dọn file tạm có kiểm soát và có khả năng phục hồi khi ứng dụng đóng bất ngờ.

**Exit criterion:** render lỗi có thể được chẩn đoán, retry và tiếp tục mà không làm hỏng project state.

**Trạng thái triển khai:** hoàn thành.

- SQLite schema v4 lưu attempt, progress, thời điểm bắt đầu/kết thúc, lỗi, lệnh đã chạy, khóa idempotency, yêu cầu hủy và đường dẫn output tạm.
- `LocalJobRunner` chạy tuần tự các job `PROBE`, `PROXY`, `RENDER`, `POST_PROCESS` bằng Remotion CLI/FFmpeg local; stdout/stderr được ghi vào log riêng của job.
- Render dùng snapshot bất biến và chỉ đổi tên file `.working.mp4` sang output chính thức sau khi tiến trình hoàn tất thành công.
- Double-click với cùng input chỉ trả về job đang hoạt động; retry giữ nguyên job, version, scope và snapshot, tối đa ba attempt trước khi chuyển thành lỗi terminal.
- Job đang chạy khi ứng dụng dừng được chuyển thành `RETRYABLE_FAILED`; chỉ file tạm nằm trong project của chính job đó được dọn.
- Desktop API v6 tự chạy job sau khi queue/retry, polling tiến độ và cho phép cancel/retry từng job. Cơ chế gắn video thủ công vẫn được giữ làm đường dự phòng.
- Kiểm thử bao phủ idempotency, atomic completion, retry, cancel, recovery và một lượt `ffprobe` thật qua worker local.

### Giai đoạn 8 — Full documentary pilot

**Mục tiêu:** hoàn thành một video 7–9 phút bằng workflow thật.

**Công việc:**

- Chạy discover → research → thesis → script → storyboard bằng Codex.
- Tạo/import asset bằng Google Flow và nguồn hợp lệ.
- Tạo/import narration/caption.
- Render nhiều phiên bản rough cut.
- Sửa tối thiểu một asset và một narration segment để kiểm tra incremental workflow.
- Thực hiện final checklist và xuất MP4.

**Exit criterion:** video 8 phút đạt Definition of Done trong `Tong_quan.md`, có đầy đủ provenance và có thể tái mở project để tiếp tục chỉnh sửa.

### Giai đoạn 9 — Đóng gói V1

**Mục tiêu:** tạo bản local có thể cài và vận hành lặp lại trên máy mục tiêu.

**Công việc:**

- Kiểm tra dependency hệ thống như FFmpeg và Chromium.
- Thêm preflight diagnostics.
- Đóng gói desktop application.
- Viết hướng dẫn setup, backup/move project và xử lý lỗi thường gặp.
- Chạy smoke test trên bản đóng gói, không chỉ dev mode.

**Exit criterion:** cài mới, mở project mẫu và render smoke test thành công theo hướng dẫn.

## 4. Quality gate xuyên suốt

| Gate | Bằng chứng tối thiểu |
|---|---|
| Contract | Schema validation pass/fail fixtures |
| Type safety | Typecheck không lỗi |
| Code quality | Lint và unit test liên quan pass |
| Media | ffprobe xác nhận thông số output |
| Render | Smoke render thành công trên fixture chuẩn |
| State | Test transition hợp lệ và từ chối transition sai |
| Recovery | Retry/cancel không làm hỏng project |
| Documentation | Link local, heading và đường dẫn không lỗi |
| Pilot | Project 8 phút có artifact/provenance đầy đủ |

## 5. Dependency giữa các giai đoạn

```text
P0 Foundation
  ├─ P1 Render Core
  │    └─ P4 Voice/Caption
  └─ P2 Project/State
       └─ P3 Storyboard/Assets

P1 + P2 + P3 + P4
  └─ P5 Desktop Workflow
       ├─ P6 Codex Skills
       └─ P7 Job Runner
            └─ P8 Full Pilot
                 └─ P9 Packaging
```

P6 có thể được thử sớm bằng artifact fixture, nhưng chỉ coi là tích hợp khi schema từ P0 và UI import từ P2/P3 đã ổn định.

## 6. Các quyết định cần đánh giá lại sau V1

- Có cần Codex App Server/SDK để Narra khởi chạy task trực tiếp hay tiếp tục mô hình hai cửa sổ.
- Có cần ElevenLabs API thay cho import thủ công.
- Có cần YouTube Data API private upload.
- Có cần n8n hoặc một workflow engine khi xuất hiện webhook/schedule/multi-machine.
- Có cần cloud backup, collaboration hoặc render worker riêng.
- Có cần export FCPXML/EDL cho DaVinci/Premiere.

Các mục này không được đưa vào critical path của V1 nếu pilot chưa chứng minh nhu cầu.
