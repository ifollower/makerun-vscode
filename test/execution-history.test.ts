import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as vscode from 'vscode';
import { ExecutionController, getRunDuration, getStepDuration, type ExecutionRun } from '../src/execution';
import { ExecutionTreeProvider } from '../src/executionTree';
import { EXECUTION_HISTORY_KEY, ExecutionHistoryStore, restoreExecutionHistory, serializeExecutionHistory } from '../src/executionHistory';
import type { MakefileTarget } from '../src/model';
import * as mock from './vscode-mock';

vi.mock('vscode', () => import('./vscode-mock'));

const controllers: ExecutionController[] = [];
function runner(initial: readonly ExecutionRun[] = []): ExecutionController {
  const controller = new ExecutionController(undefined, undefined, initial);
  controllers.push(controller);
  return controller;
}
function target(name: string): MakefileTarget {
  return {
    name, description: name, usage: 'MODE=<mode>', category: 'Build', line: 1,
    workspaceFolder: mock.folder as vscode.WorkspaceFolder,
    makefileUri: mock.Uri.file(path.join(mock.folder.uri.fsPath, 'Makefile')) as vscode.Uri,
    makefileRelativePath: 'Makefile',
  };
}
function memoryStore(state = new mock.Memento()): { store: ExecutionHistoryStore; state: mock.Memento; error: ReturnType<typeof vi.fn> } {
  const error = vi.fn();
  return { store: new ExecutionHistoryStore(state, error), state, error };
}

beforeEach(() => {
  vi.clearAllMocks();
  mock.tasks.executeTask.mockReset();
  mock.settings.clear();
  mock.tasks.executeTask.mockImplementation(async (task: vscode.Task): Promise<vscode.TaskExecution> => {
    const execution = { task, terminate: vi.fn() };
    mock.processEnd.fire({ execution, exitCode: 0 });
    return execution;
  });
});
afterEach(async () => {
  controllers.splice(0).forEach((controller) => controller.dispose());
  await Promise.resolve();
  vi.restoreAllMocks();
});

describe('persistent execution history', () => {
  it('persists recorded durations and restores legacy history with unknown durations', async () => {
    let now = 10_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    mock.tasks.executeTask.mockImplementation(async (task: vscode.Task): Promise<vscode.TaskExecution> => {
      const execution = { task, terminate: vi.fn() };
      now += 200;
      mock.processEnd.fire({ execution, exitCode: 0 });
      return execution;
    });
    const controller = runner();
    const { store } = memoryStore();
    store.bind(controller);
    const handle = controller.startSequence([target('clean'), target('build')])!;
    await handle.completion;
    await store.flush();
    const saved = store.restore()[0]!;
    expect(saved.durationMs).toBe(400);
    expect(saved.steps.map((step) => step.durationMs)).toEqual([200, 200]);
    const legacy = serializeExecutionHistory([saved]);
    delete legacy.runs[0]!.durationMs;
    for (const step of legacy.runs[0]!.steps) {
      delete step.startedAt;
      delete step.durationMs;
    }
    const loaded = restoreExecutionHistory(legacy);
    expect(loaded).toHaveLength(1);
    expect(getRunDuration(loaded[0]!)).toBeUndefined();
    const restored = runner(loaded);
    const tree = new ExecutionTreeProvider(restored);
    const root = tree.getChildren()[0]!;
    expect(tree.getTreeItem(root).description).toContain('Total —');
    expect(tree.getTreeItem(tree.getChildren(root)[0]!).description).toContain('· —');
    for (const invalid of [-1, NaN, 'bad']) {
      expect(restoreExecutionHistory({ ...legacy, runs: [{ ...legacy.runs[0], durationMs: invalid }] })).toEqual([]);
      expect(restoreExecutionHistory({ ...legacy, runs: [{ ...legacy.runs[0], steps: [{ ...legacy.runs[0]!.steps[0], durationMs: invalid }] }] })).toEqual([]);
    }
    tree.dispose();
    store.dispose();
  });

  it('checkpoints live timing and freezes interrupted records without counting time while the window was closed', async () => {
    let now = 1000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    mock.tasks.executeTask.mockImplementation(async (task: vscode.Task): Promise<vscode.TaskExecution> => ({ task, terminate: vi.fn() }));
    const controller = runner();
    const { store } = memoryStore();
    store.bind(controller);
    const handle = controller.startSingle(target('build'));
    await Promise.resolve();
    await Promise.resolve();
    now = 3345;
    store.checkpoint();
    await store.flush();
    now += 86_400_000;
    const restored = store.restore()[0]!;
    expect(restored.status).toBe('interrupted');
    expect(getRunDuration(restored)).toBe(2345);
    expect(getStepDuration(restored.steps[0]!)).toBe(2345);
    controller.cancelRun(handle.run.id);
    await handle.completion;
    store.dispose();
  });

  it('round-trips results, parameters, URI objects and command snapshots without starting tasks on restore', async () => {
    const controller = runner();
    const { store, state } = memoryStore();
    store.bind(controller);
    const handle = controller.startSingle(target('build'), ['MODE=fast build']);
    await handle.completion;
    await store.flush();
    store.dispose();
    const loaded = memoryStore(state).store.restore();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.id).toBe(handle.run.id);
    expect(loaded[0]!.status).toBe('succeeded');
    expect(loaded[0]!.steps[0]!.args).toEqual(['MODE=fast build']);
    expect(loaded[0]!.steps[0]!.exitCode).toBe(0);
    expect(loaded[0]!.steps[0]!.command).toEqual(handle.run.steps[0]!.command);
    expect(loaded[0]!.steps[0]!.target.makefileUri).toBeInstanceOf(mock.Uri);
    expect(loaded[0]!.steps[0]!.target.makefileUri.toString()).toBe(handle.run.steps[0]!.target.makefileUri.toString());
    expect(loaded[0]!.steps[0]!.target.workspaceFolder).toBe(mock.folder);
    expect(mock.tasks.executeTask).toHaveBeenCalledOnce();
  });

  it('restores remote URIs and keeps metadata for folders no longer in the workspace', async () => {
    const controller = runner();
    const remote = {
      ...target('build'), makefileUri: mock.Uri.parse('vscode-remote://ssh-remote+demo/home/project/Makefile') as vscode.Uri,
      workspaceFolder: {
        name: 'Remote', index: 1, uri: mock.Uri.parse('vscode-remote://ssh-remote+demo/home/project'),
      } as vscode.WorkspaceFolder,
    };
    const handle = controller.startSingle(remote);
    await handle.completion;
    const loaded = restoreExecutionHistory(serializeExecutionHistory([handle.run]));
    expect(loaded[0]!.steps[0]!.target.makefileUri.toString()).toBe(remote.makefileUri.toString());
    expect(loaded[0]!.steps[0]!.target.workspaceFolder.uri.toString()).toBe(remote.workspaceFolder.uri.toString());
    expect(loaded[0]!.steps[0]!.target.workspaceFolder.name).toBe('Remote');
  });

  it('marks previously running records interrupted and skips queued steps instead of resuming them', async () => {
    const controller = runner();
    let launched!: vscode.TaskExecution;
    mock.tasks.executeTask.mockImplementation(async (task: vscode.Task): Promise<vscode.TaskExecution> => {
      launched = { task, terminate: vi.fn() };
      return launched;
    });
    const handle = controller.startSequence([target('build'), target('test')])!;
    await vi.waitFor(() => expect(handle.run.steps[0]!.status).toBe('running'));
    const loaded = restoreExecutionHistory(serializeExecutionHistory(controller.getRuns()));
    expect(loaded[0]!.status).toBe('interrupted');
    expect(loaded[0]!.steps.map((step) => step.status)).toEqual(['interrupted', 'skipped']);
    expect(loaded[0]!.error).toContain('will not resume automatically');
    const restored = runner(loaded);
    expect(restored.batchRunning).toBe(false);
    expect(mock.tasks.executeTask).toHaveBeenCalledOnce();
    const tree = new ExecutionTreeProvider(restored);
    expect(tree.getTreeItem(tree.getChildren()[0]!).description).toContain('Interrupted');
    expect(tree.getTreeItem(tree.getChildren()[0]!).contextValue).toBe('executionCompletedSequence');
    tree.dispose();
    controller.cancelRun(handle.run.id);
    await handle.completion;
  });

  it('persists in-place reruns, their updated order, deletion, and clearing across new store instances', async () => {
    const controller = runner();
    const { store, state } = memoryStore();
    store.bind(controller);
    const first = controller.startSingle(target('build'), ['MODE=dev']);
    await first.completion;
    const second = controller.startSingle(target('test'));
    await second.completion;
    await store.flush();
    store.dispose();
    const restoredStore = memoryStore(state).store;
    const restored = runner(restoredStore.restore());
    restoredStore.bind(restored);
    const handle = restored.rerun(first.run.id)!;
    await handle.completion;
    await restoredStore.flush();
    expect(restoredStore.restore().map((run) => run.id)).toEqual([first.run.id, second.run.id]);
    expect(restoredStore.restore()[0]!.steps[0]!.args).toEqual(['MODE=dev']);
    restored.deleteRun(first.run.id);
    await restoredStore.flush();
    expect(restoredStore.restore().map((run) => run.id)).toEqual([second.run.id]);
    restored.clearCompleted();
    await restoredStore.flush();
    expect(memoryStore(state).store.restore()).toEqual([]);
    restoredStore.dispose();
  });

  it('keeps workspaces isolated and bounds restored history to the latest ten records', async () => {
    const controller = runner();
    const firstWorkspace = memoryStore();
    firstWorkspace.store.bind(controller);
    const handle = controller.startSingle(target('build'));
    await handle.completion;
    await firstWorkspace.store.flush();
    expect(memoryStore().store.restore()).toEqual([]);
    const records = Array.from({ length: 15 }, (_, index) => ({ ...handle.run, id: `run${index}`, startedAt: index }));
    const loaded = restoreExecutionHistory(serializeExecutionHistory(records));
    expect(loaded).toHaveLength(10);
    expect(loaded[0]!.id).toBe('run14');
    expect(loaded[9]!.id).toBe('run5');
    firstWorkspace.store.dispose();
  });

  it('resumes saved failures in place and restores successful results without changing the history schema', async () => {
    mock.tasks.executeTask.mockImplementation(async (task: vscode.Task): Promise<vscode.TaskExecution> => {
      const execution = { task, terminate: vi.fn() };
      mock.processEnd.fire({ execution, exitCode: task.name === 'build' ? 2 : 0 });
      return execution;
    });
    const controller = runner();
    const { store, state } = memoryStore();
    store.bind(controller);
    const original = controller.startSequence([target('clean'), target('build'), target('test')])!;
    await original.completion;
    await controller.startSingle(target('lint')).completion;
    await store.flush();
    store.dispose();
    const reloadedStore = memoryStore(state).store;
    const restored = runner(reloadedStore.restore());
    reloadedStore.bind(restored);
    const saved = restored.getRuns().find((run) => run.id === original.run.id)!;
    const prefix = saved.steps[0]!;
    expect(saved.status).toBe('failed');
    const tree = new ExecutionTreeProvider(restored);
    expect(tree.getTreeItem(tree.getRunNode(saved)).contextValue).toBe('executionCompletedResumable');
    const invocations = mock.tasks.executeTask.mock.calls.length;
    mock.tasks.executeTask.mockImplementation(async (task: vscode.Task): Promise<vscode.TaskExecution> => {
      const execution = { task, terminate: vi.fn() };
      mock.processEnd.fire({ execution, exitCode: 0 });
      return execution;
    });
    const resumed = restored.resume(saved.id)!;
    await resumed.completion;
    await reloadedStore.flush();
    expect(mock.tasks.executeTask.mock.calls.slice(invocations).map(([task]) => task.name)).toEqual(['build', 'test']);
    expect(saved.steps[0]).toBe(prefix);
    expect(saved.status).toBe('succeeded');
    const loaded = memoryStore(state).store.restore();
    expect(loaded).toHaveLength(2);
    expect(loaded[0]!.id).toBe(original.run.id);
    expect(loaded[0]!.steps[0]).toEqual(prefix);
    expect(loaded[0]!.steps.map((step) => step.status)).toEqual(['succeeded', 'succeeded', 'succeeded']);
    expect(loaded[0]!.startedAt).toBe(saved.startedAt);
    expect((state.get(EXECUTION_HISTORY_KEY) as { version: number }).version).toBe(1);
    tree.dispose();
    reloadedStore.dispose();
  });

  it('restores an unfinished resume as interrupted while retaining its completed prefix', async () => {
    mock.tasks.executeTask.mockImplementation(async (task: vscode.Task): Promise<vscode.TaskExecution> => {
      const execution = { task, terminate: vi.fn() };
      mock.processEnd.fire({ execution, exitCode: task.name === 'build' ? 2 : 0 });
      return execution;
    });
    const controller = runner();
    const original = controller.startSequence([target('clean'), target('build'), target('test')])!;
    await original.completion;
    let execution!: vscode.TaskExecution;
    mock.tasks.executeTask.mockImplementation(async (task: vscode.Task): Promise<vscode.TaskExecution> => {
      execution = { task, terminate: vi.fn() };
      return execution;
    });
    const resumed = controller.resume(original.run.id)!;
    await vi.waitFor(() => expect(execution).toBeDefined());
    const loaded = restoreExecutionHistory(serializeExecutionHistory(controller.getRuns()));
    expect(loaded[0]!.status).toBe('interrupted');
    expect(loaded[0]!.steps.map((step) => step.status)).toEqual(['succeeded', 'interrupted', 'skipped']);
    const restored = runner(loaded);
    expect(restored.resume(original.run.id)).toBeUndefined();
    controller.cancelRun(original.run.id);
    await resumed.completion;
  });

  it('ignores corrupt entries without truncating a batch into a different replay', async () => {
    const controller = runner();
    const handle = controller.startSingle(target('build'));
    await handle.completion;
    const saved = serializeExecutionHistory([handle.run]);
    const corrupt = { ...saved.runs[0], id: 'broken', kind: 'sequence', steps: [...saved.runs[0]!.steps, null] };
    expect(restoreExecutionHistory({ version: 1, runs: [corrupt, ...saved.runs] }).map((run) => run.id)).toEqual([handle.run.id]);
    expect(restoreExecutionHistory({ version: 2, runs: saved.runs })).toEqual([]);
    expect(restoreExecutionHistory(null)).toEqual([]);
    const invalidUri = { ...saved.runs[0]!.steps[0]!, target: { ...saved.runs[0]!.steps[0]!.target, makefileUri: 'not a URI' } };
    expect(restoreExecutionHistory({ version: 1, runs: [{ ...saved.runs[0], steps: [invalidUri] }] })).toEqual([]);
  });

  it('captures independent snapshots and serializes writes so a slower update cannot restore deleted data', async () => {
    const controller = runner();
    const handle = controller.startSingle(target('build'));
    await handle.completion;
    let resolveFirst!: () => void;
    const writes: unknown[] = [];
    const state = new mock.Memento();
    state.update.mockImplementation(async (_key, value) => {
      writes.push(value);
      if (writes.length === 1) {
        await new Promise<void>((resolve) => { resolveFirst = resolve; });
      }
    });
    const { store } = memoryStore(state);
    store.save([handle.run]);
    handle.run.status = 'failed';
    store.save([]);
    await vi.waitFor(() => expect(writes).toHaveLength(1));
    expect((writes[0] as ReturnType<typeof serializeExecutionHistory>).runs[0]!.status).toBe('succeeded');
    resolveFirst();
    await store.flush();
    expect(writes).toHaveLength(2);
    expect(writes[1]).toEqual({ version: 1, runs: [] });
  });

  it('reports storage failures and allows a later update to succeed', async () => {
    const { store, state, error } = memoryStore();
    state.update.mockRejectedValueOnce(new Error('Storage unavailable'));
    store.save([]);
    await store.flush();
    expect(error).toHaveBeenCalledOnce();
    store.save([]);
    await store.flush();
    expect(state.get(EXECUTION_HISTORY_KEY)).toEqual({ version: 1, runs: [] });
  });
});
