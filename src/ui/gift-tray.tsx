"use client";

/**
 * 文件名称：gift-tray.tsx
 * 功能描述：桌面 + 物品栏 UI 组件（供 /gifts 页使用）
 * 所属模块：ui
 * 验收对齐：
 *   - docs/dev-stage-plan.md §3 阶段 4 UI（桌上物品展示、物品栏、赠送交互）
 *
 * 组件：
 *   - GiftTray：整个"桌上"视图（未送出物品卡片 + 送赠按钮 + 储物罐入口）
 *   - InventoryCard：单件物品卡片（点击 = 送赠）
 *   - EmptyState：物品栏为空时的引导文案（文案禁「打卡/签到」）
 *   - StorageShelf：储物罐（已送出的物品）
 */

import type { Inventory, Item } from "@/domain/types";

export interface GiftTrayProps {
  petName: string;
  unoffered: Inventory[];
  itemsCatalog: Map<string, Item>;
  storageCount: number;
  offeredToday: boolean;
  onOffer: (inventoryId: string) => void;
  offerDisabled?: boolean;
  offerLoading?: boolean;
  offerMessage?: string | null;
  /** 素材包 guidance.desk_hint（pre-launch：空态引导） */
  deskHint?: string | null;
}

/**
 * 桌面 + 物品栏（未送出物品）。
 */
export function GiftTray({
  petName,
  unoffered,
  itemsCatalog,
  storageCount,
  offeredToday,
  onOffer,
  offerDisabled = false,
  offerLoading = false,
  offerMessage = null,
  deskHint = null,
}: GiftTrayProps) {
  const showTable = unoffered.length > 0;

  return (
    <div className="space-y-4">
      {showTable ? (
        <section
          className="rounded-lg p-4 space-y-3"
          style={{
            background: "var(--pack-paper)",
            border: "1px solid var(--pack-accent)",
          }}
        >
          <header className="flex items-center justify-between">
            <h2
              className="text-sm font-semibold uppercase tracking-wider"
              style={{ color: "var(--muted)" }}
            >
              桌上（{unoffered.length} 件）
            </h2>
            <span className="text-xs" style={{ color: "var(--muted)" }}>
              {offeredToday
                ? `今天已经送给 ${petName} 一件礼物了`
                : `把物品放到桌上 · 送给 ${petName}`}
            </span>
          </header>

          {offerMessage && (
            <div
              className="text-sm p-2 rounded"
              style={{
                background: "var(--pack-memory-ref, #f0e6d2)",
                color: "var(--pack-ink)",
              }}
            >
              {offerMessage}
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
            {unoffered.map((inv) => (
              <InventoryCard
                key={inv.id}
                inventory={inv}
                item={itemsCatalog.get(inv.itemId)}
                disabled={offerDisabled || offeredToday || offerLoading}
                petName={petName}
                onOffer={() => onOffer(inv.id)}
              />
            ))}
          </div>
        </section>
      ) : (
        <EmptyState petName={petName} storageCount={storageCount} deskHint={deskHint} />
      )}
    </div>
  );
}

/**
 * 单件物品卡片。
 */
function InventoryCard({
  inventory,
  item,
  disabled,
  petName,
  onOffer,
}: {
  inventory: Inventory;
  item: Item | undefined;
  disabled: boolean;
  petName: string;
  onOffer: () => void;
}) {
  const name = item?.displayName ?? inventory.itemId;
  const desc = item?.description ?? "";
  const acquiredAt = new Date(inventory.acquiredAt);
  const dateStr = acquiredAt.toLocaleDateString("zh-CN", {
    month: "short",
    day: "numeric",
  });

  return (
    <button
      onClick={onOffer}
      disabled={disabled}
      aria-label={`把 ${name} 送给 ${petName}`}
      className="rounded-lg p-3 text-left space-y-1 hover:opacity-95"
      style={{
        background: "var(--pack-paper)",
        border: "1px solid var(--pack-accent)",
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "opacity 120ms ease",
      }}
    >
      <div
        className="flex items-center justify-between"
        aria-hidden
        style={{ height: 48, marginBottom: 4 }}
      >
        <span
          className="text-2xl"
          style={{ color: "var(--pack-primary)" }}
        >
          ✿
        </span>
        <span className="text-xs" style={{ color: "var(--muted)" }}>
          {dateStr}
        </span>
      </div>
      <div
        className="text-sm font-semibold"
        style={{ color: "var(--pack-ink)" }}
      >
        {name}
      </div>
      {desc && (
        <div className="text-xs leading-tight" style={{ color: "var(--muted)" }}>
          {desc}
        </div>
      )}
      <div className="text-xs" style={{ color: "var(--pack-primary)" }}>
        {disabled ? "—" : `送给 ${petName} →`}
      </div>
    </button>
  );
}

/**
 * 空态：物品栏为空时的引导（文案禁止「打卡/签到」）。
 */
function EmptyState({
  petName,
  storageCount,
  deskHint,
}: {
  petName: string;
  storageCount: number;
  deskHint?: string | null;
}) {
  return (
    <section
      className="rounded-lg p-6 text-center space-y-2"
      style={{
        background: "var(--pack-paper)",
        border: "1px dashed var(--pack-accent)",
      }}
    >
      <div aria-hidden className="text-3xl" style={{ color: "var(--pack-primary)" }}>
        ˚ ࡇ ˚
      </div>
      {deskHint && (
        <p
          className="text-sm leading-relaxed"
          style={{ color: "var(--pack-ink)" }}
        >
          {deskHint}
        </p>
      )}
      <p
        className="text-sm leading-relaxed"
        style={{ color: "var(--muted)" }}
      >
        每天第一次登录时，系统会从物品池里送你一件小东西——
        不用赶，错过也不惩罚。
      </p>
      <p className="text-xs" style={{ color: "var(--muted)" }}>
        {petName} 收过 {storageCount} 件东西（储物罐）。
      </p>
    </section>
  );
}
