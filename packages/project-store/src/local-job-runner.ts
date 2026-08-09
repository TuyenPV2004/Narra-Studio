import {spawn, type ChildProcessWithoutNullStreams} from 'node:child_process';
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import type {JobExecution} from './types.js';
import type {ProjectStore} from './project-store.js';

type ActiveJob = {
  execution: JobExecution;
  process: ChildProcessWithoutNullStreams;
  settled: boolean;
  cancellationTimer: NodeJS.Timeout;
};

export class LocalJobRunner {
  private readonly store: ProjectStore;
  private readonly repositoryRoot: string;
  private active: ActiveJob | null = null;
  private pumpTimer: NodeJS.Timeout | null = null;
  private stopped = true;

  constructor(store: ProjectStore, repositoryRoot: string) {
    this.store = store;
    this.repositoryRoot = path.resolve(repositoryRoot);
  }

  start(): number {
    const recovered = this.store.recoverInterruptedJobs();
    this.stopped = false;
    this.pumpTimer = setInterval(() => void this.runNext(), 750);
    void this.runNext();
    return recovered;
  }

  stop(): void {
    this.stopped = true;
    if (this.pumpTimer) clearInterval(this.pumpTimer);
    this.pumpTimer = null;
    if (this.active && !this.active.settled) {
      this.active.settled = true;
      clearInterval(this.active.cancellationTimer);
      this.store.failJob(this.active.execution.id, 'Application closed while the local process was running.', true);
      this.active.process.kill();
    }
    this.active = null;
  }

  async runNext(): Promise<boolean> {
    if (this.stopped || this.active) return false;
    const execution = this.store.claimNextJob();
    if (!execution) return false;

    try {
      const command = this.buildCommand(execution);
      this.store.setJobCommand(execution.id, command.file, command.args);
      this.store.appendJobLog(execution.id, 'SYSTEM', `Starting attempt ${execution.attempt}.`);
      this.store.updateJobProgress(execution.id, 0.01);
      const child = spawn(command.file, command.args, {
        cwd: this.repositoryRoot,
        windowsHide: true,
        shell: false,
      });
      const active: ActiveJob = {
        execution,
        process: child,
        settled: false,
        cancellationTimer: setInterval(() => {
          if (this.store.isJobCancellationRequested(execution.id)) child.kill();
        }, 250),
      };
      this.active = active;
      let stdoutText = '';

      const capture = (stream: 'STDOUT' | 'STDERR', data: Buffer): void => {
        const message = data.toString('utf8');
        if (stream === 'STDOUT') stdoutText += message;
        this.store.appendJobLog(execution.id, stream, message);
        const percent = [...message.matchAll(/(\d{1,3}(?:\.\d+)?)%/g)].at(-1)?.[1];
        const frames = [...message.matchAll(/Rendered\s+(\d+)\/(\d+)/gi)].at(-1);
        if (percent) this.store.updateJobProgress(execution.id, Number(percent) / 100);
        else if (frames?.[1] && frames[2]) this.store.updateJobProgress(execution.id, Number(frames[1]) / Number(frames[2]));
      };
      child.stdout.on('data', (data: Buffer) => capture('STDOUT', data));
      child.stderr.on('data', (data: Buffer) => capture('STDERR', data));

      const finalize = (error?: Error, exitCode?: number | null): void => {
        if (active.settled) return;
        active.settled = true;
        clearInterval(active.cancellationTimer);
        try {
          if (this.store.isJobCancellationRequested(execution.id)) {
            this.store.markJobCancelled(execution.id);
          } else if (!error && exitCode === 0) {
            if (execution.type === 'PROBE') writeFileSync(execution.tempOutputPath, stdoutText, 'utf8');
            this.store.completeJob(execution.id);
          } else {
            this.store.failJob(execution.id, error?.message ?? `Local process exited with code ${exitCode ?? 'unknown'}.`, true);
          }
        } catch (reason) {
          this.store.failJob(execution.id, reason instanceof Error ? reason.message : String(reason), true);
        } finally {
          if (this.active === active) this.active = null;
          if (!this.stopped) queueMicrotask(() => void this.runNext());
        }
      };
      child.once('error', (error) => finalize(error));
      child.once('close', (code) => finalize(undefined, code));
      return true;
    } catch (reason) {
      this.store.failJob(execution.id, reason instanceof Error ? reason.message : String(reason), false);
      this.active = null;
      return false;
    }
  }

  cancel(projectId: string, jobId: string): void {
    this.store.requestJobCancellation(projectId, jobId);
    if (this.active?.execution.id === jobId) this.active.process.kill();
  }

  private buildCommand(execution: JobExecution): {file: string; args: string[]} {
    const cliPath = path.join(this.repositoryRoot, 'remotion/node_modules/@remotion/cli/remotion-cli.js');
    const entryPoint = path.join(this.repositoryRoot, 'remotion/src/index.ts');
    if (!existsSync(cliPath)) throw new Error('Remotion CLI is not installed in the local workspace. Run pnpm install.');
    if (execution.type === 'RENDER') {
      return {file: process.execPath, args: [
        cliPath,
        'render',
        entryPoint,
        'StoryboardPreview',
        execution.tempOutputPath,
        `--props=${execution.inputSnapshotPath}`,
        `--public-dir=${execution.projectRoot}`,
        '--codec=h264',
        '--audio-codec=aac',
        '--crf=22',
        '--overwrite',
      ]};
    }

    const snapshot = JSON.parse(readFileSync(execution.inputSnapshotPath, 'utf8')) as {sourcePath?: unknown};
    if (typeof snapshot.sourcePath !== 'string') throw new Error('Media job snapshot has no sourcePath.');
    const sourcePath = path.resolve(execution.projectRoot, ...snapshot.sourcePath.split('/'));
    const projectPrefix = `${path.resolve(execution.projectRoot)}${path.sep}`;
    if (!sourcePath.startsWith(projectPrefix) || !existsSync(sourcePath)) throw new Error('Media job source is missing or outside the project.');
    if (execution.type === 'PROBE') {
      return {file: process.execPath, args: [cliPath, 'ffprobe', '-v', 'error', '-of', 'json', '-show_format', '-show_streams', sourcePath]};
    }
    const qualityArgs = execution.type === 'PROXY'
      ? ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-c:a', 'aac', '-b:a', '128k']
      : ['-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart'];
    return {file: process.execPath, args: [cliPath, 'ffmpeg', '-y', '-i', sourcePath, ...qualityArgs, execution.tempOutputPath]};
  }
}
