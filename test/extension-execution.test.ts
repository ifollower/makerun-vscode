import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as vscode from 'vscode';
import { activate, deactivate } from '../src/extension';
import { MakefileDiscovery } from '../src/discovery';
import { MakefileCodeLensProvider } from '../src/codelens';
import type { ExecutionRun } from '../src/execution';
import { ExecutionTreeProvider } from '../src/executionTree';
import { MakefileTreeProvider, type TargetNode } from '../src/tree';
import type { MakefileTarget } from '../src/model';
import * as mock from './vscode-mock';

vi.mock('vscode', () => import('./vscode-mock'));

let context: vscode.ExtensionContext;
let build: MakefileTarget;
let launched: vscode.TaskExecution[];

beforeEach(async () => {
  vi.clearAllMocks();
  mock.tasks.executeTask.mockReset();
  mock.settings.clear();
  mock.contexts.clear();
  mock.workspace.getWorkspaceFolder.mockReturnValue(mock.folder);
  mock.languages.match.mockImplementation((selector: unknown) => Array.isArray(selector) ? 1 : 0);
  build = {
    name: 'build', description: 'Build', line: 1,
    workspaceFolder: mock.folder as vscode.WorkspaceFolder,
    makefileUri: mock.Uri.file(path.join(mock.folder.uri.fsPath, 'Makefile')) as vscode.Uri,
    makefileRelativePath: 'Makefile',
  };
  const document = { uri: build.makefileUri, getText: (): string => '## Build\nbuild:\n', isDirty: false, save: vi.fn(async () => true) };
  mock.workspace.openTextDocument.mockResolvedValue(document);
  vi.spyOn(MakefileDiscovery.prototype, 'discover').mockResolvedValue([{
    uri: build.makefileUri, workspaceFolder: build.workspaceFolder, relativePath: 'Makefile', targets: [build],
  }]);
  launched = [];
  mock.tasks.executeTask.mockImplementation(async (task: vscode.Task): Promise<vscode.TaskExecution> => {
    const execution = { task, terminate: vi.fn() };
    launched.push(execution);
    return execution;
  });
  context = { subscriptions: [], extensionUri: undefined, workspaceState: new mock.Memento() } as unknown as vscode.ExtensionContext;
  activate(context);
  await mock.commands.executeCommand('makefileTasks.refresh');
});

afterEach(async () => {
  context.subscriptions.forEach((subscription) => subscription.dispose());
  await Promise.resolve();
  await deactivate();
  vi.restoreAllMocks();
});

function executionView(): mock.MockTreeView {
  return mock.views.get('makefileTasks.execution')!;
}

function end(index: number): void {
  mock.processEnd.fire({ execution: launched[index], exitCode: 0 });
}

describe('extension execution entry points', () => {
  it('tracks a normal task click and expands the fixed execution view without stealing focus', async () => {
    const tree = mock.views.get('makefileTasks.targets')!.provider as MakefileTreeProvider;
    const command = tree.getTreeItem({ kind: 'target', target: build }).command!;
    const running = mock.commands.executeCommand(command.command, ...command.arguments!);
    await vi.waitFor(() => expect(launched).toHaveLength(1));
    expect(executionView().description).toBe('1 active');
    expect(executionView().reveal).toHaveBeenCalledWith(expect.objectContaining({ kind: 'run' }), { expand: true, select: false, focus: false });
    end(0);
    const result = await running as ExecutionRun;
    expect(result.status).toBe('succeeded');
    expect(executionView().description).toBe('');
    expect(mock.contexts.get('makefileTasks.hasCompletedExecutions')).toBe(true);
    expect((executionView().provider as ExecutionTreeProvider).getChildren()).toHaveLength(1);
    expect(mock.window.withProgress).not.toHaveBeenCalled();
    expect(mock.window.showErrorMessage).not.toHaveBeenCalled();
  });

  it('tracks argument actions, CodeLens run actions, and the target picker through the same view', async () => {
    mock.window.showInputBox.mockResolvedValue('MODE="fast build"');
    const withArgs = mock.commands.executeCommand('makefileTasks.runTargetWithArgs', { kind: 'target', target: build });
    await vi.waitFor(() => expect(launched).toHaveLength(1));
    expect((launched[0]!.task.execution as unknown as mock.ShellExecution).args).toContain('MODE=fast build');
    end(0);
    expect((await withArgs as ExecutionRun).status).toBe('succeeded');

    const document = await mock.workspace.openTextDocument();
    const lenses = new MakefileCodeLensProvider().provideCodeLenses(document);
    const lens = lenses[0]!.command!;
    const editorRun = mock.commands.executeCommand(lens.command, ...lens.arguments!);
    await vi.waitFor(() => expect(launched).toHaveLength(2));
    end(1);
    expect((await editorRun as ExecutionRun).status).toBe('succeeded');

    mock.window.showQuickPick.mockResolvedValue({ target: build });
    const pickerRun = mock.commands.executeCommand('makefileTasks.runTargetPicker');
    await vi.waitFor(() => expect(launched).toHaveLength(3));
    end(2);
    await pickerRun;
    expect((executionView().provider as ExecutionTreeProvider).getChildren()).toHaveLength(3);
  });

  it('tracks a batch until completion and cancels only that record', async () => {
    const node: TargetNode = { kind: 'target', target: build };
    await mock.commands.executeCommand('makefileTasks.toggleSelectionMode');
    await mock.commands.executeCommand('makefileTasks.toggleTargetSelection', node);
    const batch = mock.commands.executeCommand('makefileTasks.runSelectedTargetsInSequence');
    await vi.waitFor(() => expect(launched).toHaveLength(1));
    expect(mock.contexts.get('makefileTasks.batchRunning')).toBe(true);
    const roots = (executionView().provider as ExecutionTreeProvider).getChildren();
    await mock.commands.executeCommand('makefileTasks.cancelExecution', roots[0]);
    expect((await batch as ExecutionRun).status).toBe('cancelled');
    expect(mock.contexts.get('makefileTasks.batchRunning')).toBe(false);
    expect(launched[0]!.terminate).toHaveBeenCalledOnce();
    await mock.commands.executeCommand('makefileTasks.clearExecutionHistory');
    expect((executionView().provider as ExecutionTreeProvider).getChildren()).toEqual([]);
  });

  it('shows save failures in the fixed view without running tasks or opening a notification', async () => {
    mock.workspace.openTextDocument.mockResolvedValue({ uri: build.makefileUri, isDirty: true, save: async (): Promise<boolean> => false });
    const result = await mock.commands.executeCommand('makefileTasks.runTarget', build) as ExecutionRun;
    expect(result.status).toBe('failed');
    expect(result.error).toContain('Could not save');
    expect(mock.tasks.executeTask).not.toHaveBeenCalled();
    expect(mock.window.showErrorMessage).not.toHaveBeenCalled();
  });

  it('starts new runs and reruns a failed batch while another batch is running', async () => {
    await mock.commands.executeCommand('makefileTasks.toggleSelectionMode');
    await mock.commands.executeCommand('makefileTasks.toggleTargetSelection', { kind: 'target', target: build });
    const failed = mock.commands.executeCommand('makefileTasks.runSelectedTargetsInSequence');
    await vi.waitFor(() => expect(launched).toHaveLength(1));
    mock.processEnd.fire({ execution: launched[0], exitCode: 2 });
    const original = await failed as ExecutionRun;
    expect(original.status).toBe('failed');
    const tree = executionView().provider as ExecutionTreeProvider;
    const root = tree.getChildren()[0]!;
    const active = mock.commands.executeCommand('makefileTasks.runSelectedTargetsInSequence');
    await vi.waitFor(() => expect(launched).toHaveLength(2));
    const activeRoot = tree.getChildren()[0]!;
    const rerun = mock.commands.executeCommand('makefileTasks.rerunExecution', root);
    const independent = mock.commands.executeCommand('makefileTasks.runTarget', build);
    await vi.waitFor(() => expect(launched).toHaveLength(4));
    expect(executionView().description).toBe('3 active');
    end(2);
    expect((await rerun as ExecutionRun).id).toBe(original.id);
    expect(original.status).toBe('succeeded');
    expect(tree.getChildren()).toHaveLength(3);
    expect(launched[1]!.terminate).not.toHaveBeenCalled();
    await mock.commands.executeCommand('makefileTasks.cancelExecution', activeRoot);
    expect((await active as ExecutionRun).status).toBe('cancelled');
    expect(launched[3]!.terminate).not.toHaveBeenCalled();
    end(3);
    expect((await independent as ExecutionRun).status).toBe('succeeded');
    expect(mock.window.showErrorMessage).not.toHaveBeenCalled();
  });

  it('reruns and deletes a history entry through its row actions without creating another record', async () => {
    mock.window.showInputBox.mockResolvedValue('MODE=dev');
    const running = mock.commands.executeCommand('makefileTasks.runTargetWithArgs', build);
    await vi.waitFor(() => expect(launched).toHaveLength(1));
    end(0);
    const original = await running as ExecutionRun;
    const tree = executionView().provider as ExecutionTreeProvider;
    const root = tree.getChildren()[0]!;
    const oldStepId = original.steps[0]!.id;
    const rerun = mock.commands.executeCommand('makefileTasks.rerunExecution', root);
    await vi.waitFor(() => expect(launched).toHaveLength(2));
    expect(tree.getChildren()).toHaveLength(1);
    expect(original.steps[0]!.id).not.toBe(oldStepId);
    expect((launched[1]!.task.execution as unknown as mock.ShellExecution).args).toContain('MODE=dev');
    expect(await mock.commands.executeCommand('makefileTasks.deleteExecution', root)).toBe(false);
    end(1);
    expect((await rerun as ExecutionRun).id).toBe(original.id);
    expect(await mock.commands.executeCommand('makefileTasks.deleteExecution', root)).toBe(true);
    expect(tree.getChildren()).toEqual([]);
    expect(mock.contexts.get('makefileTasks.hasCompletedExecutions')).toBe(false);
    expect(await mock.commands.executeCommand('makefileTasks.rerunExecution', root)).toBeUndefined();
  });

  it('inspects, copies and navigates from recorded steps without starting tasks', async () => {
    const running = mock.commands.executeCommand('makefileTasks.runTarget', build);
    await vi.waitFor(() => expect(launched).toHaveLength(1));
    end(0);
    await running;
    const tree = executionView().provider as ExecutionTreeProvider;
    const root = tree.getChildren()[0]!;
    const step = tree.getChildren(root)[0]!;
    await mock.commands.executeCommand('makefileTasks.copyExecutionCommands', root);
    expect(mock.env.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining("'make' '-f' 'Makefile' 'build'"));
    await mock.commands.executeCommand('makefileTasks.showExecutionCommands', step);
    expect(mock.workspace.openTextDocument).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('# build: succeeded (exit 0)'),
    }));
    await mock.commands.executeCommand('makefileTasks.openExecutionTarget', step);
    expect(mock.commands.executeCommand).toHaveBeenCalledWith('makefileTasks.openTarget', expect.objectContaining({ name: 'build' }));
    expect(mock.tasks.executeTask).toHaveBeenCalledOnce();
  });
});
