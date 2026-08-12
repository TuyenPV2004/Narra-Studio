import {EventEmitter} from 'node:events';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {BrowserWindow, session, type Session} from 'electron';
import type {FlowAccount, FlowAutomationJob, FlowGenerationRequest} from './provider-types.js';

const FLOW_URL = 'https://labs.google/fx/tools/flow';
const TERMINAL = new Set(['COMPLETED', 'TERMINAL_FAILED', 'CANCELLED']);
const CLEAN_UA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome || '130.0.0.0'} Safari/537.36`;

const isoNow = (): string => new Date().toISOString();
const safeToken = (value: string): string => value.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 100) || 'narra-flow';
const validSlotId = (value: number, maxSlots: number): number => {
  if (!Number.isInteger(value) || value < 0 || value >= maxSlots) throw new Error(`Flow slot phải nằm trong khoảng 0-${maxSlots - 1}.`);
  return value;
};

type SlotRuntime = {
  account: FlowAccount;
  window: BrowserWindow | null;
  sessionConfigured: boolean;
};

type FlowAutomationEvents = {
  'job-updated': [FlowAutomationJob];
  'accounts-updated': [FlowAccount[]];
};

export class FlowAutomationManager extends EventEmitter<FlowAutomationEvents> {
  private readonly maxSlots: number;
  private readonly statePath: string;
  private readonly slots: SlotRuntime[];
  private readonly jobs = new Map<string, FlowAutomationJob>();
  private readonly activeJobBySlot = new Map<number, string>();
  private pumping = false;

  constructor(userDataDirectory: string, maxSlots = 5) {
    super();
    this.maxSlots = Math.max(1, Math.min(10, Math.floor(maxSlots)));
    this.statePath = path.join(userDataDirectory, 'narra-flow-jobs.json');
    this.slots = Array.from({length: this.maxSlots}, (_, id) => ({
      window: null,
      sessionConfigured: false,
      account: {
        id,
        partition: `persist:narra-flow-slot-${id}`,
        status: 'EMPTY',
        cookieCount: 0,
        activeJobCount: 0,
        lastUsedAt: null,
        error: null,
      },
    }));
    this.restoreJobs();
  }

  async listAccounts(): Promise<FlowAccount[]> {
    await Promise.all(this.slots.map(({account}) => this.refreshAccount(account.id)));
    return this.slots.map(({account}) => ({...account}));
  }

  listJobs(projectId?: string): FlowAutomationJob[] {
    return [...this.jobs.values()]
      .filter((job) => !projectId || job.projectId === projectId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map((job) => ({...job, referencePaths: [...(job.referencePaths || [])]}));
  }

  async login(slotId: number): Promise<FlowAccount> {
    const slot = this.getSlot(slotId);
    const window = this.ensureWindow(slotId, true);
    window.show();
    window.focus();
    if (!window.webContents.getURL().startsWith('https://labs.google')) await window.loadURL(FLOW_URL);
    return {...slot.account};
  }

  async open(slotId: number): Promise<FlowAccount> {
    const slot = this.getSlot(slotId);
    const window = this.ensureWindow(slotId, true);
    if (!window.webContents.getURL()) await window.loadURL(FLOW_URL);
    window.show();
    window.focus();
    return {...slot.account};
  }

  async logout(slotId: number): Promise<FlowAccount> {
    const slot = this.getSlot(slotId);
    if (this.activeJobBySlot.has(slotId)) throw new Error('Không thể đăng xuất tài khoản đang xử lý Flow job.');
    slot.window?.close();
    slot.window = null;
    const slotSession = session.fromPartition(slot.account.partition);
    await slotSession.clearStorageData();
    await slotSession.clearCache();
    slot.account = {...slot.account, status: 'EMPTY', cookieCount: 0, activeJobCount: 0, error: null};
    this.emitAccounts();
    return {...slot.account};
  }

  submit(input: FlowGenerationRequest): FlowAutomationJob {
    if (!input.prompt.trim()) throw new Error('Google Flow prompt không được để trống.');
    if (!input.projectId || !input.assetId || !input.shotId) throw new Error('Flow job thiếu project, asset hoặc shot ID.');
    const downloadDirectory = path.resolve(input.downloadDirectory);
    mkdirSync(downloadDirectory, {recursive: true});
    const referencePaths = (input.referencePaths || []).map((value) => path.resolve(value));
    if (referencePaths.length > 3) throw new Error('Narra giới hạn tối đa 3 reference file cho một Flow job.');
    for (const referencePath of referencePaths) {
      if (!existsSync(referencePath)) throw new Error(`Không tìm thấy Flow reference: ${referencePath}`);
    }
    const now = isoNow();
    const job: FlowAutomationJob = {
      ...input,
      prompt: input.prompt.trim(),
      ...(input.negativePrompt?.trim() ? {negativePrompt: input.negativePrompt.trim()} : {}),
      downloadDirectory,
      referencePaths,
      id: `flow-job-${randomUUID()}`,
      slotId: input.slotId == null ? null : validSlotId(input.slotId, this.maxSlots),
      status: 'QUEUED',
      progress: 0,
      attempt: 0,
      outputPath: null,
      error: null,
      createdAt: now,
      updatedAt: now,
    };
    this.jobs.set(job.id, job);
    this.persistJobs();
    this.emitJob(job);
    void this.pump();
    return {...job};
  }

  cancel(jobId: string): FlowAutomationJob {
    const job = this.requireJob(jobId);
    if (TERMINAL.has(job.status)) return {...job};
    this.updateJob(job, {status: 'CANCELLED', error: null});
    if (job.slotId != null && this.activeJobBySlot.get(job.slotId) === job.id) this.releaseSlot(job.slotId);
    return {...job};
  }

  retry(jobId: string): FlowAutomationJob {
    const job = this.requireJob(jobId);
    if (!['RETRYABLE_FAILED', 'WAITING_FOR_USER'].includes(job.status)) throw new Error('Chỉ job chờ người dùng hoặc lỗi có thể thử lại.');
    this.updateJob(job, {status: 'QUEUED', progress: 0, error: null, outputPath: null});
    void this.pump();
    return {...job};
  }

  dispose(): void {
    for (const slot of this.slots) slot.window?.close();
    this.persistJobs();
  }

  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      await this.listAccounts();
      for (const job of this.jobs.values()) {
        if (job.status !== 'QUEUED') continue;
        const slotId = this.pickSlot(job);
        if (slotId == null) continue;
        this.activeJobBySlot.set(slotId, job.id);
        const slot = this.getSlot(slotId);
        slot.account.activeJobCount += 1;
        slot.account.status = 'BUSY';
        this.updateJob(job, {slotId, status: 'PREPARING_SESSION', attempt: job.attempt + 1, progress: 0.05});
        void this.runJob(job, slotId);
      }
    } finally {
      this.pumping = false;
      this.emitAccounts();
    }
  }

  private pickSlot(job: FlowAutomationJob): number | null {
    if (job.slotId != null) {
      const slot = this.getSlot(job.slotId);
      return slot.account.cookieCount > 0 && !this.activeJobBySlot.has(job.slotId) ? job.slotId : null;
    }
    const available = this.slots
      .filter(({account}) => account.cookieCount > 0 && !this.activeJobBySlot.has(account.id))
      .sort((left, right) => (left.account.lastUsedAt || '').localeCompare(right.account.lastUsedAt || ''));
    return available[0]?.account.id ?? null;
  }

  private async runJob(job: FlowAutomationJob, slotId: number): Promise<void> {
    const slot = this.getSlot(slotId);
    try {
      const window = this.ensureWindow(slotId, false);
      if (!window.webContents.getURL().startsWith('https://labs.google')) await window.loadURL(FLOW_URL);
      await this.waitForDom(window);
      if (job.status === 'CANCELLED') return;
      if (job.referencePaths?.length) {
        this.updateJob(job, {status: 'UPLOADING', progress: 0.12});
        await this.uploadReferences(window, job.referencePaths);
      }
      this.updateJob(job, {status: 'SUBMITTING', progress: 0.2});
      const submission = await this.submitInPage(window, job);
      if (!submission.submitted) {
        window.show();
        window.focus();
        this.updateJob(job, {status: 'WAITING_FOR_USER', error: submission.reason || 'Không tìm thấy vùng nhập prompt hoặc nút Tạo trong Google Flow.'});
        slot.account.status = 'WAITING_FOR_USER';
        return;
      }
      this.updateJob(job, {status: 'GENERATING', progress: 0.3});
      await this.pollForResult(window, job, slotId);
    } catch (error) {
      if (job.status !== 'CANCELLED' && job.status !== 'COMPLETED') {
        const message = error instanceof Error ? error.message : String(error);
        this.updateJob(job, {status: job.attempt < 3 ? 'RETRYABLE_FAILED' : 'TERMINAL_FAILED', error: message});
        slot.account.error = message;
      }
    } finally {
      if (job.status !== 'DOWNLOADING') this.releaseSlot(slotId);
    }
  }

  private ensureWindow(slotId: number, visible: boolean): BrowserWindow {
    const slot = this.getSlot(slotId);
    if (slot.window && !slot.window.isDestroyed()) return slot.window;
    const slotSession = session.fromPartition(slot.account.partition);
    this.configureSession(slot, slotSession);
    const window = new BrowserWindow({
      width: 1280,
      height: 900,
      show: visible,
      title: `Narra Studio · Google Flow · Tài khoản ${slotId + 1}`,
      autoHideMenuBar: true,
      webPreferences: {
        session: slotSession,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
      },
    });
    window.webContents.setUserAgent(CLEAN_UA);
    window.webContents.on('dom-ready', () => {
      void window.webContents.executeJavaScript(`
        (() => {
          try { Object.defineProperty(navigator, 'webdriver', {get: () => false, configurable: true}); } catch {}
          try { delete window.module; delete window.exports; delete window.require; } catch {}
        })();
      `, true).catch(() => undefined);
    });
    window.on('closed', () => { if (slot.window === window) slot.window = null; });
    window.webContents.on('did-navigate', () => void this.refreshAccount(slotId));
    slot.window = window;
    return window;
  }

  private configureSession(slot: SlotRuntime, slotSession: Session): void {
    if (slot.sessionConfigured) return;
    slot.sessionConfigured = true;
    slotSession.setUserAgent(CLEAN_UA);
    slotSession.setPermissionRequestHandler((_webContents, permission, callback) => {
      callback(['clipboard-sanitized-write', 'media'].includes(permission));
    });
    slotSession.webRequest.onBeforeSendHeaders(
      {urls: ['https://accounts.google.com/*', 'https://*.google.com/*', 'https://labs.google/*', 'https://aisandbox-pa.googleapis.com/*']},
      (details, callback) => {
        callback({requestHeaders: {...details.requestHeaders, 'User-Agent': CLEAN_UA}});
      },
    );
    slotSession.on('will-download', (_event, item) => {
      const jobId = this.activeJobBySlot.get(slot.account.id);
      const job = jobId ? this.jobs.get(jobId) : null;
      if (!job || job.status === 'CANCELLED') return;
      const extension = path.extname(item.getFilename()) || (job.kind === 'VIDEO' ? '.mp4' : '.png');
      const outputPath = path.join(job.downloadDirectory, `${safeToken(job.shotToken)}-${Date.now()}${extension}`);
      item.setSavePath(outputPath);
      this.updateJob(job, {status: 'DOWNLOADING', progress: 0.9, outputPath});
      item.once('done', (_doneEvent, state) => {
        if (state === 'completed') this.updateJob(job, {status: 'COMPLETED', progress: 1, outputPath, error: null});
        else this.updateJob(job, {status: 'RETRYABLE_FAILED', error: `Google Flow download kết thúc với trạng thái ${state}.`});
        this.releaseSlot(slot.account.id);
      });
    });
  }

  private async uploadReferences(window: BrowserWindow, files: string[]): Promise<void> {
    await window.webContents.executeJavaScript(`
      (() => {
        const visible = (el) => el && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0;
        const upload = [...document.querySelectorAll('button,[role="button"]')].find((el) => visible(el) && /upload|reference|ingredient|frame|tải|tham chiếu/i.test(el.textContent || el.getAttribute('aria-label') || ''));
        if (upload) upload.click();
      })();
    `, true);
    await new Promise((resolve) => setTimeout(resolve, 700));
    const debuggerApi = window.webContents.debugger;
    if (!debuggerApi.isAttached()) debuggerApi.attach('1.3');
    try {
      const document = await debuggerApi.sendCommand('DOM.getDocument', {depth: -1, pierce: true}) as {root: {nodeId: number}};
      const input = await debuggerApi.sendCommand('DOM.querySelector', {nodeId: document.root.nodeId, selector: 'input[type=file]'}) as {nodeId: number};
      if (!input.nodeId) throw new Error('Google Flow chưa hiển thị file input cho reference.');
      await debuggerApi.sendCommand('DOM.setFileInputFiles', {nodeId: input.nodeId, files});
      await new Promise((resolve) => setTimeout(resolve, 1500));
    } finally {
      if (debuggerApi.isAttached()) debuggerApi.detach();
    }
  }

  private async submitInPage(window: BrowserWindow, job: FlowAutomationJob): Promise<{submitted: boolean; reason?: string}> {
    const prompt = [job.prompt, job.negativePrompt ? `Negative guidance: ${job.negativePrompt}` : ''].filter(Boolean).join('\n\n');
    return window.webContents.executeJavaScript(`
      (() => {
        const prompt = ${JSON.stringify(prompt)};
        const visible = (el) => el && !el.disabled && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0;
        const inputs = [...document.querySelectorAll('textarea,[contenteditable="true"],[role="textbox"]')].filter(visible);
        const input = inputs.find((el) => /prompt|describe|tạo|mô tả/i.test(el.getAttribute('placeholder') || el.getAttribute('aria-label') || '')) || inputs.at(-1);
        if (!input) return {submitted: false, reason: 'Không tìm thấy ô prompt.'};
        input.focus();
        if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
          const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')?.set;
          setter ? setter.call(input, prompt) : (input.value = prompt);
        } else {
          input.textContent = prompt;
        }
        input.dispatchEvent(new InputEvent('input', {bubbles: true, inputType: 'insertText', data: prompt}));
        input.dispatchEvent(new Event('change', {bubbles: true}));
        const buttons = [...document.querySelectorAll('button,[role="button"]')].filter(visible);
        const create = buttons.find((el) => /^(generate|create|tạo|sinh|gửi)$/i.test((el.textContent || el.getAttribute('aria-label') || '').trim()))
          || buttons.find((el) => /generate|create|tạo video|tạo ảnh/i.test(el.textContent || el.getAttribute('aria-label') || ''));
        if (!create) return {submitted: false, reason: 'Đã nhập prompt nhưng không tìm thấy nút Tạo.'};
        create.click();
        return {submitted: true};
      })();
    `, true) as Promise<{submitted: boolean; reason?: string}>;
  }

  private async pollForResult(window: BrowserWindow, job: FlowAutomationJob, slotId: number): Promise<void> {
    const deadline = Date.now() + 30 * 60 * 1000;
    while (Date.now() < deadline && job.status === 'GENERATING') {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      const state = await window.webContents.executeJavaScript(`
        (() => {
          const text = (document.body?.innerText || '').slice(-12000);
          if (/verify it.?s you|two-step verification|unusual activity|xác minh|captcha/i.test(text)) return {kind: 'verification'};
          if (/generation failed|couldn.?t generate|không thể tạo|đã xảy ra lỗi/i.test(text)) return {kind: 'error'};
          const visible = (el) => el && !el.disabled && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0;
          const buttons = [...document.querySelectorAll('button,[role="button"],a')].filter(visible);
          const download = buttons.reverse().find((el) => /download|tải xuống/i.test(el.textContent || el.getAttribute('aria-label') || el.getAttribute('title') || ''));
          if (download) { download.click(); return {kind: 'download'}; }
          const media = [...document.querySelectorAll('video[src],img[src]')].filter(visible).at(-1);
          const mediaUrl = media?.getAttribute('src') || '';
          return {kind: 'waiting', mediaUrl: /^https?:/i.test(mediaUrl) ? mediaUrl : ''};
        })();
      `, true) as {kind: 'verification' | 'error' | 'download' | 'waiting'; mediaUrl?: string};
      if (state.kind === 'verification') {
        window.show();
        this.updateJob(job, {status: 'WAITING_FOR_USER', error: 'Google yêu cầu xác minh. Hoàn tất trong cửa sổ đúng tài khoản rồi bấm Thử lại.'});
        this.getSlot(slotId).account.status = 'WAITING_FOR_USER';
        return;
      }
      if (state.kind === 'error') throw new Error('Google Flow báo generation thất bại.');
      if (state.kind === 'download') {
        this.updateJob(job, {status: 'DOWNLOADING', progress: 0.88});
        return;
      }
      if (state.mediaUrl && job.kind === 'IMAGE') {
        const response = await session.fromPartition(this.getSlot(slotId).account.partition).fetch(state.mediaUrl);
        if (response.ok) {
          const outputPath = path.join(job.downloadDirectory, `${safeToken(job.shotToken)}-${Date.now()}.png`);
          writeFileSync(outputPath, Buffer.from(await response.arrayBuffer()));
          this.updateJob(job, {status: 'COMPLETED', progress: 1, outputPath, error: null});
          return;
        }
      }
      const elapsed = Date.now() - new Date(job.updatedAt).getTime();
      this.updateJob(job, {progress: Math.min(0.85, Math.max(job.progress, 0.3 + elapsed / 2_400_000))});
    }
    if (job.status === 'GENERATING') throw new Error('Google Flow job quá thời gian chờ 30 phút.');
  }

  private async refreshAccount(slotId: number): Promise<FlowAccount> {
    const slot = this.getSlot(slotId);
    const cookies = await session.fromPartition(slot.account.partition).cookies.get({domain: '.google.com'}).catch(() => []);
    slot.account.cookieCount = cookies.length;
    if (!this.activeJobBySlot.has(slotId) && slot.account.status !== 'WAITING_FOR_USER') {
      slot.account.status = cookies.length ? 'CONNECTED' : 'EMPTY';
      if (!cookies.length) slot.account.error = null;
    }
    return {...slot.account};
  }

  private async waitForDom(window: BrowserWindow): Promise<void> {
    if (!window.webContents.isLoadingMainFrame()) return;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Google Flow tải trang quá thời gian.')), 45_000);
      window.webContents.once('dom-ready', () => { clearTimeout(timer); resolve(); });
    });
  }

  private getSlot(slotId: number): SlotRuntime {
    return this.slots[validSlotId(slotId, this.maxSlots)]!;
  }

  private requireJob(jobId: string): FlowAutomationJob {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error(`Không tìm thấy Flow job ${jobId}.`);
    return job;
  }

  private updateJob(job: FlowAutomationJob, patch: Partial<FlowAutomationJob>): void {
    Object.assign(job, patch, {updatedAt: isoNow()});
    this.persistJobs();
    this.emitJob(job);
  }

  private releaseSlot(slotId: number): void {
    this.activeJobBySlot.delete(slotId);
    const slot = this.getSlot(slotId);
    slot.account.activeJobCount = 0;
    slot.account.lastUsedAt = isoNow();
    if (slot.account.status === 'BUSY') slot.account.status = slot.account.cookieCount ? 'CONNECTED' : 'EMPTY';
    this.emitAccounts();
    void this.pump();
  }

  private emitJob(job: FlowAutomationJob): void { this.emit('job-updated', {...job}); }
  private emitAccounts(): void { this.emit('accounts-updated', this.slots.map(({account}) => ({...account}))); }

  private persistJobs(): void {
    mkdirSync(path.dirname(this.statePath), {recursive: true});
    writeFileSync(this.statePath, JSON.stringify({version: 1, jobs: [...this.jobs.values()]}, null, 2), 'utf8');
  }

  private restoreJobs(): void {
    if (!existsSync(this.statePath)) return;
    try {
      const value = JSON.parse(readFileSync(this.statePath, 'utf8')) as {jobs?: FlowAutomationJob[]};
      for (const restored of value.jobs || []) {
        const job = {...restored};
        if (!TERMINAL.has(job.status)) {
          job.status = 'RETRYABLE_FAILED';
          job.error = 'Narra đã khởi động lại trước khi Flow job hoàn tất.';
          job.updatedAt = isoNow();
        }
        this.jobs.set(job.id, job);
      }
    } catch {
      // A malformed local job ledger is ignored; no credential is stored in it.
    }
  }
}
