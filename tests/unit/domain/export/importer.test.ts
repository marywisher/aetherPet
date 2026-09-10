/**
 * 文件名称：importer.test.ts
 * 功能描述：导入器单测（阶段 6）
 * 所属模块：tests/unit/domain/export
 * 说明：
 *   - 纯校验函数（parse/version/checksum/fields）直接单测
 *   - importPayloadInTx 用假 conn + mock repo 验证：清空顺序、hub/schema 改写、摘要、错误上抛
 *   - 三类错误文案互不相同（验收 #7 硬要求）
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockConnExecute = vi.fn();
const mockConnQueryOne = vi.fn();
const mockInsertMemory = vi.fn();
const mockInsertInventory = vi.fn();
const mockInsertEvent = vi.fn();
const mockInsertItemIgnore = vi.fn();

vi.mock("@/domain/persistence/sql", () => ({
  connExecute: (...a: unknown[]) => mockConnExecute(...a),
  connQueryOne: (...a: unknown[]) => mockConnQueryOne(...a),
  connQuery: vi.fn(() => []),
}));
vi.mock("@/domain/persistence/repos/memories.repo", () => ({
  insert: (...a: unknown[]) => mockInsertMemory(...a),
}));
vi.mock("@/domain/persistence/repos/inventory.repo", () => ({
  insert: (...a: unknown[]) => mockInsertInventory(...a),
}));
vi.mock("@/domain/persistence/repos/events.repo", () => ({
  insert: (...a: unknown[]) => mockInsertEvent(...a),
}));
vi.mock("@/domain/persistence/repos/items.repo", () => ({
  insertIgnore: (...a: unknown[]) => mockInsertItemIgnore(...a),
}));

import {
  parseImportBody,
  validateVersion,
  validateChecksum,
  validateFields,
  validateImportPayload,
  importPayloadInTx,
} from "@/domain/export/importer";
import { canonicalJson, computeChecksum } from "@/domain/export/exporter";
import { EXPORT_SCHEMA_VERSION } from "@/domain/export/schema";

const FAKE_CONN = {} as never;

function validPayload() {
  return {
    meta: { schema_version: EXPORT_SCHEMA_VERSION, exported_at: 1700000000000, exported_from: "local", checksum: "", engine_version: "1.0.0", pack_schema_version: "1.0.0" },
    user: { email_hash: "hash1", created_at: 1699999999000, last_backup_hash: null },
    pet: {
      base: { id: "pet-1", name: "团子", state: "at_home" as const, state_since: 1700000000000, created_at: 1699999999000, last_activity_ts: 1700000000000, user_last_active_ts: 1700000000000, next_proactive_ts: null, daily_grant_last_date: null, offer_last_date: null, reply_pending: false, reply_due_at: null, last_reply_at: null, active_pack_name: "default" },
      memories: [],
      events: [],
      inventory: [],
      items_catalog: [],
      pending_reply: { reply_pending: false, reply_due_at: null, last_reply_at: null },
    },
    settings: { active_pack_name: "default", timezone: "Asia/Shanghai" },
    announcements_unread: [],
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  process.env.HUB_ID = "test-hub";
  process.env.DEFAULT_PACK = "default";
});

describe("parseImportBody", () => {
  it("合法 JSON 对象 → ok", () => {
    const r = parseImportBody(JSON.stringify(validPayload()));
    expect(r.ok).toBe(true);
  });
  it("非法 JSON → ERR_NOT_JSON", () => {
    const r = parseImportBody("{oops");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("ERR_NOT_JSON");
  });
  it("JSON 数组 → 字段缺失", () => {
    const r = parseImportBody("[1,2]");
    expect(!r.ok && r.error.kind).toBe("ERR_FIELD_MISSING");
  });
});

describe("validateVersion", () => {
  it("1.0.0 → ok", () => {
    expect(validateVersion(validPayload()).ok).toBe(true);
  });
  it("2.0.0 → ERR_VERSION_MISMATCH（文案含版本说明）", () => {
    const p = validPayload() as any;
    p.meta.schema_version = "2.0.0";
    const r = validateVersion(p);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("ERR_VERSION_MISMATCH");
      expect(r.error.message).toContain("版本不匹配");
    }
  });
});

describe("validateChecksum", () => {
  it("校验和一致 → ok", () => {
    const p = validPayload() as any;
    p.meta.checksum = computeChecksum(p);
    expect(validateChecksum(p).ok).toBe(true);
  });
  it("篡改内容 → ERR_CHECKSUM_MISMATCH（文案区别于版本错误）", () => {
    const p = validPayload() as any;
    p.meta.checksum = computeChecksum(p);
    p.pet.base.name = "被篡改的名字";
    const r = validateChecksum(p);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("ERR_CHECKSUM_MISMATCH");
      expect(r.error.message).toContain("校验和");
      expect(r.error.message).not.toContain("版本不匹配"); // 三类文案互不相同
    }
  });
  it("missing checksum → ERR_CHECKSUM_MISMATCH", () => {
    const p = validPayload() as any;
    delete p.meta.checksum;
    const r = validateChecksum(p);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("ERR_CHECKSUM_MISMATCH");
  });
});

describe("validateFields", () => {
  it("全部字段齐备 → ok", () => {
    expect(validateFields(validPayload() as any).ok).toBe(true);
  });
  it("缺 pet.base.name → ERR_FIELD_MISSING（带字段路径）", () => {
    const p = validPayload() as any;
    delete p.pet.base.name;
    const r = validateFields(p);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("ERR_FIELD_MISSING");
      expect(r.error.detail).toContain("pet.base.name");
    }
  });
  it("缺 announcements_unread → ERR_FIELD_MISSING", () => {
    const p = validPayload() as any;
    delete p.announcements_unread;
    const r = validateFields(p);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.detail).toContain("announcements_unread");
  });
  it("非法的 state 值 → ERR_FIELD_MISSING", () => {
    const p = validPayload() as any;
    p.pet.base.state = "flying";
    const r = validateFields(p);
    expect(r.ok).toBe(false);
  });
});

describe("validateImportPayload（链路）", () => {
  it("版本优先于校验和（先报版本错）", () => {
    const p = validPayload() as any;
    p.meta.schema_version = "9.9.9";
    p.pet.base.name = "改";
    const r = validateImportPayload(p);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("ERR_VERSION_MISMATCH");
  });
  it("完整合法 payload → ok（往返：computeChecksum 后校验通过）", () => {
    const p = validPayload() as any;
    p.meta.checksum = computeChecksum(p);
    expect(validateImportPayload(p).ok).toBe(true);
    // 模拟“文件落盘再读回”：canonicalJson 不含 checksum，读回后需按导入流程重算
    const re = JSON.parse(canonicalJson(p));
    re.meta.checksum = computeChecksum(re);
    expect(validateImportPayload(re).ok).toBe(true);
  });
});

describe("importPayloadInTx", () => {
  it("清空→重建→改写 hub/schema → 返回摘要；用户元数据更新", async () => {
    mockConnQueryOne.mockImplementation(async (_conn, sql: string) => {
      if (sql.includes("SELECT id FROM users")) return { id: "user-1" };
      if (sql.includes("GROUP_CONCAT(id)")) return null;
      return null;
    });
    mockConnExecute.mockResolvedValue({ affectedRows: 1 });
    mockInsertItemIgnore.mockResolvedValue(true);
    mockInsertMemory.mockResolvedValue(undefined);
    mockInsertInventory.mockResolvedValue(undefined);
    mockInsertEvent.mockResolvedValue(undefined);

    const p = validPayload() as any;
    p.pet.memories = [{ id: "m1", kind: "naming", value: "团子", created_at: 1699999999000, last_referenced: null, weight: 1, is_permanent: true }];
    p.pet.events = [{ id: "e1", pet_id: "pet-1", type: "self_talk", ts: 1700000000000, fsm_state: "at_home", params: {}, engine_version: "1.0.0", pack_schema_version: "1.0.0", source: "engine", memory_refs: [{ kind: "pet_name", value: "团子", weight: 1 }], is_aggregate: false, aggregate_span_days: null, generated_by_catchup: false, created_at: 1700000000000 }];
    p.pet.inventory = [{ id: "i1", item_id: "berry", acquired_at: 1700000000000, acquired_via: "daily_grant", granted_event_id: null, offered_at: null, offered_event_id: null, consumed_at: null, consumed_event_id: null }];
    p.pet.items_catalog = [{ id: "berry", display_name: "浆果", description: null, icon_path: "images/berry.svg", rarity_weight: 5, category: "food" }];
    p.announcements_unread = [{ id: "ann-1", title: "迁移通知", body: "我们要搬家啦", level: "important", published_at: 1700000000000, expires_at: null }];

    const summary = await importPayloadInTx(FAKE_CONN, p, { userId: "user-1", hubId: "new-hub", schemaVersion: "1.0.0", now: 1700000000000 });

    expect(summary).toEqual({
      petId: "pet-1",
      petName: "团子",
      memories: 1,
      events: 1,
      inventory: 1,
      items_catalog: 1,
      announcements: 1,
    });

    // 清空顺序：先子后父
    const deletes = mockConnExecute.mock.calls
      .map((c) => String(c[1]))
      .filter((s) => s.startsWith("DELETE"));
    expect(deletes[0]).toContain("user_announcement_reads");
    expect(deletes[1]).toContain("inventory");
    expect(deletes[2]).toContain("events");
    expect(deletes[3]).toContain("user_settings");
    // pets 的删除在最后（父表）
    expect(deletes[deletes.length - 1]).toContain("DELETE FROM pets");

    // pet 插入带 hub 改写与 userId 改写
    const petInsert = mockConnExecute.mock.calls.find((c) => String(c[1]).includes("INSERT INTO pets"));
    expect(petInsert).toBeTruthy();
    expect(petInsert![2]).toContain("new-hub");
    expect(petInsert![2]).toContain("user-1");

    // 用户元数据更新（备份 hash + 来源中心）
    const userUpdate = mockConnExecute.mock.calls.find((c) => String(c[1]).includes("UPDATE users"));
    expect(userUpdate).toBeTruthy();

    // 记忆/事件/物品栏通过 repo 写入（hub 改写）
    expect(mockInsertMemory).toHaveBeenCalledTimes(1);
    const memArgs = mockInsertMemory.mock.calls[0];
    expect(memArgs[0].hubId).toBe("new-hub");
    expect(memArgs[0].createdAt).toBe(1699999999000);
    expect(mockInsertEvent).toHaveBeenCalledTimes(1);
    expect(mockInsertEvent.mock.calls[0][0].hubId).toBe("new-hub");
    expect(mockInsertEvent.mock.calls[0][0].memoryRefs[0].value).toBe("团子");
    expect(mockInsertInventory).toHaveBeenCalledTimes(1);
    expect(mockInsertInventory.mock.calls[0][0].hubId).toBe("new-hub");
    expect(mockInsertItemIgnore).toHaveBeenCalledTimes(1);
  });

  it("目标用户不存在 → 抛错（事务回滚由 withTransaction 保证）", async () => {
    mockConnQueryOne.mockResolvedValue(null);
    const p = validPayload() as any;
    await expect(
      importPayloadInTx(FAKE_CONN, p, { userId: "ghost", hubId: "h", schemaVersion: "1.0.0" })
    ).rejects.toThrow("目标账号不存在");
    // 抛错前不应有任何写入
    expect(mockConnExecute).not.toHaveBeenCalled();
  });
});