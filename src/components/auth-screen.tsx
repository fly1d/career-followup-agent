"use client";

import {
  ArrowRight,
  Check,
  LockKeyhole,
  MessageSquareText,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { authenticateAccount } from "@/lib/api-client";

type AuthMode = "login" | "register";

export function AuthScreen() {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>("login");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    const form = new FormData(event.currentTarget);

    try {
      await authenticateAccount(mode, {
        displayName:
          mode === "register" ? String(form.get("displayName") ?? "") : undefined,
        email: String(form.get("email") ?? ""),
        password: String(form.get("password") ?? ""),
      });
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "暂时无法登录，请稍后重试。");
    } finally {
      setSubmitting(false);
    }
  }

  function changeMode(nextMode: AuthMode) {
    setMode(nextMode);
    setError("");
  }

  return (
    <main className="auth-shell">
      <div className="auth-layout">
      <section className="auth-offer" aria-label="求职冲刺版服务">
        <header className="auth-brand auth-offer-brand">
          <span className="brand-mark" aria-hidden="true">
            <MessageSquareText size={19} strokeWidth={2.2} />
          </span>
          <span>
            <strong>求职跟进</strong>
            <small>智能追问工作台</small>
          </span>
        </header>
        <div className="auth-offer-content">
          <p className="eyebrow">首批 10 位用户</p>
          <h2>求职冲刺版</h2>
          <div className="auth-offer-price"><strong>¥99</strong><span>/ 30 天</span></div>
          <ul>
            <li><Check size={15} />智能生成岗位追问</li>
            <li><Check size={15} />人工复核关键消息</li>
            <li><Check size={15} />保存机会与追问记录</li>
          </ul>
          <p>先注册体验，再提交购买申请。人工确认收款后开通，不承诺面试或 Offer。</p>
        </div>
      </section>
      <section className="auth-workspace" aria-labelledby="auth-title">
        <header className="auth-brand">
          <span className="brand-mark" aria-hidden="true">
            <MessageSquareText size={19} strokeWidth={2.2} />
          </span>
          <span>
            <strong>求职跟进</strong>
            <small>智能追问工作台</small>
          </span>
        </header>

        <div className="auth-form-wrap">
          <div className="auth-heading">
            <span className="auth-lock" aria-hidden="true">
              <LockKeyhole size={19} />
            </span>
            <h1 id="auth-title">{mode === "login" ? "登录工作台" : "创建你的工作区"}</h1>
            <p>
              {mode === "login"
                ? "继续管理已保存的机会和追问计划。"
                : "注册后会创建只属于你的求职跟进空间。"}
            </p>
          </div>

          <div className="auth-segments" role="group" aria-label="账号操作">
            <button
              type="button"
              className={mode === "login" ? "active" : ""}
              aria-pressed={mode === "login"}
              onClick={() => changeMode("login")}
            >
              登录
            </button>
            <button
              type="button"
              className={mode === "register" ? "active" : ""}
              aria-pressed={mode === "register"}
              onClick={() => changeMode("register")}
            >
              注册
            </button>
          </div>

          <form className="auth-form" onSubmit={submit}>
            {mode === "register" && (
              <label>
                <span>姓名</span>
                <input
                  name="displayName"
                  autoComplete="name"
                  placeholder="如何称呼你"
                  minLength={1}
                  maxLength={80}
                  required
                  autoFocus
                />
              </label>
            )}
            <label>
              <span>邮箱</span>
              <input
                name="email"
                type="email"
                autoComplete="email"
                placeholder="name@example.com"
                maxLength={254}
                required
                autoFocus={mode === "login"}
              />
            </label>
            <label>
              <span>密码</span>
              <input
                name="password"
                type="password"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                placeholder={mode === "login" ? "输入密码" : "至少 10 位，包含字母和数字"}
                minLength={mode === "register" ? 10 : 1}
                maxLength={128}
                required
              />
            </label>

            <p className="auth-error" role="alert" aria-live="polite">
              {error}
            </p>

            <button type="submit" className="auth-submit" disabled={submitting}>
              <span>{submitting ? "正在处理" : mode === "login" ? "登录" : "创建工作区"}</span>
              <ArrowRight size={17} />
            </button>
          </form>
        </div>

        <footer className="auth-footer">会话仅保存在此浏览器，并可随时退出。</footer>
      </section>
      </div>
    </main>
  );
}
