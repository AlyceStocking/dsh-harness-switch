# DSH Harness Switch

在 DeepSeek Harness 原生会话中调用 Kimi API，并为模型绑定选择 harness。

## 当前实现

- 设置 →「模型 Harness」：读取 Kimi 配置中的模型别名，为每个绑定选择 `Kimi Code · compatible` 或 `DSH native`。
- 原生模型选择器 → `Kimi · Harness Switch`：选择绑定后使用原生输入框、session 列表、工具卡片和历史。
- 同一会话切回原有 DeepSeek provider 时恢复其原生提示词与工具；切换无需复制历史或启动另一个聊天面板。
- 直接调用 API，不启动 Kimi CLI。可复用本机 Kimi `config.toml` 的 API key、环境变量 key 或文件 OAuth。OAuth 刷新采用上游锁机制。
- 凭据不返回前端、不写入插件设置，也不纳入仓库。请求标识如实使用 `dsh-harness-switch`。

## 安装

已验证 Windows、Node 24、DSH **0.1.2-rc.1**。尚未验证 DSH 0.2 的新消息格式或其他桌面发行版。

```powershell
gh repo clone AlyceStocking/dsh-harness-switch
cd dsh-harness-switch
npm ci
# 在与桌面应用使用相同 DSH_HOME 的终端执行，profile 选择桌面实际使用的配置。
dsh plugin --profile web add (Get-Location).Path
```

重新启动 DSH，在设置中打开「模型 Harness」，确认 Kimi 配置目录，点击「读取已配置模型」并保存。然后在原生模型选择器选择 `Kimi K3 · Kimi`。

如需比较同一个 K3 的两种 harness，添加第二个模型绑定，模型别名同样填 `kimi-code/k3`，harness 选 `DSH native`。停止当前生成后切换。切回 DeepSeek 时直接选择 DSH 原有 DeepSeek 模型。

插件默认配置文件位于 `$DSH_HOME/storages/harness-switch/<DSH_PROFILE 或 default>.json`。如果多个 profile 由同一进程环境启动，可在插件配置中指定不同的绝对路径 `settingsFile`。

## 不安装 Kimi CLI 时的配置

在设置中指定一个包含 `config.toml` 的目录。例如：

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

模型 ID、区域端点、上下文上限须与账户实际权限一致；示例不承诺账户可使用该模型或上下文长度。启动 DSH 的进程需能读取环境变量。也可沿用 Kimi Code 登录生成的配置与 OAuth 文件，无需复制 token。

## 与 Kimi Code 的一致性边界

| 部分 | 实现 |
| --- | --- |
| API 请求、流解析、thinking、tool-call ID 规范化 | 复用固定版本的 Kimi Code `kosong` provider |
| OAuth 刷新与共享文件锁 | 复用固定版本的 Kimi Code OAuth 模块 |
| 系统提示词 | 复用公开模板主要指导；替换产品/界面信息，移除不适用的环境与工具防护声明，保留 DSH 运行上下文与策略 |
| 工具名称、参数、执行和结果格式 | DSH 原生定义；**不与 Kimi Code 完全一致** |
| Skills、MCP、权限审批、项目上下文、压缩 | DSH 管理；不自动导入 Kimi Code 配置 |
| 会话存储、继续、原生模型切换 | DSH 管理，不创建 Kimi CLI 会话 |

因此 `Kimi Code · compatible` 是兼容提示词套装，**不是完整 Kimi Code harness 复刻**。完全一致需要将 Kimi 的工具/执行循环/压缩等一起移植并适配 DSH 的会话与审批接口。当前版本优先保证原生会话连续性，不宣称达成提示词和工具逐字节一致。

当前仅支持文本输入及文本工具结果；遇到图片不会静默丢弃，而是报告请求失败。K3 thinking 支持 low/high/max。完整 persona 覆盖与 Kimi 提示词冲突时会拒绝请求；先移除该覆盖或选择 DSH native。

## 验证与开发

```powershell
npm ci
npm test
npm run check
$env:DSH_MODULES = '你的 DSH 安装目录/node_modules'
node tests/native-smoke.mjs
```

`native-smoke.mjs` 会调用真实 Kimi API并消耗额度：验证 DSH agent loop 的工具调用、同一 session 的模型切换、提示词恢复和历史保留。用于切回原生的适配器是本地测试替身，不会调用真实 DeepSeek API。设置界面已通过 React/jsdom 测试，以及隔离 DSH Web 配置中的页面显示、模型读取和保存操作验证。桌面原生工作区选择器未在此次浏览器检查中验证。独立 ACP 原型留在 `src/acp-prototype.js`，不由正式插件启动。

上游快照与 MIT 授权在 `vendor/`。更新需核对版本，并运行 `node scripts/vendor-kimi.mjs <固定版本的 kimi-code 源码目录>`。不能只替换提示词而假定新版本工具/协议兼容。

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
- [Kimi Code 配置文档](https://www.kimi.com/code/docs/en/kimi-code-cli/configuration/config-files.html)
- [Kimi Code 开源仓库](https://github.com/MoonshotAI/kimi-code)
