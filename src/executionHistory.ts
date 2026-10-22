import * as vscode from 'vscode';
import { EXECUTION_HISTORY_LIMIT, getRunDuration, getStepDuration, isRunActive, type ExecutionController, type ExecutionRun, type ExecutionStep } from './execution';
import type { MakefileTarget } from './model';

export const EXECUTION_HISTORY_KEY = 'makefileTasks.executionHistory';

interface StoredTarget extends Omit<MakefileTarget, 'makefileUri' | 'workspaceFolder'> {
  readonly makefileUri: string;
  readonly workspaceFolder: { readonly uri: string; readonly name: string; readonly index: number };
}
interface StoredStep extends Omit<ExecutionStep, 'target'> {
  readonly target: StoredTarget;
}
interface StoredRun extends Omit<ExecutionRun, 'steps'> {
  readonly steps: readonly StoredStep[];
}
interface StoredHistory {
  readonly version: 1;
  readonly runs: readonly StoredRun[];
}

function durationSnapshot(durationMs: number | undefined): { durationMs?: number } {
  return durationMs === undefined ? {} : { durationMs };
}

export function serializeExecutionHistory(runs: readonly ExecutionRun[]): StoredHistory {
  const now = Date.now();
  return {
    version: 1,
    runs: runs.map((run) => ({
      ...run, ...durationSnapshot(getRunDuration(run, now)),
      steps: run.steps.map((step) => ({
        ...step, ...durationSnapshot(getStepDuration(step, now)), args: [...step.args], command: { ...step.command, args: [...step.command.args] },
        target: {
          ...step.target, makefileUri: step.target.makefileUri.toString(),
          workspaceFolder: {
            uri: step.target.workspaceFolder.uri.toString(),
            name: step.target.workspaceFolder.name, index: step.target.workspaceFolder.index,
          },
        },
      })),
    })),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}
function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

function optionalTime(value: unknown): boolean {
  return value === undefined || (typeof value === 'number' && Number.isFinite(value) && value >= 0);
}

function restoreStep(value: unknown): ExecutionStep | undefined {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id || !isStrings(value.args)
    || typeof value.status !== 'string' || !['waiting', 'running', 'succeeded', 'failed', 'cancelled', 'skipped', 'interrupted'].includes(value.status)
    || !optionalTime(value.startedAt) || !optionalTime(value.durationMs)
    || !optionalString(value.error) || (value.exitCode !== undefined && !Number.isInteger(value.exitCode))) {
    return undefined;
  }
  const target = value.target;
  const command = value.command;
  if (!isRecord(target) || typeof target.name !== 'string' || !target.name || typeof target.description !== 'string'
    || typeof target.makefileUri !== 'string' || !target.makefileUri || typeof target.makefileRelativePath !== 'string'
    || !Number.isInteger(target.line) || (target.line as number) < 0
    || !optionalString(target.usage) || !optionalString(target.category)
    || !isRecord(target.workspaceFolder) || typeof target.workspaceFolder.uri !== 'string' || !target.workspaceFolder.uri
    || typeof target.workspaceFolder.name !== 'string' || !Number.isInteger(target.workspaceFolder.index)
    || !isRecord(command) || typeof command.executable !== 'string' || !isStrings(command.args) || typeof command.cwd !== 'string') {
    return undefined;
  }
  try {
    const stored = value as unknown as StoredStep;
    const uri = vscode.Uri.parse(stored.target.workspaceFolder.uri, true);
    const folder = vscode.workspace.workspaceFolders?.find((entry) => entry.uri.toString() === uri.toString())
      ?? { uri, name: stored.target.workspaceFolder.name, index: stored.target.workspaceFolder.index };
    return {
      ...stored, args: [...stored.args], command: { ...stored.command, args: [...stored.command.args] },
      target: { ...stored.target, makefileUri: vscode.Uri.parse(stored.target.makefileUri, true), workspaceFolder: folder },
    };
  } catch {
    return undefined;
  }
}

export function restoreExecutionHistory(value: unknown): ExecutionRun[] {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.runs)) {
    return [];
  }
  const restored: ExecutionRun[] = [];
  for (const entry of value.runs) {
    if (!isRecord(entry) || typeof entry.id !== 'string' || !entry.id
      || !['single', 'sequence'].includes(entry.kind as string)
      || typeof entry.startedAt !== 'number' || !Number.isFinite(entry.startedAt) || entry.startedAt < 0
      || typeof entry.status !== 'string' || !['preparing', 'running', 'succeeded', 'failed', 'cancelled', 'interrupted'].includes(entry.status)
      || !optionalTime(entry.durationMs) || !optionalString(entry.error) || !Array.isArray(entry.steps) || entry.steps.length === 0
      || (entry.kind === 'single' && entry.steps.length !== 1)) {
      continue;
    }
    const steps = entry.steps.map(restoreStep);
    if (steps.some((step) => !step) || new Set(steps.map((step) => step!.id)).size !== steps.length) {
      continue;
    }
    const run = { ...entry, steps } as unknown as ExecutionRun;
    if (isRunActive(run) || run.steps.some((step) => step.status === 'running' || step.status === 'waiting')) {
      run.status = 'interrupted';
      run.error = 'Execution tracking was interrupted by a window reload. Tasks may still exist in their terminals; the queue will not resume automatically.';
      for (const step of run.steps) {
        if (step.status === 'running') {
          step.status = 'interrupted';
          step.error = 'Execution tracking was interrupted by a window reload.';
        } else if (step.status === 'waiting') {
          step.status = 'skipped';
        }
      }
    }
    restored.push(run);
  }
  const ids = new Set<string>();
  return restored.sort((left, right) => right.startedAt - left.startedAt).filter((run) => {
    if (ids.has(run.id)) {
      return false;
    }
    ids.add(run.id);
    return true;
  }).slice(0, EXECUTION_HISTORY_LIMIT);
}

export class ExecutionHistoryStore implements vscode.Disposable {
  private pending: Promise<void> = Promise.resolve();
  private subscription: vscode.Disposable | undefined;
  private controller: ExecutionController | undefined;

  public constructor(private readonly state: vscode.Memento, private readonly onError: (error: unknown) => void) {}

  public restore(): ExecutionRun[] {
    return restoreExecutionHistory(this.state.get<unknown>(EXECUTION_HISTORY_KEY));
  }

  public bind(controller: ExecutionController): void {
    this.controller = controller;
    this.subscription = controller.onDidChange(() => this.save(controller.getRuns()));
    if (controller.getRuns().length > 0) {
      this.save(controller.getRuns());
    }
  }

  public checkpoint(): void {
    if (this.controller) {
      this.save(this.controller.getRuns());
    }
  }

  public save(runs: readonly ExecutionRun[]): void {
    const snapshot = serializeExecutionHistory(runs);
    this.pending = this.pending.then(() => this.state.update(EXECUTION_HISTORY_KEY, snapshot)).catch(this.onError);
  }

  public async flush(): Promise<void> {
    await this.pending;
  }

  public dispose(): void {
    this.subscription?.dispose();
  }
}
