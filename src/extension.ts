import process from 'node:process';
import * as vscode from 'vscode';
import { MakefileCodeLensProvider, targetsInDocument } from './codelens';
import { MakefileDiscovery } from './discovery';
import { ExecutionController, isRunActive, type ExecutionRun } from './execution';
import { ExecutionTreeProvider, type ExecutionNode, type ExecutionRunNode } from './executionTree';
import { formatExecutionCommands } from './executionCommands';
import { ExecutionHistoryStore } from './executionHistory';
import type { MakefileTarget } from './model';
import { splitArguments } from './parser';
import { MakefileTaskProvider } from './tasks';
import { MakefileTreeProvider, targetFromArgument, type TargetNode } from './tree';

let activeHistory: ExecutionHistoryStore | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('Make Run Tasks', { log: true });
  const discovery = new MakefileDiscovery(output);
  const treeProvider = new MakefileTreeProvider(context.extensionUri);
  const codeLensProvider = new MakefileCodeLensProvider();
  const treeView = vscode.window.createTreeView('makefileTasks.targets', {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
    manageCheckboxStateManually: true,
  });

  const updateSelection = (): void => {
    const count = treeProvider.getDocuments().reduce((sum, document) => sum + document.targets.length, 0);
    const selected = treeProvider.getSelectedTargets().length;
    treeView.message = treeProvider.isSelectionMode
      ? `${selected} selected · Check targets in execution order`
      : count > 0 ? `${count} documented target${count === 1 ? '' : 's'}` : '';
    void vscode.commands.executeCommand('setContext', 'makefileTasks.selectionMode', treeProvider.isSelectionMode);
    void vscode.commands.executeCommand('setContext', 'makefileTasks.hasSelection', selected > 0);
    void vscode.commands.executeCommand('setContext', 'makefileTasks.batchRunning', executions.batchRunning);
  };

  let refreshTimer: NodeJS.Timeout | undefined;
  const refresh = async (): Promise<void> => {
    try {
      const documents = await discovery.discover();
      treeProvider.setDocuments(documents);
      const count = documents.reduce((sum, document) => sum + document.targets.length, 0);
      await vscode.commands.executeCommand('setContext', 'makefileTasks.hasTargets', count > 0);
      updateSelection();
      codeLensProvider.refresh();
      output.appendLine(`Discovered ${count} documented Makefile target${count === 1 ? '' : 's'}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      output.error(`Refresh failed: ${message}`);
      void vscode.window.showErrorMessage(`Make Run Tasks: ${message}`);
    }
  };

  const scheduleRefresh = (): void => {
    if (!vscode.workspace.getConfiguration('makefileTasks').get<boolean>('autoRefresh', true)) {
      return;
    }
    if (refreshTimer) {
      clearTimeout(refreshTimer);
    }
    refreshTimer = setTimeout(() => void refresh(), 150);
  };

  const selectTarget = async (): Promise<MakefileTarget | undefined> => {
    const targets = treeProvider.getDocuments().flatMap((document) => document.targets);
    const sort = vscode.workspace.getConfiguration('makefileTasks').get<'source' | 'name'>('sort', 'source');
    const ordered = sort === 'name' ? [...targets].sort((a, b) => a.name.localeCompare(b.name)) : targets;
    const selected = await vscode.window.showQuickPick(
      ordered.map((target) => ({
        label: `$(play) ${target.name}`,
        description: target.description,
        detail: [
          target.usage ? `make ${target.name} ${target.usage}` : undefined,
          target.category,
          `${target.workspaceFolder.name}/${target.makefileRelativePath}`,
        ]
          .filter((value): value is string => Boolean(value))
          .join(' · '),
        target,
      })),
      { title: 'Run Makefile Target', matchOnDescription: true, matchOnDetail: true },
    );
    return selected?.target;
  };

  const resolveTarget = async (argument?: TargetNode | MakefileTarget): Promise<MakefileTarget | undefined> =>
    targetFromArgument(argument) ?? selectTarget();

  const prepareTargets = async (targets: readonly MakefileTarget[]): Promise<MakefileTarget[]> => {
    const documents = new Map<string, vscode.TextDocument>();
    for (const target of targets) {
      const key = target.makefileUri.toString();
      if (!documents.has(key)) {
        const document = await vscode.workspace.openTextDocument(target.makefileUri);
        if (document.isDirty && !await document.save()) {
          throw new Error(`Could not save ${target.makefileRelativePath}. No targets were started.`);
        }
        documents.set(key, document);
      }
    }
    return targets.map((target) => {
      const document = documents.get(target.makefileUri.toString());
      const current = document && targetsInDocument(document).find((item) => item.name === target.name);
      if (!current) {
        throw new Error(`Target ${target.name} is no longer documented in ${target.makefileRelativePath}. Refresh and select it again.`);
      }
      return current;
    });
  };

  const history = new ExecutionHistoryStore(context.workspaceState, (error) => output.error(`Could not save execution history: ${String(error)}`));
  const executions = new ExecutionController(prepareTargets, undefined, history.restore());
  history.bind(executions);
  activeHistory = history;
  const executionProvider = new ExecutionTreeProvider(executions);
  const executionView = vscode.window.createTreeView('makefileTasks.execution', {
    treeDataProvider: executionProvider,
    showCollapseAll: true,
  });
  const updateExecution = (): void => {
    const runs = executions.getRuns();
    const active = runs.filter(isRunActive).length;
    executionView.description = active > 0 ? `${active} active` : '';
    executionView.badge = active > 0 ? { value: active, tooltip: `${active} active run${active === 1 ? '' : 's'}` } : undefined;
    void vscode.commands.executeCommand('setContext', 'makefileTasks.hasCompletedExecutions', runs.some((run) => !isRunActive(run)));
    updateSelection();
  };
  updateExecution();

  const runTarget = async (argument?: TargetNode | MakefileTarget, extraArgs: readonly string[] = []): Promise<ExecutionRun | undefined> => {
    const target = await resolveTarget(argument);
    if (!target) {
      return;
    }
    const handle = executions.startSingle(target, extraArgs);
    await handle.completion;
    return handle.run;
  };

  const runSelectedTargets = async (): Promise<ExecutionRun | undefined> => {
    const handle = executions.startSequence(treeProvider.getSelectedTargets());
    if (!handle) {
      return;
    }
    await handle.completion;
    return handle.run;
  };

  const runFromArgument = (argument?: ExecutionNode | string): ExecutionRun | undefined => {
    const id = typeof argument === 'string' ? argument
      : argument?.kind === 'run' ? argument.run.id : argument?.parent.run.id;
    return executions.getRuns().find((run) => run.id === id);
  };
  const stepsFromArgument = (argument?: ExecutionNode | string): ExecutionRun['steps'] => {
    const run = runFromArgument(argument);
    if (typeof argument !== 'string' && argument?.kind === 'step') {
      return run?.steps.filter((step) => step.id === argument.step.id) ?? [];
    }
    return run?.steps ?? [];
  };

  context.subscriptions.push(
    new vscode.Disposable(() => {
      if (refreshTimer) {
        clearTimeout(refreshTimer);
        refreshTimer = undefined;
      }
    }),
    output,
    treeView,
    treeProvider,
    executionView,
    executionProvider,
    executions,
    history,
    executions.onDidChange(updateExecution),
    executions.onDidStartRun((run) => {
      void executionView.reveal(executionProvider.getRunNode(run), { expand: true, select: false, focus: false })
        .then(undefined, (error: unknown) => output.error(`Could not reveal execution: ${String(error)}`));
    }),
    codeLensProvider,
    vscode.languages.registerCodeLensProvider({ pattern: '**/*' }, codeLensProvider),
    vscode.tasks.registerTaskProvider('makefileTarget', new MakefileTaskProvider(() => treeProvider.getDocuments())),
    vscode.commands.registerCommand('makefileTasks.refresh', refresh),
    vscode.commands.registerCommand('makefileTasks.runTarget', runTarget),
    vscode.commands.registerCommand('makefileTasks.runTargetPicker', () => runTarget()),
    vscode.commands.registerCommand('makefileTasks.toggleSelectionMode', () => {
      treeProvider.setSelectionMode(!treeProvider.isSelectionMode);
      updateSelection();
    }),
    vscode.commands.registerCommand('makefileTasks.toggleTargetSelection', (argument: TargetNode) => {
      const target = targetFromArgument(argument);
      if (target) {
        const selected = treeProvider.getSelectedTargets().some((item) =>
          item.makefileUri.toString() === target.makefileUri.toString() && item.name === target.name);
        treeProvider.setTargetSelected(target, !selected);
        updateSelection();
      }
    }),
    treeView.onDidChangeCheckboxState((event) => {
      for (const [node, state] of event.items) {
        const target = targetFromArgument(node);
        if (target) {
          treeProvider.setTargetSelected(target, state === vscode.TreeItemCheckboxState.Checked);
        }
      }
      updateSelection();
    }),
    vscode.commands.registerCommand('makefileTasks.clearSelection', () => {
      treeProvider.clearSelection();
      updateSelection();
    }),
    vscode.commands.registerCommand('makefileTasks.runSelectedTargetsInSequence', runSelectedTargets),
    vscode.commands.registerCommand('makefileTasks.cancelExecution', (argument?: ExecutionRunNode | string) => {
      if (argument) {
        executions.cancelRun(typeof argument === 'string' ? argument : argument.run.id);
      }
    }),
    vscode.commands.registerCommand('makefileTasks.clearExecutionHistory', () => executions.clearCompleted()),
    vscode.commands.registerCommand('makefileTasks.resumeExecution', async (argument?: ExecutionRunNode | string) => {
      const run = runFromArgument(argument);
      const handle = run && executions.resume(run.id);
      if (handle) {
        await handle.completion;
        return handle.run;
      }
      return undefined;
    }),
    vscode.commands.registerCommand('makefileTasks.rerunExecution', async (argument?: ExecutionRunNode | string) => {
      const run = runFromArgument(argument);
      const handle = run && executions.rerun(run.id);
      if (handle) {
        await handle.completion;
        return handle.run;
      }
      return undefined;
    }),
    vscode.commands.registerCommand('makefileTasks.deleteExecution', (argument?: ExecutionRunNode | string) => {
      const run = runFromArgument(argument);
      return run ? executions.deleteRun(run.id) : false;
    }),
    vscode.commands.registerCommand('makefileTasks.copyExecutionCommands', async (argument?: ExecutionNode | string) => {
      const steps = stepsFromArgument(argument);
      if (steps.length > 0) {
        await vscode.env.clipboard.writeText(formatExecutionCommands(steps, process.platform === 'win32'));
      }
    }),
    vscode.commands.registerCommand('makefileTasks.showExecutionCommands', async (argument?: ExecutionNode | string) => {
      const steps = stepsFromArgument(argument);
      if (steps.length > 0) {
        const windows = process.platform === 'win32';
        const details = steps.map((step) => `# ${step.target.name}: ${step.status}${step.exitCode === undefined ? '' : ` (exit ${step.exitCode})`}${step.error ? `\n# ${step.error.replaceAll('\n', '\n# ')}` : ''}`).join('\n');
        const document = await vscode.workspace.openTextDocument({
          content: `${details}\n\n${formatExecutionCommands(steps, windows)}\n`,
          language: windows ? 'powershell' : 'shellscript',
        });
        await vscode.window.showTextDocument(document, { preview: true });
      }
    }),
    vscode.commands.registerCommand('makefileTasks.openExecutionTarget', async (argument?: ExecutionNode | string) => {
      const steps = stepsFromArgument(argument);
      const step = steps.length === 1 ? steps[0] : steps.length > 1
        ? (await vscode.window.showQuickPick(steps.map((entry) => ({
          label: entry.target.name,
          description: `${entry.target.workspaceFolder.name}/${entry.target.makefileRelativePath}`,
          step: entry,
        })), { title: 'Go to Makefile Target', matchOnDescription: true }))?.step
        : undefined;
      if (step) {
        await vscode.commands.executeCommand('makefileTasks.openTarget', step.target);
      }
    }),
    vscode.commands.registerCommand('makefileTasks.runTargetWithArgs', async (argument?: TargetNode | MakefileTarget) => {
      const target = await resolveTarget(argument);
      if (!target) {
        return;
      }
      const usage = target.usage ? `make ${target.name} ${target.usage}` : undefined;
      const input = await vscode.window.showInputBox({
        title: `Run make ${target.name}`,
        prompt: usage ? `Usage: ${usage}` : 'Additional make arguments or variable assignments',
        placeHolder: target.usage ?? 'FILE=path/to/file ENV=development --jobs 4',
        validateInput: (value) => {
          try {
            splitArguments(value);
            return undefined;
          } catch (error) {
            return error instanceof Error ? error.message : String(error);
          }
        },
      });
      if (input === undefined) {
        return;
      }
      try {
        return await runTarget(target, splitArguments(input));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        output.error(`Invalid task arguments: ${message}`);
      }
    }),
    vscode.commands.registerCommand('makefileTasks.openTarget', async (argument?: TargetNode | MakefileTarget) => {
      const target = await resolveTarget(argument);
      if (!target) {
        return;
      }
      const document = await vscode.workspace.openTextDocument(target.makefileUri);
      const editor = await vscode.window.showTextDocument(document);
      const current = targetsInDocument(document).find((item) => item.name === target.name);
      const position = new vscode.Position(current?.line ?? Math.min(target.line, document.lineCount - 1), 0);
      editor.selection = new vscode.Selection(position, position);
      editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    }),
    vscode.workspace.onDidSaveTextDocument((document) => {
      const known = treeProvider.getDocuments().some((item) => item.uri.toString() === document.uri.toString());
      if (known) {
        scheduleRefresh();
      }
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(scheduleRefresh),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('makefileTasks')) {
        treeProvider.setDocuments(treeProvider.getDocuments());
        void refresh();
      }
    }),
  );

  const watcher = vscode.workspace.createFileSystemWatcher('**/{Makefile,makefile,GNUmakefile,*.mk}');
  watcher.onDidChange(scheduleRefresh, undefined, context.subscriptions);
  watcher.onDidCreate(scheduleRefresh, undefined, context.subscriptions);
  watcher.onDidDelete(scheduleRefresh, undefined, context.subscriptions);
  context.subscriptions.push(watcher);

  void refresh();
}

export async function deactivate(): Promise<void> {
  await activeHistory?.flush();
  activeHistory = undefined;
}
