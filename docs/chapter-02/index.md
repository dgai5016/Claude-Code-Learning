# 第二章：整体架构总览

::: tip 阅读建议
本章是整站的"地图"——先看懂 12 个子系统各自干什么、怎么协作，后续章节再逐个深入拆解。每个子系统 2-3 段介绍 + 核心文件路径 + 关键函数名，不展开源码细节。
:::

---

## 架构协作全景

上一章我们看了整体架构大图，现在把 12 个子系统之间的关系用"数据流"串起来——用户输入一条命令后，数据在这些子系统之间如何流转：

```
用户输入
  │
  ▼
┌─────────────────────────────────────────────────────────┐
│ 1. System Prompt 系统                                    │
│    getSystemPrompt() → systemPromptSection() → 组装提示词  │
│    ↑ 注入记忆（6）  ↑ 注入上下文（context.ts）             │
├─────────────────────────────────────────────────────────┤
│ 2. API 通信层                                            │
│    queryModelWithStreaming() → 发给 Anthropic API         │
│    ← 流式返回 text / tool_use 块                         │
├─────────────────────────────────────────────────────────┤
│ 3. 工具系统                                              │
│    runToolUse() → 查找工具 → 验证参数 → 执行             │
│    ↑ 权限校验（8）  ↑ Hook 拦截（9）  ↑ 沙盒隔离（7）     │
├─────────────────────────────────────────────────────────┤
│ 4. 压缩系统                                              │
│    autocompact() → 5 级级联 → 缩减上下文 → 回到步骤 1    │
└─────────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────────────────┐
│ 横切关注点（贯穿所有子系统）                               │
│ • 多 Agent 系统 — 子 Agent / 协调器 / 群组               │
│ • Hook / 插件 / 技能 — 拦截 / 扩展 / 命令                │
│ • 斜杠命令 — 用户交互入口                                 │
│ • 渲染系统 — Ink/React 终端 UI                           │
│ • Feature Flag — 运行时功能开关                           │
└─────────────────────────────────────────────────────────┘
```

下面逐个子系统做高层概览。

---

## 1. API 客户端与 LLM 通信层

::: details → 详见第四章
:::

Claude Code 的一切能力都建立在与 LLM 的通信之上。API 通信层是 Claude Code 与 Anthropic API 之间的桥梁，负责把"本地状态"转化为"API 请求"，再把"流式响应"转化为"内部事件"。

### 核心职责

1. **流式请求构建**：将消息历史、系统提示词、工具列表、思考配置等组装为 `client.beta.messages.stream()` 的参数
2. **流式事件处理**：逐个解析 `message_start`、`content_block_start/delta/stop`、`message_delta` 等流式事件
3. **Prompt Cache 控制**：在系统提示词块上标记 `cache_control`，优化缓存命中率
4. **模型降级**：主模型失败时，`FallbackTriggeredError` 触发切换到降级模型重试
5. **旁路查询**：`sideQuery` 用于 YOLO 分类器、autocompact 压缩等辅助 API 调用

### 核心文件与函数

| 文件 | 关键函数 | 作用 |
|------|---------|------|
| `src/services/api/claude.ts` | `queryModelWithStreaming()` | 流式 API 调用主函数 |
| | `queryModelWithoutStreaming()` | 非流式 API 调用 |
| | `buildSystemPromptBlocks()` | 将系统提示词组装为 API 块 |
| | `addCacheBreakpoints()` | 注入 Prompt Cache 边界 |
| | `updateUsage()` / `accumulateUsage()` | Token 用量追踪 |
| | `queryHaiku()` / `queryWithModel()` | 便捷查询函数 |
| `src/utils/sideQuery.ts` | `sideQuery()` | 旁路查询（独立于主 API 调用） |
| `src/services/api/withRetry.ts` | `FallbackTriggeredError` | 模型降级触发 |
| `src/services/api/errors.ts` | `PROMPT_TOO_LONG_ERROR_MESSAGE` | API 错误定义 |

---

## 2. System Prompt 系统

::: details → 详见第五章
:::

System Prompt 决定了"AI 收到什么指令"——理解了通信管道（子系统 1），再看管道里传什么内容。Claude Code 的系统提示词不是一段静态文本，而是一个**分段的、可缓存的、有优先级覆盖的动态构建系统**。

### 核心职责

1. **Section 机制**：将系统提示词拆分为多个 Section，每个 Section 独立计算、独立缓存
2. **缓存与失效**：`systemPromptSection()` 创建缓存段（`/clear` 或 `/compact` 时才失效），`DANGEROUS_uncachedSystemPromptSection()` 创建动态段（每轮重算，会破坏 Prompt Cache）
3. **优先级覆盖**：override > coordinator > agent > custom > default，不同角色可以注入不同的系统提示词
4. **上下文注入**：用户上下文（CLAUDE.md + 日期）+ 系统上下文（Git 状态 + 缓存破坏器）

### 核心文件与函数

| 文件 | 关键函数 | 作用 |
|------|---------|------|
| `src/constants/prompts.ts` | `getSystemPrompt(tools, model, dirs, mcpClients)` | 系统提示词主构建函数 |
| | `computeEnvInfo()` / `computeSimpleEnvInfo()` | 环境信息计算 |
| | `DEFAULT_AGENT_PROMPT` | 默认 Agent 提示词常量 |
| | `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` | 动态/缓存边界标记 |
| `src/constants/systemPromptSections.ts` | `systemPromptSection()` | 创建缓存段 |
| | `DANGEROUS_uncachedSystemPromptSection()` | 创建动态段 |
| | `resolveSystemPromptSections()` | 并行解析所有段 |
| | `clearSystemPromptSections()` | 清除缓存（`/clear` 和 `/compact` 时调用） |
| `src/utils/systemPrompt.ts` | `buildEffectiveSystemPrompt()` | 优先级覆盖链构建 |
| `src/utils/queryContext.ts` | `fetchSystemPromptParts()` | 最终上下文组装 |
| `src/context.ts` | `getSystemContext()` / `getUserContext()` | 系统/用户上下文获取 |

---

## 3. 记忆系统

::: details → 详见第六章
:::

记忆是 Claude Code "个性化"的关键——它让 AI 记住你是谁、你的项目是什么、你希望它怎么工作。Claude Code 采用**双层记忆架构**：CLAUDE.md 层（项目级配置）和记忆目录层（跨会话持久化）。

### 核心职责

1. **CLAUDE.md 加载**：按优先级加载 4 层 CLAUDE.md（managed → user → project → local），支持 `@include` 指令，单文件上限 40000 字符
2. **记忆目录管理**：`~/.claude/projects/<slug>/memory/` 下的 MEMORY.md 入口文件（200 行 / 25KB 上限），4 种记忆类型（user / feedback / project / reference）
3. **自动记忆抽取**：`extractMemories` Agent 从对话中自动提取值得记住的信息
4. **附件注入**：在 Agent 循环中将相关记忆作为附件注入上下文

### 核心文件与函数

| 文件 | 关键函数 | 作用 |
|------|---------|------|
| `src/utils/claudemd.ts` | `getClaudeMds()` | 按优先级组装所有 CLAUDE.md 内容 |
| | `getMemoryFiles()` | 发现所有记忆文件（memoized） |
| | `processMemoryFile()` | 处理单个 CLAUDE.md 文件 |
| | `MAX_MEMORY_CHARACTER_COUNT = 40000` | 单文件字符上限 |
| `src/memdir/memdir.ts` | `loadMemoryPrompt()` | 记忆目录加载主入口 |
| | `buildMemoryPrompt()` | 构建记忆提示词 |
| | `truncateEntrypointContent()` | 截断 MEMORY.md 到上限 |
| | `ENTRYPOINT_NAME = 'MEMORY.md'` | 入口文件名 |
| | `MAX_ENTRYPOINT_LINES = 200` | 行数上限 |
| | `MAX_ENTRYPOINT_BYTES = 25_000` | 字节上限 |
| `src/memdir/memoryTypes.ts` | 记忆类型定义 | user / feedback / project / reference |
| `src/services/extractMemories/` | `extractMemories.ts` + `prompts.ts` | 自动记忆抽取 |
| `src/services/SessionMemory/` | `sessionMemory.ts` | 会话记忆持久化 |

---

## 4. 工具系统

::: details → 详见第七章
:::

工具是 Claude Code "行动"的关键——它让 AI 能读写文件、执行命令、搜索代码。Claude Code 有 52 个内置工具子目录 + 动态加载的 MCP 工具，通过统一的 `Tool` 接口和 `buildTool()` 工厂注册。

### 核心职责

1. **工具注册**：`getAllBaseTools()` 列出所有内置工具，`getTools()` 按权限过滤，`assembleToolPool()` 合并 MCP 工具
2. **执行管道**：查找工具 → Zod 验证 → PreToolUse hooks → 权限决策 → `tool.call()` → PostToolUse hooks → 结果映射
3. **并发调度**：并发安全工具并行执行，非安全工具串行执行
4. **流式工具执行**：LLM 还在输出时就提前开始执行工具，加速响应

### 核心文件与函数

| 文件 | 关键函数/类型 | 作用 |
|------|-------------|------|
| `src/Tool.ts` | `Tool<Input, Output, P>` | 工具接口定义（call/description/isConcurrencySafe/checkPermissions 等） |
| | `buildTool()` | 工具工厂函数 |
| | `Tools = readonly Tool[]` | 工具列表类型 |
| | `findToolByName()` | 按名称查找工具 |
| `src/tools.ts` | `getAllBaseTools()` | 列出所有基础工具 |
| | `getTools()` | 按权限过滤工具 |
| `src/services/tools/toolExecution.ts` | `runToolUse()` | 单个工具执行主函数 |
| `src/services/tools/StreamingToolExecutor.ts` | `StreamingToolExecutor` 类 | 流式工具执行器（并发安全工具并行） |
| `src/services/tools/toolOrchestration.ts` | `runTools()` | 非流式工具编排（并发/串行调度） |
| `src/tools/` | 52 个子目录 | 各工具的具体实现 |

---

## 5. 权限系统

::: details → 详见第八章
:::

权限是工具的"守门员"——理解了工具能做什么（子系统 4），自然会问"谁允许它这么做？"。权限系统在每次工具执行前做决策：允许、拒绝、还是问用户。

### 核心职责

1. **7 种权限模式**：default / plan / acceptEdits / bypassPermissions / dontAsk / auto / bubble
2. **管道式决策链**：`hasPermissionsToUseTool()` 按顺序检查：deny rules → ask rules → checkPermissions → bypass-immune → bypass 模式 → alwaysAllow 规则 → ask 用户
3. **YOLO 分类器**：Auto 模式的核心——两阶段 LLM 分类器，决定工具调用是否自动放行
4. **熔断机制**：连续拒绝过多时，回退到交互式用户弹窗
5. **bypass-immune 安全检查**：`.git/`、`.claude/settings.json` 等始终需要用户确认

### 核心文件与函数

| 文件 | 关键函数 | 作用 |
|------|---------|------|
| `src/utils/permissions/permissions.ts` | `hasPermissionsToUseTool()` | 权限决策主函数 |
| | `checkRuleBasedPermissions()` | 基于规则的权限检查 |
| | `getAllowRules()` / `getDenyRules()` / `getAskRules()` | 获取各类规则 |
| `src/utils/permissions/PermissionMode.ts` | `permissionModeSchema` | 7 种模式定义 |
| | `permissionModeTitle()` / `permissionModeSymbol()` | 模式显示名和图标 |
| `src/utils/permissions/yoloClassifier.ts` | `classifyYoloAction()` | YOLO 分类器主函数 |
| | `buildYoloSystemPrompt()` | 构建分类器系统提示词 |
| | `buildTranscriptForClassifier()` | 构建分类器输入 |
| | `getDefaultExternalAutoModeRules()` | 默认 Auto 模式规则 |
| `src/utils/permissions/denialTracking.ts` | 熔断机制 | 连续拒绝过多时回退 |
| `src/utils/permissions/permissionSetup.ts` | 规则来源管理 | 8 种规则来源的加载 |
| `src/utils/permissions/filesystem.ts` | 文件权限匹配 | 文件读写权限的路径匹配 |
| `src/utils/permissions/yolo-classifier-prompts/` | 3 个提示词文件 | 分类器的系统提示词 |
| `src/types/permissions.ts` | 类型定义 | 权限模式、规则、决策类型 |

---

## 6. 沙盒安全系统

::: details → 详见第九章
:::

权限决定"允不允许"，沙盒决定"即使允许，也在笼子里执行"——两者构成完整的安全体系。沙盒在操作系统层面隔离工具执行，防止恶意代码突破工作目录。

### 核心职责

1. **沙盒运行时适配**：Linux 上用 bubblewrap/bwrap，macOS 上用 sandbox-exec
2. **网络控制**：允许/拒绝特定域名的网络访问（从 WebFetch 权限规则 + 沙盒设置中提取）
3. **文件系统控制**：allowWrite（工作目录 + 临时目录）、denyWrite（`.claude/settings.json` 防沙盒逃逸）、denyRead、allowRead
4. **Bash 安全解析**：检测危险模式（命令替换、进程替换、Zsh 特定攻击、IFS 注入等）
5. **沙盒逃逸防护**：为什么 `.claude/settings.json` 被 denyWrite 保护——防止 AI 修改自己的权限配置

### 核心文件与函数

| 文件 | 关键函数 | 作用 |
|------|---------|------|
| `src/utils/sandbox/sandbox-adapter.ts` | `convertToSandboxRuntimeConfig()` | 将设置转换为沙盒运行时配置 |
| | `SandboxManager` | 沙盒管理器实例 |
| | `resolvePathPatternForSandbox()` | 解析沙盒路径模式 |
| | `addToExcludedCommands()` | 添加沙盒排除命令 |
| `src/tools/BashTool/bashSecurity.ts` | Bash 安全解析 | 危险模式检测 |
| `src/tools/BashTool/bashPermissions.ts` | Bash 权限 | Shell 命令权限特殊逻辑 |
| `src/tools/BashTool/` | `readOnlyValidation.ts` | 只读命令验证 |

---

## 7. 多 Agent 系统

::: details → 详见第十章
:::

单 Agent 能力有限——它同一时间只能做一件事。多 Agent 系统让 Claude Code 能同时执行多个子任务，或者让一个"协调器"指挥多个"工人"协作。

### 核心职责

1. **子 Agent 生成**：`AgentTool` 支持同步（阻塞）和异步（后台）Agent 执行，带受限工具集
2. **Fork 子 Agent**：`forkSubagent()` 继承完整上下文，共享 Prompt Cache，防递归 Fork
3. **协调器模式**：Coordinator 角色只能使用 AgentTool + SendMessageTool + TaskStopTool，Worker Agent 通过 `task-notification` 接收结果
4. **群组/队友 Agent**：多后端支持（tmux 窗格、进程内、iTerm2），Agent 生命周期管理
5. **工具过滤**：`ASYNC_AGENT_ALLOWED_TOOLS` 限制异步 Agent 可用工具

### 核心文件与函数

| 文件 | 关键函数 | 作用 |
|------|---------|------|
| `src/tools/AgentTool/AgentTool.tsx` | AgentTool 定义 | 主工具，支持同步/异步模式 |
| `src/tools/AgentTool/runAgent.ts` | `runAgent()` | 核心执行引擎，通过 `query()` 运行子 Agent |
| `src/tools/AgentTool/forkSubagent.ts` | `forkSubagent()` | Fork 子 Agent |
| `src/tools/AgentTool/built-in/` | 内置 Agent 定义 | generalPurpose / explore / plan / verification / claudeCodeGuide / statuslineSetup |
| `src/coordinator/coordinatorMode.ts` | `isCoordinatorMode()` | 协调器模式检查 |
| | `getCoordinatorSystemPrompt()` | 协调器系统提示词 |
| | `getCoordinatorUserContext()` | 协调器用户上下文 |
| `src/coordinator/workerAgent.ts` | `workerAgent` | Worker Agent 定义 |
| `src/tools/shared/spawnMultiAgent.ts` | 群组 Agent | tmux / 进程内 / iTerm2 多后端 |

---

## 8. 压缩与上下文管理

::: details → 详见第十一章
:::

LLM 有上下文窗口限制（200K token），长对话会消耗大量 token 并触发速率限制。压缩系统通过 5 级级联策略，在对话过长时智能缩减上下文，让 Agent 能长时间运行。

### 核心职责

1. **5 级压缩级联**（由轻到重）：
   - L1：`applyToolResultBudget()` — 工具结果大小裁剪
   - L2：`snipCompactIfNeeded()` — 历史消息 Snip 裁剪
   - L3：`microcompact()` — 微型压缩（cache-editing）
   - L4：`contextCollapse()` — 上下文折叠
   - L5：`autocompact()` — 主自动压缩（LLM 总结历史）
2. **Token 预算管理**：检查当前轮是否超过预算，决定继续还是停止
3. **Prompt Cache 优化**：哪些 Section 缓存、哪些动态，以及缓存命中率对 token 计费的影响

### 核心文件与函数

| 文件 | 关键函数 | 作用 |
|------|---------|------|
| `src/services/compact/autoCompact.ts` | `shouldAutoCompact()` | 判断是否需要压缩 |
| | `autoCompactIfNeeded()` | 执行自动压缩 |
| | `calculateTokenWarningState()` | 计算 token 警告状态 |
| | `isAutoCompactEnabled()` | 是否启用自动压缩 |
| | `AUTOCOMPACT_BUFFER_TOKENS = 13_000` | 压缩缓冲区大小 |
| `src/services/compact/compact.ts` | `buildPostCompactMessages()` | 构建压缩后的消息 |
| `src/services/compact/microCompact.ts` | `microcompact()` | 微型压缩 |
| `src/services/compact/reactiveCompact.ts` | `reactiveCompact` | 反应式压缩（413 时触发） |
| `src/services/compact/snipCompact.ts` | `snipCompactIfNeeded()` | Snip 裁剪 |
| `src/services/contextCollapse/` | `applyCollapsesIfNeeded()` | 上下文折叠 |
| `src/query/tokenBudget.ts` | `checkTokenBudget()` | Token 预算检查 |
| `src/utils/toolResultStorage.ts` | `applyToolResultBudget()` | 工具结果裁剪（L1） |

---

## 9. Hook、插件与技能系统

::: details → 详见第十二章
:::

这三者构成 Claude Code 的扩展体系：Hook 是底层拦截机制（在工具执行前后做处理），插件是功能包（可以提供技能、钩子、MCP 服务器），技能是用户可调用的命令（`/xxx`）。

### 核心职责

**Hook 系统**：
- PreToolUse hooks：工具执行前运行，可修改输入、做权限决策、阻止执行
- PostToolUse hooks：工具执行后运行，可修改工具输出

**插件系统**：
- 内置插件注册表，插件 ID 格式 `{name}@builtin`
- 插件可提供：技能、钩子、MCP 服务器

**技能系统**：
- 捆绑技能定义（verify、loop、debug、stuck、claudeApi 等）
- 从目录自动发现自定义技能
- SkillTool 将技能调用为工具

### 核心文件与函数

| 文件 | 关键函数 | 作用 |
|------|---------|------|
| `src/services/tools/toolHooks.ts` | `runPreToolUseHooks()` | 前置钩子执行 |
| | `runPostToolUseHooks()` | 后置钩子执行 |
| | `resolveHookPermissionDecision()` | 从钩子解析权限决策 |
| `src/plugins/builtinPlugins.ts` | `registerBuiltinPlugin()` | 注册内置插件 |
| | `getBuiltinPlugins()` | 获取所有内置插件 |
| | `isBuiltinPluginId()` | 判断是否内置插件 |
| `src/skills/bundledSkills.ts` | `registerBundledSkill()` | 注册捆绑技能 |
| | `getBundledSkills()` | 获取所有捆绑技能 |
| `src/skills/loadSkillsDir.ts` | `loadSkillsDir()` | 从目录发现自定义技能 |
| `src/skills/bundled/` | 18 个技能文件 | 内置技能实现 |

---

## 10. 斜杠命令系统

::: details → 详见第十三章
:::

斜杠命令是用户与 Claude Code 交互的直接入口——输入 `/help`、`/compact`、`/doctor` 等，执行各种操作。命令系统负责命令的注册、路由、参数解析和分发。

### 核心职责

1. **命令定义与注册**：`src/commands.ts`（25185 行）定义所有命令的参数和注册信息
2. **命令实现**：`src/commands/` 下 100+ 个子目录，每个命令一个目录
3. **命令与技能的关系**：部分 `/xxx` 命令背后调用的是技能（SkillTool）
4. **命令路由**：用户输入如何匹配到对应命令、参数如何传递

### 核心文件与函数

| 文件 | 作用 |
|------|------|
| `src/commands.ts` | 命令定义（25185 行超大文件） |
| `src/commands/` | 命令实现（100+ 子目录） |

**常用命令目录**：

| 目录 | 对应命令 | 作用 |
|------|---------|------|
| `commands/help/` | `/help` | 帮助信息 |
| `commands/clear/` | `/clear` | 清除上下文，使 Section 缓存失效 |
| `commands/compact/` | `/compact` | 手动触发压缩 |
| `commands/config/` | `/config` | 配置修改 |
| `commands/memory/` | `/memory` | 记忆管理 |
| `commands/doctor/` | `/doctor` | 诊断检查 |
| `commands/init/` | `/init` | CLAUDE.md 初始化 |
| `commands/review/` | `/review` | 代码审查 |
| `commands/security-review/` | `/security-review` | 安全审查 |
| `commands/model/` | `/model` | 切换模型 |
| `commands/permissions/` | `/permissions` | 权限管理 |
| `commands/mcp/` | `/mcp` | MCP 服务器管理 |

---

## 11. 渲染系统

Claude Code 的终端 UI 是一个完整的 React 应用——用 Ink（React 终端渲染框架）+ 自定义 Reconciler + 150+ React 组件，在终端中渲染出丰富的交互界面。

### 核心职责

1. **自定义 Ink 渲染器**：50+ 文件，包含 React Reconciler 适配、屏幕管理、终端 I/O、布局引擎
2. **React 组件库**：150+ 组件，涵盖权限交互、消息渲染、代码高亮、差异对比等
3. **顶层屏幕**：`REPL.tsx` 是主界面，`Doctor.tsx` 是诊断页面

### 核心文件

| 文件/目录 | 作用 |
|----------|------|
| `src/ink/ink.tsx` (251886 字节) | 核心渲染引擎——项目中最大的单文件 |
| `src/ink/reconciler.ts` | React Reconciler 适配——将 React 组件树渲染为终端文本 |
| `src/ink/screen.ts` | 屏幕管理——终端缓冲区和刷新 |
| `src/ink/components/` | Ink 基础组件——Box / Text / Button / ScrollBox / Link 等 18 个组件 |
| `src/ink/termio/` | 终端 I/O——底层输入输出处理 |
| `src/components/App.tsx` | 主应用组件 |
| `src/components/permissions/` | 权限交互组件（30+ 文件） |
| `src/components/messages/` | 消息渲染组件 |
| `src/components/PromptInput/` | 用户输入框（自动补全、@提及） |
| `src/components/diff/` | 差异显示组件 |
| `src/components/HighlightedCode/` | 代码高亮组件 |
| `src/screens/REPL.tsx` | REPL 主界面 |
| `src/screens/Doctor.tsx` | 诊断页面 |
| `src/screens/ResumeConversation.tsx` | 恢复会话页面 |

---

## 12. Feature Flag 系统

Claude Code 大量使用 Feature Flag（功能开关）来控制功能的启用/关闭。这些 Flag 由 GrowthBook 提供，可以在不修改代码的情况下远程控制功能。

### 核心职责

1. **运行时功能门控**：`feature()` 函数在构建时做死代码消除，`getFeatureValue_CACHED_MAY_BE_STALE()` 在运行时读取值
2. **渐进式发布**：新功能先对少量用户开放，验证后再全量发布
3. **紧急开关**：可以远程关闭有问题的功能，无需发版

### 核心文件与函数

| 文件 | 关键函数 | 作用 |
|------|---------|------|
| `src/services/analytics/growthbook.ts` | `getFeatureValue_CACHED_MAY_BE_STALE()` | 快速读取 Feature Flag 值 |
| | `getFeatureValue_CACHED_WITH_REFRESH()` | 读取并刷新值 |
| | `checkStatsigFeatureGate_CACHED_MAY_BE_STALE()` | 检查功能门控 |
| | `getDynamicConfig_BLOCKS_ON_INIT()` | 获取动态配置（阻塞等待初始化） |
| `bun:bundle` | `feature()` | 构建时死代码消除的 feature flag |

### 关键 Feature Flag

| Flag | 作用 |
|------|------|
| `TRANSCRIPT_CLASSIFIER` | 启用 Auto 模式的 YOLO 分类器 |
| `BASH_CLASSIFIER` | 启用 Bash 命令快速分类 |
| `KAIROS` | 助手模式（后台自主运行的 Agent） |
| `PROACTIVE` | 主动式 Agent |
| `COORDINATOR_MODE` | 多 Worker 协调器模式 |
| `TEAMMEM` | 团队记忆共享 |
| `HISTORY_SNIP` | 历史 Snip 裁剪（压缩 Level 2） |
| `CONTEXT_COLLAPSE` | 上下文折叠（压缩 Level 4） |
| `REACTIVE_COMPACT` | 反应式压缩（413 时触发） |
| `CACHED_MICROCOMPACT` | 缓存微型压缩 |
| `TOKEN_BUDGET` | Token 预算管理 |
| `BG_SESSIONS` | 后台会话系统 |
| `TEMPLATES` | 模板任务系统 |
| `EXPERIMENTAL_SKILL_SEARCH` | 实验性技能搜索 |
| `BRIDGE_MODE` | Bridge 通信模式 |
| `DAEMON` | 守护进程模式 |
| `CHICAGO_MCP` | Computer Use MCP 集成 |

---

## 子系统协作速查表

| 子系统 | 依赖 | 被依赖 | 核心概念 |
|--------|------|--------|---------|
| API 通信层 | System Prompt | 工具系统、压缩系统 | "与 AI 对话的管道" |
| System Prompt | 记忆系统、上下文 | API 通信层 | "AI 收到的指令" |
| 记忆系统 | 无 | System Prompt、Hook | "AI 记住你是谁" |
| 工具系统 | 权限系统、沙盒 | Agent 循环 | "AI 的手脚" |
| 权限系统 | Feature Flag | 工具系统 | "谁能做什么" |
| 沙盒系统 | 权限系统 | 工具系统（Bash） | "在笼子里执行" |
| 多 Agent | 工具系统、权限 | Agent 循环 | "多任务并行" |
| 压缩系统 | API 通信层 | Agent 循环 | "对话太长就压缩" |
| Hook/插件/技能 | 工具系统 | 斜杠命令 | "拦截和扩展" |
| 斜杠命令 | 技能系统 | REPL | "用户交互入口" |
| 渲染系统 | 所有子系统 | 无 | "让用户看到一切" |
| Feature Flag | GrowthBook | 所有子系统 | "远程控制开关" |

---

## 本章小结

本章对 Claude Code 的 12 个核心子系统做了高层概览。每个子系统我们知道了：

- **它干什么**：核心职责和设计意图
- **它在哪里**：核心文件路径
- **它的入口**：关键函数名
- **它与谁协作**：依赖关系

下一章我们将进入最硬核的部分——**全链路源码逐行走读**，完整复现一次用户输入命令后的执行流程。
