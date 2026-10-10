import * as path from 'node:path';
import { vi } from 'vitest';

export class EventEmitter<T> {
  private readonly listeners = new Set<(event: T) => unknown>();
  public readonly event = (listener: (event: T) => unknown): { dispose: () => void } => {
    this.listeners.add(listener);
    return { dispose: (): void => { this.listeners.delete(listener); } };
  };
  public fire(event: T): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
  public dispose(): void {
    this.listeners.clear();
  }
  public get listenerCount(): number {
    return this.listeners.size;
  }
}

export class Uri {
  public readonly path: string;
  public readonly fsPath: string;
  private constructor(value: string) {
    this.path = value.replaceAll('\\', '/');
    this.fsPath = value;
  }
  public static file(value: string): Uri {
    return new Uri(value);
  }
  public toString(): string {
    return `file://${this.path}`;
  }
}

export class Range {
  public constructor(public startLine: number, public startCharacter: number, public endLine: number, public endCharacter: number) {}
}
export class CodeLens {
  public constructor(public range: Range, public command: unknown) {}
}
export class RelativePattern {
  public constructor(public base: unknown, public pattern: string) {}
}
export class TreeItem {
  public constructor(public label: string, public collapsibleState: number) {}
}
export class ThemeIcon {
  public constructor(public id: string) {}
}
export class MarkdownString {
  public constructor(public value: string) {}
}
export class ShellExecution {
  public constructor(public command: string, public args: string[], public options: { cwd: string }) {}
}
export class Task {
  public presentationOptions: Record<string, unknown> = {};
  public constructor(public definition: unknown, public scope: unknown, public name: string, public source: string, public execution: unknown, public problemMatchers: string[]) {}
}

export const TreeItemCollapsibleState = { None: 0, Collapsed: 1, Expanded: 2 };
export const TreeItemCheckboxState = { Unchecked: 0, Checked: 1 };
export const TaskRevealKind = { Always: 1 };
export const TaskPanelKind = { Shared: 1, Dedicated: 2 };
export const TaskGroup = { Build: {}, Test: {}, Clean: {}, Rebuild: {} };
export const ProgressLocation = { Notification: 15 };
export const settings = new Map<string, unknown>();
export const folder = { name: 'workspace', index: 0, uri: Uri.file(path.resolve('test-workspace')) };
export const workspace = {
  getConfiguration: (): { get: <T>(key: string, fallback: T) => T } => ({
    get: <T>(key: string, fallback: T): T => settings.has(key) ? settings.get(key) as T : fallback,
  }),
  getWorkspaceFolder: vi.fn(() => folder),
};
export const languages = { match: vi.fn(() => 1) };
export const processEnd = new EventEmitter<{ execution: unknown; exitCode?: number | undefined }>();
export const taskEnd = new EventEmitter<{ execution: unknown }>();
export const tasks = {
  onDidEndTaskProcess: processEnd.event,
  onDidEndTask: taskEnd.event,
  executeTask: vi.fn(),
};
export const window = {
  withProgress: vi.fn(),
  showWarningMessage: vi.fn(),
};
