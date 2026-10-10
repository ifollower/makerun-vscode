import * as path from 'node:path';
import * as vscode from 'vscode';
import type { MakefileTarget } from './model';
import { parseMakefile } from './parser';

/** Use editor text so lenses follow edits before a file is saved. */
export function targetsInDocument(document: vscode.TextDocument): MakefileTarget[] {
  const folder = vscode.workspace.getWorkspaceFolder(document.uri);
  if (!folder) {
    return [];
  }
  const relativePath = path.posix.relative(folder.uri.path, document.uri.path);
  return parseMakefile(document.getText()).map((target) => ({
    ...target,
    workspaceFolder: folder,
    makefileUri: document.uri,
    makefileRelativePath: relativePath,
  }));
}

export class MakefileCodeLensProvider implements vscode.CodeLensProvider, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<void>();
  public readonly onDidChangeCodeLenses = this.changed.event;

  public refresh(): void {
    this.changed.fire();
  }

  public dispose(): void {
    this.changed.dispose();
  }

  public provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const configuration = vscode.workspace.getConfiguration('makefileTasks');
    if (!configuration.get<boolean>('codeLens', true)) {
      return [];
    }
    const folder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (!folder) {
      return [];
    }
    const globs = configuration.get<string[]>('fileGlobs', ['**/Makefile', '**/makefile', '**/GNUmakefile']);
    const selectors = globs.map((glob) => ({ pattern: new vscode.RelativePattern(folder, glob) }));
    const exclude = configuration.get<string>('excludeGlob', '**/{.git,node_modules,vendor,.venv,dist,out}/**');
    if (!vscode.languages.match(selectors, document)
      || (exclude && vscode.languages.match({ pattern: new vscode.RelativePattern(folder, exclude) }, document))) {
      return [];
    }

    return targetsInDocument(document).flatMap((target) => {
      const range = new vscode.Range(target.line, 0, target.line, 0);
      return [
        new vscode.CodeLens(range, {
          title: `▶ Run ${target.name}`,
          command: 'makefileTasks.runTarget',
          arguments: [target],
        }),
        new vscode.CodeLens(range, {
          title: `Run ${target.name} with Arguments…`,
          command: 'makefileTasks.runTargetWithArgs',
          arguments: [target],
        }),
      ];
    });
  }
}
