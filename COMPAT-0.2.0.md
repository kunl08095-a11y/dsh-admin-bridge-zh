# DSH 0.2.0-rc.2 适配说明

本仓库是 [`zjlww/dsh-admin-bridge`](https://github.com/zjlww/dsh-admin-bridge) 的 fork。
上游 `5be4bbd`（以及 `main`）只面向 **DSH 0.1.2-rc.1**；本 fork 基于上游分支
`fix/agent-context-accessor-dsh-0.1.5` 的 `a89b050`，适配 **DSH 0.2.0-rc.2**，
并额外做了简体中文界面与认证时长选择。

> 这是对第三方、安全敏感代码的本地修改；Sudo 权限本身仍是实验性、非沙箱的
> root 能力。请先读 [SECURITY.md](SECURITY.md)。

## 为什么要适配

原样安装到 0.2.0 会出四个问题：

1. `src/session.js` 读取 `ctx.agent`：0.1.5 起该 accessor 被移除，运行时会抛
   `cannot get property "agent" without inject`，导致每个会话创建/恢复失败。
   上游 `a89b050` 已修复（改用 `ctx.get('agents')?.get(session_id(agent))`）。
2. 0.2.0 的原生权限选择器也注册进 `conversation.input.permission`
   （`single` 插槽，priority 0），插件同 priority 注册会直接抛
   `single slot ... already has a registration`。
3. 该插槽的 owner props 在 0.2.0 只有 `{ locked }`，权限数据通过
   `useProjection('permissions')`（仅含 `currentValue`）和注入的 hook 提供；
   插件组件原本解构 `{ value, command }`。
4. `IconChevronDownOutline14` 在 0.2.0 改名为 `IconChevronDownOutlineRegular`
   （默认 14px）。

## 客户端适配（`client/index.js`）

- 注册改为 `priority: -1` 遮蔽原生选择器；插件缺失/卸载时原生选择器自动回退。
- 从 `useProjection('permissions')` 读取 `currentValue`，菜单使用与插件图标/文案
  一致的三档原生模式（只读 / 工作区写入 / 完全访问）。
- 通过 `inject: sessionId => ({ sessionId, command })` 注入 `/permission` 命令，
  走 `sessions.binding(sessionId).session.command(line)`。
- chevron 图标改为 `IconChevronDownOutlineRegular`，菜单加 `portal: true`。
- 宿主侧沿用上游 `a89b050` 的 `ctx.agent` 修复；桥接/HTTP/策略代码未改语义。

## 界面汉化

- 选择器四档标签、Sudo 对话框文案/按钮/aria-label、错误提示全部为简体中文；
  进行中的 Sudo 显示为「Sudo 权限 · 剩余 m:ss」。
- `/permission` 命令描述与返回文案、`admin_*` 工具描述与参数说明改为中文。
- 面向用户/模型的错误消息改为中文（错误 `code` 不变，客户端仍按 code 映射）。
- 汉化是硬编码 zh-CN，不随 DSH 语言设置切换；上游更新后需要重新套用翻译。
- 上游 `tests/` 断言的是英文文案与旧对话框结构，汉化 + 对话框改造后预期失败；
  这些测试不参与运行时，仅用于上游开发。

## Sudo 对话框与自定义时长

- 对话框从原生 `<dialog>` 换成 0.2.0 的 `Modal`（`@deepseek-ai/dsh-client-ui-primitives`），
  按钮/输入框改用原生 `Button` / `Input` / `SegmentedControl`，去掉硬边框与内联
  样式，视觉与 DSH 一致。
- 认证时长可选：默认 5 分钟（300 秒），另提供 10 分钟、15 分钟和自定义
  30–900 秒。选择时长会重跑一次原生 `/permission sudo-access <秒>`，由宿主用
  新的 TTL 重建 manifest（旧 requestId 作废，需要重新输入密码）。
- `/permission sudo-access 600` 也可以在命令面板里直接带秒数。
- `cordis.patch.yml` 的 `maxTtlSeconds` 调到 `900`；默认仍是 300。若宿主没有热
  加载这行配置，10/15 分钟会显示为不可用，需要重启 `dsh web`。
- 客户端在时长未被宿主采纳时提示「宿主尚未应用该时长」，而不是假装成功。

## 安装

```sh
# 先在仓库根目录打包
npm pack --ignore-scripts

# 由于 package.json 的 peerDependencies 仍写着上游的 0.1.2-rc.1，
# 0.2.0 的供应链门禁需要一次性豁免（按实际 DSH 版本）
dsh plugin --profile web allow-version dsh-admin-bridge@0.3.0-alpha.2 \
  --dsh-version 0.2.0-rc.2 --accept-risk

dsh plugin --profile web add <此仓库>/dsh-admin-bridge-0.3.0-alpha.2.tgz --ignore-scripts
```

然后刷新 DSH Web 页面；若时长选项仍不可用，重启 `dsh web` 让 bundle 配置生效。
同一版本号重新打包后，需要先 `remove` 再 `add` 才会重新解包。

## 已知限制

- 0.2.0 的 `auto` 预设不会出现在这个选择器里（插件只认识三档 + Sudo）。
- 自定义时长上限由 `maxTtlSeconds` 决定，构造器允许 30–900 秒。
- 认证期间切换时长会作废旧请求，必须重新输入 sudo 密码。
- 本 fork 未发布到 npm；请从本仓库打包安装并自行审阅代码。

## 回滚

```sh
dsh plugin --profile web remove dsh-admin-bridge
```

然后刷新页面（必要时在终端重启 `dsh web`）。插件卸载后，原生三档选择器就是
fallback，不会留下不可用的空插槽。

## 与上游同步

本 fork 的历史基于上游 `5be4bbd` → `a89b050`，适配提交在其之上。上游发布正式
0.2.x 支持后，建议优先跟进上游，而不是长期维护本 fork。
