import type {AiReasoningEffort, AiStage} from '@narra/contracts';
import type {AiRun} from '@narra/contracts';
import type {AiWorkspace} from '@narra/project-store';
import {
  Activity,
  Bot,
  CheckCircle2,
  CircleStop,
  Clock3,
  ExternalLink,
  Gauge,
  Globe2,
  LoaderCircle,
  LogIn,
  MessageSquareText,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  Settings2,
  Sparkles,
  TriangleAlert,
} from 'lucide-react';
import {useEffect, useMemo, useRef, useState, type ReactNode} from 'react';
import {getAgentDelta, getTurnCompletion, summarizeRateLimits, toAiActivity, type AiActivity} from './ai-workspace-state';

type Props = {
  projectId: string;
  projectQuestion: string;
  targetDurationSec: number;
  language: string;
};

type Model = Awaited<ReturnType<typeof window.narra.codexListModels>>[number];
type Account = Awaited<ReturnType<typeof window.narra.codexReadAccount>>;
type ServerRequest = {id: number | string; method: string; params: unknown};
type RunState = 'IDLE' | 'STARTING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

const stageOptions: Array<{value: AiStage; label: string}> = [
  {value: 'DISCOVER', label: 'Khám phá chủ đề'},
  {value: 'RESEARCH', label: 'Nghiên cứu'},
  {value: 'THESIS', label: 'Phát triển luận đề'},
  {value: 'OUTLINE', label: 'Xây dựng dàn ý'},
  {value: 'SCRIPT', label: 'Soạn kịch bản'},
  {value: 'STORYBOARD', label: 'Lập storyboard'},
];

const runStatusLabel = (status: RunState): string => ({
  IDLE: 'Sẵn sàng', STARTING: 'Đang bắt đầu', RUNNING: 'Đang chạy', COMPLETED: 'Hoàn thành', FAILED: 'Thất bại', CANCELLED: 'Đã dừng',
})[status];

const formatElapsed = (seconds: number): string => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

const buildPrompt = (input: {
  request: string;
  audience: string;
  language: string;
  durationMin: number;
  format: string;
  style: string;
  stage: AiStage;
}): string => [
  `Task stage: ${input.stage}.`,
  `Creator request: ${input.request.trim()}`,
  `Audience: ${input.audience.trim()}.`,
  `Output language: ${input.language.trim()}.`,
  `Target duration: ${input.durationMin} minutes.`,
  `Format: ${input.format.trim()}.`,
  `Style: ${input.style.trim()}.`,
  'Use credible sources when factual research is needed. Clearly separate sourced facts, inference, uncertainty, and counterpoints.',
  'Do not modify project artifacts in this exploratory run. Return a concise, creator-facing response with source links when available.',
].join('\n');

const renderInlineMarkup = (value: string): ReactNode[] => {
  const nodes: ReactNode[] = [];
  const pattern = /(\*\*([^*]+)\*\*|\[([^\]]+)\]\((https?:\/\/[^)]+)\))/g;
  let cursor = 0;
  for (const match of value.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > cursor) nodes.push(value.slice(cursor, index));
    if (match[2]) {
      nodes.push(<strong key={`${index}-strong`}>{match[2]}</strong>);
    } else if (match[3] && match[4]) {
      nodes.push(<button className="inline-source" key={`${index}-link`} onClick={() => void window.narra.openExternalUrl(match[4]!)}>{match[3]} <ExternalLink aria-hidden="true" size={12} /></button>);
    }
    cursor = index + match[0].length;
  }
  if (cursor < value.length) nodes.push(value.slice(cursor));
  return nodes;
};

const FormattedResponse = ({content}: {content: string}) => (
  <div className="formatted-response">
    {content.split('\n').map((line, index) => {
      const trimmed = line.trim();
      if (!trimmed) return <div className="response-spacer" key={`space-${index}`} />;
      if (trimmed.startsWith('### ')) return <h5 key={`heading-${index}`}>{renderInlineMarkup(trimmed.slice(4))}</h5>;
      if (trimmed.startsWith('## ')) return <h4 key={`heading-${index}`}>{renderInlineMarkup(trimmed.slice(3))}</h4>;
      if (trimmed.startsWith('# ')) return <h3 key={`heading-${index}`}>{renderInlineMarkup(trimmed.slice(2))}</h3>;
      if (/^[-*] /.test(trimmed)) return <p className="response-bullet" key={`bullet-${index}`}>{renderInlineMarkup(trimmed.slice(2))}</p>;
      return <p key={`line-${index}`}>{renderInlineMarkup(trimmed)}</p>;
    })}
  </div>
);

const ServerRequestPanel = ({request, onResolved}: {request: ServerRequest; onResolved: () => void}) => {
  const params = request.params && typeof request.params === 'object' ? request.params as Record<string, unknown> : {};
  const questions = Array.isArray(params.questions) ? params.questions as Array<Record<string, unknown>> : [];
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const respond = async (result: unknown): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await window.narra.codexRespondServerRequest(request.id, result);
      onResolved();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không thể trả lời yêu cầu của Codex.');
    } finally {
      setBusy(false);
    }
  };

  const isUserInput = request.method.includes('requestUserInput');
  return (
    <section className="ai-request-card" aria-labelledby="ai-request-title">
      <div className="ai-request-heading">
        <MessageSquareText aria-hidden="true" size={18} />
        <div><p className="section-label">Cần thông tin</p><h4 id="ai-request-title">Codex đang chờ quyết định của anh</h4></div>
      </div>
      {isUserInput ? (
        <form onSubmit={(event) => {
          event.preventDefault();
          const response = Object.fromEntries(questions.map((question, index) => {
            const id = typeof question.id === 'string' ? question.id : `question-${index + 1}`;
            return [id, {answers: [answers[id] ?? '']}];
          }));
          void respond({answers: response});
        }}>
          {questions.map((question, index) => {
            const id = typeof question.id === 'string' ? question.id : `question-${index + 1}`;
            const label = typeof question.question === 'string' ? question.question : 'Câu trả lời của anh';
            const options = Array.isArray(question.options) ? question.options as Array<Record<string, unknown>> : [];
            return (
              <label key={id}>{label}
                {options.length > 0 ? (
                  <select required value={answers[id] ?? ''} onChange={(event) => setAnswers((current) => ({...current, [id]: event.target.value}))}>
                    <option value="">Chọn một câu trả lời</option>
                    {options.map((option, optionIndex) => {
                      const value = typeof option.label === 'string' ? option.label : `Lựa chọn ${optionIndex + 1}`;
                      return <option key={value} value={value}>{value}</option>;
                    })}
                  </select>
                ) : (
                  <input required value={answers[id] ?? ''} onChange={(event) => setAnswers((current) => ({...current, [id]: event.target.value}))} />
                )}
              </label>
            );
          })}
          {questions.length === 0 && <p className="muted-copy">Codex yêu cầu thêm thông tin.</p>}
          {error && <p className="field-error" role="alert">{error}</p>}
          <div className="ai-request-actions">
            <button className="primary" disabled={busy || questions.length === 0} type="submit">Gửi câu trả lời</button>
            <button className="secondary" disabled={busy} type="button" onClick={() => void respond({answers: {}})}>Hủy yêu cầu</button>
          </div>
        </form>
      ) : (
        <>
          <p className="muted-copy">{typeof params.reason === 'string' ? params.reason : 'Codex cần được phê duyệt để tiếp tục.'}</p>
          {error && <p className="field-error" role="alert">{error}</p>}
          <div className="ai-request-actions">
            <button className="primary" disabled={busy} onClick={() => void respond({decision: 'accept'})}>Phê duyệt</button>
            <button className="secondary" disabled={busy} onClick={() => void respond({decision: 'decline'})}>Từ chối</button>
          </div>
        </>
      )}
    </section>
  );
};

export const AiWorkspaceView = ({projectId, projectQuestion, targetDurationSec, language}: Props) => {
  const [workspace, setWorkspace] = useState<AiWorkspace | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [models, setModels] = useState<Model[]>([]);
  const [rateLimits, setRateLimits] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [connectionNotice, setConnectionNotice] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [request, setRequest] = useState(projectQuestion);
  const [audience, setAudience] = useState('Curious international viewers');
  const [outputLanguage, setOutputLanguage] = useState(language === 'en' ? 'English' : language);
  const [durationMin, setDurationMin] = useState(Math.round(targetDurationSec / 60));
  const [format, setFormat] = useState('Cinematic explainer');
  const [style, setStyle] = useState('Evidence-led, clear, and visually cinematic');
  const [stage, setStage] = useState<AiStage>('DISCOVER');
  const [model, setModel] = useState('gpt-5.6-sol');
  const [effort, setEffort] = useState<AiReasoningEffort>('medium');
  const [runState, setRunState] = useState<RunState>('IDLE');
  const [response, setResponse] = useState('');
  const [activities, setActivities] = useState<AiActivity[]>([]);
  const [pendingRequest, setPendingRequest] = useState<ServerRequest | null>(null);
  const [deviceCode, setDeviceCode] = useState<string | null>(null);
  const [lastPrompt, setLastPrompt] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const activitySequence = useRef(0);

  const loadWorkspace = async (): Promise<void> => {
    const next = await window.narra.codexGetWorkspace(projectId);
    setWorkspace(next);
    setModel(next.settings.desiredModel);
    setEffort(next.settings.desiredEffort);
  };

  const refreshConnection = async (): Promise<void> => {
    setConnectionError(null);
    const [accountResult, modelsResult, rateResult] = await Promise.allSettled([
      window.narra.codexReadAccount(),
      window.narra.codexListModels(),
      window.narra.codexReadRateLimits(),
    ]);
    if (accountResult.status === 'fulfilled') {
      setAccount(accountResult.value);
      if (accountResult.value.signedIn) setConnectionNotice(null);
    }
    else setConnectionError(accountResult.reason instanceof Error ? accountResult.reason.message : 'Không thể kết nối với Codex.');
    if (modelsResult.status === 'fulfilled') setModels(modelsResult.value);
    if (rateResult.status === 'fulfilled') setRateLimits(rateResult.value);
  };

  useEffect(() => {
    setLoading(true);
    Promise.all([loadWorkspace(), refreshConnection()])
      .catch((reason: unknown) => setConnectionError(reason instanceof Error ? reason.message : 'Không thể tải không gian AI.'))
      .finally(() => setLoading(false));
  }, [projectId]);

  useEffect(() => window.narra.onCodexEvent((event) => {
    const delta = getAgentDelta(event);
    if (delta) setResponse((current) => current + delta);
    const completion = getTurnCompletion(event);
    if (completion) {
      setRunState(completion);
      void loadWorkspace();
    }
    if (event.type === 'serverRequest' && (typeof event.id === 'number' || typeof event.id === 'string') && typeof event.method === 'string') {
      setPendingRequest({id: event.id, method: event.method, params: event.params});
      setRunState('RUNNING');
      return;
    }
    const activity = toAiActivity(event, ++activitySequence.current);
    if (activity) setActivities((current) => [...current.slice(-99), activity]);
  }), [projectId]);

  useEffect(() => {
    if (runState !== 'STARTING' && runState !== 'RUNNING') return;
    const timer = window.setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [runState]);

  const selectedModel = models.find(({id}) => id === model);
  const availableEfforts = selectedModel?.supportedReasoningEfforts ?? [];
  const modelAvailable = Boolean(selectedModel && availableEfforts.some(({reasoningEffort}) => reasoningEffort === effort));
  const isRunning = runState === 'STARTING' || runState === 'RUNNING';
  const sources = useMemo(() => {
    const seen = new Set<string>();
    return activities.filter((activity) => activity.url && !seen.has(activity.url) && seen.add(activity.url));
  }, [activities]);

  const saveSettings = async (nextModel: string, nextEffort: AiReasoningEffort): Promise<void> => {
    try {
      await window.narra.codexUpdateSettings(projectId, {desiredModel: nextModel, desiredEffort: nextEffort});
      await loadWorkspace();
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : 'Không thể lưu thiết lập model.');
    }
  };

  const submitPrompt = async (prompt: string): Promise<void> => {
    setFormError(null);
    setResponse('');
    setActivities([]);
    setElapsed(0);
    setPendingRequest(null);
    setRunState('STARTING');
    setLastPrompt(prompt);
    try {
      await window.narra.codexStartTurn(projectId, {text: prompt, stage});
      setRunState('RUNNING');
      await loadWorkspace();
    } catch (reason) {
      setRunState('FAILED');
      setFormError(reason instanceof Error ? reason.message : 'Không thể bắt đầu lượt chạy Codex.');
      await loadWorkspace();
    }
  };

  const currentPrompt = buildPrompt({request, audience, language: outputLanguage, durationMin, format, style, stage});

  if (loading) {
    return <section className="ai-workspace ai-loading"><LoaderCircle className="spin" aria-hidden="true" size={24} /><p>Đang kết nối không gian AI trên máy…</p></section>;
  }

  return (
    <section className="ai-workspace">
      <header className="ai-toolbar">
        <div><p className="section-label"><Sparkles aria-hidden="true" size={14} /> Không gian AI</p><h3>Nghiên cứu và phát triển câu chuyện ngay trong Narra</h3><p>Sử dụng gói ChatGPT của anh qua Codex App Server trên máy.</p></div>
        <div className="ai-connection-actions">
          <span className={`connection-pill ${account?.signedIn ? 'ready' : 'offline'}`}>
            {account?.signedIn ? <CheckCircle2 aria-hidden="true" size={14} /> : <TriangleAlert aria-hidden="true" size={14} />}
            {account?.signedIn ? `Đã kết nối ${account.planType ?? 'ChatGPT'}` : 'Cần đăng nhập'}
          </span>
          <button className="secondary icon-button" aria-label="Làm mới kết nối Codex" onClick={() => void refreshConnection()}><RefreshCw aria-hidden="true" size={16} /></button>
        </div>
      </header>

      {connectionError && <div className="notice error-notice" role="alert"><TriangleAlert aria-hidden="true" size={17} /> <span>{connectionError}</span></div>}
      {connectionNotice && <div className="notice progress-notice" role="status"><LogIn aria-hidden="true" size={17} /> <span>{connectionNotice}</span></div>}
      {!account?.signedIn && (
        <section className="ai-login-card">
          <div><p className="section-label">Kết nối ChatGPT</p><h4>Kết nối Codex để tiếp tục</h4><p>Codex xử lý việc xác thực. Narra không lưu thông tin đăng nhập của anh.</p></div>
          <div className="ai-login-actions">
            <button className="primary" onClick={() => void window.narra.codexStartBrowserLogin().then(() => setConnectionNotice('Hoàn tất đăng nhập trong trình duyệt, sau đó làm mới kết nối.')).catch((reason: unknown) => setConnectionError(reason instanceof Error ? reason.message : 'Không thể bắt đầu đăng nhập.'))}><LogIn aria-hidden="true" size={16} /> Đăng nhập bằng trình duyệt</button>
            <button className="secondary" onClick={() => void window.narra.codexStartDeviceLogin().then((result) => setDeviceCode(result.userCode ?? null)).catch((reason: unknown) => setConnectionError(reason instanceof Error ? reason.message : 'Không thể bắt đầu đăng nhập thiết bị.'))}>Dùng mã thiết bị</button>
          </div>
          {deviceCode && <p className="device-code">Mã thiết bị: <strong>{deviceCode}</strong></p>}
        </section>
      )}

      <div className="ai-layout">
        <form className="ai-composer" onSubmit={(event) => { event.preventDefault(); void submitPrompt(currentPrompt); }}>
          <div className="ai-section-heading"><div><p className="section-label"><Bot aria-hidden="true" size={14} /> Prompt</p><h4>Đề bài sáng tạo</h4></div><span>{request.trim().length} ký tự</span></div>
          <label htmlFor="ai-stage">Giai đoạn công việc<select id="ai-stage" value={stage} onChange={(event) => setStage(event.target.value as AiStage)}>{stageOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          <label htmlFor="ai-request">Anh muốn Codex thực hiện việc gì?<textarea id="ai-request" rows={7} required value={request} onChange={(event) => setRequest(event.target.value)} placeholder="Mô tả câu hỏi phim tài liệu, góc tiếp cận hoặc nhiệm vụ nghiên cứu." /><small>Nêu rõ quyết định anh cần nhận được từ lượt chạy này.</small></label>
          <div className="ai-form-grid">
            <label htmlFor="ai-audience">Khán giả<input id="ai-audience" required value={audience} onChange={(event) => setAudience(event.target.value)} /></label>
            <label htmlFor="ai-language">Ngôn ngữ đầu ra<input id="ai-language" required value={outputLanguage} onChange={(event) => setOutputLanguage(event.target.value)} /></label>
            <label htmlFor="ai-duration">Thời lượng (phút)<input id="ai-duration" min={1} max={60} type="number" value={durationMin} onChange={(event) => setDurationMin(Number(event.target.value))} /></label>
            <label htmlFor="ai-format">Định dạng<select id="ai-format" value={format} onChange={(event) => setFormat(event.target.value)}><option value="Cinematic explainer">Phim giải thích điện ảnh</option><option value="Mini-documentary">Phim tài liệu ngắn</option><option value="Investigative essay">Tiểu luận điều tra</option><option value="Historical narrative">Tự sự lịch sử</option></select></label>
          </div>
          <label htmlFor="ai-style">Phong cách<input id="ai-style" required value={style} onChange={(event) => setStyle(event.target.value)} /></label>

          <fieldset className="ai-model-settings">
            <legend><Settings2 aria-hidden="true" size={15} /> Thiết lập model</legend>
            <div className="ai-form-grid">
              <label htmlFor="ai-model">Model<select id="ai-model" value={model} onChange={(event) => {
                const nextModel = event.target.value;
                const next = models.find(({id}) => id === nextModel);
                const nextEffort = (next?.supportedReasoningEfforts.some((item) => item.reasoningEffort === effort) ? effort : next?.defaultReasoningEffort ?? 'medium') as AiReasoningEffort;
                setModel(nextModel); setEffort(nextEffort); void saveSettings(nextModel, nextEffort);
              }}>{models.map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}</select></label>
              <label htmlFor="ai-effort">Mức suy luận<select id="ai-effort" value={effort} onChange={(event) => { const next = event.target.value as AiReasoningEffort; setEffort(next); void saveSettings(model, next); }}>{availableEfforts.map((item) => <option key={item.reasoningEffort} value={item.reasoningEffort}>{item.reasoningEffort}</option>)}</select></label>
            </div>
            <div className="model-meta"><span><Gauge aria-hidden="true" size={14} /> {summarizeRateLimits(rateLimits)}</span><span>{selectedModel?.description || 'Chọn một model khả dụng.'}</span></div>
          </fieldset>

          {!modelAvailable && <p className="field-error" role="alert">Model và mức suy luận đã chọn không khả dụng. Hãy chọn một tổ hợp trong danh sách.</p>}
          {formError && <p className="field-error" role="alert">{formError}</p>}
          <div className="composer-actions">
            <button className="primary run-button" disabled={!account?.signedIn || !modelAvailable || !request.trim() || isRunning} type="submit">
              {isRunning ? <LoaderCircle className="spin" aria-hidden="true" size={17} /> : <Play aria-hidden="true" size={17} />}
              {isRunning ? 'Codex đang làm việc' : 'Bắt đầu chạy AI'}
            </button>
            {isRunning && <button className="danger" type="button" onClick={() => void window.narra.codexInterruptTurn(projectId)}><CircleStop aria-hidden="true" size={16} /> Dừng</button>}
            {!isRunning && lastPrompt && <button className="secondary" type="button" onClick={() => void submitPrompt(lastPrompt)}><RotateCcw aria-hidden="true" size={16} /> Chạy lại lượt gần nhất</button>}
          </div>
        </form>

        <div className="ai-run-column">
          <section className="ai-run-panel" aria-live="polite">
            <header><div><p className="section-label"><Activity aria-hidden="true" size={14} /> Lượt chạy hiện tại</p><h4>{runStatusLabel(runState)}</h4></div><span className={`run-state ${runState.toLowerCase()}`}>{runStatusLabel(runState)}</span></header>
            <div className="run-metrics"><span><Clock3 aria-hidden="true" size={14} /> {formatElapsed(elapsed)}</span><span>{model} · {effort}</span><span>{stageOptions.find((item) => item.value === stage)?.label}</span></div>
            {pendingRequest && <ServerRequestPanel request={pendingRequest} onResolved={() => setPendingRequest(null)} />}
            <div className={`agent-response ${response ? '' : 'empty-response'}`}>
              <div className="response-heading"><MessageSquareText aria-hidden="true" size={16} /><strong>Phản hồi từ Codex</strong></div>
              {response ? <FormattedResponse content={response} /> : <p>Bắt đầu một lượt chạy để xem phản hồi trực tiếp tại đây.</p>}
            </div>
          </section>

          <section className="ai-activity-panel">
            <header><div><p className="section-label"><Search aria-hidden="true" size={14} /> Hoạt động</p><h4>Tiến trình nghiên cứu và công cụ</h4></div><span>{activities.length}</span></header>
            <div className="activity-list">
              {activities.length === 0 && <p className="activity-empty">Hoạt động tìm kiếm và công cụ sẽ xuất hiện tại đây mà không hiển thị suy luận thô của model.</p>}
              {activities.map((activity) => (
                <article className={`activity-item ${activity.kind}`} key={activity.id}>
                  {activity.kind === 'search' ? <Globe2 aria-hidden="true" size={16} /> : activity.kind === 'error' ? <TriangleAlert aria-hidden="true" size={16} /> : <Activity aria-hidden="true" size={16} />}
                  <div><strong>{activity.title}</strong><p>{activity.detail}</p></div>
                  {activity.url && <button className="source-link" aria-label={`Mở nguồn ${activity.detail}`} onClick={() => void window.narra.openExternalUrl(activity.url!)}><ExternalLink aria-hidden="true" size={15} /></button>}
                </article>
              ))}
            </div>
          </section>

          {sources.length > 0 && <section className="ai-sources-panel"><header><p className="section-label"><Globe2 aria-hidden="true" size={14} /> Nguồn đã mở</p><span>{sources.length}</span></header>{sources.map((source) => <button key={source.url} onClick={() => void window.narra.openExternalUrl(source.url!)}><span>{source.detail}</span><ExternalLink aria-hidden="true" size={15} /></button>)}</section>}

          <section className="ai-history-panel">
            <header><div><p className="section-label">Lượt chạy gần đây</p><h4>Lịch sử dự án</h4></div><span>{workspace?.runs.length ?? 0}</span></header>
            {(workspace?.runs.length ?? 0) === 0 ? <p className="activity-empty">Dự án này chưa lưu lượt chạy AI nào.</p> : workspace?.runs.slice(0, 6).map((run: AiRun) => <article key={run.id}><span className={`run-dot ${run.status.toLowerCase()}`} /><div><strong>{stageOptions.find((item) => item.value === run.stage)?.label ?? run.stage}</strong><p>{run.prompt}</p></div><small>{runStatusLabel(run.status as RunState)}</small></article>)}
          </section>
        </div>
      </div>
    </section>
  );
};
