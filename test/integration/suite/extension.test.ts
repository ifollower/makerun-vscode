import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { createMakeTargetsTask } from '../../../src/batch';
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
    assert.equal(lenses[0]?.range.start.line, 1);
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
      assert.equal(vscode.window.activeTextEditor?.selection.start.line, 3);
      assert.ok(document.isDirty, 'Navigating should not save the Makefile.');
    } finally {
      const restore = new vscode.WorkspaceEdit();
      restore.replace(document.uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), original);
      await vscode.workspace.applyEdit(restore);
      await document.save();
    }
  });

  test('combines selected goals into one shell task in the selected Makefile directory', async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder);
    const document = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(folder.uri, 'Makefile'));
    const first = targetsInDocument(document)[0];
    assert.ok(first);
    const task = createMakeTargetsTask([first, { ...first, name: 'helper' }]);
    assert.ok(task.execution instanceof vscode.ShellExecution);
    assert.deepEqual(task.execution.args, ['-f', 'Makefile', 'build', 'helper']);
    assert.equal(task.execution.options?.cwd, folder.uri.fsPath);
    assert.equal(task.name, 'build helper');
  });
});
