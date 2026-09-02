# P2 远端资料库服务契约

P2 将存储分为两个边界：对象存储只保存不可变 revision 文件；元数据服务是团队空间、资产状态、Release Pointer、审批校验与审计日志的唯一事实来源。插件不直接连接数据库，也不在 HTML 内保存任何凭证。

## 必需端点

对象服务（`objectStorageEndpoint`）必须支持：

- `PUT /v1/objects/{encoded-key}`：仅在对象不存在时成功；客户端会发送 `If-None-Match: *`。
- `GET /v1/objects/{encoded-key}`：返回原始文本内容。

元数据服务（`metadataServiceEndpoint`）必须支持：

- `GET /v1/workspaces/{workspaceId}/assets/{assetId}`
- `GET /v1/workspaces/{workspaceId}/assets/{assetId}/revisions/{revision}`
- `POST /v1/library/drafts`
- `POST /v1/library/revisions/preview`
- `POST /v1/library/releases`
- `POST /v1/library/releases/rollback`
- `GET /v1/workspaces/{workspaceId}/assets/{assetId}/release`
- `POST /v1/library/audits`
- `GET /v1/workspaces/{workspaceId}/assets/{assetId}/audits`

`draft`、`preview`、`release` 与 `rollback` 请求均携带 `audit`。服务端必须将状态变更和审计事件放入同一个事务。Release / Rollback 还携带不透明的 `approvalId`，服务端验证其有效性、申请人、团队空间、操作类型和未使用状态后再提交。

## 鉴权规则

身份由 DSH 宿主或 API Gateway 从已验证的会话令牌生成 `WorkspacePrincipal`，而不是由 Agent 工具参数传入。

| 角色 | 读取 | 创建 Draft / Preview | Release / Rollback |
| --- | --- | --- | --- |
| viewer | 是 | 否 | 否 |
| editor | 是 | 是 | 否 |
| admin / owner | 是 | 是 | 是 |

服务端仍必须二次执行相同 RBAC；插件侧检查只为尽早拒绝。审计至少记录用户、团队空间、请求 ID、动作、资产、revision、时间与审批 ID 的不可逆摘要。

## 对象键与恢复

对象键固定为：`workspaces/{workspaceId}/assets/{assetId}/revisions/{revision}/{artifact}`。artifact 包含 `dashboard.html`、`manifest.json`、`model.json`、`quality.json`。上传完成、但创建 Draft 元数据失败的对象应由生命周期/GC 任务在安全保留期后清理，不能覆盖或修改已有 revision。

## DSH 配置示例

```yaml
config:
  libraryAdapter: remote
  objectStorageEndpoint: https://objects.example.internal
  metadataServiceEndpoint: https://workbench-api.example.internal
  objectStorageTokenEnv: WORKBENCH_OBJECT_STORAGE_TOKEN
  metadataServiceTokenEnv: WORKBENCH_METADATA_SERVICE_TOKEN
```

本地集成可临时配置 `developmentIdentity`；生产环境必须向 `createKnowledgeLibrary` 注入由宿主会话生成的 `IdentityProvider`，不能把用户或角色写进 Profile 文件。
