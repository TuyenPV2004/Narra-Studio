import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createInterface } from 'node:readline';
export const DEFAULT_CODEX_MODEL = 'gpt-5.6-sol';
export const DEFAULT_CODEX_EFFORT = 'medium';
export class CodexBridgeError extends Error {
    code;
    details;
    constructor(code, message, details) {
        super(message);
        this.name = 'CodexBridgeError';
        this.code = code;
        this.details = details;
    }
}
const asRecord = (value) => value && typeof value === 'object' ? value : {};
const asString = (value) => typeof value === 'string' && value.length > 0 ? value : null;
const appServerErrorCode = (method) => {
    if (method === 'account/rateLimits/read')
        return 'RATE_LIMITED';
    if (method.startsWith('account/'))
        return 'SIGNED_OUT';
    if (method === 'model/list')
        return 'MODEL_UNAVAILABLE';
    return 'APP_SERVER_ERROR';
};
export class CodexBridge extends EventEmitter {
    options;
    process = null;
    startPromise = null;
    nextRequestId = 1;
    pending = new Map();
    closing = false;
    constructor(options = {}) {
        super();
        this.options = {
            executable: options.executable ?? 'codex',
            requestTimeoutMs: options.requestTimeoutMs ?? 30_000,
            spawnProcess: options.spawnProcess,
        };
    }
    async start() {
        if (this.process)
            return;
        if (this.startPromise)
            return this.startPromise;
        this.startPromise = this.startProcess();
        try {
            await this.startPromise;
        }
        finally {
            this.startPromise = null;
        }
    }
    async startProcess() {
        this.closing = false;
        const useWindowsAlias = process.platform === 'win32' && this.options.executable === 'codex';
        const child = this.options.spawnProcess?.() ?? spawn(useWindowsAlias ? process.env.ComSpec || 'cmd.exe' : this.options.executable, useWindowsAlias ? ['/d', '/s', '/c', 'codex app-server'] : ['app-server'], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
        this.process = child;
        const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
        lines.on('line', (line) => this.handleLine(line));
        child.stderr.resume();
        child.once('error', (error) => this.handleProcessError(error));
        child.once('exit', (code, signal) => this.handleProcessExit(code, signal));
        try {
            await this.request('initialize', {
                clientInfo: { name: 'narra_studio', title: 'Narra Studio', version: '0.1.0' },
                capabilities: { experimentalApi: true },
            });
            this.notify('initialized');
            this.emit('status', { status: 'READY' });
        }
        catch (error) {
            this.close();
            throw error;
        }
    }
    handleLine(line) {
        if (!line.trim())
            return;
        let message;
        try {
            message = JSON.parse(line);
        }
        catch {
            this.emit('protocolError', new CodexBridgeError('APP_SERVER_ERROR', 'Codex App Server returned invalid JSON.'));
            return;
        }
        if (message.id !== undefined && !message.method) {
            const pending = this.pending.get(message.id);
            if (!pending)
                return;
            clearTimeout(pending.timeout);
            this.pending.delete(message.id);
            if (message.error) {
                pending.reject(new CodexBridgeError(appServerErrorCode(pending.method), message.error.message, { rpcCode: message.error.code, data: message.error.data }));
            }
            else {
                pending.resolve(message.result);
            }
            return;
        }
        if (message.method) {
            const notification = { method: message.method, params: message.params ?? null };
            if (message.id !== undefined) {
                this.emit('serverRequest', { ...notification, id: message.id });
            }
            else {
                this.emit('notification', notification);
            }
        }
    }
    handleProcessError(error) {
        const bridgeError = new CodexBridgeError(['ENOENT', 'EACCES', 'EPERM'].includes(error.code ?? '') ? 'CODEX_NOT_FOUND' : 'APP_SERVER_ERROR', ['ENOENT', 'EACCES', 'EPERM'].includes(error.code ?? '')
            ? 'Không tìm thấy Codex CLI. Hãy cài hoặc cấu hình đường dẫn Codex rồi thử lại.'
            : `Không thể khởi động Codex App Server: ${error.message}`);
        this.rejectAll(bridgeError);
        this.process = null;
        this.emit('status', { status: bridgeError.code });
    }
    handleProcessExit(code, signal) {
        this.process = null;
        if (this.closing)
            return;
        const error = new CodexBridgeError('APP_SERVER_ERROR', `Codex App Server đã dừng ngoài dự kiến (code=${String(code)}, signal=${String(signal)}).`);
        this.rejectAll(error);
        this.emit('status', { status: 'ERROR' });
    }
    rejectAll(error) {
        for (const request of this.pending.values()) {
            clearTimeout(request.timeout);
            request.reject(error);
        }
        this.pending.clear();
    }
    async request(method, params) {
        const child = this.process;
        if (!child)
            throw new CodexBridgeError('APP_SERVER_ERROR', 'Codex App Server chưa sẵn sàng.');
        const id = this.nextRequestId++;
        const response = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pending.delete(id);
                reject(new CodexBridgeError('APP_SERVER_ERROR', `Codex App Server không phản hồi ${method} đúng hạn.`));
            }, this.options.requestTimeoutMs);
            this.pending.set(id, { method, resolve: (value) => resolve(value), reject, timeout });
        });
        child.stdin.write(`${JSON.stringify({ method, id, params: params ?? {} })}\n`);
        return response;
    }
    notify(method, params) {
        if (!this.process)
            return;
        this.process.stdin.write(`${JSON.stringify({ method, params: params ?? {} })}\n`);
    }
    async readyRequest(method, params) {
        await this.start();
        return this.request(method, params);
    }
    async readAccount() {
        const result = asRecord(await this.readyRequest('account/read', { refreshToken: false }));
        const account = asRecord(result.account);
        return {
            signedIn: Object.keys(account).length > 0,
            accountType: asString(account.type),
            planType: asString(account.planType),
        };
    }
    async startBrowserLogin() {
        return this.parseLoginStart(await this.readyRequest('account/login/start', {
            type: 'chatgpt',
            useHostedLoginSuccessPage: true,
        }));
    }
    async startDeviceLogin() {
        return this.parseLoginStart(await this.readyRequest('account/login/start', { type: 'chatgptDeviceCode' }));
    }
    parseLoginStart(value) {
        const result = asRecord(value);
        const loginId = asString(result.loginId);
        if (!loginId)
            throw new CodexBridgeError('APP_SERVER_ERROR', 'Codex không trả về loginId hợp lệ.');
        return {
            loginId,
            ...(asString(result.authUrl) ? { authUrl: asString(result.authUrl) } : {}),
            ...(asString(result.verificationUrl) ? { verificationUrl: asString(result.verificationUrl) } : {}),
            ...(asString(result.userCode) ? { userCode: asString(result.userCode) } : {}),
        };
    }
    async listModels() {
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
                        ...(asString(item.description) ? { description: asString(item.description) } : {}),
                    };
                }).filter(({ reasoningEffort }) => reasoningEffort.length > 0)
                : [];
            return {
                id,
                displayName: asString(model.displayName) ?? id,
                description: asString(model.description) ?? '',
                supportedReasoningEfforts: efforts,
                defaultReasoningEffort: asString(model.defaultReasoningEffort),
            };
        }).filter(({ id }) => id.length > 0);
    }
    async assertModelAvailable(modelId = DEFAULT_CODEX_MODEL, effort = DEFAULT_CODEX_EFFORT) {
        const models = await this.listModels();
        const model = models.find(({ id }) => id === modelId);
        if (!model) {
            throw new CodexBridgeError('MODEL_UNAVAILABLE', `Model ${modelId} không khả dụng. Các model hiện có: ${models.map(({ id }) => id).join(', ') || 'không có'}.`);
        }
        if (!model.supportedReasoningEfforts.some(({ reasoningEffort }) => reasoningEffort === effort)) {
            throw new CodexBridgeError('MODEL_UNAVAILABLE', `Mức reasoning ${effort} không khả dụng cho ${modelId}. Các mức hiện có: ${model.supportedReasoningEfforts.map(({ reasoningEffort }) => reasoningEffort).join(', ') || 'không có'}.`);
        }
    }
    async startThread(input) {
        const result = asRecord(await this.readyRequest('thread/start', {
            cwd: input.cwd,
            model: input.model ?? DEFAULT_CODEX_MODEL,
            approvalPolicy: 'never',
            sandbox: 'read-only',
            serviceName: 'narra_studio',
        }));
        const threadId = asString(asRecord(result.thread).id);
        if (!threadId)
            throw new CodexBridgeError('APP_SERVER_ERROR', 'Codex không trả về threadId hợp lệ.');
        return { threadId };
    }
    async resumeThread(threadId) {
        const result = asRecord(await this.readyRequest('thread/resume', { threadId }));
        const resumedId = asString(asRecord(result.thread).id) ?? threadId;
        return { threadId: resumedId };
    }
    async listSkills(cwd, forceReload = false) {
        const result = asRecord(await this.readyRequest('skills/list', { cwds: [cwd], forceReload }));
        const entries = Array.isArray(result.data) ? result.data : [];
        const skills = entries.flatMap((entry) => {
            const record = asRecord(entry);
            const values = Array.isArray(record.skills) ? record.skills : [record];
            return values.map((value) => {
                const skill = asRecord(value);
                return {
                    name: asString(skill.name) ?? '',
                    path: asString(skill.path) ?? '',
                    description: asString(skill.description) ?? '',
                };
            });
        });
        return skills.filter(({ name, path }) => name.length > 0 && path.length > 0);
    }
    async startTurn(input) {
        if (!input.text.trim())
            throw new CodexBridgeError('APP_SERVER_ERROR', 'Prompt không được để trống.');
        const result = asRecord(await this.readyRequest('turn/start', {
            threadId: input.threadId,
            input: [
                { type: 'text', text: input.text.trim() },
                ...(input.skill ? [{ type: 'skill', name: input.skill.name, path: input.skill.path }] : []),
            ],
            cwd: input.cwd,
            approvalPolicy: 'never',
            sandboxPolicy: { type: 'readOnly' },
            model: input.model ?? DEFAULT_CODEX_MODEL,
            effort: input.effort ?? DEFAULT_CODEX_EFFORT,
            ...(input.outputSchema ? { outputSchema: input.outputSchema } : {}),
        }));
        const turnId = asString(asRecord(result.turn).id);
        if (!turnId)
            throw new CodexBridgeError('APP_SERVER_ERROR', 'Codex không trả về turnId hợp lệ.');
        return { turnId };
    }
    async interruptTurn(threadId, turnId) {
        await this.readyRequest('turn/interrupt', { threadId, turnId });
    }
    async readRateLimits() {
        return this.readyRequest('account/rateLimits/read', {});
    }
    async respondToServerRequest(id, result) {
        await this.start();
        if (!this.process)
            throw new CodexBridgeError('APP_SERVER_ERROR', 'Codex App Server chưa sẵn sàng.');
        this.process.stdin.write(`${JSON.stringify({ id, result })}\n`);
    }
    close() {
        this.closing = true;
        const child = this.process;
        this.process = null;
        this.rejectAll(new CodexBridgeError('APP_SERVER_ERROR', 'Codex App Server đã đóng.'));
        if (!child)
            return;
        child.stdin.end();
        if (!child.killed)
            child.kill();
    }
}
