# dsh-workbench

一个面向 AI 工作台的 DeepSeek Harness 看板插件。它将 Agent 收敛到数据理解、语义验证、故事线确认和确定性 HTML 生成。

## 受控看板 Agent 工作流

看板 Agent 不直接生成 HTML。模型负责理解用户意图、数据和语义，并提出受 JSON 结构约束的 `DashboardPlan`；确定性代码根据已确认的故事线和模板生成 HTML。

```text
用户意图 → CSV 数据画像 →（可选）SemanticContext 与数据验证
    → DashboardPlan（自动字段映射、指标、筛选与故事线）
    → 用户确认业务意图与故事线 → 受控模板渲染 → 返回 HTML 与质量报告

所有看板默认采用 `universal-dashboard/v1` 信息架构：语境、全局筛选、3–6 个核心结论、主叙事、行动、探索明细和数据可信度。业务模板只决定字段合同、指标和图表语义，不能省略这条从结论回溯到证据的路径。

视觉风格是 `DashboardSpec.visualContract`，而非模型自由生成的 CSS。该合同包含 `designTemplateId`、受校验的色板、字体和组件 token；确定性渲染器以 CSS 变量实际消费它。未选择风格时记录 `universal-default`；选择 Clickhouse 等风格时，Agent 必须将其转写成 `dashboard-visual/v1` 后再创建 Plan。
```

DSH 工具顺序（默认交付路径）：

1. `workbench_analyze_dataset`：理解上传数据。
2. OpenMetadata 检索与 `workbench_assess_semantic_evidence`：补充字段与指标语义，并与 CSV 验证。
3. `workbench_create_dashboard_plan`：生成自动字段映射、模板、筛选键和故事线。
4. `workbench_confirm_dashboard_plan`：只确认业务意图与故事线。
5. `workbench_build_dashboard`：用确认 Spec 和 Plan 已绑定的原始 CSV 生成 HTML；构建阶段不接受模型重新传入的 CSV。

构建工具不再采用 Draft-first 兜底：没有来自已确认故事线的有效 Spec 时会直接报错，避免把错误推断生成成 HTML。

关于为何不让模型直接输出看板，以及从 Brief、数据画像、语义验证到 HTML 交付的完整职责边界，见 [通用数据看板生成工作流](docs/dashboard-generation-workflow.md)。

## OpenMetadata 语义 MCP

OpenMetadata 是语义与治理证据来源，数据查询服务则只负责计算真实值；两者不能相互替代。插件 Bundle 已自动注册 `dsh-workbench-openmetadata-semantic-mcp`，不需要用户再复制 MCP 配置。连接会在 DSH 启动时检测到只读 Token 后自动启用；Token 缺失时保持禁用，避免以空凭证请求服务：

```text
OPENMETADATA_MCP_URL=https://openmetadata.transsion.com/mcp
OPENMETADATA_MCP_TOKEN=<只读访问令牌>
```

重启 DSH 后，模型可使用 `mcp__openmetadata_semantic__semantic_search`、`get_entity_details` 和 `get_entity_lineage`。只要配置了 Token，插件会在启动时完成 MCP 握手和工具发现；连接失败会明确阻止启动，绝不静默降级。

OMD 处在“数据画像”和“方案生成”之间：Agent 先从用户目标和 CSV 字段形成语义问题，检索候选资产，再逐个读取实体详情，最后调用 `workbench_assess_semantic_evidence`。该上下文和 CSV 验证结果进入 `DashboardPlan`，为自动字段映射、指标和故事线提供依据。OMD 不可用或不完整时，系统使用字段名、类型和非空情况继续构建，并在最终结果中记录限制；MVP 不要求用户逐个确认字段或指标。Token 只能留在 DSH 宿主环境变量中，不能出现在代码、看板 HTML 或 Agent 参数中。

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

启动后，Agent 可发现下列工具：

- `workbench_list_dashboard_templates`
- `workbench_analyze_dataset`
- `workbench_assess_semantic_evidence`
- `workbench_create_dashboard_plan`
- `workbench_confirm_dashboard_plan`
- `workbench_build_dashboard`

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
