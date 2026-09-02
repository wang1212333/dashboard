# DSH Dashboard MVP

一个独立的、最小化的 DSH 看板搭建插件。它只负责从一份 CSV 建立可信的独立 HTML 看板，不包含本地应用、数据库、资产版本库、预览/发布流程、埋点、外部设计模板同步或历史业务实现。

## 保留的最小流程

1. `dashboard_analyze_dataset`：识别数据字段、类型、质量与候选模板。
2. 通过原生 OMD 工具检索字段/指标定义，再用 `dashboard_assess_semantic_evidence` 固化语义证据；OMD 不可用时，退回数据验证并记录风险。
3. `dashboard_create_plan`：生成字段映射、受控指标、筛选器、模板与数据驱动故事线，同时绑定完整 CSV 指纹。
4. 用户确认业务意图和故事线后，调用 `dashboard_confirm_plan`。
5. `dashboard_build_html`：仅使用已绑定的原始数据，校验完整性、最新周期与已知 SKU 口径后返回离线 HTML。

没有 Draft、Preview、Release、版本审批或资产管理步骤。

## 目录

```text
src/
  tools.ts                  # DSH 工具边界与五步状态闸门
  index.ts                  # 插件入口
  data-ingestion/           # CSV 解析、字段画像、源数据指纹与完整性校验
  data-connectors/          # OMD 语义证据契约与评估
  dashboard-agent/          # 字段/指标证据、看板 Plan 与已确认 Spec
  dashboard-build/          # 受控模板、计算、HTML/CSS/交互渲染
  dashboard-export/         # 离线 HTML 安全与结构校验
```

## 不在此项目的内容

- `local-app`、`web-ui`、浏览器页面与会话接力
- 文件系统/远端资产库、修订版本、发布、回滚
- PostgreSQL、迁移、工作台服务、权限审批
- Phoenix Trace、模型调用封装
- 非看板的数据连接器、设计模板 GitHub 同步、封面生成
- 针对旧内容运营、财务、供应链项目的测试与示例产物

## 使用与验证

在 DSH 源工作区安装依赖后：

```powershell
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

安装插件时使用 `cordis.patch.yml`。如果需要 OMD 语义检索，再额外合并 `openmetadata.patch.example.yml`，并通过环境变量提供令牌；令牌不进入对话、Plan 或生成的 HTML。

构建产物是完整、离线、无外部依赖的 HTML。渲染器不会执行模型生成的公式、CSS、HTML 或脚本；模型只可以在受控的故事线模块中编排已有指标和图表。
