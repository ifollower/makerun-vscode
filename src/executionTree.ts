import * as vscode from 'vscode';
import { ExecutionController, isRunActive, type ExecutionRun, type ExecutionStep } from './execution';

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

  public constructor(private readonly controller: ExecutionController) {
    this.subscription = controller.onDidChange(() => {
      const retained = new Set(controller.getRuns().map((run) => run.id));
      for (const id of this.roots.keys()) {
        if (!retained.has(id)) {
          this.roots.delete(id);
          this.children.delete(id);
        }
      }
      this.changed.fire(undefined);
    });
  }

  public getRunNode(run: ExecutionRun): ExecutionRunNode {
    let node = this.roots.get(run.id);
    if (!node) {
      node = { kind: 'run', run };
      this.roots.set(run.id, node);
    }
    if (this.children.get(run.id)?.[0]?.step !== run.steps[0]) {
      this.children.set(run.id, run.steps.map((step) => ({ kind: 'step', step, parent: node! })));
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
      const item = new vscode.TreeItem(run.kind === 'sequence' ? 'Run in Sequence' : run.steps[0]!.target.name,
        isRunActive(run) ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed);
      item.id = run.id;
      item.contextValue = isRunActive(run) ? 'executionActive'
        : run.kind === 'sequence' ? 'executionCompletedSequence' : 'executionCompleted';
      item.iconPath = new vscode.ThemeIcon(icons[run.status]);
      item.description = `${completed}/${run.steps.length} completed · ${labels[run.status]}${current ? ` ${current.target.name}` : ''} · ${time}`;
      item.tooltip = `${labels[run.status]} · ${completed}/${run.steps.length} completed\n${new Date(run.startedAt).toLocaleString()}${run.error ? `\n${run.error}` : ''}`;
      return item;
    }
    const { step } = node;
    const item = new vscode.TreeItem(step.target.name, vscode.TreeItemCollapsibleState.None);
    item.id = step.id;
    item.contextValue = 'executionStep';
    item.iconPath = new vscode.ThemeIcon(icons[step.status]);
    item.description = `${labels[step.status]}${step.exitCode === undefined ? '' : ` · exit ${step.exitCode}`}`;
    item.tooltip = `${step.target.workspaceFolder.name}/${step.target.makefileRelativePath}\n${labels[step.status]}${step.exitCode === undefined ? '' : ` · exit ${step.exitCode}`}${step.error ? `\n${step.error}` : ''}`;
    return item;
  }

  public dispose(): void {
    this.subscription.dispose();
    this.changed.dispose();
  }
}
