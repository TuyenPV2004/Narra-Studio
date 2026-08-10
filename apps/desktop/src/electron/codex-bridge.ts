import {spawn, type ChildProcessWithoutNullStreams} from 'node:child_process';
import {EventEmitter} from 'node:events';
import {createInterface} from 'node:readline';

export const DEFAULT_CODEX_MODEL = 'gpt-5.6-sol';
export const DEFAULT_CODEX_EFFORT = 'medium';

type JsonRpcId = number | string;

type JsonRpcError = {
  code: number;
  message: string;
  data?: unknown;
};

type JsonRpcMessage = {
  id?: JsonRpcId;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: JsonRpcError;
};

type PendingRequest = {
  method: string;
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

export type CodexBridgeNotification = {
  method: string;
  params: unknown;
};

export type CodexAccountSummary = {
  signedIn: boolean;
  accountType: string | null;
  planType: string | null;
};

export type CodexReasoningEffort = {
  reasoningEffort: string;
  description?: string;
};

export type CodexModelSummary = {
  id: string;
  displayName: string;
  description: string;
  supportedReasoningEfforts: CodexReasoningEffort[];
  defaultReasoningEffort: string | null;
};

export type CodexLoginStart = {
  loginId: string;
  authUrl?: string;
  verificationUrl?: string;
  userCode?: string;
};

export type CodexThreadSummary = {threadId: string};
export type CodexTurnSummary = {turnId: string};

export class CodexBridgeError extends Error {
  readonly code: string;
  readonly details?: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'CodexBridgeError';
    this.code = code;
    this.details = details;
  }
}

export type CodexBridgeOptions = {
  executable?: string;
  requestTimeoutMs?: number;
  spawnProcess?: () => ChildProcessWithoutNullStreams;
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? value as Record<string, unknown> : {};

const asString = (value: unknown): string | null => typeof value === 'string' && value.length > 0 ? value : null;

const appServerErrorCode = (method: string): string => {
  if (method.startsWith('account/')) return 'SIGNED_OUT';
  if (method === 'model/list') return 'MODEL_UNAVAILABLE';
  return 'APP_SERVER_ERROR';
};

export class CodexBridge extends EventEmitter {
  private readonly options: {
    executable: string;
    requestTimeoutMs: number;
    spawnProcess: (() => ChildProcessWithoutNullStreams) | undefined;
  };
  private process: ChildProcessWithoutNullStreams | null = null;
  private startPromise: Promise<void> | null = null;
  private nextRequestId = 1;
  private readonly pending = new Map<JsonRpcId, PendingRequest>();
  private closing = false;

  constructor(options: CodexBridgeOptions = {}) {
    super();
    this.options = {
      executable: options.executable ?? 'codex',
      requestTimeoutMs: options.requestTimeoutMs ?? 30_000,
      spawnProcess: options.spawnProcess,
    };
  }

  async start(): Promise<void> {
    if (this.process) return;
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.startProcess();
    try {
      await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  private async startProcess(): Promise<void> {
    this.closing = false;
    const useWindowsAlias = process.platform === 'win32' && this.options.executable === 'codex';
    const child = this.options.spawnProcess?.() ?? spawn(
      useWindowsAlias ? process.env.ComSpec || 'cmd.exe' : this.options.executable,
      useWindowsAlias ? ['/d', '/s', '/c', 'codex app-server'] : ['app-server'],
      {stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true},
    );
    this.process = child;

    const lines = createInterface({input: child.stdout, crlfDelay: Infinity});
    lines.on('line', (line) => this.handleLine(line));
    child.stderr.resume();
    child.once('error', (error) => this.handleProcessError(error));
    child.once('exit', (code, signal) => this.handleProcessExit(code, signal));

    try {
      await this.request('initialize', {
        clientInfo: {name: 'narra_studio', title: 'Narra Studio', version: '0.1.0'},
      });
      this.notify('initialized');
      this.emit('status', {status: 'READY'});
    } catch (error) {
      this.close();
      throw error;
    }
  }

  private handleLine(line: string): void {
    if (!line.trim()) return;
    let message: JsonRpcMessage;
    try {
      message = JSON.parse(line) as JsonRpcMessage;
    } catch {
      this.emit('protocolError', new CodexBridgeError('APP_SERVER_ERROR', 'Codex App Server returned invalid JSON.'));
      return;
    }

    if (message.id !== undefined && !message.method) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timeout);
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new CodexBridgeError(
          appServerErrorCode(pending.method),
          message.error.message,
          {rpcCode: message.error.code, data: message.error.data},
        ));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (message.method) {
      const notification = {method: message.method, params: message.params ?? null};
      this.emit('notification', notification satisfies CodexBridgeNotification);
      if (message.id !== undefined) {
        this.emit('serverRequest', {...notification, id: message.id});
      }
    }
  }

  private handleProcessError(error: NodeJS.ErrnoException): void {
    const bridgeError = new CodexBridgeError(
      ['ENOENT', 'EACCES', 'EPERM'].includes(error.code ?? '') ? 'CODEX_NOT_FOUND' : 'APP_SERVER_ERROR',
      ['ENOENT', 'EACCES', 'EPERM'].includes(error.code ?? '')
        ? 'Không tìm thấy Codex CLI. Hãy cài hoặc cấu hình đường dẫn Codex rồi thử lại.'
        : `Không thể khởi động Codex App Server: ${error.message}`,
    );
    this.rejectAll(bridgeError);
    this.process = null;
    this.emit('status', {status: bridgeError.code});
  }

  private handleProcessExit(code: number | null, signal: NodeJS.Signals | null): void {
    this.process = null;
    if (this.closing) return;
    const error = new CodexBridgeError(
      'APP_SERVER_ERROR',
      `Codex App Server đã dừng ngoài dự kiến (code=${String(code)}, signal=${String(signal)}).`,
    );
    this.rejectAll(error);
    this.emit('status', {status: 'ERROR'});
  }

  private rejectAll(error: Error): void {
    for (const request of this.pending.values()) {
      clearTimeout(request.timeout);
      request.reject(error);
    }
    this.pending.clear();
  }

  private async request<T>(method: string, params?: unknown): Promise<T> {
    const child = this.process;
    if (!child) throw new CodexBridgeError('APP_SERVER_ERROR', 'Codex App Server chưa sẵn sàng.');
    const id = this.nextRequestId++;
    const response = new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new CodexBridgeError('APP_SERVER_ERROR', `Codex App Server không phản hồi ${method} đúng hạn.`));
      }, this.options.requestTimeoutMs);
      this.pending.set(id, {method, resolve: (value) => resolve(value as T), reject, timeout});
    });
    child.stdin.write(`${JSON.stringify({method, id, params: params ?? {}})}\n`);
    return response;
  }

  private notify(method: string, params?: unknown): void {
    if (!this.process) return;
    this.process.stdin.write(`${JSON.stringify({method, params: params ?? {}})}\n`);
  }

  private async readyRequest<T>(method: string, params?: unknown): Promise<T> {
    await this.start();
    return this.request<T>(method, params);
  }

  async readAccount(): Promise<CodexAccountSummary> {
    const result = asRecord(await this.readyRequest('account/read', {refreshToken: false}));
    const account = asRecord(result.account);
    return {
      signedIn: Object.keys(account).length > 0,
      accountType: asString(account.type),
      planType: asString(account.planType),
    };
  }

  async startBrowserLogin(): Promise<CodexLoginStart> {
    return this.parseLoginStart(await this.readyRequest('account/login/start', {
      type: 'chatgpt',
      useHostedLoginSuccessPage: true,
    }));
  }

  async startDeviceLogin(): Promise<CodexLoginStart> {
    return this.parseLoginStart(await this.readyRequest('account/login/start', {type: 'chatgptDeviceCode'}));
  }

  private parseLoginStart(value: unknown): CodexLoginStart {
    const result = asRecord(value);
    const loginId = asString(result.loginId);
    if (!loginId) throw new CodexBridgeError('APP_SERVER_ERROR', 'Codex không trả về loginId hợp lệ.');
    return {
      loginId,
      ...(asString(result.authUrl) ? {authUrl: asString(result.authUrl)!} : {}),
      ...(asString(result.verificationUrl) ? {verificationUrl: asString(result.verificationUrl)!} : {}),
      ...(asString(result.userCode) ? {userCode: asString(result.userCode)!} : {}),
    };
  }

  async listModels(): Promise<CodexModelSummary[]> {
    const result = asRecord(await this.readyRequest('model/list', {}));
    const models = Array.isArray(result.data) ? result.data : [];
    return models.map((value) => {
      const model = asRecord(value);
      const id = asString(model.id) ?? asString(model.model) ?? '';
      const efforts = Array.isArray(model.supportedReasoningEfforts)
        ? model.supportedReasoningEfforts.map((effort) => {
            const item = asRecord(effort);
            return {
              reasoningEffort: asString(item.reasoningEffort) ?? '',
              ...(asString(item.description) ? {description: asString(item.description)!} : {}),
            };
          }).filter(({reasoningEffort}) => reasoningEffort.length > 0)
        : [];
      return {
        id,
        displayName: asString(model.displayName) ?? id,
        description: asString(model.description) ?? '',
        supportedReasoningEfforts: efforts,
        defaultReasoningEffort: asString(model.defaultReasoningEffort),
      };
    }).filter(({id}) => id.length > 0);
  }

  async assertModelAvailable(modelId = DEFAULT_CODEX_MODEL, effort = DEFAULT_CODEX_EFFORT): Promise<void> {
    const models = await this.listModels();
    const model = models.find(({id}) => id === modelId);
    if (!model) {
      throw new CodexBridgeError(
        'MODEL_UNAVAILABLE',
        `Model ${modelId} không khả dụng. Các model hiện có: ${models.map(({id}) => id).join(', ') || 'không có'}.`,
      );
    }
    if (!model.supportedReasoningEfforts.some(({reasoningEffort}) => reasoningEffort === effort)) {
      throw new CodexBridgeError(
        'MODEL_UNAVAILABLE',
        `Mức reasoning ${effort} không khả dụng cho ${modelId}. Các mức hiện có: ${model.supportedReasoningEfforts.map(({reasoningEffort}) => reasoningEffort).join(', ') || 'không có'}.`,
      );
    }
  }

  async startThread(input: {cwd: string; model?: string}): Promise<CodexThreadSummary> {
    const result = asRecord(await this.readyRequest('thread/start', {
      cwd: input.cwd,
      model: input.model ?? DEFAULT_CODEX_MODEL,
      approvalPolicy: 'never',
      sandbox: 'read-only',
      serviceName: 'narra_studio',
    }));
    const threadId = asString(asRecord(result.thread).id);
    if (!threadId) throw new CodexBridgeError('APP_SERVER_ERROR', 'Codex không trả về threadId hợp lệ.');
    return {threadId};
  }

  async resumeThread(threadId: string): Promise<CodexThreadSummary> {
    const result = asRecord(await this.readyRequest('thread/resume', {threadId}));
    const resumedId = asString(asRecord(result.thread).id) ?? threadId;
    return {threadId: resumedId};
  }

  async startTurn(input: {
    threadId: string;
    text: string;
    cwd: string;
    model?: string;
    effort?: string;
  }): Promise<CodexTurnSummary> {
    if (!input.text.trim()) throw new CodexBridgeError('APP_SERVER_ERROR', 'Prompt không được để trống.');
    const result = asRecord(await this.readyRequest('turn/start', {
      threadId: input.threadId,
      input: [{type: 'text', text: input.text.trim()}],
      cwd: input.cwd,
      approvalPolicy: 'never',
      sandboxPolicy: {type: 'readOnly'},
      model: input.model ?? DEFAULT_CODEX_MODEL,
      effort: input.effort ?? DEFAULT_CODEX_EFFORT,
    }));
    const turnId = asString(asRecord(result.turn).id);
    if (!turnId) throw new CodexBridgeError('APP_SERVER_ERROR', 'Codex không trả về turnId hợp lệ.');
    return {turnId};
  }

  async interruptTurn(threadId: string, turnId: string): Promise<void> {
    await this.readyRequest('turn/interrupt', {threadId, turnId});
  }

  async readRateLimits(): Promise<unknown> {
    return this.readyRequest('account/rateLimits/read', {});
  }

  close(): void {
    this.closing = true;
    const child = this.process;
    this.process = null;
    this.rejectAll(new CodexBridgeError('APP_SERVER_ERROR', 'Codex App Server đã đóng.'));
    if (!child) return;
    child.stdin.end();
    if (!child.killed) child.kill();
  }
}
