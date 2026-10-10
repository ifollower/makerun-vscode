import * as path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as vscode from 'vscode';
import { executeTaskAndWait, runMakeTargets } from '../src/batch';
import { createMakeTask } from '../src/tasks';
import type { MakefileTarget } from '../src/model';
import * as mock from './vscode-mock';

vi.mock('vscode', () => import('./vscode-mock'));

function target(name: string, makefile = 'Makefile'): MakefileTarget {
  return {
    name, description: name, line: 0, workspaceFolder: mock.folder as vscode.WorkspaceFolder,
    makefileUri: mock.Uri.file(path.join(mock.folder.uri.fsPath, makefile)) as vscode.Uri,
    makefileRelativePath: makefile,
  };
}

function execution(): vscode.TaskExecution {
  return { terminate: vi.fn(), task: {} as vscode.Task };
}

beforeEach(() => {
  vi.clearAllMocks();
  mock.settings.clear();
  mock.token.isCancellationRequested = false;
});

describe('batch execution', () => {
  it('waits for completion in selection order and stops on failure', async () => {
    const executions: vscode.TaskExecution[] = [];
    mock.tasks.executeTask.mockImplementation(async (): Promise<vscode.TaskExecution> => {
      const started = execution();
      executions.push(started);
      return started;
    });
    const running = runMakeTargets([target('clean'), target('build'), target('test')], 'sequence');
    await vi.waitFor(() => expect(executions).toHaveLength(1));
    expect(mock.tasks.executeTask.mock.calls[0]?.[0].name).toBe('clean');
    mock.processEnd.fire({ execution: executions[0], exitCode: 0 });
    await vi.waitFor(() => expect(executions).toHaveLength(2));
    expect(mock.tasks.executeTask.mock.calls[1]?.[0].name).toBe('build');
    mock.processEnd.fire({ execution: executions[1], exitCode: 2 });
    await running;
    expect(executions).toHaveLength(2);
    expect(mock.window.showWarningMessage).toHaveBeenCalledWith(expect.stringContaining('Sequence stopped.'));
    expect(mock.processEnd.listenerCount).toBe(0);
    expect(mock.taskEnd.listenerCount).toBe(0);
  });

  it('starts parallel tasks before either finishes, with independent directories and terminals', async () => {
    const executions: vscode.TaskExecution[] = [];
    mock.tasks.executeTask.mockImplementation(async (): Promise<vscode.TaskExecution> => {
      const started = execution();
      executions.push(started);
      return started;
    });
    const running = runMakeTargets([target('build'), target('build', 'nested/Makefile')], 'parallel');
    await vi.waitFor(() => expect(executions).toHaveLength(2));
    const launched = mock.tasks.executeTask.mock.calls.map(([task]) => task as vscode.Task);
    expect(launched.map((task) => task.presentationOptions.panel)).toEqual([mock.TaskPanelKind.Dedicated, mock.TaskPanelKind.Dedicated]);
    expect(launched.map((task) => (task.execution as unknown as mock.ShellExecution).options.cwd))
      .toEqual([mock.folder.uri.fsPath, path.join(mock.folder.uri.fsPath, 'nested')]);
    mock.processEnd.fire({ execution: executions[1], exitCode: 0 });
    mock.processEnd.fire({ execution: executions[0], exitCode: 0 });
    await running;
    expect(mock.window.showWarningMessage).not.toHaveBeenCalled();
  });

  it('captures tasks that finish before executeTask returns, ignoring unrelated tasks', async () => {
    const started = execution();
    mock.tasks.executeTask.mockImplementation(async (): Promise<vscode.TaskExecution> => {
      mock.processEnd.fire({ execution: execution(), exitCode: 9 });
      mock.processEnd.fire({ execution: started, exitCode: 0 });
      mock.taskEnd.fire({ execution: started });
      return started;
    });
    await expect(executeTaskAndWait(createMakeTask(target('build')), mock.token)).resolves.toEqual({ exitCode: 0 });
  });

  it('cancels only batch executions and skips queued tasks', async () => {
    const started = execution();
    const unrelated = execution();
    mock.tasks.executeTask.mockResolvedValue(started);
    const running = runMakeTargets([target('build'), target('test')], 'sequence');
    await vi.waitFor(() => expect(mock.tasks.executeTask).toHaveBeenCalledTimes(1));
    mock.token.isCancellationRequested = true;
    mock.cancellation.fire();
    await running;
    expect(started.terminate).toHaveBeenCalledOnce();
    expect(unrelated.terminate).not.toHaveBeenCalled();
    expect(mock.tasks.executeTask).toHaveBeenCalledOnce();
    expect(mock.cancellation.listenerCount).toBe(0);
  });

  it('terminates an execution returned after cancellation', async () => {
    const started = execution();
    let launched!: (value: vscode.TaskExecution) => void;
    mock.tasks.executeTask.mockImplementation(() => new Promise<vscode.TaskExecution>((resolve) => { launched = resolve; }));
    const running = executeTaskAndWait(createMakeTask(target('build')), mock.token);
    mock.token.isCancellationRequested = true;
    mock.cancellation.fire();
    launched(started);
    await expect(running).resolves.toEqual({ cancelled: true });
    expect(started.terminate).toHaveBeenCalledOnce();
  });

  it('stops the sequence when a task ends without a process exit code', async () => {
    const started = execution();
    mock.tasks.executeTask.mockImplementation(async (): Promise<vscode.TaskExecution> => {
      mock.taskEnd.fire({ execution: started });
      return started;
    });
    await runMakeTargets([target('build'), target('test')], 'sequence');
    expect(mock.tasks.executeTask).toHaveBeenCalledOnce();
    expect(mock.window.showWarningMessage).toHaveBeenCalledWith(expect.stringContaining('terminated without an exit code'));
  });

  it('reports launch failures and disposes completion listeners', async () => {
    mock.tasks.executeTask.mockRejectedValue(new Error('make unavailable'));
    await runMakeTargets([target('build'), target('test')], 'sequence');
    expect(mock.tasks.executeTask).toHaveBeenCalledOnce();
    expect(mock.window.showWarningMessage).toHaveBeenCalledWith(expect.stringContaining('make unavailable'));
    expect(mock.processEnd.listenerCount).toBe(0);
    expect(mock.taskEnd.listenerCount).toBe(0);
  });
});
