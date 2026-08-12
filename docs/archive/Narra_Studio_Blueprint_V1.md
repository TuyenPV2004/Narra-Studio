**NARRA**

> **Ghi chú hiện hành — 12/08/2026:** đây là baseline lịch sử. Narra hiện dùng Provider Hub: Google Flow automation trong các phiên local tách biệt, Avis API tùy chọn qua `.env`, fallback import thủ công và QA bắt buộc. Các đoạn “Flow manual/không automation” phía dưới chỉ mô tả quyết định V1 ban đầu.

**STUDIO**

*From question to documentary.*

**TÀI LIỆU ĐẶC TẢ SẢN PHẨM & KIẾN TRÚC KỸ THUẬT**

Phiên bản V1.0 \| 09/08/2026

Mục tiêu: xây dựng hệ thống hỗ trợ sản xuất video YouTube tiếng Anh dạng faceless cinematic explainer / mini documentary, trong đó AI tăng tốc nghiên cứu và sản xuất nhưng các quyết định sáng tạo quan trọng vẫn do con người duyệt.

# 0. Cách dùng tài liệu này

Tài liệu này là blueprint để bắt đầu code Narra Studio. Nó mô tả sản phẩm, dữ liệu, các module, workflow, API contract, render engine và các “creative gates” bắt buộc. Phần có nhãn “V1” là phạm vi nên triển khai trước; phần “V2” là mở rộng sau khi một video 7–9 phút đã chạy end-to-end ổn định.

| **Nguyên tắc kiến trúc** Narra Studio là hệ thống quản lý trạng thái và điều phối sản xuất. n8n chỉ là orchestrator; database là nguồn sự thật; Storage giữ asset; Remotion là render engine; Google Flow trong V1 là một công cụ sáng tạo có bước thao tác người dùng, không phải backend API của Narra. |
|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|

## Mục lục

> **1.** Tên sản phẩm, tầm nhìn và phạm vi V1
>
> **2.** Chiến lược nội dung & guardrail YouTube
>
> **3.** User journey end-to-end
>
> **4.** Kiến trúc hệ thống tổng thể
>
> **5.** Stack công nghệ và trách nhiệm từng thành phần
>
> **6.** State machine của project
>
> **7.** Data model & provenance
>
> **8.** Module Discover / Topic Scoring
>
> **9.** Module Research / Facts / Thesis
>
> **10.** Module Script
>
> **11.** Module Storyboard & Shot Planning
>
> **12.** Asset Router & Google Flow Bridge
>
> **13.** Credit Budget cho Veo
>
> **14.** Voice, STT và subtitle
>
> **15.** Remotion Render Engine & FFmpeg
>
> **16.** n8n orchestration, jobs, retry
>
> **17.** UI/UX và màn hình V1
>
> **18.** API contract
>
> **19.** Security & secrets
>
> **20.** QA, logging, observability
>
> **21.** Cấu trúc source code
>
> **22.** Trình tự xây dựng V1
>
> **23.** Definition of Done
>
> **24.** Roadmap V2
>
> **25.** Nguồn tham khảo chính thức

# 1. Tên sản phẩm, tầm nhìn và phạm vi V1

## 1.1 Tên: Narra Studio

“Narra” lấy từ narrative: một công cụ xoay quanh việc biến câu hỏi, research và thesis thành một câu chuyện có hình ảnh. “Studio” giúp tên mềm hơn, không làm người dùng cảm giác đang vận hành một dây chuyền automation. Tên kỹ thuật trong repository có thể là narra-studio.

| **Thuộc tính**  | **Định nghĩa**                                                                 |
|-----------------|--------------------------------------------------------------------------------|
| Tên sản phẩm    | Narra Studio                                                                   |
| Tagline         | From question to documentary.                                                  |
| Định vị         | AI-assisted documentary production workspace                                   |
| Người dùng V1   | Một creator / editor vận hành một kênh YouTube tiếng Anh                       |
| Định dạng video | Faceless cinematic explainer / mini documentary                                |
| Độ dài chuẩn    | 7–9 phút; preset mặc định 8 phút                                               |
| Chủ đề chính    | Future Technology & Infrastructure: AI infrastructure, chips, robotics, energy |

## 1.2 Mục tiêu sản phẩm

> **• Rút ngắn công việc lặp lại:** research aggregation, fact extraction, first draft, storyboard structure, prompt packaging, voice generation, subtitles, rough-cut rendering.
>
> **• Giữ con người ở điểm quyết định:** topic, angle, thesis, final script, scene selection, final edit, thumbnail, title và publish.
>
> **• Chống content farm ngay trong thiết kế:** mọi claim phải có nguồn; mọi project phải có thesis; tránh one-article rewrite; kiểm tra similarity với video cũ; visual phải phục vụ narration.
>
> **• Provider-independent:** LLM, video provider, voice provider và render worker có adapter riêng để có thể đổi model mà không viết lại business logic.
>
> **• Recoverable:** một shot lỗi chỉ regenerate/re-upload shot đó, không chạy lại research hoặc toàn bộ video.

## 1.3 Không nằm trong V1

> **•** Tự động đăng video public không qua human approval.
>
> **•** Tự động điều khiển trình duyệt Google Flow để bấm generate; V1 dùng “Flow Bridge” bán thủ công nhằm tận dụng đúng Google AI Pro/Flow credits của người dùng.
>
> **•** Tạo 100% footage bằng AI video.
>
> **•** Tự động lấy video/ảnh báo chí không có quyền sử dụng.
>
> **•** Tự chọn và xuất bản breaking news theo lịch như một content farm.
>
> **•** Multi-user collaboration, billing SaaS, marketplace hoặc multi-tenant enterprise.

# 2. Chiến lược nội dung & guardrail YouTube

## 2.1 Niche mặc định

Narra Studio V1 được tối ưu cho “Future Technology & Infrastructure”: những mini-documentary giải thích các hệ thống vật lý và kinh tế đứng sau AI, chip, robot, data center và năng lượng. Mỗi video bắt đầu từ một câu hỏi, không bắt đầu từ một bài báo.

| **Pillar**                     | **Tỷ trọng gợi ý 20 video đầu** | **Ví dụ câu hỏi**                         |
|--------------------------------|---------------------------------|-------------------------------------------|
| AI Infrastructure              | 40%                             | Why AI Is Creating an Electricity Problem |
| Semiconductors / Manufacturing | 30%                             | Why Advanced Chips Are So Hard to Make    |
| Robotics / Automation          | 20%                             | Why Robot Hands Are So Hard to Build      |
| Energy / Future Infrastructure | 10%                             | Why the Power Grid Wasn’t Built for AI    |

## 2.2 YouTube monetization guardrails

YouTube hiện yêu cầu nội dung monetized phải original/authentic và không mass-produced, generic hoặc repetitive; trang chính sách cũng nêu ví dụ image slideshow/template có ít narrative và AI-generated content dùng template generic tạo cảm giác sản xuất hàng loạt là không phù hợp. Đồng thời, cùng một intro/outro hoặc format series vẫn có thể monetized nếu phần substance của mỗi video khác biệt đáng kể. \[R4\]

| **Luật nội bộ Narra** Automation được phép hỗ trợ sản xuất, nhưng không được biến mỗi video thành một template thay tên chủ thể. Mỗi project phải có Originality Score, Source Quality Score và một thesis được human approve trước khi sinh script. |
|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|

| **Rule**                      | **Check bắt buộc trước khi sang bước tiếp theo**                                                                        |
|-------------------------------|-------------------------------------------------------------------------------------------------------------------------|
| R1 — Separate research        | Mỗi video có tập nguồn riêng; tối thiểu 3 nguồn phù hợp, ưu tiên nguồn chính thức/primary.                              |
| R2 — Thesis                   | Một câu thesis cụ thể; nếu chỉ mô tả “video nói về X” thì chưa đạt.                                                     |
| R3 — No single-source rewrite | Không được lấy một bài báo rồi rewrite toàn bộ bằng AI.                                                                 |
| R4 — Provenance               | Fact → source → claim → scene → asset phải truy ngược được.                                                             |
| R5 — Visual value             | Không dùng chuỗi ảnh AI ngẫu nhiên; mỗi shot phải có visual purpose.                                                    |
| R6 — Realistic synthetic      | Đánh dấu needs_synthetic_disclosure khi có mô tả AI chân thực về người/sự kiện/địa điểm theo chính sách YouTube. \[R5\] |
| R7 — Human final review       | Không có trạng thái PUBLISHED nếu chưa có FINAL_APPROVED.                                                               |
| R8 — Ad safety                | Mặc định hạ điểm các topic violence/war/sensitive event; advertiser-friendly policy được kiểm tra riêng. \[R6\]         |

## 2.3 Topic scoring

| **Tiêu chí**     | **Trọng số** | **Ý nghĩa**                                                   |
|------------------|--------------|---------------------------------------------------------------|
| View Potential   | 25%          | Có câu hỏi/title đủ hấp dẫn và chủ đề có lực quan tâm.        |
| Story Depth      | 20%          | Có conflict, mechanism, consequence; không chỉ là list facts. |
| Visual Potential | 15%          | Có thể kể bằng footage, image, chart, map, diagram.           |
| Source Quality   | 15%          | Có primary/authoritative sources.                             |
| Evergreen Value  | 10%          | Không chết sau 24–48 giờ.                                     |
| Original Angle   | 10%          | Có thesis khác với recap thông thường.                        |
| Ad Safety        | 5%           | Rủi ro advertiser-friendly thấp.                              |

Hard gates đề xuất: Original Angle \< 7/10 → reject; Source Quality \< 7/10 → reject; chỉ có một nguồn khả dụng → reject; topic similarity quá cao với video gần đây → warning hoặc reject.

# 3. User journey end-to-end

DISCOVER → RESEARCH → THESIS APPROVAL → SCRIPT → SCRIPT APPROVAL  
→ STORYBOARD → ASSET PLAN → FLOW GENERATION / ASSET UPLOAD  
→ VOICE → SCRIBE / CAPTIONS → REMOTION ROUGH CUT  
→ HUMAN FINAL EDIT → YOUTUBE PRIVATE → FINAL CHECK → PUBLISH

## 3.1 Một project 8 phút đi qua Narra như thế nào

> **1.** Creator tạo Project và chọn preset Documentary Standard (8:00, English-US, 16:9).
>
> **2.** Discover trả 10–20 topic candidates kèm score; creator chọn một topic và viết/duyệt angle.
>
> **3.** Research thu thập nguồn, fact, dates, numbers, counterpoints và provenance.
>
> **4.** Narra đề xuất 2–3 thesis; creator chọn hoặc sửa một thesis.
>
> **5.** Script engine tạo outline rồi draft theo source-backed facts; QA gắn unsupported claims.
>
> **6.** Creator sửa và bấm Approve Script.
>
> **7.** Storyboard engine chia script thành scenes rồi shots, gán visual_type, shot_type, motion, duration và evidence requirements.
>
> **8.** Asset Router quyết định shot nào dùng Nano Banana image, Veo Lite, chart, map, screenshot/document hoặc stock/licensed asset.
>
> **9.** Flow Bridge tạo hàng đợi prompt. Creator dùng Google Flow, chọn output, upscale clip được chọn lên 1080p khi phù hợp, rồi upload asset về đúng shot.
>
> **10.** ElevenLabs tạo narration theo segment; Scribe v2 transcribe audio thực tế để lấy word timestamps và phát hiện mismatch.
>
> **11.** Remotion dựng timeline; FFmpeg được dùng cho normalize/transcode/post-process; Narra tạo rough_cut_v1.mp4.
>
> **12.** Creator review, sửa scene/asset hoặc polish trong DaVinci/CapCut.
>
> **13.** Narra upload bản final lên YouTube ở Private, sinh metadata, set synthetic-media flag khi cần; creator là người quyết định publish.

## 3.2 Creative gates

| **Gate**            | **Ai quyết định**                        | **Điều kiện**                                                |
|---------------------|------------------------------------------|--------------------------------------------------------------|
| TOPIC_APPROVED      | Human                                    | Topic + angle rõ; source feasibility đạt.                    |
| THESIS_APPROVED     | Human                                    | Thesis là một claim/idea có thể chứng minh.                  |
| SCRIPT_APPROVED     | Human                                    | Narrative, facts, wording và conclusion đạt.                 |
| STORYBOARD_APPROVED | Human                                    | Shot plan hợp lý; không random B-roll.                       |
| ASSETS_APPROVED     | Human                                    | Các hero/critical shot đạt visual QA.                        |
| ROUGH_CUT_APPROVED  | Human                                    | Pacing, captions, audio, graphics ổn.                        |
| FINAL_APPROVED      | Human                                    | Bản cuối, metadata, disclosure, thumbnail/title đã kiểm tra. |
| PUBLISHED           | System action sau explicit human command | Không tự động publish từ scheduler.                          |

# 4. Kiến trúc hệ thống tổng thể

┌──────────────────────────── NARRA STUDIO WEB ────────────────────────────┐  
│ Dashboard \| Discover \| Research \| Script \| Storyboard \| Assets \| Render │  
└───────────────────────────────┬─────────────────────────────────────────┘  
│ HTTPS  
┌──────▼──────┐  
│ Backend API │  
│ Node/TS │  
└───┬─────┬───┘  
│ │  
state/data│ │orchestration  
│ ▼  
┌─────────▼─┐ ┌────────┐  
│ Supabase │ │ n8n │  
│ Postgres │ │ flows │  
│ + Storage │ └───┬────┘  
└─────┬─────┘ │  
│ providers/jobs  
┌──────────────┼─────────────┼──────────────────┐  
▼ ▼ ▼ ▼  
OpenAI LLM ElevenLabs Render Worker YouTube API  
research/ TTS + Scribe Remotion+FFmpeg private upload  
script/plan  
  
Google Flow (V1): HUMAN-IN-THE-LOOP CREATIVE TOOL  
Narra → prompt/task → user generates in Flow → download → upload to Narra

| **Nguồn sự thật** Postgres giữ state và metadata. Không lưu “trạng thái thật” chỉ trong n8n execution, frontend local state hoặc tên file. Mọi workflow phải đọc/ghi trạng thái project vào database. |
|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|

## 4.1 Tại sao Flow không nằm trong backend V1

Mục tiêu V1 là tận dụng Google AI Pro và Google Flow credits hiện có của creator. Narra vì vậy không giả định rằng Flow UI là một API có thể gọi trực tiếp. Flow Bridge chỉ đóng gói prompt, model recommendation, credit budget, checklist và asset upload. Nếu sau này chuyển sang Veo API/Vertex/Gemini API, chỉ cần triển khai một VideoProvider mới; business schema của shot không đổi.

# 5. Stack công nghệ và trách nhiệm từng thành phần

| **Layer**     | **V1 đề xuất**                                         | **Trách nhiệm**                                                                    |
|---------------|--------------------------------------------------------|------------------------------------------------------------------------------------|
| Frontend      | Next.js + React + TypeScript + Tailwind                | UI project, editor, approvals, asset manager.                                      |
| Backend       | Node.js/TypeScript (Next.js server hoặc Fastify)       | Auth, APIs, validation, job creation, signed URLs.                                 |
| Database      | Supabase PostgreSQL                                    | Project state, provenance, facts, scripts, scenes, jobs.                           |
| Media Storage | Supabase Storage                                       | Images, videos, audio, captions, renders. \[R12\]                                  |
| Orchestration | n8n                                                    | Research/script pipelines, provider calls, callbacks, scheduled non-publish tasks. |
| LLM           | OpenAI provider adapter                                | Topic scoring, research synthesis, script/storyboard structured output.            |
| Images        | Google Flow / Nano Banana via human workflow           | Tạo/edit image và consistency trong Flow.                                          |
| AI Video      | Veo 3.1 Lite default; Fast fallback; Quality hero only | Image-to-video / motion shots; credit tracked.                                     |
| Voice         | ElevenLabs TTS                                         | Narration segment generation. \[R9\]                                               |
| STT           | ElevenLabs Scribe v2                                   | Transcript + word timestamps + pronunciation QA. \[R10\]                           |
| Render        | Remotion                                               | Programmatic timeline; Series/Sequence; charts/captions/motion. \[R7\]\[R8\]       |
| Media tools   | FFmpeg/ffprobe                                         | Probe, transcode, audio normalize, previews, post-process.                         |
| Publish       | YouTube Data API                                       | Upload private + metadata + containsSyntheticMedia. \[R14\]                        |

## 5.1 Provider abstraction

packages/providers/  
llm/openai.ts  
image/flow-manual.ts \# V1 task/prompt bridge, not API  
video/flow-veo-manual.ts \# V1 credit/task tracking  
video/veo-api.ts \# V2 optional  
voice/elevenlabs.ts  
stt/elevenlabs-scribe.ts  
render/remotion.ts  
publish/youtube.ts  
  
Business code calls interfaces, not provider-specific endpoints.

interface VideoProvider {  
createTask(input: VideoGenerationInput): Promise\<GenerationTask\>;  
getStatus?(providerTaskId: string): Promise\<ProviderJobStatus\>;  
}  
  
// Flow manual provider returns a task that requires human completion.  
// API providers may return asynchronous provider_task_id.

# 6. State machine của project

NEW  
↓  
TOPIC_SELECTED  
↓  
RESEARCHING → RESEARCH_READY → THESIS_APPROVED  
↓  
SCRIPTING → SCRIPT_QA → SCRIPT_APPROVED  
↓  
STORYBOARDING → STORYBOARD_APPROVED  
↓  
GENERATING_ASSETS → ASSETS_READY  
↓  
VOICE_GENERATING → VOICE_READY → CAPTIONS_READY  
↓  
RENDERING → ROUGH_CUT_READY → ROUGH_CUT_APPROVED  
↓  
FINAL_APPROVED → UPLOADED_PRIVATE → PUBLISHED

Không cho phép “nhảy” từ SCRIPTING sang UPLOADED_PRIVATE. Mỗi transition đi qua một domain service có validation. Trạng thái error của job không làm hỏng project state; generation_jobs có retry riêng.

| **State phụ của asset/job** | **Ý nghĩa**                                       |
|-----------------------------|---------------------------------------------------|
| PLANNED                     | Shot cần asset nhưng chưa tạo task.               |
| AWAITING_HUMAN_FLOW         | Prompt sẵn; đang chờ creator thao tác trong Flow. |
| GENERATED                   | Có output nhưng chưa chọn.                        |
| SELECTED                    | Output đã được creator chọn.                      |
| UPLOADED                    | Asset đã vào Supabase Storage.                    |
| QA_PASS / QA_FAIL           | Đã kiểm tra technical + visual.                   |
| RETRYABLE_FAILED            | Có thể retry chỉ job này.                         |
| REJECTED                    | Creator bỏ asset; không dùng render.              |

# 7. Data model & provenance

## 7.1 Các bảng cốt lõi

| **Table**          | **Vai trò**                     | **Khóa/quan hệ quan trọng**                     |
|--------------------|---------------------------------|-------------------------------------------------|
| projects           | Một video documentary           | id, status, thesis, target_duration_sec         |
| topic_candidates   | Danh sách đề tài Discover       | project_id optional, scores JSON                |
| sources            | Nguồn research                  | url, publisher, source_type, published_at       |
| facts              | Fact chuẩn hóa                  | source_id, quote/paraphrase, confidence         |
| script_versions    | Các bản script                  | project_id, version, status                     |
| script_claims      | Claim cần evidence              | script_version_id, fact_ids\[\]                 |
| scenes             | Narrative scene                 | script range, purpose, start/end                |
| shots              | Visual unit nhỏ nhất            | scene_id, visual_type, shot_type, camera_motion |
| assets             | File thực tế                    | shot_id, type, provider, storage_path, status   |
| generation_tasks   | Theo dõi image/video generation | shot_id, model, planned/actual credits, status  |
| narration_segments | Voice theo paragraph/scene      | script segment, audio asset, duration           |
| captions           | Word/phrase timing              | segment_id, start/end, text                     |
| renders            | Rough/final render              | version, settings, output asset                 |
| publish_jobs       | YouTube upload                  | video_id, privacy, metadata snapshot            |
| audit_events       | Ai đã approve/change gì         | actor, action, entity, timestamp                |

## 7.2 Provenance chain

SOURCE  
source_id=S12  
↓ supports  
FACT  
fact_id=F31  
↓ used by  
SCRIPT CLAIM  
claim_id=C09  
↓ narrated in  
SCENE  
scene_id=SC07  
↓ visualized by  
SHOT  
shot_id=SH024  
↓ rendered from  
ASSET  
asset_id=A109

Mục tiêu của provenance không phải để hiển thị citation dày đặc cho viewer; nó để Narra biết khi một fact thay đổi thì đoạn script/scene nào cần xem lại, và để human reviewer kiểm tra hallucination nhanh.

## 7.3 DDL rút gọn

create table projects (  
id uuid primary key default gen_random_uuid(),  
title text,  
language text not null default 'en-US',  
target_duration_sec int not null default 480,  
status text not null default 'NEW',  
thesis text,  
originality_score numeric,  
source_quality_score numeric,  
created_at timestamptz not null default now(),  
updated_at timestamptz not null default now()  
);  
  
create table scenes (  
id uuid primary key default gen_random_uuid(),  
project_id uuid references projects(id) on delete cascade,  
scene_order int not null,  
purpose text,  
narration_text text,  
planned_duration_ms int,  
unique(project_id, scene_order)  
);  
  
create table shots (  
id uuid primary key default gen_random_uuid(),  
scene_id uuid references scenes(id) on delete cascade,  
shot_order int not null,  
visual_type text not null,  
shot_type text,  
camera_motion text,  
subject_motion text,  
duration_ms int,  
prompt_image text,  
prompt_motion text,  
needs_synthetic_disclosure boolean default false  
);  
  
create table assets (  
id uuid primary key default gen_random_uuid(),  
project_id uuid references projects(id) on delete cascade,  
shot_id uuid references shots(id) on delete set null,  
type text not null,  
provider text,  
model text,  
storage_path text not null,  
status text not null,  
width int, height int, duration_ms int,  
metadata jsonb not null default '{}'::jsonb  
);

# 8. Module Discover / Topic Scoring

## 8.1 Mục tiêu

Discover không phải “AI chọn video tiếp theo và tự đăng”. Nó là research assistant: gom tín hiệu, biến chúng thành câu hỏi có thể làm documentary, chấm điểm và giải thích lý do. Human luôn là người chọn topic.

## 8.2 Input/Output contract

TopicCandidate {  
id, title_working, core_question, angle,  
pillar: 'AI_INFRA'\|'CHIPS'\|'ROBOTICS'\|'ENERGY',  
why_now, evergreen_hook,  
scores: {view, storyDepth, visual, sourceQuality, evergreen, originalAngle, adSafety},  
total_score,  
expected_sources\[\],  
risk_flags\[\]  
}

## 8.3 Anti-content-farm checks

> **•** Semantic similarity với 20 script/topic gần nhất; cảnh báo nếu đề tài chỉ là biến thể nhỏ.
>
> **•** Không cho “Why X is changing everything” lặp quá nhiều nếu thesis thực tế giống nhau.
>
> **•** Không dùng “top 10/news today” làm format mặc định.
>
> **•** Topic có nguồn yếu hoặc chỉ social rumor phải bị hạ Source Quality.
>
> **•** Topic sensitive event/violence bị hạ Ad Safety và cần explicit override.

# 9. Module Research / Facts / Thesis

## 9.1 Research pipeline

Selected Topic  
↓  
Source discovery  
↓  
Source classification (primary / authoritative / secondary)  
↓  
Fact extraction + date/number normalization  
↓  
Duplicate / conflict detection  
↓  
Evidence map  
↓  
Thesis candidates  
↓  
HUMAN THESIS APPROVAL

Research Agent không được viết script ngay. Nó tạo một research packet: source list, facts, counterpoints, uncertainty, “what we still do not know”, potential narrative structure. Đây là lớp ngăn AI lấp khoảng trống bằng văn phong tự tin.

## 9.2 Fact schema

Fact {  
fact_id,  
statement,  
source_id,  
source_locator,  
fact_type: 'NUMBER'\|'DATE'\|'MECHANISM'\|'QUOTE'\|'CLAIM',  
confidence: 0..1,  
time_sensitive: boolean,  
verified_at,  
conflicts_with_fact_ids\[\]  
}

## 9.3 Thesis quality checklist

> **•** Có thể viết trong một câu.
>
> **•** Không phải chỉ là chủ đề (“video about data centers”).
>
> **•** Có mechanism hoặc consequence cụ thể.
>
> **•** Có đủ facts để support và có counterpoint để tránh một chiều.
>
> **•** Có thể chuyển thành một title/hook nhưng thesis không bị clickbait hóa.

# 10. Module Script

## 10.1 Cấu trúc 8 phút mặc định

| **Phần**            | **Thời lượng gợi ý** | **Mục tiêu**                                                |
|---------------------|----------------------|-------------------------------------------------------------|
| Hook                | 0:00–0:30            | Open loop; nêu problem/contradiction; visual mạnh.          |
| Context             | 0:30–2:00            | Đưa viewer đủ kiến thức để hiểu vấn đề.                     |
| Mechanism           | 2:00–5:00            | Giải thích “how it works” bằng facts + visual explanations. |
| Implications        | 5:00–7:20            | Tại sao điều này quan trọng; tradeoffs; counterpoint.       |
| Resolution / ending | 7:20–8:00            | Trả lời câu hỏi ban đầu, kết luận có nuance.                |

Baseline nội bộ: khoảng 1.100–1.300 từ tiếng Anh cho video ~8 phút, sau đó timing thật được lấy từ voice audio chứ không ép theo số từ.

## 10.2 Script QA

| **QA**             | **Rule**                                                                |
|--------------------|-------------------------------------------------------------------------|
| Evidence coverage  | Mỗi số liệu/date/technical claim quan trọng phải map tới fact/source.   |
| Unsupported claim  | LLM flag và yêu cầu research bổ sung hoặc rewrite.                      |
| Redundancy         | Không nhắc lại cùng một ý chỉ để kéo duration.                          |
| Narrative variance | Mỗi chapter có purpose khác, không phải series paragraph cùng cấu trúc. |
| Speakability       | Câu phù hợp narration; tránh citation wording thô.                      |
| Visualizability    | Mỗi đoạn phải có ít nhất một visual strategy khả thi.                   |

# 11. Module Storyboard & Shot Planning

## 11.1 Scene khác shot

Scene là một đơn vị narrative; shot là một đơn vị hình ảnh. Một scene 12 giây có thể có 3–4 shot. Không dùng quy tắc “1 scene = 1 ảnh”.

Scene SC07 — 12.0s  
Narration: “Behind every chatbot sits an enormous network...”  
  
SH021 0–3s ESTABLISHING / AI_IMAGE  
SH022 3–6s WIDE_INTERIOR / AI_VIDEO  
SH023 6–9s CLOSE_UP / AI_IMAGE  
SH024 9–12s DATA_GRAPHIC

## 11.2 Shot schema

Shot {  
shot_id, scene_id, order, duration_ms,  
visual_type: 'AI_IMAGE'\|'AI_VIDEO'\|'DATA_GRAPHIC'\|'MAP'\|'TEXT_MOTION'\|  
'SCREENSHOT'\|'DOCUMENT'\|'STOCK'\|'LOGO',  
shot_type: 'ESTABLISHING'\|'WIDE'\|'MEDIUM'\|'CLOSE_UP'\|'MACRO'\|'AERIAL'\|...,  
camera_angle, camera_motion, subject_motion,  
visual_purpose,  
prompt_image, prompt_motion,  
evidence_fact_ids\[\],  
needs_synthetic_disclosure  
}

## 11.3 Nguyên tắc camera

Remotion không tạo góc máy mới theo nghĩa generative 3D. Shot type/camera angle phải được quyết định trước trong storyboard và được tạo bằng image/video provider. Remotion chỉ pan/zoom/crop/parallax/fade hoặc đặt clip đã có lên timeline.

# 12. Asset Router & Google Flow Bridge

## 12.1 Routing rules

| **Nếu narration cần…**                  | **Visual route mặc định**                                     |
|-----------------------------------------|---------------------------------------------------------------|
| Số liệu chính xác / xu hướng            | DATA_GRAPHIC → Remotion/React; không gen chart bằng image AI. |
| Địa lý / network / tuyến                | MAP → data-driven graphic.                                    |
| Bằng chứng từ source                    | SCREENSHOT/DOCUMENT → sourced asset + highlight.              |
| Khái niệm/bối cảnh tĩnh                 | AI_IMAGE → Nano Banana → Remotion motion.                     |
| Chuyển động thật bên trong cảnh         | AI_VIDEO → image/reference → Veo.                             |
| Cảnh đời thật có stock licensed phù hợp | STOCK → licensed footage.                                     |
| Hook / hero visual                      | AI_VIDEO, ưu tiên Lite trước; Fast/Quality theo QA/budget.    |

## 12.2 Model Router cho Veo

| **Model**       | **Dùng khi**                                                     | **Policy nội bộ**                      |
|-----------------|------------------------------------------------------------------|----------------------------------------|
| Veo 3.1 Lite    | B-roll, slow dolly, architecture, machine, landscape, motion nhẹ | DEFAULT.                               |
| Veo 3.1 Fast    | Lite thất bại QA hoặc motion complexity cao                      | FALLBACK, không tự nâng tất cả shot.   |
| Veo 3.1 Quality | Hero shot thực sự tạo khác biệt                                  | 0–2 shot/video; explicit human choice. |

## 12.3 Flow Bridge — workflow V1

> **1.** Narra tạo Generation Task cho shot: image prompt, motion prompt, shot reference, model recommendation và estimated credit.
>
> **2.** UI hiển thị nút Copy Image Prompt, Copy Motion Prompt và Open Google Flow.
>
> **3.** Creator tạo image trong Flow, chọn image đúng composition/consistency.
>
> **4.** Nếu shot = AI_VIDEO, creator dùng image/reference đó với Veo; mặc định Lite và 8 giây để tối đa lựa chọn footage trên cùng mức credit hiện tại.
>
> **5.** Creator chọn output đạt QA; nếu cần, upscale output được chọn lên 1080p. Theo bảng Google hiện tại, 1080p upscale là 0 credit cho Plus/Pro/Ultra. \[R1\]
>
> **6.** Creator download file và kéo thả vào slot SHxxx trong Narra. Narra tự probe duration/resolution, upload Storage và tạo Asset record.
>
> **7.** Generation Task ghi actual_outputs và actual_credits để dashboard budget phản ánh chi phí thực, không chỉ planned cost.

## 12.4 Generation task schema

GenerationTask {  
id, project_id, shot_id,  
provider: 'GOOGLE_FLOW',  
media_type: 'IMAGE'\|'VIDEO',  
model: 'NANO_BANANA'\|'VEO_3_1_LITE'\|'VEO_3_1_FAST'\|'VEO_3_1_QUALITY',  
prompt, reference_asset_ids\[\],  
planned_outputs: 1,  
actual_outputs: 0,  
planned_credits, actual_credits,  
status: 'AWAITING_HUMAN_FLOW'\|'GENERATED'\|'SELECTED'\|'UPLOADED'\|'QA_PASS'\|...,  
notes  
}

## 12.5 Visual QA checklist

> **•** Subject và environment có consistency với scene trước/sau.
>
> **•** Không có chữ AI sai trong hình trừ khi intentional graphic sẽ được Remotion overlay.
>
> **•** Hands/faces/physics không gây distraction.
>
> **•** Camera motion không quá mạnh; clip có đoạn 4–6 giây dùng được.
>
> **•** Architecture/object không morph bất thường.
>
> **•** Clip không chứa logo/third-party copyrighted visual không cần thiết.
>
> **•** Nếu realistic synthetic depiction có thể khiến viewer tưởng là footage thật của real event/person/place → flag disclosure review.

# 13. Credit Budget cho Veo

## 13.1 Thông số hiện hành cần cấu hình được

Theo Google Flow Help tại ngày 09/08/2026: Google AI Pro nhận 1.000 Flow credits/tháng; mỗi output Veo 3.1 Lite 4/6/8 giây = 10 credits cho non-Ultra; Fast = 20; Quality 8 giây = 100; 1080p upscale = 0 credits cho Plus/Pro/Ultra. Google cũng cảnh báo limit/cost có thể thay đổi, vì vậy Narra không hard-code vĩnh viễn: có Settings → Credit Rates. \[R1\]

| **Hạng mục**         | **Current default (Pro)** | **Config key**             |
|----------------------|---------------------------|----------------------------|
| Monthly Flow credits | 1000                      | flow.monthly_credit_budget |
| Veo Lite / output    | 10                        | flow.veo_lite_credit       |
| Veo Fast / output    | 20                        | flow.veo_fast_credit       |
| Veo Quality / output | 100                       | flow.veo_quality_credit    |
| 1080p upscale        | 0                         | flow.upscale_1080_credit   |

## 13.2 Preset Documentary Standard

| **Biến**                               | **Baseline V1**                                                        |
|----------------------------------------|------------------------------------------------------------------------|
| Target duration                        | 8:00 / 480s                                                            |
| Narration                              | ~1.100–1.300 English words                                             |
| Visual beats                           | ~96–120                                                                |
| Unique AI images                       | ~50–65                                                                 |
| Final Veo clips                        | 10–14; default 12                                                      |
| Veo generation length                  | 8s khi phù hợp                                                         |
| Minimum credits nếu 12 Lite outputs    | 120                                                                    |
| Practical budget với regenerate buffer | 150–180                                                                |
| Expected videos / 1000 credits         | Khoảng 5–7 theo budget production, không phải giới hạn cứng của Google |

## 13.3 Công thức estimator

planned_credits =  
lite_outputs \* settings.veo_lite_credit  
+ fast_outputs \* settings.veo_fast_credit  
+ quality_outputs \* settings.veo_quality_credit  
+ upscales_1080 \* settings.upscale_1080_credit  
  
expected_credits = planned_credits \* (1 + regeneration_buffer)  
  
Default regeneration_buffer = 0.30  
Actual credits = sum(generation_tasks.actual_credits)

| **Quan trọng** Credit được tính theo mỗi output, không phải mỗi prompt. UI phải cho creator nhập/chỉnh actual_outputs nếu một yêu cầu trong Flow tạo nhiều output. \[R1\] |
|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------|

# 14. Voice, STT và subtitle

## 14.1 Narration generation

ElevenLabs TTS endpoint hỗ trợ chọn voice và model; current docs cho thấy eleven_multilingual_v2 là model mặc định trong endpoint example và input dài nên có thể được chia thành nhiều request. \[R9\] Narra nên generate theo paragraph/scene thay vì một file 8 phút duy nhất.

VO_001.wav scene 1 / paragraph 1  
VO_002.wav scene 1 / paragraph 2  
...  
VO_043.wav scene 14 / paragraph 3

> **•** Regenerate được một câu sai pronunciation mà không làm lại toàn bộ narration.
>
> **•** Lưu previous_text/next_text hoặc context khi provider hỗ trợ để continuity tốt hơn.
>
> **•** Lưu voice_id và settings snapshot theo project để giữ branding.
>
> **•** Không dùng TTS timing dự đoán làm master; timing thật lấy từ audio + STT.

## 14.2 Scribe v2 QA

Scribe v2 hiện cung cấp word-level timestamps; đây là lý do dùng STT sau TTS: tạo captions đồng bộ và so transcript thực tế với final script. \[R10\]

{  
"word": "electricity",  
"start_ms": 15310,  
"end_ms": 15820,  
"segment_id": "VO_012"  
}

Narra chạy diff script-vs-transcript. Nếu missing/incorrect key term, tạo Voice QA issue và chỉ regenerate segment tương ứng.

# 15. Remotion Render Engine & FFmpeg

## 15.1 Nguyên tắc: narration là master timeline

Scene/shot duration cuối cùng được fit theo audio thật. Remotion \<Series\> phù hợp để stitch các scene chạy tuần tự, và renderMedia() dùng để render composition thành video programmatically. \[R7\]\[R8\]

NARRATION TIMELINE  
0s────────────────────────────────────────────────────────480s  
  
SC01 SC02 SC03 ... SC14  
├───────┤ ├────────────┤ ├───────────────┤ ├────┤  
SH1 SH2 SH3 SH4 SH5 SH6 SH7 SH8

## 15.2 Scene renderers V1

| **Renderer**  | **Input**           | **Behavior**                                                    |
|---------------|---------------------|-----------------------------------------------------------------|
| AIImageScene  | PNG/JPG + motion    | slow push/pan/crop, subtle parallax, caption-safe composition.  |
| AIVideoScene  | MP4/WebM            | trim best interval, fit/crop, no arbitrary slow-motion stretch. |
| ChartScene    | exact data JSON     | render chart in React; animate values accurately.               |
| MapScene      | geo data            | programmatic labels/paths; no AI-generated fake numbers.        |
| TextScene     | text + style token  | chapter titles, quotes, emphasis.                               |
| EvidenceScene | screenshot/document | highlight region + source label.                                |

## 15.3 Image motion

const scale = interpolate(frame, \[0, duration\], \[1.00, 1.07\]);  
const x = interpolate(frame, \[0, duration\], \[-20, 20\]);  
  
\<Img  
src={src}  
style={{  
width: '100%', height: '100%', objectFit: 'cover',  
transform: \`translateX(\${x}px) scale(\${scale})\`,  
}}  
/\>

Đây chỉ là camera motion giả trên ảnh; nó không tạo góc máy mới hoặc subject motion. Shot planning chịu trách nhiệm tạo góc; Veo chịu trách nhiệm khi nội dung bên trong cần chuyển động thật.

## 15.4 Transitions & pacing

> **•** Hard cut là default; fade/cross dissolve/push chỉ dùng khi có purpose.
>
> **•** Không transition “fancy” mọi 4 giây.
>
> **•** Không để một ảnh tĩnh 8–10 giây trừ khi có data/text/zoom đủ lý do.
>
> **•** Hook 30 giây đầu có mật độ visual cao hơn; phần mechanism cho phép chart/diagram ở lâu hơn nếu viewer đang học một concept.

## 15.5 Audio mix

| **Track**        | **Default**                                                                |
|------------------|----------------------------------------------------------------------------|
| Narration        | Primary, normalized; không bị music che.                                   |
| Music            | Low bed, duck dưới narration; chapter transitions có thể nâng nhẹ.         |
| SFX              | Selective hits/whoosh/ambience; không lạm dụng.                            |
| Veo native audio | Mặc định mute nếu narration là chủ đạo; chỉ giữ khi được review và có ích. |

## 15.6 Output preset

Resolution: 1920x1080  
FPS: 30  
Container: MP4  
Video codec: H.264  
Audio: AAC  
Working render: rough_cut_v{n}.mp4  
Final import target: DaVinci Resolve / CapCut / YouTube

FFmpeg/ffprobe được dùng như utility độc lập cho probe metadata, normalize/transcode, tạo proxy/preview và post-process. Render composition được gọi qua Remotion renderer; tránh kiến trúc tạo từng ảnh thành MP4 rồi concat bằng tay nếu không cần.

# 16. n8n orchestration, jobs và retry

## 16.1 Vai trò đúng của n8n

n8n điều phối workflow, không phải nơi giữ toàn bộ media/state. Với tải cao, n8n hỗ trợ queue mode và workers; V1 có thể chạy đơn giản hơn, nhưng schema job nên chuẩn bị để scale sau. \[R13\]

| **Workflow**         | **Trigger**                         | **Kết quả**                       |
|----------------------|-------------------------------------|-----------------------------------|
| WF01 Discover        | POST /projects/:id/discover         | topic_candidates                  |
| WF02 Research        | topic approved                      | sources + facts + research packet |
| WF03 Script          | thesis approved                     | script_versions + claims + QA     |
| WF04 Storyboard      | script approved                     | scenes + shots + generation tasks |
| WF05 Voice           | assets sufficient / script approved | narration assets                  |
| WF06 STT             | voice ready                         | captions + voice QA               |
| WF07 Render          | build rough cut                     | render job                        |
| WF08 YouTube Private | final approved + explicit upload    | publish_job + youtube video id    |

## 16.2 Job pattern

POST /render  
→ create generation_job(status='QUEUED')  
→ return job_id immediately  
  
worker/n8n:  
QUEUED → RUNNING → COMPLETED  
↘ RETRYABLE_FAILED  
↘ TERMINAL_FAILED

> **•** Idempotency key cho job để double-click không tạo hai render.
>
> **•** Retry exponential cho network/provider failure, nhưng không retry vô hạn creative output bị human reject.
>
> **•** Job lưu input snapshot để debug reproducibly.
>
> **•** Provider task ID và raw error lưu ở metadata, không expose secret/token.

# 17. UI/UX và màn hình V1

| **Màn hình**     | **Chức năng chính**                                                               |
|------------------|-----------------------------------------------------------------------------------|
| Dashboard        | Projects, status, current step, credit budget, latest render.                     |
| Discover         | Topic cards, scores, source feasibility, Select Topic.                            |
| Research         | Sources/facts, conflict flags, thesis candidates, provenance view.                |
| Script           | Outline + script editor, source-backed claims, QA issues, Approve.                |
| Storyboard       | Scenes/shots timeline, visual route, shot type, prompts, duration.                |
| Assets           | Generation queue, Flow Bridge, upload/select/QA assets, credit tracker.           |
| Voice & Captions | Narration segments, regenerate, transcript diff, subtitle preview.                |
| Render           | Build Rough Cut, progress, versions, compare, approval.                           |
| Publish          | Title/description/tags, disclosure, thumbnail slot, Upload Private, Publish gate. |

## 17.1 Assets screen — quan trọng nhất của V1

PROJECT / ASSETS  
  
\[SH021\] AI_IMAGE Data center exterior READY \[Preview\]  
\[SH022\] AI_VIDEO Interior dolly WAIT FLOW \[Copy Prompt\] \[Open Flow\]  
Model: Veo 3.1 Lite \| Planned: 10 credits  
\[Upload selected output\]  
\[SH023\] DATA Electricity chart AUTO \[Preview\]  
  
Budget: Planned 120 \| Actual 90 \| Monthly remaining (manual setting) 910

## 17.2 Approval UX

Approval không phải checkbox ẩn. Mỗi gate có button rõ, timestamp, optional note và “unlock downstream” effect. Khi upstream thay đổi sau approval (ví dụ sửa thesis), downstream state chuyển STALE và UI chỉ ra những phần cần regenerate.

# 18. API contract

| **Method** | **Endpoint**                      | **Mục đích**               |
|------------|-----------------------------------|----------------------------|
| POST       | /api/projects                     | Create project.            |
| GET        | /api/projects/:id                 | Project aggregate.         |
| POST       | /api/projects/:id/discover        | Create discover job.       |
| POST       | /api/projects/:id/topic/select    | Select topic + angle.      |
| POST       | /api/projects/:id/research        | Start research.            |
| POST       | /api/projects/:id/thesis/approve  | Approve thesis.            |
| POST       | /api/projects/:id/script/generate | Generate script version.   |
| PATCH      | /api/scripts/:id                  | Edit script.               |
| POST       | /api/scripts/:id/approve          | Approve script.            |
| POST       | /api/projects/:id/storyboard      | Generate storyboard.       |
| PATCH      | /api/shots/:id                    | Edit shot/prompt/route.    |
| POST       | /api/shots/:id/assets/upload-url  | Signed upload URL.         |
| POST       | /api/shots/:id/assets/attach      | Attach uploaded asset.     |
| POST       | /api/projects/:id/voice           | Generate narration.        |
| POST       | /api/projects/:id/captions        | Transcribe narration.      |
| POST       | /api/projects/:id/render          | Queue render.              |
| GET        | /api/jobs/:id                     | Job status.                |
| POST       | /api/projects/:id/youtube/private | Upload private after gate. |
| POST       | /api/projects/:id/publish         | Explicit publish action.   |

## 18.1 Validation

> **•** Zod schemas dùng chung frontend/backend/workers.
>
> **•** State transition validator: endpoint phải trả 409 nếu project chưa ở state phù hợp.
>
> **•** Upload validates MIME, size, duration, resolution; server probes media.
>
> **•** No arbitrary storage_path từ client; backend sinh key theo project/shot/asset UUID.

# 19. Security & secrets

.env.server  
OPENAI_API_KEY=...  
ELEVENLABS_API_KEY=...  
SUPABASE_URL=...  
SUPABASE_SERVICE_ROLE_KEY=...  
N8N_WEBHOOK_SECRET=...  
YOUTUBE_CLIENT_ID=...  
YOUTUBE_CLIENT_SECRET=...  
YOUTUBE_REFRESH_TOKEN=...

> **•** Không expose service role, OpenAI, ElevenLabs hoặc YouTube refresh token ở frontend.
>
> **•** Supabase: browser dùng anon/auth + RLS; backend privileged actions dùng service role. Supabase docs khuyến nghị RLS khi expose table qua client. \[R11\]
>
> **•** Storage bucket mặc định private; frontend dùng signed URLs ngắn hạn.
>
> **•** n8n webhook cần secret/signature hoặc network restriction.
>
> **•** Google Flow V1 không cần lưu Google password/cookie trong Narra.
>
> **•** Log phải redact Authorization headers, API keys, signed URL tokens.

# 20. QA, logging và observability

## 20.1 Các loại QA

| **QA layer**  | **Ví dụ**                                                               |
|---------------|-------------------------------------------------------------------------|
| Research QA   | Source conflict, stale date, unsupported fact.                          |
| Script QA     | Claim coverage, repetition, thesis drift.                               |
| Storyboard QA | Visual mismatch, too many AI-video shots, scene duration impossible.    |
| Asset QA      | Resolution, corrupt file, visual anomaly, watermark/disclosure concern. |
| Voice QA      | Transcript mismatch, pronunciation of company/technical terms.          |
| Render QA     | Missing asset, black frames, audio peak, caption overflow.              |
| Publish QA    | Thumbnail/title/description, synthetic disclosure, privacy status.      |

## 20.2 Metrics cần lưu

> **•** Veo usable-first-try rate theo model và shot type.
>
> **•** Regeneration count / final used clip.
>
> **•** Credits / final minute và credits / video.
>
> **•** Image-to-video ratio.
>
> **•** Render failure rate và slowest scenes.
>
> **•** Human edits sau AI script: changed paragraphs %, removed unsupported claims.
>
> **•** Sau publish: CTR, first-30s retention, average view duration, retention dips (V2 analytics loop).

## 20.3 Audit trail

Mọi approval và model generation quan trọng tạo audit_event. Đây là “creative provenance” giúp chứng minh quy trình có human review và phục vụ debug khi một video bị lỗi source/asset.

# 21. Cấu trúc source code

narra-studio/  
├─ apps/  
│ ├─ web/ \# Next.js UI  
│ └─ api/ \# API nếu tách khỏi web  
├─ workers/  
│ └─ render/ \# Remotion + FFmpeg  
├─ packages/  
│ ├─ db/ \# queries / repositories  
│ ├─ domain/ \# project state machine  
│ ├─ schemas/ \# Zod/shared types  
│ ├─ providers/  
│ │ ├─ llm/  
│ │ ├─ voice/  
│ │ ├─ stt/  
│ │ ├─ video/  
│ │ └─ publish/  
│ ├─ prompts/ \# versioned prompt templates  
│ └─ ui/  
├─ remotion/  
│ ├─ compositions/  
│ ├─ scenes/  
│ ├─ graphics/  
│ └─ audio/  
├─ supabase/  
│ └─ migrations/  
├─ n8n/  
│ └─ workflows/ \# exported JSON + docs  
├─ docs/  
└─ .env.example

## 21.1 Storage layout

projects/{project_id}/  
research/  
images/{shot_id}/  
videos/{shot_id}/  
audio/narration/  
captions/  
renders/rough/  
renders/final/  
publish/

# 22. Trình tự xây dựng V1

Để giảm rủi ro, không bắt đầu bằng một n8n workflow khổng lồ. Chứng minh media pipeline trước, rồi tự động hóa research/script sau.

| **Phase**                         | **Build**                                                            | **Exit criterion**                                           |
|-----------------------------------|----------------------------------------------------------------------|--------------------------------------------------------------|
| P0 — Foundation                   | Repo, Supabase, auth đơn giản, projects/scenes/shots/assets          | Có project CRUD + upload asset.                              |
| P1 — Render Core                  | 4 renderer: AI_IMAGE, AI_VIDEO, TEXT/DATA, evidence; narration track | Có thể tạo MP4 60–90s từ JSON + assets.                      |
| P2 — Flow Bridge                  | Generation task, prompts, credit tracker, upload/QA                  | Một shot đi từ plan → Flow → upload → render.                |
| P3 — Voice/Captions               | ElevenLabs TTS segmented + Scribe word timing                        | Narration/caption sync ổn.                                   |
| P4 — Full 8-min Rough Cut         | Storyboard-driven render + render versions                           | Một project 8 phút render end-to-end.                        |
| P5 — n8n Orchestration            | Jobs for research/script/storyboard/voice/render                     | Không phải bấm API thủ công.                                 |
| P6 — Research/Script Intelligence | Sources/facts/provenance, thesis gate, script QA                     | Script có evidence map và human approval.                    |
| P7 — YouTube Private              | OAuth, metadata, private upload, disclosure                          | Upload Private thành công; public vẫn explicit human action. |

## 22.1 Tại sao render core đi trước AI research

Nếu chưa chứng minh “Scene → Image/Video → Voice → Captions → Render” thì một pipeline research tự động hoàn hảo vẫn chưa tạo ra sản phẩm. Media pipeline là đường găng kỹ thuật; research/script có thể thử bằng dữ liệu thủ công trong những sprint đầu.

# 23. Definition of Done cho V1

> ☐ Tạo được project Documentary Standard 8 phút.
>
> ☐ Có topic/thesis/script/storyboard approval gates.
>
> ☐ Có source → fact → claim provenance tối thiểu cho script.
>
> ☐ Storyboard có scene + multiple shots; không ép 1 scene = 1 image.
>
> ☐ Flow Bridge tạo prompt và track Lite/Fast/Quality credits.
>
> ☐ Creator upload asset vào đúng shot mà không sửa JSON/database thủ công.
>
> ☐ ElevenLabs narration theo segment; Scribe tạo timestamps và mismatch QA.
>
> ☐ Remotion render hỗn hợp AI image + Veo clips + charts + text + evidence.
>
> ☐ Rough cut versioning; regenerate một shot không chạy lại toàn project.
>
> ☐ Human approval trước final.
>
> ☐ YouTube Data API upload Private + metadata; hỗ trợ containsSyntheticMedia theo review. \[R14\]
>
> ☐ Secrets server-side; Storage private + signed URL.
>
> ☐ Không có chức năng “auto-publish 100 videos” hoặc scheduler publish không human gate.

# 24. Roadmap V2

| **V2 feature**              | **Giá trị**                                                                      |
|-----------------------------|----------------------------------------------------------------------------------|
| Veo API provider            | Bỏ bước upload thủ công khi API economics phù hợp; vẫn giữ Flow manual provider. |
| Stock provider integrations | Search licensed footage từ nhà cung cấp mà creator đăng ký.                      |
| FCPXML/EDL export           | Mở rough cut có track/editability tốt hơn trong DaVinci/Premiere.                |
| Thumbnail lab               | Generate concept, human select; không tự quyết định publish.                     |
| Analytics feedback loop     | CTR/retention → học loại hook/visual nào hiệu quả, không auto-copy template.     |
| Prompt performance          | Theo dõi prompt/model/shot-type usable rate.                                     |
| Multi-channel profiles      | Style Bible, voice profile, niche policy per channel.                            |
| Team collaboration          | Reviewer roles, comments, approvals.                                             |
| Queue scaling               | n8n queue mode/workers + separate render nodes khi tải tăng. \[R13\]             |

# 25. Nguồn tham khảo chính thức

**\[R1\] Google Flow Help — Manage your Google Flow credits —** [<u>https://support.google.com/flow/answer/16526234?hl=en</u>](https://support.google.com/flow/answer/16526234?hl=en)

**\[R2\] Google Flow Help — Learn about Google Flow models & supported features —** [<u>https://support.google.com/flow/answer/16352836?hl=en</u>](https://support.google.com/flow/answer/16352836?hl=en)

**\[R3\] Google Flow Help — Get started with Google Flow —** [<u>https://support.google.com/flow/answer/16353333?hl=en</u>](https://support.google.com/flow/answer/16353333?hl=en)

**\[R4\] YouTube Help — YouTube channel monetization policies —** [<u>https://support.google.com/youtube/answer/1311392?hl=en</u>](https://support.google.com/youtube/answer/1311392?hl=en)

**\[R5\] YouTube Help — Disclosing use of GenAI / altered or synthetic content —** [<u>https://support.google.com/youtube/answer/14328491?hl=en</u>](https://support.google.com/youtube/answer/14328491?hl=en)

**\[R6\] YouTube Help — Advertiser-friendly content guidelines —** [<u>https://support.google.com/youtube/answer/6162278?hl=en</u>](https://support.google.com/youtube/answer/6162278?hl=en)

**\[R7\] Remotion — renderMedia() —** [<u>https://www.remotion.dev/docs/renderer/render-media</u>](https://www.remotion.dev/docs/renderer/render-media)

**\[R8\] Remotion — \<Series\> —** [<u>https://www.remotion.dev/docs/series</u>](https://www.remotion.dev/docs/series)

**\[R9\] ElevenLabs Docs — Create speech (TTS API) —** [<u>https://elevenlabs.io/docs/api-reference/text-to-speech/convert</u>](https://elevenlabs.io/docs/api-reference/text-to-speech/convert)

**\[R10\] ElevenLabs Docs — Models / Scribe v2 —** [<u>https://elevenlabs.io/docs/overview/models</u>](https://elevenlabs.io/docs/overview/models)

**\[R11\] Supabase Docs — Database / Postgres / RLS —** [<u>https://supabase.com/docs/guides/database/overview</u>](https://supabase.com/docs/guides/database/overview)

**\[R12\] Supabase Docs — Storage —** [<u>https://supabase.com/docs/guides/storage</u>](https://supabase.com/docs/guides/storage)

**\[R13\] n8n Docs — Queue mode / scaling —** [<u>https://docs.n8n.io/deploy/host-n8n/configure-n8n/scaling/enable-queue-mode</u>](https://docs.n8n.io/deploy/host-n8n/configure-n8n/scaling/enable-queue-mode)

**\[R14\] Google Developers — YouTube Data API videos.insert —** [<u>https://developers.google.com/youtube/v3/docs/videos/insert</u>](https://developers.google.com/youtube/v3/docs/videos/insert)

| **Ngày tham chiếu** Các thông số model/credit/API trong tài liệu được kiểm tra tại 09/08/2026. Narra phải giữ chúng trong Settings/config thay vì hard-code, vì nhà cung cấp có thể đổi pricing, model name, quota hoặc capability. |
|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|

# Phụ lục A — JSON mẫu cho một scene

{  
"scene_id": "SC07",  
"purpose": "Explain why cooling becomes a bottleneck",  
"narration": "AI chips generate tremendous amounts of heat...",  
"shots": \[  
{  
"shot_id": "SH021",  
"duration_ms": 2800,  
"visual_type": "AI_IMAGE",  
"shot_type": "MACRO",  
"camera_motion": "SLOW_PUSH_IN",  
"prompt_image": "Macro documentary photograph of an AI GPU..."  
},  
{  
"shot_id": "SH022",  
"duration_ms": 4200,  
"visual_type": "AI_VIDEO",  
"shot_type": "WIDE_INTERIOR",  
"camera_motion": "DOLLY_FORWARD",  
"subject_motion": "cooling indicators and engineers moving subtly",  
"video_model": "VEO_3_1_LITE",  
"planned_credits": 10  
},  
{  
"shot_id": "SH023",  
"duration_ms": 5000,  
"visual_type": "DATA_GRAPHIC",  
"evidence_fact_ids": \["F31", "F32"\]  
}  
\]  
}

# Phụ lục B — Quy tắc Asset Router dạng pseudo-code

function routeShot(shot) {  
if (shot.requiresExactData) return 'DATA_GRAPHIC';  
if (shot.requiresMap) return 'MAP';  
if (shot.requiresSourceEvidence) return 'EVIDENCE';  
  
if (shot.realLicensedFootageAvailable) return 'STOCK';  
  
if (!shot.requiresInternalMotion) return 'AI_IMAGE';  
  
if (shot.motionComplexity \<= 6) return 'VEO_3_1_LITE';  
if (shot.motionComplexity \> 6 && shot.isHero) return 'VEO_3_1_FAST';  
  
return 'VEO_3_1_LITE'; // try cheap first, escalate only after QA fail  
}  
  
function escalateAfterQa(task) {  
if (task.model === 'VEO_3_1_LITE' && task.qaFailCount \>= 2)  
return 'VEO_3_1_FAST';  
if (task.isHero && task.model === 'VEO_3_1_FAST' && task.qaFailCount \>= 2)  
return 'VEO_3_1_QUALITY';  
return task.model;  
}

# Phụ lục C — Checklist trước khi Upload Private

☐ Final script đã approved và fact QA không còn blocker.

☐ Không có missing asset / placeholder / black frame.

☐ Voice transcript diff không còn critical mismatch.

☐ Caption không tràn safe area.

☐ Audio narration rõ, music không lấn voice.

☐ Synthetic disclosure review đã hoàn tất.

☐ Title/thumbnail không hứa điều script không chứng minh.

☐ Description có source notes nếu channel muốn công khai nguồn.

☐ Upload privacy = Private.

☐ Creator xem bản Private trên YouTube trước Publish.
