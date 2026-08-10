---
name: narra
description: Build and validate local Narra Studio documentary artifacts from a project ID or project folder, from sourced research through review and render preparation.
---

# Narra Studio Skill

## Mục đích

Biến Codex thành AI operator của Narra Studio. Skill đọc/ghi artifact trong `projects/{project_id}/`, giữ provenance và dừng tại các creative gate cần con người duyệt. Skill không gọi OpenAI API và không tự động publish video.

Skill đã được đóng gói tại `.agents/skills/narra/`. Trong Codex Desktop, gõ `/` và chọn **Narra** trong danh sách skill, hoặc gọi trực tiếp bằng cú pháp ổn định `$narra`. Skill nhận stage qua `stage=<name>` thay vì tạo nhiều skill trùng context.

## Model mặc định

- Dùng model đang hoạt động trong task Codex.
- Cấu hình khuyến nghị: GPT-5.6 Sol, reasoning Medium. Chọn bằng `/model` và `/reasoning` trước khi chạy; skill không có quyền tự đổi model.
- Chỉ đề xuất High/xHigh khi nguồn xung đột, lập luận phức tạp hoặc lỗi kỹ thuật khó.
- Không tự đổi model hoặc tuyên bố vượt hạn mức tài khoản.

## Danh mục skill

### `$narra stage=init`

**Chức năng:** khởi tạo hoặc kiểm tra cấu trúc một project Narra.

**Input:** tên project, câu hỏi ban đầu, target duration, language, aspect ratio và style profile.

**Output:** `project.json`, cấu trúc thư mục chuẩn và báo cáo preflight.

**Không làm:** tự chọn thesis, tạo media hoặc vượt creative gate.

### `$narra stage=discover`

**Chức năng:** đề xuất và đánh giá topic/angle.

**Input:** niche, audience, channel history nếu có và số candidate.

**Output:** `research/topic_candidates.json` gồm điểm, lý do, source feasibility, rủi ro similarity và đề xuất angle.

**Gate:** dừng để creator chọn topic và xác nhận `TOPIC_APPROVED`.

### `$narra stage=research`

**Chức năng:** thu thập nguồn, fact, số liệu, counterpoint và provenance.

**Input:** project ID, topic/angle đã duyệt và phạm vi thời gian.

**Output:**

- `research/sources.json`
- `research/facts.json`
- `research/research_packet.md`

**Quy tắc:** ưu tiên nguồn primary/official; không dùng một bài làm toàn bộ nền tảng; phân biệt fact, inference và uncertainty; gắn source ID cho fact quan trọng.

### `$narra stage=thesis`

**Chức năng:** tạo 2–3 thesis có thể chứng minh từ research packet.

**Input:** sources, facts, counterpoints và angle đã duyệt.

**Output:** `thesis/thesis_candidates.json` hoặc cập nhật `thesis/thesis.json` sau khi creator chọn.

**Gate:** dừng tại `THESIS_APPROVED`.

### `$narra stage=script`

**Chức năng:** tạo outline, script draft và claim map.

**Input:** thesis đã duyệt, research packet, target duration và voice/style guide.

**Output:**

- `script/outline.md`
- `script/script_v{n}.md`
- `script/claims.json`
- `script/qa_report.md`

**Quy tắc:** unsupported claim phải bị đánh dấu; không bịa citation; kiểm tra hook, narrative progression, pacing, repetition và conclusion.

**Gate:** dừng tại `SCRIPT_APPROVED`.

### `$narra stage=storyboard`

**Chức năng:** chuyển script thành scene và shot plan.

**Input:** script đã duyệt, claims và visual style.

**Output:**

- `storyboard/scenes.json`
- `storyboard/shots.json`
- báo cáo coverage narration/claim/visual.

**Quy tắc:** một scene có thể có nhiều shot; mỗi shot phải có visual purpose, duration, route, evidence requirement và liên kết claim khi thích hợp; tránh random B-roll.

**Gate:** dừng tại `STORYBOARD_APPROVED`.

### `$narra stage=assets`

**Chức năng:** tạo asset manifest và prompt package để creator dùng Google Flow hoặc nguồn media khác.

**Input:** shots đã duyệt, credit budget và provider preference.

**Output:** `assets/manifest.json`, prompt/task cho từng shot và checklist import/QA.

**Quy tắc:** không tự động điều khiển Google Flow; không tải media không rõ quyền; phân biệt planned, imported, selected, rejected và QA status.

### `$narra stage=voice`

**Chức năng:** chia narration thành segment, tạo hướng dẫn TTS và kiểm tra transcript/caption được import.

**Input:** script đã duyệt, voice profile và audio/transcript hiện có.

**Output:** segment manifest, pronunciation notes, caption artifact và mismatch report.

**Quy tắc:** V1 hỗ trợ thao tác provider thủ công; chỉ gọi API bên ngoài khi creator đã cấu hình và yêu cầu rõ ràng.

### `$narra stage=render`

**Chức năng:** validate input, preview hoặc render project bằng Remotion và FFmpeg.

**Input:** project ID, render preset, version và phạm vi full/scene/shot.

**Output:** render job record, log, media report và MP4 trong `renders/`.

**Quy tắc:** dùng các Remotion skill phù hợp đã cài; kiểm tra runtime/dependency trước; không coi plugin Remotion là runtime; narration là master timeline; không ghi đè bản render đã được duyệt.

### `$narra stage=review`

**Chức năng:** kiểm tra một stage hoặc toàn project trước approval.

**Input:** project ID và scope như research, script, storyboard, assets, rough cut hoặc final.

**Output:** báo cáo finding theo mức độ, vị trí artifact, ảnh hưởng, cách sửa và phần chưa kiểm tra.

**Quy tắc:** review không tự sửa nếu người dùng chỉ yêu cầu đánh giá; tách lỗi xác nhận được khỏi preference sáng tạo.

### `$narra stage=pipeline`

**Chức năng:** điều phối nhiều skill theo trạng thái project.

**Input:** project ID và stage đích.

**Output:** các artifact của từng stage và status report.

**Quy tắc:** không bỏ qua prerequisite; dừng ở mọi creative gate; không tự publish; chỉ chạy lại artifact stale hoặc job lỗi liên quan.

## Workflow cốt lõi

1. Đọc `.agent/AGENTS.md`, `docs/Tong_quan.md`, `docs/Ke_Hoach_V1.md` và metadata project.
2. Xác định stage hiện tại, prerequisite, approval và artifact stale.
3. Chỉ đọc các artifact cần cho stage được yêu cầu.
4. Validate input trước khi tạo output.
5. Ghi output theo schema/version và giữ ID/provenance ổn định.
6. Chạy validation hẹp nhất có ý nghĩa.
7. Báo file đã tạo/sửa, nguồn đã dùng, finding còn lại và gate cần creator duyệt.

## Guardrail bắt buộc

- Không bịa nguồn, URL, quote, số liệu hoặc trạng thái validation.
- Không biến inference thành fact; ghi rõ uncertainty.
- Không rewrite toàn bộ từ một nguồn.
- Không thay đổi artifact downstream đã được duyệt mà không đánh dấu stale/version mới.
- Không gọi API có phí, dùng credit hoặc điều khiển dịch vụ ngoài khi chưa có yêu cầu rõ ràng.
- Không tự động public video.
- Không sửa code khi người dùng chỉ yêu cầu review.

## Ví dụ sử dụng

```text
$narra stage=research project=projects/ai-electricity-problem
```

```text
$narra stage=storyboard project=projects/ai-electricity-problem target=8m
```

```text
$narra stage=render project=projects/ai-electricity-problem scope=rough-cut
```

```text
Hãy dùng $narra để review provenance và unsupported claims của project này.
```
