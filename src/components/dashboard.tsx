"use client";

import {
  Archive,
  Bell,
  BriefcaseBusiness,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock3,
  FileText,
  LayoutDashboard,
  MapPin,
  Menu,
  MessageSquareText,
  MoreHorizontal,
  Plus,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createDemoData, type FollowUpTask, type Opportunity } from "@/data/demo";
import {
  createOpportunity,
  fetchWorkspace,
  mutateFollowUp,
  saveCandidateSettings,
  type NewOpportunityDraft,
} from "@/lib/api-client";
import {
  defaultCandidateSettings,
  type CandidateSettings,
} from "@/domain/settings";

type View = "today" | "opportunities" | "settings";
type QueueTab = "pending" | "scheduled";

const navigation: Array<{
  id: View;
  label: string;
  icon: typeof LayoutDashboard;
}> = [
  { id: "today", label: "今日", icon: LayoutDashboard },
  { id: "opportunities", label: "机会", icon: BriefcaseBusiness },
  { id: "settings", label: "设置", icon: Settings2 },
];

type ConnectionStatus = "connecting" | "connected" | "error";

function relativeDueLabel(task: FollowUpTask) {
  const due = new Date(task.dueAt);
  const now = new Date();
  const time = due.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  if (due.toDateString() === now.toDateString()) {
    return due.getTime() <= now.getTime() ? "现在应跟进" : `今天 ${time}`;
  }

  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (due.toDateString() === tomorrow.toDateString()) {
    return `明天 ${time}`;
  }

  return due.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}

function dateTimeLabel(iso?: string) {
  if (!iso) return "无需跟进";
  const date = new Date(iso);
  return date.toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function stageTone(stage: Opportunity["stage"]) {
  if (stage === "interview_completed" || stage === "interview_scheduled") {
    return "blue";
  }
  if (stage === "resume_viewed" || stage === "material_submitted") {
    return "amber";
  }
  return "neutral";
}

function todayDateLabel() {
  const parts = new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    weekday: "long",
  }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("month")} 月 ${value("day")} 日 · ${value("weekday")}`;
}

export function Dashboard() {
  const demoData = useMemo(() => createDemoData(), []);
  const [view, setView] = useState<View>("today");
  const [queueTab, setQueueTab] = useState<QueueTab>("pending");
  const [followUps, setFollowUps] = useState(demoData.followUps);
  const [opportunities, setOpportunities] = useState(demoData.opportunities);
  const [settings, setSettings] = useState(defaultCandidateSettings);
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("connecting");
  const [selectedTask, setSelectedTask] = useState<FollowUpTask | null>(null);
  const [draft, setDraft] = useState("");
  const [newOpportunityOpen, setNewOpportunityOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetchWorkspace()
      .then((snapshot) => {
        if (cancelled) return;
        setFollowUps(snapshot.followUps);
        setOpportunities(snapshot.opportunities);
        setSettings(snapshot.settings);
        setConnectionStatus("connected");
      })
      .catch(() => {
        if (cancelled) return;
        setConnectionStatus("error");
        setToast("服务器连接失败，当前显示演示数据");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(""), 3200);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const pendingCount = followUps.filter((task) => task.status === "pending").length;
  const scheduledCount = followUps.filter(
    (task) => task.status === "scheduled",
  ).length;
  const sentCount = followUps.filter((task) => task.status === "sent").length;

  const visibleTasks = followUps.filter((task) => task.status === queueTab);

  function openConfirmation(task: FollowUpTask) {
    setSelectedTask(task);
    setDraft(task.message);
  }

  async function confirmSend() {
    if (!selectedTask) return;
    setBusyTaskId(selectedTask.id);
    try {
      const { followUp } = await mutateFollowUp(selectedTask.id, {
        action: "mark_sent",
        message: draft,
      });
      setFollowUps((current) =>
        current.map((task) => (task.id === followUp.id ? followUp : task)),
      );
      setOpportunities((current) =>
        current.map((item) =>
          item.id === followUp.opportunityId
            ? { ...item, nextFollowUpAt: undefined }
            : item,
        ),
      );
      setSelectedTask(null);
      setToast("追问已保存到服务器");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "保存失败，请重试");
    } finally {
      setBusyTaskId(null);
    }
  }

  async function snoozeTask(task: FollowUpTask) {
    setBusyTaskId(task.id);
    try {
      const { followUp } = await mutateFollowUp(task.id, { action: "snooze" });
      setFollowUps((current) =>
        current.map((item) => (item.id === followUp.id ? followUp : item)),
      );
      setOpportunities((current) =>
        current.map((item) =>
          item.id === followUp.opportunityId
            ? { ...item, nextFollowUpAt: followUp.dueAt }
            : item,
        ),
      );
      setToast("已保存并安排到下一个工作日");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "保存失败，请重试");
    } finally {
      setBusyTaskId(null);
    }
  }

  async function skipTask(task: FollowUpTask) {
    setBusyTaskId(task.id);
    try {
      const { followUp } = await mutateFollowUp(task.id, { action: "skip" });
      setFollowUps((current) =>
        current.map((item) => (item.id === followUp.id ? followUp : item)),
      );
      setOpportunities((current) =>
        current.map((item) =>
          item.id === followUp.opportunityId
            ? { ...item, nextFollowUpAt: undefined }
            : item,
        ),
      );
      setToast("本次追问已跳过并保存");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "保存失败，请重试");
    } finally {
      setBusyTaskId(null);
    }
  }

  async function addOpportunity(input: NewOpportunityDraft) {
    try {
      const { opportunity, followUp } = await createOpportunity(input);
      setOpportunities((current) => [opportunity, ...current]);
      setFollowUps((current) => [...current, followUp]);
      setNewOpportunityOpen(false);
      setView("opportunities");
      setToast("机会和追问计划已保存到服务器");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "保存失败，请重试");
      throw error;
    }
  }

  async function persistSettings() {
    setSavingSettings(true);
    try {
      const result = await saveCandidateSettings(settings);
      setSettings(result.settings);
      setToast("设置已保存到服务器");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "设置保存失败");
    } finally {
      setSavingSettings(false);
    }
  }

  return (
    <div className="app-shell">
      <Sidebar
        currentView={view}
        pendingCount={pendingCount}
        connectionStatus={connectionStatus}
        targetCities={settings.targetCities}
        onNavigate={(next) => {
          setView(next);
          setMobileMenuOpen(false);
        }}
        mobileOpen={mobileMenuOpen}
      />

      <main className="main-area">
        <MobileHeader
          pendingCount={pendingCount}
          onMenu={() => setMobileMenuOpen((open) => !open)}
        />

        {view === "today" && (
          <TodayView
            tasks={visibleTasks}
            allTasks={followUps}
            queueTab={queueTab}
            pendingCount={pendingCount}
            scheduledCount={scheduledCount}
            sentCount={sentCount}
            opportunityCount={opportunities.length}
            connectionStatus={connectionStatus}
            busyTaskId={busyTaskId}
            onTabChange={setQueueTab}
            onConfirm={openConfirmation}
            onSnooze={snoozeTask}
            onSkip={skipTask}
            onAdd={() => setNewOpportunityOpen(true)}
          />
        )}

        {view === "opportunities" && (
          <OpportunitiesView
            opportunities={opportunities}
            searchQuery={searchQuery}
            onSearch={setSearchQuery}
            onAdd={() => setNewOpportunityOpen(true)}
          />
        )}

        {view === "settings" && (
          <SettingsView
            settings={settings}
            onChange={setSettings}
            onSaved={persistSettings}
            saving={savingSettings}
          />
        )}
      </main>

      <MobileNavigation currentView={view} onNavigate={setView} />

      {selectedTask && (
        <ConfirmationDialog
          task={selectedTask}
          draft={draft}
          onDraftChange={setDraft}
          onClose={() => setSelectedTask(null)}
          onConfirm={confirmSend}
          saving={busyTaskId === selectedTask.id}
        />
      )}

      {newOpportunityOpen && (
        <NewOpportunityDialog
          onClose={() => setNewOpportunityOpen(false)}
          onAdd={addOpportunity}
        />
      )}

      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          {toast}
        </div>
      )}
    </div>
  );
}

function Sidebar({
  currentView,
  pendingCount,
  connectionStatus,
  targetCities,
  onNavigate,
  mobileOpen,
}: {
  currentView: View;
  pendingCount: number;
  connectionStatus: ConnectionStatus;
  targetCities: string;
  onNavigate: (view: View) => void;
  mobileOpen: boolean;
}) {
  return (
    <aside className={`sidebar ${mobileOpen ? "mobile-open" : ""}`}>
      <div className="brand-lockup">
        <div className="brand-mark" aria-hidden="true">
          <MessageSquareText size={19} strokeWidth={2.2} />
        </div>
        <div>
          <strong>求职跟进</strong>
          <span>智能追问工作台</span>
        </div>
      </div>

      <nav className="sidebar-nav" aria-label="主要导航">
        {navigation.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              className={currentView === item.id ? "active" : ""}
              onClick={() => onNavigate(item.id)}
              aria-label={item.label}
            >
              <Icon size={18} />
              <span>{item.label}</span>
              {item.id === "today" && pendingCount > 0 && (
                <span className="nav-count">{pendingCount}</span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="sidebar-status">
        <div className="status-heading">
          <span className={`live-dot ${connectionStatus}`} />
          {connectionStatus === "connected"
            ? "本地服务端已连接"
            : connectionStatus === "error"
              ? "服务端连接异常"
              : "正在连接服务端"}
        </div>
        <p>{connectionStatus === "connected" ? "当前为单工作区预览" : "正在使用本地演示视图"}</p>
        <div className="status-rule">
          {connectionStatus === "error" ? <WifiOff size={15} /> : <Wifi size={15} />}
          发送前需要确认
        </div>
      </div>

      <button type="button" className="profile-button">
        <span className="profile-avatar">HZ</span>
        <span>
          <strong>我的求职计划</strong>
          <small>{targetCities.replaceAll("、", " · ")}</small>
        </span>
        <MoreHorizontal size={17} />
      </button>
    </aside>
  );
}

function MobileHeader({
  pendingCount,
  onMenu,
}: {
  pendingCount: number;
  onMenu: () => void;
}) {
  return (
    <header className="mobile-header">
      <button type="button" className="icon-button" onClick={onMenu} aria-label="打开菜单">
        <Menu size={21} />
      </button>
      <div className="mobile-brand">
        <MessageSquareText size={18} />
        <strong>求职跟进</strong>
      </div>
      <button type="button" className="icon-button notification-button" aria-label="通知">
        <Bell size={20} />
        {pendingCount > 0 && <span>{pendingCount}</span>}
      </button>
    </header>
  );
}

function MobileNavigation({
  currentView,
  onNavigate,
}: {
  currentView: View;
  onNavigate: (view: View) => void;
}) {
  return (
    <nav className="mobile-navigation" aria-label="移动导航">
      {navigation.map((item) => {
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            type="button"
            className={currentView === item.id ? "active" : ""}
            onClick={() => onNavigate(item.id)}
            aria-label={item.label}
          >
            <Icon size={20} />
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

function TodayView({
  tasks,
  allTasks,
  queueTab,
  pendingCount,
  scheduledCount,
  sentCount,
  opportunityCount,
  connectionStatus,
  busyTaskId,
  onTabChange,
  onConfirm,
  onSnooze,
  onSkip,
  onAdd,
}: {
  tasks: FollowUpTask[];
  allTasks: FollowUpTask[];
  queueTab: QueueTab;
  pendingCount: number;
  scheduledCount: number;
  sentCount: number;
  opportunityCount: number;
  connectionStatus: ConnectionStatus;
  busyTaskId: string | null;
  onTabChange: (tab: QueueTab) => void;
  onConfirm: (task: FollowUpTask) => void;
  onSnooze: (task: FollowUpTask) => void;
  onSkip: (task: FollowUpTask) => void;
  onAdd: () => void;
}) {
  return (
    <div className="page-content">
      <header className="page-header">
        <div>
          <p className="eyebrow" suppressHydrationWarning>{todayDateLabel()}</p>
          <h1>今日待跟进</h1>
          <p>
            已按对话承诺、求职阶段和工作时间排好优先级。
            <span className={`connection-label ${connectionStatus}`}>
              {connectionStatus === "connected"
                ? "本地服务端已同步"
                : connectionStatus === "error"
                  ? "服务器离线"
                  : "正在同步"}
            </span>
          </p>
        </div>
        <div className="header-actions">
          <button type="button" className="icon-button desktop-only" aria-label="通知">
            <Bell size={19} />
          </button>
          <button type="button" className="primary-button" onClick={onAdd}>
            <Plus size={17} />
            添加机会
          </button>
        </div>
      </header>

      <section className="metrics-band" aria-label="今日概览">
        <div>
          <span>等待确认</span>
          <strong>{pendingCount}</strong>
          <small>需要你决定</small>
        </div>
        <div>
          <span>已经安排</span>
          <strong>{scheduledCount}</strong>
          <small>按计划等待</small>
        </div>
        <div>
          <span>今日已完成</span>
          <strong>{sentCount}</strong>
          <small>已记录发送</small>
        </div>
        <div>
          <span>活跃机会</span>
          <strong>{opportunityCount}</strong>
          <small>覆盖 4 个阶段</small>
        </div>
      </section>

      <div className="dashboard-grid">
        <section className="queue-section">
          <div className="section-toolbar">
            <div className="segmented-control" aria-label="追问任务分类">
              <button
                type="button"
                className={queueTab === "pending" ? "active" : ""}
                onClick={() => onTabChange("pending")}
              >
                待确认 <span>{pendingCount}</span>
              </button>
              <button
                type="button"
                className={queueTab === "scheduled" ? "active" : ""}
                onClick={() => onTabChange("scheduled")}
              >
                已安排 <span>{scheduledCount}</span>
              </button>
            </div>
            <button type="button" className="quiet-button">
              按优先级
              <ChevronDown size={15} />
            </button>
          </div>

          <div className="task-list">
            {tasks.map((task) => (
              <FollowUpCard
                key={task.id}
                task={task}
                onConfirm={() => onConfirm(task)}
                onSnooze={() => onSnooze(task)}
                onSkip={() => onSkip(task)}
                busy={busyTaskId === task.id}
              />
            ))}
            {tasks.length === 0 && (
              <div className="empty-state">
                <CheckCircle2 size={28} />
                <strong>这里已经处理完了</strong>
                <p>新的追问任务会根据机会进展自动加入。</p>
              </div>
            )}
          </div>
        </section>

        <aside className="right-rail">
          <section className="schedule-panel">
            <div className="panel-heading">
              <div>
                <span>接下来</span>
                <strong>追问计划</strong>
              </div>
              <CalendarClock size={19} />
            </div>
            <div className="timeline">
              {allTasks
                .filter((task) => task.status !== "skipped")
                .slice(0, 4)
                .map((task, index) => (
                  <div className="timeline-item" key={task.id}>
                    <span className={index === 0 ? "current" : ""} />
                    <div>
                      <time>{relativeDueLabel(task)}</time>
                      <strong>{task.company}</strong>
                      <small>{task.role}</small>
                    </div>
                  </div>
                ))}
            </div>
          </section>

          <section className="insight-panel">
            <div className="insight-icon">
              <Sparkles size={18} />
            </div>
            <div>
              <strong>本周跟进节奏正常</strong>
              <p>没有机会超过两次主动追问，所有消息均避开夜间和周末。</p>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

function FollowUpCard({
  task,
  onConfirm,
  onSnooze,
  onSkip,
  busy,
}: {
  task: FollowUpTask;
  onConfirm: () => void;
  onSnooze: () => void;
  onSkip: () => void;
  busy: boolean;
}) {
  return (
    <article className={`follow-up-card ${task.status === "scheduled" ? "scheduled" : ""}`}>
      <div className="card-accent" />
      <header className="card-header">
        <div className="company-identity">
          <span className="company-mark">{task.companyMark}</span>
          <div>
            <div className="company-line">
              <strong>{task.company}</strong>
              <span>{task.role}</span>
            </div>
            <small>{task.recruiter} · {task.channel}</small>
          </div>
        </div>
        <div className="due-group">
          <span className={`due-badge ${task.status}`}>
            <Clock3 size={14} />
            {relativeDueLabel(task)}
          </span>
          <button type="button" className="icon-button subtle" onClick={onSkip} aria-label="跳过本次追问" title="跳过本次追问" disabled={busy}>
            <X size={17} />
          </button>
        </div>
      </header>

      <div className="reason-block">
        <div className="reason-title">
          <Sparkles size={15} />
          <strong>为什么现在跟进</strong>
          <span>{task.confidence}% 置信度</span>
        </div>
        <p>{task.reason}</p>
        <small>{task.context}</small>
      </div>

      <div className="draft-preview">
        <div className="draft-label">
          <MessageSquareText size={15} />
          建议消息
        </div>
        <p>{task.message}</p>
      </div>

      <footer className="card-actions">
        <button type="button" className="secondary-button" onClick={onSnooze} disabled={busy}>
          <CalendarClock size={16} />
          明天再处理
        </button>
        <button type="button" className="primary-button" onClick={onConfirm} disabled={busy}>
          <Send size={16} />
          确认发送
        </button>
      </footer>
    </article>
  );
}

function OpportunitiesView({
  opportunities,
  searchQuery,
  onSearch,
  onAdd,
}: {
  opportunities: Opportunity[];
  searchQuery: string;
  onSearch: (query: string) => void;
  onAdd: () => void;
}) {
  const filtered = opportunities.filter((item) =>
    `${item.company}${item.role}${item.location}`
      .toLowerCase()
      .includes(searchQuery.toLowerCase()),
  );

  return (
    <div className="page-content">
      <header className="page-header compact">
        <div>
          <p className="eyebrow">机会管道</p>
          <h1>求职机会</h1>
          <p>集中查看当前阶段、最后沟通与下一次跟进。</p>
        </div>
        <button type="button" className="primary-button" onClick={onAdd}>
          <Plus size={17} />
          添加机会
        </button>
      </header>

      <section className="opportunity-toolbar">
        <label className="search-field">
          <Search size={17} />
          <span className="sr-only">搜索机会</span>
          <input
            value={searchQuery}
            onChange={(event) => onSearch(event.target.value)}
            placeholder="搜索公司、岗位或城市"
          />
        </label>
        <div className="filter-pills">
          <button type="button" className="active">全部 {opportunities.length}</button>
          <button type="button">等待回复</button>
          <button type="button">面试中</button>
        </div>
      </section>

      <section className="opportunity-table" aria-label="求职机会列表">
        <div className="table-header">
          <span>公司与岗位</span>
          <span>当前阶段</span>
          <span>下一次跟进</span>
          <span>使用简历</span>
          <span />
        </div>
        {filtered.map((item) => (
          <article className="opportunity-row" key={item.id}>
            <div className="company-identity">
              <span className="company-mark small">{item.companyMark}</span>
              <div>
                <strong>{item.company}</strong>
                <small>{item.role} · {item.location} · {item.salary}</small>
              </div>
            </div>
            <div>
              <span className={`stage-badge ${stageTone(item.stage)}`}>{item.stageLabel}</span>
            </div>
            <div className="follow-up-cell">
              <strong>{dateTimeLabel(item.nextFollowUpAt)}</strong>
              <small>{item.nextFollowUpAt ? "发送前确认" : "等待面试"}</small>
            </div>
            <div className="resume-cell">
              <FileText size={16} />
              <span>{item.resume}</span>
            </div>
            <button type="button" className="icon-button subtle" aria-label={`查看${item.company}机会详情`}>
              <MoreHorizontal size={18} />
            </button>
          </article>
        ))}
        {filtered.length === 0 && (
          <div className="empty-state compact-empty">
            <Search size={25} />
            <strong>没有匹配的机会</strong>
            <p>换一个公司、岗位或城市关键词试试。</p>
          </div>
        )}
      </section>
    </div>
  );
}

function SettingsView({
  settings,
  onChange,
  onSaved,
  saving,
}: {
  settings: CandidateSettings;
  onChange: (settings: CandidateSettings) => void;
  onSaved: () => Promise<void>;
  saving: boolean;
}) {
  return (
    <div className="page-content settings-page">
      <header className="page-header compact">
        <div>
          <p className="eyebrow">求职记忆与规则</p>
          <h1>求职设置</h1>
          <p>这些信息决定智能体什么时候追问、如何表达和何时停下。</p>
        </div>
        <button
          type="button"
          className="primary-button"
          onClick={() => void onSaved()}
          disabled={saving}
        >
          <Check size={17} />
          {saving ? "正在保存" : "保存设置"}
        </button>
      </header>

      <section className="settings-section">
        <div className="settings-intro">
          <span className="settings-icon"><BriefcaseBusiness size={19} /></span>
          <div>
            <h2>求职目标</h2>
            <p>智能筛选和追问时使用的长期偏好。</p>
          </div>
        </div>
        <div className="settings-fields">
          <label>
            <span>目标岗位</span>
            <input
              value={settings.targetRoles}
              onChange={(event) =>
                onChange({ ...settings, targetRoles: event.target.value })
              }
            />
          </label>
          <label>
            <span>目标城市</span>
            <input
              value={settings.targetCities}
              onChange={(event) =>
                onChange({ ...settings, targetCities: event.target.value })
              }
            />
          </label>
          <label>
            <span>最低月薪</span>
            <div className="input-suffix">
              <input
                type="number"
                min="0"
                max="1000"
                value={settings.minimumMonthlySalary}
                onChange={(event) =>
                  onChange({
                    ...settings,
                    minimumMonthlySalary: Number(event.target.value),
                  })
                }
              />
              <span>K</span>
            </div>
          </label>
          <label>
            <span>不考虑</span>
            <input
              value={settings.exclusions}
              onChange={(event) =>
                onChange({ ...settings, exclusions: event.target.value })
              }
            />
          </label>
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-intro">
          <span className="settings-icon amber"><MessageSquareText size={19} /></span>
          <div>
            <h2>追问规则</h2>
            <p>所有自动行为都有明确边界，并保留操作记录。</p>
          </div>
        </div>
        <div className="rule-list">
          <div className="rule-row">
            <div>
              <strong>发送前需要确认</strong>
              <p>智能体写好消息后，由你确认或修改。</p>
            </div>
            <button
              type="button"
              className={`switch ${settings.confirmBeforeSend ? "on" : ""}`}
              role="switch"
              aria-checked={settings.confirmBeforeSend}
              aria-label="发送前需要确认"
              onClick={() =>
                onChange({
                  ...settings,
                  confirmBeforeSend: !settings.confirmBeforeSend,
                })
              }
            >
              <span />
            </button>
          </div>
          <div className="rule-row">
            <div>
              <strong>避开周末与夜间</strong>
              <p>只在工作日 09:30 至 18:30 之间安排消息。</p>
            </div>
            <button
              type="button"
              className={`switch ${settings.avoidWeekends ? "on" : ""}`}
              role="switch"
              aria-checked={settings.avoidWeekends}
              aria-label="避开周末与夜间"
              onClick={() =>
                onChange({
                  ...settings,
                  avoidWeekends: !settings.avoidWeekends,
                })
              }
            >
              <span />
            </button>
          </div>
          <div className="rule-row select-rule">
            <div>
              <strong>单个机会最多主动追问</strong>
              <p>达到次数后自动停止，不形成循环打扰。</p>
            </div>
            <select
              value={settings.maxFollowUps}
              aria-label="单个机会最多主动追问次数"
              onChange={(event) =>
                onChange({ ...settings, maxFollowUps: Number(event.target.value) })
              }
            >
              <option value="1">1 次</option>
              <option value="2">2 次</option>
              <option value="3">3 次</option>
            </select>
          </div>
        </div>
      </section>

      <section className="settings-section memory-section">
        <div className="settings-intro">
          <span className="settings-icon blue"><Archive size={19} /></span>
          <div>
            <h2>智能体记忆</h2>
            <p>信息按作用范围保存，单个机会的决定不会覆盖全局偏好。</p>
          </div>
        </div>
        <div className="memory-items">
          <div><span>长期事实</span><strong>最早到岗：2026 年 9 月 15 日</strong><small>用户确认 · 今天更新</small></div>
          <div><span>沟通偏好</span><strong>不主动透露当前薪资</strong><small>适用于所有机会</small></div>
          <div><span>单次决定</span><strong>澄屿科技：可接受三天到岗</strong><small>仅适用于该机会</small></div>
        </div>
      </section>
    </div>
  );
}

function ConfirmationDialog({
  task,
  draft,
  onDraftChange,
  onClose,
  onConfirm,
  saving,
}: {
  task: FollowUpTask;
  draft: string;
  onDraftChange: (draft: string) => void;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  saving: boolean;
}) {
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label="确认追问内容"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="dialog-header">
          <div>
            <span className="dialog-icon"><Send size={18} /></span>
            <div>
              <h2>确认追问内容</h2>
              <p>{task.company} · {task.role}</p>
            </div>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="关闭">
            <X size={19} />
          </button>
        </header>
        <div className="dialog-body">
          <div className="recipient-line">
            <span>发送给</span>
            <strong>{task.recruiter}</strong>
            <small>{task.channel}</small>
          </div>
          <label className="message-editor">
            <span>消息内容</span>
            <textarea
              value={draft}
              onChange={(event) => onDraftChange(event.target.value)}
              rows={7}
            />
            <small>{draft.length} 字 · 发送后会写入机会时间线</small>
          </label>
          <div className="safety-note">
            <ShieldCheck size={17} />
            <span>已检查：未发现未经确认的薪资、到岗时间或个人经历。</span>
          </div>
        </div>
        <footer className="dialog-actions">
          <button type="button" className="secondary-button" onClick={onClose} disabled={saving}>取消</button>
          <button
            type="button"
            className="primary-button"
            onClick={() => void onConfirm()}
            disabled={!draft.trim() || saving}
          >
            <Send size={16} />
            {saving ? "正在保存" : "确认并记录发送"}
          </button>
        </footer>
      </section>
    </div>
  );
}

function NewOpportunityDialog({
  onClose,
  onAdd,
}: {
  onClose: () => void;
  onAdd: (opportunity: NewOpportunityDraft) => Promise<void>;
}) {
  const [company, setCompany] = useState("");
  const [role, setRole] = useState("");
  const [location, setLocation] = useState("上海");
  const [salary, setSalary] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!company.trim() || !role.trim()) return;
    setSubmitting(true);
    try {
      await onAdd({
        company: company.trim(),
        role: role.trim(),
        location: location.trim() || "待确认",
        salary: salary.trim() || "待确认",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <form
        className="dialog opportunity-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="添加求职机会"
        onSubmit={submit}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="dialog-header">
          <div>
            <span className="dialog-icon"><BriefcaseBusiness size={18} /></span>
            <div>
              <h2>添加求职机会</h2>
              <p>先记录必要信息，追问计划稍后自动生成。</p>
            </div>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="关闭">
            <X size={19} />
          </button>
        </header>
        <div className="dialog-body form-grid">
          <label>
            <span>公司名称</span>
            <input value={company} onChange={(event) => setCompany(event.target.value)} placeholder="例如：澄屿科技" autoFocus />
          </label>
          <label>
            <span>岗位名称</span>
            <input value={role} onChange={(event) => setRole(event.target.value)} placeholder="例如：高级产品经理" />
          </label>
          <label>
            <span>工作城市</span>
            <div className="field-with-icon">
              <MapPin size={16} />
              <input value={location} onChange={(event) => setLocation(event.target.value)} />
            </div>
          </label>
          <label>
            <span>薪资范围</span>
            <input value={salary} onChange={(event) => setSalary(event.target.value)} placeholder="例如：30-45K" />
          </label>
        </div>
        <footer className="dialog-actions">
          <button type="button" className="secondary-button" onClick={onClose} disabled={submitting}>取消</button>
          <button type="submit" className="primary-button" disabled={!company.trim() || !role.trim() || submitting}>
            <Plus size={16} />
            {submitting ? "正在保存" : "加入跟进列表"}
          </button>
        </footer>
      </form>
    </div>
  );
}
