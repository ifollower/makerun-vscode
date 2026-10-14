# Make Run Tasks

A native VS Code task explorer for documented Makefile targets.

- [1. Details](#1-details)
  - [1.1. Prerequisites](#11-prerequisites)
  - [1.2. Usage](#12-usage)
  - [1.3. MCP Server](#13-mcp-server)
- [2. Contribution](#2-contribution)
- [Publishing](docs/publishing.md)

## 1. Details

### 1.1. Prerequisites

- [Visual Studio Code](https://code.visualstudio.com/download)
  > Visual Studio Code (>=1.134) is required to run the extension.

### 1.2. Usage

1. Insights and Details

    - Specification
      > The [Make Run Tasks Specification](docs/make-tasks-specification.md) is the normative reference for annotation syntax and externally observable behavior.

    - Activity Bar
      > Dedicated Makefile icon and target explorer in the Activity Bar.

    - Explorer
      > Target grouping by workspace, Makefile, and category when necessary.

    - Execution
      > Target execution as native VS Code tasks from the explorer.

    - Quick Pick
      > Keyboard-driven target selection and execution.

    - Batch Execution
      > Check targets across Makefiles, run them sequentially, and follow progress in the fixed Execution view.

    - Editor Actions
      > Run documented targets directly from CodeLens links above Makefile rules.

    - Navigation
      > Click a target name to run it. Use its inline actions to run with arguments or open its Makefile definition.

    - Workspace
      > Multi-root workspace and multiple-Makefile support.

    - Auto-refresh
      > Automatic target refresh after matching Makefile changes when `makefileTasks.autoRefresh` is enabled.

    - Configuration
      > Configurable Make command, discovery globs, exclusions, sorting, editor actions, and automatic refresh.

2. Usage and Instructions

    - [Tasks](docs/make-tasks-specification.md#151-tasks)
      > The extension discovers documented Makefile targets and presents them as VS Code tasks. A target is discoverable when it has a non-empty preceding or inline `##` description. The extension ignores undocumented targets, helper rules, pattern rules, variable assignments, and unsupported target names.

      ```make
      ## Single-line description for the build task
      build:
      	go build ./...
      .PHONY: build
      ```

      ```make
      test: ## Inline description for the test task
      	go test ./...
      .PHONY: test
      ```

    - [Categorization](docs/make-tasks-specification.md#152-category)
      > Organize tasks with canonical section comments. The extension groups tasks by category in the Activity Bar explorer and places uncategorized tasks under **Uncategorized**.

      ```make
      # ─── Skills Manager ────────────────────────────────────────────────────

      skills-agent-add: ## Provision Agent Skills
      	skills add ./skills

      skills-agent-update: ## Update Agent Skills
      	skills update ./skills

      # --- Dependencies ------------------------------------------------------

      dependency-update: ## Update project dependencies
      	renovate --platform=local

      # === Test ==============================================================

      test: ## Run the test suite
      	go test ./...
      ```

    - [Input Metadata](docs/make-tasks-specification.md#153-inputs)
      > Document expected positional arguments or Make variable assignments with optional `# Usage:` metadata. Usage metadata is descriptive and does not validate or supply runtime arguments.

      ```make
      # Usage: make deploy ENV=<name> [VERSION=<version>]
      #
      deploy: ## Deploy the application
      	./scripts/deploy --env "$(ENV)" --version "$(VERSION)"
      .PHONY: deploy
      ```

    - [Invocation](docs/make-tasks-specification.md#133-input-processing-and-execution)
      > Run targets with positional arguments or Make variable assignments through **Run Target with Arguments** or `makefileTarget` task definitions.

      ```make
      # Usage: make build [MODE=<mode>]
      #
      build: ## Build the application
      	go build -tags "$(MODE)" ./...
      .PHONY: build
      ```

### Publish from your computer

Run `make vsce-login` once to authenticate publisher **ai-follwer**. Then `make vsce-publish` checks, builds, packages, and uploads the current version. Use `make vsce-preview` to build the same package without uploading, or `make vsce-release` to increment the patch version before publishing. These documented Make targets also appear in the task explorer. See [local publishing setup](docs/publishing.md) for credentials and Azure authentication; the npm commands remain available.

### Run multiple targets

1. Open **Make Run Tasks** and click **Toggle Multi-select Mode** (the checklist icon).
2. Check targets, or click their names, in execution order. Targets can come from different Makefiles or workspace folders. The explorer shows the selected count and order numbers beside checked targets. Selections persist when categories are collapsed and across refreshes.
3. Click **Run in Sequence** (the run-all icon) in the toolbar to start immediately.

The extension launches a separate `make -f <Makefile> <target>` task for each selection, waits for it to finish, then starts the next. Each task uses its own Makefile directory and workspace scope. A failed or terminated task stops the batch; remaining targets are skipped. Separate Make invocations can run shared dependencies again. Make's own settings still control execution inside each individual task.

Selections are retained for another run; **Clear Selection** clears them, and leaving multi-select mode restores click-to-run behavior. Outside multi-select mode, click a target's name to run it directly. The inline **Run Target with Arguments** action opens the argument input, and **Go to Target Definition** opens its Makefile at the target's rule. The navigation action is also available in multi-select mode. The single-target picker remains available through **Make Run Tasks: Run Target…** in the Command Palette.

### Execution status

The **Execution** view below **Targets** displays every run started by the extension: normal clicks, argument actions, the target picker, editor CodeLens, and sequential batches. Each run keeps its original selection and arguments, displays waiting/running/succeeded/failed/cancelled/skipped steps, and shows the completed count, current target, and failure details. It does not estimate progress inside a Make recipe or show progress/result notifications. Detailed output remains in task terminals.

Use the stop action beside an active run to cancel only that run. Cancelling a sequence terminates its current task and skips the queue. Stopping the task from the terminal also stops the sequence. Existing runs do not block new runs or reruns of other records. Multiple batches can run independently; targets within each batch still run one at a time in their selected order.

New runs expand without taking editor focus. The native views can be collapsed and resized independently. All active runs and the ten most recently started completed runs are retained, newest first. History is saved in VS Code's local workspace storage, including targets, arguments, command snapshots and results, so reloading the window or reopening the same workspace restores it. **Clear Completed Runs** leaves active runs intact and updates stored history; deleted records do not return after reload. Histories from different workspaces stay separate. Tasks launched directly through VS Code's native task commands or an external terminal are not tracked.

Runs that were still preparing or running when the window reloaded are restored as **Interrupted**, with queued steps skipped. The extension cannot infer their final result or resume their queue automatically; tasks might still exist in VS Code terminals. Completed steps retain their results, and interrupted records can be rerun or deleted. Restored history keeps the latest ten records. Terminal output itself is managed by VS Code and is not copied into history storage.

Completed records offer **Rerun** and **Delete Run** beside their names and in the context menu. Rerun resets the existing record, updates its start time, and moves it to the top without adding another history entry. It preserves target order and arguments, saves and revalidates the current Makefiles, and uses the current Make executable settings. A sequence restarts from the first target, including previously skipped targets. Active records cannot be rerun or deleted. Ended records, including failed batches, can be rerun independently while other runs remain active.

Right-click a run or step for **Show Commands**, **Copy Commands**, or **Go to Target Definition**. Steps also have an inline navigation action. Batch navigation asks which target to open. Command inspection shows statuses and the command's working directory, executable and arguments; launched steps retain the actual command snapshot, while waiting or skipped steps show the planned invocation. Copying a batch includes all steps in order and stops on failure. Copied commands use PowerShell syntax on Windows and POSIX shell syntax elsewhere. These inspection actions do not execute tasks. Delete Run removes only that completed record from the view and saved history.

### Run from the Makefile editor

Above each documented target, **▶ Run target** runs it immediately and **Run target with Arguments…** opens the existing argument input. Rules with multiple target names have separate links for each target. Lenses follow the current editor text. Before an explorer or editor action runs, any selected Makefile with unsaved changes is saved and its targets are checked again.

Editor actions follow `makefileTasks.fileGlobs` and `makefileTasks.excludeGlob` and apply to files inside workspace folders. They use the same `##` documentation requirement as the explorer. Disable them with `"makefileTasks.codeLens": false`; VS Code's `editor.codeLens` must also be enabled.

### 1.3. MCP Server

The optional stdio MCP server exposes the extension's Makefile parser to AI agents without executing Make. Its `list_make_targets` tool returns documented targets, descriptions, categories, usage metadata, and zero-based source lines.

```bash
npm install
npm run mcp:start
```

The server reads workspace-relative Makefile paths from the current directory. Set `MAKE_TASKS_MCP_ROOT` to use another workspace root. Requests that resolve outside that root are rejected.

Example tool input:

```json
{
  "makefile": "Makefile"
}
```

Build and exercise the server with MCP Inspector:

```bash
npm run mcp:inspect
```

The server uses stdout exclusively for MCP messages and writes its readiness message to stderr.

## 2. Contribution

1. Insights and Details

    - [Node.js](https://nodejs.org/en/download/)
      > Node.js 22.12+ (22.x), 24.x, or 26+ is required to build, test, and package the extension.

    - VS Code [Extension Anatomy](https://code.visualstudio.com/api/get-started/extension-anatomy)
      > Anatomy of a VS Code extension, including the structure of the extension folder and the purpose of each file.

    - [Publishing Make Run Tasks](docs/publishing.md)
      > Create your own Marketplace publisher, configure its ID, and upload the packaged extension.

2. Usage and Instructions

    - Tasks
      > The repository Makefile provides documented targets for installing dependencies, validating changes, building, packaging, and installing the extension locally.

      ```bash
      make vsce-dependencies
      make vsce-build
      make vsce-package
      make vsce-install
      ```

      VSIX artifacts are written to the Git-ignored `out/` directory. Run `npm run package` to generate `out/make-run-tasks-<version>.vsix`.

Make Run Tasks is a fork of [sentenz/vscode-make-tasks](https://github.com/sentenz/vscode-make-tasks). The original license and copyright notice are retained in [LICENSE](LICENSE).
