import * as path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as vscode from 'vscode';
import { createMakeTargetsTask, runMakeTargets } from '../src/batch';
import { MakefileTaskProvider } from '../src/tasks';
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

beforeEach(() => {
  vi.clearAllMocks();
  mock.tasks.executeTask.mockReset();
  mock.settings.clear();
});

describe('combined Make execution', () => {
  it('launches one task with goals in selection order without tracking completion or showing progress', async () => {
    await runMakeTargets([target('clean'), target('build'), target('test')]);
    expect(mock.tasks.executeTask).toHaveBeenCalledOnce();
    const task = mock.tasks.executeTask.mock.calls[0]?.[0] as vscode.Task;
    expect((task.execution as unknown as mock.ShellExecution).args).toEqual(['-f', 'Makefile', 'clean', 'build', 'test']);
    expect(task.name).toBe('clean build test');
    expect(mock.window.withProgress).not.toHaveBeenCalled();
    expect(mock.processEnd.listenerCount).toBe(0);
    expect(mock.taskEnd.listenerCount).toBe(0);
  });

  it('preserves the configured executable, filename, working directory, and individual goal arguments', () => {
    mock.settings.set('makeCommand', 'gmake');
    const task = createMakeTargetsTask([target('build', 'nested folder/tasks.mk'), target('test', 'nested folder/tasks.mk')]);
    const shell = task.execution as unknown as mock.ShellExecution;
    expect(shell.command).toBe('gmake');
    expect(shell.args).toEqual(['-f', 'tasks.mk', 'build', 'test']);
    expect(shell.options.cwd).toBe(path.join(mock.folder.uri.fsPath, 'nested folder'));
  });

  it('rejects mixed Makefiles before launching any task', async () => {
    await expect(runMakeTargets([target('build'), target('test', 'nested/Makefile')]))
      .rejects.toThrow('same Makefile');
    expect(mock.tasks.executeTask).not.toHaveBeenCalled();
  });

  it('launches nothing for an empty selection and supports a single selected goal', async () => {
    await runMakeTargets([]);
    expect(mock.tasks.executeTask).not.toHaveBeenCalled();
    await runMakeTargets([target('build')]);
    const task = mock.tasks.executeTask.mock.calls[0]?.[0] as vscode.Task;
    expect((task.execution as unknown as mock.ShellExecution).args).toEqual(['-f', 'Makefile', 'build']);
  });

  it('preserves every selected goal when the task provider resolves a combined task again', () => {
    const selected = [target('clean'), target('build'), target('test')];
    const provider = new MakefileTaskProvider(() => [{
      uri: selected[0]!.makefileUri, workspaceFolder: selected[0]!.workspaceFolder,
      relativePath: 'Makefile', targets: selected,
    }]);
    const resolved = provider.resolveTask(createMakeTargetsTask(selected));
    expect((resolved?.execution as unknown as mock.ShellExecution).args).toEqual(['-f', 'Makefile', 'clean', 'build', 'test']);
  });

  it('propagates launch failures so the command can display its existing error message', async () => {
    mock.tasks.executeTask.mockRejectedValue(new Error('make unavailable'));
    await expect(runMakeTargets([target('build'), target('test')])).rejects.toThrow('make unavailable');
    expect(mock.tasks.executeTask).toHaveBeenCalledOnce();
  });
});
