// 这是一个 DeepSeek Harness（DSH）插件。
// 它给 AI 增加一项新能力：生成一个可执行的学习计划。

import { defineTool } from '@deepseek-ai/dsh-tools'

// 插件的名字。DSH 在启动时会显示它已被加载。
export const name = 'study-planner-tool'

// 这个插件依赖 DSH 已经准备好的工具箱（tools）服务。
export const inject = ['tools']

/**
 * 把任意学习时长限制在 10～120 分钟之间，避免生成不合理的计划。
 * 这是普通 JavaScript 函数，不需要调用 AI。
 */
function normalizeMinutes(minutes) {
  return Math.max(10, Math.min(120, Math.round(minutes)))
}

/**
 * DSH 启动插件时会调用 apply。
 * ctx 可以理解为“公共教室”：其他插件把模型、工具、会话等能力放在这里。
 */
export function apply(ctx) {
  ctx.tools.register(defineTool({
    // 这个名字会展示给模型；模型想使用时会调用它。
    name: 'make_study_plan',
    description: '为一门初中学科制定 10 到 120 分钟的短时学习计划。适合用户询问今天如何复习、预习或完成某科作业时使用。',

    // 模型调用工具时必须提供的参数。DSH 会先检查类型，再执行下面的函数。
    parameters: {
      subject: {
        type: 'string',
        required: true,
        description: '学科或具体主题，例如：初二数学的一元一次方程',
      },
      minutes: {
        type: 'number',
        required: true,
        description: '可学习的分钟数，范围是 10 到 120',
      },
    },

    // 工具返回什么，以及怎样把结果交还给模型。
    output: {
      schema: { type: 'string' },
      render: (_args, plan) => [{ type: 'text', text: plan }],
    },

    // 这是真正的“行动”。这里没有让 AI 再猜一次，而是用可靠规则算出计划。
    async execute(args) {
      const total = normalizeMinutes(args.minutes)
      const warmup = Math.max(5, Math.round(total * 0.15))
      const learn = Math.max(5, Math.round(total * 0.45))
      const practice = Math.max(5, Math.round(total * 0.3))
      const review = total - warmup - learn - practice

      return [
        `《${args.subject}》${total} 分钟学习计划`,
        `1. ${warmup} 分钟：回忆昨天学过的重点，写下一个还不懂的问题。`,
        `2. ${learn} 分钟：阅读教材或笔记，圈出定义、公式或关键结论。`,
        `3. ${practice} 分钟：完成 3～5 道由易到难的练习题。`,
        `4. ${review} 分钟：订正错误，并用自己的话写一句“我今天学会了什么”。`,
        '小提醒：每完成一步就打一个勾；遇到难题先标记，别一直卡在同一题上。',
      ].join('\n')
    },
  }))
}
