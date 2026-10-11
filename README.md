# DSH Harness Switch

为 DeepSeek Harness 配置模型与 harness 的绑定。

## 开发状态

目标：使用 DSH 原生聊天框和 session 列表，并在同一会话中切换 Kimi 与原生 DeepSeek 模型/harness。原生会话适配正在开发，尚未完成。

当前提交是底层验证版本：通过 ACP 复用本机 Kimi Code 运行时，包含配置面板、连续对话、工具事件、人工权限确认、取消和 Kimi 会话恢复。独立面板用于验证，不代表最终原生集成已经完成。

已在 Windows 上通过 DSH 0.1.2-rc.1 的 subprocess 服务连接 Kimi Code 2.1.1，选择 `kimi-code/k3` 并完成一次真实 API 回复。

## 开发验证

```sh
npm ci
npm test
npm run check
```

`tests/local-smoke.mjs` 是显式运行的本机集成检查，需要将 `DSH_MODULES` 指向安装版 DSH 的 `node_modules`。默认只连接；设置 `KIMI_SMOKE_PROMPT=1` 才发送一次真实模型请求。

真实凭据由本机 Kimi 配置管理，不纳入仓库。测试使用虚构凭据。测试临时目录和依赖目录均排除在 Git 外。

## 参考

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
- [Kimi Code 配置](https://www.kimi.com/code/docs/en/kimi-code-cli/configuration/config-files.html)
- [Kimi ACP](https://www.kimi.com/code/docs/en/kimi-code-cli/reference/kimi-acp.html)
