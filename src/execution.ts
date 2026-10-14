import { randomUUID } from 'node:crypto';
import * as vscode from 'vscode';
import { executeTaskAndWait } from './batch';
import type { MakefileTarget } from './model';
import { createMakeTask, getMakeTaskCommand, type MakeTaskCommand } from './tasks';

export type StepStatus = 'waiting' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'skipped' | 'interrupted';
export type RunStatus = 'preparing' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted';
export const EXECUTION_HISTORY_LIMIT = 10;

export interface ExecutionStep {
  readonly id: string;
  readonly target: MakefileTarget;
  readonly args: readonly string[];
  command: MakeTaskCommand;
  status: StepStatus;
  exitCode?: number;
  error?: string;
}

export interface ExecutionRun {
  readonly id: string;
  readonly kind: 'single' | 'sequence';
  startedAt: number;
  steps: readonly ExecutionStep[];
  status: RunStatus;
  error?: string;
}

export interface ExecutionHandle {
  readonly run: ExecutionRun;
  readonly completion: Promise<void>;
}

type PrepareTargets = (targets: readonly MakefileTarget[]) => Promise<readonly MakefileTarget[]>;
type TaskFactory = (target: MakefileTarget, args: readonly string[], executionId: string) => vscode.Task;

export function isRunActive(run: ExecutionRun): boolean {
  return run.status === 'preparing' || run.status === 'running';
}

export class ExecutionController implements vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<void>();
  public readonly onDidChange = this.changed.event;
  private readonly started = new vscode.EventEmitter<ExecutionRun>();
  public readonly onDidStartRun = this.started.event;
  private readonly runs: ExecutionRun[] = [];
  private readonly cancellations = new Map<string, vscode.CancellationTokenSource>();
  private disposed = false;

  public constructor(
    private readonly prepare: PrepareTargets = async (targets) => targets,
    private readonly createTask: TaskFactory = createMakeTask,
    initialRuns: readonly ExecutionRun[] = [],
  ) {
    this.runs.push(...initialRuns);
  }

  public getRuns(): readonly ExecutionRun[] {
    return this.runs;
  }

  public get batchRunning(): boolean {
    return this.runs.some((run) => run.kind === 'sequence' && isRunActive(run));
  }

  public startSingle(target: MakefileTarget, args: readonly string[] = []): ExecutionHandle {
    return this.start('single', [target], args);
  }

  public startSequence(targets: readonly MakefileTarget[]): ExecutionHandle | undefined {
    if (targets.length === 0) {
      return undefined;
    }
    return this.start('sequence', targets, []);
  }

  public cancelRun(id: string): void {
    this.cancellations.get(id)?.cancel();
  }

  public rerun(id: string): ExecutionHandle | undefined {
    const index = this.runs.findIndex((run) => run.id === id);
    const run = this.runs[index];
    if (!run || isRunActive(run) || this.disposed) {
      return undefined;
    }
    const attemptId = randomUUID();
    run.steps = run.steps.map((step, stepIndex) => ({
      id: `${attemptId}:${stepIndex}`, target: { ...step.target }, args: [...step.args], status: 'waiting',
      command: getMakeTaskCommand(step.target, step.args),
    }));
    run.startedAt = Date.now();
    run.status = 'preparing';
    delete run.error;
    this.runs.splice(index, 1);
    return this.launch(run);
  }

  public deleteRun(id: string): boolean {
    const index = this.runs.findIndex((run) => run.id === id);
    const run = this.runs[index];
    if (!run || isRunActive(run)) {
      return false;
    }
    this.runs.splice(index, 1);
    this.changed.fire();
    return true;
  }

  public clearCompleted(): void {
    this.runs.splice(0, this.runs.length, ...this.runs.filter(isRunActive));
    this.changed.fire();
  }

  public dispose(): void {
    this.disposed = true;
    this.cancellations.forEach((source) => source.cancel());
    this.changed.dispose();
    this.started.dispose();
  }

  private start(kind: ExecutionRun['kind'], targets: readonly MakefileTarget[], args: readonly string[]): ExecutionHandle {
    if (this.disposed) {
      throw new Error('Execution controller has been disposed.');
    }
    const id = randomUUID();
    const run: ExecutionRun = {
      id, kind, startedAt: Date.now(), status: 'preparing',
      steps: targets.map((target, index) => ({
        id: `${id}:${index}`, target: { ...target }, args: [...args], status: 'waiting',
        command: getMakeTaskCommand(target, args),
      })),
    };
    return this.launch(run);
  }

  private launch(run: ExecutionRun): ExecutionHandle {
    const source = new vscode.CancellationTokenSource();
    this.cancellations.set(run.id, source);
    this.runs.unshift(run);
    this.changed.fire();
    this.started.fire(run);
    return { run, completion: this.execute(run, source) };
  }

  private async execute(run: ExecutionRun, source: vscode.CancellationTokenSource): Promise<void> {
    try {
      const targets = await this.prepare(run.steps.map((step) => step.target));
      if (source.token.isCancellationRequested) {
        run.status = 'cancelled';
        return;
      }
      if (targets.length !== run.steps.length) {
        throw new Error('Not all selected targets could be prepared. No targets were started.');
      }
      run.status = 'running';
      this.changed.fire();
      for (const [index, step] of run.steps.entries()) {
        if (source.token.isCancellationRequested) {
          run.status = 'cancelled';
          break;
        }
        step.status = 'running';
        const task = this.createTask(targets[index]!, step.args, step.id);
        if (task.execution instanceof vscode.ShellExecution && task.execution.command) {
          const shell = task.execution;
          const value = (argument: string | vscode.ShellQuotedString): string =>
            typeof argument === 'string' ? argument : argument.value;
          step.command = {
            executable: value(shell.command!), args: (shell.args ?? []).map(value), cwd: shell.options?.cwd ?? step.command.cwd,
          };
        }
        this.changed.fire();
        const result = await executeTaskAndWait(task, source.token);
        if (result.exitCode !== undefined) {
          step.exitCode = result.exitCode;
        }
        if (result.error) {
          step.error = result.error;
        }
        if (result.cancelled) {
          step.status = 'cancelled';
          run.status = 'cancelled';
          break;
        }
        if (result.exitCode !== 0) {
          step.status = 'failed';
          step.error ??= result.exitCode === undefined ? 'Task ended without an exit code.' : `Exit code ${result.exitCode}`;
          run.error = `${step.target.name}: ${step.error}`;
          run.status = 'failed';
          break;
        }
        step.status = 'succeeded';
        this.changed.fire();
      }
      if (run.status === 'running') {
        run.status = source.token.isCancellationRequested ? 'cancelled' : 'succeeded';
      }
    } catch (error) {
      run.status = source.token.isCancellationRequested ? 'cancelled' : 'failed';
      run.error = error instanceof Error ? error.message : String(error);
      const running = run.steps.find((step) => step.status === 'running');
      if (running) {
        running.status = run.status === 'cancelled' ? 'cancelled' : 'failed';
        running.error = run.error;
      }
    } finally {
      for (const step of run.steps) {
        if (step.status === 'waiting') {
          step.status = 'skipped';
        }
      }
      this.cancellations.delete(run.id);
      source.dispose();
      let completed = 0;
      for (let index = 0; index < this.runs.length;) {
        if (!isRunActive(this.runs[index]!) && ++completed > EXECUTION_HISTORY_LIMIT) {
          this.runs.splice(index, 1);
        } else {
          index += 1;
        }
      }
      if (!this.disposed) {
        this.changed.fire();
      }
    }
  }
}
