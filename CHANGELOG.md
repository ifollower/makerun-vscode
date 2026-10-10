# Changelog

## Unreleased

* Remove Run in Parallel and use its run-all icon for Run in Sequence.
* Combine selected targets from one Makefile into a single Make invocation and show output in the task terminal without a progress notification.

## 1.7.6 (2026-10-09)

### Features

* Rename the extension and its visible UI to Make Run Tasks under publisher ai-follwer, update fork repository links, and add publishing instructions.
* Use make-run-tasks as the Marketplace package name.
* Add an explorer multi-select mode with checkboxes, ordered selection, separate sequence and parallel toolbar actions, and cancellation.
* Open Makefile definitions when target names are clicked; keep execution on explicit inline actions and remove the single-target picker from the explorer toolbar.
* Add configurable CodeLens run and argument actions above documented Makefile targets, saving dirty Makefiles before execution.

## [1.7.5](https://github.com/sentenz/vscode-make-tasks/compare/1.7.4...1.7.5) (2026-10-04)

### Bug Fixes

* **deps:** update npm dependencies ([#69](https://github.com/sentenz/vscode-make-tasks/issues/69)) ([ab23eef](https://github.com/sentenz/vscode-make-tasks/commit/ab23eef9b141523f66fc14be3b47f0a3e5247fc5))

## [1.7.4](https://github.com/sentenz/vscode-make-tasks/compare/1.7.3...1.7.4) (2026-09-29)

### Bug Fixes

* **deps:** update dependency @types/node to v24.19.0 ([#67](https://github.com/sentenz/vscode-make-tasks/issues/67)) ([ad908ac](https://github.com/sentenz/vscode-make-tasks/commit/ad908ac22f62f476aa95f4c46b9e4d8f3a9b486c))

## [1.7.3](https://github.com/sentenz/vscode-make-tasks/compare/1.7.2...1.7.3) (2026-09-26)

### Bug Fixes

* **deps:** update npm dependencies ([#62](https://github.com/sentenz/vscode-make-tasks/issues/62)) ([01e7b32](https://github.com/sentenz/vscode-make-tasks/commit/01e7b321653dac26db1a6f0111e51c5a81d32d68))

## [1.7.2](https://github.com/sentenz/vscode-make-tasks/compare/1.7.1...1.7.2) (2026-09-20)

### Bug Fixes

* **deps:** update npm dependencies (major) ([#58](https://github.com/sentenz/vscode-make-tasks/issues/58)) ([6aeab0a](https://github.com/sentenz/vscode-make-tasks/commit/6aeab0adcd96b925b49f62c9a0b9d9e32dbfc8a2))

## [1.7.1](https://github.com/sentenz/vscode-make-tasks/compare/1.7.0...1.7.1) (2026-09-20)

### Bug Fixes

* **deps:** update npm dependencies ([#57](https://github.com/sentenz/vscode-make-tasks/issues/57)) ([69aec7f](https://github.com/sentenz/vscode-make-tasks/commit/69aec7f02f37990321adf8c42876371e732fad8e))

## [1.7.0](https://github.com/sentenz/vscode-make-tasks/compare/1.6.1...1.7.0) (2026-08-29)

### Features

* add MCP target discovery and strengthen tests ([#53](https://github.com/sentenz/vscode-make-tasks/issues/53)) ([c294f78](https://github.com/sentenz/vscode-make-tasks/commit/c294f7843200a75329258fd0edaa9316d7633948))

## [1.6.1](https://github.com/sentenz/vscode-make-tasks/compare/1.6.0...1.6.1) (2026-08-29)

### Bug Fixes

* **deps:** update npm dependencies ([#47](https://github.com/sentenz/vscode-make-tasks/issues/47)) ([f013e4c](https://github.com/sentenz/vscode-make-tasks/commit/f013e4c9cb5807217105110580c6147919c01215))

## [1.6.0](https://github.com/sentenz/vscode-make-tasks/compare/1.5.5...1.6.0) (2026-08-29)

### Features

* **icons:** adopt Material 3 bold M monogram ([#51](https://github.com/sentenz/vscode-make-tasks/issues/51)) ([e181274](https://github.com/sentenz/vscode-make-tasks/commit/e181274f1a91acc3af66bc294962c0c69361d1f4))

## [1.5.5](https://github.com/sentenz/vscode-make-tasks/compare/1.5.4...1.5.5) (2026-08-09)

### Bug Fixes

* **deps:** update js-yaml to v4.3.1 and nanoid to v3.3.18 ([8a6b41b](https://github.com/sentenz/vscode-make-tasks/commit/8a6b41b7fc5a46eb12c0ff869a77ee8425d473db))

## [1.5.4](https://github.com/sentenz/vscode-make-tasks/compare/1.5.3...1.5.4) (2026-08-09)

### Bug Fixes

* **deps:** update dependency eslint to v10.8.1 ([#40](https://github.com/sentenz/vscode-make-tasks/issues/40)) ([7cc0574](https://github.com/sentenz/vscode-make-tasks/commit/7cc05741682c807c5c5dbefd476da7caa32472b1))

## [1.5.3](https://github.com/sentenz/vscode-make-tasks/compare/1.5.2...1.5.3) (2026-08-07)

### Bug Fixes

* **deps:** update dependency typescript-eslint to v8.66.0 ([#38](https://github.com/sentenz/vscode-make-tasks/issues/38)) ([b572b12](https://github.com/sentenz/vscode-make-tasks/commit/b572b12da6069422cb96b669e8033ba582241786))

## [1.5.2](https://github.com/sentenz/vscode-make-tasks/compare/1.5.1...1.5.2) (2026-08-07)

### Bug Fixes

* decouple VSIX attachment from marketplace publish ([38199ff](https://github.com/sentenz/vscode-make-tasks/commit/38199ff2620ea947688ccc6832c4eb197d3f21ba))
* preserve VSIX when marketplace token is unavailable ([6364a2e](https://github.com/sentenz/vscode-make-tasks/commit/6364a2ec6212a977b2b5a13d2c75518206826573))

## [1.5.1](https://github.com/sentenz/vscode-make-tasks/compare/1.5.0...1.5.1) (2026-08-05)

### Bug Fixes

* update homepage and repository URLs in package.json ([b74d408](https://github.com/sentenz/vscode-make-tasks/commit/b74d408c96e5de2d4f5996b54197d55cb31fa1ff))

## [1.5.0](https://github.com/sentenz/vscode-make/compare/1.4.8...1.5.0) (2026-08-05)

### Features

* set VS Code extension ID and add Marketplace check ([#34](https://github.com/sentenz/vscode-make/issues/34)) ([8af39df](https://github.com/sentenz/vscode-make/commit/8af39df1c53e5052397e3cc04992f7e62adedfbb))

## [1.4.8](https://github.com/sentenz/vscode-make/compare/1.4.7...1.4.8) (2026-08-03)

### Bug Fixes

* rename extension from makefile-task-runner to makefile-task-manager ([eb7e059](https://github.com/sentenz/vscode-make/commit/eb7e059cd6f167b793bb2764f4d74b65a41540c8))

## [1.4.7](https://github.com/sentenz/vscode-make/compare/1.4.6...1.4.7) (2026-08-03)

### Bug Fixes

* update VSIX filename to makefile-task-runner-extension.vsix ([c2ba27e](https://github.com/sentenz/vscode-make/commit/c2ba27e8496d47e0a1b704864350d26efeb25671))

## [1.4.6](https://github.com/sentenz/vscode-make/compare/1.4.5...1.4.6) (2026-08-03)

### Bug Fixes

* rename package and update VSIX filename to makefile-task-explorer ([68a051a](https://github.com/sentenz/vscode-make/commit/68a051a7561fd821019ec1ef3f64f470a21a486c))

## [1.4.5](https://github.com/sentenz/vscode-make/compare/1.4.4...1.4.5) (2026-08-03)

### Bug Fixes

* rename package from makefile-task-explorer to makefile-task ([ded91ab](https://github.com/sentenz/vscode-make/commit/ded91abd45c991c1ebac7eefbae84cf1dae8da67))

## [1.4.4](https://github.com/sentenz/vscode-make/compare/1.4.3...1.4.4) (2026-08-03)

### Bug Fixes

* derive extension ID from manifest ([249cf3a](https://github.com/sentenz/vscode-make/commit/249cf3acbb1e13d3c5107575aa2930083aa10a97))
* verify packaged extension identity from manifest ([eb63ddb](https://github.com/sentenz/vscode-make/commit/eb63ddb7a6aaa0e2758ab9b671307bd73cc7445f))

## [1.4.3](https://github.com/sentenz/vscode-make/compare/1.4.2...1.4.3) (2026-08-03)

### Bug Fixes

* update extension ID in tests and workflows for consistency ([f51d85b](https://github.com/sentenz/vscode-make/commit/f51d85b61a7f7285b32c19296d6bd1f5e9b69055))

## [1.4.2](https://github.com/sentenz/vscode-make/compare/1.4.1...1.4.2) (2026-08-02)

### Bug Fixes

* **deps:** update dependency @types/vscode to v1.125.0 ([#29](https://github.com/sentenz/vscode-make/issues/29)) ([eb21b29](https://github.com/sentenz/vscode-make/commit/eb21b2994844d4a450af0a853a4e4e9d7adbaa1e))

## [1.4.1](https://github.com/sentenz/vscode-make/compare/1.4.0...1.4.1) (2026-08-02)

### Bug Fixes

* **deps:** update node.js to v24 ([#27](https://github.com/sentenz/vscode-make/issues/27)) ([64f9147](https://github.com/sentenz/vscode-make/commit/64f9147a86edee902435fd2faeb61ddd97ccde37))

## [1.4.0](https://github.com/sentenz/vscode-make/compare/1.3.0...1.4.0) (2026-07-31)

### Features

* add category dark icon ([dbf749d](https://github.com/sentenz/vscode-make/commit/dbf749dd72f9261ab7d21112d45ba773f3953b79))
* add category light icon ([f799142](https://github.com/sentenz/vscode-make/commit/f799142693ad0d69caa4159b0d56e2e72609bea5))
* add task dark icon ([c8a02af](https://github.com/sentenz/vscode-make/commit/c8a02af12b1b9573b5b859ec4052c59d052bbc9f))
* add task light icon ([50ce9fb](https://github.com/sentenz/vscode-make/commit/50ce9fbf8b5c3c7084f941b5c08756563a46bd35))
* resolve tree icons from extension assets ([054061e](https://github.com/sentenz/vscode-make/commit/054061ec85d4f7fb2e1b5b73d85db90fa858e3be))
* use category and task icons ([6c4809a](https://github.com/sentenz/vscode-make/commit/6c4809a3d2a76b2513759231d43cf47d2029dd4e))

## [1.3.0](https://github.com/sentenz/vscode-make/compare/1.2.3...1.3.0) (2026-07-31)

### Features

* add SVG icons for makefile representation ([f42bc3d](https://github.com/sentenz/vscode-make/commit/f42bc3d0414561e9263640073c4c39268e0e54a8))

## [1.2.3](https://github.com/sentenz/vscode-make/compare/1.2.2...1.2.3) (2026-07-31)

### Bug Fixes

* restore categories in target hover ([3176acd](https://github.com/sentenz/vscode-make/commit/3176acd09b6d93c1fd488d3e97153b0c5c7430e8))
* show categories in task details ([1756e48](https://github.com/sentenz/vscode-make/commit/1756e4839f5b1ef4a225cc9c577a331c2cf103b2))

## [1.2.2](https://github.com/sentenz/vscode-make/compare/1.2.1...1.2.2) (2026-07-31)

### Bug Fixes

* update version to 1.2.1 in package.json ([e111ba8](https://github.com/sentenz/vscode-make/commit/e111ba850c265d0659e194593b61d83b0275a867))

## [1.2.1](https://github.com/sentenz/vscode-make/compare/1.2.0...1.2.1) (2026-07-31)

### Bug Fixes

* preserve usage in target hover ([5b118d3](https://github.com/sentenz/vscode-make/commit/5b118d38af1471fa78c255bcbcc37a73e5a8c109))

## [1.2.0](https://github.com/sentenz/vscode-make/compare/1.1.0...1.2.0) (2026-07-31)

### Features

* add target usage metadata ([97b33c2](https://github.com/sentenz/vscode-make/commit/97b33c2ab9015e3c8a9d8872b616ba53101732b2))
* parse Makefile usage metadata ([04e2482](https://github.com/sentenz/vscode-make/commit/04e24822b0671e4cce377276a6a7c1304f4e2a43))
* show target usage in explorer tooltips ([d8bf1d7](https://github.com/sentenz/vscode-make/commit/d8bf1d7d2528386361f123ae34d2d4877edada03))
* show usage in discovered task details ([873427a](https://github.com/sentenz/vscode-make/commit/873427a17a6a063bc00d583b46887ecfcd431231))
* surface target usage when running with arguments ([e29db8e](https://github.com/sentenz/vscode-make/commit/e29db8e278f40999f1e329a1f0b94697029552f9))

### Bug Fixes

* render usage tooltip without markdown escapes ([e3a06dc](https://github.com/sentenz/vscode-make/commit/e3a06dcd26ee79e7e4cb1f6a86c6eaf48cce85d0))
* safely render usage code spans ([c6b03af](https://github.com/sentenz/vscode-make/commit/c6b03af79a9905e250c4647dae2987bd71a07b4b))

## [1.1.0](https://github.com/sentenz/vscode-make/compare/1.0.3...1.1.0) (2026-07-31)

### Features

* add task category metadata ([25e17a5](https://github.com/sentenz/vscode-make/commit/25e17a5b5c274820a243990ff23bc20a7a39413f))
* expose task categories in picker ([5463427](https://github.com/sentenz/vscode-make/commit/5463427405e9e6045c2f569f622552e604f2a9b0))
* group make tasks by category ([d0cbfed](https://github.com/sentenz/vscode-make/commit/d0cbfed384bd2cecb21133e3c250f8763564a475))
* map task categories to vscode groups ([6fdb551](https://github.com/sentenz/vscode-make/commit/6fdb551979e770fded052971b23e0c90e057eb60))
* parse canonical category headers ([e6e3e1c](https://github.com/sentenz/vscode-make/commit/e6e3e1cf459b135ca1689d96fdfdfb6569d5f336))
* parse make task categories ([73dae3a](https://github.com/sentenz/vscode-make/commit/73dae3a16399d0e6a97437eb2bd6ab035c5fa9b2))

### Bug Fixes

* assign task groups only when defined ([a93c8b8](https://github.com/sentenz/vscode-make/commit/a93c8b8acac1d670af7042785ce4f84a86913876))
* tighten category separator grammar ([db20411](https://github.com/sentenz/vscode-make/commit/db20411c858182c84c958ce08d1bb9b5d92465e7))

## [1.0.3](https://github.com/sentenz/vscode-make/compare/1.0.2...1.0.3) (2026-07-31)

### Bug Fixes

* **ci:** use VS Code extension release version support ([494022f](https://github.com/sentenz/vscode-make/commit/494022f88035a9d074802b2cd35dd711523c62ba))

## [1.0.2](https://github.com/sentenz/vscode-make/compare/1.0.1...1.0.2) (2026-07-31)

### Bug Fixes

* update target message handling and escapeMarkdown function ([21c1af0](https://github.com/sentenz/vscode-make/commit/21c1af001d8c2a69071f97af4be4bb6309ea0b00))

## [1.0.1](https://github.com/sentenz/vscode-make/compare/1.0.0...1.0.1) (2026-07-30)

### Bug Fixes

* restore VS Code extension build and package ([5c8434c](https://github.com/sentenz/vscode-make/commit/5c8434c0ecb3ad64ae2e216959d04f43b7098c13))

## 1.0.0 (2026-07-30)

### Features

* initial commit ([c08fc7b](https://github.com/sentenz/vscode-make/commit/c08fc7b73dc752ff7efa840f37c377fb9a892e75))
