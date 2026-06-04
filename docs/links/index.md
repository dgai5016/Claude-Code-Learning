# 相关学习链接

:::tip
1. Claude Code 更新日志: https://code.claude.com/docs/en/changelog
2. Claude Code 官方博客: https://www.anthropic.com/news
3. Claude Code 官方教程: https://anthropic.skilljar.com/
4. Claude Code 最佳实践: https://code.claude.com/docs/en/best-practices
:::


### 1. [分享Claude Code团队内部的5条工作原则](https://mp.weixin.qq.com/s/iBELIhdHf44aWKs0Z-Iudg)

- **时间**：2026-06-03
- **来源**：微信公众号 - 数字生命卡兹克
- **摘要**：分享Claude Code团队的5条AI原生工作原则，核心是瓶颈从写代码转移至验证与评审

**认知：**
1. AI时代瓶颈从"写代码"转移到了"验证、评审、安全"，组织流程需围绕此变化重新设计
2. 传统规划方式失效，长周期路线图在AI快速迭代下迅速过时，应采用JIT规划（恰好足够的规划）
3. 代码所有权变得模糊——谁写的代码不再是关键问题，协作和验证才是
4. 文档不再是唯一的真相来源，原型和可运行代码比设计文档更有说服力
5. 团队角色在模糊化，招聘应更看重创造力和判断力而非纯产出速度

**实践：**
1. 重复3遍以上的事情，用AI自动掉，把自动化变成肌肉记忆
2. 用原型替代争论——有分歧时让Claude同时做两个原型，看实物判断而非开会争吵
3. 少做前期规划，先做原型让内部用户使用，根据反馈快速迭代
4. 需求文档后置——先写代码，需要时再补文档
5. 从小事开始自动化，别想着搭建完整体系，一个一个攒起来自然会长大

---

### 2. [How Anthropic teams use Claude Code](https://claude.com/blog/how-anthropic-teams-use-claude-code)

- **时间**：2025-07-24
- **来源**：Anthropic 官方博客
- **摘要**：Anthropic 内部各团队（工程、法务、营销、数据科学）使用 Claude Code 的真实案例，展示 Agent 编程如何消融技术与非技术工作的边界

**认知：**
1. Agent 编程不只是加速开发，而是消融技术与非技术工作的边界——能描述问题就能构建解决方案
2. CLAUDE.md 和 MCP 是知识管理的核心载体，将散落的文档、注释、经验整合为可检索上下文
3. 将 Claude Code 作为"思考伙伴"而非"代码生成器"的团队，取得的成果远超单纯用它写代码
4. 测试驱动开发在 Agent 模式下被重塑：先要伪代码，再引导 TDD，而非写完代码再补测试
5. 非技术人员（律师、营销）也能用 Claude Code 构建定制化工具，传统需要专职开发的场景被平民化

**实践：**
1. 让 Claude Code 读取 CLAUDE.md 文件来快速理解代码库，替代传统数据目录工具
2. 通过 GitHub Actions 自动化 PR 审查，让 Claude 处理格式问题和测试用例重构
3. 用 Claude Code 做设计阶段的边界探索——映射错误状态和逻辑流，在设计时就发现边界情况
4. 让 Claude 整合多个文档源生成精简 runbook，作为调试生产问题的上下文
5. 搭建多 Agent 工作流处理批量任务（如广告变体生成），用专业化子 Agent 分工协作
