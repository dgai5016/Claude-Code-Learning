你现在需要为我生成一个【Claude Code 源码完全精通教学网站】。
目标：让任何读者（零基础、中级、高级开发者）从头到尾读完本站，能 100% 彻底学懂 Claude Code 的架构、源码、运行机制、核心原理、Agent 工作流程、权限系统、记忆系统、工具系统、底层实现。

参考源码仓库：https://github.com/dgai5016/Claude-Code（我已经克隆到了本地，放在当前项目的上一级目录下）
【重要背景】该仓库版本为 999.0.0-restored，描述为 "Restored Claude Code source tree reconstructed from source maps"，即从 source map 反编译恢复的工作区，并非 Anthropic 官方原始源码。部分代码可能不完整，变量名可能不完全准确，行号可能有偏移。教学内容需注明此背景。

必须 100% 贴合该仓库真实源码结构、文件、函数、逻辑，**不能虚构、不能漏写、不能多写**。

请你生成一个完整、独立、可直接用于 Github Pages、结构极度详细、教学逻辑闭环的静态教学网站（基于 VitePress）。

====================
网站定位
====================
1. 这不是使用教程，是【源码内核解析教程】
2. 全文深度拆解 Claude-Code 源码结构
3. 从 0 到 1 讲解：架构设计、模块分工、核心源码、执行链路、设计模式、底层原理
4. 小白能看懂，高手能学透，所有人读完彻底精通 Claude Code

====================
网站整体结构
====================
# 首页
- 网站介绍：为什么要学 Claude Code 源码
- 学习价值（求职、AI 工程、Agent 开发、AI 编程架构）
- 整体架构大图
- 学习路线图

# 第一章：前置认知（必须看懂）
1. Claude Code 是什么？与普通对话模型的区别
2. AI Agent 的本质
3. Claude Code 的核心能力边界
4. 整体架构总览（详见下方子系统清单）
5. 源码仓库结构总览（需注明这是 restored 源码，非官方原始源码）
6. 技术栈讲解（Bun / TypeScript / Zod / Ink / React CLI）
7. 如何调试 Claude Code 源码

# 第二章：整体架构彻底拆解（核心）
逐字逐句讲解以下子系统：
1. System Prompt 系统（Section 缓存机制：src/constants/prompts.ts 的 getSystemPrompt()、src/constants/systemPromptSections.ts 的 systemPromptSection() 与 DANGEROUS_uncachedSystemPromptSection()、src/utils/systemPrompt.ts 的优先级覆盖逻辑、src/utils/queryContext.ts 的 fetchSystemPromptParts()、src/context.ts 的 getUserContext() 与 getSystemContext()）
2. 工具系统（src/Tool.ts 的 Tool 接口与 buildTool() 工厂、src/tools.ts 的 getAllBaseTools() 注册、工具执行管道、并发调度）
3. 查询引擎（src/query.ts 的 query() async generator、src/QueryEngine.ts 的 QueryEngine 类、src/services/api/claude.ts 的流式 API 调用、上下文压缩策略级联）
4. 权限系统（src/utils/permissions/ 下的管道式决策链、7 种权限模式、YOLO 分类器、熔断机制、bypass-immune 安全检查）
5. 记忆系统（CLAUDE.md 加载：src/utils/claudemd.ts；记忆目录：src/memdir/；会话记忆：src/services/SessionMemory/；自动记忆抽取：src/services/extractMemories/）
6. 渲染系统（src/ink/ 自定义 Ink 渲染器、src/components/ 146+ React 组件、src/screens/ 顶层屏幕）
7. Hook 系统（src/services/tools/toolHooks.ts 的 PreToolUse/PostToolUse hooks、hook 可修改输入/做权限决策/阻止执行）
8. 多 Agent 系统（src/tools/AgentTool/ 子 Agent、src/coordinator/ 协调器模式、fork 子 Agent、群组/队友 Agent）
9. 插件与技能系统（src/plugins/ 内置插件、src/skills/ 技能定义与加载、MCP 工具集成）
10. 压缩与上下文管理（5 种压缩策略级联：applyToolResultBudget → snipCompactIfNeeded → microcompact → contextCollapse → autocompact）
11. Feature Flag 系统（GrowthBook feature flag 门控、TRANSCRIPT_CLASSIFIER / KAIROS / AGENT_TRIGGERS / CONTEXT_COLLAPSE 等关键 flag）

# 第三章：逐目录源码解析
【重要规则】
我已经在下方提供了 Claude-Code 源码 src/ 目录的完整真实结构（58 个子目录 + 关键独立文件），你必须**严格按照此结构**解析，**一个不漏、一个不多、完全真实**。

src/ 目录完整结构：
- src/entrypoints/ — 入口点（cli.tsx、init.ts、dev-entry.ts）
- src/main.tsx — Commander CLI 参数解析（4690 行）
- src/query.ts — 核心 Agent 循环 query() async generator（1729 行）
- src/QueryEngine.ts — QueryEngine 类，SDK 入口（1295 行）
- src/Tool.ts — Tool 接口定义与 buildTool() 工厂（792 行）
- src/tools.ts — 工具注册中心 getAllBaseTools()（389 行）
- src/commands.ts — 斜杠命令定义（25185 行）
- src/context.ts — 上下文管理（6446 行）
- src/interactiveHelpers.tsx — Ink 渲染辅助、引导、信任对话框（57424 行）
- src/dialogLaunchers.tsx — 对话框启动器（22948 行）
- src/replLauncher.tsx — REPL 启动（3517 行）
- src/setup.ts — 初始化设置（20646 行）
- src/cost-tracker.ts — 费用追踪（10706 行）
- src/history.ts — 历史记录（14081 行）
- src/assistant/ — 助手模式
- src/bootstrap/ — 全局共享状态（state.ts 56109 行）
- src/bridge/ — Bridge 通信
- src/buddy/ — Buddy 系统
- src/cli/ — CLI 工具
- src/commands/ — 斜杠命令实现
- src/components/ — React UI 组件（146+ 文件，含 permissions/ memory/ messages/ design-system/）
- src/constants/ — 常量与 Prompt 定义（prompts.ts、systemPromptSections.ts）
- src/context/ — 上下文相关
- src/coordinator/ — 协调器模式（多 Agent 编排）
- src/hooks/ — React Hooks（含 toolPermission/）
- src/ink/ — 自定义 Ink 渲染器（50 个文件，含 reconciler、screen、termio）
- src/jobs/ — 后台任务系统
- src/keybindings/ — 键绑定
- src/memdir/ — 记忆目录系统（memdir.ts、paths.ts、memoryTypes.ts）
- src/migrations/ — 数据迁移
- src/moreright/ — MoreRight 系统
- src/native-ts/ — 原生 TypeScript 模块
- src/outputStyles/ — 输出样式
- src/plugins/ — 插件系统（builtinPlugins.ts）
- src/proactive/ — 主动式 Agent
- src/query/ — 查询相关（stopHooks.ts、tokenBudget.ts）
- src/remote/ — 远程会话
- src/schemas/ — JSON Schema
- src/screens/ — 顶层屏幕（REPL.tsx 约 90 万行、Doctor.tsx、ResumeConversation.tsx）
- src/server/ — 本地服务器
- src/services/ — 核心服务（api/、tools/、SessionMemory/、extractMemories/）
- src/skills/ — 技能系统（bundledSkills.ts、loadSkillsDir.ts、bundled/）
- src/ssh/ — SSH 连接
- src/state/ — 状态管理
- src/tasks/ — 任务调度和管理
- src/tools/ — 所有工具实现（54 个子目录：AgentTool/ BashTool/ FileReadTool/ FileEditTool/ FileWriteTool/ GlobTool/ GrepTool/ WebFetchTool/ WebSearchTool/ NotebookEditTool/ TodoWriteTool/ AskUserQuestionTool/ SkillTool/ EnterPlanModeTool/ ExitPlanModeV2Tool/ ConfigTool/ LSPTool/ EnterWorktreeTool/ ExitWorktreeTool/ SendMessageTool/ TeamCreateTool/ TeamDeleteTool/ TaskOutputTool/ TaskStopTool/ TaskCreateTool/ TaskGetTool/ TaskUpdateTool/ TaskListTool/ PowerShellTool/ CronCreateTool/ CronDeleteTool/ CronListTool/ RemoteTriggerTool/ MonitorTool/ SleepTool/ BriefTool/ SendUserFileTool/ PushNotificationTool/ SubscribePRTool/ SnipTool/ ListMcpResourcesTool/ ReadMcpResourceTool/ ToolSearchTool/ WorkflowTool/ VerifyPlanExecutionTool/ REPLTool/ TungstenTool/ WebBrowserTool/ OverflowTestTool/ CtxInspectTool/ TerminalCaptureTool/ 等）
- src/types/ — 类型定义（permissions.ts 等）
- src/upstreamproxy/ — 上游代理
- src/utils/ — 工具函数（permissions/ 26 文件、claudemd.ts、systemPrompt.ts、queryContext.ts、sideQuery.ts、sandbox/ 等）
- src/vim/ — Vim 模式
- src/voice/ — 语音输入

对每一个目录、每一个文件，必须解析：
1. 目录/文件作用
2. 源码逐段解析
3. 核心函数/变量讲解
4. 运行逻辑
5. 设计意图
6. 容易踩坑点

# 第四章：核心运行流程全链路源码逐行走读（真实源码链路版）
完整复现一次用户输入命令后的**全链路源码执行流程**，**每一步必须对应 Claude-Code 真实源码的文件位置、函数名、逻辑**：
1. 启动：src/dev-entry.ts → src/entrypoints/cli.tsx（--version 快速路径）→ src/entrypoints/init.ts（enableConfigs、环境变量、TLS 证书、策略加载）→ src/main.tsx（Commander 参数解析）
2. 初始化：加载 settings（src/entrypoints/init.ts 的 enableConfigs）、工作目录信息、Git 信息（src/context.ts 的 getSystemContext()）
3. 加载记忆：src/utils/claudemd.ts 的 getClaudeMds() 加载 CLAUDE.md 文件、src/memdir/memdir.ts 的 loadMemoryPrompt() 加载记忆目录
4. 拼接 Prompt：src/constants/prompts.ts 的 getSystemPrompt() → src/constants/systemPromptSections.ts 的 systemPromptSection() 缓存 + DANGEROUS_uncachedSystemPromptSection() 动态段 → src/utils/systemPrompt.ts 的优先级覆盖（override > coordinator > agent > custom > default）→ src/utils/queryContext.ts 的 fetchSystemPromptParts() 组装最终 prompt
5. 启动 Agent 循环：src/QueryEngine.ts 的 submitMessage() 初始化 → src/query.ts 的 query() async generator 进入 while(true) 主循环
6. 上下文准备：从上次压缩边界后提取消息 → 5 级压缩策略级联（applyToolResultBudget → snipCompactIfNeeded → microcompact → contextCollapse → autocompact）
7. API 流式调用：src/services/api/claude.ts 的 client.beta.messages.stream() 发送请求 → 流式返回 content blocks
8. 流式工具执行：src/services/tools/StreamingToolExecutor.ts 在响应完成前即开始执行工具（并发安全工具并行，非安全工具串行）
9. 解析工具调用：从流式返回结果中提取工具名、参数 → Zod schema 验证（tool.inputSchema.safeParse）
10. 权限校验阶段：src/utils/permissions/permissions.ts 的 hasPermissionsToUseTool() 管道式决策链（deny rules → ask rules → checkPermissions → bypass-immune 检查 → bypass 模式 → alwaysAllow 规则 → ask）→ Auto 模式走 YOLO Classifier（src/utils/permissions/yoloClassifier.ts 的两阶段 LLM 分类）
11. Hook 执行：src/services/tools/toolHooks.ts 的 PreToolUse hooks（可修改输入、做权限决策、阻止执行）
12. 执行工具：src/services/tools/toolExecution.ts 的 runToolUse() → tool.call() 执行具体工具
13. PostToolUse hooks：可修改工具输出
14. 结果映射：tool.mapToolResultToToolResultBlockParam() 转为 API 格式 → 工具结果预算裁剪
15. 附件注入：记忆文件、排队命令、文件变更注入上下文
16. 多轮循环：重建消息状态 [...messagesForQuery, ...assistantMessages, ...toolResults]，回到步骤 6
17. 结束会话：多种退出条件（任务完成、maxTurns、用户中断、预算耗尽）→ 记忆保存、状态清理

# 第五章：权限模式源码深度解析
1. 7 种权限模式源码详解（src/types/permissions.ts + src/utils/permissions/PermissionMode.ts）：
   - default：所有非允许工具提示用户
   - plan：只读工具自动放行，写入工具阻止
   - acceptEdits：自动允许工作目录文件编辑
   - bypassPermissions：允许除 bypass-immune 安全检查外的所有操作
   - dontAsk：将所有 ask 决策转为 deny
   - auto：用 YOLO Classifier 代替用户提示（仅 ant 内部，受 TRANSCRIPT_CLASSIFIER feature flag 控制）
   - bubble：内部模式
2. YOLO Classifier 深度解析（src/utils/permissions/yoloClassifier.ts）：
   - 两阶段 XML 分类器（Stage 1 fast: max_tokens=64 + stop_sequences；Stage 2 thinking: max_tokens=4096 + chain-of-thought）
   - 紧凑对话记录构建（只用用户文本和 tool_use 块，防对抗性输入）
   - 每个工具的 toAutoClassifierInput() 控制暴露信息
   - 快速路径：安全工具白名单 isAutoModeAllowlistedTool() 跳过分类器
   - 熔断机制：连续拒绝过多则回退到交互式用户弹窗（src/utils/permissions/denialTracking.ts）
3. bypass-immune 安全检查（.git/、.claude/、.vscode/、shell 配置文件始终弹窗）
4. 权限规则源码（src/utils/permissions/permissionSetup.ts）：规则来源（userSettings / projectSettings / localSettings / flagSettings / policySettings / cliArg / command / session）
5. 如何自定义全局免确认
6. Bash 工具权限特殊逻辑（src/tools/BashTool/bashPermissions.ts）

# 第六章：记忆系统源码解析
1. 双层记忆架构：
   - CLAUDE.md 层：src/utils/claudemd.ts 的 getClaudeMds()，加载顺序（managed → user → project → local），支持 @include 指令，单文件上限 40000 字符
   - 记忆目录层：src/memdir/memdir.ts 的 loadMemoryPrompt()，路径 ~/.claude/projects/<slug>/memory/，入口 MEMORY.md（200 行/25KB 上限），4 种类型（user / feedback / project / reference），支持 frontmatter
2. 会话记忆持久化：src/services/SessionMemory/
3. 自动记忆抽取 Agent：src/services/extractMemories/（extractMemories.ts + prompts.ts）
4. 记忆更新、合并、覆盖规则：src/memdir/memoryTypes.ts 的类型分类模板
5. 记忆附件注入：query 循环中的 getAttachmentMessages() + startRelevantMemoryPrefetch()
6. 如何自定义个人专属 AI 记忆人设

# 第七章：工具系统源码深度解析
工具注册机制：src/Tool.ts 的 Tool 接口与 buildTool() 工厂、src/tools.ts 的 getAllBaseTools() + getTools() + assembleToolPool()

逐一解析核心工具原理（按 src/tools/ 下真实目录结构）：
- AgentTool/ — 子 Agent 生成（runAgent.ts、forkSubagent.ts、内置 Agent 定义）
- BashTool/ — Shell 命令执行（bashSecurity.ts 安全解析、bashPermissions.ts 权限、sandbox 沙盒）
- FileReadTool/ — 文件读取
- FileEditTool/ — 增量编辑（old_string/new_string 替换、陈旧检测、原子性读写、补丁生成）
- FileWriteTool/ — 文件写入
- GlobTool/ — 文件扫描（条件工具，嵌入式搜索不可用时启用）
- GrepTool/ — 代码检索（条件工具，嵌入式搜索不可用时启用）
- WebFetchTool/ — HTTP 请求
- WebSearchTool/ — Web 搜索
- NotebookEditTool/ — Jupyter Notebook 编辑
- TodoWriteTool/ — 待办事项写入
- AskUserQuestionTool/ — 交互式用户提问
- SkillTool/ — 技能调用
- EnterPlanModeTool/ / ExitPlanModeV2Tool/ — 计划模式切换
- ConfigTool/ — 配置工具（仅 ant 内部）
- LSPTool/ — LSP 工具（需 ENABLE_LSP_TOOL）
- EnterWorktreeTool/ / ExitWorktreeTool/ — 工作树操作
- SendMessageTool/ — Agent 间通信
- TaskOutputTool/ / TaskStopTool/ — 任务输出与停止
- TaskCreateTool/ / TaskGetTool/ / TaskUpdateTool/ / TaskListTool/ — 任务管理
- TeamCreateTool/ / TeamDeleteTool/ — 团队管理
- CronCreateTool/ / CronDeleteTool/ / CronListTool/ — 定时任务（需 AGENT_TRIGGERS feature flag）
- MonitorTool/ — 监控工具
- PowerShellTool/ — PowerShell 执行
- BriefTool/ — 简要工具
- ListMcpResourcesTool/ / ReadMcpResourceTool/ — MCP 资源
- ToolSearchTool/ — 工具搜索
- MCP 工具（动态加载，mcp__ 前缀命名）

工具执行管道：src/services/tools/toolExecution.ts 的 runToolUse()（工具查找 → Zod 验证 → PreToolUse hooks → 权限决策 → tool.call() → PostToolUse hooks → 结果映射）
并发调度：src/services/tools/StreamingToolExecutor.ts（流式路径）+ src/services/tools/toolOrchestration.ts 的 runTools()（非流式路径，并发安全工具并行、非安全工具串行）

# 第八章：高级架构设计与设计模式
1. Async Generator 模式：src/query.ts 的 query() 是 async generator，用 yield 流式产出消息
2. buildTool() 工厂模式：src/Tool.ts 的统一工具创建接口，自动填充 isEnabled/isReadOnly/checkPermissions 等默认值
3. Section 缓存模式：src/constants/systemPromptSections.ts 的 systemPromptSection()（memoized 缓存）与 DANGEROUS_uncachedSystemPromptSection()（每轮重算，破坏 prompt cache）
4. 管道式决策链模式：src/utils/permissions/permissions.ts 的 hasPermissionsToUseToolInner()（deny → ask → checkPermissions → bypass-immune → bypass → alwaysAllow → ask）
5. 流式并发调度模式：StreamingToolExecutor 的并发安全/非安全工具调度
6. Feature Flag 门控模式：GrowthBook feature flag 控制工具启用、功能开关
7. Hook 中间件模式：PreToolUse/PostToolUse hooks 可修改输入/输出、做权限决策
8. 多 Agent 编排模式：协调器模式（Coordinator 只用 AgentTool + SendMessage）、Fork 子 Agent（共享 prompt cache）、群组/队友 Agent（tmux/进程内/iTerm2 多后端）

# 第九章：常见问题 & 源码级答疑
所有用户疑惑从源码层面解释：
- 为什么 Auto 还会询问？（YOLO Classifier 熔断机制 + bypass-immune 安全检查）
- 为什么 Claude Code 能读懂整个项目？（上下文组装：CLAUDE.md + systemContext + 压缩策略）
- 它如何自主决策？（query() while(true) 循环 + LLM 返回 tool_use → 权限校验 → 执行 → 下一轮）
- 它的上下文是怎么拼接的？（prependUserContext + appendSystemContext + 5 级压缩级联）
- 如何彻底关闭所有确认弹窗？（bypassPermissions 模式 + alwaysAllow 规则）
- 如何自定义 AI 行为？（CLAUDE.md + 记忆目录 + hooks + skills + 自定义 system prompt）

# 第十章：二次开发与改造实战
教读者基于源码改造：
1. 自定义默认权限（settings.json 中的 alwaysAllow / deny 规则）
2. 新增自定义工具（参考 src/Tool.ts 的 buildTool() 接口 + 在 src/tools.ts 的 getAllBaseTools() 中注册）
3. 修改 AI 人格（CLAUDE.md + --system-prompt 参数 + systemPromptSections 覆盖）
4. 改造记忆系统（src/memdir/memoryTypes.ts 的类型定义 + CLAUDE.md 加载逻辑）
5. 改造自动执行逻辑（PermissionMode 选择 + hooks 钩子）
6. 新增技能（src/skills/ 目录下新增技能定义）
7. 新增 MCP 工具服务器（mcpServers 配置 + assembleToolPool() 集成）

====================
内容撰写硬性规则
====================
1. 所有讲解必须【源码级深度】，不是使用教程
2. 每一个知识点必须附带：原理 + 源码片段 + 执行流程 + 通俗解释
3. 所有流程必须图文化、流程化、结构化
4. 小白能看懂，高手能学深
5. 所有复杂逻辑必须配流程图
6. 全文中文，专业、清晰、体系完整
7. 严格对齐 dgai5016/Claude-Code 真实目录结构，**不虚构、不遗漏、不多写**任何文件/目录
8. 注明该源码是 restored/decompiled 的背景，部分代码可能不完整

====================
网站 UI 要求
====================
1. 基于 VitePress 构建，使用深色主题（VitePress 内置 dark mode）
2. VitePress 自带左侧固定目录导航（sidebar）
3. VitePress 自带顶部导航栏（navbar）
4. 代码高亮（VitePress 基于 Shiki，支持 TS/TSX 语法高亮）+ 代码一键复制（VitePress 内置）
5. 可跳转的章节锚点（VitePress 自动生成标题锚点）
6. 全文搜索（VitePress 内置搜索）
7. 适配电脑端浏览

====================
输出要求
====================
直接输出：
完整的 **VitePress 项目源码**，包含：
1. 项目配置文件（.vitepress/config.ts：导航栏、侧边栏、主题配置）
2. 每个章节一个 Markdown 文件（index.md、chapter-01.md ~ chapter-10.md）
3. package.json（含 vitepress 依赖和构建脚本）
4. 可通过 npm run docs:dev 本地预览，npm run docs:build 构建静态站点
5. 构建产物可直接部署到 Github Pages