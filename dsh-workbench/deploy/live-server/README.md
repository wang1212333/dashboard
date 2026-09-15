# DSH 通用实时看板服务器

工作台支持任意已发布且数据源授权匹配的实时看板部署到现有 Jupyter 容器。访客查询不经过本机 DSH。当前入口要求公司网络及已有 Jupyter 登录权限。

## 使用流程

1. 在 DSH 预览后点击“发布看板”，将自动继续服务器部署。
2. 服务器校验与回执登记完成后才显示发布成功；失败保留“待完成服务器发布”，同一发布按钮可重试。分享窗口保留单独部署作为旧看板补齐和维护入口。
3. 如提示登录，在弹出窗口完成现有 Jupyter 登录；工作台不保存 Jupyter 密码。
4. 服务器真实查询校验通过后，固定版本链接自动回写工作台。
5. 已发布看板从“我的看板”打开时优先使用服务器链接；分享 → 发送到飞书 → 选择接收人 → 预览 → 发送。

发布新版本后重复部署；旧版本链接保留原有查询范围。数据按页面设定的周期重新查询，日期范围由该版本和用户筛选决定，不擅自改为滚动日期。没有访客时不主动定时抓取。静态 CSV 看板沿用静态分享，部署不会把静态结果变成实时查询。

## 运行位置与验证

- HTTPS 根入口：https://bigdata-ai-docker-container2.transsion.com/static/dsh-live-server/
- 每版页面：<assetId>/<rev-xxxx>.html；旧 TECNO 的 dsh-realtime-acceptance.html 保持 rev-0006。
- 容器持久目录：/home/jovyan/work/dev/dsh-live-server。
- 查询和部署服务：容器内 127.0.0.1:4341，由已认证 Jupyter 内核桥接。
- 本机连接：~/.config/dsh-workbench/server-deployment.json，仅域名及服务器 Ed25519 公钥。
- 自动发布登记：~/.config/dsh-workbench/server-publications.json。
- 数据源和签名私钥只在服务器 private/，目录 700、文件 600，不在部署包、链接、卡片或 HTML 中。

服务器验证发布状态、数据授权指纹、版本和绑定归属，重新编译 SQL 并真实查询。回执包含请求编号、HTML/版本摘要和服务器签名，本机校验后才登记链接。失败可重试，同版本不同内容拒绝覆盖。不同看板和版本独立存储。

HTML 在无同源权限的 iframe 中运行，只能请求当前固定看板的受控查询。白名单内常用 ECharts、Chart.js、PapaParse 依赖首次下载后内嵌，后续使用服务器缓存；未知外部脚本拒绝部署，需先内嵌到发布 HTML。

## 维护与恢复

在 dsh-workbench 目录执行 node deploy/live-server/build.mjs <输出目录> <资料库目录> 可构建通用运行包，无需指定看板 ID。升级时保留服务器 private/、data/、已有 public/、vendor/ 和进程状态，先备份代码；只重启经过命令行确认的本应用进程。

Python 桥每次查询先检查服务，进程退出时下一次查询重新启动；文件锁防止重复启动。专用内核失效时页面重试会重新发现/创建。容器重建后需恢复 static 符号链接并执行 install.py；尚未验收容器重建，不是平台级守护。

没有 Jupyter 权限的普通同事仍需管理员配置专用只读入口或企业登录代理。现有 IP/域名通向 Jupyter，发送飞书卡片不会赋予访问权限，不应向普通查看者分发 Jupyter 密码。

## 验收

见 deliverables/generic-live-chain-evidence.json。已部署多维实时看板及产销域看板，验证不同数据源、自动登记、筛选、飞书预览、旧链接兼容；停止本机 3080/18087 服务后仍能刷新。没有物理关机、其他同事设备或容器重建实测。

## 预览与发布显示一致性
本机预览和服务器查看器共同使用 withCurrentLiveUI，统一升级筛选控件及 SQL 说明。保持原始发布 HTML、版本和查询绑定不变；维护更新时从发布档案重建查看器，原链接继续可用。2026-09-14 已重建 4 个现有服务器页面，详见 server-local-ui-parity-evidence.json。
