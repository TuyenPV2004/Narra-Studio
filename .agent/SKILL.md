---
name: narra-studio-workspace
description: Use when working inside the Narra Studio repository on local desktop architecture, project artifacts, documentary workflows, research, scripts, storyboards, media assets, Remotion rendering, planning, review or validation.
---

# Narra Studio Workspace Skill

## Mục đích

Giữ mọi công việc trong repository bám phạm vi local-first, hợp đồng artifact, creative gate và kế hoạch V1 của Narra Studio.

## Nguồn cần đọc

1. Đọc `docs/Tong_quan.md` khi công việc liên quan phạm vi sản phẩm, kiến trúc hoặc workflow.
2. Đọc phase liên quan trong `docs/Ke_Hoach_V1.md` trước khi triển khai.
3. Đọc `docs/SKILL.md` khi tác vụ liên quan AI workflow hoặc artifact do Codex tạo.
4. Chỉ dùng `docs/Narra_Studio_Blueprint_V1.md` làm discovery context cho phần chưa được tài liệu mới quyết định.
5. Đọc schema, test và implementation liên quan khi chúng tồn tại.

## Product guardrails

- Xây desktop tool local, không biến V1 thành website/SaaS.
- Không thêm OpenAI API hoặc n8n vào V1.
- Dùng Codex với GPT-5.6 Sol Medium làm AI operator; trao đổi với Narra qua artifact có schema.
- Dùng Remotion runtime + FFmpeg local cho media pipeline; plugin Remotion chỉ hướng dẫn Codex.
- Giữ provenance `source → fact → claim → scene → shot → asset`.
- Dừng tại creative gate; không auto-publish.

## Quy trình tác vụ

1. Xác định scope và phase hiện tại.
2. Kiểm tra prerequisite, approval và artifact stale.
3. Lập kế hoạch ngắn nếu tác vụ nhiều bước.
4. Thực hiện thay đổi nhỏ nhất phù hợp convention.
5. Validate bằng schema/test/typecheck/build/render check phù hợp.
6. Báo file thay đổi, bằng chứng validation và rủi ro còn lại.

## Review

Nếu người dùng chỉ yêu cầu review, không sửa file. Báo finding theo mức độ, vị trí, tác động, đề xuất và trade-off; phân biệt lỗi xác nhận được với preference.

## Code changes

Không sửa code nếu chưa có yêu cầu triển khai rõ ràng. Trước thay đổi kiến trúc hoặc dependency lớn, giải thích lý do, phương án thay thế, migration cost và thời điểm đánh giá lại.

## Validation tối thiểu

- Documentation: UTF-8, heading, code fence, local link và stale project reference.
- Artifact: schema/version, ID relationship và provenance.
- TypeScript: lint, typecheck và test được repository cung cấp.
- Media: Remotion composition check, smoke render và ffprobe output khi thích hợp.

Nếu không chạy được một kiểm tra, nêu chính xác nguyên nhân; không coi phần chưa kiểm tra là đã pass.

