# 通用筛选展示升级

2026-09-14：系统筛选采用紧凑 summary + details 面板，原生 select 保留为内部选值模型，使用具备键盘操作能力的 checkbox/radio 展示选项。搜索、清空、分页仍调用原服务方法。日期/月份/数值范围横排；窄屏下浮层转为行内展开，避免超出视口。

主题变量由 :root 或 #dsh-live-filters 继承：--dsh-filter-text、--dsh-filter-muted、--dsh-filter-bg、--dsh-filter-surface、--dsh-filter-border、--dsh-filter-hover、--dsh-filter-accent、--dsh-filter-on-accent、--dsh-filter-focus、--dsh-filter-font、--dsh-filter-radius、--dsh-filter-height。默认暖灰；深色模板须显式指定可读的文字/面板对比色。生成合同已加入这些要求，不要求模型另造筛选器。

旧版本在工作台资产响应阶段仅更新 data-dsh-live-runtime 内已知 setupFilters 代码段，保持原查询端点和生成图表；不覆写存档HTML。独立旧分享服务的已存版本未迁移，避免改变发布版本一致性。

验证：构建通过；35项相关测试通过；键盘焦点小修后再次构建和10项针对测试通过。真实 general-filter-acceptance/rev-0004 页面验证展开、多选、清空、TECNO搜索、Esc关闭、应用默认范围后查询成功；1440×900和390×844截图检查无横向溢出。未新增看板或修改发布数据。未逐个验证所有历史模板，既有模板祖先 overflow 裁剪仍需按实例检查。
