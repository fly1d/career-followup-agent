"use client";

import {
  ArrowLeft,
  Check,
  CircleDollarSign,
  Clock3,
  ExternalLink,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import type { PilotOperationsSnapshot } from "@/domain/pilot";
import { confirmPilotPayment, type AccountUser } from "@/lib/api-client";

const funnelLabels: Array<[keyof PilotOperationsSnapshot["funnel"], string]> = [
  ["registered", "已注册"],
  ["onboarded", "完成目标"],
  ["firstOpportunityAdded", "首个机会"],
  ["firstFollowUpConfirmed", "确认追问"],
  ["purchaseRequested", "申请购买"],
  ["paymentConfirmed", "确认收款"],
];

function dateTime(iso: string | null) {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function PilotOperations({
  initialSnapshot,
  user,
}: {
  initialSnapshot: PilotOperationsSnapshot;
  user: AccountUser;
}) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  async function confirm(orderId: string) {
    if (!window.confirm("确认已经收到这位用户的 99 元付款？")) return;
    setBusyOrderId(orderId);
    setMessage("");
    try {
      setSnapshot(await confirmPilotPayment(orderId));
      setMessage("收款已确认，30 天权益已经生效。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "确认失败，请重试。");
    } finally {
      setBusyOrderId(null);
    }
  }

  return (
    <main className="operations-shell">
      <header className="operations-header">
        <div>
          <Link href="/" className="back-link">
            <ArrowLeft size={16} /> 返回工作台
          </Link>
          <p className="eyebrow">首批用户运营</p>
          <h1>求职冲刺版</h1>
          <p>确认实际收款后再开通权益。当前管理员：{user.email}</p>
        </div>
        <div className="operations-capacity">
          <span><Users size={16} /> 已确认名额</span>
          <strong>{snapshot.offer.confirmedCount} / {snapshot.offer.capacity}</strong>
          <small>剩余 {snapshot.offer.remainingCount} 个</small>
        </div>
      </header>

      <section className="funnel-band" aria-label="用户激活漏斗">
        {funnelLabels.map(([key, label]) => (
          <div key={key}>
            <span>{label}</span>
            <strong>{snapshot.funnel[key]}</strong>
          </div>
        ))}
      </section>

      <section className="operations-orders">
        <div className="operations-section-heading">
          <div>
            <h2>购买申请</h2>
            <p>联系方式仅在此管理员页面展示。</p>
          </div>
          <span>99 元 / 30 天</span>
        </div>
        {message && <p className="operations-message" role="status">{message}</p>}
        <div className="order-table">
          <div className="order-row order-row-heading" aria-hidden="true">
            <span>用户</span><span>联系方式</span><span>申请时间</span><span>状态</span><span>操作</span>
          </div>
          {snapshot.orders.map((order) => (
            <div className="order-row" key={order.id}>
              <div><strong>{order.user.displayName}</strong><small>{order.user.email}</small></div>
              <div><strong>{order.contactValue}</strong><small>{order.contactMethod}</small></div>
              <div><span>{dateTime(order.requestedAt)}</span>{order.note && <small>{order.note}</small>}</div>
              <div>
                <span className={`order-status ${order.status}`}>
                  {order.status === "pending_payment" ? <Clock3 size={14} /> : <Check size={14} />}
                  {order.status === "pending_payment" ? "待收款" : order.status === "active" ? "权益生效" : "已到期"}
                </span>
                {order.endsAt && <small>至 {dateTime(order.endsAt)}</small>}
              </div>
              <div>
                {order.status === "pending_payment" ? (
                  <button
                    type="button"
                    className="primary-button"
                    disabled={busyOrderId === order.id || snapshot.offer.remainingCount === 0}
                    onClick={() => void confirm(order.id)}
                  >
                    <CircleDollarSign size={16} />
                    {busyOrderId === order.id ? "确认中" : "确认收款"}
                  </button>
                ) : (
                  <span className="confirmed-by">{order.confirmedBy}</span>
                )}
              </div>
            </div>
          ))}
          {snapshot.orders.length === 0 && (
            <div className="operations-empty">
              <ExternalLink size={22} />
              <strong>还没有购买申请</strong>
              <p>用户在工作台提交联系方式后会出现在这里。</p>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
