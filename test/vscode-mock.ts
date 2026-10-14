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

export class CancellationTokenSource {
  private readonly cancellation = new EventEmitter<void>();
  public readonly token = { isCancellationRequested: false, onCancellationRequested: this.cancellation.event };
  public cancel(): void {
    if (!this.token.isCancellationRequested) {
      this.token.isCancellationRequested = true;
      this.cancellation.fire();
    }
  }
  public dispose(): void {
    this.cancellation.dispose();
  }
}

export class Disposable {
  public constructor(private readonly callback: () => void) {}
  public dispose(): void { this.callback(); }
}

export class Memento {
  private readonly values = new Map<string, unknown>();
  public get<T>(key: string): T | undefined;
  public get<T>(key: string, fallback: T): T;
  public get<T>(key: string, fallback?: T): T | undefined {
    return this.values.has(key) ? this.values.get(key) as T : fallback;
  }
  public keys(): readonly string[] { return [...this.values.keys()]; }
  public readonly update = vi.fn(async (key: string, value: unknown): Promise<void> => {
    if (value === undefined) {
      this.values.delete(key);
    } else {
      this.values.set(key, JSON.parse(JSON.stringify(value)));
    }
  });
}

export class Uri {
  public readonly path: string;
  public readonly fsPath: string;
  private constructor(value: string, private readonly serialized?: string) {
    this.path = value.replaceAll('\\', '/');
    this.fsPath = value;
  }
  public static file(value: string): Uri {
    return new Uri(value);
  }
  public static parse(value: string, _strict?: boolean): Uri {
    if (!/^[a-z][a-z0-9+.-]*:/i.test(value)) {
      throw new Error('Invalid URI');
    }
    const file = value.startsWith('file://');
    const uriPath = file ? value.slice('file://'.length) : value.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]+/i, '');
    return new Uri(file ? decodeURIComponent(uriPath).replaceAll('/', path.sep) : uriPath, value);
  }
  public static joinPath(base: Uri, ...parts: string[]): Uri {
    return Uri.file(path.join(base.fsPath, ...parts));
  }
  public toString(): string {
    return this.serialized ?? `file://${this.path}`;
  }
}

export class Range {
  public constructor(public startLine: number, public startCharacter: number, public endLine: number, public endCharacter: number) {}
}
export class Position {
  public constructor(public line: number, public character: number) {}
}
export class Selection {
  public constructor(public anchor: Position, public active: Position) {}
}
export const TextEditorRevealType = { InCenterIfOutsideViewport: 2 };
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
  workspaceFolders: [folder],
  openTextDocument: vi.fn(),
  onDidSaveTextDocument: new EventEmitter<unknown>().event,
  onDidChangeWorkspaceFolders: new EventEmitter<unknown>().event,
  onDidChangeConfiguration: new EventEmitter<unknown>().event,
  createFileSystemWatcher: vi.fn(() => ({
    onDidChange: new EventEmitter<unknown>().event,
    onDidCreate: new EventEmitter<unknown>().event,
    onDidDelete: new EventEmitter<unknown>().event,
    dispose: vi.fn(),
  })),
};
export const languages = {
  match: vi.fn((_selector: unknown) => 1),
  registerCodeLensProvider: vi.fn(() => new Disposable(() => {})),
};
export const processEnd = new EventEmitter<{ execution: unknown; exitCode?: number | undefined }>();
export const taskEnd = new EventEmitter<{ execution: unknown }>();
export const tasks = {
  onDidEndTaskProcess: processEnd.event,
  onDidEndTask: taskEnd.event,
  executeTask: vi.fn(),
  registerTaskProvider: vi.fn(() => new Disposable(() => {})),
};
export const commandHandlers = new Map<string, (...args: unknown[]) => unknown>();
export const contexts = new Map<string, unknown>();
export const commands = {
  registerCommand: (name: string, callback: (...args: unknown[]) => unknown): Disposable => {
    commandHandlers.set(name, callback);
    return new Disposable(() => { commandHandlers.delete(name); });
  },
  executeCommand: vi.fn(async (name: string, ...args: unknown[]): Promise<unknown> => {
    if (name === 'setContext') {
      contexts.set(args[0] as string, args[1]);
      return;
    }
    return commandHandlers.get(name)?.(...args);
  }),
};
export const env = { clipboard: { writeText: vi.fn(async (): Promise<void> => {}) } };
export interface MockTreeView {
  readonly provider: unknown;
  description?: string;
  badge?: { value: number; tooltip: string };
  readonly reveal: ReturnType<typeof vi.fn>;
  readonly onDidChangeCheckboxState: EventEmitter<unknown>['event'];
  dispose(): void;
}
export const views = new Map<string, MockTreeView>();
export const window = {
  withProgress: vi.fn(),
  showWarningMessage: vi.fn(),
  showErrorMessage: vi.fn(),
  showInputBox: vi.fn(),
  showQuickPick: vi.fn(),
  showTextDocument: vi.fn(async () => ({ revealRange: vi.fn(), selection: undefined })),
  createOutputChannel: vi.fn(() => ({ appendLine: vi.fn(), error: vi.fn(), dispose: vi.fn() })),
  createTreeView: vi.fn((id: string, options: { treeDataProvider: unknown }): MockTreeView => {
    const checkboxes = new EventEmitter<unknown>();
    const view = {
      provider: options.treeDataProvider,
      reveal: vi.fn(async (): Promise<void> => {}),
      onDidChangeCheckboxState: checkboxes.event,
      dispose: (): void => { checkboxes.dispose(); views.delete(id); },
    };
    views.set(id, view);
    return view;
  }),
};
