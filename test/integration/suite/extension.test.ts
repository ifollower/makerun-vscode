import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { ExecutionController, type ExecutionRun } from '../../../src/execution';
import type { MakefileTarget } from '../../../src/model';
import { targetsInDocument } from '../../../src/codelens';

type ExtensionManifest = {
  name: string;
  publisher: string;
};

function extensionIdFromManifest(): string {
  const manifestPath = path.resolve(__dirname, '../../../../package.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as ExtensionManifest;
  return `${manifest.publisher}.${manifest.name}`;
}

suite('Make Run Tasks extension', () => {
  test('activates and contributes documented Make Run Tasks', async () => {
    const extension = vscode.extensions.getExtension(extensionIdFromManifest());
    assert.ok(extension, 'Extension should be available in the development host.');

    await extension.activate();
    await vscode.commands.executeCommand('makefileTasks.refresh');

    const tasks = await vscode.tasks.fetchTasks({ type: 'makefileTarget' });
    assert.ok(tasks.some((task) => task.name === 'build'), 'Expected the documented build target.');
  });

  test('registers the public commands declared by the manifest', async () => {
    const commands = new Set(await vscode.commands.getCommands(true));
    for (const command of [
      'makefileTasks.refresh',
      'makefileTasks.runTarget',
      'makefileTasks.runTargetWithArgs',
      'makefileTasks.runTargetPicker',
      'makefileTasks.openTarget',
      'makefileTasks.toggleSelectionMode',
      'makefileTasks.runSelectedTargetsInSequence',
      'makefileTasks.clearSelection',
      'makefileTasks.cancelExecution',
      'makefileTasks.clearExecutionHistory',
      'makefileTasks.rerunExecution',
      'makefileTasks.resumeExecution',
      'makefileTasks.deleteExecution',
      'makefileTasks.showExecutionCommands',
      'makefileTasks.copyExecutionCommands',
      'makefileTasks.openExecutionTarget',
    ]) {
      assert.ok(commands.has(command), `Expected command ${command} to be registered.`);
    }
    assert.ok(!commands.has('makefileTasks.runSelectedTargetsInParallel'), 'Parallel execution should not be registered.');
  });

  test('offers editor run actions and follows unsaved edits', async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder);
    const document = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(folder.uri, 'Makefile'));
    await vscode.window.showTextDocument(document);
    const original = document.getText();
    const ownLenses = async (): Promise<vscode.CodeLens[]> => {
      const lenses = await vscode.commands.executeCommand<vscode.CodeLens[]>('vscode.executeCodeLensProvider', document.uri);
      return (lenses ?? []).filter((lens) => lens.command?.command.startsWith('makefileTasks.'));
    };
    const lenses = await ownLenses();
    assert.deepEqual(lenses.map((lens) => lens.command?.command), [
      'makefileTasks.runTarget', 'makefileTasks.runTargetWithArgs',
    ]);
    const originalTargetLine = targetsInDocument(document)[0]!.line;
    assert.equal(lenses[0]?.range.start.line, originalTargetLine);
    try {
      const edit = new vscode.WorkspaceEdit();
      edit.insert(document.uri, new vscode.Position(0, 0), '# Editor change\n\n');
      edit.insert(document.uri, new vscode.Position(document.lineCount - 1, 0), '\n## Edited target\nedited:\n\t@echo edited\n');
      assert.ok(await vscode.workspace.applyEdit(edit));
      assert.ok(document.isDirty);
      const updated = await ownLenses();
      assert.ok(updated.some((lens) => lens.command?.title === '▶ Run edited'));
      await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({ content: 'Another editor' }));
      await vscode.commands.executeCommand('makefileTasks.openTarget', lenses[0]?.command?.arguments?.[0]);
      assert.equal(vscode.window.activeTextEditor?.document.uri.toString(), document.uri.toString());
      assert.equal(vscode.window.activeTextEditor?.selection.start.line, originalTargetLine + 2);
      assert.ok(document.isDirty, 'Navigating should not save the Makefile.');
    } finally {
      const restore = new vscode.WorkspaceEdit();
      restore.replace(document.uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), original);
      await vscode.workspace.applyEdit(restore);
      await document.save();
    }
  });

  test('tracks actual click and CodeLens commands and contributes the fixed execution view', async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder);
    const document = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(folder.uri, 'Makefile'));
    const first = targetsInDocument(document)[0];
    assert.ok(first);
    const clicked = await vscode.commands.executeCommand<ExecutionRun>('makefileTasks.runTarget', { kind: 'target', target: first });
    assert.equal(clicked?.status, 'succeeded');
    assert.equal(clicked?.steps[0]?.exitCode, 0);
    assert.ok(clicked);
    const oldExecutionId = clicked.steps[0]?.id;
    const rerun = await vscode.commands.executeCommand<ExecutionRun>('makefileTasks.rerunExecution', clicked.id);
    assert.equal(rerun?.id, clicked.id, 'Rerun must keep the original history entry identity.');
    assert.equal(rerun?.status, 'succeeded');
    assert.notEqual(rerun?.steps[0]?.id, oldExecutionId, 'Rerun must have a fresh native execution identity.');
    await vscode.commands.executeCommand('makefileTasks.showExecutionCommands', clicked.id);
    assert.ok(vscode.window.activeTextEditor?.document.getText().includes('succeeded (exit 0)'));
    assert.equal(await vscode.commands.executeCommand('makefileTasks.deleteExecution', clicked.id), true);
    assert.equal(await vscode.commands.executeCommand('makefileTasks.rerunExecution', clicked.id), undefined);
    const lenses = await vscode.commands.executeCommand<vscode.CodeLens[]>('vscode.executeCodeLensProvider', document.uri);
    const lens = lenses?.find((item) => item.command?.command === 'makefileTasks.runTarget');
    assert.ok(lens?.command);
    const editorRun = await vscode.commands.executeCommand<ExecutionRun>(lens.command.command, ...lens.command.arguments!);
    assert.equal(editorRun?.status, 'succeeded');
    assert.notEqual(editorRun?.id, clicked?.id);
    const startedIds = new Set<string>();
    const subscription = vscode.tasks.onDidStartTask((event) => {
      if (event.execution.task.definition.executionId) {
        startedIds.add(event.execution.task.definition.executionId as string);
      }
    });
    try {
      const runs = await Promise.all([
        vscode.commands.executeCommand<ExecutionRun>('makefileTasks.runTarget', first),
        vscode.commands.executeCommand<ExecutionRun>('makefileTasks.runTarget', first),
      ]);
      assert.equal(startedIds.size, 2, 'Same-name concurrent runs should have distinct native task identities.');
      assert.ok(runs.every((run) => run?.status === 'succeeded'));
    } finally {
      subscription.dispose();
    }
    await vscode.commands.executeCommand('makefileTasks.execution.focus');
    await vscode.commands.executeCommand('makefileTasks.clearExecutionHistory');
  });

  test('reruns a failed history entry while an actual same-name task is still running', async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder);
    const document = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(folder.uri, 'Makefile'));
    const goal = targetsInDocument(document)[0]!;
    const failed = await vscode.commands.executeCommand<ExecutionRun>('makefileTasks.runTarget', goal, ['EXIT_CODE=2']);
    assert.ok(failed);
    assert.equal(failed.status, 'failed');
    let heldExecution: vscode.TaskExecution | undefined;
    let resolveStarted!: () => void;
    const started = new Promise<void>((resolve) => { resolveStarted = resolve; });
    const subscription = vscode.tasks.onDidStartTaskProcess((event) => {
      if ((event.execution.task.definition.args as string[] | undefined)?.includes('DURATION=30000')) {
        heldExecution = event.execution;
        resolveStarted();
      }
    });
    const held = vscode.commands.executeCommand<ExecutionRun>('makefileTasks.runTarget', goal, ['DURATION=30000']);
    try {
      await started;
      const retried = await vscode.commands.executeCommand<ExecutionRun>('makefileTasks.rerunExecution', failed.id);
      assert.equal(retried?.id, failed.id);
      assert.equal(retried?.status, 'failed', 'The original failure arguments must be preserved.');
      assert.notEqual(retried?.steps[0]?.id, heldExecution?.task.definition.executionId);
      assert.ok(heldExecution && vscode.tasks.taskExecutions.includes(heldExecution), 'The independent task must still be active.');
      const resumed = await vscode.commands.executeCommand<ExecutionRun>('makefileTasks.resumeExecution', failed.id);
      assert.equal(resumed?.id, failed.id);
      assert.equal(resumed?.status, 'failed', 'Resume must preserve the failed target arguments.');
      assert.ok(vscode.tasks.taskExecutions.includes(heldExecution), 'Resuming must not affect the independent run.');
      const fresh = await vscode.commands.executeCommand<ExecutionRun>('makefileTasks.runTarget', goal);
      assert.equal(fresh?.status, 'succeeded');
      assert.ok(vscode.tasks.taskExecutions.includes(heldExecution), 'Starting another task must not end the independent run.');
    } finally {
      subscription.dispose();
      heldExecution?.terminate();
      await held;
    }
  });

  test('orchestrates real process tasks, stops on failure and resumes only remaining goals', async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder);
    const target = (name: string): MakefileTarget => ({
      name, description: name, line: 0, workspaceFolder: folder,
      makefileUri: vscode.Uri.joinPath(folder.uri, 'Makefile'), makefileRelativePath: 'Makefile',
    });
    const launched: string[] = [];
    let shouldFail = true;
    const runner = new ExecutionController(async (targets) => targets, (goal, _args, executionId) => {
      launched.push(goal.name);
      return new vscode.Task({ type: 'process', executionId }, folder, goal.name, 'Make Run Tasks Tests',
        new vscode.ProcessExecution('node', ['-e', `process.exit(${goal.name === 'fail' && shouldFail ? 2 : 0})`]), []);
    });
    try {
      const handle = runner.startSequence([target('first'), target('fail'), target('skipped')]);
      assert.ok(handle);
      await handle.completion;
      assert.deepEqual(launched, ['first', 'fail']);
      assert.equal(handle.run.status, 'failed');
      assert.deepEqual(handle.run.steps.map((step) => step.status), ['succeeded', 'failed', 'skipped']);
      assert.equal(handle.run.steps[1]?.exitCode, 2);
      const prefix = handle.run.steps[0];
      const oldStepId = handle.run.steps[1]?.id;
      shouldFail = false;
      const resumed = runner.resume(handle.run.id);
      assert.ok(resumed);
      await resumed.completion;
      assert.equal(resumed.run, handle.run);
      assert.equal(resumed.run.steps[0], prefix);
      assert.notEqual(resumed.run.steps[1]?.id, oldStepId);
      assert.deepEqual(launched, ['first', 'fail', 'fail', 'skipped']);
      assert.equal(resumed.run.status, 'succeeded');
      assert.deepEqual(resumed.run.steps.map((step) => step.status), ['succeeded', 'succeeded', 'succeeded']);
      assert.equal(runner.getRuns().length, 1);
    } finally {
      runner.dispose();
    }
  });

  test('cancels a real running process and skips queued tasks', async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder);
    const goal: MakefileTarget = {
      name: 'long-running', description: 'Cancellation test', line: 0, workspaceFolder: folder,
      makefileUri: vscode.Uri.joinPath(folder.uri, 'Makefile'), makefileRelativePath: 'Makefile',
    };
    const runner = new ExecutionController(async (targets) => targets, (target, _args, executionId) =>
      new vscode.Task({ type: 'process', executionId }, folder, target.name, 'Make Run Tasks Tests',
        new vscode.ProcessExecution('node', ['-e', 'setTimeout(() => process.exit(0), 30000)']), []));
    const handle = runner.startSequence([goal, { ...goal, name: 'should-not-run' }]);
    assert.ok(handle);
    const subscription = vscode.tasks.onDidStartTaskProcess((event) => {
      if (event.execution.task.name === 'long-running') {
        runner.cancelRun(handle.run.id);
      }
    });
    try {
      await handle.completion;
      assert.equal(handle.run.status, 'cancelled');
      assert.deepEqual(handle.run.steps.map((step) => step.status), ['cancelled', 'skipped']);
    } finally {
      subscription.dispose();
      runner.dispose();
    }
  });
});
