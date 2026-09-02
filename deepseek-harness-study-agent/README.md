# 给初中生的第一个 DeepSeek Harness Agent

这个项目做了一个“学习计划小助手”。你在 DSH 里对它说：

> 我今天要复习初二数学的一元一次方程，有 45 分钟，帮我安排一下。

模型会判断“该用学习计划工具”，然后调用本项目的 `make_study_plan`。工具算出计划，把结果交回模型；模型再用自然语言解释给你。

## 先用一句话理解 Harness

把 Agent 想成一个机器人：

- **模型**是大脑，负责听懂你的话和决定下一步。
- **工具**是手，例如“生成学习计划”“查天气”“读文件”。
- **Harness**是机器人身体和课堂规则：把大脑、手、记忆和行动顺序接起来。

DSH 的特别之处是：这些部件都是插件。我们没有改 DSH 源代码，只是加了一个新工具插件。

```text
你说需求
   ↓
DeepSeek 模型（决定要不要用工具）
   ↓  调用 make_study_plan
本项目的工具插件（按规则生成计划）
   ↓
模型把计划解释成回答
```

## 文件分别做什么

```text
deepseek-harness-study-agent/
├── package.json          # 说明“这是一个可以被 DSH 安装的插件包”
├── cordis.patch.yml      # 把插件插入 DSH 的插件树
├── index.js              # 工具真正的代码
└── README.md             # 你正在看的说明书
```

最重要的是 `index.js` 中的三件事：

1. `inject = ['tools']`：先声明“我需要使用 DSH 的工具箱”。
2. `ctx.tools.register(...)`：把新工具登记进工具箱。
3. `execute(args)`：模型决定调用工具后，真正运行的普通 JavaScript 代码。

## 怎样运行

请在这个文件夹打开 PowerShell，并依次输入以下命令。

```powershell
# 进入本项目
cd "E:\DSH数据看板搭建项目\deepseek-harness-study-agent"

# 让练习版 DSH 的设置只保存在这个项目中，不影响你电脑上其他 DSH 设置
$env:DSH_HOME = "$PWD\.dsh-home"

# 安装这个小插件自己需要的官方工具库（只需第一次执行）
npm install

# 安装本地插件到 DSH 的 Web 版配置
npx @deepseek-ai/dsh plugin --profile web add .

# 先检查插件是否已经进入配置；看到 study-planner-tool 就成功了
npx @deepseek-ai/dsh --profile web --dump-config

# 启动网页界面
npx @deepseek-ai/dsh web --no-open
```

第一次运行会下载 DSH，需要等待一会儿。终端会显示一个类似 `http://127.0.0.1:3080` 的地址；复制它到浏览器打开即可。

首次进入时，请在 DSH 的设置里按界面提示配置你自己的模型服务和 API Key。**API Key 就像银行卡密码：只填写在本机设置里，不要发给任何人，也不要写进代码。**

本项目把 `@deepseek-ai/dsh-tools` 的版本固定为 `0.1.1-rc.2`，和本次验证用的 DSH 版本一致。DSH 仍在开发者预览阶段，升级 DSH 时也应把这个依赖一起升级为相同版本。

## 验收自己的 Agent

在聊天框发送：

```text
我今天有 45 分钟复习初二数学的一元一次方程，请帮我列一个计划。
```

成功时，运行记录中应能看到 `make_study_plan`，答案中会有四段学习安排。若模型没有调用工具，可以再明确说：

```text
请务必调用 make_study_plan 工具，为“初二数学的一元一次方程”制定 45 分钟计划。
```

## 下一次练习

试着只改一个地方：把 `index.js` 里的学习步骤换成你自己的方法，例如加入“背 10 个英语单词”或“朗读一段课文”。改完后停止 DSH，再重新执行最后一条启动命令即可。

## 你已经学到的架构思想

| 部件 | 本项目中的对应物 | 作用 |
| --- | --- | --- |
| 模型 | 你在 DSH 设置中选择的 DeepSeek 模型 | 理解问题、决定调用哪个工具 |
| 工具插件 | `index.js` | 给模型增加一项可靠的行动能力 |
| 配置层 | `cordis.patch.yml` | 不改 DSH 源码，也能装上插件 |
| 会话和循环 | DSH 自带能力 | 记录对话、工具调用结果，并继续让模型回答 |

这就是一个最小但真实的 Harness Agent：**模型负责思考，插件负责行动，Harness 负责把整个过程连起来。**
