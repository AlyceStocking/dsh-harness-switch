# DSH Harness Switch

在 DSH 原生会话中选择模型与 harness。v0.3 将开源 Kimi Code 的实际执行核心嵌入插件：提示词、工具定义与执行、Skills、权限规则、MCP 和上下文压缩由 Kimi 核心提供，不启动 Kimi CLI 聊天子进程。

## 使用

已验证 Windows、Node **24.19.0**、DSH **0.1.2-rc.1**。最低 Node 24.15；DSH 0.2 新消息格式及其他桌面发行版尚未验证。

```powershell
gh repo clone AlyceStocking/dsh-harness-switch
cd dsh-harness-switch
npm ci
# 使用桌面应用实际的 DSH_HOME 和 profile。web 只是示例。
dsh plugin --profile web add (Get-Location).Path
```

重启 DSH，进入设置 →「模型 Harness」：

1. 确认 Kimi 配置目录，点击「读取已配置模型」。复用 config.toml 的端点、模型与 API key / 环境变量 / 文件 OAuth；凭据不复制进插件配置或前端。
2. 为 `kimi-code/k3` 等模型别名选择 **Kimi Code · embedded core**，保存。
3. 在原生模型选择器的 `Kimi · Harness Switch` 中选择该绑定，选择工作区后正常聊天。旧版配置不会被静默迁移，需要手动改选 embedded core。
4. 当前生成结束或停止后，可以在同一原生 session 选择已有 DeepSeek 模型，恢复其 DSH 提示词与工具。再切回 Kimi 时，新增的其他模型历史会作为参考历史导入 Kimi。

每个模型绑定可选择：

| Harness | 行为 |
| --- | --- |
| Kimi Code · embedded core | 完整嵌入式 Kimi 执行核心，默认选项 |
| Kimi prompt · legacy | v0.2 的适配提示词，工具、Skills、压缩使用 DSH |
| DSH native | Kimi API + DSH 原生提示词、工具与执行循环 |

比较相同模型的不同 harness 时，添加两个绑定并选择相同模型别名即可。尚未实现其他厂商 harness。

## 原生会话与权限

DSH session 列表、输入框和最终回答保持原生。一次 Kimi 执行显示为 `kimi_harness_turn` 工具卡片，卡片内部展示 Kimi 工具调用/结果、思考、Skill 与压缩事件。真实工具只在 Kimi 内执行一次。DSH 的外层模型适配器仅编排这个本地入口，不再调用模型执行第二遍。

Kimi 核心采用 manual 权限模式。需要审批的动作、工作区信任和提问映射到 DSH 原生审批/问题界面；拒绝、取消或不可用均不自动放行。DSH 需要配置可用的审批 UI 与允许询问的策略（`policy: ask`）；`never` 策略会拒绝需要审批的动作。本插件不修改全局审批设置。Kimi 判断无需审批的读取等动作保持上游行为，DSH 的逐工具 allowlist 不会另外检查 Kimi 内部工具。

可直接在输入框发送：

- `/kimi-skill <名称> [任务]`：通过上游 SDK 显式激活 Skill。普通消息也能由模型使用 Skill 工具。
- `/kimi-compact [保留内容要求]`：调用 Kimi 自身压缩。自动压缩也由 Kimi 核心管理。DSH 外层传输模型不声明上下文预算，避免对它进行第二次模型上下文压缩。

项目 Skills 的发现根目录与上游一致，通常是 Git 项目根目录；用户 Skills 沿用 Kimi home。这里的命令是插件桥接命令，不代表实现了 Kimi CLI 的所有交互命令。

## 一致性与边界

固定复用 [Kimi Code 源码](https://github.com/MoonshotAI/kimi-code/tree/c9f01f07388abc2cdca40c9c5267f58c65086710) 的 Node SDK、agent core、kosong provider、工具、Skills、MCP、权限与压缩模块。构建产物、来源和 MIT 许可保留在 `vendor/`。唯一功能性源码补丁将 query-index 缓存隔离到 Kimi home 下 `cache/dsh-harness-switch`，避免与 CLI 的独占数据库锁冲突。构建解析器另外处理工作区模块、原始提示词资源与 ESM 导入。

同一核心版本和配置能最大程度保持调用行为一致，但不承诺两端请求逐字节相同：宿主身份、工作区/时间、会话状态、UI 能力和跨模型导入的历史会不同。完整系统提示词由上游核心生成；不再用 legacy 模板代替。

当前限制：

- 输入桥接仅支持文本；图片输入明确报错。Kimi CLI 专属面板、终端快捷键、所有 slash 命令没有移植。内部工具保持上游定义，但仍受宿主平台、依赖和 UI capability 限制。
- 原始 Kimi 日志、上下文、压缩和执行状态留在 Kimi home；DSH 存储可显示的执行投影和最终回答，不能将 DSH 工具事件无损转换成另一 harness 的内部状态。跨模型历史作为参考导入，并移除其他模型的思考字段。
- 插件映射与卡片快照位于设置文件旁的 `engine/`。同时保留 DSH 存储、该目录和 Kimi home 才能完整恢复。中断且结果未落盘的请求不会自动重跑；请发送新消息继续。
- 更改同一 session 的 Kimi home、工作区或固定核心版本会拒绝复用旧状态，需新建 session。不要同时用 CLI 操作插件正在使用的同一个 Kimi session。多个 DSH 进程共享同一 Kimi home 的嵌入缓存尚不支持。
- Kimi 原生 token 用量/预算尚未映射到 DSH 外层统计；原始记录在 Kimi 会话中。后台任务生命周期、MCP 服务和全部平台工具尚未逐项端到端验证。
- 这是插件执行桥接，不是操作系统沙箱。嵌入模式使用 Kimi 的策略；DSH 全局系统提示词扩展不自动注入 Kimi 核心。

设置文件默认位于 `$DSH_HOME/storages/harness-switch/<DSH_PROFILE 或 default>.json`。多 profile 时可在插件配置中指定独立绝对路径 `settingsFile`。

## 独立 API 配置

无需安装 CLI，但需要有效 Kimi 配置及授权。例如：

```toml
[providers.kimi]
type = "kimi"
base_url = "https://api.kimi.com/coding/v1"
api_key_env = "KIMI_API_KEY"

[models."kimi-code/k3"]
provider = "kimi"
model = "k3"
max_context_size = 262144
```

模型 ID、端点和上下文上限以账户权限及 [Kimi 配置文档](https://www.kimi.com/code/docs/en/kimi-code-cli/configuration/config-files.html) 为准。启动 DSH 的进程须能读取环境变量。

## 验证与构建

```powershell
npm ci
npm test
npm run check
# 以下是显式运行的真实 API 测试，会消耗账户额度。
$env:DSH_MODULES = '你的 DSH 安装目录/node_modules'
node tests/engine-smoke.mjs
# legacy 提示词与 DSH 原生工具路径
node tests/native-smoke.mjs
```

自动测试覆盖审批拒绝、停止/卸载无事件死等、去重、恢复、外部工具历史导入、异常不泄露认证数据、Skill/压缩 API 路由和设置/工具卡片渲染。

真实 API 集成测试已验证 K3 的 Kimi Read、经过 DSH 审批的 Bash、项目 Skill 激活、压缩，以及在同一 DSH agent/session 中切换回原生适配器再返回 Kimi。测试中的原生模型是本地替身，未调用真实 DeepSeek API。v0.3 设置界面已在隔离 DSH Web 配置中验证保存 embedded core；v0.3 新工具卡片已做 React/jsdom 测试，桌面端尚未完整人工验收。

源码重新打包需使用上述固定 commit：

```powershell
node scripts/vendor-kimi.mjs ../kimi-code
node scripts/vendor-engine.mjs ../kimi-code
```

SDK 尚未作为稳定公共 npm 包提供，因此提交固定构建产物。更新版本需重新核对工具/状态兼容性；不要只替换提示词。旧 ACP 原型保留在 `src/acp-prototype.js`，正式插件不启动它。
