import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Claude Code 源码完全精通',
  description: '从零到一，彻底学懂 Claude Code 的架构、源码、运行机制、核心原理',
  lang: 'zh-CN',

  head: [
    ['meta', { name: 'theme-color', content: '#1a1a2e' }],
  ],

  themeConfig: {
    logo: '/logo.svg',

    nav: [
      { text: '首页', link: '/' },
      { text: '章节',
        items: [
          { text: 'Ch1 前置认知', link: '/chapter-01/' },
          { text: 'Ch2 架构总览', link: '/chapter-02/' },
          { text: 'Ch3 全链路源码走读', link: '/chapter-03/' },
          { text: 'Ch4 API 通信层', link: '/chapter-04/' },
          { text: 'Ch5 System Prompt', link: '/chapter-05/' },
          { text: 'Ch6 记忆系统', link: '/chapter-06/' },
          { text: 'Ch7 工具系统', link: '/chapter-07/' },
          { text: 'Ch8 权限模式', link: '/chapter-08/' },
          { text: 'Ch9 沙盒安全', link: '/chapter-09/' },
          { text: 'Ch10 多 Agent', link: '/chapter-10/' },
          { text: 'Ch11 压缩与上下文', link: '/chapter-11/' },
          { text: 'Ch12 Hook/插件/技能', link: '/chapter-12/' },
          { text: 'Ch13 斜杠命令', link: '/chapter-13/' },
          { text: 'Ch14 逐目录源码解析', link: '/chapter-14/' },
          { text: 'Ch15 设计模式', link: '/chapter-15/' },
          { text: 'Ch16 FAQ', link: '/chapter-16/' },
          { text: 'Ch17 二次开发实战', link: '/chapter-17/' },
        ],
      },
      { text: '相关学习链接', link: '/links/' },
      { text: '源码仓库', link: 'https://github.com/dgai5016/Claude-Code' },
    ],

    sidebar: {
      '/links/': [
        {
          text: '相关学习链接',
          collapsed: false,
          items: [
            { text: '1. 分享Claude Code团队内部的5条工作原则', link: '/links/#_1-分享claude-code团队内部的5条工作原则' },
            { text: '2. How Anthropic teams use Claude Code', link: '/links/#_2-how-anthropic-teams-use-claude-code' },
          ],
        },
      ],
      '/': [
        {
          text: '开始',
          items: [
            { text: '首页', link: '/' },
          ],
        },
        {
          text: '第一阶段：建立全局认知',
          collapsed: false,
          items: [
            {
              text: 'Ch1 前置认知',
              collapsed: true,
              items: [
                { text: '1.1 Claude Code 是什么', link: '/chapter-01/#_1-1-claude-code-是什么' },
                { text: '1.2 本质区别', link: '/chapter-01/#_1-2-本质区别' },
                { text: '1.3 从源码看本质', link: '/chapter-01/#_1-3-从源码看本质' },
                { text: '2. AI Agent 的本质', link: '/chapter-01/#_2-ai-agent-的本质' },
                { text: '3. 核心能力边界', link: '/chapter-01/#_3-claude-code-的核心能力边界' },
                { text: '4. 整体架构总览', link: '/chapter-01/#_4-整体架构总览' },
                { text: '5. 源码仓库结构总览', link: '/chapter-01/#_5-源码仓库结构总览' },
                { text: '6. 技术栈讲解', link: '/chapter-01/#_6-技术栈讲解' },
                { text: '7. 如何调试源码', link: '/chapter-01/#_7-如何调试-claude-code-源码' },
              ],
            },
            {
              text: 'Ch2 整体架构总览',
              collapsed: true,
              items: [
                { text: '架构协作全景', link: '/chapter-02/#架构协作全景' },
                { text: '1. API 通信层', link: '/chapter-02/#_1-api-客户端与-llm-通信层' },
                { text: '2. System Prompt', link: '/chapter-02/#_2-system-prompt-系统' },
                { text: '3. 记忆系统', link: '/chapter-02/#_3-记忆系统' },
                { text: '4. 工具系统', link: '/chapter-02/#_4-工具系统' },
                { text: '5. 权限系统', link: '/chapter-02/#_5-权限系统' },
                { text: '6. 沙盒安全', link: '/chapter-02/#_6-沙盒安全系统' },
                { text: '7. 多 Agent', link: '/chapter-02/#_7-多-agent-系统' },
                { text: '8. 压缩管理', link: '/chapter-02/#_8-压缩与上下文管理' },
                { text: '9. Hook/插件/技能', link: '/chapter-02/#_9-hook-插件与技能系统' },
                { text: '10. 斜杠命令', link: '/chapter-02/#_10-斜杠命令系统' },
                { text: '11. 渲染系统', link: '/chapter-02/#_11-渲染系统' },
                { text: '12. Feature Flag', link: '/chapter-02/#_12-feature-flag-系统' },
              ],
            },
            {
              text: 'Ch3 核心运行流程全链路',
              collapsed: true,
              items: [
                { text: '全链路概览', link: '/chapter-03/#全链路概览' },
                { text: '① 启动入口', link: '/chapter-03/#步骤-①-启动入口' },
                { text: '② 初始化', link: '/chapter-03/#步骤-②-初始化' },
                { text: '③ CLI 解析', link: '/chapter-03/#步骤-③-cli-解析与-repl-启动' },
                { text: '④ 加载记忆', link: '/chapter-03/#步骤-④-加载记忆' },
                { text: '⑤ 拼接 Prompt', link: '/chapter-03/#步骤-⑤-拼接-prompt' },
                { text: '⑥ 启动循环', link: '/chapter-03/#步骤-⑥-启动-agent-循环' },
                { text: '⑦ 上下文准备', link: '/chapter-03/#步骤-⑦-上下文准备与压缩' },
                { text: '⑧ API 调用', link: '/chapter-03/#步骤-⑧-api-流式调用' },
                { text: '⑨ 流式工具执行', link: '/chapter-03/#步骤-⑨-流式工具执行' },
                { text: '⑩ 解析工具调用', link: '/chapter-03/#步骤-⑩-解析工具调用' },
                { text: '⑪ 权限校验', link: '/chapter-03/#步骤-⑪-权限校验' },
                { text: '⑫ Hook 执行', link: '/chapter-03/#步骤-⑫-hook-执行' },
                { text: '⑬ 执行工具', link: '/chapter-03/#步骤-⑬-执行工具' },
                { text: '⑭ PostToolUse', link: '/chapter-03/#步骤-⑭-posttooluse-hooks' },
                { text: '⑮ 结果映射', link: '/chapter-03/#步骤-⑮-结果映射' },
                { text: '⑯ 附件注入', link: '/chapter-03/#步骤-⑯-附件注入' },
                { text: '⑰ 多轮循环', link: '/chapter-03/#步骤-⑰-多轮循环' },
                { text: '退出条件汇总', link: '/chapter-03/#退出条件汇总' },
              ],
            },
          ],
        },
        {
          text: '第二阶段：理解核心能力',
          collapsed: false,
          items: [
            { text: 'Ch4 API 客户端与 LLM 通信层', link: '/chapter-04/' },
            { text: 'Ch5 System Prompt 深度解析', link: '/chapter-05/' },
            { text: 'Ch6 记忆系统源码解析', link: '/chapter-06/' },
            { text: 'Ch7 工具系统源码深度解析', link: '/chapter-07/' },
          ],
        },
        {
          text: '第三阶段：理解安全机制',
          collapsed: false,
          items: [
            { text: 'Ch8 权限模式源码深度解析', link: '/chapter-08/' },
            { text: 'Ch9 沙盒安全系统深度解析', link: '/chapter-09/' },
          ],
        },
        {
          text: '第四阶段：理解高级特性',
          collapsed: false,
          items: [
            { text: 'Ch10 多 Agent 与协调器系统', link: '/chapter-10/' },
            { text: 'Ch11 压缩与上下文管理', link: '/chapter-11/' },
            { text: 'Ch12 Hook、插件与技能系统', link: '/chapter-12/' },
            { text: 'Ch13 斜杠命令系统', link: '/chapter-13/' },
          ],
        },
        {
          text: '第五阶段：逐文件全面覆盖',
          collapsed: false,
          items: [
            { text: 'Ch14 逐目录源码解析', link: '/chapter-14/' },
          ],
        },
        {
          text: '第六阶段：提炼升华与实战',
          collapsed: false,
          items: [
            { text: 'Ch15 高级架构设计与设计模式', link: '/chapter-15/' },
            { text: 'Ch16 常见问题与源码级答疑', link: '/chapter-16/' },
            { text: 'Ch17 二次开发与改造实战', link: '/chapter-17/' },
          ],
        },
      ],
    },

    search: {
      provider: 'local',
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/dgai5016/Claude-Code' },
    ],

    footer: {
      message: '基于 dgai5016/Claude-Code (999.0.0-restored) 源码解析 | 本站内容仅供学习研究',
    },

    outline: {
      level: [2, 4],
      label: '本章目录',
    },
  },

  markdown: {
    lineNumbers: true,
    theme: {
      light: 'vitesse-light',
      dark: 'vitesse-dark',
    },
  },
})
