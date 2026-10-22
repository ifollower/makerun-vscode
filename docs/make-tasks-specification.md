# Make Run Tasks Specification

The Make Run Tasks Specification defines the Makefile annotations and task behavior supported by the [Make Run Tasks](../README.md) extension for the [Visual Studio Code task system](https://code.visualstudio.com/docs/debugtest/tasks). It establishes a compact contract for documented-target discovery, descriptions, categories, inputs, task resolution, execution, and workspace presentation.

The specification covers only the extension's recognized annotation subset. [GNU Make](https://www.gnu.org/software/make/manual/make.html) remains authoritative for Makefile syntax, dependency evaluation, recipes, and execution semantics.

- [1. Specification](#1-specification)
  - [1.1. Scope](#11-scope)
    - [1.1.1. Conformance](#111-conformance)
    - [1.1.2. Feature Model](#112-feature-model)
  - [1.2. Annotation Syntax](#12-annotation-syntax)
    - [1.2.1. Target Rules](#121-target-rules)
    - [1.2.2. Descriptions](#122-descriptions)
    - [1.2.3. Categories](#123-categories)
    - [1.2.4. Inputs](#124-inputs)
  - [1.3. Discovery and Task Behavior](#13-discovery-and-task-behavior)
    - [1.3.1. Discovery](#131-discovery)
    - [1.3.2. Task Definition and Resolution](#132-task-definition-and-resolution)
    - [1.3.3. Input Processing and Execution](#133-input-processing-and-execution)
    - [1.3.4. Presentation](#134-presentation)
    - [1.3.5. Refresh and Error Handling](#135-refresh-and-error-handling)
  - [1.4. Configuration](#14-configuration)
    - [1.4.1. Discovery Configuration](#141-discovery-configuration)
    - [1.4.2. Execution and Interaction Configuration](#142-execution-and-interaction-configuration)
    - [1.4.3. Presentation and Refresh Configuration](#143-presentation-and-refresh-configuration)
  - [1.5. Examples](#15-examples)
    - [1.5.1. Tasks](#151-tasks)
    - [1.5.2. Category](#152-category)
    - [1.5.3. Inputs](#153-inputs)
    - [1.5.4. Multiple Targets](#154-multiple-targets)
    - [1.5.5. Excluded Constructs](#155-excluded-constructs)
- [2. Terminology](#2-terminology)
- [3. References](#3-references)

## 1. Specification

The specification defines the supported annotation syntax, discovery and task behavior, configuration controls, and representative examples for Make Run Tasks.

### 1.1. Scope

Make Run Tasks exposes documented Makefile targets through an Activity Bar explorer, extension commands, and the Visual Studio Code task system. This specification defines the annotation and integration behavior required for those interfaces; it does not define general Makefile parsing.

#### 1.1.1. Conformance

The key words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** are interpreted according to IETF [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119) and [RFC 8174](https://www.rfc-editor.org/rfc/rfc8174) when they appear in uppercase.

A conforming implementation satisfies every applicable normative statement in this document. Changes to recognized annotation syntax or externally observable task behavior SHOULD update this specification and the corresponding regression tests in the same change.

#### 1.1.2. Feature Model

The feature model separates source annotations from runtime input.

- Target
  > A concrete Make rule name that identifies a task.

- Description
  > Required source metadata that makes a supported target discoverable.

- Category
  > Optional persistent source metadata that groups subsequent documented targets and may map them to a built-in Visual Studio Code task group.

- Usage Metadata
  > Optional source metadata that describes the positional goals or Make variable assignments accepted after a target.

- Runtime Argument
  > An ordered value supplied through an extension command or a `makefileTarget` task definition and passed to Make after the target name.

### 1.2. Annotation Syntax

Annotations are line-oriented comments associated with concrete Make rules. Description and usage annotations are pending metadata that apply only to the next supported rule. Category metadata remains active until another valid category header replaces it.

A line beginning with a tab is recipe content and MUST NOT be interpreted as an annotation or target. Otherwise, optional horizontal whitespace MAY precede usage and category annotations; description annotations permit leading spaces.

#### 1.2.1. Target Rules

A discovered target name MUST match:

```plaintext
[A-Za-z0-9][A-Za-z0-9_.-]*
```

A supported rule MUST begin at the first character of a line, contain one or more valid target names separated by spaces or tabs, and use `:` or `::` as the rule separator. Prerequisites MAY follow the separator.

Pattern rules, assignments, recipes, unsupported target names, and undocumented rules MUST NOT produce discovered targets.

#### 1.2.2. Descriptions

A supported target MUST have a non-empty preceding or inline description.

- Preceding Description
  > A preceding description begins with `##` after optional leading spaces and applies to the immediately following supported rule.

- Inline Description
  > An inline description uses `## <description>` in the rule remainder. It MAY follow prerequisites and takes precedence over a pending preceding description.

- Consecutive Description
  > Consecutive non-empty preceding description lines are joined with one space. An empty `##` line contributes no text and does not terminate the description block.

- Adjacency
  > A blank line, ordinary comment, assignment, unsupported construct, category header, or recipe line clears pending description and usage metadata.

- Multiple Targets
  > A supported rule containing multiple target names produces one discovered target per name. Each target receives the same description and active category.

#### 1.2.3. Categories

A category header has the following abstract form:

```plaintext
<optional-horizontal-whitespace>#<whitespace><separator-run><whitespace><category>(<whitespace><trailing-separator-run>)?
```

The leading separator run MUST contain one Unicode punctuation or symbol character repeated at least three times. The category name MUST be non-empty. A trailing separator run, when present, MUST use the same character as the leading run and MUST be preceded by whitespace.

A valid category applies to subsequent documented targets until another valid category header is encountered. Unrelated Makefile constructs do not clear the active category. A category header clears pending description and usage metadata.

#### 1.2.4. Inputs

Input support consists of descriptive usage metadata and ordered runtime arguments.

Usage metadata MAY precede a documented target in the following form:

```plaintext
# Usage: make <target> <usage-suffix>
```

`Usage` and `make` are matched case-insensitively. The metadata target name is matched to a discovered target case-sensitively.

Spacer comments containing only `#` and optional horizontal whitespace MAY occur between the usage line and the description. A non-empty, trimmed usage suffix is retained as descriptive text. An empty or mismatched usage annotation does not suppress an otherwise valid documented target. For a rule containing multiple targets, usage metadata applies only to the target whose name matches the annotation.

Usage metadata MUST NOT validate, type, transform, or supply runtime arguments. Runtime arguments originate from **Run Target with Arguments** or the optional `args` array in a `makefileTarget` task definition.

### 1.3. Discovery and Task Behavior

Discovery converts supported annotations and rules into workspace-scoped target records. Task integration converts those records into Visual Studio Code tasks without evaluating Make variables, includes, conditionals, implicit rules, or generated targets.

#### 1.3.1. Discovery

Makefiles MUST be discovered independently within each workspace folder using the configured include globs and exclusion glob. Files containing no documented targets MUST be omitted.

Each discovered target MUST retain its name, description, workspace folder, workspace-relative Makefile path, and source line. Category and usage metadata MUST be retained when present.

Within one Makefile, the first discovered definition of a target name MUST be retained and later duplicate definitions MUST be ignored. The same target name in different Makefiles remains distinct.

#### 1.3.2. Task Definition and Resolution

Discovered targets MUST be available through the `makefileTarget` task type.

| Property   | Required | Description                                                                      |
| ---------- | -------- | -------------------------------------------------------------------------------- |
| `type`     | Yes      | Literal task type `makefileTarget`.                                              |
| `target`   | Yes      | Target name to execute.                                                          |
| `makefile` | No       | Workspace-relative Makefile path used to disambiguate the target.                |
| `args`     | No       | Ordered positional goals or Make variable assignments appended after the target. |
| `executionId` | No    | Internal identity for a task launched by the extension's execution controller. |

When `makefile` is present, task resolution MUST match the target name and workspace-relative Makefile path. When the task has a workspace-folder scope, resolution MUST also match that folder.

When `makefile` is absent, task resolution MUST use the first discovered target with the same name in the applicable workspace scope. An explicit `makefile` value SHOULD be used when the same target name occurs in more than one discovered Makefile.

#### 1.3.3. Input Processing and Execution

A resolved task MUST execute the configured Make command with this argument order:

```plaintext
<make-command> -f <makefile-name> <target> [arguments...]
```

The working directory MUST be the directory containing the selected Makefile. Arguments declared in `tasks.json` are appended in array order.

Text entered through **Run Target with Arguments** is tokenized without applying shell grammar. Whitespace separates arguments except inside single or double quotes. Backslash escapes the following character outside single quotes. Quote delimiters are removed, and unterminated quoted input MUST be rejected without executing the task.

Explorer and editor run commands MUST save dirty selected Makefiles and revalidate their documented target names before launching tasks. Failure to save or resolve any selected target MUST prevent the batch from starting.

Batch execution MUST launch one task per selected target in check order and wait for each task's completion before launching the next. Selections MAY span Makefiles and workspace folders; each task MUST use its target's scope and working directory. Non-zero exit codes, launch errors, or task completion without a process result MUST stop the batch and mark queued targets as skipped. Process termination without an exit code MUST mark the current task and run cancelled. Separate Make invocations MAY update shared dependencies again. Make's configuration governs execution inside each individual task.

All extension run entry points MUST use one execution controller. It MUST register completion listeners before launch, capture early completion, distinguish actual task executions, and assign unique internal executionId values to concurrent tasks. Cancelling a run MUST terminate only its own execution and skip queued targets, including tasks whose execution handle arrives after cancellation. Preparation failures MUST create a failed run without starting any tasks. Each run MUST retain a snapshot of its target selection and argument arrays. Multiple sequences and single runs MAY prepare and run concurrently; ordering and failure/cancellation MUST be isolated to each run.

#### 1.3.4. Presentation

Targets MUST remain distinguishable by workspace folder and Makefile when more than one scope exists. When at least one target in a Makefile has a category, categorized targets MUST be grouped by category and targets without a category MUST appear under **Uncategorized**.

The categories `Build`, `Test`, `Clean`, `Rebuild`, and `Rebuild All` MUST map case-insensitively to the corresponding built-in Visual Studio Code task group. Other category names remain presentation metadata.

A retained usage suffix MUST be shown in the target picker, explorer tooltip, generated task detail, and argument-input prompt. The description MUST remain visible in target-selection and task-detail surfaces, and the source location MUST remain available for navigation.

The explorer MUST offer an explicit multi-select mode with target checkboxes and a selected count. Clicking a target in this mode MUST change selection instead of running it. Selections MUST distinguish targets by Makefile URI and name, preserve check order through refresh, and remove targets that no longer exist. The **Run in Sequence** toolbar action MUST use the run-all icon, start the selected targets immediately without a mode picker, and be disabled only with no selection; an active sequence MUST NOT block another sequence. Leaving multi-select mode MUST clear selection and restore click-to-run behavior.

Outside multi-select mode, clicking a target name MUST run it directly. The explorer MUST NOT offer a separate inline Run Target button. It MUST offer inline Run Target with Arguments and Go to Target Definition actions; navigation MUST remain available in multi-select mode. The single-target picker MUST remain available in the Command Palette and MUST NOT appear in the explorer toolbar.

When `makefileTasks.codeLens` is enabled, matching workspace Makefiles MUST offer run and argument-input CodeLens actions for documented targets, using current editor text. The actions MUST honor configured include and exclusion patterns. VS Code's global `editor.codeLens` setting controls whether they are displayed.

The container MUST contribute an independently resizable native Execution view below Targets, with id makefileTasks.execution. It MUST show every extension-started single run and sequence, completion counts, the current target, per-step states and failure details, without execution progress or result notifications. Terminal output MUST remain available. New records MUST expand without taking editor focus; the title MUST show the active run count. Active records MUST have an inline cancellation action and completed records MUST be clearable without removing active records. All active records and the ten most recently started completed records MUST be retained in descending start order. Runs started through external terminals or VS Code's native task commands MUST NOT be adopted.

Execution history MUST be stored in extension workspaceState under makefileTasks.executionHistory with a versioned JSON schema. Targets, URI and workspace metadata, arguments, command snapshots, statuses, errors and exit codes MUST survive reload and reopening the same workspace; terminal output MUST NOT be stored. URI values MUST be serialized as strings and reconstructed before reuse. Writes MUST capture independent snapshots and be serialized to prevent stale writes from resurrecting deleted records. State changes, in-place reruns, deletion and clearing MUST update saved history. Storage errors MUST be logged without breaking execution, and pending writes MUST be awaited on deactivation.

Execution rows MUST show total elapsed time including preparation; step rows MUST show time from launch through completion, failure or cancellation. Optional durationMs fields on runs and steps and optional step startedAt timestamps MUST remain compatible with version 1 history; missing measurements MUST display as unknown, not inferred from old start timestamps. Live durations MUST refresh once per second through view events without triggering history writes. Normal deactivation MUST checkpoint live durations before awaiting saved state. Restoration MUST freeze interrupted runs at their saved durations without adding offline time. Rerun MUST reset all timing. Resume MUST retain successful step timings and accumulate measured attempt durations in the total, even when resuming from the first step, excluding idle time between attempts; retried steps MUST get fresh timings. Totals MAY exceed the visible steps' sum because they include preparation and prior failed attempts. Waiting/skipped steps MUST remain untimed. Invalid optional timing values MUST fail history validation. Durations MUST never be negative.

Restoration MUST sort records by latest start time, retain the latest ten, ignore invalid records without changing a batch's target list, and avoid starting any tasks. Previously active records MUST become interrupted; running steps MUST become interrupted, waiting steps MUST become skipped, and completed steps MUST retain their results. The restored record MUST explain that tracking was interrupted and the queue will not resume automatically. Interrupted records MUST remain rerunnable and deletable. Workspace histories MUST stay isolated.

Completed run records MUST offer rerun and delete actions inline and in their context menu. Rerun MUST reuse the existing run id and record, replace step execution ids, clear prior results, update the start timestamp, and move the record to the top. It MUST preserve all target snapshots and arguments, revalidate the current Makefiles, and restart a sequence from its first target. Active records MUST NOT be rerun or deleted; reruns of ended records MUST be allowed independently of other active runs, including sequences. Deleting a completed record MUST remove only that record from the view and saved workspace history without touching terminal output or source files.

Failed records with incomplete steps MUST offer Resume from Failure inline and in the context menu, using the debug-continue icon and command makefileTasks.resumeExecution. Resume MUST reuse the run id and record, update its start timestamp, move it to the top, and preserve the contiguous successful prefix including step ids, results and command snapshots. Starting at the first non-successful step, it MUST replace execution ids, clear prior errors and exit codes, preserve target order and arguments, and prepare only that remaining suffix before starting any tasks. A preparation failure MUST remain retryable from the first incomplete step, without revalidating successful targets. Resume MUST use current Make settings and existing sequential failure/cancellation semantics, independently of other active runs. It MUST restart whole targets, not recipe internals. View nodes and progress MUST reflect the new remaining steps while retaining successful results. Eligibility MUST be shared by the view and controller; active, successful, cancelled, interrupted, missing and deleted records MUST NOT resume, and duplicate clicks MUST NOT launch additional tasks. Saved failures MUST remain resumable using the existing history schema; reloading during resume MUST restore the run as interrupted without executing tasks. Rerun MUST continue to restart the entire record.

Run and step context menus MUST support command inspection, copying commands, and navigating to target definitions; steps MUST also have an inline navigation action. Multi-target run navigation MUST ask which target to open. Recorded steps MUST retain literal executable, argument and working-directory snapshots; started steps MUST reflect their actual task command. Inspection MUST distinguish step statuses, including planned invocations for skipped or waiting steps. Copied commands MUST quote arguments literally, use PowerShell on Windows or POSIX syntax elsewhere, preserve step order and stop on failure. None of these inspection actions MAY start a task.

#### 1.3.5. Refresh and Error Handling

Initial discovery and manual refresh MUST be supported. Changes to `makefileTasks` configuration MUST trigger discovery refresh.

When `makefileTasks.autoRefresh` is enabled, saves to discovered Makefiles, workspace-folder changes, and file events matching `**/{Makefile,makefile,GNUmakefile,*.mk}` schedule a refresh. Files matched only by custom globs outside that watcher pattern MAY require manual refresh after external changes.

Discovery and input errors MUST be reported without terminating extension activation or executing invalid input.

### 1.4. Configuration

Configuration settings are grouped by the behavior they control.

#### 1.4.1. Discovery Configuration

| Setting                     | Default                                           | Purpose                                                 |
| --------------------------- | ------------------------------------------------- | ------------------------------------------------------- |
| `makefileTasks.fileGlobs`   | `**/Makefile`, `**/makefile`, `**/GNUmakefile`    | Defines workspace-relative Makefile discovery patterns. |
| `makefileTasks.excludeGlob` | `**/{.git,node_modules,vendor,.venv,dist,out}/**` | Excludes matching paths from discovery.                 |

#### 1.4.2. Execution and Interaction Configuration

| Setting                     | Default | Purpose                                                       |
| --------------------------- | ------- | ------------------------------------------------------------- |
| `makefileTasks.makeCommand` | `make`  | Defines the executable or command supplied to task execution. |
| `makefileTasks.codeLens`    | `true`  | Shows editor run and argument-input CodeLens actions.         |

The former `makefileTasks.runOnClick` setting is no longer used; normal target clicks always run the selected target, while clicks in multi-select mode toggle selection.

#### 1.4.3. Presentation and Refresh Configuration

| Setting                     | Default  | Purpose                                                               |
| --------------------------- | -------- | --------------------------------------------------------------------- |
| `makefileTasks.sort`        | `source` | Uses source order or name order in the explorer and task picker.      |
| `makefileTasks.autoRefresh` | `true`   | Enables refresh scheduling after supported workspace and file events. |

### 1.5. Examples

The examples demonstrate the recognized subset and its resulting metadata. Recipe behavior remains governed by GNU Make.

#### 1.5.1. Tasks

Example:

```make
## Build the application
build:
 go build ./...
```

The rule produces the target `build` with the description `Build the application`.

The equivalent inline form is:

```make
test: ## Run the test suite
 go test ./...
```

#### 1.5.2. Category

Example:

```make
# === Test ================================================================
## Run the test suite
test:
 go test ./...
```

The category `Test` applies to the target and maps it to the built-in test task group.

#### 1.5.3. Inputs

Example:

```make
# Usage: make secrets-decrypt <files> [ENV=<name>]
#
## Decrypt one or more files
secrets-decrypt:
 @echo "implementation omitted"
```

The usage suffix `<files> [ENV=<name>]` is descriptive. It is displayed by the extension but does not validate supplied values.

An explicit task supplies ordered runtime arguments independently of the usage annotation:

```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "type": "makefileTarget",
      "target": "secrets-decrypt",
      "makefile": "Makefile",
      "args": [
        "secrets/example.yaml.enc",
        "ENV=development"
      ]
    }
  ]
}
```

The resulting Make invocation places both arguments after `secrets-decrypt`.

#### 1.5.4. Multiple Targets

Example:

```make
## Build both variants.
## Produce release artifacts.
alpha beta:: prerequisites
```

The rule produces `alpha` and `beta` with the description `Build both variants. Produce release artifacts.`

#### 1.5.5. Excluded Constructs

Example:

```make
## Pattern rules are excluded
build-%:

## Assignments are excluded
VALUE := example

undocumented:
 @echo hidden
```

None of these constructs produces a discovered target.

## 2. Terminology

- Active Category
  > The most recent valid category header that applies to subsequent documented targets.

- Description
  > Non-empty preceding or inline text that makes a supported target discoverable.

- Documented Target
  > A supported concrete target associated with a description.

- Pending Metadata
  > Description or usage metadata retained until the next supported rule or invalidated by unrelated input.

- Runtime Argument
  > One ordered value passed to Make after the selected target name.

- Usage Metadata
  > An optional annotation that describes expected input without supplying or validating it.

- Usage Suffix
  > The trimmed text following `make <target>` in a usage annotation.

- Workspace Scope
  > The Visual Studio Code workspace folder used to discover, distinguish, resolve, and execute a target.

## 3. References

- GNU Project [GNU Make Manual](https://www.gnu.org/software/make/manual/make.html) documentation.
- Visual Studio Code [Tasks](https://code.visualstudio.com/docs/debugtest/tasks) documentation.
- Visual Studio Code [Task Provider](https://code.visualstudio.com/api/extension-guides/task-provider) documentation.
- IETF [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119) standard.
- IETF [RFC 8174](https://www.rfc-editor.org/rfc/rfc8174) standard.
- Make Run Tasks [parser](../src/parser.ts) implementation.
- Make Run Tasks [parser tests](../test/parser.test.ts) test suite.
- Make Run Tasks [task provider](../src/tasks.ts) implementation.
- Make Run Tasks [discovery](../src/discovery.ts) implementation.
- Make Run Tasks [extension activation](../src/extension.ts) implementation.
- Make Run Tasks [explorer](../src/tree.ts) implementation.
- Make Run Tasks [extension manifest](../package.json) implementation.
