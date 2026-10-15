/**
 * 访客标识（visitorId）的生成与持久化（G6-5.8）。
 *
 * ## 规则（对应任务书「访客识别规则」）
 *   - `visitorId` 由**前端生成**，格式为 **UUID v4**；
 *   - 存放在 **localStorage**（跨标签页、跨刷新共享）；
 *   - 🔴 **不使用 Cookie session、不绑定登录账号、不使用 Customer / User ID** ——
 *     访客统计必须覆盖**未登录用户**（绝大多数流量），
 *     且与认证体系**零关联**。
 *
 * ## 为什么用 localStorage 而不是 Cookie
 *   1. Cookie 会随每个请求发给后端（含静态资源），属无谓的隐私暴露面；
 *   2. 本项目后端 CORS 白名单**不含 Cookie 凭证**（见 `src/common/cors.ts`）；
 *   3. localStorage 里放一个随机 UUID 不构成「会话」，
 *      它既不能认证也不能授权，只是一个去重用的匿名计数键。
 *
 * ## 与 `account/useAccount.ts` 的关系
 *   两者都写 localStorage，但**互不读取**：
 *   访客标识在登出 / 换账号后**保持不变**（匿名流量口径不随登录态变化）。
 */

/** localStorage 键名（带版本号，便于未来更换标识方案）。 */
export const VISITOR_ID_STORAGE_KEY = 'luxrabeauty.visitor.id.v1';

/** UUID v4 的格式校验（与后端 `TrackVisitDto` 的 `@IsUUID('4')` 对齐）。 */
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** 进程内缓存 —— 避免每次路由变化都读一次 localStorage。 */
let cachedVisitorId: string | null = null;

/** 是否已经尝试过读取（区分「还没读」与「读了但没有」）。 */
let loaded = false;

/**
 * 读取 / 生成访客标识。
 *
 * @returns UUID v4 字符串；**持久化不可用时返回 `null`**（调用方据此放弃上报）。
 *
 * 🔴 为什么 localStorage 不可用时**宁可不统计**：
 *    若改用「内存内的临时 ID」，每次刷新页面都会得到一个新 ID ⇒
 *    同一个真实访客会被重复计成多个「独立访客」——
 *    这正是任务书明令禁止的「用 PV 冒充 UV」。
 *    隐私模式 / 禁用存储的流量占比极小，**宁可少统计，也不给出错误的 UV**。
 */
export function ensureVisitorId(): string | null {
  if (loaded) return cachedVisitorId;

  const stored = readStored();
  if (stored) {
    cachedVisitorId = stored;
    loaded = true;
    return cachedVisitorId;
  }

  const generated = generateUuidV4();
  if (!generated) {
    // 连随机数都拿不到（极旧浏览器）⇒ 放弃统计
    loaded = true;
    return null;
  }

  if (!persist(generated)) {
    // 无法持久化 ⇒ 不统计（见上方注释）
    loaded = true;
    return null;
  }

  cachedVisitorId = generated;
  loaded = true;
  return cachedVisitorId;
}

/** 读取已持久化的标识；非法值一律视为「没有」（避免脏数据被当成访客）。 */
function readStored(): string | null {
  try {
    const raw = globalThis.localStorage?.getItem(VISITOR_ID_STORAGE_KEY);
    if (!raw) return null;
    const trimmed = raw.trim();
    return UUID_V4_PATTERN.test(trimmed) ? trimmed : null;
  } catch {
    // localStorage 不可用（隐私模式 / 被禁用）→ 视为没有
    return null;
  }
}

/** 写入标识；失败返回 `false`（**不抛错**）。 */
function persist(value: string): boolean {
  try {
    globalThis.localStorage?.setItem(VISITOR_ID_STORAGE_KEY, value);
    // `setItem` 在存储被禁用时可能静默失败 ⇒ 回读确认，避免「以为存上了」
    return globalThis.localStorage?.getItem(VISITOR_ID_STORAGE_KEY) === value;
  } catch {
    return false;
  }
}

/**
 * 生成 UUID v4。
 *
 * 三级回退（都保证**格式**合法，因为后端 DTO 按 UUID v4 校验）：
 *   1. `crypto.randomUUID()` —— 仅在**安全上下文**（https / localhost）可用，
 *      而本项目局域网 dev 站是 `http://192.168.x.x` ⇒ 该方法**常常不可用**；
 *   2. `crypto.getRandomValues()` —— 非安全上下文同样可用，手工拼装 v4；
 *   3. `Math.random()` —— 最后的兜底。
 *      ⚠️ 它**不是密码学安全**的随机源，但 `visitorId` **不是凭据**：
 *      它既不参与认证、也不授权任何操作，仅用于「同一访客去重」。
 *      在缺少 `crypto` 的环境里，可预测性带来的最坏后果是「访客数被高估」，
 *      而不是任何权限风险。
 */
export function generateUuidV4(): string | null {
  const cryptoObj = globalThis.crypto;

  if (typeof cryptoObj?.randomUUID === 'function') {
    try {
      return cryptoObj.randomUUID();
    } catch {
      // 落到下一级
    }
  }

  if (typeof cryptoObj?.getRandomValues === 'function') {
    try {
      const bytes = cryptoObj.getRandomValues(new Uint8Array(16));
      return formatUuidV4(bytes);
    } catch {
      // 落到下一级
    }
  }

  try {
    const bytes = new Uint8Array(16);
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
    return formatUuidV4(bytes);
  } catch {
    return null;
  }
}

/** 把 16 字节按 RFC 4122 的 v4 布局格式化。 */
function formatUuidV4(bytes: Uint8Array): string {
  // version = 4（第 7 字节高 4 位）、variant = 10xx（第 9 字节高 2 位）
  bytes[6] = ((bytes[6]! & 0x0f) | 0x40) & 0xff;
  bytes[8] = ((bytes[8]! & 0x3f) | 0x80) & 0xff;

  const hex: string[] = [];
  for (let index = 0; index < bytes.length; index += 1) {
    hex.push(bytes[index]!.toString(16).padStart(2, '0'));
  }
  const joined = hex.join('');
  return [
    joined.slice(0, 8),
    joined.slice(8, 12),
    joined.slice(12, 16),
    joined.slice(16, 20),
    joined.slice(20, 32),
  ].join('-');
}

/** 仅供测试使用：重置模块内缓存。生产代码不要调用。 */
export function __resetVisitorIdForTest(): void {
  cachedVisitorId = null;
  loaded = false;
}
