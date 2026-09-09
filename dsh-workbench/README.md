# dsh-workbench

一个面向 AI 工作台的 DeepSeek Harness 看板插件。默认让 DSH Agent 直接基于用户目标与 CSV 自由生成完整看板；旧的受控工作流保留为兼容模式。

## 默认：原生 DSH 自由生成

网页工作台的默认链路不再要求业务模板 ID、字段映射、Plan、人工确认或 `DashboardSpec`：

```text
用户目标 + 完整 CSV
    → 当前 DSH 模型自主分析、设计并生成完整 HTML
    → 保存为不可变 Revision → 返回可预览看板
```

未选择模板时，模型根据用户问题和原始数据自主设计。用户在资料库中明确选择模板后，生成请求会携带所选模板的设计规范；Lieflat 模板同时携带真实 HTML 骨架，然后保存完整 HTML。

旧的 Plan / Confirm / Spec / 确定性模板实现不再向 DSH Agent 注册；它们仅作为历史代码和已有资产的兼容基础留在仓库与 Git 历史中。

## OpenMetadata 语义 MCP

OpenMetadata 是语义与治理证据来源，数据查询服务则只负责计算真实值；两者不能相互替代。插件 Bundle 已自动注册 `dsh-workbench-openmetadata-semantic-mcp`，不需要用户再复制 MCP 配置。连接会在 DSH 启动时检测到只读 Token 后自动启用；Token 缺失时保持禁用，避免以空凭证请求服务：

```text
OPENMETADATA_MCP_URL=https://openmetadata.transsion.com/mcp
OPENMETADATA_MCP_TOKEN=<只读访问令牌>
```

重启 DSH 后，模型可使用 `mcp__openmetadata_semantic__semantic_search`、`get_entity_details` 和 `get_entity_lineage`。只要配置了 Token，插件会在启动时完成 MCP 握手和工具发现；连接失败会明确阻止启动，绝不静默降级。

OMD 是可选的语义参考。Agent 可以自行检索并采用其中的定义、术语和血缘，也可以完全基于用户的目标与 CSV 完成看板；OMD 是否可用不会阻断生成。Token 只能留在 DSH 宿主环境变量中，不能出现在代码、看板 HTML 或 Agent 参数中。

> 安全建议：为插件单独签发权限最小化的只读服务 Token；不要使用个人管理员 Token，也不要把 Token 打进发布包。若个人 Token 曾出现在聊天、日志或代码中，请立即在 OpenMetadata 中撤销并重新签发。

此外，`src/dashboard-export` 与 `src/data-connectors` 提供离线 HTML 校验、字段语义和只读查询约束。详见 [`docs/reuse-map.md`](docs/reuse-map.md)。

## 当前边界

- 默认只读；`allowDevWrites: false` 时所有写操作都会被拒绝。
- `LocalWorkbenchService` 仅用于本地开发和测试，不能用于生产。
- P2 的远端资料库已提供对象存储与元数据 REST 适配器；服务端仍必须完成身份、RBAC、审批、审计与 revision 校验。

## P0：本地 CSV 到离线看板

P0.5 已提供一条无 MCP 依赖的真实执行链路：标准 CSV → 数据质量检查 → 指标计算 → 模板化 Dashboard Model → 单文件离线 HTML → 导出校验。

必填列为：`date, category, planned, published, views, conversions, revenue`。数值必须非负，日期采用 `YYYY-MM-DD`；含错误的行会进入质量报告，无有效行或缺少列时会直接中止。

```bash
pnpm build:dashboard
pnpm dashboard:run -- fixtures/content-weekly.csv outputs/content-operations-dashboard.html --asset-id content-ops-weekly --title "内容运营周看板"
```

生成的页面不依赖网络、CDN 或外部图表库，可直接双击打开。一次性导出不会再在 HTML 同目录写入 Manifest sidecar；需沉淀资产、质量报告和可回溯版本时，统一使用下方的 P1 资料库命令。`fixtures/content-weekly.csv` 是端到端基准数据；后续接入 MCP 时，只需将同样的数据契约作为查询结果的输入。

## P1：统一资料库资产生命周期

`FilesystemKnowledgeLibrary` 将 sidecar 产物替换为按资产组织的本地资料库；每个 revision 都是不可变目录，包含 HTML、Manifest、质量报告、数据模型和 revision 元数据。它是云端对象存储 / 数据库适配层的本地实现，不将存储细节泄漏给构建器。

```bash
# 创建 rev-0001 HTML 资产
pnpm library:run -- build --library outputs/library --asset-id content-ops-weekly --input fixtures/content-weekly.csv --title "内容运营周看板"
```

每次构建生成一个不可变 HTML revision；新 revision 不会覆盖旧 HTML。工作流不再包含 Preview、Release、发布审批或发布指针。

### 本地网页上传 CSV

单机体验可启动本地导入页；选择 CSV 后会先分析字段、预览前五行、按规则推荐模板并由用户确认字段映射，随后直接生成并打开 HTML 看板。确认过的映射随 revision Manifest 一同保存，文件和生成结果只保存在本机资料库。

```bash
pnpm build:dashboard
pnpm local:app -- --library outputs/local-app-library
```

打开命令打印的 `http://127.0.0.1:4317`。最大文件为 20 MB；当前内置 `内容运营` 和 `财务利润` 两类模板。财务模板适用于每行包含期间、收入/成本/利润及可选部门、项目或产品维度的明细表；Excel 文件请先另存为 CSV。

### 设计风格模板库

资料库 → 模板库已内置 Lieflat Charts 的 12 套整页报告和 6 类图表/交互模板，支持分类、搜索、真实预览、应用与取消。报告默认中文，英文正本也随包提供。所选模板会传入原生智能体消息和本地生成请求，模板中的演示数据必须替换为用户的真实数据。

来源版本：`larashero3-dotcom/lieflat-charts@eace082a317b696c5570c25826a53a7fa113e984`。资源与许可证保存在 `src/design-library/lieflat-assets`，构建时复制到发布目录，不依赖个人 Codex 技能安装目录。Lieflat 使用 PolyForm Noncommercial 1.0.0，商业使用须取得作者许可；第三方图表库和字体保持各自许可。部分交互预览依赖 CDN。

封面由原始模板渲染，可运行 `node scripts/render-lieflat-covers.mjs` 重新生成，再执行构建。生成链路、离线目录、预览隔离与完整源模板传递由 `tests/lieflat-templates.spec.ts` 验证。

工作台导航中的“模板库”提供 VoltAgent `awesome-design-md` 的公开 `DESIGN.md` 风格参考。首次打开只同步固定仓库的目录；用户选择某条目后才下载正文到本地资料库缓存，并在本次看板生成时作为视觉规范注入模型提示。缓存记录来源 URL 和内容 SHA；该内容仅用于色彩、排版、组件和响应式规则，不能作为品牌授权、商标或图片素材的替代品。GitHub REST 配额受限时会自动从该仓库公开目录页读取目录，保证常规本地部署可用。

## P2：团队空间、远端资产与审计

`WorkspaceKnowledgeLibrary` 是 P2 的生产资料库适配器：HTML、Manifest、Model 和质量报告写入不可变对象存储；资产、revision 状态与审计写入元数据服务。它基于宿主提供的身份，而不是 Tool 参数；团队权限控制应覆盖读取、创建和更新 HTML revision。

远端配置默认不启用，避免在没有服务端与凭证时误写入。启用方式、REST 端点、事务/审计要求和对象键规范见 [`docs/p2-service-contract.md`](docs/p2-service-contract.md)。生产环境需要将已验证的 DSH 会话注入 `IdentityProvider`；`developmentIdentity` 仅用于本机冒烟测试，绝不能作为生产身份来源。

### PostgreSQL 权威元数据

P2 的权威业务状态现已提供 PostgreSQL Schema 与服务端仓储：会话、消息、状态机运行步骤、OMD 语义证据、Plan/Spec/Revision、对象引用、审批、审计和上传元数据不再依赖浏览器 `localStorage` 或进程内 `Map`。CSV、HTML 和报告仍应保存到 MinIO/S3；数据库只存对象地址、SHA-256、大小和 MIME 类型。部署、迁移和服务端使用方式见 [`docs/persistence.md`](docs/persistence.md)。

## 本地开发

```bash
cd dsh-workbench
pnpm install
pnpm test
pnpm typecheck:core
```

`pnpm build` 与完整的 `pnpm typecheck` 需在 DeepSeek Harness 的 pnpm
workspace（或已经解析 `@deepseek-ai/cordis` 和 `@deepseek-ai/dsh-tools` 的环境）中执行。Harness 当前预览版的部分内部包并不发布到公共 npm；本包在 `dshRuntime.requires` 中明确标注它们，但不让公共 npm 安装过程解析这些运行时包。

## 在 DSH 开发环境加载

先构建插件，然后创建一个只供本机使用的 overlay（路径必须是绝对路径）：

```yaml
# local-workbench.patch.yml
- insert:
    - id: dsh-workbench-local
      name: 'E:/DSH数据看板搭建项目/dsh-workbench/dist/index.js'
      config:
        workspaceId: local-demo
        allowDevWrites: false
```

```bash
pnpm dsh web --patch ./local-workbench.patch.yml
```

启动后，Agent 可发现原生生成工具，以及可选的数据画像和语义证据工具。

## 打包为 DSH Bundle

本包的 `package.json` 已声明 `dsh.bundle`。发布为 npm 包或用 `pnpm pack` 生成 tarball 后，可安装到指定 DSH Profile：

```bash
dsh plugin --profile demo add ./dsh-workbench-0.1.0.tgz
dsh --profile demo --dump-config
```

不要直接发布带 `allowDevWrites: true` 的 bundle；写操作必须由宿主或 API 网关签发真实审批凭证。

## 两个 MCP 服务预留

`mcp/cordis.mcp.template.yml` 预留了两个默认禁用的 Streamable HTTP MCP：

- `workbench_metadata`：数据产品、指标定义与资产关系；工具名空间为 `mcp__workbench_metadata__*`。
- `workbench_data`：表描述与受控只读业务查询；工具名空间为 `mcp__workbench_data__*`。

将模板的两条配置复制到目标 DSH Profile 的 `cordis.patch.yml`，配置环境变量后再移除 `disabled: true`。不要把 URL、Token 或 Authorization header 写入本仓库、HTML、Tool 参数或 Agent 提示词。连接器名与预期工具名在 `src/data-connectors/mcp-contracts.ts` 中统一维护。

配置检查：

```bash
dsh --profile web --dump-config
```

确认 MCP 连接成功后，模型可看到形如 `mcp__workbench_metadata__search_metadata` 和 `mcp__workbench_data__query_data` 的原生工具。真实服务的 raw tool name 若与预期不同，应只更新 `mcp-contracts.ts` 与适配层，不改变业务策略层。
