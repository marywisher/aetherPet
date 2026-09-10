/**
 * 文件名称：render.test.ts
 * 功能描述：事件渲染测试（占位符替换 + 记忆高亮 + 9:1 抽样）
 * 所属模块：tests/unit/domain/events
 * 验收对齐：
 *   - docs/dev-stage-plan.md §3 阶段 2 渲染逻辑
 *   - docs/requirements.md §7 废话:诗意 = 9:1
 */

import { describe, it, expect } from "vitest";
import {
  buildPlaceholderMap,
  renderEvent,
  type TextSlotTemplate,
} from "@/domain/events/render";
import { seededRng } from "@/domain/events/rng";
import type { Event, MemoryRef } from "@/domain/types";

const TS = 1746000000000;

function makeEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: "evt-1",
    petId: "pet-1",
    userId: "user-1",
    type: "self_talk",
    ts: TS,
    fsmState: "at_home",
    params: { mood: "calm" },
    memoryRefs: [],
    source: "engine",
    engineVersion: "1.0.0",
    packSchemaVersion: "1.0.0",
    isAggregate: false,
    aggregateSpanDays: null,
    generatedByCatchup: false,
    schemaVersion: "1.0.0",
    hubId: "local",
    createdAt: TS,
    ...overrides,
  };
}

const SAMPLE_PACK_TEXT: TextSlotTemplate = {
  title: { mode: "fixed", default: "{pet_name}" },
  body: {
    mode: "template",
    variants: {
      daily: ["{pet_name} 想起 {recall_line}", "没什么事"],
      poetic: ["夜风把 {recall_line} 摇成薄雾"],
    },
    poetic_ratio: 0.1,
  },
  sign_off: { mode: "fixed", default: "—— {pet_name}" },
};

describe("buildPlaceholderMap", () => {
  it("填充 {pet_name} 占位符", () => {
    const map = buildPlaceholderMap(makeEvent(), "豆豆");
    expect(map["pet_name"]).toBe("豆豆");
  });

  it("填充 {item} 占位符（来自 params.item_display_name）", () => {
    const map = buildPlaceholderMap(
      makeEvent({ type: "brought_item", params: { item_id: "berry", item_display_name: "浆果" } }),
      "豆豆"
    );
    expect(map["item"]).toBe("浆果");
  });

  it("填充 {count} 占位符", () => {
    const map = buildPlaceholderMap(
      makeEvent({ type: "counting_leaves", params: { count: 12 } }),
      "豆豆"
    );
    expect(map["count"]).toBe("12");
  });

  it("填充 {destination} / {duration_hours} 占位符", () => {
    const map = buildPlaceholderMap(
      makeEvent({
        type: "outing",
        params: { destination: "河边", duration_hours: 2 },
      }),
      "豆豆"
    );
    expect(map["destination"]).toBe("河边");
    expect(map["duration_hours"]).toBe("2");
  });

  it("填充 {span_days} 占位符（自然化）", () => {
    const map = buildPlaceholderMap(
      makeEvent({ type: "aggregate_summary", params: { span_days: 3 } }),
      "豆豆"
    );
    expect(map["span_days"]).toBe("3 天");
  });

  it("{span_days}=14 时显示 '2 周'", () => {
    const map = buildPlaceholderMap(
      makeEvent({ type: "aggregate_summary", params: { span_days: 14 } }),
      "豆豆"
    );
    expect(map["span_days"]).toBe("2 周");
  });

  it("{span_days}=45 时显示 '1 个多月'", () => {
    const map = buildPlaceholderMap(
      makeEvent({ type: "aggregate_summary", params: { span_days: 45 } }),
      "豆豆"
    );
    expect(map["span_days"]).toBe("1 个多月");
  });

  it("{items_collected} 数组拼成 'X 个 Y、A 个 B'", () => {
    const map = buildPlaceholderMap(
      makeEvent({
        type: "aggregate_summary",
        params: {
          span_days: 7,
          items_collected: [
            { type: "枯叶", count: 3 },
            { type: "浆果", count: 5 },
          ],
        },
      }),
      "豆豆"
    );
    expect(map["items_collected"]).toBe("3 个 枯叶、5 个 浆果");
  });

  it("{items_collected} 空数组 → '一些小东西'", () => {
    const map = buildPlaceholderMap(
      makeEvent({ type: "aggregate_summary", params: { items_collected: [] } }),
      "豆豆"
    );
    expect(map["items_collected"]).toBe("一些小东西");
  });

  it("{announcement_title} / {announcement_body} 占位符", () => {
    const map = buildPlaceholderMap(
      makeEvent({
        type: "system_announce",
        params: { announcement_title: "T", announcement_body: "B" },
      }),
      "豆豆"
    );
    expect(map["announcement_title"]).toBe("T");
    expect(map["announcement_body"]).toBe("B");
  });

  it("{recall_line} 从 time_anchor ref 提炼", () => {
    const refs: MemoryRef[] = [
      { kind: "time_anchor", value: "上周", weight: 1, sourceEventId: undefined },
    ];
    const map = buildPlaceholderMap(makeEvent({ memoryRefs: refs }), "豆豆");
    expect(map["recall_line"]).toBe("上周发生过的事");
  });

  it("{recall_line} 从 item_name ref 提炼", () => {
    const refs: MemoryRef[] = [
      { kind: "item_name", value: "浆果", weight: 1, sourceEventId: undefined },
    ];
    const map = buildPlaceholderMap(makeEvent({ memoryRefs: refs }), "豆豆");
    expect(map["recall_line"]).toBe("收到过的 浆果");
  });

  it("{recall_line} 无 refs → '没什么特别的'", () => {
    const map = buildPlaceholderMap(makeEvent(), "豆豆");
    expect(map["recall_line"]).toBe("没什么特别的");
  });

  it("支持额外 extraPlaceholders", () => {
    const map = buildPlaceholderMap(makeEvent(), "豆豆", { "custom_field": "X" });
    expect(map["custom_field"]).toBe("X");
  });
});

describe("renderEvent", () => {
  it("无素材包 → 降级最小文本", () => {
    const event = makeEvent();
    event.memoryRefs = [
      { kind: "pet_name", value: "豆豆", weight: 1.6, sourceEventId: undefined },
    ];
    const rendered = renderEvent(event, null, "豆豆");
    expect(rendered.body).toBe("(self_talk)");
    expect(rendered.title).toBe("豆豆");
    expect(rendered.containsPetName).toBe(true);
  });

  it("日常档位（poetic_ratio=0）→ 抽 daily variant", () => {
    const event = makeEvent();
    event.memoryRefs = [
      { kind: "pet_name", value: "豆豆", weight: 1.6, sourceEventId: undefined },
    ];
    const pack = { ...SAMPLE_PACK_TEXT, body: { ...SAMPLE_PACK_TEXT.body, poetic_ratio: 0 } };
    // 用固定 rng 多次采样，全部应是 daily
    for (let i = 0; i < 30; i++) {
      const r = renderEvent(event, pack, "豆豆", seededRng(i));
      expect(r.variantTier).toBe("daily");
      expect(["豆豆 想起 没什么特别的", "没什么事"]).toContain(r.body);
    }
  });

  it("9:1 抽样：poetic_ratio=0.1 时约 10% 命中诗意", () => {
    const event = makeEvent();
    event.memoryRefs = [
      { kind: "pet_name", value: "豆豆", weight: 1.6, sourceEventId: undefined },
    ];
    const rng = seededRng(20240615);
    let poeticCount = 0;
    const total = 1000;
    for (let i = 0; i < total; i++) {
      const r = renderEvent(event, SAMPLE_PACK_TEXT, "豆豆", rng);
      if (r.variantTier === "poetic") poeticCount++;
    }
    // 9:1 → 期望约 10%；容差 5%~15%
    const ratio = poeticCount / total;
    expect(ratio).toBeGreaterThan(0.05);
    expect(ratio).toBeLessThan(0.15);
  });

  it("渲染后 containsPetName=true 时 body 含名字", () => {
    const event = makeEvent();
    event.memoryRefs = [
      { kind: "pet_name", value: "豆豆", weight: 1.6, sourceEventId: undefined },
    ];
    // poetic_ratio=0 保证走 daily
    const pack = { ...SAMPLE_PACK_TEXT, body: { ...SAMPLE_PACK_TEXT.body, poetic_ratio: 0 } };
    const r = renderEvent(event, pack, "豆豆", seededRng(1));
    // daily variant 第一个包含 {pet_name}，第二个不含
    if (r.body.includes("豆豆")) {
      expect(r.containsPetName).toBe(true);
    }
  });

  it("highlightTokens 提取出现在渲染文本里的 memoryRef.value", () => {
    const event = makeEvent({
      memoryRefs: [
        { kind: "pet_name", value: "豆豆", weight: 1.6, sourceEventId: undefined },
        { kind: "item_name", value: "浆果", weight: 1, sourceEventId: undefined },
        { kind: "place", value: "不存在的地点", weight: 1, sourceEventId: undefined },
      ],
      params: { item_display_name: "浆果" },
    });
    const pack: TextSlotTemplate = {
      title: { mode: "fixed", default: "{pet_name}" },
      body: {
        mode: "template",
        variants: { daily: ["{pet_name} 收到 {item}"], poetic: [] },
        poetic_ratio: 0,
      },
    };
    const r = renderEvent(event, pack, "豆豆", seededRng(1));
    expect(r.highlightTokens.map((t) => t.value)).toContain("豆豆");
    expect(r.highlightTokens.map((t) => t.value)).toContain("浆果");
    expect(r.highlightTokens.map((t) => t.value)).not.toContain("不存在的地点");
  });

  it("sign_off 支持 template mode 变体", () => {
    const event = makeEvent();
    event.memoryRefs = [];
    const pack: TextSlotTemplate = {
      title: { mode: "fixed", default: "测试" },
      body: { mode: "template", variants: { daily: ["内容"], poetic: [] }, poetic_ratio: 0 },
      sign_off: { mode: "template", variants: ["—— {pet_name}", "—— 小 X"] },
    };
    const r = renderEvent(event, pack, "豆豆", seededRng(1));
    expect(["—— 豆豆", "—— 小 X"]).toContain(r.signOff);
  });

  it("未匹配占位符保留原样（如 {unknown_var}）", () => {
    const event = makeEvent();
    const pack: TextSlotTemplate = {
      body: {
        mode: "template",
        variants: { daily: ["未知占位符 {foo} 保留"], poetic: [] },
        poetic_ratio: 0,
      },
    };
    const r = renderEvent(event, pack, "豆豆", seededRng(1));
    expect(r.body).toBe("未知占位符 {foo} 保留");
  });
});
