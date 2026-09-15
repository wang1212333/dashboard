# 容器部署结果与维护说明

访问地址：https://bigdata-ai-docker-container2.transsion.com/static/codex-live-dashboard/index.html

本次完成的是基于现有 Jupyter 登录和执行环境的服务器预览部署。未登录自动进入登录页，登录后返回看板。页面与查询代码都在服务器，不依赖本地 4319 服务或本地电脑运行。

## 实际结构

- 前端：Jupyter 静态资源入口内独立的 codex-live-dashboard 目录，只放看板 HTML。
- 查询：浏览器经已认证 Jupyter Session / Kernel WebSocket 调用固定 app_bridge.run_query，再调用服务器上的 MCP 查询代码。
- 代码目录：/home/jovyan/work/dev/codex-live-dashboard。
- 静态文件：上述目录的 public/index.html；Jupyter 包的 static/codex-live-dashboard 符号链接指向该目录。未覆盖已有静态文件。
- 查询内核：使用 launcher.ipynb 对应的专用 Jupyter session；缺失时由页面创建，保留查询连接复用。
- MCP 配置：/home/jovyan/.config/codex-live-dashboard/config.toml，600 权限；父目录 700。不写入 HTML，不通过页面接口返回。
- 现有 Jupyter、其他 notebook 和 18087 服务未重启或修改。

## 验证

实际浏览器验证：未登录跳转、登录返回、真实数据加载、日期/品牌切换、无页面脚本错误。样本首次查询 0.55 秒，切换为 2026-09-01 至 2026-09-03 / TECNO 后 0.18 秒。数据库汇总核对通过，不代表固定性能保证。

## 与独立正式服务的区别

这是 Jupyter 承载的预览入口，不是 /dashboard 反向代理方式，也没有独立 ASGI/WSGI 服务、企业只读查看者身份或独立服务守护。访问者必须具有该 Jupyter 的登录权限；这种权限包含 notebook 执行能力，不能把它当作细粒度看板访问权限。不得为了扩大看板受众而广泛分发 Jupyter 管理密码。

本版隐藏原本的“分享看板”按钮：原有固定日期品牌、有效期和撤销授权不能直接套用到拥有 Jupyter 工作区权限的访问者。当前链接可以交给已有 Jupyter 权限的同事；面向普通只读用户仍需独立应用入口及授权。

/home/jovyan/work 为已确认挂载卷，代码位于该目录。当前 ~/.config 凭据和 Jupyter 包目录符号链接不位于该挂载卷；容器重建或升级前需通过部署配置重新注入凭据并恢复静态入口，不能保证容器重建后直接可用。普通内核关闭后页面可新建内核。部署环境需要继续运行 Jupyter。

## 回退

只需移除本应用的静态符号链接即可关闭入口。停止 launcher.ipynb 对应的专用 session 后释放查询内核。不要停止其他 notebook 或现有 18087 服务。本地 4319 版本保持独立，不受此预览部署影响。

后续正式化建议：平台侧为专用查询进程提供反向代理路由、HTTPS 和身份授权，并使用持久配置与进程管理。当前 Jupyter 用户可运行应用但 sudo 检查未通过，且没有 Kubernetes service-account 配置；这不代表它具有宿主机或集群路由管理权限。
