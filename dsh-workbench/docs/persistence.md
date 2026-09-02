# PostgreSQL 权威存储层

`migrations/001_core_persistence.sql` 是 DSH Workbench 的业务元数据 Schema。它保存 workspace、成员、会话、可见消息、状态机运行步骤、OMD 语义证据、Plan/Spec/Revision、审批和审计；CSV、HTML、截图和质量报告只保存对象存储地址、SHA-256、大小和 MIME 类型。

## 初始化

1. 创建一个最小权限的 PostgreSQL 数据库用户，并设置服务端环境变量：

   ```text
   DATABASE_URL=postgresql://dsh_workbench:***@postgres.internal:5432/dsh_workbench
   ```

2. 构建插件后执行迁移：

   ```bash
   pnpm build
   pnpm db:migrate
   ```

迁移通过 `schema_migrations` 记录，重复执行安全。迁移只能由元数据服务或受控运维任务执行，不能由浏览器、Agent 工具或看板页面触发。

## 存储分工

```text
浏览器 / DSH Agent
        │
        ▼
元数据服务 ── PostgreSQL：会话、状态机、审批、审计、Plan、Spec、Revision
        │
        └── MinIO / S3：CSV、HTML、Manifest、Model、质量报告
```

`artifacts` 与 `uploads` 只接受对象引用和 SHA-256，不包含文件正文。生产环境应把每个请求的可信 `workspace_id` 放进认证上下文，并在数据库或服务层做 workspace 隔离；不要接受浏览器提交的用户身份或对象 URI 作为授权依据。

## 运行时接口

服务端通过 `createPostgresCoreStore()` 读取 `DATABASE_URL`，得到 `PostgresCoreStore`。它提供创建 workspace/member/session/message/run/step、保存 SemanticContext、Plan/Spec/Revision、对象引用、审批、审计及上传元数据的方法。`createAuditedDashboardRevision` 会在一个 PostgreSQL 事务中同时创建 revision 和 audit event。
