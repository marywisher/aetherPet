/**
 * 文件名称：error-messages.ts
 * 功能描述：导入三类失败的集中错误文案 + HTTP 状态映射
 * 所属模块：domain/export
 * 验收对齐：
 *   - docs/requirements.md §3.9 导入失败分文案提示（版本不匹配 / 校验和失败 / 字段缺失）
 *   - docs/dev-stage-plan.md 阶段 6 演示步骤 3/4（篡改 checksum / schema_version 的提示）
 * 说明：
 *   - 领域层纯 TS，无 IO
 *   - 三种错误必须有**不同**的用户友好文案（验收 #7 硬性要求）
 *   - code 供 API 层返回，前端按 code 渲染对应提示
 */

/** 导入错误分类 */
export type ImportErrorKind =
  | "ERR_VERSION_MISMATCH"
  | "ERR_CHECKSUM_MISMATCH"
  | "ERR_FIELD_MISSING"
  | "ERR_NOT_JSON"
  | "ERR_TOO_LARGE"
  | "ERR_NO_PET";

export interface ImportErrorInfo {
  kind: ImportErrorKind;
  /** 给 API 层用的机器码 */
  code: string;
  /** 用户友好文案（简体中文，面向终端用户） */
  message: string;
  /** 补充信息（如期望版本号 / 缺失字段名），供技术侧排查 */
  detail?: string;
  /** HTTP 状态码建议 */
  status: number;
}

export const IMPORT_ERRORS: Record<ImportErrorKind, ImportErrorInfo> = {
  ERR_VERSION_MISMATCH: {
    kind: "ERR_VERSION_MISMATCH",
    code: "ERR_VERSION_MISMATCH",
    message: "导入失败：备份文件版本不匹配。请使用与当前中心兼容的导出文件（schema 版本 1.0.0）。",
    detail: "schema_version 不在支持范围内",
    status: 422,
  },
  ERR_CHECKSUM_MISMATCH: {
    kind: "ERR_CHECKSUM_MISMATCH",
    code: "ERR_CHECKSUM_MISMATCH",
    message: "导入失败：校验和验证不通过，文件可能已被改动或损坏。请重新导出后导入。",
    detail: "SHA256 校验和不一致",
    status: 422,
  },
  ERR_FIELD_MISSING: {
    kind: "ERR_FIELD_MISSING",
    code: "ERR_FIELD_MISSING",
    message: "导入失败：备份文件缺少必要字段，不是一份完整的 AetherPet 导出文件。",
    detail: "必需字段缺失或类型错误",
    status: 422,
  },
  ERR_NOT_JSON: {
    kind: "ERR_NOT_JSON",
    code: "ERR_NOT_JSON",
    message: "导入失败：文件不是合法的 JSON。请确认选择的是导出的备份文件。",
    status: 400,
  },
  ERR_TOO_LARGE: {
    kind: "ERR_TOO_LARGE",
    code: "ERR_TOO_LARGE",
    message: "导入失败：文件过大（超过 10MB 限制）。",
    status: 413,
  },
  ERR_NO_PET: {
    kind: "ERR_NO_PET",
    code: "ERR_NO_PET",
    message: "导入失败：备份中没有找到 pet 数据。",
    status: 422,
  },
};

/** 便捷工厂：字段缺失时带字段名 */
export function fieldMissingError(fieldPath: string): ImportErrorInfo {
  return {
    ...IMPORT_ERRORS.ERR_FIELD_MISSING,
    detail: `缺少字段：${fieldPath}`,
  };
}

/** 便捷工厂：版本不匹配时带期望版本 */
export function versionMismatchError(got: string, expected: string): ImportErrorInfo {
  return {
    ...IMPORT_ERRORS.ERR_VERSION_MISMATCH,
    detail: `期望 ${expected}，收到 ${got}`,
  };
}