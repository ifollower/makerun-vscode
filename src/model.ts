import type * as vscode from 'vscode';

export interface ParsedTarget {
  readonly name: string;
  readonly description: string;
  readonly usage?: string;
  readonly category?: string;
  readonly line: number;
}

export interface MakefileDocument {
  readonly workspaceFolder: vscode.WorkspaceFolder;
  readonly uri: vscode.Uri;
  readonly relativePath: string;
  readonly targets: readonly MakefileTarget[];
}

export interface MakefileTarget extends ParsedTarget {
  readonly workspaceFolder: vscode.WorkspaceFolder;
  readonly makefileUri: vscode.Uri;
  readonly makefileRelativePath: string;
}

export interface MakefileTaskDefinition extends vscode.TaskDefinition {
  readonly type: 'makefileTarget';
  readonly target: string;
  readonly makefile?: string;
  readonly args?: readonly string[];
  readonly executionId?: string;
}
