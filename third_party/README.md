# third_party — 第三方依赖

本目录存放 auto-ai-article 依赖的第三方项目源码（直接提交，非 git submodule）。

## token-free-gateway

本地 AI 网关：通过浏览器自动化（Playwright）免费调用云端 AI 的 OpenAI 兼容网关。

- **用途**：`ai-article-pipeline` 的"本地发文"模式通过此网关调用 AI 生成文章（见 `src/local-gateway.ts`）
- **启动**：`token-free-gateway.exe` 或 `auto-start.ps1`（默认监听 `http://localhost:3456/v1`）
- **与主项目关系**：本目录源码随主仓库提交（node_modules / exe 已 gitignore）；主项目通过 HTTP 调用网关，**不** import 其代码
- **更新**：从 token-free-gateway 上游拉取最新源码覆盖本目录（保持 .gitignore 忽略 node_modules / exe）
- **惰性加载**：主项目 `executor.ts` 仅在需要本地发文时 `require('./local-gateway.js')`，纯云端站不加载

## 为何直接提交而非 submodule

token-free-gateway 暂无独立远程仓库，直接提交源码保证各站 vendor 同步后即可用。
若后续建立独立仓库，可转为 `git submodule`。
