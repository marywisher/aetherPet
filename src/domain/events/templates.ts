/**
 * 文件名称：templates.ts
 * 功能描述：事件模板注册表（EventType → Generator）
 * 所属模块：domain/events
 * 说明：
 *   - 单一入口：新增事件类型必须在此注册 + 更新 docs/packs-contract.md
 *   - 契约演进规则：见架构 §5.5
 */

import type { EventTypeValue, GeneratorRegistry } from "./types";
import { generateOuting } from "./generators/outing";
import { generateWatchingWater } from "./generators/watching-water";
import { generateCountingLeaves } from "./generators/counting-leaves";
import { generateSelfTalk } from "./generators/self-talk";
import { generateBroughtItem } from "./generators/brought-item";
import { generateReplyLetter } from "./generators/reply-letter";
import { generateSpontaneousLetter } from "./generators/spontaneous-letter";
import { generateAggregateSummary } from "./generators/aggregate-summary";
import { generateSystemAnnounce } from "./generators/announcement";
import { generateDailyGrant } from "./generators/daily-grant";
import { generateOfferReceived } from "./generators/offer-received";
import { generateFirstMeeting } from "./generators/first-meeting";

export const GENERATORS: GeneratorRegistry = {
  outing: generateOuting,
  watching_water: generateWatchingWater,
  counting_leaves: generateCountingLeaves,
  self_talk: generateSelfTalk,
  brought_item: generateBroughtItem,
  reply_letter: generateReplyLetter,
  spontaneous_letter: generateSpontaneousLetter,
  aggregate_summary: generateAggregateSummary,
  system_announce: generateSystemAnnounce,
  daily_grant: generateDailyGrant,
  offer_received: generateOfferReceived,
  // pre-launch：初见事件——仅创建流程显式触发，不进 RANDOM_TYPES
  first_meeting: generateFirstMeeting,
};

/** 引擎可随机触发的类型（不含 gift/system/catchup 类） */
export const RANDOM_TYPES: EventTypeValue[] = [
  "outing",
  "watching_water",
  "counting_leaves",
  "self_talk",
  "brought_item",
  "spontaneous_letter",
];
