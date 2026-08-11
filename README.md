# 求职跟进智能体

面向求职者的机会跟进工作台。系统根据招聘阶段、对话承诺、工作时间和历史追问次数，生成下一次追问计划与消息草稿，并默认由用户确认后发送。

当前仓库包含可交互的产品骨架、独立调度领域模块、自动化测试和 GitHub CI。演示数据保存在浏览器本地；服务端账户、PostgreSQL 和真实消息渠道属于下一阶段。

## 核心原则

- 不编造求职者经历、薪资、到岗时间或其他个人事实。
- 招聘方回复、明确拒绝或岗位关闭后，立即取消失效任务。
- 单个机会默认最多主动追问两次。
- 避开夜间、周末和法定节假日。
- 第一阶段所有外发消息均需用户确认。
- 所有发送操作都需要幂等键和审计记录。

## 本地运行

要求 Node.js 22 或更高版本。

```bash
npm install
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000)。

## 质量检查

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

首次运行浏览器冒烟测试前安装 Chromium：

```bash
npx playwright install chromium
npm run test:smoke
```

## 文档

- [产品需求](docs/PRD.md)
- [技术架构](docs/ARCHITECTURE.md)
- [测试策略](docs/TESTING.md)
- [贡献规范](CONTRIBUTING.md)
- [安全策略](SECURITY.md)

## 当前里程碑

`M0 - 可验证产品骨架`

- 今日待跟进队列
- 追问理由与置信度展示
- 消息草稿编辑与确认记录
- 稍后处理、跳过与任务状态变化
- 机会搜索和手动添加
- 求职偏好、追问规则和记忆展示
- 工作日调度规则单元测试
- 桌面端和移动端浏览器冒烟测试

下一里程碑是 `M1 - 账户与服务端持久化`，详见 PRD。
