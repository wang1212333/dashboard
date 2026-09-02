# DSH 模型链路追踪（Phoenix）

工作台已在**宿主侧**接入 Phoenix / OpenInference。每一次通过 `DshModelAnalyzer` 发起的 DSH 模型分析都会产生一条 LLM Span，可查看：

- 关联项目、模型提供方、模型名、温度和最大输出长度；
- 输入数据的行数、字段数、调用状态、异常与端到端耗时；
- 开启本地内容采集后，完整的模型提示词和原始模型输出。

Span 名称为 `dsh-workbench.dashboard-model-analysis`，Phoenix 项目默认是 `dsh-workbench`。该追踪覆盖工作台的“分析数据 / 创建 Plan / 流式运行”模型调用；由 DSH 主会话自身执行的通用工具调用仍由 DSH 宿主负责，当前插件只能在界面中展示其用户可见的会话时间线。

## 本地启用

本项目已在 `.phoenix-runtime` 中安装本地 Phoenix，并已启动在 `http://127.0.0.1:6006`。如服务因重启而停止，可在项目目录执行：

```powershell
.\.phoenix-runtime\Scripts\phoenix.exe serve
```

首次安装所用的环境变量已写入当前 Windows 用户配置；重启 DSH 后生效。若在其他机器部署，在 DSH **宿主进程**环境中配置：

```text
PHOENIX_ENABLED=true
PHOENIX_COLLECTOR_ENDPOINT=http://127.0.0.1:6006
PHOENIX_PROJECT=dsh-workbench
DSH_TRACE_CAPTURE_CONTENT=true
```

重启 DSH，执行一次“上传 CSV → 生成看板方案”。随后在 Phoenix 的 `dsh-workbench` 项目中打开最新 Trace，即可按下列层级查看：

```text
dsh-workbench.dashboard-model-analysis (LLM)
├─ 输入：字段画像、样例和规则建议（本地内容采集开启时）
├─ 模型：provider / model / temperature / max_tokens
└─ 输出：模型返回的模板和字段映射建议
```

若 Phoenix 开启鉴权，再额外配置 `PHOENIX_API_KEY`。可使用 Phoenix CLI 查看最近 Trace：

```powershell
npx @arizeai/phoenix-cli trace list --project dsh-workbench --limit 20 --format raw --no-progress
```

关闭本机服务时，可停止其 Phoenix / Python 进程；下次重新运行 `phoenix.exe serve` 即可恢复。Phoenix 数据库保存在本机运行时目录，由本机服务管理。

## 数据保护与生产建议

默认 `DSH_TRACE_CAPTURE_CONTENT=false`：只记录字符数和运行元数据，不上传 CSV 样例、提示词或模型输出。生产环境请保持默认值，并在 Phoenix 中设置访问控制与保留策略；只有获得数据治理批准后才开启完整内容采集。Phoenix 不可达或初始化失败时，追踪会自动停用，绝不会阻断看板生成。
