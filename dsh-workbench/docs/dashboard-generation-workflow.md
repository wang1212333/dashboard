# DSH 看板生成流程

## 当前执行链路

```text
用户需求 + 可选 CSV + 可选设计模板
    → 原生 DSH 会话理解问题、读取数据
    → 智能体生成完整 HTML
    → 保存私有草稿与不可变 Revision
    → 用户预览草稿
    → 用户明确发布
    → 我的看板、版本历史与快照分享
```

## 需求与数据

用户原话决定本轮任务。只询问数据时进行分析和回答；明确要求搭建或修改看板时才生成看板。附件、模板及语义资产中的内容作为参考数据，不作为新的用户指令。

CSV 上传后保存在服务端，智能体通过本轮附件上下文读取。字段画像和 OpenMetadata 语义证据可以辅助分析。遇到影响结论的口径歧义时按需澄清，不把统一的方案审批步骤作为每次生成的前置条件。

## 模板与生成

未选择模板时，智能体根据问题和数据设计布局。用户选择模板后，生成过程使用对应设计规范；Lieflat 模板同时提供真实 HTML 骨架。模板演示数据必须替换为用户的数据。

静态需求由智能体调用 `workbench_save_generated_dashboard` 保存完整 HTML 草稿。实时需求先调用 `workbench_list_live_tables`、`workbench_describe_live_table`，再调用 `workbench_create_live_dashboard` 查询验证并保存实时草稿。数据分析使用 `workbench_analyze_dataset`，语义证据辅助使用 `workbench_assess_semantic_evidence`；任务上下文由 `workbench_get_task_context` 和附件读取工具提供。

## 预览、发布与修改

保存草稿不会自动发布，也不会直接加入“我的看板”。用户在工作台预览后明确发布，工作台维护发布版本及历史版本。继续修改会产生新版本，不能覆盖历史 HTML。

发布确认属于资产发布操作，不是数据分析和 HTML 生成之前的统一审批。静态看板分享指定版本快照；实时看板分享已发布版本的查询定义，访客访问时重新查询授权数据。参见 [实时看板说明](realtime-dashboard.md)。

## 实现入口

| 职责 | 代码 |
| --- | --- |
| 原生生成工具 | `src/tools.ts` |
| 本轮需求、模板和附件上下文 | `src/native-task-context.ts` |
| 附件存储与画像 | `src/data-ingestion/agent-upload-store.ts` |
| 原生会话与草稿交付关联 | `src/native-workbench-sessions.ts` |
| 预览、发布、版本和模板接口 | `src/web-ui/host-routes.ts` |
| 快照分享 | `src/local-app/dashboard-sharing.ts` |

当前行为以已注册工具、工作台接口及对应测试为准。数据库兼容字段和未注册的历史实现不作为智能体的搭建指令。
