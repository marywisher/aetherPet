/**
 * 文件名称：exporter.test.ts
 * 功能描述：导出器单测（阶段 6）
 * 所属模块：tests/unit/domain/export
 * 说明：
 *   - 通过 vi.mock 隔离 repo/sql 层（与 persistence 测试同套路）
 *   - 覆盖：校验和计算/剥离、导出组装（payload 结构、排除项）、非法输入
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFindUser = vi.fn();
const mockFindPets = vi.fn();
const mockFindMemories = vi.fn();
const mockFindEvents = vi.fn();
const mockFindInventory = vi.fn();
const mockFindItems = vi.fn();
const mockSqlQuery = vi.fn();
const mockSqlQueryOne = vi.fn();

vi.mock("@/domain/persistence/repos/users.repo", () => ({
  findById: (...a: unknown[]) => mockFindUser(...a),
}));
vi.mock("@/domain/persistence/repos/pets.repo", () => ({
  findByUserId: (...a: unknown[]) => mockFindPets(...a),
}));
vi.mock("@/domain/persistence/repos/memories.repo", () => ({
  findByPetId: (...a: unknown[]) => mockFindMemories(...a),
}));
vi.mock("@/domain/persistence/repos/events.repo", () => ({
  findByPetId: (...a: unknown[]) => mockFindEvents(...a),
}));
vi.mock("@/domain/persistence/repos/inventory.repo", () => ({
  findAllByUser: (...a: unknown[]) => mockFindInventory(...a),
}));
vi.mock("@/domain/persistence/repos/items.repo", () => ({
  findBySlugs: (...a: unknown[]) => mockFindItems(...a),
}));
vi.mock("@/domain/persistence/db", () => ({
  getPool: () => ({}),
}));
vi.mock("@/domain/persistence/sql", () => ({
  query: (...a: unknown[]) => mockSqlQuery(...a),
  queryOne: (...a: unknown[]) => mockSqlQueryOne(...a),
  execute: vi.fn(),
  connQuery: vi.fn(),
  connQueryOne: vi.fn(),
  connExecute: vi.fn(),
}));

import { canonicalJson, computeChecksum, extractChecksumHex, buildExport } from "@/domain/export/exporter";
import { EXPORT_SCHEMA_VERSION, type ExportPayload } from "@/domain/export/schema";

beforeEach(() => {
  vi.resetAllMocks();
  process.env.HUB_ID = "test-hub";
});

const PET = {
  id: "pet-1",
  userId: "user-1",
  name: "团子",
  state: "at_home",
  stateSince: 1700000000000,
  createdAt: 1699999999000,
  updatedAt: 1700000001000,
  lastActivityTs: 1700000000000,
  userLastActiveTs: 1700000000000,
  nextProactiveTs: null,
  dailyGrantLastDate: "2026-09-09",
  offerLastDate: null,
  replyPending: true,
  replyDueAt: 1700000000000 + 86_400_000,
  lastReplyAt: null,
  activePackName: "default",
  walletRef: null,
  schemaVersion: "1.0.0",
  hubId: "local",
};

const USER = {
  id: "user-1",
  emailHash: "abc123hash",
  emailPlainEnc: null,
  emailVerifiedAt: 1699999999000,
  createdAt: 1699999999000,
  updatedAt: 1699999999000,
  lastBackupHash: null,
  importedFromHub: null,
  importedAt: null,
  schemaVersion: "1.0.0",
  hubId: "local",
};

function samplePayload(): ExportPayload {
  const claim: ExportPayload = {
    meta: { schema_version: EXPORT_SCHEMA_VERSION, exported_at: 1700000000000, exported_from: "local", checksum: "x", engine_version: "1.0.0", pack_schema_version: "1.0.0" },
    user: { email_hash: "abc123hash", created_at: 1699999999000, last_backup_hash: null },
    pet: {
      base: { id: "pet-1", name: "团子", state: "at_home", state_since: 1700000000000, created_at: 1699999999000, last_activity_ts: 1700000000000, user_last_active_ts: 1700000000000, next_proactive_ts: null, daily_grant_last_date: "2026-09-09", offer_last_date: null, reply_pending: true, reply_due_at: 1700000000000 + 86_400_000, last_reply_at: null, active_pack_name: "default" },
      memories: [{ id: "m1", kind: "naming", value: "团子", created_at: 1699999999000, last_referenced: null, weight: 1, is_permanent: true }],
      events: [{ id: "e1", pet_id: "pet-1", type: "self_talk", ts: 1700000000000, fsm_state: "at_home", params: {}, engine_version: "1.0.0", pack_schema_version: "1.0.0", source: "engine", memory_refs: [], is_aggregate: false, aggregate_span_days: null, generated_by_catchup: false, created_at: 1700000000000 }],
      inventory: [{ id: "i1", item_id: "berry", acquired_at: 1700000000000, acquired_via: "daily_grant", granted_event_id: null, offered_at: null, offered_event_id: null, consumed_at: null, consumed_event_id: null }],
      items_catalog: [{ id: "berry", display_name: "浆果", description: null, icon_path: "images/berry.svg", rarity_weight: 5, category: "food" }],
      pending_reply: { reply_pending: true, reply_due_at: 1700000000000 + 86_400_000, last_reply_at: null },
    },
    settings: { active_pack_name: "default", timezone: "Asia/Shanghai" },
    announcements_unread: [],
  };
  return claim;
}

describe("canonicalJson / computeChecksum / extractChecksumHex", () => {
  it("canonicalJson 不含 meta.checksum 字段", () => {
    const p = samplePayload();
    const json = canonicalJson(p);
    expect(json).not.toContain('"checksum"');
    expect(JSON.parse(json).meta.schema_version).toBe(EXPORT_SCHEMA_VERSION);
  });

  it("computeChecksum 产出 SHA256:<64hex> 且可复现", () => {
    const p = samplePayload();
    const c1 = computeChecksum(p);
    const c2 = computeChecksum(samplePayload());
    expect(c1).toMatch(/^SHA256:[0-9a-f]{64}$/);
    expect(c1).toBe(c2);
  });

  it("修改任意数据 → 校验和变化（防篡改）", () => {
    const p = samplePayload();
    const before = computeChecksum(p);
    p.pet.base.name = "被篡改";
    const after = computeChecksum(p);
    expect(after).not.toBe(before);
  });

  it("extractChecksumHex 提取 hex；非法输入返回 null", () => {
    expect(extractChecksumHex("SHA256:" + "a".repeat(64))).toBe("a".repeat(64));
    expect(extractChecksumHex("SHA256:zzz")).toBeNull();
    expect(extractChecksumHex("MD5:abc")).toBeNull();
  });
});

describe("buildExport", () => {
  it("组装完整 payload：事件分页、物品去重、未读公告含内容快照", async () => {
    mockFindUser.mockResolvedValue(USER);
    mockFindPets.mockResolvedValue([PET]);
    mockFindMemories.mockResolvedValue([
      { id: "m1", petId: "pet-1", kind: "naming", value: "团子", createdAt: 1699999999000, lastReferenced: null, weight: 1, isPermanent: true, schemaVersion: "1.0.0", hubId: "local" },
    ]);
    // 两页事件（模拟分页）
    mockFindEvents
      .mockResolvedValueOnce([makeEvent("e1")])
      .mockResolvedValueOnce([]);
    mockFindInventory.mockResolvedValue([
      { id: "i1", userId: "user-1", petId: "pet-1", itemId: "berry", acquiredAt: 1700000000000, acquiredVia: "daily_grant", grantedEventId: null, offeredAt: null, offeredEventId: null, consumedAt: null, consumedEventId: null, purchasedAt: null, paidCents: null, schemaVersion: "1.0.0", hubId: "local" },
      { id: "i2", userId: "user-1", petId: "pet-1", itemId: "berry", acquiredAt: 1700000000001, acquiredVia: "brought_back", grantedEventId: null, offeredAt: null, offeredEventId: null, consumedAt: null, consumedEventId: null, purchasedAt: null, paidCents: null, schemaVersion: "1.0.0", hubId: "local" },
    ]);
    mockFindItems.mockResolvedValue(
      new Map([["berry", { id: "berry", displayName: "浆果", description: null, iconPath: "images/berry.svg", rarityWeight: 5, category: "food", basePriceCents: null, currencyCode: null, schemaVersion: "1.0.0", hubId: "local" }]])
    );
    mockSqlQuery.mockResolvedValue([
      { id: "ann-1", title: "迁移通知", body: "我们要搬家啦", level: "important", published_at: 1700000000000, expires_at: null },
    ]);
    mockSqlQueryOne.mockResolvedValue({ timezone: "Asia/Shanghai" });

    const { payload, checksumHex } = await buildExport("user-1", 1700000000000);

    expect(payload.meta.schema_version).toBe(EXPORT_SCHEMA_VERSION);
    expect(payload.meta.exported_at).toBe(1700000000000);
    expect(payload.meta.exported_from).toBe("test-hub");
    expect(payload.meta.checksum).toMatch(/^SHA256:[0-9a-f]{64}$/);
    expect(checksumHex).toMatch(/^[0-9a-f]{64}$/);

    // 排除项：无 email_plain_enc / token / 验证码
    expect(payload.user).not.toHaveProperty("email_plain_enc");
    expect(JSON.stringify(payload)).not.toContain("email_plain_enc");

    // 物品目录去重（两个 berry 只出一个）
    expect(payload.pet.items_catalog).toHaveLength(1);
    expect(payload.pet.items_catalog[0].display_name).toBe("浆果");
    // 事件 1 条 + 分页第二页为空
    expect(payload.pet.events).toHaveLength(1);
    // 未读公告快照
    expect(payload.announcements_unread).toHaveLength(1);
    expect(payload.announcements_unread[0].title).toBe("迁移通知");
    // settings
    expect(payload.settings.timezone).toBe("Asia/Shanghai");
    // pending_reply
    expect(payload.pet.pending_reply.reply_pending).toBe(true);
  });

  it("无 pet → 抛 ExportError", async () => {
    mockFindUser.mockResolvedValue(USER);
    mockFindPets.mockResolvedValue([]);
    await expect(buildExport("user-1")).rejects.toThrow("还没有 pet");
  });

  it("分页：短页即停止拉取（页长度 < PAGE_SIZE 视为末尾）", async () => {
    mockFindUser.mockResolvedValue(USER);
    mockFindPets.mockResolvedValue([PET]);
    mockFindMemories.mockResolvedValue([]);
    mockFindInventory.mockResolvedValue([]);
    mockFindItems.mockResolvedValue(new Map());
    mockSqlQuery.mockResolvedValue([]);
    mockSqlQueryOne.mockResolvedValue(null);
    mockFindEvents.mockResolvedValueOnce([makeEvent("e1"), makeEvent("e2")]);

    const { payload } = await buildExport("user-1", 1700000000000);
    expect(payload.pet.events.map((e) => e.id)).toEqual(["e1", "e2"]);
    expect(mockFindEvents).toHaveBeenCalledTimes(1);
  });
});

function makeEvent(id: string) {
  return {
    id,
    petId: "pet-1",
    userId: "user-1",
    type: "self_talk",
    ts: 1700000000000,
    fsmState: "at_home",
    params: {},
    engineVersion: "1.0.0",
    packSchemaVersion: "1.0.0",
    source: "engine",
    memoryRefs: [],
    isAggregate: false,
    aggregateSpanDays: null,
    generatedByCatchup: false,
    schemaVersion: "1.0.0",
    hubId: "local",
    createdAt: 1700000000000,
  };
}