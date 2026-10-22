import * as vscode from 'vscode';
import { ExecutionController, getResumeIndex, getRunDuration, getStepDuration, isRunActive, type ExecutionRun, type ExecutionStep } from './execution';
import { formatDuration } from './duration';

export interface ExecutionRunNode {
  readonly kind: 'run';
  readonly run: ExecutionRun;
}

export interface ExecutionStepNode {
  readonly kind: 'step';
  readonly step: ExecutionStep;
  readonly parent: ExecutionRunNode;
}

export type ExecutionNode = ExecutionRunNode | ExecutionStepNode;

const labels = {
  preparing: 'Preparing', running: 'Running', succeeded: 'Succeeded', failed: 'Failed',
  cancelled: 'Cancelled', skipped: 'Skipped', waiting: 'Waiting', interrupted: 'Interrupted',
};
const icons = {
  preparing: 'loading~spin', running: 'loading~spin', succeeded: 'pass', failed: 'error',
  cancelled: 'circle-slash', skipped: 'debug-step-over', waiting: 'circle-outline', interrupted: 'debug-pause',
};

export class ExecutionTreeProvider implements vscode.TreeDataProvider<ExecutionNode>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<ExecutionNode | undefined>();
  public readonly onDidChangeTreeData = this.changed.event;
  private readonly roots = new Map<string, ExecutionRunNode>();
  private readonly children = new Map<string, ExecutionStepNode[]>();
  private readonly subscription: vscode.Disposable;
  private refreshTimer: ReturnType<typeof setInterval> | undefined;

  public constructor(private readonly controller: ExecutionController) {
    this.subscription = controller.onDidChange(() => {
      const retained = new Set(controller.getRuns().map((run) => run.id));
      for (const id of this.roots.keys()) {
        if (!retained.has(id)) {
          this.roots.delete(id);
          this.children.delete(id);
        }
      }
      this.updateTimer();
      this.changed.fire(undefined);
    });
    this.updateTimer();
  }

  private updateTimer(): void {
    if (this.controller.getRuns().some(isRunActive)) {
      this.refreshTimer ??= setInterval(() => this.changed.fire(undefined), 1000);
    } else if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = undefined;
    }
  }

  public getRunNode(run: ExecutionRun): ExecutionRunNode {
    let node = this.roots.get(run.id);
    if (!node) {
      node = { kind: 'run', run };
      this.roots.set(run.id, node);
    }
    const children = this.children.get(run.id);
    if (children?.length !== run.steps.length || run.steps.some((step, index) => children?.[index]?.step !== step)) {
      this.children.set(run.id, run.steps.map((step, index) => children?.[index]?.step === step
        ? children[index]! : { kind: 'step', step, parent: node! }));
    }
    return node;
  }

  public getChildren(node?: ExecutionNode): ExecutionNode[] {
    if (!node) {
      return this.controller.getRuns().map((run) => this.getRunNode(run));
    }
    if (node.kind === 'run') {
      this.getRunNode(node.run);
      return this.children.get(node.run.id) ?? [];
    }
    return [];
  }

  public getParent(node: ExecutionNode): ExecutionRunNode | undefined {
    return node.kind === 'step' ? node.parent : undefined;
  }

  public getTreeItem(node: ExecutionNode): vscode.TreeItem {
    if (node.kind === 'run') {
      const { run } = node;
      const completed = run.steps.filter((step) => !['waiting', 'running', 'skipped'].includes(step.status)).length;
      const current = run.steps.find((step) => step.status === 'running');
      const time = new Date(run.startedAt).toLocaleTimeString();
      const duration = getRunDuration(run);
      const item = new vscode.TreeItem(run.kind === 'sequence' ? 'Run in Sequence' : run.steps[0]!.target.name,
        isRunActive(run) ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed);
      item.id = run.id;
      item.contextValue = isRunActive(run) ? 'executionActive'
        : getResumeIndex(run) !== undefined ? 'executionCompletedResumable'
        : run.kind === 'sequence' ? 'executionCompletedSequence' : 'executionCompleted';
      item.iconPath = new vscode.ThemeIcon(icons[run.status]);
      item.description = `${completed}/${run.steps.length} completed · ${labels[run.status]}${current ? ` ${current.target.name}` : ''} · Total ${formatDuration(duration)} · ${time}`;
      item.tooltip = `${labels[run.status]} · ${completed}/${run.steps.length} completed\n${new Date(run.startedAt).toLocaleString()}\nTotal elapsed: ${formatDuration(duration)}${run.status === 'interrupted' ? ' (last recorded)' : ''}${run.error ? `\n${run.error}` : ''}`;
      return item;
    }
    const { step } = node;
    const duration = getStepDuration(step);
    const item = new vscode.TreeItem(step.target.name, vscode.TreeItemCollapsibleState.None);
    item.id = step.id;
    item.contextValue = 'executionStep';
    item.iconPath = new vscode.ThemeIcon(icons[step.status]);
    item.description = `${labels[step.status]}${step.exitCode === undefined ? '' : ` · exit ${step.exitCode}`} · ${formatDuration(duration)}`;
    item.tooltip = `${step.target.workspaceFolder.name}/${step.target.makefileRelativePath}\n${labels[step.status]}${step.exitCode === undefined ? '' : ` · exit ${step.exitCode}`}\nElapsed: ${formatDuration(duration)}${step.status === 'interrupted' ? ' (last recorded)' : ''}${step.error ? `\n${step.error}` : ''}`;
    return item;
  }

  public dispose(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
    }
    this.subscription.dispose();
    this.changed.dispose();
  }
}
