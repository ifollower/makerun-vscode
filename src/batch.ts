import * as vscode from 'vscode';
export interface TaskResult {
  readonly exitCode?: number;
  readonly cancelled?: boolean;
  readonly error?: string;
}

/** Listen before launching: a fast task can finish before executeTask returns. */
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
      complete(token.isCancellationRequested ? { cancelled: true } : result);
    } else if (!execution && !earlyResults.has(endedExecution)) {
      earlyResults.set(endedExecution, result);
    }
  };
  const subscriptions = [
    vscode.tasks.onDidEndTaskProcess((event) => ended(event.execution,
      event.exitCode === undefined ? { cancelled: true, error: 'Task was terminated.' } : { exitCode: event.exitCode })),
    vscode.tasks.onDidEndTask((event) => ended(event.execution, { error: 'Task ended without a process exit code.' })),
    token.onCancellationRequested(() => {
      execution?.terminate();
      complete({ cancelled: true });
    }),
  ];
  try {
    execution = await vscode.tasks.executeTask(task);
    if (token.isCancellationRequested) {
      if (!earlyResults.has(execution)) {
        execution.terminate();
      }
      return { cancelled: true };
    }
    return earlyResults.get(execution) ?? await completion;
  } catch (error) {
    return token.isCancellationRequested ? { cancelled: true }
      : { error: error instanceof Error ? error.message : String(error) };
  } finally {
    subscriptions.forEach((subscription) => subscription.dispose());
  }
}
