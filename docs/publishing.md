# 发布 Make Run Tasks

项目使用 `name: make-run-tasks`、`displayName: Make Run Tasks`、`publisher: ai-follwer`，扩展 ID 为 `ai-follwer.make-run-tasks`，仓库为 [ifollower/makerun-vscode](https://github.com/ifollower/makerun-vscode)。版本以 `package.json` 为准，打包文件自动命名为 `out/make-run-tasks-<version>.vsix`。

原内部名称 `make-run` 已被 Marketplace 中的其他扩展占用，现使用 `make-run-tasks` 作为内部名称。上传时使用以下新的 VSIX 文件。

## 首次发布：网页上传 VSIX

1. 使用 Microsoft 账号登录 [Marketplace 发布管理页](https://marketplace.visualstudio.com/manage)，选中 Publisher **ai-follwer**。
2. 确认 `package.json` 中的 `publisher` 为 `ai-follwer`。
3. 在项目目录执行：

   ```powershell
   make vsce-dependencies
   make vsce-preview
   ```

   生成的文件是 `out/make-run-tasks-<version>.vsix`。`out/` 会自动创建，并由 `.gitignore` 排除。更改 Publisher ID 或内部名称后需要重新打包。
4. 可以先在 VS Code 的扩展面板菜单中选择 **Install from VSIX…** 验证这个包。
5. 在 Marketplace 管理页选中自己的 Publisher，选择 **New extension → Visual Studio Code**，上传 VSIX 并提交发布。

官方支持网页上传 VSIX 和命令行发布两种方式；网页上传使用登录账号即可。[官方发布文档](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#publish-an-extension)

## 本机一键发布

项目通过官方 `@vscode/vsce` API 发布。以下操作都有 Make 入口，带有 `##` 说明，因此会显示在插件任务面板中；npm 脚本也保留。Makefile 使用 Bash：Windows 上需要 GNU Make 和可用的 Bash（例如 Git Bash），npm 命令可以直接在 PowerShell 中运行。首次安装依赖可执行 `make vsce-dependencies`，后续登录和发布不会重复安装依赖。

| Make 命令 | 操作 | 对应 npm 命令 |
| --- | --- | --- |
| `make vsce-login` | 首次登录 Publisher | `npm run marketplace:login` |
| `make vsce-preview` | 检查、构建、打包，不上传 | `npm run marketplace:preview` |
| `make vsce-publish` | 发布当前版本 | `npm run marketplace:publish` |
| `make vsce-release` | 升级 patch 版本后发布 | `npm run marketplace:release` |
| `make vsce-version` | 只升级版本，不发布 | `npm version patch --no-git-tag-version` |
| `make vsce-publish-azure` | 用 Azure 凭据发布当前版本 | `npm run marketplace:publish -- --azure-credential` |

### 首次配置凭据

使用管理 Publisher **ai-follwer** 的 Microsoft 账号，在 Azure DevOps 中创建 PAT：Organization 选择 **All accessible organizations**，权限选择 **Marketplace → Manage**。然后在自己的本机终端执行：

```powershell
make vsce-login
```

在交互提示中输入 Token。登录后的凭据由 vsce 管理，后续发布自动读取；脚本也支持已有的 `VSCE_PAT` 环境变量。Token 不作为命令行参数传递，项目脚本不保存 Token，也不会读取 `.env`。不要把 Token 写入代码、Git 或聊天消息。

### 发布和预演

```powershell
# 检查、构建并生成当前版本的 VSIX；不上传、不修改版本
make vsce-preview

# 检查、构建、重新打包并发布当前版本
make vsce-publish

# 以后发布更新：自动升级 patch 版本，再检查、构建、打包并发布
make vsce-release
```

每次都重新生成 `out/<name>-<version>.vsix`，然后上传刚刚生成的包，避免上传旧产物。检查、构建或打包失败时不会上传；上传失败会以非零状态退出，VSIX 仍保留在 `out/`，方便检查和重试。发布完成后打印 Marketplace 链接；上线可见性仍取决于 Marketplace 的处理。

`make vsce-release` 默认使用 `npm version patch --no-git-tag-version`，同步修改 `package.json` 和 `package-lock.json`，然后发布。它不自动提交、打标签或推送 Git。发布失败后已经升级的版本不会回退，修复凭据或网络问题后用 `make vsce-publish` 重试即可，避免再次升级。发布前请准备好对应的 CHANGELOG 内容。若要升级 minor 或 major，可以执行 `make vsce-release VSCE_VERSION_BUMP=minor` 或 `make vsce-release VSCE_VERSION_BUMP=major`；若只升级版本，使用 `make vsce-version VSCE_VERSION_BUMP=minor`。

Marketplace 不允许重复上传已存在的版本。如果当前版本已经通过网页发布，下一次使用 `make vsce-release`。

### Microsoft Entra ID / Azure 凭据

完成官方说明中的身份配置，并将对应身份加入 Publisher **ai-follwer** 后，可以使用：

```powershell
make vsce-publish-azure

# 升级 patch 版本后使用 Azure 凭据发布
make vsce-release VSCE_PUBLISH_ARGS="--azure-credential"
```

此模式使用 vsce 的 Azure 凭据认证，不传递 `VSCE_PAT`，以免本机遗留 PAT 覆盖 Azure 身份。

官方已公布 Azure DevOps 全局 PAT 将于 **2026-12-01** 退役，长期自动发布应使用 Microsoft Entra ID；配置方式见 [官方自动发布说明](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#secure-automated-publishing-to-visual-studio-marketplace)。仓库原有 GitHub 发布流程另行使用 `VSCE_PAT`；本机发布命令不会修改或触发该流程。要同时使用本机和 GitHub 发布，应协调版本，避免双方重复发布同一版本。

## 更新版本

后续发布可以使用 `make vsce-release` 完成升级和发布，或先使用 `make vsce-version` 同步更新版本和 lockfile，再用 `make vsce-publish`。`publisher` 和 `name` 一起构成扩展 ID，应在首次发布前确定。[扩展清单说明](https://code.visualstudio.com/api/references/extension-manifest)
