# DSH 实时看板最小闭环

## 用户流程

在 DSH 看板工作台选择工作区，用对话提出实时看板需求。智能体发现授权表、核实字段与指标口径，调用实时草稿工具；服务端实际查询成功后保存草稿。用户使用现有交付卡预览、发布，随后在“我的看板 → 分享”生成实时链接。

示例：请用已授权的进销存日表，按品牌展示最近指定期间的发货、激活和期末库存，每 5 分钟刷新，并显示每日趋势和国家排名。

原生工具：workbench_list_live_tables、workbench_describe_live_table、workbench_create_live_dashboard。静态需求仍使用原来的 HTML 生成工具。实时工具负责生成查询定义和页面，不依赖模型在每次刷新时重新生成 SQL。

## 所选模板与实时页面

实时生成同样读取本轮 `workbench_get_task_context` 中的所选模板规范。智能体按规范生成自包含 HTML，将 `html` 与查询 `spec` 一起提交实时工具。工具不再为原生对话强制套用固定页面；未选模板时由智能体按用户需求设计。

页面定义 `window.renderDSHLive(data)`，从 totals/trend/ranking 的 m0、m1 等字段更新图表；保留可见的 `dsh-live-status` 和 `dsh-live-refresh` 元素。`src/live-dashboard/page.ts` 注入统一刷新适配器，负责首次查询、定时刷新、手动刷新、后台暂停和状态提示。页面只负责展示，不自行连接 MCP 或持有凭据。实际渲染仍须浏览器验收，结构检查不能证明生成的 JavaScript 和图表一定正确。

CSS、脚本和 SVG 内联，不依赖 CDN、远程字体或相对资源。模板中的外部图表库需改写为自包含图表实现，保留设计语言；本版不承诺任意第三方模板可以不经适配直接执行。

预览、发布和访客页使用该版本保存的同一份 HTML。适配器根据访问路径选择本机查询入口或令牌保护的访客入口，分享服务不再重绘页面。后续新草稿不改变旧分享链接的版本。旧固定布局版本仍可使用，升级设计需生成新版本。

DSH 内嵌浏览保留 `sandbox="allow-scripts"`，其浏览器来源为 `null`，不能直接调用本机查询接口。服务在本机页面响应中附加查询桥接脚本（不修改保存的设计）；工作台验证消息来自实际挂载的看板 iframe，再根据该 iframe 的资产与版本查询。消息不能指定其他查询地址或数据范围。新标签页和访客分享仍走各自原有入口，不放开 `null` 来源的跨域权限。

## 当前支持范围

- 当前配置的 MCP 网关授权表，不写死具体业务表。网关类型适配 PostgreSQL 和 StarRocks。
- 单表、1–6 个指标，sum/avg/min/max/count/count_distinct/latest_sum 聚合；明确记录字段、标签、单位与口径说明。
- 可选日期趋势、一个分类维度排名（前 20）、最多 8 个 eq/gte/lte 筛选条件。
- 刷新频率为 60、300、900 或 3600 秒；页面隐藏时暂停，重新显示时查询。
- 筛选随不可变版本保存；访客不能扩大范围。调整筛选或指标通过对话生成新版本。
- 未支持跨表关联、任意计算表达式、订阅通知和数据库事件推送。其他网关输出格式需适配。表名与字段名当前要求 ASCII 标识符，无法解析结构时明确拒绝。

“任意已授权数据”在本版指上述契约范围内的授权单表，不代表所有复杂数据形态均已覆盖。

## 服务端配置

设置 DSH_LIVE_MCP_URL 与 DSH_LIVE_MCP_TOKEN；也可配置 DSH_LIVE_CONFIG_FILE，指向只有服务端读取的 JSON：

```json
{"url":"https://YOUR_GATEWAY/mcp","token":"YOUR_TOKEN"}
```

默认配置位置为用户目录 `.config/dsh-workbench/live-source.json`。本次本机配置由既有 MCP 授权迁移，真实凭据不写入仓库和页面。当前使用一个服务端授权身份；没有企业多用户凭据隔离。网关仍负责每次查询的表及行权限，分享者应确认数据受众。

## 查询与版本

数据定义保存于资料库 live 目录，并与 assetId/revision 关联。创建时及每次查询都验证授权表、字段和数值类型；SQL 由受控字段与枚举聚合生成，浏览器无任意 SQL 接口。趋势行数达到 5000 时拒绝可能截断的结果。NULL 不补零；sum/count 趋势与汇总核对。各 SQL 不是数据库同一事务快照，校验不一致拒绝替换数据。

每个进程最多两路 MCP 查询执行，复用客户端及 HTTP 连接；相同绑定与授权上下文的执行中请求合并，最多 8 组在途查询。查询失败丢弃客户端，不自动重放。页面请求失败保留旧值及原查询时间。

资料库 live/last-timing-*.json 保存每个绑定最近一次成功查询的阶段等待/执行耗时，不含 SQL、令牌或业务结果。当前没有历史慢查询报表。

## 实时分享

独立只读监听端口默认 4340，在 DSH 进程中启动和关闭。DSH_LIVE_SHARE_PORT、DSH_LIVE_SHARE_HOST 可配置监听，DSH_LIVE_SHARE_URL 可指定外部访问地址（URL 路径暂要求根路径，反向代理需保留 /s 路径）。本机使用内网 HTTP，并放行 Private / LocalSubnet 的 TCP 4340。正式部署需提供 HTTPS 及稳定域名入口。

实时分享与现有静态 18087 快照服务分开，生成链接时按所发布版本自动分流。访客不需要 DSH 管理权限，必须持有效令牌；每次查询前后检查到期、撤销、版本状态及数据源配置指纹。链接固定到已发布版本，数据持续重查。删除资产后访问失败。凭据变更使旧绑定和链接失效。分享授权持久保存，普通服务重启后仍有效。

令牌仅首次生成时返回；磁盘保存摘要和管理 ID。关闭分享窗口后可管理、撤销旧链接；需要再次复制时生成新链接。有效期支持 1/7/30 天。实时链接已接入飞书机器人发送按钮；已登记部署的同一版本优先发送服务器链接，未部署版本使用内网链接。服务器 Jupyter 入口不使用上述令牌有效期，卡片会标明登录要求。详情见 [实时看板飞书分享](live-feishu-sharing.md)。撤销不能收回访客已经看见或保存的数据。

## 代码入口

- src/live-dashboard/mcp.ts：发现、描述、MCP 客户端、并发与请求合并。
- src/live-dashboard/service.ts：定义校验、SQL 构建、真实预览、版本绑定、持久分享授权。
- src/live-dashboard/view.ts：实时查询页面、指标、趋势、排名及错误状态。
- src/live-dashboard/sharing.ts：令牌保护的实时访客服务。
- src/tools.ts / native-task-context.ts：原生对话工具与需求路由。
- src/web-ui/host-routes.ts：现有预览发布流程、查询接口与分享分流。

单进程本机最小版，不包含多副本共享锁、企业身份体系、正式部署守护和容器网关配置。Jupyter 部署预览不是本链路的依赖。

## 本次验证（2026-09-10）

- 全量自动测试：33 个文件、130 项通过；TypeScript 检查和构建通过。
- 真实网关：发现当前身份的 35 张授权表；分别对日表和月表完成定义、真实查询与校验，覆盖日期筛选和无筛选请求。
- 实际 DSH 对话：生成 `dsh-realtime-acceptance / rev-0001`，浏览器预览和手动刷新成功，通过原生发布操作进入“我的看板”。
- 实际访客链路：生成实时分享链接、打开页面、查询真实数据成功；撤销后查询返回 403。测试链接已撤销，验收看板保留。
- 验证记录：项目根目录 `deliverables/dsh-live-e2e-result.json`；截图 `deliverables/dsh-live-conversation.png`、`deliverables/dsh-live-share-verified.png`。

以上验证使用当前服务端授权，不能等同于所有数据源方言、所有表结构或企业多用户权限隔离均已验证。

### 模板复用验证

新增测试覆盖缺失渲染契约的页面拒绝、访客 HTML 与发布版完全一致、新草稿不影响旧分享、查询与撤销；实时模块共 8 项通过。全量运行 133 项，其中一项旧上传测试在并发运行时超时，单独重跑该文件 14 项全部通过。

实际 DSH 对话使用所选 `lieflat-r04` 的完整模板规范生成 `rev-0003`；人工验收后修正无依据的跨指标比值及排名范围文案，并完成手机响应式重排，保存为 `dsh-realtime-acceptance / rev-0006`。原查询服务与数据范围保留。生成契约同步补充不得推导不同口径的转化率、不得将前 20 项冒充全量排名的要求。这些提示不能替代发布前的指标与视觉验收。

本轮记录位于项目根目录 `deliverables/dsh-template-conversation-evidence.json`，发布分享验收结果为 `deliverables/dsh-template-e2e-result.json`。


## 新生成实时看板：点击查看 SQL

生成工具现在必须同时提交 html、spec 和 provenance。每个图表、业务数字及表格数值区域使用 data-sql-source 指向 provenance.elements 中的稳定 ID；统一运行组件提供无图标的点击/键盘打开 SQL 抽屉。查询字段、查询阶段和前端计算说明在保存前校验；所有业务指标必须至少被一个映射覆盖。生成器仍须正确标注每个展示区域，校验不能证明任意前端计算的业务语义。

SQL 与数据源方言随新版本固定保存；后续刷新使用同一 SQL，并继续校验授权与表结构。文件存放于资料库 assets/<assetId>/revisions/<revision>/queries/，包括 totals.sql、可用的 trend.sql/ranking.sql 和 provenance.json。凭据不写入页面或归档。旧版本不自动迁移。

抽屉展示实际执行 SQL、字段高亮和计算说明，支持复制。动态指标切换可用 data-sql-fields 指定已声明字段的子集，data-sql-context 展示当前筛选状态。查看 SQL 不触发额外查询。工作台预览与独立页面使用相同组件；分享接口剔除 sqlProvenance，默认不开放 SQL 查看。

验证：137 项测试通过，包括映射缺失/错误拒绝、发布版本固定、分享不返回 SQL。真实数据验收草稿为 sql-inspector-acceptance/rev-0001。服务代码已编译。用户再次授权后已重启 DSH，3080 与 4340 正常监听；真实服务无响应拦截的浏览器验证已通过：数字、图表、表格点击，字段高亮、键盘、刷新及手机抽屉。


## 实时生成诊断工具

新增 workbench_live_capabilities、workbench_preflight_live_dashboard、workbench_trial_live_query、workbench_live_diagnostic。生成路径为能力查询→spec预检→真实试运行→HTML/provenance完整预检→保存。预检不执行业务查询；试运行与保存共用执行函数，结果只返回每阶段最多3条样本，不创建看板。

来源映射失败返回错误码、stage、path、elementId、actual与expected，并明确尚未执行查询。query应是totals/trend/ranking中的单个值；fields使用m0等返回别名。执行失败指出queries.totals/trend/ranking及实际SQL。诊断记录位于资料库live/diagnostic-<runId>.json，按当前数据源凭据范围校验；不保存凭据。成功记录仅存操作及耗时，失败记录保存定位信息。

模型指令：同类错误修复一次仍重复时读取诊断，不无依据猜测日期转换，不反复重写完整页面。该重试规则属于指令约束，并非运行时硬限制。

验证：141项测试通过；销售表dm.dm_fin_sales_detail_ai在202608范围真实试运行成功，文本part_ym与COUNT DISTINCT均可用。后续已补齐日期范围与单选的服务端交互筛选（见下节）；多维独立排名、级联和明细分页仍未支持，不能宣称已覆盖完整复杂销售看板。

### 预检计划与断点恢复

完整调用 `workbench_preflight_live_dashboard(spec, provenance, html)` 后，服务端持久保存材料并返回 `planId`。`workbench_create_live_dashboard` 现在仅接受 `planId`、`assetId`；旧会话应先重新完整预检一次，再使用新签名。仅含 spec 的预检与试查询接口不变。

计划绑定原生会话与数据授权。同一计划重复提交、同一进程并发提交或重启后再次提交，返回原草稿；不能通过替换 assetId 创建副本。修改页面或配置需重新预检生成新计划。

`workbench_live_plan_status(planId)` 提供 ready/saving/saved 状态。saving 表示保存曾开始但没有可靠记录最终结果，必须人工核对诊断与资产，不能自动重放。该保守策略避免落盘失败后重复生成版本；不提供未经核对的自动解锁。

计划保存按当前单服务实例串行化；不支持多个进程同时向同一 libraryRoot 写入计划。成功返回 deliveryStatus=saved 和预览地址，提示模型结束该看板任务，不强制终止仍有其他看板未完成的整个会话。

### 通用页面筛选（2026-09-14，能力版本3）

Agent 根据每个数据集的授权字段、字段类型和业务口径声明 `spec.interactiveFilters`，不固定为国家或日期。页面保留 `dsh-live-filters` 容器，由运行组件提供控件。最多16项，`filters` 为始终保留的固定范围，运行时条件以 AND 追加；同字段的多选值用 IN。

| 类型 | 配置 | 行为 |
| --- | --- | --- |
| select / multiSelect | `options:[{label,value}]` 或 `dynamic:true` | 静态最多500选项；动态查原表DISTINCT、搜索、每页50项。多选最多50值 |
| dateRange | `min,max,storageFormat?` | DATE默认date；timestamp使用次日零点排他结束，覆盖结束日全部时间；文本支持YYYY-MM-DD/ YYYYMMDD |
| monthRange | `min,max,storageFormat` | 边界和选择为YYYY-MM；源字段格式明确YYYYMM、YYYY-MM或YYYY-MM-01，支持匹配的文本或整数列 |
| numberRange | `min?,max?` | 数值上下限，可仅填写一端；聚合前筛选源表记录，不是对汇总值做HAVING |
| text | `match:equals/contains/startsWith` | 最多200字符，按源数据库大小写规则；百分号和下划线按普通文本匹配 |
| boolean | 无额外配置 | 真、假、不限；仅限真实布尔列，整数标志用单选 |
| null | 无额外配置 | IS NULL / IS NOT NULL / 不限；空字符串与NULL不同 |

通用字段为 `id,label,field,type,defaultValue?`。动态单/多选可声明 `dependsOn:[父筛选ID]`；依赖须存在且不能循环。选项查询使用固定范围及所有祖先条件，改变父条件会清空后代选择并重新加载。候选值来自原表，不从排名Top20推断。选项按原值编码传输，避免空字符串或特殊字符被MCP文本表格漏掉。

日期格式须先核实，不对原字段自动强制转换。带时区时间戳要求明确已核实的 `utcOffset`，当前只支持固定偏移，未自动处理夏令时地区。清空日期/月/数值选择仍保留声明的边界。

#### 请求与一致性

运行组件使用 POST 到原查询路由，请求体为 `{filters:{id:value}}`；选项请求为 `{option:id,filters:{...},search:'',cursor:0}`。保留旧版GET兼容。请求最多64KB，选项分页最大offset10000，可通过搜索缩小范围。页面不能提交SQL、表名或字段表达式。

预览的MessageChannel仅允许请求其自身版本，支持受控并发，不放宽iframe沙箱。查询合并键包含授权范围、绑定和规范化筛选；多选排序去重，不同条件不会串用。成功返回 `appliedFilters` 和本次SQL，页面、SQL抽屉及自动刷新使用相同已应用条件。失败保留上次成功数据并明确标注。网关明确返回0行、无表头时视为空结果，页面应清除旧图。

分享沿用发布版本、有效期、撤销和数据源授权校验；POST仅用于只读查询/选项，默认不返回SQL。不要通过分享绕过数据源授权。

#### 验证与仍存在的限制

见 `../deliverables/general-filter-acceptance`。本次新增8种筛选类型和动态选项级联；仍只有汇总、趋势、单维排名三种查询阶段，排名Top20、1–6指标及原有刷新间隔限制保留。任意SQL、多表关联、明细分页、多维独立排名和专用同比环比并未实现。

真实测试中，部分数值条件查询及销售明细表的查询收到上游安全网关HTTP405拦截；这是仍未解除的外部阻塞，不宣称所有已授权表均已端到端通过，也不改写请求绕过拦截。管理员需核对网关策略。日期/数值/布尔的类型校验和SQL生成有自动测试，跨所有表/所有方言的真实执行不在现有证据范围内。

文本函数依据：[PostgreSQL字符串函数](https://www.postgresql.org/docs/15/functions-string.html)、[StarRocks INSTR](https://docs.starrocks.io/docs/sql-reference/sql-functions/string-functions/instr/)。
