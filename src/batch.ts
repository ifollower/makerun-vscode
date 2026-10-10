import * as vscode from 'vscode';
import type { MakefileTarget } from './model';
import { createMakeTask } from './tasks';

export type BatchMode = 'sequence' | 'parallel';

interface TaskResult {
  readonly exitCode?: number | undefined;
  readonly cancelled?: boolean;
  readonly error?: string;
}

/** Subscribe before launch: short tasks can exit before executeTask resolves. */
export async function executeTaskAndWait(task: vscode.Task, token: vscode.CancellationToken): Promise<TaskResult> {
  if (token.isCancellationRequested) {
    return { cancelled: true };
  }
  let execution: vscode.TaskExecution | undefined;
  const earlyResults = new Map<vscode.TaskExecution, TaskResult>();
  let complete!: (result: TaskResult) => void;
  const completion = new Promise<TaskResult>((resolve) => { complete = resolve; });
  const ended = (endedExecution: vscode.TaskExecution, result: TaskResult): void => {
    if (execution === endedExecution) {
      complete(result);
    } else if (!earlyResults.has(endedExecution)) {
      earlyResults.set(endedExecution, result);
    }
  };
  const subscriptions = [
    vscode.tasks.onDidEndTaskProcess((event) => ended(event.execution, { exitCode: event.exitCode })),
    vscode.tasks.onDidEndTask((event) => ended(event.execution, {})),
    token.onCancellationRequested(() => {
      execution?.terminate();
      complete({ cancelled: true });
    }),
  ];
  try {
    execution = await vscode.tasks.executeTask(task);
    if (token.isCancellationRequested) {
      execution.terminate();
      return { cancelled: true };
    }
    const earlyResult = earlyResults.get(execution);
    if (earlyResult) {
      return earlyResult;
    }
    return await completion;
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  } finally {
    subscriptions.forEach((subscription) => subscription.dispose());
  }
}

export async function runMakeTargets(targets: readonly MakefileTarget[], mode: BatchMode): Promise<void> {
  await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: `Make Run Tasks: ${mode === 'sequence' ? 'Run in Sequence' : 'Run in Parallel'} (${targets.length})`,
    cancellable: true,
  }, async (progress, token) => {
    const failures: string[] = [];
    let finished = 0;
    const run = async (target: MakefileTarget): Promise<boolean> => {
      if (token.isCancellationRequested) {
        return false;
      }
      const task = createMakeTask(target);
      if (mode === 'parallel') {
        task.presentationOptions = { ...task.presentationOptions, panel: vscode.TaskPanelKind.Dedicated };
      }
      progress.report({ message: `${finished}/${targets.length} · ${target.name}` });
      const result = await executeTaskAndWait(task, token);
      if (result.cancelled) {
        return false;
      }
      finished += 1;
      progress.report({ increment: 100 / targets.length, message: `${finished}/${targets.length} · ${target.name}` });
      if (result.exitCode !== 0) {
        failures.push(`${target.workspaceFolder.name}/${target.makefileRelativePath}: ${target.name} (${result.error ?? (result.exitCode === undefined ? 'terminated without an exit code' : `exit code ${result.exitCode}`)})`);
        return false;
      }
      return true;
    };
    if (mode === 'parallel') {
      await Promise.all(targets.map(run));
    } else {
      for (const target of targets) {
        if (!await run(target)) {
          break;
        }
      }
    }
    if (failures.length > 0) {
      void vscode.window.showWarningMessage(`Make Run Tasks: ${mode === 'sequence' ? 'Sequence stopped. ' : ''}${failures.join('; ')}`);
    }
  });
}
