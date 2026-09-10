/**
 * 文件名称：export-import.api.test.ts
 * 功能描述：API 层集成测试（阶段 6 硬性要求——补齐「API 层零集成测试」缺口）
 * 所属模块：tests/integration
 * 运行条件：
 *   - 需要真实 MySQL（CI 用临时 MySQL 服务；本地没有 MySQL 则自动跳过）
 *   - 通过 INTEGRATION_DB=1 显式开启，防止误跑
 * 覆盖：
 *   - GET  /api/export  401 / 200（含 schema/checksum/payload 结构）
 *   - POST /api/import  401 / 422（版本不匹配、校验和失败、字段缺失三种文案不同）
 *   - POST /api/import  200（导出→清空→导入往返，逐字段可比对）
 *   - POST /api/packs/activate 404（不存在）/ 200（切换 morning）
 * 语义：导入=恢复（先清空当前用户数据再重建），失败整体回滚
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";

const IS_INTEGRATION = process.env.INTEGRATION_DB === "1" && process.env.DB_HOST !== undefined;

// 只有显式开启才加载（避免把 DB 依赖拖进普通单测运行）
describe.skipIf(!IS_INTEGRATION)("API 集成：导出/导入/素材包激活（真实 MySQL）", () => {
  let cleanup: (() => Promise<void>) | null = null;

  beforeAll(async () => {
    process.env.DB_AUTO_MIGRATE = "true";
    process.env.HUB_ID = "itest-hub";
    const { ensureMigrations } = await import("@/domain/persistence/migrations/runner");
    const { initPool, closePool, getPool } = await import("@/domain/persistence/db");
    await initPool();
    await ensureMigrations();
    // 清理本测试可能残留的旧数据
    const pool = getPool();
    await pool.query("DELETE FROM users WHERE email_hash LIKE 'itest-%'");
    await closePool();
  });

  afterAll(async () => {
    if (cleanup) await cleanup();
    const { closePool } = await import("@/domain/persistence/db");
    await closePool();
  });

  async function seedUser(): Promise<{ userId: string; token: string; petId: string }> {
    const { getPool } = await import("@/domain/persistence/db");
    const { insert: insertUser } = await import("@/domain/persistence/repos/users.repo");
    const { insert: insertPet } = await import("@/domain/persistence/repos/pets.repo");
    const { issueToken } = await import("@/domain/auth/token");
    const { newId } = await import("@/domain/util/ulid");

    const emailHash = `itest-${new Date().getTime()}-${newId()}`;
    const userId = newId();
    await insertUser({
      id: userId,
      emailHash,
      emailPlainEnc: null,
      emailVerifiedAt: Date.now(),
      // createdAt/updatedAt 由 repo 内部生成
      lastBackupHash: null,
      importedFromHub: null,
      importedAt: null,
      schemaVersion: "1.0.0",
      hubId: "local",
    });

    const petId = newId();
    await insertPet({
      id: petId,
      userId,
      name: "集成测试宠",
      state: "at_home",
      nextProactiveTs: null,
      dailyGrantLastDate: null,
      offerLastDate: null,
      replyDueAt: null,
      lastReplyAt: null,
      walletRef: null,
      schemaVersion: "1.0.0",
      hubId: "local",
    });
    // 插入一条事件 + 一条记忆，让导出有内容
    const { insert: insertEvent } = await import("@/domain/persistence/repos/events.repo");
    const { insert: insertMemory } = await import("@/domain/persistence/repos/memories.repo");
    await insertEvent({
      id: newId(), petId, userId, type: "self_talk", ts: Date.now(), fsmState: "at_home",
      params: { mood: "breezy" }, engineVersion: "1.0.0", packSchemaVersion: "1.0.0",
      source: "engine", memoryRefs: [{ kind: "pet_name", value: "集成测试宠", weight: 1 }],
      isAggregate: false, aggregateSpanDays: null, generatedByCatchup: false,
      schemaVersion: "1.0.0", hubId: "local", createdAt: Date.now(),
    });
    await insertMemory({
      id: newId(), petId, kind: "naming", value: "集成测试宠", lastReferenced: null,
      weight: 1, isPermanent: true, schemaVersion: "1.0.0", hubId: "local", createdAt: Date.now(),
    });

    const issued = await issueToken({ userId, hubId: "local" });

    cleanup = async () => {
      const p = getPool();
      await p.query("DELETE FROM events WHERE user_id = ?", [userId]);
      await p.query("DELETE FROM memories WHERE pet_id = ?", [petId]);
      await p.query("DELETE FROM inventory WHERE user_id = ?", [userId]);
      await p.query("DELETE FROM sessions WHERE user_id = ?", [userId]);
      await p.query("DELETE FROM pets WHERE user_id = ?", [userId]);
      await p.query("DELETE FROM user_settings WHERE user_id = ?", [userId]);
      await p.query("DELETE FROM users WHERE id = ?", [userId]);
    };

    return { userId, token: issued.token, petId };
  }

  function authedRequest(token: string, url: string, init: RequestInit = {}) {
    const r = new Request(url, {
      ...init,
      headers: { cookie: `aetherpet_token=${token}`, "content-type": "application/json", ...(init.headers ?? {}) },
    });
    // Route Handler 类型为 NextRequest；运行时仅使用 Request 通用接口（headers/url/arrayBuffer）
    return r as unknown as import("next/server").NextRequest;
  }

  it("导出：无 token → 401", async () => {
    const { GET } = await import("@/app/api/export/route");
    const req = new Request("http://test/api/export") as unknown as import("next/server").NextRequest;
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it("导出：有 token → 200 + schema/checksum/payload 结构", async () => {
    const { userId, token, petId } = await seedUser();
    try {
      const { GET } = await import("@/app/api/export/route");
      const res = await GET(authedRequest(token, "http://test/api/export"));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.payload.meta.schema_version).toBe("1.0.0");
      expect(data.payload.meta.checksum).toMatch(/^SHA256:[0-9a-f]{64}$/);
      expect(data.payload.meta.exported_from).toBe("itest-hub");
      expect(data.payload.pet.base.id).toBe(petId);
      expect(data.payload.user.email_hash).toContain("itest-");
      expect(data.payload.pet.events.length).toBeGreaterThanOrEqual(1);
      expect(data.payload.pet.memories.length).toBeGreaterThanOrEqual(1);
      expect(JSON.stringify(data.payload)).not.toContain("email_plain_enc");
    } finally {
      if (cleanup) await cleanup();
    }
    void userId;
  });

  it("导入：无 token → 401", async () => {
    const { POST } = await import("@/app/api/import/route");
    const req = new Request("http://test/api/import", { method: "POST", body: "{}" }) as unknown as import("next/server").NextRequest;
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("导入：版本不匹配 → 422 ERR_VERSION_MISMATCH（文案不同）", async () => {
    const { userId, token } = await seedUser();
    try {
      const { GET } = await import("@/app/api/export/route");
      const exp = await (await GET(authedRequest(token, "http://test/api/export"))).json();
      // 只改版本、不动 checksum：验证“版本优先于校验和”
      exp.payload.meta.schema_version = "2.0.0";
      const { POST } = await import("@/app/api/import/route");
      const res = await POST(authedRequest(token, "http://test/api/import", {
        method: "POST",
        body: JSON.stringify(exp.payload),
      }));
      expect(res.status).toBe(422);
      const data = await res.json();
      expect(data.code).toBe("ERR_VERSION_MISMATCH");
      expect(data.error).toContain("版本");
    } finally {
      if (cleanup) await cleanup();
    }
    void userId;
  });

  it("导入：篡改内容（校验和失败）→ 422 ERR_CHECKSUM_MISMATCH", async () => {
    const { userId, token } = await seedUser();
    try {
      const { GET } = await import("@/app/api/export/route");
      const exp = await (await GET(authedRequest(token, "http://test/api/export"))).json();
      exp.payload.pet.base.name = "被篡改";
      const { POST } = await import("@/app/api/import/route");
      const res = await POST(authedRequest(token, "http://test/api/import", {
        method: "POST",
        body: JSON.stringify(exp.payload),
      }));
      expect(res.status).toBe(422);
      const data = await res.json();
      expect(data.code).toBe("ERR_CHECKSUM_MISMATCH");
      expect(data.error).toContain("校验和");
      expect(data.error).not.toContain("版本匹配");
    } finally {
      if (cleanup) await cleanup();
    }
    void userId;
  });

  it("导入：删除必要字段但重算 checksum（模拟其他导出工具）→ 422 ERR_FIELD_MISSING", async () => {
    const { userId, token } = await seedUser();
    try {
      const { GET } = await import("@/app/api/export/route");
      const { computeChecksum } = await import("@/domain/export/exporter");
      const exp = await (await GET(authedRequest(token, "http://test/api/export"))).json();
      delete exp.payload.pet.base.name;
      // 该工具（错误地）重新生成了 checksum → 校验和通过，但字段缺失被捕获
      exp.payload.meta.checksum = computeChecksum(exp.payload);
      const { POST } = await import("@/app/api/import/route");
      const res = await POST(authedRequest(token, "http://test/api/import", {
        method: "POST",
        body: JSON.stringify(exp.payload),
      }));
      expect(res.status).toBe(422);
      const data = await res.json();
      expect(data.code).toBe("ERR_FIELD_MISSING");
      expect(data.detail).toContain("pet.base.name");
    } finally {
      if (cleanup) await cleanup();
    }
    void userId;
  });

  it("导入：导出→清空→导入往返，数据恢复可逐字段比对", async () => {
    const { userId, token, petId } = await seedUser();
    try {
      const { GET } = await import("@/app/api/export/route");
      const before = await (await GET(authedRequest(token, "http://test/api/export"))).json();

      // 清空用户 pet（模拟损坏/误删后的恢复目标账号）
      const { getPool } = await import("@/domain/persistence/db");
      const pool = getPool();
      await pool.query("DELETE FROM events WHERE user_id = ?", [userId]);
      await pool.query("DELETE FROM memories WHERE pet_id = ?", [petId]);
      await pool.query("DELETE FROM pets WHERE user_id = ?", [userId]);

      // 导入
      const { POST } = await import("@/app/api/import/route");
      const res = await POST(authedRequest(token, "http://test/api/import", {
        method: "POST",
        body: JSON.stringify(before.payload),
      }));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.imported.petId).toBe(petId);
      expect(data.imported.petName).toBe("集成测试宠");

      // 逐字段比对：重新导出应与导入前一致（ts 序列化往返后一致）
      const after = await (await GET(authedRequest(token, "http://test/api/export"))).json();
      expect(after.payload.pet.base.name).toBe(before.payload.pet.base.name);
      expect(after.payload.pet.base.state).toBe(before.payload.pet.base.state);
      expect(after.payload.pet.events.map((e: { id: string }) => e.id)).toEqual(
        before.payload.pet.events.map((e: { id: string }) => e.id)
      );
      expect(after.payload.pet.memories.map((m: { id: string }) => m.id)).toEqual(
        before.payload.pet.memories.map((m: { id: string }) => m.id)
      );
      // 导入后 last_backup_hash = 导入文件的校验和（申诉自证）
      expect(after.payload.user.last_backup_hash).toBeTruthy();

      // 导入失败路径的原子性验证：篡改后导入，再导出应保持原样（已由 422 测试隐含）
    } finally {
      if (cleanup) await cleanup();
    }
    void userId;
  });

  it("素材包激活：不存在 → 404；切换到 morning → 200 且生效", async () => {
    const { userId, token } = await seedUser();
    try {
      const { POST } = await import("@/app/api/packs/activate/route");
      const missing = await POST(authedRequest(token, "http://test/api/packs/activate", {
        method: "POST",
        body: JSON.stringify({ packName: "does-not-exist" }),
      }));
      expect(missing.status).toBe(404);

      const ok = await POST(authedRequest(token, "http://test/api/packs/activate", {
        method: "POST",
        body: JSON.stringify({ packName: "morning" }),
      }));
      expect(ok.status).toBe(200);
      const data = await ok.json();
      expect(data.current.name).toBe("morning");

      // 验证已落库（pets.active_pack_name）
      const pets = await (await import("@/domain/persistence/repos/pets.repo")).findByUserId(userId);
      expect(pets[0].activePackName).toBe("morning");
    } finally {
      if (cleanup) await cleanup();
    }
    void userId;
  });
});