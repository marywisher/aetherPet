/**
 * 文件名称：backup.ts
 * 功能描述：备份 hash 记录（阶段 5 · 铺逻辑；完整导出功能在阶段 6）
 * 所属模块：domain/backup
 * 验收对齐：
 *   - docs/current-stage.md 阶段 5 关键交付 5：users.last_backup_hash 更新逻辑
 *   - docs/requirements.md §6 验收 #11：账号安全与恢复（申诉自证）
 *   - docs/database-schema.md §1 users.last_backup_hash
 * 说明：
 *   - 本阶段仅铺逻辑；实际导出（JSON 序列化 + 打包）在阶段 6 实现
 *   - recordBackupHash 是纯领域函数，接收 SHA256 hex 字符串，写入 users 表
 *   - hash 格式校验：64 位小写十六进制；非法格式抛错，不落库（防止脏数据）
 *   - 未来阶段 6 导出流程：payload → sha256(payload) → recordBackupHash(user, hash)
 */

import { updateLastBackupHash } from "../persistence/repos/users.repo";

/** SHA256 hex 格式校验：64 字符 [0-9a-f] */
const SHA256_HEX_RE = /^[0-9a-f]{64}$/;

/**
 * 校验是否为合法的 SHA256 hex 字符串。
 * 纯函数（供单测与外部使用）。
 */
export function isValidSha256Hex(hash: string): boolean {
  return SHA256_HEX_RE.test(hash);
}

/** 非法 hash 输入 */
export class InvalidBackupHashError extends Error {
  constructor(hash: string) {
    super(`invalid backup hash (expected 64 hex chars, got: ${hash?.slice(0, 16)}...)`);
    this.name = "InvalidBackupHashError";
  }
}

/**
 * 记录一次备份 hash 到 users.last_backup_hash。
 *
 * 语义（阶段 6 的完整导出会调用本函数）：
 *   - 输入：用户 id + SHA256 hex（导出 payload 的哈希）
 *   - 输出：写入成功即返回；非法 hash 抛 InvalidBackupHashError
 *
 * 幂等：同一 hash 重复写入无害（等同 UPDATE 到相同值）
 *
 * @param userId 目标用户
 * @param sha256Hex 64 位小写 hex
 */
export async function recordBackupHash(
  userId: string,
  sha256Hex: string
): Promise<void> {
  if (!isValidSha256Hex(sha256Hex)) {
    throw new InvalidBackupHashError(sha256Hex);
  }
  // users.repo.updateLastBackupHash 内部使用 UPDATE users SET last_backup_hash=?
  // WHERE id=?；重复写入同一 hash 是安全的幂等操作。
  await updateLastBackupHash(userId, sha256Hex);
}
