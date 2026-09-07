# 线上看板服务

这是独立于 DSH/Jupyter 的 Node 服务，无 npm 依赖。上传的发布快照保存在服务端，作者电脑关机后仍可访问。仅发布 HTML，不上传原始 CSV、对话或本机凭据。首版是持链接访问（默认 7 天，最长 30 天），**不是飞书按人授权**。不要将 Jupyter 的密码或 Token 提供给看板接收者。

## 部署到现有 Jupyter 容器

将本目录上传至 `/home/jovyan/work/user/qiuxia/dsh-online`。Node 20.8.1 可以运行，无需容器内再安装 Docker。

复制 `.env.example` 为 `.env`，填入平台分配的实际 HTTPS 地址。支持独立域名或路径前缀，例如 `https://your-domain/dashboards`。把 `DATA_DIR` 改为 `/home/jovyan/work/user/qiuxia/dsh-online/data`，`PORT` 使用管理员分配的端口。生成随机发布凭据：

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
chmod 600 .env
node --env-file=.env server.mjs
```

前台验证通过后由平台进程管理器启动相同命令，配置自动重启，并挂载备份 DATA_DIR。Jupyter 终端中的前台进程不是重启恢复方案。临时联调可用 `nohup node --env-file=.env server.mjs >service.log 2>&1 &`；正式运行仍需要平台守护进程。

请管理员将 HTTPS 入口转发至该容器的 PORT，保留路径前缀；参考 nginx.conf.example。平台入口不应要求接收人输入作者的 Jupyter 凭据。转发配置完成后访问 `PUBLIC_URL/healthz` 应返回 `{"status":"ok"}`。

## 独立 Docker 部署

宿主机有 Docker Compose 时，在此目录配置 `.env`（DATA_DIR 保持 `/data`），运行 `docker compose up -d --build`。端口仅绑定宿主机回环地址；外部通过 HTTPS 反向代理访问。命名数据卷持久化，不能用 `docker compose down -v` 清除。备份卷数据及配置，恢复后再启动。当前文件存储只支持单实例。

## 本地工作台接入

本地 DSH 进程设置以下环境变量并重新启动：

```text
DSH_ONLINE_URL=平台分配的完整 HTTPS 基础地址
DSH_ONLINE_ADMIN_TOKEN=服务端 ADMIN_TOKEN 的相同值
```

本地新增 POST `/api/dsh-workbench/dashboards/{assetId}/publish-online`（独立本地服务用 `/api/dashboards/{assetId}/publish-online`），JSON 为 `{"confirmed":true}`。只上传 library.getRelease 返回的正式发布版本，不会把最新草稿上传。返回 url、token、expiresAt 与 access。密钥只由本地后端使用，不进入浏览器。现有发布按钮与分享弹窗的完整产品交互未在此部署包中替换。

## 管理 API

所有 `/api/*` 接口要求 `Authorization: Bearer ADMIN_TOKEN`，不可将此凭据嵌入网页。以下地址均相对 PUBLIC_URL。

| 接口 | JSON / 用途 |
| --- | --- |
| POST /api/releases | assetId、revision（rev-0001）、title、html；同版本同内容可重试，不同内容返回 409 |
| POST /api/shares | assetId、revision、days（1–30）；返回持链接访问地址 |
| DELETE /api/shares/{token} | 撤销该链接；后续页面与内容请求均失效 |
| GET /api/feishu/config | 应用配置状态，仅返回 App ID 与验证时间 |
| POST /api/feishu/config | appId、appSecret；验证凭据及机器人能力后保存 |
| POST /api/feishu/send | token、receiveIdType（email）、receiveId（企业邮箱）、requestId、可选 note |

本机工作台：我的看板 → 分享 → 配置飞书应用。应用需启用机器人、开通 `im:message:send_as_bot`，发布并设置同事可见范围。保存验证不会发送消息；实际消息权限与接收范围在发送时校验。配置文件保存在 DATA_DIR/feishu-private.json，不返回浏览器。点击发送卡片才执行发送，沿用已有链接及有效期；链接撤销后已发送卡片的访问入口同步失效。失败重试使用同一请求编号，已确认成功的请求持久化去重；不确定结果超过 55 分钟需人工核实后重新发起。

飞书由应用机器人发送，需配置 FEISHU_APP_ID/FEISHU_APP_SECRET，开通发送消息权限并发布应用。群聊要求机器人可发送到该群；个人需在可用范围内。requestId 每次新的逻辑发送生成一次，网络重试沿用原值，使用飞书 uuid 去重。接口不会因发布而自动发消息，需独立调用发送。该能力尚未用真实企业应用联调。

## 发布内容约束与验收

页面在 sandbox 中运行，禁止访问线上管理接口或实时数据源。HTML 内嵌数据和脚本可用；支持 jsDelivr/cdnjs/unpkg 脚本。相对路径资源、本机 three 模块、其他 CDN 和实时 fetch 需先打包为自包含内容或增加经过评审的资源策略，不能承诺现有所有模板无需调整。只读表示无编辑服务，不表示禁止下载或复制数据。

运行 `node --test server.test.mjs`。上线还需用实际看板验证图表与筛选、从同事设备打开、撤销/过期、重启数据恢复以及真实飞书卡片。转发链接可以传递访问权；飞书登录、个人 ACL、通讯录选择和“别人分享的”属于下一步接入项。

本机也支持复用飞书 CLI：在服务环境中设置 `LARK_CLI_SCRIPT` 为已安装 CLI 的 `scripts/run.js` 绝对路径，通过受保护的配置接口提交 `{ "mode": "cli", "appId": "现有应用编号" }`。服务验证当前应用及机器人身份，仅保存应用编号和模式，不导出系统凭据库中的密钥。发送时固定使用 bot 身份，并核对应用编号，防止 CLI 切换应用后误发。该方式依赖同一 Windows 用户与本机 CLI 安装，不能直接迁移到 Docker；容器部署请使用应用凭据模式。

接收人选择已升级为通讯录搜索：输入姓名或工号关键词，从候选列表中明确选择同事，再发送卡片。搜索使用 CLI user 身份及其可见范围，发送使用 bot 身份和所选 open_id。姓名搜索已实测；数字关键词可返回候选，但接口未返回完整工号字段，不能保证数字查询为工号精确匹配。搜索失败不会回退要求输入 App Secret，不自动选择首个同名结果。当前为单人选择，不包含群搜索或多选。
