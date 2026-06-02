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
章节设计逻辑
====================
遵循"认识它 → 看它跑 → 懂核心能力 → 懂安全机制 → 懂高级特性 → 逐文件吃透 → 提炼模式 → 实战改造"的学习路径：
- 第一阶段（Ch1-Ch3）：建立全局认知
- 第二阶段（Ch4-Ch7）：理解核心能力（通信、指令、记忆、工具）
- 第三阶段（Ch8-Ch9）：理解安全机制（权限、沙盒）
- 第四阶段（Ch10-Ch13）：理解高级特性（多Agent、压缩、扩展、命令）
- 第五阶段（Ch14）：逐文件全面覆盖
- 第六阶段（Ch15-Ch17）：提炼升华与实战

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

# 第二章：整体架构总览
对各子系统做高层概览（每个子系统 2-3 段介绍 + 核心文件路径 + 关键函数名），详细解析在后续独立章节中展开：
1. API 客户端与 LLM 通信层（→ 详见第四章）
2. System Prompt 系统（→ 详见第五章）
3. 记忆系统（→ 详见第六章）
4. 工具系统（→ 详见第七章）
5. 权限系统（→ 详见第八章）
6. 沙盒安全系统（→ 详见第九章）
7. 多 Agent 系统（→ 详见第十章）
8. 压缩与上下文管理（→ 详见第十一章）
9. Hook、插件与技能系统（→ 详见第十二章）
10. 斜杠命令系统（→ 详见第十三章）
11. 渲染系统（src/ink/ 自定义 Ink 渲染器 50 文件、src/components/ 146+ React 组件、src/screens/ 顶层屏幕 REPL.tsx）
12. Feature Flag 系统（GrowthBook feature flag 门控、TRANSCRIPT_CLASSIFIER / KAIROS / AGENT_TRIGGERS / CONTEXT_COLLAPSE 等关键 flag）

# 第三章：核心运行流程全链路源码逐行走读（真实源码链路版）
【阅读建议】本章是全文的"骨架"——先看懂整台机器怎么转，后续章节再逐个拆解每个零件。
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

# 第四章：API 客户端与 LLM 通信层深度解析
【为什么先学这章】Claude Code 的一切能力都建立在与 LLM 的通信之上——先理解"它怎么和 AI 对话"，才能理解后续所有子系统的设计动因。
1. API 客户端架构地位：Claude Code 与 Anthropic API 之间的桥梁
2. 主 API 客户端（src/services/api/claude.ts）：
   - client.beta.messages.stream() 流式请求构建
   - 请求参数组装：model、system prompt、messages、tools、cache_control、thinking config
   - 流式事件处理：message_start、content_block_start/delta/stop、message_delta、message_stop
   - 模型降级（fallback）：主模型失败时的重试策略
3. Prompt Cache 控制：
   - cache_control 在 system prompt blocks 上的标记
   - 缓存命中与 token 计费优化
   - 哪些内容标记为可缓存、缓存边界如何确定
4. Thinking 配置：
   - thinking 模式的启用与参数
   - thinking token 预算与扩展
5. 工具定义传递：如何将 buildTool() 定义的 Zod schema 转换为 API 的 tools 参数格式
6. 旁路查询 sideQuery（src/utils/sideQuery.ts）：
   - 与主 API 调用的区别（简化参数、不同 model 可配置）
   - 使用场景：YOLO 分类器、autocompact 压缩、工具结果摘要
   - CLAUDE_CODE_AUTO_MODE_MODEL 环境变量控制分类器使用的模型
7. 错误处理与重试：API 限流、网络错误的处理策略

# 第五章：System Prompt 深度解析
【为什么紧接 API 章】System Prompt 决定了"AI 收到什么指令"——理解了通信管道（Ch4），再看管道里传什么内容。
1. System Prompt 的架构地位：为什么它是 Claude Code 的"灵魂"
2. Section 机制详解：
   - src/constants/systemPromptSections.ts 的 systemPromptSection()（memoized 缓存，直到 /clear 或 /compact 才失效）
   - DANGEROUS_uncachedSystemPromptSection()（每轮重算，破坏 prompt cache，仅用于动态内容）
   - resolveSystemPromptSections() 解析所有 section
3. 主构建函数：src/constants/prompts.ts 的 getSystemPrompt(tools, model, dirs, mcpClients)
4. 每个 Section 段落详解（工具描述、权限规则、安全约束、记忆指令、输出格式要求等，需从源码中提取真实 section 名称和内容）
5. 优先级覆盖链：src/utils/systemPrompt.ts 的 buildEffectiveSystemPrompt()（override > coordinator > agent > custom > default）
6. 用户/系统上下文注入：src/context.ts 的 getUserContext()（CLAUDE.md + 日期）与 getSystemContext()（Git 状态 + 缓存破坏器）
7. 上下文组装：src/utils/queryContext.ts 的 fetchSystemPromptParts()
8. Prompt Cache 优化策略：哪些 section 缓存、哪些动态，以及为什么这样设计
9. 如何自定义 System Prompt（--system-prompt 参数、CLAUDE.md 注入、systemPromptSections 覆盖）

# 第六章：记忆系统源码解析
【为什么排在核心能力首位】记忆是 Claude Code "个性化"的关键——它让 AI 记住你是谁、你的项目是什么。
1. 双层记忆架构：
   - CLAUDE.md 层：src/utils/claudemd.ts 的 getClaudeMds()，加载顺序（managed → user → project → local），支持 @include 指令，单文件上限 40000 字符
   - 记忆目录层：src/memdir/memdir.ts 的 loadMemoryPrompt()，路径 ~/.claude/projects/<slug>/memory/，入口 MEMORY.md（200 行/25KB 上限），4 种类型（user / feedback / project / reference），支持 frontmatter
2. 会话记忆持久化：src/services/SessionMemory/
3. 自动记忆抽取 Agent：src/services/extractMemories/（extractMemories.ts + prompts.ts）
4. 记忆更新、合并、覆盖规则：src/memdir/memoryTypes.ts 的类型分类模板
5. 记忆附件注入：query 循环中的 getAttachmentMessages() + startRelevantMemoryPrefetch()
6. 如何自定义个人专属 AI 记忆人设

# 第七章：工具系统源码深度解析
【为什么排在核心能力末位】工具是 Claude Code "行动"的关键——它让 AI 能读写文件、执行命令。但工具的执行受权限（Ch8）和沙盒（Ch9）约束，所以先理解能力，再理解约束。
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

# 第八章：权限模式源码深度解析
【为什么紧接工具章】权限是工具的"守门员"——理解了工具能做什么（Ch7），自然会问"谁允许它这么做？"
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
5. 权限 UI 交互：src/components/permissions/ 的 30+ 组件 + src/hooks/toolPermission/ 的交互式处理器
6. 如何自定义全局免确认
7. Bash 工具权限特殊逻辑（src/tools/BashTool/bashPermissions.ts）

# 第九章：沙盒安全系统深度解析
【为什么紧接权限章】权限决定"允不允许"，沙盒决定"即使允许，也在笼子里执行"——两者构成完整的安全体系。
1. 沙盒架构概览：为什么需要沙盒、沙盒在整体安全中的位置
2. 沙盒运行时适配器：src/utils/sandbox/sandbox-adapter.ts（包装 @anthropic-ai/sandbox-runtime，Linux 上用 bubblewrap/bwrap，macOS 上用 sandbox-exec）
3. shouldUseSandbox() 判断逻辑：沙盒是否启用、命令是否被排除、dangerouslyDisableSandbox 标志
4. 沙盒配置详解（convertToSandboxRuntimeConfig）：
   - 网络控制：允许/拒绝的域名（从 WebFetch 权限规则 + 沙盒设置中提取）
   - 文件系统控制：allowWrite（cwd + 临时目录 + 额外目录）、denyWrite（.claude/settings.json 防沙盒逃逸、裸 Git 仓库文件）、denyRead、allowRead
   - 工作树处理：主仓库 .git 路径自动添加到 allowWrite
5. Bash 安全解析：src/tools/BashTool/bashSecurity.ts
   - 危险模式检测：命令替换、进程替换、Zsh 特定攻击（zmodload/emulate/sysopen/ztcp）、IFS 注入、反斜杠转义、大括号扩展、控制字符、Unicode 空格等
   - 引用内容提取与精细分析
   - tree-sitter AST 分析（当可用时）
6. 只读命令验证：src/tools/BashTool/ 的 readOnlyValidation.ts
7. 设置变更触发的动态沙盒重新配置
8. 沙盒逃逸防护：为什么 .claude/settings.json 被 denyWrite 保护

# 第十章：多 Agent 与协调器系统深度解析
1. 多 Agent 架构概览：为什么需要多 Agent、单 Agent 的局限性
2. AgentTool 核心实现（src/tools/AgentTool/）：
   - AgentTool.tsx — 主工具，支持同步（阻塞）和异步（后台）Agent 执行
   - runAgent.ts — 核心执行引擎，通过 query() 运行 Agent，带受限工具集
   - forkSubagent.ts — Fork 子 Agent：继承完整上下文，共享 prompt cache，防递归 fork
   - built-in/ — 内置 Agent 定义（generalPurposeAgent、exploreAgent、planAgent、verificationAgent、claudeCodeGuideAgent、statuslineSetup）
3. 协调器模式（src/coordinator/coordinatorMode.ts）：
   - Coordinator 角色只能使用 AgentTool + SendMessageTool + TaskStopTool
   - Worker Agent 通过 subagent_type: "worker" 生成
   - 通过 <task-notification> XML 块接收 Worker 结果
4. 群组/队友 Agent（src/tools/shared/spawnMultiAgent.ts）：
   - 多后端支持：tmux 窗格、进程内、iTerm2
   - Agent 生命周期管理
5. Agent 工具过滤：ASYNC_AGENT_ALLOWED_TOOLS 限制异步 Agent 可用工具（阻止 AgentTool 递归、TaskOutputTool、ExitPlanModeTool、AskUserQuestionTool 等）
6. Agent 独立 MCP 服务器：initializeAgentMcpServers() 初始化，完成后清理
7. 多 Agent 编排的设计权衡：什么时候用子 Agent、什么时候用协调器、什么时候用群组

# 第十一章：压缩与上下文管理深度解析
1. 为什么需要上下文压缩：LLM 上下文窗口限制、长对话的 token 消耗、prompt cache 优化
2. 5 级压缩策略级联详解（src/query.ts 的 queryLoop() 中执行）：
   - Level 1：applyToolResultBudget() — 工具结果大小预算裁剪
   - Level 2：snipCompactIfNeeded() — 历史 Snip 裁剪（需 HISTORY_SNIP feature flag）
   - Level 3：microcompact() — 微型压缩（cache-editing 变体）
   - Level 4：contextCollapse.applyCollapsesIfNeeded() — 上下文折叠（需 CONTEXT_COLLAPSE feature flag）
   - Level 5：autocompact() — 主自动压缩系统（用 LLM 总结历史消息）
3. Token 预算管理：src/query/tokenBudget.ts
4. 压缩边界追踪：compact boundary 标记与消息分段
5. 上下文拼接：prependUserContext() + appendSystemContext() 的具体实现
6. 旁路查询（sideQuery）：src/utils/sideQuery.ts，用于分类器、压缩、工具结果摘要等辅助 API 调用
7. Prompt Cache 与 token 成本优化：从压缩策略角度分析 cache 命中率对 token 计费的影响（section 缓存设计详见第五章、API 层 cache 控制详见第四章）

# 第十二章：Hook、插件与技能系统深度解析
1. Hook 系统（src/services/tools/toolHooks.ts）：
   - PreToolUse hooks：工具执行前运行，可修改输入（hookUpdatedInput）、做权限决策（hookPermissionResult）、阻止执行（preventContinuation / stop）
   - PostToolUse hooks：工具执行后运行，可修改 MCP 工具输出
   - Hook 配置方式：settings.json 中的 hooks 定义
   - 常见 Hook 使用场景
2. 插件系统（src/plugins/）：
   - builtinPlugins.ts — 内置插件注册表，插件 ID 格式 {name}@builtin
   - 插件可提供：技能、钩子、MCP 服务器
   - /plugin UI 切换插件
3. 技能系统（src/skills/）：
   - bundledSkills.ts — 捆绑技能定义
   - loadSkillsDir.ts — 从目录自动发现技能
   - bundled/ — 内置技能（verify、loop、debug、stuck、claudeApi 等）
   - SkillTool — 将技能调用为工具
   - 自定义技能创建方法
4. MCP 工具集成：
   - assembleToolPool() 将 MCP 工具与内置工具结合
   - MCP 工具命名：mcp__ 前缀
   - mcpServers 配置与生命周期管理
5. 三者关系：Hook 是底层拦截机制，插件是功能包，技能是用户可调用的命令——它们如何协同工作

# 第十三章：斜杠命令系统深度解析
1. 斜杠命令架构地位：用户与 Claude Code 交互的直接入口
2. 命令定义：src/commands.ts（25185 行）的命令注册与分发机制
3. 命令实现：src/commands/ 目录下的各命令模块
4. 命令与技能系统的关系：部分 /xxx 命令背后调用的是技能（SkillTool）
5. 常用命令源码解析：
   - /help — 帮助信息生成
   - /clear — 清除上下文与 section 缓存失效
   - /compact — 手动触发压缩
   - /config — 配置修改（与 ConfigTool 的关系）
   - /memory — 记忆管理（与记忆系统的交互）
   - /doctor — 诊断检查（与 Doctor.tsx 屏幕的关系）
   - /init — CLAUDE.md 初始化
   - /review、/security-review — 代码审查命令
   - 其他命令
6. 命令解析与路由：用户输入如何匹配到对应命令、参数如何传递
7. 命令权限控制：某些命令是否受权限模式影响
8. 自定义命令：如何通过技能系统扩展新的 /xxx 命令

# 第十四章：逐目录源码解析
【重要规则】到本章为止，读者已理解所有核心子系统。现在可以对每个目录和文件做完整的深度解析，因为读者已经具备了理解每个文件所需的上下文。
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

# 第十五章：高级架构设计与设计模式
【注意】本章不重复前述章节的具体源码逻辑，而是从架构设计视角提炼抽象模式，帮助读者建立设计思维。
1. Async Generator 驱动模式：用 async generator + yield 实现流式响应循环（不重复第三章源码走读，而是分析这种模式的通用优势和适用场景）
2. buildTool() 工厂模式：统一接口 + 默认值填充的扩展性设计（不重复第七章工具注册，而是分析工厂模式如何降低新增工具的门槛）
3. Section 缓存与失效模式：memoized 缓存 + 选择性失效的设计权衡（不重复第五章缓存策略，而是提炼"缓存什么/动态什么"的决策框架）
4. 管道式决策链模式：多步判断 + 短路返回的权限决策设计（不重复第八章权限逻辑，而是分析管道模式在安全系统中的通用价值）
5. 流式并发调度模式：并发安全/非安全的分类调度策略（不重复第七章并发调度，而是提炼读写分离调度的通用模式）
6. Feature Flag 门控模式：运行时功能开关的架构意义与实现方式
7. Hook 中间件模式：前置/后置拦截的扩展性设计（不重复第十二章 Hook 细节，而是分析中间件模式在工具系统中的通用价值）
8. 多 Agent 编排模式：协调器/子 Agent/群组三种编排策略的适用场景对比（不重复第十章实现细节，而是提炼多 Agent 编排的设计决策树）

# 第十六章：常见问题 & 源码级答疑
所有用户疑惑从源码层面解释：
- 为什么 Auto 还会询问？（YOLO Classifier 熔断机制 + bypass-immune 安全检查）
- 为什么 Claude Code 能读懂整个项目？（上下文组装：CLAUDE.md + systemContext + 压缩策略）
- 它如何自主决策？（query() while(true) 循环 + LLM 返回 tool_use → 权限校验 → 执行 → 下一轮）
- 它的上下文是怎么拼接的？（prependUserContext + appendSystemContext + 5 级压缩级联）
- 如何彻底关闭所有确认弹窗？（bypassPermissions 模式 + alwaysAllow 规则）
- 如何自定义 AI 行为？（CLAUDE.md + 记忆目录 + hooks + skills + 自定义 system prompt）
- 为什么长对话会变慢？（上下文压缩级联的开销 + prompt cache 失效）

# 第十七章：二次开发与改造实战
教读者基于源码改造：
1. 自定义默认权限（settings.json 中的 alwaysAllow / deny 规则）
2. 新增自定义工具（参考 src/Tool.ts 的 buildTool() 接口 + 在 src/tools.ts 的 getAllBaseTools() 中注册）
3. 修改 AI 人格（CLAUDE.md + --system-prompt 参数 + systemPromptSections 覆盖）
4. 改造记忆系统（src/memdir/memoryTypes.ts 的类型定义 + CLAUDE.md 加载逻辑）
5. 改造自动执行逻辑（PermissionMode 选择 + hooks 钩子）
6. 新增技能（src/skills/ 目录下新增技能定义）
7. 新增 MCP 工具服务器（mcpServers 配置 + assembleToolPool() 集成）
8. 自定义 Hook 拦截器（settings.json hooks 配置 + 常见 Hook 脚本示例）
9. 新增斜杠命令（通过技能系统扩展 /xxx 命令）

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
2. Markdown 文件按章节组织，每个章节一个目录，目录内可按需拆分子页面：
   - 内容较少的章节（如 Ch1 前置认知、Ch16 FAQ）：一个 index.md 即可
   - 内容较多的章节（如 Ch7 工具系统、Ch14 逐目录解析、Ch5 System Prompt）需拆分子页面，避免单文件过长
   - 目录结构示例：
     ```
     docs/
     ├── index.md                          # 首页
     ├── chapter-01/index.md               # 前置认知
     ├── chapter-02/index.md               # 整体架构总览
     ├── chapter-03/index.md               # 核心运行流程全链路
     ├── chapter-04/index.md               # API 客户端与 LLM 通信层
     ├── chapter-05/
     │   ├── index.md                      # System Prompt 概览 + Section 机制
     │   ├── sections-detail.md            # 每个 Section 段落详解
     │   └── customization.md              # 自定义 System Prompt
     ├── chapter-06/index.md               # 记忆系统
     ├── chapter-07/
     │   ├── index.md                      # 工具注册机制 + 执行管道
     │   ├── tool-file.md                  # 文件操作工具（Read/Edit/Write/Notebook）
     │   ├── tool-search.md                # 搜索工具（Glob/Grep）
     │   ├── tool-bash.md                  # Bash 工具
     │   ├── tool-agent.md                 # AgentTool（概要，详见 Ch10）
     │   ├── tool-web.md                   # Web 工具（Fetch/Search）
     │   ├── tool-other.md                 # 其他工具（Todo/Ask/Config/LSP/Worktree/Cron 等）
     │   └── tool-mcp.md                   # MCP 工具集成
     ├── chapter-08/index.md               # 权限模式
     ├── chapter-09/index.md               # 沙盒安全系统
     ├── chapter-10/index.md               # 多 Agent 与协调器
     ├── chapter-11/index.md               # 压缩与上下文管理
     ├── chapter-12/index.md               # Hook、插件与技能
     ├── chapter-13/index.md               # 斜杠命令系统
     ├── chapter-14/
     │   ├── index.md                      # 逐目录解析概览
     │   ├── entrypoints.md                # entrypoints/ + main.tsx + query.ts 等核心文件
     │   ├── services.md                   # services/（api/ + tools/ + SessionMemory/ + extractMemories/）
     │   ├── tools.md                      # tools/ 54 个子目录
     │   ├── utils.md                      # utils/（permissions/ + claudemd + sandbox 等）
     │   ├── components.md                 # components/ + ink/ + screens/
     │   ├── infra.md                      # bootstrap/ + state/ + jobs/ + tasks/ + server/ 等
     │   └── features.md                   # coordinator/ + plugins/ + skills/ + commands/ + vim/ 等
     ├── chapter-15/index.md               # 设计模式
     ├── chapter-16/index.md               # FAQ
     └── chapter-17/index.md               # 二次开发实战
     ```
3. package.json（含 vitepress 依赖和构建脚本）
4. 可通过 npm run docs:dev 本地预览，npm run docs:build 构建静态站点
5. 构建产物可直接部署到 Github Pages