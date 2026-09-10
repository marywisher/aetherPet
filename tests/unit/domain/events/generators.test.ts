/**
 * 文件名称：generators.test.ts
 * 功能描述：9 个随机事件生成器 + 2 个礼物事件生成器契约验证
 * 所属模块：tests/unit/domain/events
 * 验收对齐：docs/dev-stage-plan.md §3 阶段 2 单测覆盖每个生成器
 */

import { describe, it, expect } from "vitest";
import { seededRng } from "@/domain/events/rng";
import { GENERATORS, RANDOM_TYPES } from "@/domain/events/templates";
import type { EventContext } from "@/domain/events/types";
import { generateReplyLetter } from "@/domain/events/generators/reply-letter";
import { generateDailyGrant } from "@/domain/events/generators/daily-grant";
import { generateOfferReceived } from "@/domain/events/generators/offer-received";
import { generateAggregateSummary } from "@/domain/events/generators/aggregate-summary";
import { generateSystemAnnounce } from "@/domain/events/generators/announcement";
import {
  generateOuting,
} from "@/domain/events/generators/outing";
import {
  generateWatchingWater,
} from "@/domain/events/generators/watching-water";
import {
  generateCountingLeaves,
} from "@/domain/events/generators/counting-leaves";
import {
  generateSelfTalk,
} from "@/domain/events/generators/self-talk";
import {
  generateBroughtItem,
} from "@/domain/events/generators/brought-item";
import {
  generateSpontaneousLetter,
} from "@/domain/events/generators/spontaneous-letter";
import type { Pet, Memory, EventTypeValue } from "@/domain/types";

const TS = 1746000000000;

const PET: Pet = {
  id: "test-pet-1",
  userId: "test-user-1",
  name: "豆豆",
  state: "at_home",
  stateSince: TS - 1000,
  createdAt: TS - 2000,
  updatedAt: TS - 1000,
  lastActivityTs: TS - 1000,
  userLastActiveTs: TS - 1000,
  nextProactiveTs: null,
  dailyGrantLastDate: null,
  offerLastDate: null,
  replyPending: false,
  replyDueAt: null,
  lastReplyAt: null,
  activePackName: "default",
  walletRef: null,
  schemaVersion: "1.0.0",
  hubId: "local",
};

const MEMORIES: Memory[] = [
  {
    id: "mem-naming-1",
    petId: "test-pet-1",
    kind: "naming",
    value: "豆豆",
    createdAt: TS - 2000,
    lastReferenced: null,
    weight: 1.6,
    isPermanent: true,
    schemaVersion: "1.0.0",
    hubId: "local",
  },
  {
    id: "mem-item-1",
    petId: "test-pet-1",
    kind: "item_received",
    value: "浆果",
    createdAt: TS - 3000,
    lastReferenced: null,
    weight: 1,
    isPermanent: false,
    schemaVersion: "1.0.0",
    hubId: "local",
  },
  {
    id: "mem-place-1",
    petId: "test-pet-1",
    kind: "place_visited",
    value: "河边",
    createdAt: TS - 3000,
    lastReferenced: null,
    weight: 1,
    isPermanent: false,
    schemaVersion: "1.0.0",
    hubId: "local",
  },
];

const BASE_CTX: EventContext = {
  pet: PET,
  memories: MEMORIES,
  ts: TS,
  rng: seededRng(42),
  hubId: "local",
};

describe("9 个随机事件生成器（契约验证）", () => {
  it.each([
    ["outing", generateOuting(BASE_CTX)],
    ["watching_water", generateWatchingWater(BASE_CTX)],
    ["counting_leaves", generateCountingLeaves(BASE_CTX)],
    ["self_talk", generateSelfTalk(BASE_CTX)],
    ["brought_item", generateBroughtItem(BASE_CTX)],
    ["spontaneous_letter", generateSpontaneousLetter(BASE_CTX)],
    ["reply_letter", generateReplyLetter({ ...BASE_CTX, giftEventId: "g1", itemDisplayName: "浆果" })],
    ["daily_grant", generateDailyGrant({ ...BASE_CTX, itemId: "berry", itemDisplayName: "浆果" })],
    ["offer_received", generateOfferReceived({ ...BASE_CTX, itemId: "berry", itemDisplayName: "浆果", grantedEventId: "g2" })],
  ] as [EventTypeValue, any][])(
    "%s 生成器产出结构 + 元数据完整",
    (type, output) => {
      const { event, fsmAction } = output;
      expect(event.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
      expect(event.type).toBe(type);
      expect(event.petId).toBe(PET.id);
      expect(event.userId).toBe(PET.userId);
      expect(event.ts).toBe(TS);
      expect(event.fsmState).toBe("at_home");
      expect(typeof event.params).toBe("object");
      expect(event.memoryRefs).toBeDefined();
      expect(event.source).toMatch(/^(engine|gift)$/);
      expect(event.engineVersion).toBe("1.0.0");
      expect(event.packSchemaVersion).toBe("1.0.0");
      expect(event.schemaVersion).toBe("1.0.0");
      expect(event.hubId).toBe("local");
      expect(event.isAggregate).toBe(false);
      expect(event.generatedByCatchup).toBe(false);
      expect(fsmAction).toBeDefined();
    }
  );

  it("outing 转换：at_home ──outing_start──► out_walking", () => {
    const { fsmAction } = generateOuting(BASE_CTX);
    expect(fsmAction).toBe("outing_start");
  });

  it("outing params 含 destination + duration_hours", () => {
    const { event } = generateOuting(BASE_CTX);
    expect(typeof event.params.destination).toBe("string");
    expect((event.params.destination as string).length).toBeGreaterThan(0);
    expect(typeof event.params.duration_hours).toBe("number");
    expect(event.params.duration_hours as number).toBeGreaterThanOrEqual(1);
    expect(event.params.duration_hours as number).toBeLessThanOrEqual(3);
  });

  it("watching_water params 含 place + duration_minutes", () => {
    const { event } = generateWatchingWater(BASE_CTX);
    expect(typeof event.params.place).toBe("string");
    expect((event.params.place as string).length).toBeGreaterThan(0);
    expect(typeof event.params.duration_minutes).toBe("number");
    expect(event.params.duration_minutes as number).toBeGreaterThanOrEqual(15);
    expect(event.params.duration_minutes as number).toBeLessThanOrEqual(60);
  });

  it("counting_leaves params 含 count", () => {
    const { event } = generateCountingLeaves(BASE_CTX);
    expect(typeof event.params.count).toBe("number");
    expect(event.params.count as number).toBeGreaterThanOrEqual(5);
    expect(event.params.count as number).toBeLessThanOrEqual(48);
  });

  it("self_talk params 含 mood", () => {
    const { event } = generateSelfTalk(BASE_CTX);
    expect(["calm", "curious", "nostalgic"]).toContain(event.params.mood);
  });

  it("brought_item params 含 item_id + memoryRefs 含 item_name", () => {
    const { event } = generateBroughtItem(BASE_CTX);
    expect(typeof event.params.item_id).toBe("string");
    expect(typeof event.params.item_display_name).toBe("string");
    expect(event.memoryRefs.some((r) => r.kind === "item_name")).toBe(true);
  });

  it("spontaneous_letter params 含 trigger", () => {
    const { event } = generateSpontaneousLetter(BASE_CTX);
    expect(["dream", "moonlight", "silence"]).toContain(event.params.trigger);
  });

  it("reply_letter source='gift' 且 params.gift_event_id 存在", () => {
    const { event } = generateReplyLetter({
      ...BASE_CTX,
      giftEventId: "gift-abc-123",
      itemDisplayName: "浆果",
      itemId: "berry",
    });
    expect(event.source).toBe("gift");
    expect(event.params.gift_event_id).toBe("gift-abc-123");
    expect(event.params.item_display_name).toBe("浆果");
    expect(event.memoryRefs.some((r) => r.kind === "item_name")).toBe(true);
    // 契约 recall_min_count=1
    expect(event.memoryRefs.length).toBeGreaterThanOrEqual(1);
  });

  it("daily_grant source='gift' 且 params.item_id 存在", () => {
    const { event } = generateDailyGrant({
      ...BASE_CTX,
      itemId: "berry",
      itemDisplayName: "浆果",
    });
    expect(event.source).toBe("gift");
    expect(event.params.item_id).toBe("berry");
    expect(event.params.item_display_name).toBe("浆果");
    expect(event.memoryRefs.some((r) => r.kind === "item_name")).toBe(true);
  });

  it("offer_received source='gift' 且 memoryRefs 含 item_name + pet_name", () => {
    const { event } = generateOfferReceived({
      ...BASE_CTX,
      itemId: "berry",
      itemDisplayName: "浆果",
      grantedEventId: "grant-xyz",
    });
    expect(event.source).toBe("gift");
    expect(event.params.item_id).toBe("berry");
    expect(event.params.offer_event_id).toBe("grant-xyz");
    expect(event.memoryRefs.some((r) => r.kind === "item_name")).toBe(true);
    expect(event.memoryRefs.some((r) => r.kind === "pet_name")).toBe(true);
  });
});

describe("生成器注册表", () => {
  it("GENERATORS 含全部 11 个事件类型", () => {
    const types = Object.keys(GENERATORS) as EventTypeValue[];
    expect(types.length).toBe(11);
    for (const t of [
      "outing", "watching_water", "counting_leaves", "self_talk",
      "brought_item", "reply_letter", "spontaneous_letter",
      "aggregate_summary", "system_announce", "daily_grant", "offer_received",
    ]) {
      expect(types).toContain(t);
    }
  });

  it("RANDOM_TYPES 仅含引擎可随机触发的类型（不含 gift/system/catchup）", () => {
    for (const t of RANDOM_TYPES) {
      expect(["reply_letter", "daily_grant", "offer_received", "aggregate_summary", "system_announce"])
        .not.toContain(t);
    }
  });
});

describe("阶段 2 骨架生成器（aggregate_summary / system_announce）", () => {
  it("aggregate_summary isAggregate=true 且 aggregateSpanDays 非空", () => {
    const { event } = generateAggregateSummary({
      ...BASE_CTX,
      aggregate: {
        spanDays: 14,
        itemsCollected: [
          { type: "枯叶", count: 3 },
          { type: "浆果", count: 5 },
        ],
        outings: 4,
        travelNights: 0,
      },
    });
    expect(event.type).toBe("aggregate_summary");
    expect(event.isAggregate).toBe(true);
    expect(event.aggregateSpanDays).toBe(14);
    expect(event.generatedByCatchup).toBe(true);
    expect(event.source).toBe("catchup");
  });

  it("system_announce memoryRefs=[] 且 source='system'（P2-003：params 只存 announcement_id，不含文案）", () => {
    const { event } = generateSystemAnnounce({
      ...BASE_CTX,
      announcementId: "ann-1",
    });
    expect(event.type).toBe("system_announce");
    expect(event.source).toBe("system");
    expect(event.memoryRefs).toEqual([]);
    expect(event.params.announcement_id).toBe("ann-1");
    expect(event.params).not.toHaveProperty("announcement_title");
    expect(event.params).not.toHaveProperty("announcement_body");
  });
});
