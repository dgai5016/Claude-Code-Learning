# 第一章：前置认知（必须看懂）

::: tip 阅读建议
本章是整站的"地基"——先建立全局认知，后续章节才能逐层深入。如果你已经熟悉 AI Agent 概念，可以重点阅读第 4-7 节。
:::

---

## 1. Claude Code 是什么？与普通对话模型的区别

### 1.1 Claude Code 的定义

Claude Code 是 Anthropic 官方发布的 **AI 编程 Agent CLI 工具**。它不是浏览器里的聊天框，而是一个运行在终端中的、拥有完整行动能力的 AI Agent 运行时。

用一句话概括：

> **普通对话模型只能"说"，Claude Code 既能"说"也能"做"。**

### 1.2 本质区别

| 维度 | 普通对话模型（如 ChatGPT Web） | Claude Code |
|------|------|------|
| **运行环境** | 浏览器沙盒 | 本地终端，直接访问文件系统和进程 |
| **行动能力** | 只能生成文本回复 | 能执行命令、读写文件、搜索代码、访问网络 |
| **交互模式** | 一问一答 | 多轮自主循环（LLM 决定是否继续行动） |
| **权限控制** | 无（被隔离在浏览器中） | 7 种权限模式 + 沙盒隔离 |
| **记忆能力** | 会话内记忆 | 跨会话记忆（CLAUDE.md + 记忆目录） |
| **扩展性** | 插件系统（有限） | 工具系统 + MCP + Hooks + 技能 + 插件 |
| **多 Agent** | 无 | 子 Agent / 协调器 / 群组三种编排模式 |

### 1.3 从源码看本质

Claude Code 的核心在 `src/query.ts`。这个文件只有两个导出函数：`query()` 和 `queryLoop()`。前者是薄薄的外壳，后者是真正的"心脏"——一个 `while(true)` 无限循环的 async generator。

在读源码之前，你必须先理解一个关键语法：**`yield`**。

#### 1.3.1 前置知识：理解 yield

`yield` 是 JavaScript generator 函数的关键字，作用是**"暂停函数执行，把一个值吐给调用者"**。

用一个生活比喻来理解：

```
你（调用者）在餐厅点了一道多道菜的套餐。
厨师（generator 函数）做好一道菜，就端出来给你（yield），
等你吃完了，厨师再接着做下一道（恢复执行）。
厨师不需要把所有菜都做完才端出来——边做边端，你边吃边等。
```

对比普通函数：

```typescript
// 普通函数：一口气做完，一次性返回
function makeAllDishes(): Dish[] {
  const dish1 = cook("前菜")   // 做前菜
  const dish2 = cook("主菜")   // 做主菜
  const dish3 = cook("甜点")   // 做甜点
  return [dish1, dish2, dish3] // 全部做完才一起上
}

// Generator 函数：做一道，端一道
function* makeDishesOneByOne(): Generator<Dish> {
  yield cook("前菜")  // 做好前菜 → 端出来 → 暂停
  yield cook("主菜")  // 做好主菜 → 端出来 → 暂停
  yield cook("甜点")  // 做好甜点 → 端出来 → 暂停
}

// 调用者：一道一道吃
for (const dish of makeDishesOneByOne()) {
  eat(dish)  // 前菜端出来就吃，不用等主菜和甜点
}
```

**为什么 Claude Code 要用 yield？** 因为 LLM 的响应是**流式**的——token 一个一个到达，而不是等全部生成完才返回。用 `yield` 就能做到"来一个 token 就推一个给 UI"，用户立刻看到输出，而不是干等 30 秒。

```
LLM API 返回： "Claude" → "Code" → "是" → "一个" → "AI" → "Agent"
                  ↓        ↓       ↓       ↓        ↓       ↓
yield 推送：  yield → yield → yield → yield → yield → yield
                  ↓        ↓       ↓       ↓        ↓       ↓
UI 显示：     逐字出现，像打字机一样
```

**三个 yield 相关语法：**

| 语法 | 含义 | 在 query.ts 中的作用 |
|------|------|---------------------|
| `yield value` | 暂停执行，把 value 吐给调用者 | 向外推送流式事件（token、消息、工具结果等） |
| `yield* generator` | 委托给另一个 generator，把它的所有 yield 透传 | `query()` 用 `yield* queryLoop()` 透传所有事件 |
| `for await (const x of gen)` | 消费 async generator 的每个 yield | REPL 或 SDK 遍历 `query()` 的输出 |

**async generator vs 普通 generator：** 加上 `async` 后，函数内可以使用 `await`，调用者用 `for await` 消费。Claude Code 的 `query()` 和 `queryLoop()` 都是 `async function*`，因为它们既要 `yield` 推送事件，又要 `await` 等待 LLM API 响应和工具执行。

用一个最小例子把整个链路串起来：

```typescript
// 1. 定义 async generator（相当于 queryLoop）
async function* agentLoop(): AsyncGenerator<string> {
  yield "[开始] 调用 LLM..."
  const response = await callLLM()        // 等待 LLM 响应
  yield `[LLM回复] ${response.text}`

  if (response.toolUse) {
    yield `[工具调用] ${response.toolUse.name}(${JSON.stringify(response.toolUse.args)})`
    const toolResult = await executeTool(response.toolUse)  // 等待工具执行
    yield `[工具结果] ${toolResult}`

    // ★ 工具结果成为下一轮的输入——这就是 Agent 循环
    const response2 = await callLLMWithContext(toolResult)
    yield `[LLM回复] ${response2.text}`
  }

  return "done"  // 循环结束
}

// 2. 外壳函数，透传所有事件（相当于 query）
async function* query(): AsyncGenerator<string> {
  yield* agentLoop()  // 透传 agentLoop 的所有 yield
  // agentLoop 正常返回后，可以在这里做清理工作
}

// 3. 调用者消费（相当于 REPL）
for await (const event of query()) {
  console.log(event)  // 实时看到每一个事件
}
// 输出：
// [开始] 调用 LLM...
// [LLM回复] 让我来帮你读取文件
// [工具调用] FileReadTool({path: "/src/main.ts"})
// [工具结果] 文件内容...
// [LLM回复] 我已经读取了文件，以下是分析...
```

理解了这个最小例子，你就理解了 `query.ts` 的核心设计——`queryLoop()` 就是那个 `agentLoop()`，`while(true)` 只是让它能多轮循环。

#### 1.3.2 外壳：`query()` 函数

```typescript
// src/query.ts:219-239
// query() 是一个 async generator，用 yield 向外推送事件
export async function* query(
  params: QueryParams,
): AsyncGenerator<
  | StreamEvent           // 流式事件（token 逐个到达）
  | RequestStartEvent     // 请求开始事件
  | Message               // 消息（助手消息、用户消息、附件消息）
  | TombstoneMessage      // 墓碑消息（标记已删除的消息，用于 UI 移除）
  | ToolUseSummaryMessage, // 工具使用摘要
  Terminal                // 返回值类型：终止信号
> {
  // 记录本轮消费的命令 UUID，用于生命周期通知
  const consumedCommandUuids: string[] = []

  // ★ 核心：委托给 queryLoop，用 yield* 把 queryLoop 的所有 yield 透传出去
  const terminal = yield* queryLoop(params, consumedCommandUuids)

  // queryLoop 正常返回后，通知所有已消费的命令为 'completed'
  // 如果 queryLoop 抛异常或被 .return() 中断，这里不会执行
  for (const uuid of consumedCommandUuids) {
    notifyCommandLifecycle(uuid, 'completed')
  }
  return terminal
}
```

`query()` 做了两件事：
1. **委托循环**：用 `yield* queryLoop(...)` 把所有内部事件透传给调用者（REPL 或 SDK）
2. **生命周期管理**：循环结束后，通知所有消费过的命令为 `completed`

它本身没有任何循环逻辑——**真正的循环在 `queryLoop()` 里**。

#### 1.3.3 心脏：`queryLoop()` 函数

`queryLoop()` 是一个近 1500 行的 `while(true)` 循环，每一轮迭代就是 Agent 的"一个思考-行动回合"。我们按阶段拆解：

```typescript
// src/query.ts:241-1729
async function* queryLoop(
  params: QueryParams,
  consumedCommandUuids: string[],
): AsyncGenerator<..., Terminal> {

  // ==================== 一、初始化 ====================
  // 不可变参数——整个循环期间不会重新赋值
  const {
    systemPrompt,       // 系统提示词
    userContext,        // 用户上下文（CLAUDE.md 内容等）
    systemContext,      // 系统上下文（Git 状态、缓存破坏器等）
    canUseTool,         // 权限校验函数
    fallbackModel,      // 降级模型
    querySource,        // 查询来源（repl / sdk / agent 等）
    maxTurns,           // 最大轮数限制
    skipCacheWrite,     // 是否跳过缓存写入
  } = params

  // 可变状态——每次 continue 时整体替换，而非逐字段赋值
  let state: State = {
    messages: params.messages,          // 消息历史（逐轮增长）
    toolUseContext: params.toolUseContext, // 工具使用上下文
    autoCompactTracking: undefined,     // 自动压缩追踪状态
    maxOutputTokensRecoveryCount: 0,    // 输出 token 恢复重试计数
    hasAttemptedReactiveCompact: false, // 是否已尝试反应式压缩
    maxOutputTokensOverride: undefined, // 输出 token 上限覆盖
    pendingToolUseSummary: undefined,   // 上一轮的工具摘要（异步生成中）
    stopHookActive: undefined,          // Stop Hook 是否激活
    turnCount: 1,                       // 当前轮次
    transition: undefined,              // 上一轮继续的原因（用于调试）
  }

  // ==================== 二、循环前的一次性准备 ====================
  // 启动记忆预取——在模型流式输出的同时后台加载相关记忆，不阻塞主流程
  using pendingMemoryPrefetch = startRelevantMemoryPrefetch(
    state.messages,
    state.toolUseContext,
  )

  // ==================== 三、while(true) 主循环 ====================
  while (true) {
    // --- 3.1 解构当前状态 ---
    let { toolUseContext } = state
    const {
      messages,
      autoCompactTracking,
      maxOutputTokensRecoveryCount,
      hasAttemptedReactiveCompact,
      maxOutputTokensOverride,
      pendingToolUseSummary,
      stopHookActive,
      turnCount,
    } = state

    // --- 3.2 发出请求开始事件 ---
    yield { type: 'stream_request_start' }

    // --- 3.3 从上次压缩边界后提取消息（压缩过的历史不需要再发送）---
    let messagesForQuery = [...getMessagesAfterCompactBoundary(messages)]

    // ==============================================
    //  3.4 五级压缩策略级联（由轻到重，逐层执行）
    // ==============================================
    //
    //  Level 1: applyToolResultBudget()
    //    → 工具结果大小预算裁剪，超大输出会被截断
    //
    //  Level 2: snipCompactIfNeeded()   [需 HISTORY_SNIP feature flag]
    //    → 历史消息 Snip 裁剪，移除早期的冗余工具结果
    //
    //  Level 3: microcompact()
    //    → 微型压缩，用 cache-editing 变体做局部修改
    //
    //  Level 4: contextCollapse.applyCollapsesIfNeeded()  [需 CONTEXT_COLLAPSE flag]
    //    → 上下文折叠，保留粒度更细的摘要而非整体压缩
    //
    //  Level 5: autocompact()
    //    → 主自动压缩，用 LLM 总结历史消息（最重、最贵）

    // Level 1: 工具结果预算裁剪
    messagesForQuery = await applyToolResultBudget(messagesForQuery, ...)

    // Level 2: Snip 裁剪
    if (feature('HISTORY_SNIP')) {
      const snipResult = snipModule!.snipCompactIfNeeded(messagesForQuery)
      messagesForQuery = snipResult.messages
    }

    // Level 3: 微型压缩
    const microcompactResult = await deps.microcompact(
      messagesForQuery, toolUseContext, querySource,
    )
    messagesForQuery = microcompactResult.messages

    // Level 4: 上下文折叠
    if (feature('CONTEXT_COLLAPSE') && contextCollapse) {
      const collapseResult = await contextCollapse.applyCollapsesIfNeeded(
        messagesForQuery, toolUseContext, querySource,
      )
      messagesForQuery = collapseResult.messages
    }

    // 拼接完整系统提示词 = 基础 systemPrompt + 系统上下文（Git 状态等）
    const fullSystemPrompt = asSystemPrompt(
      appendSystemContext(systemPrompt, systemContext),
    )

    // Level 5: 自动压缩（最重的压缩，用 LLM 总结历史）
    const { compactionResult, consecutiveFailures } = await deps.autocompact(
      messagesForQuery, toolUseContext, { ... }, querySource, tracking, snipTokensFreed,
    )

    // 如果压缩成功，用压缩后的消息替换当前消息
    if (compactionResult) {
      const postCompactMessages = buildPostCompactMessages(compactionResult)
      for (const message of postCompactMessages) {
        yield message  // 向外推送压缩事件，UI 可以显示"已压缩"
      }
      messagesForQuery = postCompactMessages
    }

    // --- 3.5 检查是否达到阻塞限制（上下文太长，连压缩都无法挽救）---
    if (isAtBlockingLimit) {
      yield createAssistantAPIErrorMessage({ content: PROMPT_TOO_LONG_ERROR_MESSAGE })
      return { reason: 'blocking_limit' }  // 直接退出循环
    }

    // ==============================================
    //  3.6 调用 LLM API，获取流式响应
    // ==============================================
    const assistantMessages: AssistantMessage[] = []  // 本轮助手消息
    const toolResults: (UserMessage | AttachmentMessage)[] = []  // 本轮工具结果
    const toolUseBlocks: ToolUseBlock[] = []  // 本轮发现的工具调用块
    let needsFollowUp = false  // 是否需要继续（有工具调用时为 true）

    // for-await 遍历流式响应的每个事件
    for await (const message of deps.callModel({
      messages: prependUserContext(messagesForQuery, userContext),
      systemPrompt: fullSystemPrompt,
      thinkingConfig: toolUseContext.options.thinkingConfig,
      tools: toolUseContext.options.tools,
      signal: toolUseContext.abortController.signal,
      options: { model: currentModel, ... },
    })) {
      // 向外推送事件（token、文本块、工具调用块等）
      yield message

      if (message.type === 'assistant') {
        assistantMessages.push(message)

        // ★ 关键：检测到 tool_use 块，意味着 LLM 想要执行工具
        const msgToolUseBlocks = message.message.content.filter(
          content => content.type === 'tool_use',
        )
        if (msgToolUseBlocks.length > 0) {
          toolUseBlocks.push(...msgToolUseBlocks)
          needsFollowUp = true  // 标记：需要执行工具后继续循环
        }
      }
    }

    // ==============================================
    //  3.7 分支：LLM 是否请求了工具调用？
    // ==============================================

    if (!needsFollowUp) {
      // ---- 分支 A：LLM 没有请求工具调用，意味着它认为任务完成了 ----

      // 检查各种退出条件：
      // - prompt-too-long 恢复（先尝试折叠恢复，再尝试反应式压缩）
      // - max-output-tokens 恢复（重试或注入恢复消息继续）
      // - Stop Hook（外部钩子可以阻止继续）
      // - Token 预算检查

      // 如果以上都没有触发，返回 completed
      return { reason: 'completed' }  // ★ 循环退出的主要出口
    }

    // ---- 分支 B：LLM 请求了工具调用，执行工具 ----

    // ==============================================
    //  3.8 执行工具
    // ==============================================
    //
    // 两条执行路径：
    //  - streamingToolExecutor：流式路径，在 LLM 还在输出时就提前执行工具
    //  - runTools()：非流式路径，等 LLM 输出完后再执行
    //
    const toolUpdates = streamingToolExecutor
      ? streamingToolExecutor.getRemainingResults()  // 流式路径：取剩余结果
      : runTools(toolUseBlocks, assistantMessages, canUseTool, toolUseContext)  // 非流式路径

    for await (const update of toolUpdates) {
      if (update.message) {
        yield update.message  // 向外推送工具执行结果
        toolResults.push(...)  // 收集结果，下一轮发送给 LLM
      }
    }

    // --- 3.9 注入附件（排队命令、记忆、文件变更等）---
    for await (const attachment of getAttachmentMessages(...)) {
      yield attachment
      toolResults.push(attachment)
    }

    // --- 3.10 检查是否超过最大轮数 ---
    if (maxTurns && nextTurnCount > maxTurns) {
      yield createAttachmentMessage({ type: 'max_turns_reached', ... })
      return { reason: 'max_turns', turnCount: nextTurnCount }  // ★ 循环退出的限制出口
    }

    // ==============================================
    //  3.11 更新状态，进入下一轮循环
    // ==============================================
    const next: State = {
      messages: [...messagesForQuery, ...assistantMessages, ...toolResults],  // ★ 核心：拼接所有消息
      toolUseContext: toolUseContextWithQueryTracking,
      autoCompactTracking: tracking,
      turnCount: nextTurnCount,
      pendingToolUseSummary: nextPendingToolUseSummary,
      transition: { reason: 'next_turn' },
      // ...
    }
    state = next  // 替换整个状态对象

    // 回到 while(true) 的顶部，开始下一轮！
  }
}
```

#### 1.3.4 用一张图理解循环

```
queryLoop() 的每一轮 while(true) 迭代：

  ┌─────────────────────────────────────────────────────┐
  │                   一轮迭代开始                        │
  │                                                     │
  │  ① 解构状态 → 提取 messages、toolUseContext 等      │
  │                  ↓                                  │
  │  ② 五级压缩级联（由轻到重）                          │
  │     L1: applyToolResultBudget  裁剪工具结果          │
  │     L2: snipCompactIfNeeded    Snip 裁剪             │
  │     L3: microcompact           微型压缩              │
  │     L4: contextCollapse        上下文折叠            │
  │     L5: autocompact            自动压缩（LLM 总结）   │
  │                  ↓                                  │
  │  ③ 调用 LLM API（流式）                             │
  │     for await (message of callModel(...)) {          │
  │       yield message                                 │
  │       if (tool_use) needsFollowUp = true             │
  │     }                                               │
  │                  ↓                                  │
  │         ┌── needsFollowUp? ──┐                      │
  │         │                    │                      │
  │      否 │                 是 │                      │
  │         ↓                    ↓                      │
  │   ④A 任务完成            ④B 执行工具                 │
  │   return {reason:        runTools() /                │
  │     'completed'}         streamingToolExecutor       │
  │                              ↓                      │
  │                      ⑤ 注入附件                      │
  │                      （记忆、命令、文件变更）          │
  │                              ↓                      │
  │                      ⑥ 更新状态                      │
  │                      state = {                      │
  │                        messages: [...旧, ...助手, ...工具结果], │
  │                        turnCount: +1                │
  │                      }                              │
  │                              ↓                      │
  │                      回到 ① ←←←←←←←                 │
  └─────────────────────────────────────────────────────┘
```

#### 1.3.5 关键设计点

1. **`while(true)` 不是无限死循环**——它有多个退出出口：`completed`（正常完成）、`max_turns`（超过限制）、`aborted`（用户中断）、`blocking_limit`（上下文过长）、`prompt_too_long`（压缩恢复失败）、`hook_stopped`（Hook 阻止）

2. **状态用整体替换而非逐字段修改**——每次 `continue` 或进入下一轮时，`state = { ... }` 整体赋值。这避免了 9 个字段分别赋值的混乱，也让 `transition` 字段能追踪"为什么进入了下一轮"

3. **`yield*` 委托模式**——`query()` 通过 `yield* queryLoop()` 把内部事件全部透传给调用者。REPL 或 SDK 只需要 `for await` 遍历 `query()` 的输出，就能收到所有流式事件

4. **五级压缩级联的顺序是有意的**——轻量压缩优先执行，如果能通过裁剪解决，就不需要调用 LLM 做昂贵的自动压缩

5. **`needsFollowUp` 是循环的"方向盘"**——它由 LLM 的输出决定：返回了 `tool_use` 就继续，只返回文本就停止。这就是 Agent "自主决策"的源码实现

---

## 2. AI Agent 的本质

### 2.1 什么是 AI Agent

AI Agent = **LLM + 工具 + 循环 + 记忆 + 权限**

```
┌─────────────────────────────────────┐
│              AI Agent                │
│                                     │
│  ┌─────┐    ┌──────┐    ┌───────┐  │
│  │ LLM │←──→│ 工具  │←──→│ 外部世界│  │
│  └──┬──┘    └──────┘    └───────┘  │
│     │                               │
│     ├── 记忆（记住你是谁）           │
│     ├── 权限（谁能做什么）           │
│     └── 循环（自主决策，多轮执行）    │
└─────────────────────────────────────┘
```

关键区别：
- **LLM** 是"大脑"，负责理解和决策
- **工具** 是"手脚"，负责与外部世界交互
- **循环** 是"自主性"的来源——AI 自己决定是否需要继续行动
- **记忆** 是"个性化"的关键——AI 记住你的偏好和项目信息
- **权限** 是"安全"的保障——防止 AI 执行危险操作

### 2.2 Agent 与普通 LLM 应用的区别

普通 LLM 应用（如 RAG 聊天机器人）的执行模型：

```
用户输入 → LLM 推理 → 返回结果 → 结束
```

Agent 的执行模型：

```
用户输入 → LLM 推理 → 决策：需要行动？
                              ├── 否 → 返回结果 → 结束
                              └── 是 → 执行工具 → 获取结果 → LLM 再推理 → 决策：还需要行动？
                                                                            ├── 否 → 返回结果 → 结束
                                                                            └── 是 → 继续循环...
```

**核心差异：Agent 有一个闭环反馈结构。** 工具执行的结果会成为 LLM 下一轮推理的输入，这使得 Agent 能够完成多步骤的复杂任务。

### 2.3 Claude Code 的 Agent 循环源码

在 `src/query.ts` 中，这个循环的具体实现是 `queryLoop` 函数：

```typescript
// src/query.ts:241 — queryLoop 核心循环（简化）
async function* queryLoop(params: QueryParams) {
  let state: State = {
    messages: params.messages,
    toolUseContext: params.toolUseContext,
    turnCount: 1,
    // ...
  }

  while (true) {
    const { messages, toolUseContext, ... } = state

    // 构建查询配置
    const queryConfig = buildQueryConfig(...)

    // 调用 LLM，获取流式响应
    const stream = queryModelWithStreaming(queryConfig)

    // 处理流式响应中的工具调用
    for await (const event of stream) {
      if (isToolUse(event)) {
        // 权限校验 → 执行工具 → 结果注入上下文
        const result = await executeTool(...)
        state.messages = [...messages, assistantMsg, toolResult]
      }
    }

    // 退出条件检查
    if (shouldExit(state)) break
  }
}
```

---

## 3. Claude Code 的核心能力边界

### 3.1 能做什么

从 `src/tools.ts` 的 `getAllBaseTools()` 函数可以看到 Claude Code 的完整能力清单：

```typescript
// src/tools.ts:193 — 所有基础工具（简化）
export function getAllBaseTools(): Tools {
  return [
    AgentTool,           // 生成子 Agent 执行子任务
    TaskOutputTool,      // 获取后台任务输出
    BashTool,            // 执行 Shell 命令
    // 条件工具：嵌入式搜索不可用时启用
    ...(hasEmbeddedSearchTools() ? [] : [GlobTool, GrepTool]),
    ExitPlanModeV2Tool,  // 退出计划模式
    FileReadTool,        // 读取文件
    FileEditTool,        // 编辑文件（增量替换）
    FileWriteTool,       // 写入文件
    NotebookEditTool,    // 编辑 Jupyter Notebook
    WebFetchTool,        // HTTP 请求
    TodoWriteTool,       // 写入待办事项
    WebSearchTool,       // Web 搜索
    TaskStopTool,        // 停止后台任务
    AskUserQuestionTool, // 向用户提问
    SkillTool,           // 调用技能
    EnterPlanModeTool,   // 进入计划模式
    // ... 更多条件工具（ConfigTool、任务管理、Worktree、Cron 等）
    ListMcpResourcesTool,   // 列出 MCP 资源
    ReadMcpResourceTool,    // 读取 MCP 资源
  ]
}
```

按能力分类：

| 能力类别 | 工具 | 说明 |
|---------|------|------|
| **文件操作** | FileReadTool, FileEditTool, FileWriteTool, NotebookEditTool | 读取、编辑、写入文件 |
| **命令执行** | BashTool, PowerShellTool | 执行 Shell/PowerShell 命令 |
| **代码搜索** | GlobTool, GrepTool | 文件扫描、代码检索 |
| **网络访问** | WebFetchTool, WebSearchTool | HTTP 请求、Web 搜索 |
| **交互问答** | AskUserQuestionTool | 向用户确认或获取信息 |
| **任务管理** | TaskCreateTool/Get/Update/List/Output/Stop | 任务创建、追踪、管理 |
| **多 Agent** | AgentTool, SendMessageTool | 生成子 Agent、Agent 间通信 |
| **模式切换** | EnterPlanModeTool, ExitPlanModeV2Tool | 计划模式/执行模式切换 |
| **工作树** | EnterWorktreeTool, ExitWorktreeTool | Git Worktree 隔离操作 |
| **定时任务** | ScheduleCronTool, CronDeleteTool, CronListTool | 定时执行任务 |
| **扩展能力** | SkillTool, MCP 工具（mcp__ 前缀） | 调用技能、MCP 服务器工具 |

### 3.2 不能做什么

- **不能直接操作 GUI**：Claude Code 运行在终端中，无法点击按钮或操作桌面应用
- **不能访问用户未授权的资源**：权限系统会在每个工具执行前进行校验
- **不能突破沙盒限制**：即使在 `bypassPermissions` 模式下，沙盒仍然会限制文件系统写入范围
- **不能无限执行**：受 `maxTurns`、`maxBudgetUsd` 和上下文窗口限制
- **不能绕过 bypass-immune 检查**：`.git/`、`.claude/settings.json`、shell 配置文件始终需要用户确认

---

## 4. 整体架构总览

### 4.1 架构全景图

```
┌───────────────────────────────────────────────────────────────────┐
│                       Claude Code 整体架构                         │
├───────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌─────────────────┐    ┌─────────────────┐    ┌──────────────┐  │
│  │   入口与启动层    │    │   交互与渲染层    │    │  核心循环层   │  │
│  │                 │    │                 │    │              │  │
│  │ dev-entry.ts    │    │ Ink 渲染器      │    │ QueryEngine  │  │
│  │ cli.tsx         │    │ React 组件      │    │ query()      │  │
│  │ init.ts         │    │ REPL 屏幕      │    │ queryLoop    │  │
│  │ main.tsx        │    │ 交互对话框      │    │              │  │
│  └────────┬────────┘    └────────┬────────┘    └──────┬───────┘  │
│           │                      │                     │          │
│  ┌────────┴──────────────────────┴─────────────────────┴───────┐  │
│  │                       子系统层                               │  │
│  │                                                             │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐  │  │
│  │  │API 通信层│ │System    │ │ 记忆系统  │ │  工具系统     │  │  │
│  │  │claude.ts │ │Prompt    │ │claudemd  │ │  54+ 工具    │  │  │
│  │  │sideQuery │ │Sections  │ │memdir    │ │  执行管道     │  │  │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────────┘  │  │
│  │                                                             │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐  │  │
│  │  │ 权限系统  │ │ 沙盒系统 │ │ 多Agent  │ │ 压缩系统     │  │  │
│  │  │ 7种模式  │ │ bwrap/   │ │ 协调器   │ │ 5级级联      │  │  │
│  │  │ YOLO    │ │ sandbox  │ │ 子Agent  │ │ token预算    │  │  │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────────┘  │  │
│  │                                                             │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐                   │  │
│  │  │Hook/插件 │ │ 技能系统  │ │ 斜杠命令 │                   │  │
│  │  │ 前后置   │ │ bundled  │ │commands  │                   │  │
│  │  └──────────┘ └──────────┘ └──────────┘                   │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │                     基础设施层                                │  │
│  │  Feature Flag │ 状态管理 │ 任务调度 │ 配置系统 │ MCP 协议  │  │
│  └─────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────────┘
```

### 4.2 子系统清单速览

以下是 Claude Code 的 12 个核心子系统，每个子系统在后续独立章节中展开：

| # | 子系统 | 核心文件 | 关键函数 | 详读章节 |
|---|--------|---------|---------|---------|
| 1 | API 客户端与 LLM 通信层 | `src/services/api/claude.ts` | `queryModelWithStreaming()` | Ch4 |
| 2 | System Prompt 系统 | `src/constants/prompts.ts`, `systemPromptSections.ts` | `getSystemPrompt()`, `systemPromptSection()` | Ch5 |
| 3 | 记忆系统 | `src/utils/claudemd.ts`, `src/memdir/memdir.ts` | `getClaudeMds()`, `loadMemoryPrompt()` | Ch6 |
| 4 | 工具系统 | `src/Tool.ts`, `src/tools.ts`, `src/tools/*/` | `buildTool()`, `getAllBaseTools()`, `runToolUse()` | Ch7 |
| 5 | 权限系统 | `src/utils/permissions/permissions.ts`, `PermissionMode.ts` | `hasPermissionsToUseTool()` | Ch8 |
| 6 | 沙盒安全系统 | `src/utils/sandbox/sandbox-adapter.ts` | `shouldUseSandbox()`, `convertToSandboxRuntimeConfig()` | Ch9 |
| 7 | 多 Agent 系统 | `src/tools/AgentTool/`, `src/coordinator/` | `runAgent()`, `forkSubagent()` | Ch10 |
| 8 | 压缩与上下文管理 | `src/query.ts`, `src/services/compact/` | `autocompact()`, `microcompact()` | Ch11 |
| 9 | Hook/插件/技能 | `src/services/tools/toolHooks.ts`, `src/plugins/`, `src/skills/` | `runHook()` | Ch12 |
| 10 | 斜杠命令系统 | `src/commands.ts`, `src/commands/` | 命令注册与分发 | Ch13 |
| 11 | 渲染系统 | `src/ink/`（32+ 文件）, `src/components/`（150+ 文件）, `src/screens/REPL.tsx` | 自定义 Ink 渲染器 | Ch14 |
| 12 | Feature Flag 系统 | `src/services/analytics/growthbook.ts` | `feature()` 门控函数 | Ch14 |

---

## 5. 源码仓库结构总览

### 5.1 关于源码版本

::: warning 重要背景
本站解析的源码来自 [dgai5016/Claude-Code](https://github.com/dgai5016/Claude-Code) 仓库，版本号 `999.0.0-restored`。

该仓库描述为 **"Restored Claude Code source tree reconstructed from source maps"**——从 source map 反编译恢复的工作区。这意味着：

- 部分代码可能不完整（缺失的导入、未解析的模块）
- 变量名可能不完全准确（反编译过程中的偏差）
- 行号可能有偏移
- 部分功能受 feature flag 门控而在反编译代码中不可见

尽管如此，该仓库仍是我们理解 Claude Code 架构和核心逻辑的最佳可用源码参考。
:::

### 5.2 `src/` 目录完整结构

以下是 `src/` 目录的真实结构，严格对齐仓库实际内容，**一个不漏、一个不多**。每个目录和文件都附有通俗易懂的作用说明。

::: info 阅读提示
文件后面的括号内数字是行数，帮助你直观感受文件体量。行数基于 restored 源码，可能有偏移。
:::

#### 5.2.1 顶级文件（src/ 根目录下的独立文件）

| 文件 | 作用 |
|------|------|
| `dev-entry.ts` | **开发模式入口**。先扫描 src/ 和 vendor/ 检查是否有缺失的导入，确认无误后转发到 `cli.tsx`。处理 `--version` 和 `--help` 的快速路径 |
| `main.tsx` (4690 行) | **Commander CLI 定义 + REPL 启动器**。定义所有命令行参数（--model、--permission-mode 等），解析完成后启动 REPL 交互循环 |
| `query.ts` (1729 行) | **核心 Agent 循环**。`query()` 是外壳，`queryLoop()` 是 `while(true)` 主循环——整台机器的心脏 |
| `QueryEngine.ts` (1295 行) | **SDK 入口**。`QueryEngine` 类封装 `query()`，供外部 SDK 调用，管理消息、中止控制器、权限拒绝等状态 |
| `Tool.ts` (792 行) | **工具接口定义 + 工厂**。定义了 `Tool` 类型（所有工具必须实现的接口）和 `buildTool()` 工厂函数 |
| `tools.ts` (389 行) | **工具注册中心**。`getAllBaseTools()` 列出所有内置工具，`getTools()` 按权限过滤 |
| `commands.ts` (25185 行) | **斜杠命令定义**。所有 `/xxx` 命令的参数定义和注册。超大文件，包含命令路由逻辑 |
| `context.ts` (6446 行) | **上下文管理**。`getSystemContext()` 提供 Git 状态等系统信息，`getUserContext()` 提供 CLAUDE.md 内容等用户信息 |
| `interactiveHelpers.tsx` (57424 行) | **Ink 渲染辅助**。首次启动引导、信任对话框、OAuth 登录流程等交互式 UI 逻辑 |
| `dialogLaunchers.tsx` (22948 行) | **对话框启动器**。各种确认弹窗、权限提示、MCP 服务器审批等对话框的启动逻辑 |
| `replLauncher.tsx` (3517 行) | **REPL 启动**。启动交互式循环，初始化 Ink 渲染，连接消息队列 |
| `setup.ts` (20646 行) | **初始化设置**。首次启动的引导流程：选择权限模式、配置 API Key 等 |
| `cost-tracker.ts` (10706 行) | **费用追踪**。记录每次 API 调用的 token 消耗和费用，显示费用警告 |
| `costHook.ts` | **费用钩子**。费用相关的 hook 回调 |
| `history.ts` (14081 行) | **历史记录**。会话历史的保存、加载、搜索、回放 |
| `ink.ts` | **Ink 入口**。连接自定义 Ink 渲染器和 React |
| `Task.ts` | **Task 类型定义**。任务的数据结构 |
| `tasks.ts` | **任务调度**。任务的创建、分配、完成通知 |
| `projectOnboardingState.ts` | **项目引导状态**。首次打开项目时的引导流程状态管理 |
| `globals.d.ts` | **全局类型声明**。为 Bun、MACRO 等全局变量提供 TypeScript 类型 |

#### 5.2.2 entrypoints/ — 入口点

Claude Code 启动的第一步，负责"把车发动起来"。

| 文件 | 作用 |
|------|------|
| `cli.tsx` | **主引导入口**。根据命令行参数做快速路由：`--version` 直接输出版本号，`--dump-system-prompt` 导出系统提示词，默认路径加载 `main.tsx` |
| `init.ts` | **初始化序列**。按顺序执行：加载配置 → 环境变量 → TLS 证书 → 遥测 → OAuth → GrowthBook，所有启动准备工作都在这里 |
| `mcp.ts` | **MCP 入口**。独立运行 MCP 服务器的入口 |
| `agentSdkTypes.ts` | **Agent SDK 类型**。SDK 相关的 TypeScript 类型定义 |
| `sandboxTypes.ts` | **沙盒类型**。沙盒运行时的类型定义 |
| `sdk/` | **SDK 子目录**。SDK 的核心类型、控制类型、工具类型等定义（9 个文件） |

#### 5.2.3 query/ — 查询循环的辅助模块

`query.ts` 拆分出来的辅助模块，让主循环文件不至于过长。

| 文件 | 作用 |
|------|------|
| `config.ts` | **查询配置构建**。`buildQueryConfig()` 快照一次不可变的环境/GrowthBook/会话状态 |
| `deps.ts` | **依赖注入**。`productionDeps()` 提供生产环境的依赖（callModel、autocompact 等），测试时可以注入 mock |
| `stopHooks.ts` | **停止钩子**。`handleStopHooks()` 在 LLM 不再请求工具时执行，决定是否真的结束还是继续 |
| `tokenBudget.ts` | **Token 预算管理**。`checkTokenBudget()` 检查当前轮是否超过 token 预算，决定继续还是停止 |
| `transitions.ts` | **转换类型**。定义 `Terminal`（退出原因）和 `Continue`（继续原因）类型 |

#### 5.2.4 bootstrap/ — 全局共享状态

整个进程唯一的"全局变量仓库"。

| 文件 | 作用 |
|------|------|
| `state.ts` (56109 行) | **全局状态**。用 `createSignal()` 创建响应式全局状态：费用、token 预算、模型、权限模式、MCP 状态等。文件顶部有警告："不要在这里加更多状态" |

#### 5.2.5 constants/ — 常量与提示词定义

存放不会在运行时改变的常量值，以及系统提示词的构建逻辑。

| 文件 | 作用 |
|------|------|
| `prompts.ts` | **系统提示词主构建函数**。`getSystemPrompt(tools, model, dirs, mcpClients)` 组装完整的系统提示词 |
| `systemPromptSections.ts` | **Section 缓存机制**。`systemPromptSection()` 创建缓存段，`DANGEROUS_uncachedSystemPromptSection()` 创建动态段 |
| `apiLimits.ts` | **API 限制常量**。速率限制、上下文窗口大小等 |
| `betas.ts` | **API Beta 功能**。标记启用了哪些 Anthropic API beta 功能 |
| `common.ts` | **通用常量**。项目名称、版本号等 |
| `cyberRiskInstruction.ts` | **网络安全风险指令**。防止 LLM 生成恶意代码的系统提示词段 |
| `errorIds.ts` | **错误 ID**。各种错误的唯一标识符 |
| `figures.ts` | **图标常量**。终端 UI 使用的图标字符（✓、✗ 等） |
| `files.ts` | **文件常量**。配置文件路径、目录名等 |
| `github-app.ts` | **GitHub App 常量**。GitHub 集成相关的常量 |
| `keys.ts` | **键常量**。快捷键定义 |
| `messages.ts` | **消息常量**。消息类型标识符 |
| `oauth.ts` | **OAuth 常量**。OAuth 流程的 URL、Scope 等 |
| `outputStyles.ts` | **输出样式常量**。不同的输出风格定义 |
| `product.ts` | **产品常量**。产品标识、订阅计划等 |
| `querySource.ts` | **查询来源常量**。标识查询来源（repl、sdk、agent 等） |
| `spinnerVerbs.ts` | **加载动画动词**。不同状态显示的动词（"思考中"、"执行中"等） |
| `system.ts` | **系统常量**。操作系统相关的常量 |
| `toolLimits.ts` | **工具限制**。各工具的 token 限制 |
| `tools.ts` | **工具常量**。工具名称等 |
| `turnCompletionVerbs.ts` | **回合完成动词**。LLM 完成回复时使用的动词 |
| `xml.ts` | **XML 常量**。工具结果中使用的 XML 标签 |

#### 5.2.6 services/ — 核心服务（22 个子目录 + 散文件）

Claude Code 最重要的业务逻辑都放在这里，按功能划分子目录。

**api/ — API 客户端**

| 文件 | 作用 |
|------|------|
| `claude.ts` | **主 API 客户端**。`queryModelWithStreaming()` 发送流式请求，处理流式事件，管理 token 用量 |
| `client.ts` | **API 客户端创建**。创建 Anthropic SDK 客户端实例 |
| `bootstrap.ts` | **API 引导**。初始化 API 连接 |
| `withRetry.ts` | **重试逻辑**。API 请求失败时的重试策略，`FallbackTriggeredError` 触发模型降级 |
| `errors.ts` | **错误定义**。`PROMPT_TOO_LONG_ERROR_MESSAGE` 等 API 错误 |
| `dumpPrompts.ts` | **提示词导出**。`--dump-system-prompt` 功能的实现 |
| `grove.ts` | **Grove API**。Anthropic 内部 API |
| `filesApi.ts` | **文件 API**。文件上传/下载 |
| `usage.ts` | **用量统计**。token 使用量计算 |
| `adminRequests.ts` | **管理请求**。内部管理 API |
| `logging.ts` | **API 日志**。请求/响应日志 |
| `emptyUsage.ts` | **空用量**。默认的零用量对象 |
| `errorUtils.ts` | **错误工具**。错误分类、格式化 |
| `metricsOptOut.ts` | **指标退出**。用户选择退出遥测 |
| `firstTokenDate.ts` | **首 token 时间**。记录首 token 到达时间 |
| `overageCreditGrant.ts` | **超额信用**。处理用量超额 |
| `promptCacheBreakDetection.ts` | **缓存破坏检测**。检测 prompt cache 是否失效 |
| `referral.ts` | **推荐**。推荐系统 API |
| `sessionIngress.ts` | **会话入口**。远程会话的 API 入口 |
| `ultrareviewQuota.ts` | **审查配额**。代码审查功能的配额管理 |

**compact/ — 上下文压缩**

| 文件 | 作用 |
|------|------|
| `autoCompact.ts` | **自动压缩**。`autocompact()` 主函数，用 LLM 总结历史消息以缩减上下文 |
| `compact.ts` | **压缩核心**。`buildPostCompactMessages()` 构建压缩后的消息列表 |
| `microCompact.ts` | **微型压缩**。更轻量的压缩，用 cache-editing 做局部修改 |
| `reactiveCompact.ts` | **反应式压缩**。当 API 返回 413 时被动触发，而非主动预防 |
| `snipCompact.ts` | **Snip 裁剪**。移除早期冗余的工具结果 |
| `snipProjection.ts` | **Snip 投影**。计算 Snip 后的消息视图 |
| `prompt.ts` | **压缩提示词**。压缩时发给 LLM 的系统提示 |
| `apiMicrocompact.ts` | **API 微型压缩**。API 层的微型压缩逻辑 |
| `cachedMCConfig.ts` | **缓存 MC 配置**。Cached MicroCompact 的配置 |
| `timeBasedMCConfig.ts` | **时间 MC 配置**。基于时间的 MC 配置 |
| `grouping.ts` | **消息分组**。压缩前的消息分组策略 |
| `compactWarningHook.ts` | **压缩警告钩子**。上下文接近限制时发出警告 |
| `compactWarningState.ts` | **压缩警告状态**。警告状态管理 |
| `postCompactCleanup.ts` | **压缩后清理**。压缩完成后的清理工作 |
| `sessionMemoryCompact.ts` | **会话记忆压缩**。会话记忆的压缩策略 |

**tools/ — 工具执行管道**

| 文件 | 作用 |
|------|------|
| `toolExecution.ts` | **工具执行**。`runToolUse()` 查找工具 → Zod 验证 → PreToolUse hooks → 权限决策 → 执行 → PostToolUse hooks → 结果映射 |
| `StreamingToolExecutor.ts` | **流式工具执行器**。LLM 还在输出时就提前开始执行工具，并发安全工具并行 |
| `toolOrchestration.ts` | **工具编排**。`runTools()` 非流式路径，并发安全工具并行、非安全工具串行 |
| `toolHooks.ts` | **工具钩子**。PreToolUse/PostToolUse hooks 的执行逻辑 |

**mcp/ — MCP 协议（Model Context Protocol）**

| 文件 | 作用 |
|------|------|
| `client.ts` | **MCP 客户端**。连接 MCP 服务器，发现和调用 MCP 工具 |
| `MCPConnectionManager.tsx` | **连接管理器**。管理所有 MCP 服务器的连接生命周期 |
| `config.ts` | **MCP 配置**。从 settings.json 读取 mcpServers 配置 |
| `types.ts` | **MCP 类型**。MCP 相关的 TypeScript 类型 |
| `auth.ts` | **MCP 认证**。MCP 服务器的 OAuth/API Key 认证 |
| `channelAllowlist.ts` | **频道白名单**。允许的 MCP 频道 |
| `channelPermissions.ts` | **频道权限**。MCP 频道的权限控制 |
| `channelNotification.ts` | **频道通知**。MCP 频道变更通知 |
| `claudeai.ts` | **Claude.ai 集成**。与 Claude.ai 网站的 MCP 连接 |
| `elicitationHandler.ts` | **触发处理**。MCP 工具的交互式触发 |
| `envExpansion.ts` | **环境变量展开**。MCP 配置中的环境变量替换 |
| `headersHelper.ts` | **请求头辅助**。MCP 请求头构建 |
| `InProcessTransport.ts` | **进程内传输**。同一进程内的 MCP 传输 |
| `SdkControlTransport.ts` | **SDK 控制传输**。SDK 模式下的 MCP 传输 |
| `mcpStringUtils.ts` | **字符串工具**。MCP 工具名解析（mcp__ 前缀） |
| `normalization.ts` | **规范化**。MCP 工具 schema 的规范化 |
| `oauthPort.ts` | **OAuth 端口**。MCP OAuth 回调端口 |
| `officialRegistry.ts` | **官方注册表**。官方 MCP 服务器注册信息 |
| `utils.ts` | **通用工具**。MCP 辅助函数 |
| `vscodeSdkMcp.ts` | **VS Code SDK MCP**。VS Code 扩展的 MCP 集成 |
| `xaa.ts` | **XAA 认证**。Anthropic 内部认证 |
| `xaaIdpLogin.ts` | **XAA IDP 登录**。Identity Provider 登录 |

**analytics/ — 分析与 GrowthBook**

| 文件 | 作用 |
|------|------|
| `growthbook.ts` | **Feature Flag**。GrowthBook SDK 集成，`feature()` 函数的门控实现 |
| `index.ts` | **分析入口**。`logEvent()` 发送遥测事件 |
| `firstPartyEventLogger.ts` | **一方事件日志**。Anthropic 自己的事件记录 |
| `firstPartyEventLoggingExporter.ts` | **日志导出器**。事件导出到 OpenTelemetry |
| `config.ts` | **分析配置**。遥测配置 |
| `datadog.ts` | **Datadog 集成**。监控指标上报 |
| `metadata.ts` | **元数据**。遥测事件的公共元数据 |
| `sink.ts` | **事件接收器**。事件的缓冲和批量发送 |
| `sinkKillswitch.ts` | **接收器开关**。紧急关闭遥测 |

**其他服务子目录**

| 目录 | 作用 |
|------|------|
| `SessionMemory/` | **会话记忆**。跨会话的记忆持久化（prompts.ts + sessionMemory.ts + sessionMemoryUtils.ts） |
| `extractMemories/` | **记忆抽取**。自动从对话中提取值得记住的信息（extractMemories.ts + prompts.ts） |
| `contextCollapse/` | **上下文折叠**。比全量压缩更轻量的替代方案（index.ts + operations.ts + persist.ts） |
| `lsp/` | **LSP 集成**。Language Server Protocol 客户端，提供代码诊断（8 个文件） |
| `oauth/` | **OAuth 认证**。用户登录认证流程（6 个文件） |
| `plugins/` | **插件管理**。插件的安装、卸载、生命周期（3 个文件） |
| `policyLimits/` | **策略限制**。企业策略对 Claude Code 的使用限制 |
| `PromptSuggestion/` | **提示建议**。输入框的自动补全建议 |
| `remoteManagedSettings/` | **远程托管设置**。企业管理的远程配置同步（6 个文件） |
| `settingsSync/` | **设置同步**。跨设备设置同步 |
| `skillSearch/` | **技能搜索**。搜索和发现可用技能（7 个文件） |
| `teamMemorySync/` | **团队记忆同步**。团队成员间的记忆共享（5 个文件） |
| `tips/` | **使用提示**。随机显示的使用技巧（4 个文件） |
| `toolUseSummary/` | **工具使用摘要**。用 Haiku 生成工具调用的摘要 |
| `AgentSummary/` | **Agent 摘要**。子 Agent 执行结果的摘要生成 |
| `autoDream/` | **自动 Dream**。空闲时的后台自动思考和整理（4 个文件） |
| `MagicDocs/` | **Magic Docs**。智能文档生成（2 个文件） |

**services/ 根目录散文件**

| 文件 | 作用 |
|------|------|
| `awaySummary.ts` | **离开摘要**。用户离开期间的对话摘要 |
| `claudeAiLimits.ts` | **Claude.ai 限制**。免费用户的速率限制 |
| `claudeAiLimitsHook.ts` | **限制钩子**。速率限制的 hook |
| `diagnosticTracking.ts` | **诊断追踪**。运行时诊断信息收集 |
| `internalLogging.ts` | **内部日志**。Anthropic 内部日志 |
| `mcpServerApproval.tsx` | **MCP 审批**。MCP 服务器首次连接的审批 UI |
| `mockRateLimits.ts` | **模拟限流**。测试用的模拟速率限制 |
| `notifier.ts` | **通知器**。桌面通知推送 |
| `preventSleep.ts` | **防止休眠**。长时间运行时阻止系统休眠 |
| `rateLimitMessages.ts` | **限流消息**。速率限制时的用户提示 |
| `rateLimitMocking.ts` | **限流模拟**。测试用 |
| `tokenEstimation.ts` | **Token 估算**。不调用 API 时的 token 数量估算 |
| `vcr.ts` | **VCR 录制**。API 请求/响应的录制回放，用于测试 |
| `voice.ts` | **语音服务**。语音输入的音频处理 |
| `voiceKeyterms.ts` | **语音关键词**。语音识别的关键词 |
| `voiceStreamSTT.ts` | **语音流式 STT**。流式语音转文字 |

#### 5.2.7 tools/ — 所有工具实现（52 个子目录 + 工具类文件）

每个子目录就是一个独立的工具，包含工具的提示词、执行逻辑、安全检查等。

**文件操作类**

| 目录 | 作用 |
|------|------|
| `FileReadTool/` | **文件读取**。读取文件内容，支持图片/PDF，有行号和偏移控制 |
| `FileEditTool/` | **文件增量编辑**。用 old_string/new_string 做精确替换，有陈旧检测和原子性保证 |
| `FileWriteTool/` | **文件写入**。创建或覆盖写入文件 |
| `NotebookEditTool/` | **Jupyter Notebook 编辑**。编辑 .ipynb 文件的 cell |

**命令执行类**

| 目录 | 作用 |
|------|------|
| `BashTool/` | **Shell 命令执行**。最复杂的工具之一，包含安全解析（bashSecurity.ts）、权限控制（bashPermissions.ts）、沙盒集成 |
| `PowerShellTool/` | **PowerShell 执行**。Windows 上的命令执行 |

**代码搜索类**

| 目录 | 作用 |
|------|------|
| `GlobTool/` | **文件扫描**。用 glob 模式搜索文件路径（嵌入式搜索不可用时启用） |
| `GrepTool/` | **代码检索**。用正则表达式搜索文件内容（嵌入式搜索不可用时启用） |
| `ToolSearchTool/` | **工具搜索**。搜索可用工具的描述和用法 |

**网络访问类**

| 目录 | 作用 |
|------|------|
| `WebFetchTool/` | **HTTP 请求**。获取指定 URL 的内容 |
| `WebSearchTool/` | **Web 搜索**。搜索引擎查询 |
| `WebBrowserTool/` | **Web 浏览器**。更完整的网页浏览能力 |

**交互问答类**

| 目录 | 作用 |
|------|------|
| `AskUserQuestionTool/` | **向用户提问**。交互式问答，支持选项、多选、预览 |

**任务管理类**

| 目录 | 作用 |
|------|------|
| `TaskCreateTool/` | **创建任务**。创建跟踪任务 |
| `TaskGetTool/` | **获取任务**。按 ID 获取任务详情 |
| `TaskUpdateTool/` | **更新任务**。更新任务状态和内容 |
| `TaskListTool/` | **任务列表**。列出所有任务 |
| `TaskOutputTool/` | **任务输出**。获取后台任务的输出 |
| `TaskStopTool/` | **停止任务**。停止正在运行的后台任务 |

**多 Agent 类**

| 目录 | 作用 |
|------|------|
| `AgentTool/` | **子 Agent**。生成子 Agent 执行子任务，支持同步和异步模式 |
| `SendMessageTool/` | **Agent 间通信**。向其他 Agent 发送消息 |
| `TeamCreateTool/` | **创建团队**。创建多 Agent 团队 |
| `TeamDeleteTool/` | **删除团队**。删除团队 |

**模式切换类**

| 目录 | 作用 |
|------|------|
| `EnterPlanModeTool/` | **进入计划模式**。切换到只读的计划模式 |
| `ExitPlanModeTool/` | **退出计划模式**。从计划模式切回执行模式 |
| `EnterWorktreeTool/` | **进入工作树**。创建 Git Worktree 隔离工作 |
| `ExitWorktreeTool/` | **退出工作树**。退出 Worktree |

**定时与调度类**

| 目录 | 作用 |
|------|------|
| `ScheduleCronTool/` | **创建定时任务**。定期执行命令（需 AGENT_TRIGGERS feature flag） |
| `SleepTool/` | **休眠**。暂停执行一段时间，用于等待外部事件 |

**技能与配置类**

| 目录 | 作用 |
|------|------|
| `SkillTool/` | **技能调用**。调用内置或自定义技能 |
| `DiscoverSkillsTool/` | **技能发现**。搜索可用技能 |
| `ConfigTool/` | **配置工具**。修改运行时配置（仅 ant 内部） |

**MCP 类**

| 目录 | 作用 |
|------|------|
| `MCPTool/` | **MCP 工具**。动态加载的 MCP 服务器工具 |
| `McpAuthTool/` | **MCP 认证**。MCP 服务器的认证工具 |
| `ListMcpResourcesTool/` | **列出 MCP 资源**。列出 MCP 服务器提供的资源 |
| `ReadMcpResourceTool/` | **读取 MCP 资源**。读取 MCP 服务器提供的资源内容 |

**其他工具**

| 目录 | 作用 |
|------|------|
| `TodoWriteTool/` | **待办事项**。写入/更新待办事项列表 |
| `MonitorTool/` | **监控工具**。监控后台任务状态 |
| `RemoteTriggerTool/` | **远程触发**。远程触发 Agent 执行 |
| `BriefTool/` | **简要工具**。生成简要摘要 |
| `SendUserFileTool/` | **发送用户文件**。向用户发送文件 |
| `ReviewArtifactTool/` | **审查产物**。审查代码产物 |
| `VerifyPlanExecutionTool/` | **验证计划执行**。检查计划是否已执行 |
| `WorkflowTool/` | **工作流**。执行预定义工作流 |
| `LSPTool/` | **LSP 工具**。调用 Language Server 获取诊断信息（需 ENABLE_LSP_TOOL） |
| `TungstenTool/` | **Tungsten 工具**。Anthropic 内部工具 |
| `REPLTool/` | **REPL 工具**。在 REPL 模式下运行的专用工具 |
| `TerminalCaptureTool/` | **终端捕获**。捕获终端输出 |
| `SnipTool/` | **Snip 工具**。裁剪工具结果 |
| `SyntheticOutputTool/` | **合成输出**。生成合成工具输出 |
| `OverflowTestTool/` | **溢出测试**。测试上下文溢出处理 |
| `PushNotificationTool/` | **推送通知**。向用户发送推送通知 |
| `SubscribePRTool/` | **订阅 PR**。订阅 Pull Request 变更 |
| `shared/` | **共享工具**。多个工具共享的辅助函数 |
| `testing/` | **测试工具**。工具测试的辅助函数 |
| `utils.ts` | **工具工具函数**。工具相关的通用工具函数 |

#### 5.2.8 utils/ — 工具函数（574 文件）

最大的目录，包含各种辅助函数。按子目录分组：

**permissions/ — 权限系统（25 文件 + 1 子目录）**

权限系统是 Claude Code 安全体系的核心，决定"AI 能不能做这件事"。

| 文件 | 作用 |
|------|------|
| `permissions.ts` (52190 字节) | **权限决策主函数**。`hasPermissionsToUseTool()` 管道式决策链：deny → ask → checkPermissions → bypass-immune → bypass → alwaysAllow → ask |
| `permissionSetup.ts` (53439 字节) | **权限规则设置**。规则来源：userSettings / projectSettings / localSettings / flagSettings / policySettings / cliArg / command / session |
| `yoloClassifier.ts` (52160 字节) | **YOLO 分类器**。Auto 模式的核心——两阶段 LLM 分类器，决定工具调用是否自动放行 |
| `filesystem.ts` (62254 字节) | **文件系统权限**。文件读写权限的路径匹配和规则判断 |
| `PermissionMode.ts` | **权限模式定义**。7 种权限模式的枚举和切换逻辑 |
| `yolo-classifier-prompts/` | **分类器提示词**。auto_mode_system_prompt.txt、permissions_anthropic.txt、permissions_external.txt |
| `denialTracking.ts` | **拒绝追踪**。连续拒绝过多时触发熔断，回退到交互式弹窗 |
| `bypassPermissionsKillswitch.ts` | **bypass 紧急开关**。远程关闭 bypassPermissions 模式 |
| `dangerousPatterns.ts` | **危险模式**。识别危险的 Bash 命令模式 |
| `pathValidation.ts` | **路径验证**。权限规则中的路径匹配和验证 |
| `permissionExplainer.ts` | **权限解释器**。生成人类可读的权限描述 |
| `permissionRuleParser.ts` | **规则解析器**。解析权限规则字符串 |
| `permissionsLoader.ts` | **规则加载器**。从各来源加载权限规则 |
| `PermissionRule.ts` | **规则类型**。权限规则的数据结构 |
| `PermissionResult.ts` | **决策结果**。权限决策的结果类型 |
| `PermissionUpdate.ts` | **权限更新**。权限变更的处理逻辑 |
| `PermissionUpdateSchema.ts` | **更新 Schema**。权限更新的 Zod schema |
| `PermissionPromptToolResultSchema.ts` | **提示 Schema**。权限提示的 schema |
| `autoModeState.ts` | **Auto 模式状态**。Auto 模式的当前状态 |
| `bashClassifier.ts` | **Bash 分类器**。Bash 命令的快速分类 |
| `classifierDecision.ts` | **分类器决策**。YOLO 分类器的决策类型 |
| `classifierShared.ts` | **分类器共享**。分类器的共享工具函数 |
| `getNextPermissionMode.ts` | **下一权限模式**。权限模式的切换顺序 |
| `shellRuleMatching.ts` | **Shell 规则匹配**。Bash 命令的权限规则匹配 |
| `shadowedRuleDetection.ts` | **遮蔽规则检测**。检测被更宽泛规则遮蔽的冗余规则 |

**sandbox/ — 沙盒安全**

| 文件 | 作用 |
|------|------|
| `sandbox-adapter.ts` (35710 字节) | **沙盒适配器**。包装 `@anthropic-ai/sandbox-runtime`，Linux 上用 bwrap，macOS 上用 sandbox-exec。配置网络控制、文件系统控制 |
| `sandbox-ui-utils.ts` | **沙盒 UI 工具**。沙盒违规的 UI 显示 |

**utils/ 根目录关键文件**

| 文件 | 作用 |
|------|------|
| `claudemd.ts` | **CLAUDE.md 加载器**。`getClaudeMds()` 按优先级加载 CLAUDE.md（managed → user → project → local），支持 @include 指令 |
| `systemPrompt.ts` | **System Prompt 覆盖**。`buildEffectiveSystemPrompt()` 优先级链：override > coordinator > agent > custom > default |
| `queryContext.ts` | **上下文组装**。`fetchSystemPromptParts()` 组装最终的 prompt 上下文 |
| `sideQuery.ts` | **旁路查询**。与主 API 调用独立的简化 API 调用，用于 YOLO 分类器、autocompact、工具结果摘要 |
| `attachments.ts` | **附件注入**。记忆文件、排队命令、文件变更的附件消息注入 |
| `messages.ts` | **消息工具**。消息创建、规范化、压缩边界提取等 |
| `api.ts` | **API 工具**。`prependUserContext()` / `appendSystemContext()` 上下文拼接 |
| `log.ts` | **日志工具**。错误日志记录 |
| `debug.ts` | **调试工具**。Ant 内部调试日志 |
| `tokens.ts` | **Token 计算**。上下文 token 数量估算 |
| `context.ts` | **上下文工具**。`ESCALATED_MAX_TOKENS` 等上下文常量 |
| `model/model.ts` | **模型工具**。`getRuntimeMainLoopModel()` 获取当前使用的模型 |
| `imageValidation.ts` | **图片验证**。图片大小和格式校验 |
| `imageResizer.ts` | **图片缩放**。超大图片自动缩放 |
| `hooks.ts` | **Hook 工具**。Hook 的执行和 `executeStopFailureHooks()` |
| `hooks/postSamplingHooks.ts` | **后采样钩子**。模型响应完成后的钩子执行 |
| `messageQueueManager.ts` | **消息队列管理**。排队命令的优先级管理和消费 |
| `commandLifecycle.ts` | **命令生命周期**。命令的 started/completed 通知 |
| `toolResultStorage.ts` | **工具结果存储**。`applyToolResultBudget()` 工具结果预算裁剪 |
| `sessionStorage.ts` | **会话存储**。`recordContentReplacement()` 内容替换记录 |
| `headlessProfiler.ts` | **无头分析器**。无头模式的性能检查点 |
| `queryProfiler.ts` | **查询分析器**。`queryCheckpoint()` 性能检查点 |
| `crypto.ts` | **加密工具**。UUID 生成等 |
| `signal.ts` | **信号工具**。`createSignal()` 响应式状态 |
| `array.ts` | **数组工具**。`count()` 等数组辅助函数 |
| `worktree.ts` | **工作树工具**。`execIntoTmuxWorktree()` tmux 工作树 |
| `teammate.ts` | **队友工具**。多 Agent 队友管理 |
| `computerUse/` | **Computer Use**。Claude in Chrome 的 MCP 集成 |

#### 5.2.9 memdir/ — 记忆目录系统

管理 `~/.claude/projects/<slug>/memory/` 下的记忆文件。

| 文件 | 作用 |
|------|------|
| `memdir.ts` | **记忆主入口**。`loadMemoryPrompt()` 加载记忆目录，`buildMemoryPrompt()` 构建记忆提示词 |
| `paths.ts` | **记忆路径**。记忆目录的路径计算 |
| `memoryTypes.ts` | **记忆类型定义**。4 种类型：user / feedback / project / reference |
| `memoryAge.ts` | **记忆老化**。记忆的时效性评估 |
| `memoryScan.ts` | **记忆扫描**。扫描记忆目录中的文件 |
| `memoryShapeTelemetry.ts` | **记忆形状遥测**。记忆文件的格式和使用情况统计 |
| `findRelevantMemories.ts` | **相关记忆查找**。根据当前上下文找到最相关的记忆 |
| `teamMemPaths.ts` | **团队记忆路径**。团队共享记忆的路径 |
| `teamMemPrompts.ts` | **团队记忆提示词**。团队记忆的提示词构建 |

#### 5.2.10 skills/ — 技能系统

技能是用户可调用的 `/xxx` 命令的高级封装。

| 文件 | 作用 |
|------|------|
| `bundledSkills.ts` | **捆绑技能定义**。所有内置技能的注册表 |
| `loadSkillsDir.ts` | **技能目录发现**。从目录自动发现自定义技能 |
| `bundled/` | **内置技能**（20 个技能文件 + 子目录） |

**内置技能清单**

| 技能文件 | 对应的 /xxx 命令 | 作用 |
|---------|-----------------|------|
| `verify.ts` | `/review` | 代码审查 |
| `debug.ts` | `/debug` | 调试辅助 |
| `stuck.ts` | `/stuck` | 卡住时的自救策略 |
| `loop.ts` | `/loop` | 循环执行任务 |
| `remember.ts` | `/remember` | 保存记忆 |
| `simplify.ts` | `/simplify` | 代码简化审查 |
| `updateConfig.ts` | `/config` | 配置修改 |
| `claudeApi.ts` | `/claude-api` | Claude API 使用指南 |
| `keybindings.ts` | 键绑定相关 | 键盘快捷键配置 |
| `batch.ts` | 批量执行 | 批量执行多个任务 |
| `dream.ts` | Dream 模式 | 空闲时的后台思考 |
| `hunter.ts` | Hunter 模式 | 自动搜索和修复 |
| `loremIpsum.ts` | 测试技能 | 生成占位文本（测试用） |
| `skillify.ts` | 技能创建 | 辅助创建新技能 |
| `runSkillGenerator.ts` | 技能生成器 | 运行技能的通用生成器 |
| `scheduleRemoteAgents.ts` | 远程调度 | 调度远程 Agent |
| `claudeInChrome.ts` | Chrome 集成 | Claude in Chrome 功能 |
| `index.ts` | 技能索引 | 技能注册入口 |

#### 5.2.11 components/ — React UI 组件（150+ 文件）

Claude Code 终端 UI 的所有视觉组件，基于 React + Ink。

**关键子目录**

| 目录 | 作用 |
|------|------|
| `permissions/` | **权限交互**（30+ 文件）。权限提示弹窗、允许/拒绝按钮、规则编辑器 |
| `messages/` | **消息渲染**。助手消息、工具结果、错误信息的显示 |
| `memory/` | **记忆管理**。记忆文件的查看和编辑 UI |
| `design-system/` | **设计系统**。基础 UI 原子组件（颜色、间距、字体） |
| `PromptInput/` | **输入框**。用户输入的自动补全、@提及、斜杠命令补全 |
| `diff/` | **差异显示**。文件编辑的差异对比展示 |
| `StructuredDiff/` | **结构化差异**。更精细的差异高亮 |
| `HighlightedCode/` | **代码高亮**。代码块的语法高亮显示 |
| `HelpV2/` | **帮助系统**。帮助信息和快捷键提示 |
| `FeedbackSurvey/` | **反馈调查**。用户反馈收集 UI |
| `mcp/` | **MCP 管理**。MCP 服务器配置界面 |
| `sandbox/` | **沙盒信息**。沙盒违规的详细展示 |
| `skills/` | **技能管理**。技能的发现和管理 UI |
| `settings/` | **设置页面**。配置修改界面 |
| `tasks/` | **任务列表**。任务创建和追踪 UI |
| `teams/` | **团队管理**。多 Agent 团队的管理界面 |
| `agents/` | **Agent 状态**。子 Agent 的执行进度显示 |
| `TrustDialog/` | **信任对话框**。首次打开项目时的信任确认 |
| `shell/` | **Shell 组件**。Bash 工具的输出显示 |
| `Spinner/` | **加载动画**。各种状态的加载动画 |
| `hooks/` | **组件 Hooks**。UI 组件使用的 React Hooks |
| `ui/` | **通用 UI**。按钮、选择器等通用组件 |
| `wizard/` | **向导**。分步设置向导 |
| `wizard/` | **Logo**。Logo 和品牌图标 |
| `grove/` | **Grove**。Anthropic 内部功能 UI |
| `Passes/` | **Passes**。订阅通行证管理 |
| `DesktopUpsell/` | **桌面版推荐**。桌面应用推荐 UI |
| `LspRecommendation/` | **LSP 推荐**。LSP 工具的推荐弹窗 |
| `ManagedSettingsSecurityDialog/` | **托管设置安全对话框**。企业策略的展示 |
| `ClaudeCodeHint/` | **提示条**。使用技巧的提示条 |
| `CustomSelect/` | **自定义选择器**。选项列表组件 |

**关键独立组件**

| 文件 | 作用 |
|------|------|
| `App.tsx` | **主应用组件**。整个 REPL 的顶层 React 组件 |
| `Message.tsx` | **消息组件**。单条消息的渲染 |
| `Messages.tsx` | **消息列表**。所有消息的列表展示 |
| `VirtualMessageList.tsx` | **虚拟消息列表**。长对话的虚拟滚动，避免渲染过多消息 |
| `FullscreenLayout.tsx` | **全屏布局**。REPL 的整体布局 |
| `StatusLine.tsx` | **状态栏**。底部的模型/费用/状态信息 |
| `DevBar.tsx` | **开发栏**。内部调试信息栏 |
| `ModelPicker.tsx` | **模型选择器**。切换模型的下拉菜单 |
| `ThemePicker.tsx` | **主题选择器**。切换深色/浅色主题 |
| `OutputStylePicker.tsx` | **输出风格选择器**。切换输出风格 |
| `Onboarding.tsx` | **首次引导**。首次使用的引导流程 |
| `ContextVisualization.tsx` | **上下文可视化**。展示当前上下文的 token 分布 |
| `BypassPermissionsModeDialog.tsx` | **bypass 模式确认**。开启 bypass 的安全确认弹窗 |
| `MCPServerApprovalDialog.tsx` | **MCP 审批对话框**。新 MCP 服务器的连接确认 |
| `TaskListV2.tsx` | **任务列表 V2**。新版任务管理 UI |
| `CompactSummary.tsx` | **压缩摘要**。上下文压缩后的摘要展示 |
| `TokenWarning.tsx` | **Token 警告**。上下文接近限制时的警告 |

#### 5.2.12 ink/ — 自定义 Ink 渲染器（32+ 文件 + 7 子目录）

Claude Code 对 Ink（React 终端渲染框架）的大量定制。

| 文件 | 作用 |
|------|------|
| `ink.tsx` (251886 字节) | **核心渲染引擎**。项目中最大的单文件，包含完整的终端渲染逻辑 |
| `reconciler.ts` | **React Reconciler**。将 React 组件树适配到终端输出 |
| `screen.ts` | **屏幕管理**。终端屏幕的缓冲区和刷新 |
| `render-node-to-output.ts` | **节点渲染**。将 React 节点渲染为终端文本 |
| `selection.ts` | **文本选择**。终端中的文本选择支持 |
| `parse-keypress.ts` | **按键解析**。终端按键事件的解析 |
| `output.ts` | **输出管理**。终端输出的写入和缓冲 |
| `Ansi.tsx` | **ANSI 组件**。ANSI 转义序列的渲染 |
| `render-border.ts` | **边框渲染**。Box 组件的边框绘制 |
| `log-update.ts` | **日志更新**。终端日志的增量更新 |
| `render-to-screen.ts` | **渲染到屏幕**。将渲染结果写入终端 |
| `styles.ts` | **样式系统**。文本样式（粗体、颜色等）的处理 |
| `reconciler.ts` | **协调器**。React Fiber 到终端节点的映射 |
| `dom.ts` | **DOM 模型**。终端 UI 的虚拟 DOM |
| `focus.ts` | **焦点管理**。组件焦点链 |
| `terminal.ts` | **终端封装**。终端的低级操作 |
| `components/` | **基础组件**。Box、Text、Button、ScrollBox、Link、Spacer 等 18 个组件 |
| `termio/` | **终端 I/O**。终端输入输出的底层处理 |
| `events/` | **事件系统**。终端事件（鼠标、resize）的处理 |
| `hooks/` | **Ink Hooks**。useInput、useFocus 等 React Hooks |
| `layout/` | **布局引擎**。Flexbox 布局的终端实现 |

#### 5.2.13 hooks/ — React Hooks（80+ 文件）

React 组件使用的自定义 Hooks，处理各种 UI 逻辑。

**关键 Hooks**

| 文件 | 作用 |
|------|------|
| `useCanUseTool.tsx` | **权限判断 Hook**。`canUseTool()` 回调，供工具执行管道调用 |
| `useGlobalKeybindings.tsx` | **全局键绑定**。Ctrl+C 中断、Ctrl+D 退出等 |
| `useCommandKeybindings.tsx` | **命令键绑定**。斜杠命令的快捷键 |
| `useQueueProcessor.ts` | **队列处理器**。消费排队中的用户命令 |
| `useTextInput.ts` | **文本输入**。用户输入框的状态和事件处理 |
| `useVimInput.ts` | **Vim 输入**。Vim 模式的输入处理 |
| `useHistorySearch.ts` | **历史搜索**。上下箭头搜索历史命令 |
| `useMergedTools.ts` | **工具合并**。合并内置工具和 MCP 工具 |
| `useMergedClients.ts` | **客户端合并**。合并 MCP 客户端 |
| `useSettings.ts` | **设置 Hook**。读取和监听配置变更 |
| `useSettingsChange.ts` | **设置变更 Hook**。配置变更的响应式处理 |
| `useVoice.ts` | **语音 Hook**。语音输入的状态管理 |
| `useRemoteSession.ts` | **远程会话**。远程连接的状态管理 |
| `useSSHSession.ts` | **SSH 会话**。SSH 连接的状态管理 |
| `useMainLoopModel.ts` | **主循环模型**。当前使用模型的响应式状态 |
| `useManagePlugins.ts` | **插件管理**。插件的安装和卸载 |
| `useTasksV2.ts` | **任务 V2**。任务系统的状态管理 |
| `useSwarmInitialization.ts` | **群组初始化**。多 Agent 群组的启动 |
| `useCopyOnSelect.ts` | **选中复制**。鼠标选中自动复制 |
| `useTerminalSize.ts` | **终端尺寸**。终端窗口大小变化 |
| `useVirtualScroll.ts` | **虚拟滚动**。长列表的虚拟滚动 |

#### 5.2.14 其他目录

| 目录 | 关键文件 | 作用 |
|------|---------|------|
| `assistant/` | `index.ts`, `sessionDiscovery.ts`, `sessionHistory.ts` | **助手模式**（KAIROS feature flag）。后台自主运行的 Agent 模式，能主动发现和处理任务 |
| `bridge/` | `bridgeMain.ts`, `replBridge.ts`, `bridgeMessaging.ts` 等 33 个文件 | **Bridge 通信**。远程控制 Claude Code（VS Code 扩展、桌面客户端等通过 bridge 协议与 CLI 通信） |
| `cli/` | `print.ts`, `exit.ts`, `update.ts`, `remoteIO.ts`, `structuredIO.ts` | **CLI 工具**。后台会话管理、输出格式化、更新检查 |
| `commands/` | 100+ 子目录和文件 | **斜杠命令实现**。每个 `/xxx` 命令一个目录或文件，如 `/compact`、`/doctor`、`/review` 等 |
| `coordinator/` | `coordinatorMode.ts`, `workerAgent.ts` | **协调器模式**。Coordinator 只能使用 AgentTool + SendMessageTool，Worker Agent 通过 task-notification 接收结果 |
| `context/` | 9 个文件 | **上下文管理辅助**。上下文相关的辅助功能 |
| `jobs/` | 1 个文件 | **后台任务系统**。模板任务的分类和调度 |
| `keybindings/` | 15 个文件 | **键绑定**。键盘快捷键的定义和管理 |
| `migrations/` | 11 个文件 | **数据迁移**。配置格式升级时的自动迁移 |
| `moreright/` | 1 个文件 | **MoreRight**。UI 右侧面板的扩展 |
| `native-ts/` | 4 个文件 | **原生模块**。需要原生编译的 TypeScript 模块 |
| `outputStyles/` | 1 个文件 | **输出样式**。不同输出风格的配置 |
| `plugins/` | `builtinPlugins.ts`, `bundled/index.ts` | **插件系统**。内置插件注册表，插件可提供技能、钩子、MCP 服务器 |
| `proactive/` | `index.ts`, `useProactive.ts` | **主动式 Agent**。Agent 主动发起操作（非被动响应） |
| `remote/` | 4 个文件 | **远程会话**。远程连接支持 |
| `schemas/` | 1 个文件 | **JSON Schema**。配置文件的 JSON Schema 定义 |
| `screens/` | `REPL.tsx`, `Doctor.tsx`, `ResumeConversation.tsx` | **顶层屏幕**。REPL 主界面、诊断页面、恢复会话页面 |
| `server/` | 3 个文件 | **本地服务器**。本地的 HTTP/WebSocket 服务器 |
| `ssh/` | 2 个文件 | **SSH 连接**。通过 SSH 远程使用 Claude Code |
| `state/` | 6 个文件 | **状态管理**。React 组件的响应式状态 |
| `tasks/` | 14 个文件 | **任务调度**。后台任务的调度和管理 |
| `types/` | 19 个文件 | **类型定义**。TypeScript 类型（permissions.ts、message.ts、hooks.ts、plugin.ts 等） |
| `upstreamproxy/` | 2 个文件 | **上游代理**。CCR 环境的代理配置 |
| `vim/` | 5 个文件 | **Vim 模式**。hjkl 移动、插入/普通模式等 Vim 键位 |
| `voice/` | 1 个文件 | **语音输入**。麦克风录音和语音识别 |

### 5.3 仓库根目录其他重要文件

```
Claude-Code/
├── package.json              # 包配置，版本 999.0.0-restored
├── tsconfig.json             # TypeScript 配置（ESNext + Bun）
├── vendor/                   # 第三方代码
├── shims/                    # 原生模块 shim
└── src/                      # 源码主目录
```

---

## 6. 技术栈讲解

Claude Code 的技术栈选型非常独特——它不是一个典型的 Node.js 项目，而是一个 **Bun + TypeScript + React/Ink** 的全栈 CLI 应用。

### 6.1 Bun — 运行时

::: info 为什么选 Bun 而不是 Node.js？
Bun 是一个高性能的 JavaScript/TypeScript 运行时，内置了 TypeScript 支持、包管理器和打包器。Claude Code 选择 Bun 的原因：
- **原生 TypeScript 支持**：无需编译步骤，直接运行 `.ts` 文件
- **极速启动**：Bun 的冷启动速度远快于 Node.js
- **内置 API**：`Bun.file()`、`Bun.spawn()` 等原生 API，无需额外依赖
:::

从 `package.json` 可以看到：

```json
{
  "name": "@anthropic-ai/claude-code",
  "version": "999.0.0-restored",
  "type": "module",
  "packageManager": "bun@1.3.5",
  "engines": {
    "bun": ">=1.3.5",
    "node": ">=24.0.0"
  }
}
```

关键点：
- **ESM 模块系统**：`"type": "module"`，所有代码使用 ES Module
- **入口**：`"dev": "bun run ./src/dev-entry.ts"`，直接运行 TypeScript
- **兼容 Node**：`engines` 字段表明也支持 Node >= 24

从 `tsconfig.json` 看编译配置：

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": false,
    "types": ["bun"]
  }
}
```

- **ESNext 目标**：使用最新 JS 特性，无需降级
- **bundler 模块解析**：支持 Bun 的打包器特性
- **react-jsx**：React 17+ 自动 JSX 转换
- **strict: false**：非严格模式（反编译代码的特殊需求）
- **types: ["bun"]**：Bun 类型定义

### 6.2 TypeScript — 语言

Claude Code 全面使用 TypeScript，但有几个特点：

1. **Zod 运行时验证**：TypeScript 的类型只在编译时有效，Claude Code 用 Zod 实现运行时类型验证

```typescript
// src/Tool.ts — 工具的输入使用 Zod schema
export type Tool<Input extends AnyObject = AnyObject, ...> = {
  readonly inputSchema: Input  // Zod schema，同时用于编译时类型和运行时验证
  // ...
}
```

2. **条件导入实现死代码消除**：

```typescript
// src/tools.ts — 条件 require 实现构建时死代码消除
const AgentTool = feature('COORDINATOR_MODE') ? require('./tools/AgentTool/AgentTool.js') : null
```

3. **Feature Flag 门控**：

```typescript
// src/entrypoints/cli.tsx — 功能门控
if (feature('BRIDGE_MODE')) { /* ... */ }
if (feature('DAEMON')) { /* ... */ }
if (feature('BG_SESSIONS')) { /* ... */ }
```

### 6.3 Zod — 运行时类型验证

Zod 是 Claude Code 工具系统的核心验证层。每个工具的输入参数都通过 Zod schema 定义：

```typescript
// 工具输入定义示例（简化）
const FileEditInputSchema = z.object({
  file_path: z.string().describe("文件的绝对路径"),
  old_string: z.string().describe("要替换的文本"),
  new_string: z.string().describe("替换后的文本"),
  replace_all: z.boolean().default(false),
})

// 运行时验证
const result = tool.inputSchema.safeParse(userInput)
if (!result.success) {
  // 验证失败，返回错误
}
```

Zod 在 Claude Code 中的三重作用：
- **编译时类型**：`z.infer<typeof schema>` 提取 TypeScript 类型
- **运行时验证**：`schema.safeParse()` 验证 LLM 返回的参数
- **API Schema 生成**：`toolToAPISchema()` 将 Zod schema 转换为 Anthropic API 的 `tools` 参数格式

### 6.4 Ink + React — 终端 UI 渲染

这是 Claude Code 最独特的技术选型：**用 React 组件模型来渲染终端 UI**。

Ink 是一个基于 React 的终端渲染框架，它实现了 React Reconciler 来将 React 组件树渲染为终端文本输出。

```
React 组件树 → Ink Reconciler → 终端文本输出
```

Claude Code 对 Ink 做了大量定制：

1. **自定义 Reconciler**（`src/ink/reconciler.ts`，14594 字节）：Claude Code 并非直接使用 Ink 的 reconciler，而是做了定制适配
2. **自定义渲染器**（`src/ink/ink.tsx`，251886 字节！）：这是项目中最大的单个文件，包含完整的终端渲染逻辑
3. **自定义组件库**（`src/ink/components/`）：Box、Text、Button、ScrollBox 等基础组件
4. **终端 I/O**（`src/ink/termio/`）：底层终端交互

```typescript
// src/ink/ 的核心结构
src/ink/
├── ink.tsx              # 核心渲染引擎（251KB）
├── reconciler.ts        # React Reconciler 适配
├── screen.ts            # 屏幕管理（49KB）
├── render-node-to-output.ts  # 节点渲染（63KB）
├── components/          # 基础组件（Box/Text/Button/ScrollBox 等）
├── termio/              # 终端 I/O
└── ...
```

加上 `src/components/` 下 150+ 个 React 组件，Claude Code 的 UI 层是一个完整的 React 终端应用。

### 6.5 Commander.js — CLI 参数解析

Claude Code 使用 `@commander-js/extra-typings`（Commander.js 的 TypeScript 增强版）来定义 CLI 参数：

```typescript
// src/main.tsx — Commander CLI 定义（简化）
const program = new CommanderCommand()

program
  .option('--model <model>', '指定模型')
  .option('--system-prompt <prompt>', '自定义系统提示')
  .option('--allowedTools <tools>', '允许的工具列表')
  .option('--max-turns <n>', '最大轮数')
  .option('--permission-mode <mode>', '权限模式')
  // ... 更多选项
```

### 6.6 技术栈全景

| 层级 | 技术 | 作用 |
|------|------|------|
| **运行时** | Bun | 执行环境，原生 TS 支持 |
| **语言** | TypeScript (ESNext) | 类型安全 |
| **运行时验证** | Zod | 工具参数验证 + API Schema 生成 |
| **终端 UI** | Ink + React | 组件化终端渲染 |
| **CLI 框架** | Commander.js | 命令行参数解析 |
| **LLM SDK** | @anthropic-ai/sdk | Anthropic API 客户端 |
| **Agent SDK** | @anthropic-ai/claude-agent-sdk | 多 Agent 支持 |
| **沙盒** | @anthropic-ai/sandbox-runtime | 进程隔离 |
| **MCP** | @modelcontextprotocol/sdk | 工具协议集成 |
| **Feature Flag** | @growthbook/growthbook | 运行时功能开关 |
| **遥测** | @opentelemetry/* | 可观测性 |
| **云服务** | @aws-sdk/client-bedrock-runtime, google-auth-library | 多云部署支持 |

---

## 7. 如何调试 Claude Code 源码

### 7.1 环境准备

```bash
# 1. 克隆仓库
git clone https://github.com/dgai5016/Claude-Code.git
cd Claude-Code

# 2. 安装 Bun（如果未安装）
curl -fsSL https://bun.sh/install | bash

# 3. 安装依赖
bun install

# 4. 开发模式启动
bun run dev
```

::: warning 注意
由于这是反编译恢复的源码，`bun install` 可能无法完整安装所有依赖。如果遇到缺失依赖，可以尝试跳过依赖安装，直接阅读源码。
:::

### 7.2 关键环境变量

Claude Code 通过大量环境变量控制行为，以下是调试时最常用的：

| 环境变量 | 作用 | 示例 |
|---------|------|------|
| `ANTHROPIC_API_KEY` | API 密钥 | `sk-ant-...` |
| `ANTHROPIC_BASE_URL` | API 代理地址 | `http://localhost:8080` |
| `CLAUDE_CODE_AUTO_MODE_MODEL` | Auto 模式使用的模型 | `claude-haiku-4-5-20251001` |
| `CLAUDE_CODE_MAX_OUTPUT_TOKENS` | 输出 token 上限 | `16384` |
| `CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING` | 禁用自适应 thinking | `1` |

### 7.3 源码阅读路径

推荐的源码阅读顺序，与本书章节对应：

```
第一阶段：理解启动流程
1. src/dev-entry.ts        → 开发入口
2. src/entrypoints/cli.tsx  → CLI 引导
3. src/entrypoints/init.ts  → 初始化序列
4. src/main.tsx             → Commander 定义 + REPL 启动

第二阶段：理解核心循环
5. src/QueryEngine.ts       → SDK 入口
6. src/query.ts             → Agent 循环
7. src/Tool.ts              → 工具接口
8. src/tools.ts             → 工具注册

第三阶段：理解 Prompt 构建
9. src/constants/prompts.ts          → System Prompt 构建
10. src/constants/systemPromptSections.ts → Section 机制
11. src/utils/claudemd.ts            → CLAUDE.md 加载
12. src/memdir/memdir.ts             → 记忆目录

第四阶段：理解工具与安全
13. src/services/tools/toolExecution.ts     → 工具执行
14. src/utils/permissions/permissions.ts    → 权限决策
15. src/utils/sandbox/sandbox-adapter.ts    → 沙盒隔离
```

### 7.4 调试技巧

**方法一：添加 console.log**

由于 Bun 直接运行 TypeScript，可以直接在源码中添加 `console.log`：

```typescript
// 在 src/query.ts 的 queryLoop 中添加日志
async function* queryLoop(params: QueryParams) {
  console.log('[DEBUG] queryLoop started with messages:', params.messages.length)
  // ...
}
```

**方法二：使用 `--dump-system-prompt`**

Claude Code 内置了系统 Prompt 导出功能：

```bash
bun run dev --dump-system-prompt
```

这会调用 `src/constants/prompts.ts` 的 `getSystemPrompt()` 并输出完整的系统提示词，非常适合理解 Prompt 是如何组装的。

**方法三：使用 `--version` 快速路径**

```bash
bun run dev --version
```

这是最简单的启动路径，在 `src/entrypoints/cli.tsx` 中直接输出版本号，不加载任何子系统。可以用来验证基本启动是否正常。

**方法四：Feature Flag 控制**

Claude Code 大量使用 feature flag 来控制功能开关。通过 `feature()` 函数和 `bun:bundle` 的构建时宏，许多代码路径在构建时就被消除了：

```typescript
// src/entrypoints/cli.tsx 中的 feature flag 门控
if (feature('BRIDGE_MODE')) {
  // 仅在 BRIDGE_MODE 启用时编译
}
if (feature('COORDINATOR_MODE')) {
  // 仅在 COORDINATOR_MODE 启用时编译
}
```

调试时需要注意：某些代码路径可能因为 feature flag 关闭而无法执行。

### 7.5 常见问题

**Q: `bun install` 失败怎么办？**

反编译源码的 `package.json` 可能引用了不存在的包或内部包。可以尝试：
- 删除 `node_modules` 后重试
- 只阅读源码，不实际运行

**Q: 为什么某些 `require()` 路径以 `.js` 结尾但文件是 `.ts`？**

这是 Bun 的特性——Bun 在解析模块时会自动将 `.js` 扩展名映射到 `.ts` 文件。例如 `require('./tools.js')` 实际加载的是 `./tools.ts`。

**Q: 为什么代码中有 `MACRO` 全局变量？**

`MACRO` 是构建时注入的宏，在 `src/dev-entry.ts` 中有降级处理：

```typescript
// src/dev-entry.ts:1-29
const MACRO = globalThis.MACRO ?? {
  VERSION: pkg.version,
  BUILD_TIME: new Date().toISOString(),
  PACKAGE_URL: pkg.repository?.url,
  // ...
}
```

---

## 本章小结

本章建立了以下全局认知：

1. **Claude Code 不是聊天机器人，是 AI Agent**——它有工具、有循环、有记忆、有权限
2. **Agent 的核心是 `while(true)` 循环**——LLM 自主决定何时停止
3. **源码来自反编译**——部分代码可能不完整，但架构和核心逻辑清晰可读
4. **技术栈独特**——Bun + TypeScript + Zod + Ink/React + Commander
5. **12 个核心子系统**——从 API 通信到沙盒安全，构成完整的 Agent 运行时

下一章我们将对这 12 个子系统做高层概览，建立"全局地图"，为后续逐章深入打下基础。
