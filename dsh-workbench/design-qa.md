# 资料库按钮区视觉核对

## 对比对象

- Source visual truth: `C:/Users/Administrator/AppData/Local/Temp/codex-clipboard-11cd9bbf-2587-473a-aebb-75af5bf0a296.png`
- Implementation: `http://127.0.0.1:4317` 的资料库页
- Viewport / density: 未固定；浏览器可见 DOM 已确认资料库页的标题、搜索、新建、筛选及两个分类按钮。
- State: 知识库标签已选中；样式库标签用于进入既有样式选择内容。

## 已确认的实现

- 导航标签显示为“资料库”。
- 资料库页仅显示“知识库”和“样式库”两个分类按钮。
- 搜索框、“新建”按钮与“筛选”按钮保留在页头区域。
- 点击“样式库”的代码路径会导航至原有 `/templates` 样式内容页。

## 五项保真核对

- Fonts and typography: 使用当前工作台既有字体栈、字号与字重；未引入新字体。
- Spacing and layout rhythm: 标题、搜索、新建在同一行；分类按钮与筛选位于第二行工具栏。
- Colors and visual tokens: 使用既有黑白中性色、浅灰选中态与圆角按钮语言。
- Image quality and asset fidelity: 目标区域没有需要新增的图片资产；未创建替代图像资产。
- Copy and content: 已改为“资料库 / 知识库 / 样式库”，并保留“新建 / 筛选 / 搜索”。

## Findings

- [P2] 无法完成“样式库”子页面的浏览器截图比对。
  - Evidence: 浏览器在点击“样式库”后阻止读取本地 `/templates` 子路径。
  - Impact: 无法从浏览器视觉层面确认子页面标题与既有样式内容的最终呈现。
  - Fix: 在允许访问该本地子路径的浏览器环境中重新截图并比较；代码构建和自动化测试均已通过。

## Primary interactions tested

1. 进入本地工作台后，侧边栏“资料库”可见。
2. 点击“资料库”后，知识库、样式库、搜索、新建、筛选均可见。
3. 点击“样式库”会触发到既有样式页的导航；后续浏览器读取被安全策略阻止。

## Implementation checklist

- [x] 替换资料库入口为紧凑分类按钮。
- [x] 仅保留知识库、样式库两个分类按钮。
- [x] 保留搜索、新建、筛选控件。
- [x] 将样式库连接到原有样式内容页。
- [ ] 在可访问本地子路径的浏览器中完成最终截图比较。

## Comparison history

1. 初始实现使用内容卡片，不符合用户给出的按钮参考；已改为紧凑标签按钮。
2. 自动化 DOM 核对通过；样式库子页面的截图核对受浏览器本地路径策略阻止。

final result: blocked

---

# 我的看板页面视觉核对（2026-09-02）

## 对比对象

- Source visual truth: `C:/Users/Administrator/AppData/Local/Temp/codex-clipboard-32c07141-633e-4525-aaee-538af9a8728e.png`（1718 × 910）。
- Implementation: `http://127.0.0.1:3080/dsh-workbench` 的“我的看板”状态；通过当前 DSH 宿主内嵌工作台实际点击并截图核验。
- State: “我的看板 / 全部 / 卡片视图”已选中；随后打开一张真实看板的版本管理栏。
- Viewport normalization: 参考图为完整桌面页；实现截图来自宿主内嵌内容区，因此只比较同一页面内容、工具栏、卡片与版本栏的比例和状态，不将宿主侧栏宽度纳入保真判断。

## Findings

- 无 P0/P1/P2 未解决项。
- [P3] 当前资料库仅返回 1 张真实看板，参考图展示 6 张示例卡片；这是数据量差异，不以虚构资产填充。
- [P3] 当工作台内容区收窄至移动端宽度时，版本栏以覆盖式抽屉呈现；在桌面断点保持 304px 固定版本栏并通过内容区收缩让位。

## 五项保真核对

- Fonts and typography: 沿用工作台现有 Inter / PingFang SC 字体栈；标题、标签、元信息和版本栏的层级已收紧到参考图的轻量密度。
- Spacing and layout rhythm: 桌面侧栏为 195px，页面边距 28–30px，卡片间距 16px，控件高度 32–34px；版本栏宽度为 304px。
- Colors and visual tokens: 使用白、浅灰和深灰；主操作为黑色，不使用蓝色选中背景、渐变或厚重阴影。
- Image quality and asset fidelity: 卡片继续使用真实看板文档 iframe 预览，不替换为静态占位图。
- Copy and content: 保留真实 `/api/dashboards` 数据；最近对话默认限定 5 条，对技术性名称归一为“数据看板搭建”，超出时显示“查看全部”。

## Primary interactions tested

1. 进入“我的看板”，一级标签、二级筛选、搜索、卡片/列表切换和新建按钮均可见。
2. 点击卡片标题后可打开右侧版本栏，显示真实标题、当前版本、更新时间、来源对话与版本记录入口。
3. 卡片视图以 `repeat(auto-fill, minmax(300px, 1fr))` 响应式排版；版本栏桌面宽度为 304px。

## Comparison history

1. 初始状态的一级标签被覆盖成胶囊样式，且工具栏采用绝对定位；已恢复为文字标签、黑色短下划线和正常流式工具栏。
2. 初始状态版本栏顶部偏移且视觉过重；已收紧为 304px 的浅边线栏，并在桌面通过内容区右侧留白避免覆盖卡片。
3. 初始侧栏历史列表会无限延长并显示 `sample` 等技术名；已限制默认显示 5 条并提供展开入口。

final result: passed

---

# 跳转到最新消息图标视觉核对（2026-09-04）

## 对比对象

- Source visual truth: `C:/Users/Administrator/AppData/Local/Temp/codex-clipboard-fd822d8f-6ed7-4658-8361-cfa9708047d2.png`（200 × 200，透明底深灰向下折线）。
- Implementation: `http://127.0.0.1:3080/?workbench=1` 的实际 DSH 宿主内嵌工作台，以及 `http://127.0.0.1:3080/dsh-workbench/assets/jump-to-latest-chevron.png` 的生产资源路由。
- Viewport: 1280 × 720 的应用内浏览器视口。
- State: 空闲状态确认控件保持隐藏；运行状态由生成页面代码与定位测试确认，仅在用户离开最新消息且仍在生成时显示。

## Findings

- 无 P0/P1/P2/P3 未解决项。
- 初次宿主验收发现资源地址被重复补成 `/dsh-workbench/dsh-workbench/assets/...`；已改为分段拼接以避开宿主路径重写，复验确认页面中不再存在重复路径。

## 五项保真核对

- Fonts and typography: 控件已移除文字标签，不引入额外字体或文案尺寸变化。
- Spacing and layout rhythm: 图标按钮以输入框实时矩形为基准，水平居中，图标底边与输入框顶边固定保留 12px；附件导致输入框高度变化时会重新计算。
- Colors and visual tokens: 使用用户提供图片中的原始深灰图形，按钮背景透明，仅在悬停时使用现有浅灰反馈。
- Image quality and asset fidelity: 直接复用用户提供的透明 PNG，不使用自绘近似图标；源路由返回 200 与 `image/png`。
- Copy and content: 保留 `跳转到最新消息` 的无障碍名称和原有点击滚动逻辑，不显示可见文字。

## Primary interactions tested

1. 实际宿主重启后可正常载入工作台 iframe。
2. 实际页面引用 `jump-to-latest-chevron.png`，旧的“查看最新内容”文字按钮不再存在。
3. 图标定位公式使用输入框实时 `getBoundingClientRect()`，并以 `innerHeight - rect.top + 12` 计算底部位置。
4. 图标资源分别通过宿主路由与独立本地应用路由提供。
5. 构建通过；本地页面测试 14/14 通过，其中覆盖图标资源加载和定位规则。
6. 实际宿主页面源码确认最终只生成一次 `/dsh-workbench` 前缀，测试请求结束后空闲态不残留箭头或测试会话。

## Implementation checklist

- [x] 使用用户提供的向下箭头图片。
- [x] 控件位于对话输入框上方，不与输入框重叠。
- [x] 输入框高度或窗口尺寸变化时重新定位。
- [x] 保留原有跳转到最新消息业务逻辑。
- [x] 实际宿主重启并完成资源、页面与自动化验证。

final result: passed
