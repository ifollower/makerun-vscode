import * as path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as vscode from 'vscode';
import { MakefileCodeLensProvider } from '../src/codelens';
import type { MakefileDocument, MakefileTarget } from '../src/model';
import { MakefileTreeProvider, type TargetNode } from '../src/tree';
import * as mock from './vscode-mock';

vi.mock('vscode', () => import('./vscode-mock'));

function target(name: string, makefile = 'Makefile'): MakefileTarget {
  return {
    name, description: name, line: 0, workspaceFolder: mock.folder as vscode.WorkspaceFolder,
    makefileUri: mock.Uri.file(path.join(mock.folder.uri.fsPath, makefile)) as vscode.Uri,
    makefileRelativePath: makefile,
  };
}

function document(targets: MakefileTarget[]): MakefileDocument {
  const first = targets[0]!;
  return { workspaceFolder: first.workspaceFolder, uri: first.makefileUri, relativePath: first.makefileRelativePath, targets };
}

beforeEach(() => {
  vi.clearAllMocks();
  mock.settings.clear();
  mock.workspace.getWorkspaceFolder.mockReturnValue(mock.folder);
  mock.languages.match.mockReturnValue(0);
});

describe('explorer selection', () => {
  it('opens target definitions on normal clicks and selects targets in multi-select mode', () => {
    const tree = new MakefileTreeProvider();
    const node: TargetNode = { kind: 'target', target: target('build') };
    // Legacy user settings must not restore accidental click-to-run behavior.
    mock.settings.set('runOnClick', true);
    expect(tree.getTreeItem(node).command?.command).toBe('makefileTasks.openTarget');
    tree.setSelectionMode(true);
    expect(tree.getTreeItem(node).command?.command).toBe('makefileTasks.toggleTargetSelection');
    expect(tree.getTreeItem(node).checkboxState).toBe(mock.TreeItemCheckboxState.Unchecked);
    tree.setTargetSelected(node.target, true);
    expect(tree.getTreeItem(node).checkboxState).toBe(mock.TreeItemCheckboxState.Checked);
    tree.setSelectionMode(false);
    expect(tree.getSelectedTargets()).toEqual([]);
    expect(tree.getTreeItem(node).command?.command).toBe('makefileTasks.openTarget');
  });

  it('preserves check order across refresh, updates metadata and removes deleted targets', () => {
    const tree = new MakefileTreeProvider();
    const build = target('build');
    const test = target('test');
    const nested = target('build', 'nested/Makefile');
    tree.setDocuments([document([build, test]), document([nested])]);
    tree.setSelectionMode(true);
    tree.setTargetSelected(nested, true);
    tree.setTargetSelected(test, true);
    tree.setTargetSelected(build, true);
    tree.setTargetSelected(test, true);
    expect(tree.getSelectedTargets()).toEqual([nested, test, build]);
    expect(tree.getTreeItem({ kind: 'target', target: build }).description).toBe('#3');
    const updated = { ...build, line: 10 };
    tree.setDocuments([document([updated]), document([nested])]);
    expect(tree.getSelectedTargets()).toEqual([nested, updated]);
    expect(tree.getTreeItem({ kind: 'target', target: updated }).description).toBe('#2');
    expect(tree.getTreeItem({ kind: 'target', target: build }).id)
      .not.toBe(tree.getTreeItem({ kind: 'target', target: nested }).id);
    tree.clearSelection();
    expect(tree.getSelectedTargets()).toEqual([]);
  });
});

describe('editor CodeLens', () => {
  function editor(text: string): vscode.TextDocument {
    return { uri: target('build').makefileUri, getText: (): string => text } as vscode.TextDocument;
  }

  it('uses live editor text and offers separate run and argument actions for each rule target', () => {
    mock.languages.match.mockReturnValueOnce(1).mockReturnValueOnce(0);
    const provider = new MakefileCodeLensProvider();
    const lenses = provider.provideCodeLenses(editor('helper:\n\t@echo hidden\n\n## Build variants\nalpha beta:\n'));
    expect(lenses).toHaveLength(4);
    expect(lenses.map((lens) => lens.command?.command))
      .toEqual(['makefileTasks.runTarget', 'makefileTasks.runTargetWithArgs', 'makefileTasks.runTarget', 'makefileTasks.runTargetWithArgs']);
    expect(lenses.map((lens) => lens.command?.arguments?.[0].name)).toEqual(['alpha', 'alpha', 'beta', 'beta']);
    expect(lenses.map((lens) => (lens.range as unknown as mock.Range).startLine)).toEqual([4, 4, 4, 4]);
  });

  it('honors disabled lenses, include patterns, excludes and workspace membership', () => {
    const provider = new MakefileCodeLensProvider();
    const doc = editor('build: ## Build\n');
    mock.settings.set('codeLens', false);
    expect(provider.provideCodeLenses(doc)).toEqual([]);
    mock.settings.set('codeLens', true);
    expect(provider.provideCodeLenses(doc)).toEqual([]);
    mock.languages.match.mockReturnValueOnce(1).mockReturnValueOnce(1);
    expect(provider.provideCodeLenses(doc)).toEqual([]);
    mock.workspace.getWorkspaceFolder.mockReturnValue(undefined as unknown as typeof mock.folder);
    expect(provider.provideCodeLenses(doc)).toEqual([]);
  });
});
