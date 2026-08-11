# 技术架构

## 1. 架构目标

系统优先保证不重复发送、不错过停止信号、可解释和可审计。模型只负责提取与生成，是否创建任务、何时执行和能否发送由确定性业务规则控制。

## 2. 目标组件

```mermaid
flowchart LR
  U["Web / Mobile Web"] --> A["Next.js API"]
  A --> DB["PostgreSQL"]
  A --> O["Follow-up Orchestrator"]
  O --> Q["Durable Job Queue"]
  Q --> W["Scheduler Worker"]
  W --> P["Policy Engine"]
  W --> AI["AI Gateway"]
  W --> C["Message Channel Adapters"]
  C --> OUT["Email / Approved Platform API"]
  W --> DB
  A --> S["Object Storage"]
```

## 3. 代码边界

- `src/domain`：纯业务规则，不依赖 React、数据库或模型 SDK。
- `src/components`：产品界面和交互状态。
- `src/data`：当前里程碑的演示数据；M1 后替换为服务端仓储。
- `src/app/api`：健康检查和后续 HTTP 接口。
- `tests`：跨页面浏览器冒烟测试。

## 4. 核心数据实体

### Opportunity

包含用户、公司、岗位、阶段、渠道、招聘方、使用简历和当前状态。所有阶段变化写入不可变时间线。

### ConversationEvent

保存消息方向、渠道、原始文本、发生时间和结构化提取结果。原始内容与模型推断分开存储。

### FollowUpTask

保存计划时间、触发规则、追问次数、状态、草稿版本和幂等键。任务状态至少包含 `scheduled`、`awaiting_approval`、`sending`、`sent`、`cancelled` 和 `failed`。

### CandidateMemory

保存事实内容、作用范围、来源、置信度、有效期和版本。敏感字段单独加密。

### AuditEvent

记录创建、编辑、确认、发送、取消和记忆变更。审计记录只追加，不覆盖。

## 5. 可靠发送

队列允许至少一次执行，因此发送路径必须幂等：

1. Worker 使用 `follow_up_task_id + draft_revision` 生成幂等键。
2. 数据库事务将任务从 `approved` 原子更新为 `sending`。
3. 渠道适配器携带幂等键发送；支持原生幂等的渠道直接复用。
4. 成功后记录渠道消息 ID 并更新为 `sent`。
5. 超时重试前先根据幂等键和渠道消息 ID 检查已有结果。

建议使用 PostgreSQL outbox，避免业务事务成功但队列消息丢失。

## 6. 模型边界

模型可以：

- 从对话中提取承诺日期、阶段和缺失信息。
- 根据已确认事实生成草稿。
- 标注不确定性并请求用户澄清。

模型不可以：

- 直接决定是否允许发送。
- 绕过最大追问次数和终态规则。
- 创建不存在的个人经历、薪资或到岗承诺。
- 直接写入长期记忆；记忆变更需要验证和版本记录。

提示词、模型版本和结构化输出 schema 必须进入版本控制。每次变更运行固定行为评测集。

## 7. 安全与隐私

- 生产环境采用行级租户隔离，所有查询必须携带用户 ID。
- 简历文件使用私有对象存储和短时签名 URL。
- 静态数据、备份和高敏感字段加密。
- 日志不记录完整简历、手机号、邮箱和消息正文。
- 用户支持导出、删除和撤销渠道授权。
- 自动发送能力按用户、渠道和消息类型分别授权。

## 8. 可观测性

至少监控：任务逾期量、队列延迟、生成失败率、确认率、发送失败率、重复发送拦截次数、回复后未取消任务数。高风险异常需要立即告警并支持关闭渠道发送的全局开关。
