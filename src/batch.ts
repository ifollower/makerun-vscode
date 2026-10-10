import * as vscode from 'vscode';
import type { MakefileTarget } from './model';
import { createMakeTask } from './tasks';

export function createMakeTargetsTask(targets: readonly MakefileTarget[]): vscode.Task {
  const first = targets[0];
  if (!first) {
    throw new Error('Select at least one target to run.');
  }
  if (targets.some((target) => target.makefileUri.toString() !== first.makefileUri.toString()
    || target.workspaceFolder.uri.toString() !== first.workspaceFolder.uri.toString())) {
    throw new Error('Select targets from the same Makefile to run them together.');
  }
  const names = targets.map((target) => target.name);
  const task = createMakeTask(first, names.slice(1));
  task.name = names.join(' ');
  task.detail = `make ${names.join(' ')} · ${first.makefileRelativePath}`;
  return task;
}

export async function runMakeTargets(targets: readonly MakefileTarget[]): Promise<void> {
  if (targets.length > 0) {
    await vscode.tasks.executeTask(createMakeTargetsTask(targets));
  }
}
