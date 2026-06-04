# 第三章：核心运行流程全链路源码逐行走读

::: tip 阅读建议
本章是全文的"骨架"——先看懂整台机器怎么转，后续章节再逐个拆解每个零件。建议配合源码仓库同步阅读，每个步骤都标注了真实文件路径和行号。
:::

---

## 全链路概览

当你在终端输入 `claude` 并回车，到 AI 给出第一条回复，中间经历了 17 个步骤。我们按真实源码执行顺序逐行走读：

```
① 启动入口    dev-entry.ts → cli.tsx
② 初始化      init.ts — 配置、环境变量、TLS、遥测、OAuth
③ CLI 解析    main.tsx — Commander 参数解析 + REPL 启动
④ 加载记忆    claudemd.ts + memdir.ts — CLAUDE.md + 记忆目录
⑤ 拼接 Prompt prompts.ts + systemPromptSections.ts + systemPrompt.ts + queryContext.ts
⑥ 启动循环    QueryEngine.submitMessage() → query() → queryLoop()
⑦ 上下文准备  压缩边界提取 + 5 级压缩级联
⑧ API 调用    claude.ts — queryModelWithStreaming()
⑨ 流式工具执行 StreamingToolExecutor — 并发安全工具并行
⑩ 解析工具调用 提取 tool_use 块 + Zod 验证
⑪ 权限校验    permissions.ts — 管道式决策链
⑫ Hook 执行   toolHooks.ts — PreToolUse hooks
⑬ 执行工具    toolExecution.ts — runToolUse() → tool.call()
⑭ PostToolUse hooks — 可修改工具输出
⑮ 结果映射    tool.mapToolResultToToolResultBlockParam() + 预算裁剪
⑯ 附件注入    记忆文件、排队命令、文件变更
⑰ 多轮循环    重建消息状态，回到步骤 ⑦
```

---

## 步骤 ①：启动入口

### dev-entry.ts — 开发模式守门员

一切从 `src/dev-entry.ts` 开始。这是 restored 源码的"守门员"——在把控制权交给真正的 CLI 之前，它先检查源码完整性。

```typescript
// src/dev-entry.ts — 完整源码逐行解析

import pkg from '../package.json'
import { existsSync, readdirSync, readFileSync } from 'fs'
import { dirname, extname, join, resolve } from 'path'

// ① 定义构建时宏的类型——这些字段在正式构建时会被内联替换
// 在 restored 源码中，MACRO 未定义，所以用 package.json 的值填充
type MacroConfig = {
  VERSION: string
  BUILD_TIME: string
  PACKAGE_URL: string
  NATIVE_PACKAGE_URL: string
  VERSION_CHANGELOG: string
  ISSUES_EXPLAINER: string
  FEEDBACK_CHANNEL: string
}

const defaultMacro: MacroConfig = {
  VERSION: pkg.version,                    // "999.0.0-restored"
  BUILD_TIME: '',                          // 构建时填充，restored 源码无此信息
  PACKAGE_URL: pkg.name,                   // "@anthropic-ai/claude-code"
  NATIVE_PACKAGE_URL: pkg.name,
  VERSION_CHANGELOG: '',
  ISSUES_EXPLAINER:
    'file an issue at https://github.com/anthropics/claude-code/issues',
  FEEDBACK_CHANNEL: 'github',
}

// ② 如果全局没有 MACRO 对象（正式构建会注入），则使用默认值
if (!('MACRO' in globalThis)) {
  ;(globalThis as typeof globalThis & { MACRO: MacroConfig }).MACRO =
    defaultMacro
}

// ③ 定义缺失导入的类型——记录哪个文件导入了哪个不存在的模块
type MissingImport = {
  importer: string   // 发起导入的文件路径
  specifier: string  // 相对导入路径（如 './foo'）
}

// ④ 递归扫描目录，收集所有 .ts/.tsx/.js/.jsx/.mjs/.cjs 文件
function scanFiles(dir: string, out: string[]): void {
  if (!existsSync(dir)) return
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      scanFiles(fullPath, out)   // 递归进入子目录
      continue
    }
    if (['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(extname(entry.name))) {
      out.push(fullPath)
    }
  }
}

// ⑤ 检查一个导入路径是否可以解析到真实文件
// 尝试所有可能的扩展名和 index 文件组合
function hasResolvableTarget(basePath: string): boolean {
  const withoutJs = basePath.replace(/\.js$/u, '')
  const candidates = [
    withoutJs,                       // 原路径
    `${withoutJs}.ts`,               // TypeScript
    `${withoutJs}.tsx`,              // TSX
    `${withoutJs}.js`,               // JavaScript
    `${withoutJs}.jsx`,              // JSX
    `${withoutJs}.mjs`,              // ES Module
    `${withoutJs}.cjs`,              // CommonJS
    join(withoutJs, 'index.ts'),     // 目录 index
    join(withoutJs, 'index.tsx'),
    join(withoutJs, 'index.js'),
  ]
  return candidates.some(candidate => existsSync(candidate))
}

// ⑥ 核心检查函数：扫描 src/ 和 vendor/ 中的所有文件，提取相对导入，
// 检查每个导入是否能解析到真实文件
function collectMissingRelativeImports(): MissingImport[] {
  const files: string[] = []
  scanFiles(resolve('src'), files)     // 扫描 src/ 目录
  scanFiles(resolve('vendor'), files)  // 扫描 vendor/ 目录
  const missing: MissingImport[] = []
  const seen = new Set<string>()
  // 正则匹配 import/export ... from './...' 和 require('./...')
  const pattern =
    /(?:import|export)\s+[\s\S]*?from\s+['"](\.\.?\/[^'"]+)['"]|require\(\s*['"](\.\.?\/[^'"]+)['"]\s*\)/g

  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    for (const match of text.matchAll(pattern)) {
      const specifier = match[1] ?? match[2]
      if (!specifier) continue
      const target = resolve(dirname(file), specifier)  // 解析为绝对路径
      if (hasResolvableTarget(target)) continue          // 能解析就跳过
      const key = `${file} -> ${specifier}`
      if (seen.has(key)) continue                        // 去重
      seen.add(key)
      missing.push({
        importer: file,
        specifier,
      })
    }
  }

  return missing.sort((a, b) =>
    `${a.importer}:${a.specifier}`.localeCompare(`${b.importer}:${b.specifier}`),
  )
}

// ⑦ 主流程开始：收集参数和缺失导入
const args = process.argv.slice(2)
const missingImports = collectMissingRelativeImports()

// ⑧ --version 快速路径：输出版本号和缺失导入数（如果有）
if (args.includes('--version')) {
  if (missingImports.length > 0) {
    console.log(`${pkg.version} (restored dev workspace)`)
    console.log(`missing_relative_imports=${missingImports.length}`)
    process.exit(0)
  }
  console.log(pkg.version)
  process.exit(0)
}

// ⑨ --help 快速路径
if (args.includes('--help')) {
  if (missingImports.length > 0) {
    console.log('Claude Code restored development workspace')
    console.log(`version: ${pkg.version}`)
    console.log(`missing relative imports: ${missingImports.length}`)
    process.exit(0)
  }
  console.log('Usage: claude [options] [prompt]')
  console.log('')
  console.log('Basic restored commands:')
  console.log('  --help       Show this help')
  console.log('  --version    Show version')
  console.log('')
  console.log('Interactive REPL startup is routed to src/main.tsx when run without these flags.')
  process.exit(0)
}

// ⑩ 缺失导入报告——restored 源码不完整时的安全网
if (missingImports.length > 0) {
  console.log('Claude Code restored development workspace')
  console.log(`version: ${pkg.version}`)
  console.log(`missing relative imports: ${missingImports.length}`)
  console.log('')
  console.log('Top missing modules:')
  for (const item of missingImports.slice(0, 20)) {
    console.log(`- ${item.importer.replace(`${process.cwd()}/`, '')} -> ${item.specifier}`)
  }
  console.log('')
  console.log('The original app entry is still blocked by missing restored sources.')
  console.log('Use this workspace to continue restoration; once missing imports reach 0, this launcher will forward to src/main.tsx automatically.')
  process.exit(0)
}

// ⑪ 所有导入都正常，转发到真正的 CLI 入口
await import('./entrypoints/cli.tsx')
```

**设计意图**：restored 源码可能不完整，这个守门员确保在导入不完整时尽早失败，而不是运行到一半才崩溃。`collectMissingRelativeImports()` 通过正则扫描所有源文件的 `import`/`require` 语句，验证每个相对导入路径是否能解析到真实文件——这是一种纯静态分析，不需要执行任何代码。

### cli.tsx — 主引导入口，快速路由

`src/entrypoints/cli.tsx` 的 `main()` 函数是一个路由器，根据命令行参数决定走哪条路径。**所有非默认路径都使用动态导入**（`await import()`），避免加载不需要的模块，加速启动。

```typescript
// src/entrypoints/cli.tsx — main() 完整路由逻辑

import { feature } from 'bun:bundle';

// ① Bugfix：corepack 自动 pin 会往 package.json 添加 yarnpkg，关闭此行为
process.env.COREPACK_ENABLE_AUTO_PIN = '0';

// ② CCR（Claude Code Remote）容器环境设置最大堆内存
// 容器通常有 16GB 内存，8192MB 堆上限避免 OOM
if (process.env.CLAUDE_CODE_REMOTE === 'true') {
  const existing = process.env.NODE_OPTIONS || '';
  process.env.NODE_OPTIONS = existing
    ? `${existing} --max-old-space-size=8192`
    : '--max-old-space-size=8192';
}

// ③ Harness-science L0 消融基线：在模块导入前设置环境变量
// 因为 BashTool/AgentTool/PowerShellTool 在 import 时就会读取这些值
// init() 运行时已经太晚了。feature() 门控在外部构建中会 DCE 整个块
if (feature('ABLATION_BASELINE') && process.env.CLAUDE_CODE_ABLATION_BASELINE) {
  for (const k of [
    'CLAUDE_CODE_SIMPLE',
    'CLAUDE_CODE_DISABLE_THINKING',
    'DISABLE_INTERLEAVED_THINKING',
    'DISABLE_COMPACT',
    'DISABLE_AUTO_COMPACT',
    'CLAUDE_CODE_DISABLE_AUTO_MEMORY',
    'CLAUDE_CODE_DISABLE_BACKGROUND_TASKS',
  ]) {
    process.env[k] ??= '1';   // 只在未设置时默认开启
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // ─── 快速路径 1：--version/-v，零模块加载 ───
  // 这是启动最快的路径——连 startupProfiler 都不加载
  if (
    args.length === 1 &&
    (args[0] === '--version' || args[0] === '-v' || args[0] === '-V')
  ) {
    console.log(`${MACRO.VERSION} (Claude Code)`);
    return;
  }

  // ─── 所有其他路径都需要启动性能分析器 ───
  const { profileCheckpoint } = await import('../utils/startupProfiler.js');
  profileCheckpoint('cli_entry');

  // ─── 快速路径 2：--dump-system-prompt，导出完整系统提示词 ───
  // 用于提示词敏感性评估，在特定 commit 提取系统提示词
  // 仅限 Ant 内部：feature('DUMP_SYSTEM_PROMPT') 在外部构建中被 DCE
  if (feature('DUMP_SYSTEM_PROMPT') && args[0] === '--dump-system-prompt') {
    profileCheckpoint('cli_dump_system_prompt_path');
    const { enableConfigs } = await import('../utils/config.js');
    enableConfigs();
    const { getMainLoopModel } = await import('../utils/model/model.js');
    // 支持 --model 参数指定模型
    const modelIdx = args.indexOf('--model');
    const model = (modelIdx !== -1 && args[modelIdx + 1]) || getMainLoopModel();
    const { getSystemPrompt } = await import('../constants/prompts.js');
    const prompt = await getSystemPrompt([], model);
    console.log(prompt.join('\n'));
    return;
  }

  // ─── 快速路径 3：--claude-in-chrome-mcp，Chrome MCP 服务器 ───
  if (process.argv[2] === '--claude-in-chrome-mcp') {
    profileCheckpoint('cli_claude_in_chrome_mcp_path');
    const { runClaudeInChromeMcpServer } = await import(
      '../utils/claudeInChrome/mcpServer.js'
    );
    await runClaudeInChromeMcpServer();
    return;
  }
  // Chrome native messaging host
  else if (process.argv[2] === '--chrome-native-host') {
    profileCheckpoint('cli_chrome_native_host_path');
    const { runChromeNativeHost } = await import(
      '../utils/claudeInChrome/chromeNativeHost.js'
    );
    await runChromeNativeHost();
    return;
  }
  // Computer Use MCP 服务器（实验性功能）
  else if (feature('CHICAGO_MCP') && process.argv[2] === '--computer-use-mcp') {
    profileCheckpoint('cli_computer_use_mcp_path');
    const { runComputerUseMcpServer } = await import(
      '../utils/computerUse/mcpServer.js'
    );
    await runComputerUseMcpServer();
    return;
  }

  // ─── 快速路径 4：--daemon-worker=<kind>，守护进程工作路径 ───
  // 由 supervisor 按 worker 种类 spawn，每个 worker 是独立的
  // 不加载 enableConfigs() 和 analytics sinks——worker 是精简的
  // 如果 worker 需要配置/认证，在它自己的 run() 函数内部加载
  if (feature('DAEMON') && args[0] === '--daemon-worker') {
    const { runDaemonWorker } = await import('../daemon/workerRegistry.js');
    await runDaemonWorker(args[1]);
    return;
  }

  // ─── 快速路径 5：bridge/remote-control 远程控制路径 ───
  // 支持多种别名：remote-control / rc / remote / sync / bridge
  // feature() 必须内联以便构建时 DCE；isBridgeEnabled() 检查运行时 GrowthBook 门控
  if (
    feature('BRIDGE_MODE') &&
    (args[0] === 'remote-control' || args[0] === 'rc' ||
     args[0] === 'remote' || args[0] === 'sync' || args[0] === 'bridge')
  ) {
    profileCheckpoint('cli_bridge_path');
    const { enableConfigs } = await import('../utils/config.js');
    enableConfigs();

    // 多层安全检查：认证 → GrowthBook 门控 → 最低版本 → 策略限制
    const { getBridgeDisabledReason, checkBridgeMinVersion } = await import(
      '../bridge/bridgeEnabled.js'
    );
    const { BRIDGE_LOGIN_ERROR } = await import('../bridge/types.js');
    const { bridgeMain } = await import('../bridge/bridgeMain.js');
    const { exitWithError } = await import('../utils/process.js');

    // 认证检查必须在 GrowthBook 门控之前——没有认证，
    // GrowthBook 没有用户上下文，会返回过时的默认 false
    const { getClaudeAIOAuthTokens } = await import('../utils/auth.js');
    if (!getClaudeAIOAuthTokens()?.accessToken) {
      exitWithError(BRIDGE_LOGIN_ERROR);
    }
    const disabledReason = await getBridgeDisabledReason();
    if (disabledReason) {
      exitWithError(`Error: ${disabledReason}`);
    }
    const versionError = checkBridgeMinVersion();
    if (versionError) {
      exitWithError(versionError);
    }

    // Bridge 是远程控制功能——检查组织策略限制
    const { waitForPolicyLimitsToLoad, isPolicyAllowed } = await import(
      '../services/policyLimits/index.js'
    );
    await waitForPolicyLimitsToLoad();
    if (!isPolicyAllowed('allow_remote_control')) {
      exitWithError(
        "Error: Remote Control is disabled by your organization's policy.",
      );
    }

    await bridgeMain(args.slice(1));
    return;
  }

  // ─── 快速路径 6：daemon 子命令，长期运行的 supervisor ───
  if (feature('DAEMON') && args[0] === 'daemon') {
    profileCheckpoint('cli_daemon_path');
    const { enableConfigs } = await import('../utils/config.js');
    enableConfigs();
    const { initSinks } = await import('../utils/sinks.js');
    initSinks();
    const { daemonMain } = await import('../daemon/main.js');
    await daemonMain(args.slice(1));
    return;
  }

  // ─── 快速路径 7：ps|logs|attach|kill 和 --bg/--background ───
  // 会话管理，操作 ~/.claude/sessions/ 注册表
  if (
    feature('BG_SESSIONS') &&
    (args[0] === 'ps' || args[0] === 'logs' ||
     args[0] === 'attach' || args[0] === 'kill' ||
     args.includes('--bg') || args.includes('--background'))
  ) {
    profileCheckpoint('cli_bg_path');
    const { enableConfigs } = await import('../utils/config.js');
    enableConfigs();
    const bg = await import('../cli/bg.js');
    switch (args[0]) {
      case 'ps':    await bg.psHandler(args.slice(1)); break;
      case 'logs':  await bg.logsHandler(args[1]); break;
      case 'attach': await bg.attachHandler(args[1]); break;
      case 'kill':  await bg.killHandler(args[1]); break;
      default:      await bg.handleBgFlag(args);
    }
    return;
  }

  // ─── 快速路径 8：template job 命令（new/list/reply）───
  if (feature('TEMPLATES') && (args[0] === 'new' || args[0] === 'list' || args[0] === 'reply')) {
    profileCheckpoint('cli_templates_path');
    const { templatesMain } = await import('../cli/handlers/templateJobs.js');
    await templatesMain(args);
    process.exit(0);  // 使用 process.exit 而非 return，Ink TUI 可能残留事件循环句柄
  }

  // ─── 快速路径 9：environment-runner，BYOC 无头运行器 ───
  if (feature('BYOC_ENVIRONMENT_RUNNER') && args[0] === 'environment-runner') {
    profileCheckpoint('cli_environment_runner_path');
    const { environmentRunnerMain } = await import('../environment-runner/main.js');
    await environmentRunnerMain(args.slice(1));
    return;
  }

  // ─── 快速路径 10：self-hosted-runner，自托管运行器 ───
  if (feature('SELF_HOSTED_RUNNER') && args[0] === 'self-hosted-runner') {
    profileCheckpoint('cli_self_hosted_runner_path');
    const { selfHostedRunnerMain } = await import('../self-hosted-runner/main.js');
    await selfHostedRunnerMain(args.slice(1));
    return;
  }

  // ─── 快速路径 11：--worktree --tmux，在加载完整 CLI 前 exec 进 tmux ───
  const hasTmuxFlag = args.includes('--tmux') || args.includes('--tmux=classic');
  if (
    hasTmuxFlag &&
    (args.includes('-w') || args.includes('--worktree') ||
     args.some(a => a.startsWith('--worktree=')))
  ) {
    profileCheckpoint('cli_tmux_worktree_fast_path');
    const { enableConfigs } = await import('../utils/config.js');
    enableConfigs();
    const { isWorktreeModeEnabled } = await import('../utils/worktreeModeEnabled.js');
    if (isWorktreeModeEnabled()) {
      const { execIntoTmuxWorktree } = await import('../utils/worktree.js');
      const result = await execIntoTmuxWorktree(args);
      if (result.handled) {
        return;
      }
      if (result.error) {
        const { exitWithError } = await import('../utils/process.js');
        exitWithError(result.error);
      }
    }
  }

  // ─── 重定向常见更新标志错误到 update 子命令 ───
  if (args.length === 1 && (args[0] === '--update' || args[0] === '--upgrade')) {
    process.argv = [process.argv[0]!, process.argv[1]!, 'update'];
  }

  // ─── --bare：提前设置 SIMPLE 模式 ───
  // 必须在模块求值和 Commander 选项构建之前设置，否则门控不会生效
  if (args.includes('--bare')) {
    process.env.CLAUDE_CODE_SIMPLE = '1';
  }

  // ─── 默认路径：启动交互式 CLI ───
  // 提前捕获用户输入——在加载 main.tsx 的 ~100ms 期间，用户可能已经开始输入
  const { startCapturingEarlyInput } = await import('../utils/earlyInput.js');
  startCapturingEarlyInput();
  profileCheckpoint('cli_before_main_import');
  const { main: cliMain } = await import('../main.js');
  profileCheckpoint('cli_after_main_import');
  await cliMain();
  profileCheckpoint('cli_after_main_complete');
}

void main();
```

**关键设计**：
1. **零导入快速路径**：`--version` 完全不加载任何模块，直接读取 `MACRO.VERSION`
2. **动态导入**：所有非默认路径都用 `await import()` 延迟加载，避免 ~800KB 的 main.tsx 模块求值
3. **feature() 门控**：`feature('DAEMON')`、`feature('BRIDGE_MODE')` 等标志在构建时做死代码消除（DCE），外部构建中不存在的功能完全被移除
4. **认证优先于门控**：bridge 路径中，认证检查在 GrowthBook 门控之前——因为 GrowthBook 需要用户上下文才能返回正确的门控值

---

## 步骤 ②：初始化

### init.ts — 一次性初始化序列

`src/entrypoints/init.ts` 的 `init()` 函数用 `memoize` 包装，确保整个进程只执行一次。它按严格顺序执行 7 个阶段：

```typescript
// src/entrypoints/init.ts — init() 完整源码

import memoize from 'lodash-es/memoize.js'
// ... (约 50 个导入省略)

export const init = memoize(async (): Promise<void> => {
  const initStartTime = Date.now()
  logForDiagnosticsNoPII('info', 'init_started')
  profileCheckpoint('init_function_start')

  try {
    // ═══════════════════════════════════════════════════
    // Phase 1: 配置与环境（必须在任何网络操作之前）
    // ═══════════════════════════════════════════════════

    // 1a. 加载配置系统——读取 settings.json、环境变量等
    const configsStart = Date.now()
    enableConfigs()
    logForDiagnosticsNoPII('info', 'init_configs_enabled', {
      duration_ms: Date.now() - configsStart,
    })
    profileCheckpoint('init_configs_enabled')

    // 1b. 应用安全环境变量——仅在信任对话框之前应用安全的子集
    // 完整的环境变量在信任建立之后才应用
    const envVarsStart = Date.now()
    applySafeConfigEnvironmentVariables()

    // 1c. 应用 TLS 证书——必须在任何 TLS 握手之前！
    // Bun 通过 BoringSSL 在启动时缓存 TLS 证书，错过窗口就无效了
    applyExtraCACertsFromConfig()

    logForDiagnosticsNoPII('info', 'init_safe_env_vars_applied', {
      duration_ms: Date.now() - envVarsStart,
    })
    profileCheckpoint('init_safe_env_vars_applied')

    // ═══════════════════════════════════════════════════
    // Phase 2: 关闭与遥测
    // ═══════════════════════════════════════════════════

    // 2a. 注册优雅关闭处理器——确保退出时刷新缓冲区
    setupGracefulShutdown()
    profileCheckpoint('init_after_graceful_shutdown')

    // 2b. 初始化一方事件日志（动态导入以延迟加载 OpenTelemetry sdk-logs）
    // growthbook.js 已经在模块缓存中，第二次动态导入无额外成本
    void Promise.all([
      import('../services/analytics/firstPartyEventLogger.js'),
      import('../services/analytics/growthbook.js'),
    ]).then(([fp, gb]) => {
      fp.initialize1PEventLogging()
      // 监听 GrowthBook 刷新——配置变化时重新初始化 logger
      gb.onGrowthBookRefresh(() => {
        void fp.reinitialize1PEventLoggingIfConfigChanged()
      })
    })
    profileCheckpoint('init_after_1p_event_logging')

    // ═══════════════════════════════════════════════════
    // Phase 3: OAuth 与 IDE
    // ═══════════════════════════════════════════════════

    // 3a. 填充 OAuth 账户信息（VSCode 扩展登录时可能未缓存）
    void populateOAuthAccountInfoIfNeeded()
    profileCheckpoint('init_after_oauth_populate')

    // 3b. 异步检测 JetBrains IDE（填充缓存供后续同步访问）
    void initJetBrainsDetection()
    profileCheckpoint('init_after_jetbrains_detection')

    // 3c. 异步检测 Git 仓库（填充缓存供 gitDiff PR 链接使用）
    void detectCurrentRepository()

    // ═══════════════════════════════════════════════════
    // Phase 4: 远程设置
    // ═══════════════════════════════════════════════════

    // 4a. 初始化远程托管设置加载 Promise（含超时防死锁）
    // 其他系统（如 plugin hooks）可以 await 这个 Promise
    if (isEligibleForRemoteManagedSettings()) {
      initializeRemoteManagedSettingsLoadingPromise()
    }
    // 4b. 初始化策略限制加载 Promise
    if (isPolicyLimitsEligible()) {
      initializePolicyLimitsLoadingPromise()
    }
    profileCheckpoint('init_after_remote_settings_check')

    // 4c. 记录首次启动时间
    recordFirstStartTime()

    // ═══════════════════════════════════════════════════
    // Phase 5: 网络配置
    // ═══════════════════════════════════════════════════

    // 5a. 配置全局 mTLS 设置
    const mtlsStart = Date.now()
    configureGlobalMTLS()
    logForDiagnosticsNoPII('info', 'init_mtls_configured', {
      duration_ms: Date.now() - mtlsStart,
    })

    // 5b. 配置全局 HTTP 代理（proxy 和/或 mTLS agents）
    const proxyStart = Date.now()
    configureGlobalAgents()
    logForDiagnosticsNoPII('info', 'init_proxy_configured', {
      duration_ms: Date.now() - proxyStart,
    })
    profileCheckpoint('init_network_configured')

    // 5c. 预热 Anthropic API 连接——TCP+TLS 握手与后续工作并行
    // 节省 ~100-200ms。在 CA 证书和代理配置之后执行，确保使用正确的传输
    // 对 proxy/mTLS/unix/cloud-provider 跳过（SDK 的 dispatcher 不复用全局池）
    preconnectAnthropicApi()

    // ═══════════════════════════════════════════════════
    // Phase 6: 上游代理（仅 CCR 环境）
    // ═══════════════════════════════════════════════════

    // 启动本地 CONNECT relay，让 agent 子进程可以访问组织配置的上游代理
    // 门控条件：CLAUDE_CODE_REMOTE + GrowthBook；错误时 fail-open
    // 懒导入：非 CCR 启动不加载 upstreamproxy 模块
    if (isEnvTruthy(process.env.CLAUDE_CODE_REMOTE)) {
      try {
        const { initUpstreamProxy, getUpstreamProxyEnv } = await import(
          '../upstreamproxy/upstreamproxy.js'
        )
        const { registerUpstreamProxyEnvFn } = await import(
          '../utils/subprocessEnv.js'
        )
        // 注册代理环境变量函数，子进程 spawn 时自动注入
        registerUpstreamProxyEnvFn(getUpstreamProxyEnv)
        await initUpstreamProxy()
      } catch (err) {
        logForDebugging(
          `[init] upstreamproxy init failed: ${err instanceof Error ? err.message : String(err)}; continuing without proxy`,
          { level: 'warn' },
        )
      }
    }

    // ═══════════════════════════════════════════════════
    // Phase 7: 杂项
    // ═══════════════════════════════════════════════════

    // 7a. Windows Shell 设置
    setShellIfWindows()

    // 7b. 注册 LSP 服务器管理器清理（LSP 初始化在 main.tsx 中 --plugin-dir 处理后）
    registerCleanup(shutdownLspServerManager)

    // 7c. 注册团队清理——子 agent 创建的团队如果未被显式删除，
    // 会永久残留在磁盘上。懒导入：swarm 代码在 feature gate 后
    registerCleanup(async () => {
      const { cleanupSessionTeams } = await import(
        '../utils/swarm/teamHelpers.js'
      )
      await cleanupSessionTeams()
    })

    // 7d. 初始化暂存目录（如果启用）
    if (isScratchpadEnabled()) {
      const scratchpadStart = Date.now()
      await ensureScratchpadDir()
      logForDiagnosticsNoPII('info', 'init_scratchpad_created', {
        duration_ms: Date.now() - scratchpadStart,
      })
    }

    logForDiagnosticsNoPII('info', 'init_completed', {
      duration_ms: Date.now() - initStartTime,
    })
    profileCheckpoint('init_function_end')
  } catch (error) {
    if (error instanceof ConfigParseError) {
      // 非交互会话跳过 Ink 对话框（JSON 消费者会崩溃）
      if (getIsNonInteractiveSession()) {
        process.stderr.write(
          `Configuration error in ${error.filePath}: ${error.message}\n`,
        )
        gracefulShutdownSync(1)
        return
      }
      // 显示无效配置对话框
      return import('../components/InvalidConfigDialog.js').then(m =>
        m.showInvalidConfigDialog({ error }),
      )
    } else {
      throw error
    }
  }
})
```

```
┌─────────────────────────────────────────────────────────┐
│  init() 初始化序列（memoized，仅执行一次）                 │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Phase 1: 配置与环境                                    │
│  ├── enableConfigs()           加载配置系统              │
│  ├── applySafeConfigEnvVars()  应用安全环境变量           │
│  └── applyExtraCACerts()       设置 TLS 证书             │
│       ↓ （必须在任何 TLS 握手之前）                       │
│  Phase 2: 关闭与遥测                                    │
│  ├── setupGracefulShutdown()   注册清理处理器             │
│  └── initialize1PEventLogging() 初始化一方事件日志        │
│       ↓                                                 │
│  Phase 3: OAuth 与 IDE                                  │
│  ├── populateOAuthInfo()       填充 OAuth 信息           │
│  ├── initJetBrainsDetection()  检测 JetBrains IDE        │
│  └── detectCurrentRepository() 检测 Git 仓库             │
│       ↓                                                 │
│  Phase 4: 远程设置                                      │
│  ├── initRemoteManagedSettings() 加载远程托管设置         │
│  └── initPolicyLimits()        加载策略限制              │
│       ↓                                                 │
│  Phase 5: 网络                                          │
│  ├── configureGlobalMTLS()     mTLS 设置                │
│  ├── configureGlobalAgents()   HTTP 代理 + mTLS agents  │
│  └── preconnectAnthropicApi()  预热 TCP+TLS 握手         │
│       ↓ （~100-200ms，与其他工作并行）                    │
│  Phase 6: 上游代理（仅 CCR 环境）                        │
│  └── initUpstreamProxy()       配置上游代理              │
│       ↓                                                 │
│  Phase 7: 杂项                                          │
│  ├── setShellIfWindows()       Windows Shell 设置        │
│  ├── registerCleanup(LSP)      注册 LSP 清理             │
│  ├── registerCleanup(Teams)    注册 Team 清理            │
│  └── ensureScratchpadDir()     创建暂存目录              │
└─────────────────────────────────────────────────────────┘
```

**关键设计**：
- `applyExtraCACerts()` 必须在 TLS 握手之前调用，因为 Bun 通过 BoringSSL 在启动时缓存 TLS 证书
- `preconnectAnthropicApi()` 提前做 TCP+TLS 握手，与后续工作并行，节省 ~100-200ms
- Phase 3 的三个操作都使用 `void`（fire-and-forget），不阻塞后续阶段
- `initializeTelemetryAfterTrust()` 在信任对话框之后才调用，因为遥测初始化需要等远程设置加载完成

---

## 步骤 ③：CLI 解析与 REPL 启动

### main.tsx — Commander 参数 + 迁移 + 延迟预取

`src/main.tsx` 是一个巨大的文件（~800KB），`main()` 函数做了大量初始化工作：

```typescript
// src/main.tsx — 关键结构逐行解析

// ① 模块级副作用：必须在所有其他导入之前运行
// - profileCheckpoint 标记入口点
// - startMdmRawRead 触发 MDM 子进程（与后续 ~135ms 的导入并行）
// - startKeychainPrefetch 触发 macOS 钥匙串读取（否则同步读取需 ~65ms）
import { profileCheckpoint, profileReport } from './utils/startupProfiler.js';
profileCheckpoint('main_tsx_entry');
import { startMdmRawRead } from './utils/settings/mdm/rawRead.js';
startMdmRawRead();
import { ensureKeychainPrefetchCompleted, startKeychainPrefetch } from './utils/secureStorage/keychainPrefetch.js';
startKeychainPrefetch();

// ② 调试检测——如果在调试/检查模式下运行，直接退出
// 这是安全措施：防止通过调试器检查 Claude Code 的内部状态
function isBeingDebugged() {
  const isBun = isRunningWithBun();
  const hasInspectArg = process.execArgv.some(arg => {
    if (isBun) {
      return /--inspect(-brk)?/.test(arg);
    } else {
      return /--inspect(-brk)?|--debug(-brk)?/.test(arg);
    }
  });
  const hasInspectEnv = process.env.NODE_OPTIONS &&
    /--inspect(-brk)?|--debug(-brk)?/.test(process.env.NODE_OPTIONS);
  try {
    const inspector = (global as any).require('inspector');
    const hasInspectorUrl = !!inspector.url();
    return hasInspectorUrl || hasInspectArg || hasInspectEnv;
  } catch {
    return hasInspectArg || hasInspectEnv;
  }
}
if ("external" !== 'ant' && isBeingDebugged()) {
  process.exit(1);  // 外部构建 + 调试模式 → 直接退出
}

// ③ 数据迁移——当前版本 11
const CURRENT_MIGRATION_VERSION = 11;
function runMigrations(): void {
  if (getGlobalConfig().migrationVersion !== CURRENT_MIGRATION_VERSION) {
    migrateAutoUpdatesToSettings();
    migrateBypassPermissionsAcceptedToSettings();
    migrateEnableAllProjectMcpServersToSettings();
    resetProToOpusDefault();
    migrateSonnet1mToSonnet45();
    migrateLegacyOpusToCurrent();
    migrateSonnet45ToSonnet46();
    migrateOpusToOpus1m();
    migrateReplBridgeEnabledToRemoteControlAtStartup();
    if (feature('TRANSCRIPT_CLASSIFIER')) {
      resetAutoModeOptInForDefaultOffer();
    }
    // 仅 Ant 内部的迁移
    if ("external" === 'ant') {
      migrateFennecToOpus();
    }
    saveGlobalConfig(prev => prev.migrationVersion === CURRENT_MIGRATION_VERSION ? prev : {
      ...prev,
      migrationVersion: CURRENT_MIGRATION_VERSION
    });
  }
  // 异步迁移——非阻塞
  migrateChangelogFromConfig().catch(() => {});
}

// ④ 安全预取：只在信任对话框之后才预取系统上下文
// Git 命令可以通过 hooks 和 config 执行任意代码，必须先确认信任
function prefetchSystemContextIfSafe(): void {
  const isNonInteractiveSession = getIsNonInteractiveSession();
  if (isNonInteractiveSession) {
    // 非交互模式跳过信任对话框，直接预取
    void getSystemContext();
    return;
  }
  const hasTrust = checkHasTrustDialogAccepted();
  if (hasTrust) {
    void getSystemContext();
  }
  // 否则不预取——等待信任建立
}

// ⑤ 延迟预取——首次渲染后才执行
export function startDeferredPrefetches(): void {
  // --bare 模式跳过所有预取——脚本化调用没有"用户正在输入"的窗口
  if (isEnvTruthy(process.env.CLAUDE_CODE_EXIT_AFTER_FIRST_RENDER) || isBareMode()) {
    return;
  }

  // 进程级预取（用户还在打字时缓存预热）
  void initUser();
  void getUserContext();
  prefetchSystemContextIfSafe();
  void getRelevantTips();
  // 云提供商凭证预取
  if (isEnvTruthy(process.env.CLAUDE_CODE_USE_BEDROCK) && !isEnvTruthy(process.env.CLAUDE_CODE_SKIP_BEDROCK_AUTH)) {
    void prefetchAwsCredentialsAndBedRockInfoIfSafe();
  }
  if (isEnvTruthy(process.env.CLAUDE_CODE_USE_VERTEX) && !isEnvTruthy(process.env.CLAUDE_CODE_SKIP_VERTEX_AUTH)) {
    void prefetchGcpCredentialsIfSafe();
  }
  void countFilesRoundedRg(getCwd(), AbortSignal.timeout(3000), []);

  // 分析和功能标志初始化
  void initializeAnalyticsGates();
  void prefetchOfficialMcpUrls();
  void refreshModelCapabilities();

  // 文件变更检测器
  void settingsChangeDetector.initialize();
  if (!isBareMode()) {
    void skillChangeDetector.initialize();
  }
}
```

### replLauncher.tsx — 渲染 REPL 组件树

```typescript
// src/replLauncher.tsx — 完整源码

import React from 'react';
import type { StatsStore } from './context/stats.js';
import type { Root } from './ink.js';
import type { Props as REPLProps } from './screens/REPL.js';
import type { AppState } from './state/AppStateStore.js';
import type { FpsMetrics } from './utils/fpsTracker.js';

// App 包装器属性：FPS 监控、统计、初始状态
type AppWrapperProps = {
  getFpsMetrics: () => FpsMetrics | undefined;
  stats?: StatsStore;
  initialState: AppState;
};

export async function launchRepl(
  root: Root,
  appProps: AppWrapperProps,
  replProps: REPLProps,
  renderAndRun: (root: Root, element: React.ReactNode) => Promise<void>,
): Promise<void> {
  // 动态导入 App 和 REPL 组件——避免在启动路径上加载 React 组件
  const { App } = await import('./components/App.js');
  const { REPL } = await import('./screens/REPL.js');
  // 渲染 React 组件树：<App> 提供全局状态，<REPL> 是主交互界面
  await renderAndRun(
    root,
    <App {...appProps}>
      <REPL {...replProps} />
    </App>,
  )
}
```

REPL 是一个 Ink React 应用——`<App>` 提供全局状态（FpsMetrics、StatsStore、AppState），`<REPL>` 是主交互界面。动态导入确保 React 组件只在需要时加载。

---

## 步骤 ④：加载记忆

当用户输入第一条消息时，Agent 循环启动前需要先加载记忆。

### context.ts — 双上下文获取

```typescript
// src/context.ts — 完整源码

import { feature } from 'bun:bundle'
import memoize from 'lodash-es/memoize.js'
import {
  getAdditionalDirectoriesForClaudeMd,
  setCachedClaudeMdContent,
} from './bootstrap/state.js'
import { getLocalISODate } from './constants/common.js'
import {
  filterInjectedMemoryFiles,
  getClaudeMds,
  getMemoryFiles,
} from './utils/claudemd.js'
import { logForDiagnosticsNoPII } from './utils/diagLogs.js'
import { isBareMode, isEnvTruthy } from './utils/envUtils.js'
import { execFileNoThrow } from './utils/execFileNoThrow.js'
import { getBranch, getDefaultBranch, getIsGit, gitExe } from './utils/git.js'
import { shouldIncludeGitInstructions } from './utils/gitSettings.js'
import { logError } from './utils/log.js'

const MAX_STATUS_CHARS = 2000  // Git status 输出最大字符数

// 系统提示词注入——仅限 Ant 内部，用于缓存破坏调试
let systemPromptInjection: string | null = null

export function getSystemPromptInjection(): string | null {
  return systemPromptInjection
}

export function setSystemPromptInjection(value: string | null): void {
  systemPromptInjection = value
  // 注入变化时立即清除上下文缓存
  getUserContext.cache.clear?.()
  getSystemContext.cache.clear?.()
}

// ① getGitStatus — 获取 Git 状态（5 个并行命令）
export const getGitStatus = memoize(async (): Promise<string | null> => {
  if (process.env.NODE_ENV === 'test') return null  // 测试环境避免循环

  const isGit = await getIsGit()
  if (!isGit) return null  // 非 Git 仓库直接返回

  try {
    // 并行执行 5 个 git 命令，最大化性能
    const [branch, mainBranch, status, log, userName] = await Promise.all([
      getBranch(),
      getDefaultBranch(),
      execFileNoThrow(gitExe(), ['--no-optional-locks', 'status', '--short'], {
        preserveOutputOnError: false,
      }).then(({ stdout }) => stdout.trim()),
      execFileNoThrow(
        gitExe(),
        ['--no-optional-locks', 'log', '--oneline', '-n', '5'],
        { preserveOutputOnError: false },
      ).then(({ stdout }) => stdout.trim()),
      execFileNoThrow(gitExe(), ['config', 'user.name'], {
        preserveOutputOnError: false,
      }).then(({ stdout }) => stdout.trim()),
    ])

    // 截断过长的 status 输出
    const truncatedStatus =
      status.length > MAX_STATUS_CHARS
        ? status.substring(0, MAX_STATUS_CHARS) +
          '\n... (truncated because it exceeds 2k characters. If you need more information, run "git status" using BashTool)'
        : status

    return [
      `This is the git status at the start of the conversation. Note that this status is a snapshot in time, and will not update during the conversation.`,
      `Current branch: ${branch}`,
      `Main branch (you will usually use this for PRs): ${mainBranch}`,
      ...(userName ? [`Git user: ${userName}`] : []),
      `Status:\n${truncatedStatus || '(clean)'}`,
      `Recent commits:\n${log}`,
    ].join('\n\n')
  } catch (error) {
    logError(error)
    return null
  }
})

// ② getSystemContext — 系统上下文（Git 状态 + 缓存破坏器）
export const getSystemContext = memoize(
  async (): Promise<{ [k: string]: string }> => {
    // CCR 环境或禁用 git 指令时跳过 git status
    const gitStatus =
      isEnvTruthy(process.env.CLAUDE_CODE_REMOTE) ||
      !shouldIncludeGitInstructions()
        ? null
        : await getGitStatus()

    // 缓存破坏器——仅 Ant 内部
    const injection = feature('BREAK_CACHE_COMMAND')
      ? getSystemPromptInjection()
      : null

    return {
      ...(gitStatus && { gitStatus }),
      ...(feature('BREAK_CACHE_COMMAND') && injection
        ? { cacheBreaker: `[CACHE_BREAKER: ${injection}]` }
        : {}),
    }
  },
)

// ③ getUserContext — 用户上下文（CLAUDE.md 内容 + 当前日期）
export const getUserContext = memoize(
  async (): Promise<{ [k: string]: string }> => {
    // CLAUDE_CODE_DISABLE_CLAUDE_MDS：硬关闭
    // --bare：跳过自动发现（cwd 遍历），但尊重显式 --add-dir
    const shouldDisableClaudeMd =
      isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_CLAUDE_MDS) ||
      (isBareMode() && getAdditionalDirectoriesForClaudeMd().length === 0)

    // 异步 I/O：读取文件/遍历目录
    const claudeMd = shouldDisableClaudeMd
      ? null
      : getClaudeMds(filterInjectedMemoryFiles(await getMemoryFiles()))

    // 缓存 CLAUDE.md 内容给 auto-mode 分类器使用
    // （避免 claudemd.ts → permissions → yoloClassifier 的循环依赖）
    setCachedClaudeMdContent(claudeMd || null)

    return {
      ...(claudeMd && { claudeMd }),
      currentDate: `Today's date is ${getLocalISODate()}.`,
    }
  },
)
```

**关键设计**：
- `getGitStatus` 使用 `--no-optional-locks` 避免与其他 git 进程冲突
- 5 个 git 命令并行执行，通过 `Promise.all` 等待
- status 输出截断到 2000 字符，避免过长的上下文
- `getSystemContext` 和 `getUserContext` 都用 `memoize` 缓存，直到 `/clear` 或 `/compact` 清除

### claudemd.ts — CLAUDE.md 加载

```typescript
// src/utils/claudemd.ts — getClaudeMds 和 getMemoryFiles 核心逻辑

// ① getMemoryFiles — 按优先级发现所有 CLAUDE.md 文件
// 加载顺序（从低到高优先级）：
// 1. managed memory (/etc/claude-code/CLAUDE.md) — 全局托管
// 2. user memory (~/.claude/CLAUDE.md) — 用户私有
// 3. project memory (CLAUDE.md, .claude/CLAUDE.md, .claude/rules/*.md) — 项目级
// 4. local memory (CLAUDE.local.md) — 本地私有
// 5. auto memory entrypoint (MEMORY.md) — 自动记忆
// 6. team memory entrypoint — 团队记忆
//
// 文件从根目录到 cwd 遍历发现，然后 reverse——靠近 cwd 的文件加载较晚（优先级更高）
// isClaudeMdExcludes 设置支持排除路径
// processMemoryFile 递归处理 @include 指令（MAX_INCLUDE_DEPTH = 5，循环检测）

// ② getClaudeMds — 将 MemoryFileInfo[] 格式化为单个提示词字符串
export const getClaudeMds = (
  memoryFiles: MemoryFileInfo[],
  filter?: (type: MemoryType) => boolean,
): string => {
  const memories: string[] = []
  // GrowthBook 实验：跳过项目级 CLAUDE.md
  const skipProjectLevel = getFeatureValue_CACHED_MAY_BE_STALE(
    'tengu_paper_halyard',
    false,
  )

  for (const file of memoryFiles) {
    if (filter && !filter(file.type)) continue
    if (skipProjectLevel && (file.type === 'Project' || file.type === 'Local'))
      continue
    if (file.content) {
      // 根据类型生成不同的描述文本
      const description =
        file.type === 'Project'
          ? ' (project instructions, checked into the codebase)'
          : file.type === 'Local'
            ? " (user's private project instructions, not checked in)"
            : feature('TEAMMEM') && file.type === 'TeamMem'
              ? ' (shared team memory, synced across the organization)'
              : file.type === 'AutoMem'
                ? " (user's auto-memory, persists across conversations)"
                : " (user's private global instructions for all projects)"

      const content = file.content.trim()
      // 团队记忆使用 XML 标签包装
      if (feature('TEAMMEM') && file.type === 'TeamMem') {
        memories.push(
          `Contents of ${file.path}${description}:\n\n<team-memory-content source="shared">\n${content}\n</team-memory-content>`,
        )
      } else {
        memories.push(`Contents of ${file.path}${description}:\n\n${content}`)
      }
    }
  }

  if (memories.length === 0) return ''

  // 拼接记忆指令提示词和所有记忆文件内容
  return `${MEMORY_INSTRUCTION_PROMPT}\n\n${memories.join('\n\n')}`
}
```

### memdir.ts — 记忆目录加载

```typescript
// src/memdir/memdir.ts — loadMemoryPrompt 完整逻辑

export async function loadMemoryPrompt(): Promise<string | null> {
  const autoEnabled = isAutoMemoryEnabled()
  const skipIndex = getFeatureValue_CACHED_MAY_BE_STALE('tengu_moth_copse', false)

  // ① KAIROS 日志模式优先——主动式助手的每日日志
  if (feature('KAIROS') && autoEnabled && getKairosActive()) {
    logMemoryDirCounts(getAutoMemPath(), { memory_type: 'auto' })
    return buildAssistantDailyLogPrompt(skipIndex)
  }

  // ② Cowork 额外指南注入
  const coworkExtraGuidelines =
    process.env.CLAUDE_COWORK_MEMORY_EXTRA_GUIDELINES
  const extraGuidelines =
    coworkExtraGuidelines && coworkExtraGuidelines.trim().length > 0
      ? [coworkExtraGuidelines]
      : undefined

  // ③ Auto + Team：组合提示词（双目录）
  if (feature('TEAMMEM')) {
    if (teamMemPaths!.isTeamMemoryEnabled()) {
      const autoDir = getAutoMemPath()
      const teamDir = teamMemPaths!.getTeamMemPath()
      await ensureMemoryDirExists(teamDir)  // 确保目录存在，模型无需 mkdir
      return teamMemPrompts!.buildCombinedMemoryPrompt(extraGuidelines, skipIndex)
    }
  }

  // ④ 仅 Auto：单目录记忆行
  if (autoEnabled) {
    const autoDir = getAutoMemPath()
    await ensureMemoryDirExists(autoDir)
    return buildMemoryLines('auto memory', autoDir, extraGuidelines, skipIndex).join('\n')
  }

  // ⑤ 禁用：记录遥测，返回 null
  logEvent('tengu_memdir_disabled', { ... })
  return null
}
```

**调度顺序**：KAIROS 日志模式 > Auto+Team 组合 > 仅 Auto > 禁用（null）。`ensureMemoryDirExists` 在每个活跃分支中都被调用，确保模型可以直接写入而无需 `mkdir`。此函数由 `getSystemPrompt` 通过 `systemPromptSection('memory', () => loadMemoryPrompt())` 注册，所以每个会话只计算一次。

---

## 步骤 ⑤：拼接 Prompt

### queryContext.ts — 系统提示词最终组装

```typescript
// src/utils/queryContext.ts — fetchSystemPromptParts 完整源码

export async function fetchSystemPromptParts({
  tools,
  mainLoopModel,
  additionalWorkingDirectories,
  mcpClients,
  customSystemPrompt,
}: {
  tools: Tools
  mainLoopModel: string
  additionalWorkingDirectories: string[]
  mcpClients: MCPServerConnection[]
  customSystemPrompt: string | undefined
}): Promise<{
  defaultSystemPrompt: string[]
  userContext: { [k: string]: string }
  systemContext: { [k: string]: string }
}> {
  // 并行获取三个部分，但 customSystemPrompt 存在时跳过默认构建
  const [defaultSystemPrompt, userContext, systemContext] = await Promise.all([
    customSystemPrompt !== undefined
      ? Promise.resolve([])      // 自定义提示词：跳过默认构建，返回空数组
      : getSystemPrompt(
          tools,
          mainLoopModel,
          additionalWorkingDirectories,
          mcpClients,
        ),
    getUserContext(),   // CLAUDE.md + 日期
    customSystemPrompt !== undefined
      ? Promise.resolve({})      // 自定义提示词：跳过系统上下文
      : getSystemContext(),      // Git 状态 + 缓存破坏器
  ])
  return { defaultSystemPrompt, userContext, systemContext }
}
```

**关键设计**：当 `customSystemPrompt` 存在时，`getSystemPrompt` 和 `getSystemContext` 都被跳过——自定义提示词完全替换默认值。`getUserContext` 始终获取，因为它包含日期信息。

### prompts.ts — getSystemPrompt() 主构建函数

```typescript
// src/constants/prompts.ts — getSystemPrompt 核心逻辑

export async function getSystemPrompt(
  tools, model, additionalWorkingDirectories, mcpClients
): Promise<string[]> {
  // ═══════════════════════════════════════════════
  // 路径 1：简单模式（CLAUDE_CODE_SIMPLE=1）
  // ═══════════════════════════════════════════════
  if (isEnvTruthy(process.env.CLAUDE_CODE_SIMPLE)) {
    return ['You are Claude Code, Anthropic\'s official CLI for Claude.']
  }

  // ═══════════════════════════════════════════════
  // 路径 2：主动/自治模式（PROACTIVE / KAIROS 功能标志）
  // ═══════════════════════════════════════════════
  if (feature('PROACTIVE') || feature('KAIROS')) {
    if (isProactiveActive_SAFE_TO_CALL_ANYWHERE()) {
      return [
        getProactiveIntroSection(),
        await loadMemoryPrompt(),       // 记忆
        computeSimpleEnvInfo(model, additionalWorkingDirectories),  // 环境
        getMcpInstructionsSection(mcpClients),   // MCP 指令
        getScratchpadInstructions(),    // 暂存指令
        getProactiveSection(),          // 主动行为指令
      ].filter(s => s !== null)
    }
  }

  // ═══════════════════════════════════════════════
  // 路径 3：标准模式 — 完整分层提示词
  // ═══════════════════════════════════════════════

  // 动态段注册——通过 systemPromptSection / DANGEROUS_uncachedSystemPromptSection
  const dynamicSections = [
    systemPromptSection('session_guidance', () =>
      getSessionSpecificGuidanceSection(enabledTools, skillToolCommands),
    ),
    systemPromptSection('memory', () => loadMemoryPrompt()),
    systemPromptSection('ant_model_override', () =>
      getAntModelOverrideSection(),
    ),
    systemPromptSection('env_info_simple', () =>
      computeSimpleEnvInfo(model, additionalWorkingDirectories),
    ),
    systemPromptSection('language', () =>
      getLanguageSection(settings.language),
    ),
    systemPromptSection('output_style', () =>
      getOutputStyleSection(outputStyleConfig),
    ),
    // MCP 指令使用 DANGEROUS_uncachedSystemPromptSection
    // 因为 MCP 服务器可能在两次调用之间连接/断开
    DANGEROUS_uncachedSystemPromptSection(
      'mcp_instructions',
      () =>
        isMcpInstructionsDeltaEnabled()
          ? null
          : getMcpInstructionsSection(mcpClients),
      'MCP servers connect/disconnect between turns',
    ),
    systemPromptSection('scratchpad', () => getScratchpadInstructions()),
    systemPromptSection('frc', () => getFunctionResultClearingSection(model)),
    systemPromptSection('summarize_tool_results', () =>
      SUMMARIZE_TOOL_RESULTS_SECTION,
    ),
    // ... 更多功能门控段（numeric_length_anchors, token_budget, brief 等）
  ]

  // 并行解析所有段
  const resolvedDynamicSections =
    await resolveSystemPromptSections(dynamicSections)

  // 最终组装：静态前缀 → 缓存边界标记 → 动态段
  return [
    getSimpleIntroSection(outputStyleConfig),
    getSimpleSystemSection(),
    outputStyleConfig === null ||
    outputStyleConfig.keepCodingInstructions === true
      ? getSimpleDoingTasksSection()
      : null,
    getActionsSection(),
    getUsingYourToolsSection(enabledTools),
    getSimpleToneAndStyleSection(),
    getOutputEfficiencySection(),
    // ★ 缓存边界——永远不要移动或删除
    ...(shouldUseGlobalCacheScope() ? [SYSTEM_PROMPT_DYNAMIC_BOUNDARY] : []),
    // 动态段
    ...resolvedDynamicSections,
  ].filter(s => s !== null)
}
```

**`SYSTEM_PROMPT_DYNAMIC_BOUNDARY`** 将静态的、可全局缓存的段与动态的、会话特定的段分离开来。这是 Prompt Cache 的关键——静态段在会话间共享缓存，动态段每次重新计算。

### systemPromptSections.ts — Section 缓存机制

```typescript
// src/constants/systemPromptSections.ts — 完整源码

type SystemPromptSection = {
  name: string
  compute: ComputeFn
  cacheBreak: boolean   // 是否破坏 Prompt Cache
}

// 创建缓存段——直到 /clear 或 /compact 才重新计算
export function systemPromptSection(
  name: string,
  compute: ComputeFn,
): SystemPromptSection {
  return { name, compute, cacheBreak: false }  // 缓存，不破坏 Prompt Cache
}

// 创建动态段——每轮重新计算，会破坏 Prompt Cache
export function DANGEROUS_uncachedSystemPromptSection(
  name: string,
  compute: ComputeFn,
  _reason: string,   // 原因仅作文档用途，不影响逻辑
): SystemPromptSection {
  return { name, compute, cacheBreak: true }  // 动态，破坏缓存
}

// 并行解析所有段，带缓存逻辑
export async function resolveSystemPromptSections(
  sections: SystemPromptSection[],
): Promise<(string | null)[]> {
  const cache = getSystemPromptSectionCache()
  return Promise.all(
    sections.map(async s => {
      // 缓存段且有缓存值：直接返回缓存
      if (!s.cacheBreak && cache.has(s.name)) {
        return cache.get(s.name) ?? null
      }
      // 否则重新计算
      const value = await s.compute()
      setSystemPromptSectionCacheEntry(s.name, value)
      return value
    }),
  )
}

// 清除所有缓存——/clear 和 /compact 时调用
export function clearSystemPromptSections() { /* ... */ }
```

**缓存逻辑**：`systemPromptSection` 的条目计算一次后缓存，直到 `/clear` 或 `/compact` 调用 `clearSystemPromptSections()`。`DANGEROUS_uncachedSystemPromptSection` 的条目绕过缓存读取（`cacheBreak: true`），每次调用都重新计算——这会破坏 Prompt Cache，但对 MCP 指令等易变数据是必需的。

### systemPrompt.ts — 优先级覆盖链

```typescript
// src/utils/systemPrompt.ts — buildEffectiveSystemPrompt 完整源码

export function buildEffectiveSystemPrompt({
  mainThreadAgentDefinition,  // Agent 定义
  toolUseContext,              // 工具使用上下文
  customSystemPrompt,          // 自定义提示词
  defaultSystemPrompt,         // 默认提示词
  appendSystemPrompt,          // 追加提示词
  overrideSystemPrompt,        // 覆盖提示词
}): SystemPrompt {
  // 优先级 0：override 替换一切
  if (overrideSystemPrompt) {
    return asSystemPrompt([overrideSystemPrompt])
  }

  // 优先级 1：coordinator 模式
  // 只能使用 AgentTool + SendMessageTool + TaskStopTool
  if (
    feature('COORDINATOR_MODE') &&
    isEnvTruthy(process.env.CLAUDE_CODE_COORDINATOR_MODE) &&
    !mainThreadAgentDefinition
  ) {
    const { getCoordinatorSystemPrompt } =
      require('../coordinator/coordinatorMode.js')
    return asSystemPrompt([
      getCoordinatorSystemPrompt(),
      ...(appendSystemPrompt ? [appendSystemPrompt] : []),
    ])
  }

  // 获取 agent 定义的系统提示词
  const agentSystemPrompt = mainThreadAgentDefinition
    ? isBuiltInAgent(mainThreadAgentDefinition)
      ? mainThreadAgentDefinition.getSystemPrompt({
          toolUseContext: { options: toolUseContext.options },
        })
      : mainThreadAgentDefinition.getSystemPrompt()
    : undefined

  // 优先级 2（proactive）：agent 提示词追加到默认提示词之后
  if (
    agentSystemPrompt &&
    (feature('PROACTIVE') || feature('KAIROS')) &&
    isProactiveActive_SAFE_TO_CALL_ANYWHERE()
  ) {
    return asSystemPrompt([
      ...defaultSystemPrompt,
      `\n# Custom Agent Instructions\n${agentSystemPrompt}`,
      ...(appendSystemPrompt ? [appendSystemPrompt] : []),
    ])
  }

  // 优先级 3/4：agent 提示词 / 自定义提示词 / 默认提示词
  return asSystemPrompt([
    ...(agentSystemPrompt
      ? [agentSystemPrompt]
      : customSystemPrompt
        ? [customSystemPrompt]
        : defaultSystemPrompt),
    ...(appendSystemPrompt ? [appendSystemPrompt] : []),
  ])
}
```

**优先级链**：`overrideSystemPrompt` > `coordinatorSystemPrompt` > `proactive 模式 (default + agent)` > `agentSystemPrompt` / `customSystemPrompt` / `defaultSystemPrompt`。`appendSystemPrompt` 始终被追加（除非被 override 覆盖）。

---

## 步骤 ⑥：启动 Agent 循环

### QueryEngine.submitMessage() — SDK 入口

```typescript
// src/QueryEngine.ts — submitMessage 核心逻辑

export class QueryEngine {
  private config: QueryEngineConfig
  private mutableMessages: Message[]
  private abortController: AbortController
  private permissionDenials: SDKPermissionDenial[]
  private totalUsage: NonNullableUsage
  private discoveredSkillNames = new Set<string>()
  private loadedNestedMemoryPaths = new Set<string>()

  constructor(config: QueryEngineConfig) {
    this.config = config
    this.mutableMessages = config.initialMessages ?? []
    this.abortController = config.abortController ?? createAbortController()
    this.permissionDenials = []
    this.readFileState = config.readFileCache
    this.totalUsage = EMPTY_USAGE
  }

  async *submitMessage(
    prompt: string | ContentBlockParam[],
    options?: { uuid?: string; isMeta?: boolean },
  ): AsyncGenerator<SDKMessage, void, unknown> {
    const {
      cwd, commands, tools, mcpClients, verbose, thinkingConfig,
      maxTurns, maxBudgetUsd, taskBudget, canUseTool,
      customSystemPrompt, appendSystemPrompt, userSpecifiedModel,
      fallbackModel, jsonSchema, getAppState, setAppState,
      // ... 其他配置
    } = this.config

    // 1. 清除本轮发现的技能名
    this.discoveredSkillNames.clear()
    setCwd(cwd)

    // 2. 包装 canUseTool，追踪权限拒绝
    const wrappedCanUseTool: CanUseToolFn = async (
      tool, input, toolUseContext, assistantMessage, toolUseID, forceDecision,
    ) => {
      const result = await canUseTool(
        tool, input, toolUseContext, assistantMessage, toolUseID, forceDecision,
      )
      // 跟踪拒绝，用于 SDK 报告
      if (result.behavior !== 'allow') {
        this.permissionDenials.push({
          tool_name: sdkCompatToolName(tool.name),
          tool_use_id: toolUseID,
          tool_input: input,
        })
      }
      return result
    }

    // 3. 解析模型和思考配置
    const initialMainLoopModel = userSpecifiedModel
      ? parseUserSpecifiedModel(userSpecifiedModel)
      : getMainLoopModel()
    const initialThinkingConfig: ThinkingConfig = thinkingConfig
      ? thinkingConfig
      : shouldEnableThinkingByDefault() !== false
        ? { type: 'adaptive' }
        : { type: 'disabled' }

    // 4. 获取系统提示词组件
    const {
      defaultSystemPrompt,
      userContext: baseUserContext,
      systemContext,
    } = await fetchSystemPromptParts({
      tools,
      mainLoopModel: initialMainLoopModel,
      additionalWorkingDirectories: Array.from(
        initialAppState.toolPermissionContext.additionalWorkingDirectories.keys(),
      ),
      mcpClients,
      customSystemPrompt: customPrompt,
    })

    // 5. 组装最终系统提示词
    const systemPrompt = asSystemPrompt([
      ...(customPrompt !== undefined ? [customPrompt] : defaultSystemPrompt),
      ...(memoryMechanicsPrompt ? [memoryMechanicsPrompt] : []),
      ...(appendSystemPrompt ? [appendSystemPrompt] : []),
    ])

    // 6. 构建工具使用上下文
    let processUserInputContext: ProcessUserInputContext = {
      messages: this.mutableMessages,
      setMessages: fn => { this.mutableMessages = fn(this.mutableMessages) },
      onChangeAPIKey: () => {},
      handleElicitation: this.config.handleElicitation,
      options: {
        commands, debug: false, tools, verbose,
        mainLoopModel: initialMainLoopModel,
        thinkingConfig: initialThinkingConfig,
        mcpClients, mcpResources: {},
        ideInstallationStatus: null,
        isNonInteractiveSession: true,
        customSystemPrompt, appendSystemPrompt,
        agentDefinitions: { activeAgents: agents, allAgents: [] },
        theme: resolveThemeSetting(getGlobalConfig().theme),
        maxBudgetUsd,
      },
      getAppState, setAppState,
      abortController: this.abortController,
      readFileState: this.readFileState,
      // ... 其他字段
    }

    // 7. 处理用户输入（斜杠命令等）
    const {
      messages: messagesFromUserInput,
      shouldQuery,
      allowedTools,
      model: modelFromUserInput,
      resultText,
    } = await processUserInput({
      input: prompt,
      mode: 'prompt',
      setToolJSX: () => {},
      context: { ...processUserInputContext, messages: this.mutableMessages },
      messages: this.mutableMessages,
      uuid: options?.uuid,
      isMeta: options?.isMeta,
      querySource: 'sdk',
    })

    // 8. 委托给 query() 函数
    for await (const message of query({
      messages,
      systemPrompt,
      userContext,
      systemContext,
      canUseTool: wrappedCanUseTool,
      toolUseContext: processUserInputContext,
      fallbackModel,
      querySource: 'sdk',
      maxTurns,
      taskBudget,
    })) {
      // 处理各类消息并 yield 给调用者
      // ...（消息类型分发逻辑省略，见下方退出条件汇总）
    }
  }
}
```

### query() → queryLoop() — 进入主循环

```typescript
// src/query.ts — query 和 queryLoop 核心结构

// State 类型——每次循环迭代都替换整个对象，而非修改个别字段
type State = {
  messages: Message[]
  toolUseContext: ToolUseContext
  autoCompactTracking: AutoCompactTrackingState | undefined
  maxOutputTokensRecoveryCount: number
  hasAttemptedReactiveCompact: boolean
  maxOutputTokensOverride: number | undefined
  pendingToolUseSummary: Promise<ToolUseSummaryMessage | null> | undefined
  stopHookActive: boolean | undefined
  turnCount: number
  transition: Continue | undefined  // 记录为什么继续循环
}

// query() — 外壳，委托给 queryLoop，循环结束后通知命令
export async function* query(params) {
  const consumedCommandUuids = []
  const terminal = yield* queryLoop(params, consumedCommandUuids)  // ★ 委托
  // 循环结束后，通知所有消费的命令为 'completed'
  for (const uuid of consumedCommandUuids) {
    notifyCommandLifecycle(uuid, 'completed')
  }
  return terminal
}
```

---

## 步骤 ⑦：上下文准备与压缩

每轮 `while(true)` 迭代的开始，都要准备上下文。`queryLoop()` 中执行 5 级压缩级联，从轻到重：

```typescript
// src/query.ts — queryLoop 中的压缩级联（5 级）

// Level 1: 工具结果预算裁剪——按消息裁剪过大的工具结果
applyToolResultBudget(messagesForQuery)

// Level 2: 历史裁剪——轻量级移除早期冗余工具结果
snipCompactIfNeeded(messagesForQuery, ...)

// Level 3: 微压缩——通过 cache-editing 变体
microcompact(messagesForQuery, ...)

// Level 4: 上下文折叠——细粒度折叠（比全量摘要便宜）
contextCollapse.applyCollapsesIfNeeded(messagesForQuery, ...)

// Level 5: 全量自动压缩——LLM 摘要历史（最昂贵）
autoCompactIfNeeded(messagesForQuery, toolUseContext, ...)
```

排序是刻意的：如果轻量级方法就能把上下文降到阈值以下，更重的方法就是空操作。

```typescript
// src/services/compact/autoCompact.ts — 压缩决策核心逻辑

// 常量
AUTOCOMPACT_BUFFER_TOKENS = 13_000       // 压缩缓冲区
MAX_OUTPUT_TOKENS_FOR_SUMMARY = 20_000   // 摘要预留 token
MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3  // 连续失败熔断

// 计算有效上下文窗口 = 上下文窗口 - 摘要预留
export function getEffectiveContextWindowSize(model: string): number {
  const reservedTokensForSummary = Math.min(
    getMaxOutputTokensForModel(model),
    MAX_OUTPUT_TOKENS_FOR_SUMMARY,
  )
  let contextWindow = getContextWindowForModel(model, getSdkBetas())
  // 环境变量覆盖：CLAUDE_CODE_AUTO_COMPACT_WINDOW
  const autoCompactWindow = process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW
  if (autoCompactWindow) {
    const parsed = parseInt(autoCompactWindow, 10)
    if (!isNaN(parsed) && parsed > 0) {
      contextWindow = Math.min(contextWindow, parsed)
    }
  }
  return contextWindow - reservedTokensForSummary
}

// 计算压缩阈值 = 有效窗口 - 缓冲区
export function getAutoCompactThreshold(model: string): number {
  const effectiveContextWindow = getEffectiveContextWindowSize(model)
  const autocompactThreshold =
    effectiveContextWindow - AUTOCOMPACT_BUFFER_TOKENS
  // 环境变量百分比覆盖：CLAUDE_AUTOCOMPACT_PCT_OVERRIDE
  const envPercent = process.env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE
  if (envPercent) {
    const parsed = parseFloat(envPercent)
    if (!isNaN(parsed) && parsed > 0 && parsed <= 100) {
      const percentageThreshold = Math.floor(
        effectiveContextWindow * (parsed / 100),
      )
      return Math.min(percentageThreshold, autocompactThreshold)
    }
  }
  return autocompactThreshold
}

// 判断是否需要自动压缩——多重抑制门
export async function shouldAutoCompact(
  messages, model, querySource?, snipTokensFreed = 0,
): Promise<boolean> {
  // 递归守卫：session_memory / compact / marble_origami 查询源跳过
  if (querySource === 'session_memory' || querySource === 'compact') return false
  if (feature('CONTEXT_COLLAPSE') && querySource === 'marble_origami') return false
  // 用户禁用
  if (!isAutoCompactEnabled()) return false
  // REACTIVE_COMPACT 模式：抑制主动压缩
  if (feature('REACTIVE_COMPACT')) {
    if (getFeatureValue_CACHED_MAY_BE_STALE('tengu_cobalt_raccoon', false))
      return false
  }
  // 上下文折叠模式：抑制自动压缩（折叠负责空间管理）
  if (feature('CONTEXT_COLLAPSE')) {
    const { isContextCollapseEnabled } = require('../contextCollapse/index.js')
    if (isContextCollapseEnabled()) return false
  }
  // 最终判断：token 是否超过阈值
  const tokenCount = tokenCountWithEstimation(messages) - snipTokensFreed
  const { isAboveAutoCompactThreshold } = calculateTokenWarningState(tokenCount, model)
  return isAboveAutoCompactThreshold
}

// 执行自动压缩——两级策略 + 熔断器
export async function autoCompactIfNeeded(
  messages, toolUseContext, cacheSafeParams, querySource?, tracking?, snipTokensFreed?,
): Promise<{ wasCompacted: boolean; compactionResult?: CompactionResult; consecutiveFailures?: number }> {
  if (isEnvTruthy(process.env.DISABLE_COMPACT)) return { wasCompacted: false }

  // 熔断检查：连续失败 ≥ 3 次则跳过
  if (tracking?.consecutiveFailures !== undefined &&
      tracking.consecutiveFailures >= MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES) {
    return { wasCompacted: false }
  }

  const shouldCompact = await shouldAutoCompact(messages, model, querySource, snipTokensFreed)
  if (!shouldCompact) return { wasCompacted: false }

  // ★ 优先尝试会话记忆压缩（更轻量级）
  const sessionMemoryResult = await trySessionMemoryCompaction(...)
  if (sessionMemoryResult) {
    setLastSummarizedMessageId(undefined)
    runPostCompactCleanup(querySource)
    notifyCompaction(querySource ?? 'compact', toolUseContext.agentId)
    markPostCompaction()
    return { wasCompacted: true, compactionResult: sessionMemoryResult }
  }

  // ★ 回退到全量对话压缩（LLM 摘要，最昂贵）
  try {
    const compactionResult = await compactConversation(
      messages, toolUseContext, cacheSafeParams,
      true,    // suppress user questions
      undefined, // no custom instructions
      true,    // isAutoCompact
      recompactionInfo,
    )
    setLastSummarizedMessageId(undefined)
    runPostCompactCleanup(querySource)
    return { wasCompacted: true, compactionResult, consecutiveFailures: 0 }
  } catch (error) {
    // 增加失败计数，达到熔断阈值时记录
    const nextFailures = (tracking?.consecutiveFailures ?? 0) + 1
    if (nextFailures >= MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES) {
      logForDebugging('autocompact: circuit breaker tripped')
    }
    return { wasCompacted: false, consecutiveFailures: nextFailures }
  }
}
```

---

## 步骤 ⑧：API 流式调用

### claude.ts — queryModelWithStreaming()

```typescript
// src/services/api/claude.ts — 流式调用完整逻辑

export async function* queryModelWithStreaming({
  messages, systemPrompt, thinkingConfig, tools, signal, options,
}): AsyncGenerator<StreamEvent | AssistantMessage | SystemAPIErrorMessage, void> {
  // 委托给 withStreamingVCR——VCR 录制/回放能力
  // VCR 用于测试：录制 API 响应，回放时无需真实 API 调用
  return yield* withStreamingVCR(messages, async function* () {
    yield* queryModel(messages, systemPrompt, thinkingConfig, tools, signal, options)
  })
}

// queryModel() 内部完整流程（~1900 行）：

// 1. 检查下线开关（tengu-off-switch 动态配置）
//    如果被开关关闭，直接返回错误而不调用 API

// 2. 从消息历史推导 previousRequestId
//    Anthropic API 支持 x-request-id 链式追踪

// 3. 解析模型——Bedrock 推理配置文件需要特殊处理
//    Bedrock 模型 ID 格式不同于标准 Anthropic 模型 ID

// 4. 构建工具 schema（toolToAPISchema）
//    计算需要的 Beta 头部（getMergedBetas）
//    确定工具搜索/延迟加载策略
//    过滤掉不需要的工具

// 5. 规范化 API 消息
//    剥离工具引用块、确保工具结果配对、剥离顾问块

// 6. 构建系统提示块
//    添加指纹、归属、顾问指令
//    使用 cache_control 构建 Prompt Cache 标记

// 7. Beta 头部闩锁机制
//    对 AFK 模式、快速模式、缓存编辑、思考清除等 Beta 头部做闩锁
//    确保会话内缓存键稳定——中途改变 Beta 头部会破坏 Prompt Cache

// 8. 创建流式请求
//    client.beta.messages.stream({ ... })
//    使用原始流 + .withResponse() 获取响应头

// 9. 主流处理循环
//    message_start → 捕获 TTFT、usage
//    content_block_start → 初始化 tool_use/text/thinking 内容块
//    content_block_delta → 累积 input_json_delta/text_delta/thinking_delta
//    content_block_stop → 规范化内容，创建 AssistantMessage，yield
//    message_delta → 更新 usage/cost，处理 stop_reason

// 10. 流式错误回退
//     捕获流式错误，回退到 executeNonStreamingRequest
//     生成非流式结果作为 fallback
```

---

## 步骤 ⑨：流式工具执行

### StreamingToolExecutor — 并发安全的工具执行器

```typescript
// src/services/tools/StreamingToolExecutor.ts — 完整并发控制逻辑

type ToolStatus = 'queued' | 'executing' | 'completed' | 'yielded'

type TrackedTool = {
  id: string
  block: ToolUseBlock
  assistantMessage: AssistantMessage
  status: ToolStatus
  isConcurrencySafe: boolean
  promise?: Promise<void>
  results?: Message[]
  pendingProgress: Message[]           // 进度消息独立存储，立即 yield
  contextModifiers?: Array<(context: ToolUseContext) => ToolUseContext>
}

export class StreamingToolExecutor {
  private tools: TrackedTool[] = []
  private hasErrored = false                // Bash 工具是否出错
  private erroredToolDescription = ''       // 出错工具的描述
  private siblingAbortController: AbortController  // 子进程级取消信号
  private discarded = false                 // 是否被丢弃（流式回退时）
  private progressAvailableResolve?: () => void  // 进度可用唤醒信号

  // ★ 并发判断：是否可以开始执行新工具
  private canExecuteTool(isConcurrencySafe: boolean): boolean {
    const executingTools = this.tools.filter(t => t.status === 'executing')
    return (
      executingTools.length === 0 ||  // 无正在执行的工具 → 可以
      (isConcurrencySafe && executingTools.every(t => t.isConcurrencySafe))
      // 新工具并发安全 + 所有正在执行的工具也并发安全 → 可以并行
    )
  }

  // ★ 添加工具到队列
  addTool(block: ToolUseBlock, assistantMessage: AssistantMessage): void {
    const toolDefinition = findToolByName(this.toolDefinitions, block.name)
    if (!toolDefinition) {
      // 工具不存在 → 立即完成，返回错误结果
      this.tools.push({
        id: block.id, block, assistantMessage,
        status: 'completed', isConcurrencySafe: true,
        pendingProgress: [],
        results: [createUserMessage({
          content: [{
            type: 'tool_result',
            content: `<tool_use_error>Error: No such tool available: ${block.name}</tool_use_error>`,
            is_error: true, tool_use_id: block.id,
          }],
          toolUseResult: `Error: No such tool available: ${block.name}`,
          sourceToolAssistantUUID: assistantMessage.uuid,
        })],
      })
      return
    }

    // 解析输入，判断并发安全性
    const parsedInput = toolDefinition.inputSchema.safeParse(block.input)
    const isConcurrencySafe = parsedInput?.success
      ? (() => {
          try {
            return Boolean(toolDefinition.isConcurrencySafe(parsedInput.data))
          } catch {
            return false  // 判断失败时保守地认为不安全
          }
        })()
      : false  // 解析失败时保守地认为不安全

    this.tools.push({
      id: block.id, block, assistantMessage,
      status: 'queued', isConcurrencySafe, pendingProgress: [],
    })

    // 立即尝试处理队列
    void this.processQueue()
  }

  // ★ 执行工具并收集结果
  private async executeTool(tool: TrackedTool): Promise<void> {
    tool.status = 'executing'
    this.updateInterruptibleState()

    const messages: Message[] = []
    const contextModifiers: Array<(context: ToolUseContext) => ToolUseContext> = []

    const collectResults = async () => {
      // 如果已经被取消，生成合成错误而非执行工具
      const initialAbortReason = this.getAbortReason(tool)
      if (initialAbortReason) {
        messages.push(this.createSyntheticErrorMessage(tool.id, initialAbortReason, tool.assistantMessage))
        tool.results = messages
        tool.status = 'completed'
        return
      }

      // 创建工具级 AbortController——siblingAbortController 的子级
      // Bash 工具出错时会取消 siblingAbortController，杀死所有兄弟子进程
      const toolAbortController = createChildAbortController(this.siblingAbortController)
      // 非兄弟错误冒泡到父控制器
      toolAbortController.signal.addEventListener('abort', () => {
        if (toolAbortController.signal.reason !== 'sibling_error' &&
            !this.toolUseContext.abortController.signal.aborted && !this.discarded) {
          this.toolUseContext.abortController.abort(toolAbortController.signal.reason)
        }
      }, { once: true })

      // ★ 执行工具
      const generator = runToolUse(
        tool.block, tool.assistantMessage, this.canUseTool,
        { ...this.toolUseContext, abortController: toolAbortController },
      )

      let thisToolErrored = false
      for await (const update of generator) {
        // 检查是否被兄弟错误或用户中断取消
        const abortReason = this.getAbortReason(tool)
        if (abortReason && !thisToolErrored) {
          messages.push(this.createSyntheticErrorMessage(tool.id, abortReason, tool.assistantMessage))
          break
        }

        // 检查是否为错误结果
        const isErrorResult = update.message.type === 'user' &&
          Array.isArray(update.message.message.content) &&
          update.message.message.content.some(_ => _.type === 'tool_result' && _.is_error === true)

        if (isErrorResult) {
          thisToolErrored = true
          // ★ 只有 Bash 工具的错误会取消兄弟——Bash 命令往往有隐式依赖链
          // Read/WebFetch 等工具的失败不应连带取消其他并行工具
          if (tool.block.name === BASH_TOOL_NAME) {
            this.hasErrored = true
            this.erroredToolDescription = this.getToolDescription(tool)
            this.siblingAbortController.abort('sibling_error')
          }
        }

        if (update.message) {
          if (update.message.type === 'progress') {
            // 进度消息放入 pendingProgress，立即 yield
            tool.pendingProgress.push(update.message)
            if (this.progressAvailableResolve) {
              this.progressAvailableResolve()
              this.progressAvailableResolve = undefined
            }
          } else {
            messages.push(update.message)
          }
        }
        if (update.contextModifier) {
          contextModifiers.push(update.contextModifier.modifyContext)
        }
      }
      tool.results = messages
      tool.contextModifiers = contextModifiers
      tool.status = 'completed'
    }

    const promise = collectResults()
    tool.promise = promise
    void promise.finally(() => { void this.processQueue() })
  }

  // ★ 获取已完成的结果（非阻塞，按原始顺序）
  *getCompletedResults(): Generator<MessageUpdate, void> {
    if (this.discarded) return
    for (const tool of this.tools) {
      // 始终立即 yield 待处理的进度消息
      while (tool.pendingProgress.length > 0) {
        const progressMessage = tool.pendingProgress.shift()!
        yield { message: progressMessage, newContext: this.toolUseContext }
      }
      if (tool.status === 'yielded') continue
      if (tool.status === 'completed' && tool.results) {
        tool.status = 'yielded'
        for (const message of tool.results) {
          yield { message, newContext: this.toolUseContext }
        }
        markToolUseAsComplete(this.toolUseContext, tool.id)
      } else if (tool.status === 'executing' && !tool.isConcurrencySafe) {
        break  // 非并发安全工具正在执行时，停止迭代以保持顺序
      }
    }
  }

  // ★ 等待所有剩余结果（流式结束后调用）
  async *getRemainingResults(): AsyncGenerator<MessageUpdate, void> {
    if (this.discarded) return
    while (this.hasUnfinishedTools()) {
      await this.processQueue()
      for (const result of this.getCompletedResults()) {
        yield result
      }
      // 如果有执行中的工具但无已完成结果，等待任一完成或进度可用
      if (this.hasExecutingTools() && !this.hasCompletedResults() && !this.hasPendingProgress()) {
        const executingPromises = this.tools
          .filter(t => t.status === 'executing' && t.promise)
          .map(t => t.promise!)
        const progressPromise = new Promise<void>(resolve => {
          this.progressAvailableResolve = resolve
        })
        if (executingPromises.length > 0) {
          await Promise.race([...executingPromises, progressPromise])
        }
      }
    }
    for (const result of this.getCompletedResults()) {
      yield result
    }
  }

  // 丢弃所有待处理结果（模型降级/流式回退时调用）
  discard(): void {
    this.discarded = true
  }
}
```

**核心设计**：
- 并发安全工具（`isConcurrencySafe = true`）可以并行执行
- 非安全工具需要独占访问，串行执行
- 结果按原始顺序缓冲输出
- **只有 Bash 工具的错误会取消兄弟**——Bash 命令有隐式依赖链，Read/WebFetch 等失败不应连带
- 进度消息通过 `pendingProgress` 独立存储并立即 yield

---

## 步骤 ⑩：解析工具调用

从流式响应中提取 `tool_use` 块：

```typescript
// 在 queryLoop() 的流式循环中
for await (const message of deps.callModel({ ... })) {
  yield message

  if (message.type === 'assistant') {
    // 提取 tool_use 块
    const toolUseBlocks = message.message.content.filter(
      content => content.type === 'tool_use'
    )

    if (toolUseBlocks.length > 0) {
      needsFollowUp = true  // ★ 标记：需要执行工具后继续循环
      // 交给流式执行器提前执行
      for (const block of toolUseBlocks) {
        streamingToolExecutor.addTool(block, message)
      }
    }
  }
}
```

Zod 验证在 `StreamingToolExecutor.addTool()` 和 `checkPermissionsAndCallTool()` 中执行：

```typescript
// StreamingToolExecutor.addTool() 中：
const parsedInput = toolDefinition.inputSchema.safeParse(block.input)
const isConcurrencySafe = parsedInput?.success
  ? (() => {
      try {
        return Boolean(toolDefinition.isConcurrencySafe(parsedInput.data))
      } catch { return false }
    })()
  : false

// checkPermissionsAndCallTool() 中：
const parsedInput = tool.inputSchema.safeParse(rawInput)
if (!parsedInput.success) {
  // 返回验证错误——工具不会执行
}
```

---

## 步骤 ⑪：权限校验

### permissions.ts — 管道式决策链

```typescript
// src/utils/permissions/permissions.ts — 权限决策完整逻辑

// ★ 外层函数：hasPermissionsToUseTool
export const hasPermissionsToUseTool: CanUseToolFn = async (
  tool, input, context, assistantMessage, toolUseID
) => {
  // 1. 调用内部决策函数
  let decision = await hasPermissionsToUseToolInner(tool, input, context)

  // 2. 如果结果是 'allow'，重置 Auto 模式的连续拒绝计数
  if (decision.behavior === 'allow') {
    resetConsecutiveDenials()
    return decision
  }

  // 3. 如果结果是 'ask'，根据权限模式转换
  if (decision.behavior === 'ask') {
    // dontAsk 模式：ask → deny（不弹窗，直接拒绝）
    if (appState.toolPermissionContext.mode === 'dontAsk') {
      return {
        behavior: 'deny',
        decisionReason: { type: 'mode', mode: 'dontAsk' },
        message: DONT_ASK_REJECT_MESSAGE(tool.name),
      }
    }

    // auto 模式（含 plan+autoActive）：ask → YOLO 分类器决定
    if (
      feature('TRANSCRIPT_CLASSIFIER') &&
      (appState.toolPermissionContext.mode === 'auto' ||
        (appState.toolPermissionContext.mode === 'plan' &&
          (autoModeStateModule?.isAutoModeActive() ?? false)))
    ) {
      // 多重安全检查——不是所有 ask 都可以分类器决定：
      // a. 非 classifierApprovable 的安全检查 → 保持 ask
      // b. requiresUserInteraction() 的工具 → 保持 ask
      // c. PowerShell（无 POWERSHELL_AUTO_MODE 功能标志）→ 保持 ask
      // d. acceptEdits 快速路径：重新调用 tool.checkPermissions(mode='acceptEdits')，
      //    如果返回 allow，跳过分类器
      // e. 安全工具白名单：isAutoModeAllowlistedTool → 直接 allow
      // f. 分类器执行：classifyYoloAction
      //    - 分类器允许 → allow（decisionReason.type: 'classifier'）
      //    - 分类器拒绝 → deny（含连续拒绝追踪）
      //    - 分类器不可用：
      //      - iron gate 关闭 → deny（安全回退）
      //      - iron gate 打开 → ask（回退到用户确认）
    }

    // default 模式：弹出用户确认对话框
    return askUserViaUI(tool, input, context)
  }

  // 4. headless/async agent：避免权限弹窗
  if (appState.toolPermissionContext.shouldAvoidPermissionPrompts) {
    // 先运行 PermissionRequest hooks
    const hookDecision = await runPermissionRequestHooksForHeadlessAgent(...)
    if (hookDecision) return hookDecision
    // 无 hook 决定 → 自动拒绝
    return {
      behavior: 'deny',
      decisionReason: { type: 'asyncAgent', reason: 'Permission prompts are not available...' },
    }
  }

  return decision  // 'deny' 直接返回
}

// ★ 内部决策链（按顺序短路）
async function hasPermissionsToUseToolInner(tool, input, context) {
  // Step 1a: 整个工具被 deny 规则匹配 → 直接拒绝
  const denyRule = getDenyRuleForTool(tool, input, context)
  if (denyRule) return { behavior: 'deny', rule: denyRule }

  // Step 1b: 整个工具有 ask 规则 → 进入 ask 流程
  // 例外：沙箱化 Bash + autoAllowBashIfSandboxed → 落入下一步
  const askRule = getAskRuleForTool(tool, input, context)
  if (askRule) return { behavior: 'ask', rule: askRule }

  // Step 1c: 工具自身的权限检查
  // 例如 BashTool.checkPermissions 分析子命令安全性
  const toolPermissionResult = await tool.checkPermissions(parsedInput, context)

  // Step 1d: 结果是 deny → 直接拒绝
  if (toolPermissionResult.behavior === 'deny') return toolPermissionResult

  // Step 1e: requiresUserInteraction + ask → bypass-immune（始终弹窗）
  if (tool.requiresUserInteraction() && toolPermissionResult.behavior === 'ask') {
    return toolPermissionResult
  }

  // Step 1f: 内容特定的 ask 规则 → bypass-immune
  // 例如 Bash(npm publish:*) 这样的特定命令规则
  if (toolPermissionResult.behavior === 'ask' && toolPermissionResult.decisionReason) {
    return toolPermissionResult
  }

  // Step 1g: 安全检查（.git/, .claude/, .vscode/, shell 配置）→ bypass-immune
  if (isSafetyCheck(toolPermissionResult)) return toolPermissionResult

  // Step 2a: bypassPermissions 模式 → 允许
  const shouldBypassPermissions =
    appState.toolPermissionContext.mode === 'bypassPermissions' ||
    (appState.toolPermissionContext.mode === 'plan' &&
      appState.toolPermissionContext.isBypassPermissionsModeAvailable)
  if (shouldBypassPermissions) {
    return { behavior: 'allow', decisionReason: { type: 'mode', mode: '...' } }
  }

  // Step 2b: alwaysAllow 规则匹配 → 自动放行
  const allowRule = toolAlwaysAllowedRule(tool, input, context)
  if (allowRule) return { behavior: 'allow', rule: allowRule }

  // Step 3: 默认 → 将 passthrough 转换为 ask
  const result = toolPermissionResult.behavior === 'passthrough'
    ? { ...toolPermissionResult, behavior: 'ask' as const }
    : toolPermissionResult
  return result
}
```

```
权限决策管道（短路返回）：

  ① deny 规则 → 拒绝
       ↓ 未匹配
  ② ask 规则 → 进入 ask 流程
       ↓ 未匹配
  ③ tool.checkPermissions() → 工具特定决策
       ↓ deny 拒绝 / ask 继续
  ④ requiresUserInteraction + ask → bypass-immune 弹窗
       ↓ 通过
  ⑤ 内容特定 ask 规则 → bypass-immune 弹窗
       ↓ 通过
  ⑥ 安全检查 → bypass-immune 弹窗
       ↓ 非此模式
  ⑦ bypassPermissions 模式 →
       ├── bypass-immune（.git/ 等）→ 弹窗
       └── 其他 → 放行
       ↓ 非此模式
  ⑧ alwaysAllow 规则 → 自动放行
       ↓ 未匹配
  ⑨ 默认 → ask 用户
       ↓ ask 结果处理
  模式转换：
       ├── default → 弹出用户确认
       ├── dontAsk → ask 转 deny
       └── auto → YOLO 分类器决定
```

---

## 步骤 ⑫：Hook 执行

### toolHooks.ts — PreToolUse Hooks

```typescript
// src/services/tools/toolHooks.ts — PreToolUse Hooks 完整逻辑

export async function* runPreToolUseHooks(
  toolUseContext, tool, processedInput, toolUseID, ...
) {
  // 遍历所有 PreToolUse hooks，依次执行
  for await (const result of executePreToolHooks(tool.name, ...)) {
    // hook 可以产生以下效果：

    if (result.message) {
      // hook 消息（如进度、上下文）
      yield { type: 'message', message: result.message }
    }

    if (result.blockingError) {
      // ★ 阻塞错误：hook 返回错误，工具不会执行
      yield { type: 'hookPermissionResult', hookPermissionResult: { behavior: 'deny' } }
    }

    if (result.preventContinuation) {
      // ★ 阻止继续：hook 可以终止整个 Agent 循环
      yield { type: 'preventContinuation', shouldPreventContinuation: true }
      if (result.stopReason) {
        yield { type: 'stopReason', stopReason: result.stopReason }
      }
    }

    if (result.permissionBehavior) {
      // ★ 权限决策：hook 可以允许/拒绝工具执行
      // behavior 可以是 'allow'、'ask' 或 'deny'
      yield {
        type: 'hookPermissionResult',
        hookPermissionResult: {
          behavior: result.permissionBehavior,
          updatedInput: result.updatedInput,
          decisionReason: { type: 'hook', hookName: result.hookName },
        },
      }
    } else if (result.updatedInput) {
      // ★ 修改输入：hook 可以修改工具的参数（无权限决策）
      yield { type: 'hookUpdatedInput', updatedInput: result.updatedInput }
    }

    if (result.additionalContext) {
      // ★ 额外上下文：hook 可以提供额外信息
      yield { type: 'additionalContext', message: result.additionalContext }
    }
  }
}
```

**`resolveHookPermissionDecision()`** — 解析 Hook 权限决策的关键函数：

```typescript
// resolveHookPermissionDecision 核心不变量：
// Hook 的 allow 决策不能绕过 settings.json 中的 deny/ask 规则

// 如果 hook 结果为 allow：
if (hookResult.behavior === 'allow') {
  // requiresUserInteraction 的工具仍需通过 canUseTool 弹窗
  if (tool.requiresUserInteraction() || tool.requireCanUseTool) {
    return canUseTool(tool, input, context, ...)
  }
  // 运行 checkRuleBasedPermissions——如果规则为 null 则允许，
  // 如果规则为 deny 则拒绝，如果规则为 ask 则弹窗
  const ruleBasedResult = await checkRuleBasedPermissions(tool, input, context)
  return ruleBasedResult
}

// 如果 hook 结果为 deny：直接拒绝
if (hookResult.behavior === 'deny') {
  return { behavior: 'deny', ... }
}

// 如果 hook 结果为 ask 或 undefined：运行 canUseTool
return canUseTool(tool, input, context, ...)
```

---

## 步骤 ⑬：执行工具

### toolExecution.ts — runToolUse()

```typescript
// src/services/tools/toolExecution.ts — runToolUse 完整流程

export async function* runToolUse(
  toolUse: ToolUseBlock,
  assistantMessage: AssistantMessage,
  canUseTool: CanUseToolFn,
  toolUseContext: ToolUseContext
): AsyncGenerator<MessageUpdateLazy> {
  // 1. 查找工具——先在主列表找，再在废弃别名列表找
  const tool = findToolByName(toolUseContext.options.tools, toolUse.name)

  // 2. 工具不存在 → 返回错误工具结果
  if (!tool) {
    yield { message: createUserMessage({
      content: [{
        type: 'tool_result',
        content: `<tool_use_error>Error: No such tool available: ${toolUse.name}</tool_use_error>`,
        is_error: true,
        tool_use_id: toolUse.id,
      }],
    }) }
    return
  }

  // 3. 检查是否已中断
  if (toolUseContext.abortController.signal.aborted) {
    yield { message: cancelMessage }
    return
  }

  // 4. 委托给 streamedCheckPermissionsAndCallTool()
  //    内部完整流程：
  //    a. Zod 验证输入（tool.inputSchema.safeParse）
  //    b. 工具特定 validateInput 验证
  //    c. Bash 工具：投机性启动分类器检查
  //    d. 运行 PreToolUse hooks（runPreToolUseHooks）
  //       → 处理 hookPermissionResult / hookUpdatedInput / preventContinuation
  //    e. 解析 hook 权限决策（resolveHookPermissionDecision）
  //    f. 调用 canUseTool 做用户权限确认
  //    g. 如果权限被拒绝：生成错误消息，执行 executePermissionDeniedHooks
  //    h. 如果权限决策提供了 updatedInput，应用它
  //    i. ★ 执行工具：tool.call(parsedInput, context, canUseTool, ...)
  //    j. 运行 PostToolUse hooks（runPostToolUseHooks）
  //       → 处理 updatedMCPToolOutput / additionalContext
  //    k. 捕获工具错误：运行 PostToolUseFailure hooks
  yield* streamedCheckPermissionsAndCallTool(tool, ...)
}
```

---

## 步骤 ⑭：PostToolUse Hooks

```typescript
// src/services/tools/toolHooks.ts — PostToolUse Hooks

export async function* runPostToolUseHooks(
  toolUseContext, tool, toolUseID, toolInput, toolResponse, ...
) {
  // 遍历所有 PostToolUse hooks
  for await (const result of executePostToolHooks(...)) {
    // hook 可以：

    // 1. hook_cancelled：hook 被取消
    if (result.attachment?.type === 'hook_cancelled') {
      yield cancelMessage
      continue
    }

    // 2. hook_blocking_error：阻塞错误
    if (result.attachment?.type === 'hook_blocking_error') {
      yield blockingErrorMessage
      // 不 return——继续处理后续 hooks
    }

    // 3. preventContinuation：阻止继续
    if (result.preventContinuation) {
      yield hook_stopped_continuation_message
      return
    }

    // 4. additionalContext：额外上下文
    if (result.additionalContext) {
      yield additionalContextMessage
    }

    // 5. ★ 修改 MCP 工具的输出（updatedMCPToolOutput）
    //    调用者可以使用修改后的输出替代原始输出
    if (result.updatedMCPToolOutput) {
      yield { type: 'updatedMCPToolOutput', output: result.updatedMCPToolOutput }
    }
  }
}
```

---

## 步骤 ⑮：结果映射

工具执行完成后，结果需要映射为 API 格式：

```typescript
// 在 queryLoop() 中：
const toolUpdates = streamingToolExecutor
  ? streamingToolExecutor.getRemainingResults()   // 流式路径
  : runTools(toolUseBlocks, assistantMessages, canUseTool, toolUseContext)  // 非流式路径

for await (const update of toolUpdates) {
  if (update.message) {
    yield update.message  // 向外推送工具结果
    toolResults.push(...)  // 收集结果，下一轮发送给 LLM
  }
  if (update.newContext) {
    toolUseContext = update.newContext  // 更新上下文（如果有修改）
  }
}
```

工具结果还会经过预算裁剪（`applyToolResultBudget`），确保单条消息的工具结果不超过限制。

---

## 步骤 ⑯：附件注入

```typescript
// src/query.ts — queryLoop 中的附件注入逻辑

// 1. 排队命令附件
const queuedCommandsSnapshot = getCommandsByMaxPriority(
  sleepRan ? 'later' : 'next'
).filter(cmd => {
  if (isSlashCommand(cmd)) return false       // 斜杠命令不走附件
  if (isMainThread) return cmd.agentId === undefined  // 主线程：仅全局命令
  return cmd.mode === 'task-notification' && cmd.agentId === currentAgentId  // 子 agent
})

// 2. 获取附件消息（记忆文件、文件变更等）
for await (const attachment of getAttachmentMessages(...)) {
  yield attachment
  toolResults.push(attachment)
}

// 3. 记忆预取消费（如果已就绪）
if (pendingMemoryPrefetch.settledAt !== null && consumedOnIteration === -1) {
  const memoryAttachments = await pendingMemoryPrefetch.promise
  for (const att of filterDuplicateMemoryAttachments(memoryAttachments, readFileState)) {
    yield createAttachmentMessage(att)
    toolResults.push(msg)
  }
}

// 4. 技能发现预取
if (skillPrefetch && pendingSkillPrefetch) {
  const skillAttachments = await skillPrefetch.collectSkillDiscoveryPrefetch(...)
  // ...
}

// 5. 消费命令从队列中移除，并追踪生命周期
for (const cmd of consumedCommands) {
  removeCommand(cmd)
  consumedCommandUuids.push(cmd.uuid)
  notifyCommandLifecycle(cmd.uuid, 'consumed')
}
```

---

## 步骤 ⑰：多轮循环

### 重建消息状态，回到步骤 ⑦

```typescript
// src/query.ts — queryLoop() 末尾的状态重建

const next: State = {
  messages: [...messagesForQuery, ...assistantMessages, ...toolResults],
  //   ↑ 旧上下文        ↑ 本轮助手消息      ↑ 本轮工具结果
  toolUseContext: toolUseContextWithQueryTracking,
  autoCompactTracking: tracking,
  turnCount: nextTurnCount,
  maxOutputTokensRecoveryCount: 0,         // 重置输出 token 恢复计数
  hasAttemptedReactiveCompact: false,       // 重置反应式压缩标志
  pendingToolUseSummary: nextPendingToolUseSummary,
  maxOutputTokensOverride: undefined,       // 重置输出 token 覆盖
  stopHookActive,
  transition: { reason: 'next_turn' },      // ★ 记录转换原因
}
state = next

// 回到 while(true) 顶部，开始下一轮迭代
```

**这就是 Agent 循环的"闭环"**——工具执行的结果成为 LLM 下一轮推理的输入。循环直到 LLM 不再请求工具（`needsFollowUp === false`）或触发退出条件。

**转换原因**（`transition.reason`）用于断路器逻辑和测试断言：

| 转换原因 | 描述 |
|---------|------|
| `'next_turn'` | 正常下一轮 |
| `'collapse_drain_retry'` | 上下文折叠提交，减少上下文重试 |
| `'reactive_compact_retry'` | 反应式压缩成功，用压缩后消息重试 |
| `'max_output_tokens_escalate'` | 从 8k 升级到 64k 输出 token 限制 |
| `'max_output_tokens_recovery'` | 输出 token 限制后注入续接消息（最多 3 次）|
| `'stop_hook_blocking'` | Stop hook 产生阻塞错误，带错误消息重试 |
| `'token_budget_continuation'` | Token 预算超限，注入提醒后继续 |

---

## 退出条件汇总

| 退出原因 | 触发条件 | 对应代码位置 |
|---------|---------|---------|
| `completed` | LLM 返回纯文本，未请求工具 | queryLoop 正常返回 |
| `max_turns` | turnCount > maxTurns | 循环顶部检查 |
| `aborted_streaming` | 用户在流式输出时按 Ctrl+C | 流式循环中断 |
| `aborted_tools` | 用户在工具执行时按 Ctrl+C | 工具执行中断 |
| `blocking_limit` | 上下文过长，压缩也无法挽救 | 压缩后仍超限 |
| `prompt_too_long` | 压缩恢复失败 | reactive compact 失败 |
| `image_error` | 图片大小错误 | API 返回图片错误 |
| `model_error` | API 调用异常 | 未处理的 API 异常 |
| `hook_stopped` | Hook 阻止继续 | hook_stopped_continuation |
| `stop_hook_prevented` | Stop Hook 阻止 | stop hook 返回阻止 |

---

## 本章小结

本章完整走读了 Claude Code 的 17 步执行链路，从启动入口到 Agent 循环退出。关键要点：

1. **启动分层**：`dev-entry.ts`（完整性检查）→ `cli.tsx`（快速路由，11 个快速路径全部使用动态导入）→ `init.ts`（7 阶段初始化，TLS 证书必须在握手前设置）→ `main.tsx`（Commander + REPL，模块级副作用并行化）
2. **Prompt 构建**：4 层 CLAUDE.md（managed → user → project → local）+ SystemPromptSections 缓存机制（`systemPromptSection` 缓存 / `DANGEROUS_uncachedSystemPromptSection` 破坏缓存）+ 优先级覆盖链（override > coordinator > proactive > agent/custom/default）+ 上下文并行组装
3. **Agent 循环核心**：`while(true)` + `needsFollowUp` 方向盘 + 5 级压缩级联（预算裁剪 → 历史裁剪 → 微压缩 → 上下文折叠 → 全量压缩）+ State 对象整体替换
4. **权限管道**：deny → ask → tool.checkPermissions → safety check → bypass → alwaysAllow → 默认 ask → 模式转换（default/dontAsk/auto）
5. **Hook 中间件**：PreToolUse（输入修改/权限决策/阻止执行）+ PostToolUse（输出修改），Hook allow 不能绕过 deny/ask 规则
6. **流式工具执行**：并发安全工具并行、非安全工具串行、Bash 错误级联取消兄弟、结果按原始顺序缓冲
7. **闭环设计**：`[...旧消息, ...助手消息, ...工具结果]` 构成下一轮输入，`transition.reason` 追踪每轮循环的原因

下一章我们将深入第 1 个子系统——API 客户端与 LLM 通信层。
