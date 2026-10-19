import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as vscode from 'vscode';
import { executeTaskAndWait } from '../src/batch';
import { ExecutionController, getResumeIndex, type ExecutionRun } from '../src/execution';
import { ExecutionTreeProvider } from '../src/executionTree';
import { formatExecutionCommands } from '../src/executionCommands';
import type { MakefileTarget } from '../src/model';
import { createMakeTask, MakefileTaskProvider } from '../src/tasks';
import * as mock from './vscode-mock';

vi.mock('vscode', () => import('./vscode-mock'));

function target(name: string, makefile = 'Makefile'): MakefileTarget {
  return {
    name, description: name, line: 0, workspaceFolder: mock.folder as vscode.WorkspaceFolder,
    makefileUri: mock.Uri.file(path.join(mock.folder.uri.fsPath, makefile)) as vscode.Uri,
    makefileRelativePath: makefile,
  };
}

const controllers: ExecutionController[] = [];
function controller(prepare?: (targets: readonly MakefileTarget[]) => Promise<readonly MakefileTarget[]>): ExecutionController {
  const result = new ExecutionController(prepare);
  controllers.push(result);
  return result;
}

let launched: vscode.TaskExecution[];
beforeEach(() => {
  vi.clearAllMocks();
  mock.tasks.executeTask.mockReset();
  mock.settings.clear();
  launched = [];
  mock.tasks.executeTask.mockImplementation(async (task: vscode.Task): Promise<vscode.TaskExecution> => {
    const execution = { task, terminate: vi.fn() };
    launched.push(execution);
    return execution;
  });
});

afterEach(async () => {
  controllers.splice(0).forEach((item) => item.dispose());
  await Promise.resolve();
});

function end(index: number, exitCode = 0): void {
  mock.processEnd.fire({ execution: launched[index], exitCode });
  mock.taskEnd.fire({ execution: launched[index] });
}

describe('execution controller', () => {
  it('waits for each task, preserving selection order, Makefile and workspace scopes', async () => {
    const runner = controller();
    const otherFolder = {
      ...mock.folder, uri: mock.Uri.file(path.resolve('other-workspace')),
    } as vscode.WorkspaceFolder;
    const other = {
      ...target('test', 'nested/Makefile'), workspaceFolder: otherFolder,
      makefileUri: mock.Uri.file(path.join(otherFolder.uri.fsPath, 'nested/Makefile')) as vscode.Uri,
    };
    const handle = runner.startSequence([target('clean'), target('build'), other])!;
    expect(handle.run.status).toBe('preparing');
    expect(runner.batchRunning).toBe(true);
    await vi.waitFor(() => expect(launched).toHaveLength(1));
    expect(handle.run.steps.map((step) => step.status)).toEqual(['running', 'waiting', 'waiting']);
    end(0);
    await vi.waitFor(() => expect(launched).toHaveLength(2));
    end(1);
    await vi.waitFor(() => expect(launched).toHaveLength(3));
    expect(launched.map((execution) => execution.task.name)).toEqual(['clean', 'build', 'test']);
    expect((launched[2]!.task.execution as unknown as mock.ShellExecution).options.cwd)
      .toBe(path.join(otherFolder.uri.fsPath, 'nested'));
    expect(launched[2]!.task.scope).toBe(other.workspaceFolder);
    end(2);
    await handle.completion;
    expect(handle.run.status).toBe('succeeded');
    expect(handle.run.steps.every((step) => step.status === 'succeeded')).toBe(true);
    expect(runner.batchRunning).toBe(false);
    expect(mock.window.withProgress).not.toHaveBeenCalled();
    expect(mock.window.showWarningMessage).not.toHaveBeenCalled();
    expect(mock.processEnd.listenerCount).toBe(0);
    expect(mock.taskEnd.listenerCount).toBe(0);
  });

  it('stops on failure and preserves the exit code while skipping remaining goals', async () => {
    const handle = controller().startSequence([target('clean'), target('build'), target('test')])!;
    await vi.waitFor(() => expect(launched).toHaveLength(1));
    end(0);
    await vi.waitFor(() => expect(launched).toHaveLength(2));
    end(1, 2);
    await handle.completion;
    expect(handle.run.status).toBe('failed');
    expect(handle.run.steps.map((step) => step.status)).toEqual(['succeeded', 'failed', 'skipped']);
    expect(handle.run.steps[1]!.exitCode).toBe(2);
    expect(handle.run.error).toContain('Exit code 2');
    expect(launched).toHaveLength(2);
  });

  it('records launch failures without notification and does not advance the sequence', async () => {
    mock.tasks.executeTask.mockRejectedValue(new Error('make unavailable'));
    const handle = controller().startSequence([target('build'), target('test')])!;
    await handle.completion;
    expect(handle.run.status).toBe('failed');
    expect(handle.run.error).toContain('make unavailable');
    expect(handle.run.steps.map((step) => step.status)).toEqual(['failed', 'skipped']);
    expect(mock.tasks.executeTask).toHaveBeenCalledOnce();
  });

  it('keeps preparation errors in the run and starts nothing', async () => {
    const runner = controller(async () => { throw new Error('Could not save Makefile.'); });
    const handle = runner.startSequence([target('build'), target('test')])!;
    await handle.completion;
    expect(handle.run.status).toBe('failed');
    expect(handle.run.error).toBe('Could not save Makefile.');
    expect(handle.run.steps.map((step) => step.status)).toEqual(['skipped', 'skipped']);
    expect(mock.tasks.executeTask).not.toHaveBeenCalled();
  });

  it('starts other sequences and single runs while a sequence is preparing', async () => {
    let prepared!: (targets: readonly MakefileTarget[]) => void;
    const runner = controller((targets) => targets.length > 1
      ? new Promise((resolve) => { prepared = resolve; }) : Promise.resolve(targets));
    const batch = runner.startSequence([target('build'), target('test')])!;
    const other = runner.startSequence([target('clean')])!;
    const single = runner.startSingle(target('lint'), ['MODE=fast']);
    await vi.waitFor(() => expect(launched).toHaveLength(2));
    expect((launched[1]!.task.execution as unknown as mock.ShellExecution).args)
      .toEqual(['-f', 'Makefile', 'lint', 'MODE=fast']);
    end(1);
    await single.completion;
    prepared(batch.run.steps.map((step) => step.target));
    await vi.waitFor(() => expect(launched).toHaveLength(3));
    runner.cancelRun(batch.run.id);
    await batch.completion;
    expect(other.run.status).toBe('running');
    expect(launched[0]!.terminate).not.toHaveBeenCalled();
    end(0);
    await other.completion;
    expect(single.run.status).toBe('succeeded');
    expect(batch.run.status).toBe('cancelled');
  });

  it('cancels only the selected run and skips queued tasks without affecting an independent run', async () => {
    const runner = controller();
    const batch = runner.startSequence([target('build'), target('test')])!;
    const single = runner.startSingle(target('lint'));
    await vi.waitFor(() => expect(launched).toHaveLength(2));
    runner.cancelRun(batch.run.id);
    await batch.completion;
    expect(launched[0]!.terminate).toHaveBeenCalledOnce();
    expect(launched[1]!.terminate).not.toHaveBeenCalled();
    expect(batch.run.steps.map((step) => step.status)).toEqual(['cancelled', 'skipped']);
    end(1);
    await single.completion;
    expect(single.run.status).toBe('succeeded');
    expect(launched).toHaveLength(2);
  });

  it('keeps each concurrent sequence ordered and confines failure to its own queue', async () => {
    const runner = controller();
    const first = runner.startSequence([target('clean'), target('fail'), target('skipped')])!;
    const second = runner.startSequence([target('build'), target('test')])!;
    await vi.waitFor(() => expect(launched).toHaveLength(2));
    expect(launched.map((execution) => execution.task.name)).toEqual(['clean', 'build']);
    end(0);
    await vi.waitFor(() => expect(launched).toHaveLength(3));
    expect(launched[2]!.task.name).toBe('fail');
    expect(second.run.steps[1]!.status).toBe('waiting');
    end(1);
    await vi.waitFor(() => expect(launched).toHaveLength(4));
    expect(launched[3]!.task.name).toBe('test');
    end(2, 2);
    await first.completion;
    expect(first.run.steps.map((step) => step.status)).toEqual(['succeeded', 'failed', 'skipped']);
    expect(second.run.status).toBe('running');
    expect(launched[3]!.terminate).not.toHaveBeenCalled();
    end(3);
    await second.completion;
    expect(second.run.status).toBe('succeeded');
    expect(launched).toHaveLength(4);
  });

  it('cancels during preparation before any task starts', async () => {
    let prepared!: (targets: readonly MakefileTarget[]) => void;
    const runner = controller(() => new Promise((resolve) => { prepared = resolve; }));
    const handle = runner.startSingle(target('build'));
    runner.cancelRun(handle.run.id);
    prepared([target('build')]);
    await handle.completion;
    expect(handle.run.status).toBe('cancelled');
    expect(mock.tasks.executeTask).not.toHaveBeenCalled();
  });

  it('treats external process termination as cancellation and stops queued targets', async () => {
    const handle = controller().startSequence([target('build'), target('test')])!;
    await vi.waitFor(() => expect(launched).toHaveLength(1));
    mock.processEnd.fire({ execution: launched[0], exitCode: undefined });
    await handle.completion;
    expect(handle.run.status).toBe('cancelled');
    expect(handle.run.steps.map((step) => step.status)).toEqual(['cancelled', 'skipped']);
  });

  it('treats missing process completion as failure instead of continuing', async () => {
    const handle = controller().startSequence([target('build'), target('test')])!;
    await vi.waitFor(() => expect(launched).toHaveLength(1));
    mock.taskEnd.fire({ execution: launched[0] });
    await handle.completion;
    expect(handle.run.status).toBe('failed');
    expect(handle.run.error).toContain('without a process exit code');
    expect(launched).toHaveLength(1);
  });

  it('isolates concurrent same-name tasks and ignores unrelated task events', async () => {
    const runner = controller();
    const first = runner.startSingle(target('build'));
    const second = runner.startSingle(target('build'));
    await vi.waitFor(() => expect(launched).toHaveLength(2));
    expect(launched[0]!.task.definition.executionId).not.toBe(launched[1]!.task.definition.executionId);
    mock.processEnd.fire({ execution: { task: createMakeTask(target('unrelated')), terminate: vi.fn() }, exitCode: 9 });
    end(1);
    await second.completion;
    expect(first.run.status).toBe('running');
    end(0, 3);
    await first.completion;
    expect(first.run.status).toBe('failed');
    expect(second.run.status).toBe('succeeded');
  });

  it('snapshots selection and argument arrays so later changes cannot change a run', async () => {
    const selected = [target('build'), target('test')];
    const runner = controller();
    const handle = runner.startSequence(selected)!;
    selected.splice(0, selected.length, target('other'));
    await vi.waitFor(() => expect(launched).toHaveLength(1));
    end(0);
    await vi.waitFor(() => expect(launched).toHaveLength(2));
    end(1);
    await handle.completion;
    expect(handle.run.steps.map((step) => step.target.name)).toEqual(['build', 'test']);
    const args = ['MODE=original'];
    const single = runner.startSingle(target('lint'), args);
    args[0] = 'MODE=changed';
    await vi.waitFor(() => expect(launched).toHaveLength(3));
    expect((launched[2]!.task.execution as unknown as mock.ShellExecution).args).toContain('MODE=original');
    end(2);
    await single.completion;
  });

  it('retains all active runs and ten completed runs, then clears only completed history', async () => {
    const runner = controller();
    const active = runner.startSingle(target('long-running'));
    await vi.waitFor(() => expect(launched).toHaveLength(1));
    for (let index = 0; index < 12; index += 1) {
      const handle = runner.startSingle(target(`step${index}`));
      await vi.waitFor(() => expect(launched).toHaveLength(index + 2));
      end(index + 1);
      await handle.completion;
    }
    expect(runner.getRuns()).toHaveLength(11);
    expect(runner.getRuns()[0]!.steps[0]!.target.name).toBe('step11');
    expect(runner.getRuns()).toContain(active.run);
    runner.clearCompleted();
    expect(runner.getRuns()).toEqual([active.run]);
    runner.cancelRun(active.run.id);
    await active.completion;
  });

  it('preserves execution identity when resolving tasks while remaining compatible with older definitions', () => {
    const selected = target('build');
    const provider = new MakefileTaskProvider(() => [{
      uri: selected.makefileUri, workspaceFolder: selected.workspaceFolder, relativePath: 'Makefile', targets: [selected],
    }]);
    expect(provider.resolveTask(createMakeTask(selected, ['MODE=dev'], 'run:0'))?.definition.executionId).toBe('run:0');
    expect(provider.resolveTask(createMakeTask(selected))?.definition.executionId).toBeUndefined();
  });

  it('terminates owned tasks and releases event listeners on disposal', async () => {
    const runner = controller();
    const handle = runner.startSingle(target('build'));
    await vi.waitFor(() => expect(launched).toHaveLength(1));
    runner.dispose();
    await handle.completion;
    expect(launched[0]!.terminate).toHaveBeenCalledOnce();
    expect(mock.processEnd.listenerCount).toBe(0);
    expect(mock.taskEnd.listenerCount).toBe(0);
  });

  it('reruns a single entry in place, preserves its arguments, resets results and moves it to the top', async () => {
    const runner = controller();
    const first = runner.startSingle(target('build'), ['MODE=fast build']);
    await vi.waitFor(() => expect(launched).toHaveLength(1));
    end(0, 3);
    await first.completion;
    const oldTime = first.run.startedAt;
    const oldStepId = first.run.steps[0]!.id;
    const newer = runner.startSingle(target('lint'));
    await vi.waitFor(() => expect(launched).toHaveLength(2));
    end(1);
    await newer.completion;
    expect(runner.getRuns()[0]).toBe(newer.run);
    mock.settings.set('makeCommand', 'gmake');
    const rerun = runner.rerun(first.run.id)!;
    expect(rerun.run).toBe(first.run);
    expect(runner.getRuns()).toEqual([first.run, newer.run]);
    expect(first.run.startedAt).toBeGreaterThan(oldTime);
    expect(first.run.error).toBeUndefined();
    expect(first.run.steps[0]!.id).not.toBe(oldStepId);
    expect(first.run.steps[0]!.status).toBe('waiting');
    expect(first.run.steps[0]!.exitCode).toBeUndefined();
    await vi.waitFor(() => expect(launched).toHaveLength(3));
    const shell = launched[2]!.task.execution as unknown as mock.ShellExecution;
    expect(shell.command).toBe('gmake');
    expect(shell.args).toEqual(['-f', 'Makefile', 'build', 'MODE=fast build']);
    mock.processEnd.fire({ execution: launched[0], exitCode: 9 });
    expect(first.run.status).toBe('running');
    end(2);
    await rerun.completion;
    expect(first.run.status).toBe('succeeded');
    expect(runner.getRuns()).toHaveLength(2);
  });

  it('reruns every step of a failed batch from the beginning and refreshes its existing tree node', async () => {
    const runner = controller();
    const tree = new ExecutionTreeProvider(runner);
    const original = runner.startSequence([target('clean'), target('build'), target('test')])!;
    const root = tree.getRunNode(original.run);
    const oldChildren = tree.getChildren(root);
    await vi.waitFor(() => expect(launched).toHaveLength(1));
    end(0);
    await vi.waitFor(() => expect(launched).toHaveLength(2));
    end(1, 2);
    await original.completion;
    const rerun = runner.rerun(original.run.id)!;
    expect(tree.getRunNode(rerun.run)).toBe(root);
    expect(tree.getChildren(root)[0]).not.toBe(oldChildren[0]);
    expect(rerun.run.steps.map((step) => step.status)).toEqual(['waiting', 'waiting', 'waiting']);
    for (let index = 2; index < 5; index += 1) {
      await vi.waitFor(() => expect(launched).toHaveLength(index + 1));
      end(index);
    }
    await rerun.completion;
    expect(launched.slice(2).map((execution) => execution.task.name)).toEqual(['clean', 'build', 'test']);
    expect(rerun.run.status).toBe('succeeded');
    expect(runner.getRuns()).toHaveLength(1);
    tree.dispose();
  });

  it('protects active records and reruns failed sequences and single runs independently of another batch', async () => {
    const runner = controller();
    const completedBatch = runner.startSequence([target('build')])!;
    await vi.waitFor(() => expect(launched).toHaveLength(1));
    end(0, 2);
    await completedBatch.completion;
    expect(completedBatch.run.status).toBe('failed');
    const single = runner.startSingle(target('lint'));
    await vi.waitFor(() => expect(launched).toHaveLength(2));
    end(1);
    await single.completion;
    const active = runner.startSequence([target('clean'), target('test')])!;
    await vi.waitFor(() => expect(launched).toHaveLength(3));
    expect(runner.rerun(active.run.id)).toBeUndefined();
    expect(runner.deleteRun(active.run.id)).toBe(false);
    const retriedBatch = runner.rerun(completedBatch.run.id)!;
    const independent = runner.rerun(single.run.id)!;
    await vi.waitFor(() => expect(launched).toHaveLength(5));
    expect(retriedBatch.run).toBe(completedBatch.run);
    end(4);
    await independent.completion;
    end(3);
    await retriedBatch.completion;
    expect(retriedBatch.run.status).toBe('succeeded');
    expect(active.run.status).toBe('running');
    runner.cancelRun(active.run.id);
    await active.completion;
    expect(runner.deleteRun(completedBatch.run.id)).toBe(true);
    expect(runner.rerun(completedBatch.run.id)).toBeUndefined();
    expect(runner.deleteRun('missing')).toBe(false);
  });
});

describe('resuming failed runs', () => {
  it('preserves successful steps, refreshes remaining nodes and resumes again from a later failure', async () => {
    const prepare = vi.fn(async (targets: readonly MakefileTarget[]) => targets);
    const runner = controller(prepare);
    const tree = new ExecutionTreeProvider(runner);
    const otherFolder = { ...mock.folder, uri: mock.Uri.file(path.resolve('resume-workspace')) } as vscode.WorkspaceFolder;
    const build = { ...target('build', 'nested/Makefile'), workspaceFolder: otherFolder,
      makefileUri: mock.Uri.file(path.join(otherFolder.uri.fsPath, 'nested/Makefile')) as vscode.Uri };
    const original = runner.startSequence([target('clean'), build, target('test')])!;
    const root = tree.getRunNode(original.run);
    const oldChildren = tree.getChildren(root);
    await vi.waitFor(() => expect(launched).toHaveLength(1));
    end(0);
    await vi.waitFor(() => expect(launched).toHaveLength(2));
    end(1, 2);
    await original.completion;
    const prefix = original.run.steps[0]!;
    const prefixSnapshot = { ...prefix, command: { ...prefix.command, args: [...prefix.command.args] } };
    const failedStep = original.run.steps[1]!;
    const timestamp = original.run.startedAt;
    expect(tree.getTreeItem(root).contextValue).toBe('executionCompletedResumable');
    const newer = runner.startSingle(target('lint'));
    await vi.waitFor(() => expect(launched).toHaveLength(3));
    end(2);
    await newer.completion;
    mock.settings.set('makeCommand', 'gmake');
    const resumed = runner.resume(original.run.id)!;
    expect(resumed.run).toBe(original.run);
    expect(runner.getRuns()).toEqual([original.run, newer.run]);
    expect(original.run.startedAt).toBeGreaterThan(timestamp);
    expect(original.run.error).toBeUndefined();
    expect(original.run.steps[0]).toBe(prefix);
    expect(prefix).toEqual(prefixSnapshot);
    expect(original.run.steps[1]!.id).not.toBe(failedStep.id);
    expect(original.run.steps[1]!.exitCode).toBeUndefined();
    expect(original.run.steps[1]!.error).toBeUndefined();
    expect(original.run.steps.map((step) => step.status)).toEqual(['succeeded', 'waiting', 'waiting']);
    expect(runner.resume(original.run.id)).toBeUndefined();
    const children = tree.getChildren(root);
    expect(children[0]).toBe(oldChildren[0]);
    expect(children[1]).not.toBe(oldChildren[1]);
    expect(children[2]).not.toBe(oldChildren[2]);
    expect(tree.getTreeItem(root).description).toContain('1/3 completed');
    expect(tree.getTreeItem(root).contextValue).toBe('executionActive');
    await vi.waitFor(() => expect(launched).toHaveLength(4));
    expect(prepare).toHaveBeenLastCalledWith([build, original.run.steps[2]!.target]);
    expect(launched[3]!.task.scope).toBe(otherFolder);
    expect((launched[3]!.task.execution as unknown as mock.ShellExecution).options.cwd).toBe(path.dirname(build.makefileUri.fsPath));
    expect(original.run.steps[1]!.command.executable).toBe('gmake');
    expect(prefix.command.executable).toBe('make');
    mock.processEnd.fire({ execution: launched[1], exitCode: 9 });
    expect(original.run.status).toBe('running');
    end(3);
    await vi.waitFor(() => expect(launched).toHaveLength(5));
    end(4, 3);
    await resumed.completion;
    expect(getResumeIndex(original.run)).toBe(2);
    const secondPrefix = original.run.steps[1];
    const last = runner.resume(original.run.id)!;
    await vi.waitFor(() => expect(launched).toHaveLength(6));
    expect(prepare).toHaveBeenLastCalledWith([original.run.steps[2]!.target]);
    expect(original.run.steps[1]).toBe(secondPrefix);
    end(5);
    await last.completion;
    expect(original.run.status).toBe('succeeded');
    expect(prefix).toEqual(prefixSnapshot);
    expect(launched.slice(3).map((execution) => execution.task.name)).toEqual(['build', 'test', 'test']);
    expect(runner.getRuns()).toHaveLength(2);
    tree.dispose();
  });

  it('resumes a failed single target with its original arguments and handles a launch failure', async () => {
    mock.tasks.executeTask.mockRejectedValueOnce(new Error('Could not launch make'));
    const runner = controller();
    const original = runner.startSingle(target('build'), ['MODE=fast build']);
    await original.completion;
    expect(original.run.status).toBe('failed');
    const resumed = runner.resume(original.run.id)!;
    await vi.waitFor(() => expect(launched).toHaveLength(1));
    expect((launched[0]!.task.execution as unknown as mock.ShellExecution).args).toEqual(['-f', 'Makefile', 'build', 'MODE=fast build']);
    end(0);
    await resumed.completion;
    expect(original.run.status).toBe('succeeded');
    expect(runner.getRuns()).toEqual([original.run]);
  });

  it('retries preparation from the first incomplete step without revalidating a successful prefix', async () => {
    const prepare = vi.fn(async (targets: readonly MakefileTarget[]) => targets);
    prepare.mockRejectedValueOnce(new Error('Cannot save Makefile'));
    const runner = controller(prepare);
    const original = runner.startSequence([target('clean'), target('build'), target('test')])!;
    await original.completion;
    expect(original.run.steps.map((step) => step.status)).toEqual(['skipped', 'skipped', 'skipped']);
    expect(launched).toHaveLength(0);
    const retry = runner.resume(original.run.id)!;
    await vi.waitFor(() => expect(launched).toHaveLength(1));
    end(0);
    await vi.waitFor(() => expect(launched).toHaveLength(2));
    end(1, 2);
    await retry.completion;
    const prefix = original.run.steps[0];
    prepare.mockRejectedValueOnce(new Error('Remaining target removed'));
    await runner.resume(original.run.id)!.completion;
    expect(prepare.mock.lastCall![0].map((goal) => goal.name)).toEqual(['build', 'test']);
    expect(original.run.steps[0]).toBe(prefix);
    expect(original.run.steps.map((step) => step.status)).toEqual(['succeeded', 'skipped', 'skipped']);
    expect(original.run.error).toBe('Remaining target removed');
    expect(launched).toHaveLength(2);
    expect(getResumeIndex(original.run)).toBe(1);
  });

  it('cancels only the resumed run and skips its queue while another sequence continues', async () => {
    const runner = controller();
    const original = runner.startSequence([target('clean'), target('build'), target('test')])!;
    await vi.waitFor(() => expect(launched).toHaveLength(1));
    end(0);
    await vi.waitFor(() => expect(launched).toHaveLength(2));
    end(1, 2);
    await original.completion;
    const independent = runner.startSequence([target('lint')])!;
    await vi.waitFor(() => expect(launched).toHaveLength(3));
    const resumed = runner.resume(original.run.id)!;
    await vi.waitFor(() => expect(launched).toHaveLength(4));
    runner.cancelRun(original.run.id);
    await resumed.completion;
    expect(original.run.steps.map((step) => step.status)).toEqual(['succeeded', 'cancelled', 'skipped']);
    expect(launched[3]!.terminate).toHaveBeenCalledOnce();
    expect(launched[2]!.terminate).not.toHaveBeenCalled();
    expect(independent.run.status).toBe('running');
    end(2);
    await independent.completion;
    expect(independent.run.status).toBe('succeeded');
  });

  it.each(['preparing', 'running', 'succeeded', 'cancelled', 'interrupted'] as const)('does not offer resume for a %s record', (status) => {
    const runner = controller();
    const record: ExecutionRun = { id: 'saved', kind: 'single', startedAt: 1, status, steps: [{
      id: 'step', target: target('build'), args: [], status: 'failed', command: { executable: 'make', args: [], cwd: '.' },
    }] };
    const restored = new ExecutionController(undefined, undefined, [record]);
    controllers.push(restored);
    const tree = new ExecutionTreeProvider(restored);
    expect(getResumeIndex(record)).toBeUndefined();
    expect(restored.resume(record.id)).toBeUndefined();
    expect(tree.getTreeItem(tree.getRunNode(record)).contextValue).not.toBe('executionCompletedResumable');
    expect(runner.resume('missing')).toBeUndefined();
    expect(launched).toHaveLength(0);
    tree.dispose();
  });

  it('ignores deleted records and disposed controllers', async () => {
    const runner = controller();
    const original = runner.startSingle(target('build'));
    await vi.waitFor(() => expect(launched).toHaveLength(1));
    end(0, 2);
    await original.completion;
    runner.dispose();
    expect(runner.resume(original.run.id)).toBeUndefined();
    runner.deleteRun(original.run.id);
    expect(runner.resume(original.run.id)).toBeUndefined();
  });
});

describe('task lifecycle races', () => {
  it('captures early completion while ignoring unrelated tasks and later task-end events', async () => {
    mock.tasks.executeTask.mockImplementation(async (task: vscode.Task): Promise<vscode.TaskExecution> => {
      const execution = { task, terminate: vi.fn() };
      mock.processEnd.fire({ execution: { task, terminate: vi.fn() }, exitCode: 9 });
      mock.processEnd.fire({ execution, exitCode: 0 });
      mock.taskEnd.fire({ execution });
      return execution;
    });
    const source = new mock.CancellationTokenSource();
    await expect(executeTaskAndWait(createMakeTask(target('build')), source.token)).resolves.toEqual({ exitCode: 0 });
    source.dispose();
    expect(mock.processEnd.listenerCount).toBe(0);
  });

  it('terminates a task returned after cancellation instead of leaving it running', async () => {
    let resolveLaunch!: (execution: vscode.TaskExecution) => void;
    mock.tasks.executeTask.mockImplementation(() => new Promise<vscode.TaskExecution>((resolve) => { resolveLaunch = resolve; }));
    const runner = controller();
    const handle = runner.startSingle(target('build'));
    await vi.waitFor(() => expect(mock.tasks.executeTask).toHaveBeenCalledOnce());
    runner.cancelRun(handle.run.id);
    const execution = { task: createMakeTask(target('build')), terminate: vi.fn() };
    resolveLaunch(execution);
    await handle.completion;
    expect(execution.terminate).toHaveBeenCalledOnce();
    expect(handle.run.status).toBe('cancelled');
  });
});

describe('execution tree', () => {
  it('shows progress, individual results, error details and cancellation availability', async () => {
    const runner = controller();
    const tree = new ExecutionTreeProvider(runner);
    const handle = runner.startSequence([target('build'), target('test')])!;
    const root = tree.getRunNode(handle.run);
    expect(tree.getTreeItem(root).contextValue).toBe('executionActive');
    expect(tree.getTreeItem(root).description).toContain('0/2 completed');
    await vi.waitFor(() => expect(launched).toHaveLength(1));
    expect(tree.getTreeItem(root).description).toContain('Running build');
    expect(tree.getChildren()[0]).toBe(root);
    const children = tree.getChildren(root);
    expect(tree.getParent(children[0]!)).toBe(root);
    expect((tree.getTreeItem(children[0]!).iconPath as unknown as mock.ThemeIcon).id).toBe('loading~spin');
    end(0, 4);
    await handle.completion;
    expect(tree.getTreeItem(root).contextValue).toBe('executionCompletedResumable');
    expect(tree.getTreeItem(root).description).toContain('1/2 completed');
    expect(tree.getTreeItem(root).tooltip).toContain('Exit code 4');
    expect(tree.getTreeItem(children[0]!).description).toBe('Failed · exit 4');
    expect(tree.getTreeItem(children[1]!).description).toBe('Skipped');
    expect(tree.getTreeItem(children[0]!).command).toBeUndefined();
    runner.clearCompleted();
    expect(tree.getChildren()).toEqual([]);
    tree.dispose();
  });
});

describe('recorded command inspection', () => {
  it('keeps recorded commands stable when settings change and quotes PowerShell arguments literally', async () => {
    const runner = controller();
    const handle = runner.startSingle(target('build', 'nested folder/Makefile'), ["MODE=it's $(unsafe)"]);
    await vi.waitFor(() => expect(launched).toHaveLength(1));
    end(0);
    await handle.completion;
    mock.settings.set('makeCommand', 'other-make');
    const script = formatExecutionCommands(handle.run.steps, true);
    expect(script).toContain("& 'make' '-f' 'Makefile' 'build' 'MODE=it''s $(unsafe)'");
    expect(script).toContain("Set-Location -LiteralPath '");
    expect(script).not.toContain('other-make');
  });

  it('quotes POSIX arguments, preserves per-target directories and stops a copied sequence on failure', async () => {
    const runner = controller(async () => { throw new Error('No execution needed'); });
    const handle = runner.startSequence([target('build'), target('test', 'nested folder/Makefile')])!;
    await handle.completion;
    const script = formatExecutionCommands(handle.run.steps, false);
    expect(script).toContain("'build' &&\ncd '");
    expect(script).toContain("nested folder'");
    const single = runner.startSingle(target('build'), ["MODE=it's $(unsafe)"]);
    await single.completion;
    expect(formatExecutionCommands(single.run.steps, false)).toContain("'MODE=it'\\''s $(unsafe)'");
    expect(formatExecutionCommands(handle.run.steps, true)).toContain('if ($LASTEXITCODE -ne 0) { return }');
  });
});
