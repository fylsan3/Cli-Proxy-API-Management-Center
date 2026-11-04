/**
 * 二开：系统参数（原名「推荐参数」）—— 规则与检查逻辑（纯函数，无副作用，便于测试）。
 *
 * - A 组：推荐默认勾选；B 组：可选，默认不勾；C 组：只检查、不提供修改。
 * - 每一项都可以「编辑」，自己填值后单独写入（同样先备份、可还原）。
 * - 「当前值」读取 GET /config 的原始 JSON（未写入的字段按 CPA v8 官方默认值处理）。
 * - 应用时只 PATCH 勾选的字段，不碰其他任何配置。
 * - 字段路径已在本机 CPA v8.0.51 上实测：PATCH 写入成功、GET 回读一致、触发热重载。
 *   注意：Claude 的 model-level-cooling 在 v8 实际路径是 upstream.claude（文档里的 oauth.providers.claude 写入后不会生效）。
 */

export type RuleGroup = 'A' | 'B';
export type ConfigScalar = string | number | boolean;

export interface RecommendedRule {
  id: string;
  group: RuleGroup;
  path: readonly string[];
  recommended: ConfigScalar;
  /** 字段未写入 config 时 CPA 使用的默认值 */
  fallback: ConfigScalar;
  /** 编辑时的取值范围（数字类） */
  min?: number;
  max?: number;
  /** 编辑时的可选值（枚举类字符串） */
  options?: readonly string[];
}

export const RECOMMENDED_RULES: readonly RecommendedRule[] = [
  // ---------- A 组：推荐（默认勾选） ----------
  {
    id: 'disable_auto_update_panel',
    group: 'A',
    path: ['management', 'disable-auto-update-panel'],
    recommended: true,
    fallback: false,
  },
  {
    id: 'disable_control_panel',
    group: 'A',
    path: ['management', 'disable-control-panel'],
    recommended: false,
    fallback: false,
  },
  {
    id: 'session_affinity',
    group: 'A',
    path: ['routing', 'session-affinity'],
    recommended: true,
    fallback: false,
  },
  {
    id: 'session_affinity_ttl',
    group: 'A',
    path: ['routing', 'session-affinity-ttl'],
    recommended: '1h',
    fallback: '1h',
  },
  {
    id: 'session_affinity_rebind_on',
    group: 'A',
    path: ['routing', 'session-affinity-rebind-on'],
    recommended: 'any',
    fallback: 'any',
    options: ['any', 'quota'],
  },
  {
    id: 'usage_statistics_enabled',
    group: 'A',
    path: ['observability', 'usage', 'usage-statistics-enabled'],
    recommended: true,
    fallback: false,
  },
  {
    id: 'usage_queue_retention',
    group: 'A',
    path: ['observability', 'usage', 'redis-usage-queue-retention-seconds'],
    recommended: 1800,
    fallback: 60,
    min: 1,
    max: 3600,
  },
  {
    // 2026-11-05 用户确认：冷却状态存盘，CPA 重启后不会忘记账号正在冷却
    id: 'save_cooldown_status',
    group: 'A',
    path: ['routing', 'cooldown', 'save-cooldown-status'],
    recommended: true,
    fallback: false,
  },
  // ---------- B 组：可选（默认不勾） ----------
  {
    id: 'tls_handshake_timeout',
    group: 'B',
    path: ['requests', 'tls-handshake-timeout-seconds'],
    recommended: 15,
    fallback: 0,
    min: 0,
  },
  {
    id: 'claude_model_level_cooling',
    group: 'B',
    path: ['upstream', 'claude', 'model-level-cooling'],
    recommended: true,
    fallback: false,
  },
  {
    id: 'streaming_keepalive',
    group: 'B',
    path: ['requests', 'streaming', 'keepalive-seconds'],
    recommended: 15,
    fallback: 0,
    min: 0,
  },
  {
    id: 'streaming_bootstrap_retries',
    group: 'B',
    path: ['requests', 'streaming', 'bootstrap-retries'],
    recommended: 1,
    fallback: 0,
    min: 0,
  },
  {
    id: 'logs_max_total_size',
    group: 'B',
    path: ['observability', 'logs', 'logs-max-total-size-mb'],
    recommended: 500,
    fallback: 0,
    min: 0,
  },
];

export type SafetyLevel = 'ok' | 'warn' | 'info';

export interface SafetyCheckResult {
  id: string;
  level: SafetyLevel;
  /** 用于展示的当前值 */
  current: string;
}

export interface RuleCheckResult {
  rule: RecommendedRule;
  /** 字段是否在 config 中显式写入 */
  present: boolean;
  /** 原始值（未写入时为 undefined） */
  raw: unknown;
  /** 生效值（未写入时取 fallback） */
  effective: unknown;
  ok: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export function readPath(
  root: unknown,
  path: readonly string[]
): { present: boolean; value: unknown } {
  let node: unknown = root;
  for (const key of path) {
    if (!isRecord(node) || !Object.prototype.hasOwnProperty.call(node, key)) {
      return { present: false, value: undefined };
    }
    node = node[key];
  }
  return { present: true, value: node };
}

function sameScalar(a: unknown, b: ConfigScalar): boolean {
  if (typeof b === 'number') return typeof a === 'number' && a === b;
  if (typeof b === 'boolean') return typeof a === 'boolean' && a === b;
  return typeof a === 'string' && a.trim().toLowerCase() === b.toLowerCase();
}

export function checkRules(config: unknown): RuleCheckResult[] {
  return RECOMMENDED_RULES.map((rule) => {
    const { present, value } = readPath(config, rule.path);
    const effective = present && value !== null ? value : rule.fallback;
    return { rule, present, raw: value, effective, ok: sameScalar(effective, rule.recommended) };
  });
}

export function countPending(config: unknown): number {
  return checkRules(config).filter((item) => !item.ok).length;
}

/** C 组：只检查，不修改 */
export function checkSafety(config: unknown): SafetyCheckResult[] {
  const text = (value: unknown) =>
    value === undefined || value === null || value === '' ? '' : String(value);

  const secret = readPath(config, ['management', 'secret-key']).value;
  const proxy = readPath(config, ['requests', 'proxy-url']).value;
  const host = readPath(config, ['server', 'host']).value;
  const requestLog = readPath(config, ['observability', 'logs', 'request-log']).value;
  const debug = readPath(config, ['observability', 'logs', 'debug']).value;
  const pprof = readPath(config, ['observability', 'pprof', 'enable']).value;

  const hostText = text(host);
  const isLoopback = hostText === '127.0.0.1' || hostText === 'localhost' || hostText === '::1';

  return [
    {
      id: 'secret_key',
      level: text(secret) ? 'ok' : 'warn',
      current: text(secret) ? '******' : '',
    },
    { id: 'proxy_url', level: text(proxy) ? 'warn' : 'ok', current: text(proxy) },
    { id: 'server_host', level: isLoopback ? 'ok' : 'info', current: hostText },
    {
      id: 'request_log',
      level: requestLog === true ? 'warn' : 'ok',
      current: String(requestLog === true),
    },
    { id: 'debug', level: debug === true ? 'warn' : 'ok', current: String(debug === true) },
    { id: 'pprof', level: pprof === true ? 'warn' : 'ok', current: String(pprof === true) },
  ];
}

/**
 * 由勾选项生成 PATCH /config 的请求体（只含勾选字段）。
 * overrides：用户在「编辑」里自己填的值（按规则 id），没有则用推荐值。
 */
export function buildRecommendedPatch(
  ruleIds: Iterable<string>,
  overrides: Readonly<Record<string, ConfigScalar>> = {}
): Record<string, unknown> {
  const wanted = new Set(ruleIds);
  const patch: Record<string, unknown> = {};
  for (const rule of RECOMMENDED_RULES) {
    if (!wanted.has(rule.id)) continue;
    const target = Object.prototype.hasOwnProperty.call(overrides, rule.id)
      ? overrides[rule.id]
      : rule.recommended;
    let node = patch;
    rule.path.forEach((key, index) => {
      if (index === rule.path.length - 1) {
        node[key] = target;
      } else {
        if (!isRecord(node[key])) node[key] = {};
        node = node[key] as Record<string, unknown>;
      }
    });
  }
  return patch;
}

export type ValueKind = 'boolean' | 'number' | 'enum' | 'text';

export function valueKind(rule: RecommendedRule): ValueKind {
  if (typeof rule.recommended === 'boolean') return 'boolean';
  if (typeof rule.recommended === 'number') return 'number';
  return rule.options?.length ? 'enum' : 'text';
}

/** 校验并转换「编辑」输入。返回 error 为 i18n 键名后缀（invalid_number / out_of_range / empty）。 */
export function parseEditValue(
  rule: RecommendedRule,
  input: string | boolean
): { value?: ConfigScalar; error?: 'invalid_number' | 'out_of_range' | 'empty' } {
  const kind = valueKind(rule);
  if (kind === 'boolean') return { value: input === true || input === 'true' };
  const text = String(input).trim();
  if (!text) return { error: 'empty' };
  if (kind === 'number') {
    if (!/^-?\d+$/.test(text)) return { error: 'invalid_number' };
    const num = Number(text);
    if ((rule.min !== undefined && num < rule.min) || (rule.max !== undefined && num > rule.max)) {
      return { error: 'out_of_range' };
    }
    return { value: num };
  }
  if (kind === 'enum' && !rule.options?.includes(text)) return { error: 'empty' };
  return { value: text };
}

/** 当前生效值是否等于目标值（目标值可以是推荐值，也可以是自己填的值） */
export function isSameValue(effective: unknown, target: ConfigScalar): boolean {
  return sameScalar(effective, target);
}

/** 还原记录：应用前每个字段的原值（未写入则 present=false，还原时删除该字段） */
export interface UndoEntry {
  path: string[];
  present: boolean;
  value: unknown;
}

export function buildUndoEntries(config: unknown, ruleIds: Iterable<string>): UndoEntry[] {
  const wanted = new Set(ruleIds);
  return RECOMMENDED_RULES.filter((rule) => wanted.has(rule.id)).map((rule) => {
    const { present, value } = readPath(config, rule.path);
    return { path: [...rule.path], present, value };
  });
}

/** 还原：有原值的字段合成 PATCH；原本没写的字段走 DELETE */
export function splitUndo(entries: readonly UndoEntry[]): {
  patch: Record<string, unknown>;
  deletions: string[][];
} {
  const patch: Record<string, unknown> = {};
  const deletions: string[][] = [];
  for (const entry of entries) {
    if (!entry.present) {
      deletions.push(entry.path);
      continue;
    }
    let node = patch;
    entry.path.forEach((key, index) => {
      if (index === entry.path.length - 1) {
        node[key] = entry.value;
      } else {
        if (!isRecord(node[key])) node[key] = {};
        node = node[key] as Record<string, unknown>;
      }
    });
  }
  return { patch, deletions };
}

export function formatValue(value: unknown): string {
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}
