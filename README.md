# 求职跟进智能体

面向求职者的机会跟进工作台。系统根据招聘阶段、对话承诺、工作时间和历史追问次数，生成下一次追问计划与消息草稿，并默认由用户确认后发送。

当前仓库包含可交互的产品骨架、独立调度领域模块、账号认证、SQLite/PostgreSQL 持久化、自动化测试和 GitHub CI。每个账号拥有隔离的工作区；真实消息渠道属于后续阶段。

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

未配置数据库连接时，首次请求会创建 `.data/followup.db`。注册账号后，系统会为该账号创建独立工作区和一套示例机会。可以在 `.env.local` 中修改 SQLite 路径：

```bash
DATABASE_PATH=/absolute/path/to/followup.db
```

设置 `DATABASE_URL` 后会优先使用 PostgreSQL，并在启动时自动执行版本化迁移：

```bash
DATABASE_URL=postgresql://user:password@localhost:5432/career_followup
```

托管数据库应在连接字符串中使用供应商要求的验证模式和 CA 配置，不要关闭证书校验。密码使用 scrypt 加盐哈希；登录状态使用 30 天有效的随机会话令牌，Cookie 设置为 HttpOnly、SameSite=Lax，并在生产模式下启用 Secure。

当前版本尚未完成速率限制、邮箱验证、密码找回和数据删除，因此仍只用于受控开发环境，不要直接暴露到公网或录入真实求职者资料。

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

`M1B - 账号认证与工作区隔离`

- 今日待跟进队列
- 追问理由与置信度展示
- 消息草稿编辑与确认记录
- 稍后处理、跳过与任务状态变化
- 机会搜索和手动添加
- 求职偏好、追问规则和记忆展示
- 机会、追问和设置服务端 API
- SQLite 迁移、工作区隔离和审计事件
- 注册、登录、退出和会话持久化
- scrypt 密码哈希与数据库会话撤销
- 所有业务 API 的服务端鉴权
- 每个账号独立的示例工作区
- 跨账号访问隔离冒烟测试
- 幂等的追问完成记录
- 工作日调度规则单元测试
- 桌面端和移动端持久化冒烟测试

`M1C` 的 PostgreSQL 适配器已经完成；下一增量是账户滥用防护与数据生命周期，详见 PRD。
