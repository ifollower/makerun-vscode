import * as path from 'node:path';
import * as vscode from 'vscode';
import type { MakefileDocument, MakefileTarget, MakefileTaskDefinition } from './model';

function makefileDirectory(uri: vscode.Uri): string {
  return path.dirname(uri.fsPath);
}

export interface MakeTaskCommand {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
}

export function getMakeTaskCommand(target: MakefileTarget, extraArgs: readonly string[] = []): MakeTaskCommand {
  return {
    executable: vscode.workspace.getConfiguration('makefileTasks').get<string>('makeCommand', 'make'),
    args: ['-f', path.basename(target.makefileUri.fsPath), target.name, ...extraArgs],
    cwd: makefileDirectory(target.makefileUri),
  };
}

function taskGroupForCategory(category: string | undefined): vscode.TaskGroup | undefined {
  switch (category?.trim().toLowerCase()) {
    case 'build':
      return vscode.TaskGroup.Build;
    case 'test':
      return vscode.TaskGroup.Test;
    case 'clean':
      return vscode.TaskGroup.Clean;
    case 'rebuild':
    case 'rebuild all':
      return vscode.TaskGroup.Rebuild;
    default:
      return undefined;
  }
}

export function createMakeTask(target: MakefileTarget, extraArgs: readonly string[] = [], executionId?: string): vscode.Task {
  const definition: MakefileTaskDefinition = {
    type: 'makefileTarget',
    target: target.name,
    makefile: target.makefileRelativePath,
    ...(extraArgs.length > 0 ? { args: extraArgs } : {}),
    ...(executionId ? { executionId } : {}),
  };
  const command = getMakeTaskCommand(target, extraArgs);
  const execution = new vscode.ShellExecution(
    command.executable,
    [...command.args],
    { cwd: command.cwd },
  );
  const task = new vscode.Task(
    definition,
    target.workspaceFolder,
    target.name,
    'Makefile',
    execution,
    [],
  );
  task.detail = [
    target.description,
    target.category ? `Category: ${target.category}` : undefined,
    target.usage ? `Usage: make ${target.name} ${target.usage}` : undefined,
  ]
    .filter((value): value is string => Boolean(value))
    .join(' · ');
  const group = taskGroupForCategory(target.category);
  if (group) {
    task.group = group;
  }
  task.presentationOptions = {
    reveal: vscode.TaskRevealKind.Always,
    panel: vscode.TaskPanelKind.Shared,
    clear: false,
    focus: false,
    echo: true,
  };
  return task;
}

export class MakefileTaskProvider implements vscode.TaskProvider {
  public constructor(private readonly getDocuments: () => readonly MakefileDocument[]) {}

  public provideTasks(): vscode.Task[] {
    return this.getDocuments().flatMap((document) => document.targets.map((target) => createMakeTask(target)));
  }

  public resolveTask(task: vscode.Task): vscode.Task | undefined {
    const definition = task.definition as Partial<MakefileTaskDefinition>;
    if (definition.type !== 'makefileTarget' || !definition.target) {
      return undefined;
    }

    const matchingTarget = this.getDocuments()
      .flatMap((document) => document.targets)
      .find((target) => {
        const sameTarget = target.name === definition.target;
        const sameMakefile = !definition.makefile || target.makefileRelativePath === definition.makefile;
        const scopeFolder = typeof task.scope === 'object' ? task.scope : undefined;
        const sameScope = !scopeFolder || target.workspaceFolder.uri.toString() === scopeFolder.uri.toString();
        return sameTarget && sameMakefile && sameScope;
      });

    if (!matchingTarget) {
      return undefined;
    }

    return createMakeTask(matchingTarget, definition.args ?? [], definition.executionId);
  }
}
