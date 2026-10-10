# 发布 Make Run Tasks

项目已使用 `name: make-run-tasks`、`displayName: Make Run Tasks`、`publisher: ai-follwer`，扩展 ID 为 `ai-follwer.make-run-tasks`，仓库链接指向 [ifollower/makerun-vscode](https://github.com/ifollower/makerun-vscode)。当前版本为 `1.7.6`。

原内部名称 `make-run` 已被 Marketplace 中的其他扩展占用，现使用 `make-run-tasks` 作为内部名称。上传时使用以下新的 VSIX 文件。

## 首次发布：网页上传 VSIX

1. 使用 Microsoft 账号登录 [Marketplace 发布管理页](https://marketplace.visualstudio.com/manage)，选中 Publisher **ai-follwer**。
2. 确认 `package.json` 中的 `publisher` 为 `ai-follwer`。
3. 在项目目录执行：

   ```powershell
   npm ci
   npm run package
   ```

   生成的文件是 `out/make-run-tasks-1.7.6.vsix`。`out/` 会自动创建，并由 `.gitignore` 排除。更改 Publisher ID 或内部名称后需要重新打包。
4. 可以先在 VS Code 的扩展面板菜单中选择 **Install from VSIX…** 验证这个包。
5. 在 Marketplace 管理页选中自己的 Publisher，选择 **New extension → Visual Studio Code**，上传 VSIX 并提交发布。

官方支持网页上传 VSIX 和命令行发布两种方式；网页上传使用登录账号即可。[官方发布文档](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#publish-an-extension)

## 命令行发布

项目已安装 `@vscode/vsce`。如果使用 PAT，在 Azure DevOps 中创建 Token，Organization 选择 **All accessible organizations**，权限选择 **Marketplace → Manage**，然后执行：

```powershell
npx --no-install vsce login ai-follwer
npx --no-install vsce publish --packagePath ./out/make-run-tasks-1.7.6.vsix
```

在本机交互提示中输入 Token。

官方已公布 Azure DevOps 全局 PAT 将于 **2026-12-01** 退役，长期自动发布应使用 Microsoft Entra ID；配置方式见 [官方自动发布说明](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#secure-automated-publishing-to-visual-studio-marketplace)。仓库现有 GitHub 发布流程使用 `VSCE_PAT`，后续启用自动发布时需要考虑这一迁移。

## 更新版本

后续发布先更新 `package.json` 的版本，例如使用 `npm version patch --no-git-tag-version` 同步更新版本和 lockfile，再重新打包上传。`publisher` 和 `name` 一起构成扩展 ID，应在首次发布前确定。[扩展清单说明](https://code.visualstudio.com/api/references/extension-manifest)
