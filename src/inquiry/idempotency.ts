/**
 * 幂等键生成与生命周期。
 *
 * 用途：同一次询价的「重试」必须复用同一个键，服务端据此识别为同一笔提交、
 * 只创建一张订单（防止重复点击 / 网络重试导致重复建单）。
 *
 * 因此这里**只在一次提交周期内复用一个键**，明确成功后才清除；
 * 购物车内容变化时也必须换新键（否则会被服务端当成同一单而返回旧单）。
 */

/** 生成一个高熵随机键（长度 36 或 32，满足后端 8..128 的约束）。 */
export function newIdempotencyKey(): string {
  const webCrypto = globalThis.crypto;

  if (webCrypto && typeof webCrypto.randomUUID === 'function') {
    return webCrypto.randomUUID();
  }

  if (webCrypto && typeof webCrypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    webCrypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  // 极端降级路径：仅用于不支持 Web Crypto 的环境（例如老旧的测试运行器）。
  return `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

/** 后端 SubmitInquiryDto 对 idempotencyKey 的长度约束。 */
export const IDEMPOTENCY_KEY_MIN_LENGTH = 8;
export const IDEMPOTENCY_KEY_MAX_LENGTH = 128;

export function isValidIdempotencyKey(value: string): boolean {
  return value.length >= IDEMPOTENCY_KEY_MIN_LENGTH && value.length <= IDEMPOTENCY_KEY_MAX_LENGTH;
}

/* ------------------------------------------------------------------ */
/* 「待确认的幂等键」生命周期（G6-3.0 任务 A）                          */
/* ------------------------------------------------------------------ */

/**
 * 购物车指纹。
 *
 * 幂等键必须与**购物车内容**绑定：内容一变就得换新键，
 * 否则服务端会把「改了商品后的新询价」当成同一单而返回旧订单。
 * 指纹只取「商品 id + 数量」，与提交载荷里的 `lines` 一一对应。
 *
 * ⚠️ 指纹**不含任何客户隐私**（只有商品 id 与数量），因此可以安全落本地存储。
 */
export function cartFingerprint(
  lines: readonly { productId: string; quantity: number }[],
): string {
  return lines.map((line) => `${line.productId}:${line.quantity}`).join('|');
}

/* ------------------------------------------------------------------ */
/* 提交载荷指纹（G6-3.1 任务 C）                                        */
/* ------------------------------------------------------------------ */

/**
 * 参与指纹的**全部**提交字段。
 *
 * 为什么必须覆盖整个载荷（而不只是购物车）：
 *   服务端幂等的语义是「**同键 = 同一次请求**」—— `submit()` 只按
 *   `idempotency_key` 查单，命中即 `replay()`，**不比较载荷内容**。
 *   因此只要客户端对「改过内容的新请求」复用了旧键，服务端就会把
 *   顾客**新填的信息静默丢弃**、返回旧单（例如：超时后顾客把收货地址
 *   从 A 改成 B 再提交，拿回来的仍是地址 A 的旧单）。
 *   ⇒ 键必须与**全部提交字段**一一绑定：任何字段变化都要换新键。
 */
export interface SubmitFingerprintInput {
  lines: readonly { productId: string; quantity: number }[];
  contactEmail?: string | null;
  contactName?: string | null;
  shippingAddress?: string | null;
  note?: string | null;
  channel?: string | null;
  country?: string | null;
  city?: string | null;
  postalCode?: string | null;
}

/** 指纹前缀：标明算法，便于未来更换算法时安全丢弃旧记录。 */
const SHA256_PREFIX = 'sha256:';

/** SHA-256 轮常量。 */
const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(value: number, bits: number): number {
  return ((value >>> bits) | (value << (32 - bits))) >>> 0;
}

/**
 * **同步** SHA-256（十六进制小写）。
 *
 * 为什么自己实现而不直接用 `crypto.subtle.digest`：
 *   `SubtleCrypto.digest` 是**异步**的。若把它放进提交路径，`onSubmit` 会在
 *   `await` 处让出执行权 —— 既让「连点防重入」守卫出现窗口期，也让所有既有
 *   测试的时序契约失效（实测引发 6 例失败 / 跨用例污染）。摘要只用于
 *   **等价判定**，同步实现可完全避免这些副作用。
 *
 * ⚠️ 本函数只用于「两次载荷是否相同」的判断，**不用于任何安全用途**；
 *    已用 NIST 测试向量在 spec 中锁定正确性。
 */
export function sha256Hex(message: string): string {
  const bytes = new TextEncoder().encode(message);
  const bitLength = bytes.length * 8;

  const paddedLength = (((bytes.length + 9) + 63) & ~63);
  const buffer = new Uint8Array(paddedLength);
  buffer.set(bytes);
  buffer[bytes.length] = 0x80;

  const view = new DataView(buffer.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000), false);
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  const w = new Uint32Array(64);

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      w[index] = view.getUint32(offset + index * 4, false);
    }
    for (let index = 16; index < 64; index += 1) {
      const s0 = rotr(w[index - 15]!, 7) ^ rotr(w[index - 15]!, 18) ^ (w[index - 15]! >>> 3);
      const s1 = rotr(w[index - 2]!, 17) ^ rotr(w[index - 2]!, 19) ^ (w[index - 2]! >>> 10);
      w[index] = (w[index - 16]! + s0 + w[index - 7]! + s1) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let index = 0; index < 64; index += 1) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + SHA256_K[index]! + w[index]!) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((value) => value.toString(16).padStart(8, '0'))
    .join('');
}

/**
 * 把载荷规范化为**确定性字符串**。
 *
 * 规范化规则（保证「语义相同 ⇒ 字符串相同」，避免误换键造成重复建单）：
 *   - 所有文本字段 `trim()`；邮箱再 `toLowerCase()`（大小写不敏感）；
 *   - 渠道统一 `toUpperCase()`；
 *   - 购物车行用**结构化数组** `[id, quantity]` 表达，**不做字符串拼接** ——
 *     彻底消除分隔符碰撞（`cartFingerprint` 的 `id:qty|` 拼接存在理论碰撞，
 *     见 spec 中的设计注记）；
 *   - 行顺序保留（购物车顺序是稳定的，且顺序变化确属不同载荷）。
 */
function canonicalizeSubmitInput(input: SubmitFingerprintInput): string {
  const text = (value: string | null | undefined): string =>
    typeof value === 'string' ? value.trim() : '';

  return JSON.stringify({
    lines: input.lines.map((line) => [text(line.productId), line.quantity]),
    contactEmail: text(input.contactEmail).toLowerCase(),
    contactName: text(input.contactName),
    shippingAddress: text(input.shippingAddress),
    note: text(input.note),
    channel: text(input.channel).toUpperCase(),
    country: text(input.country),
    city: text(input.city),
    postalCode: text(input.postalCode),
  });
}

/**
 * 计算提交载荷指纹（**隐私安全**：只落摘要，绝不落任何 PII 明文）。
 *
 * 为什么是摘要而不是明文：
 *   指纹要写进 `localStorage`。项目既有约定是「访问凭证等敏感信息只放内存、
 *   绝不落本地存储」，因此这里对载荷做**不可逆摘要**，本地只保存 64 位十六进制
 *   摘要值 —— 既能把键与载荷绑定，又不会把邮箱 / 地址 / 备注写进磁盘。
 *
 * 为什么是**同步**的：见 `sha256Hex` 的说明（避免 await 破坏防重入与测试时序）。
 *
 * @returns 购物车为空时返回 `''`（空购物车不构成可提交询价，不落任何记录）；
 *          否则返回 `sha256:<64 位十六进制>`。
 */
export function submitFingerprint(input: SubmitFingerprintInput): string {
  if (input.lines.length === 0) return '';
  return SHA256_PREFIX + sha256Hex(canonicalizeSubmitInput(input));
}

/** 本地存储键名（带版本号，便于未来结构升级时安全丢弃旧数据）。 */
export const PENDING_KEY_STORAGE_KEY = 'luxrabeauty.inquiry.pending-key.v1';

/**
 * 待确认键的**有效期**（默认 24 小时）。
 *
 * 语义：一条「尚未确认结果」的记录，超过该时长后**不再被复用** ——
 * 顾客隔天再用同一购物车提交，视为**一笔新询价**，生成新键。
 *
 * 为什么是 24h（而不是永久、也不是几分钟）：
 *   - **不能永久复用**：否则同一份购物车在数月后再次提交仍会命中旧单，
 *     顾客会拿到「旧订单」而不自知（服务端按键返回原单，不比较内容）。
 *   - **不能太短**：一次真实重试（超时 / 断网 / 刷新后重试）通常发生在
 *     分钟到小时量级；窗口太短会让「结果未知」的提交在刷新后被换新键，
 *     反而**重复建单**（这正是本轮要修的问题）。
 *   24h 远大于真实重试窗口，又远小于「下一次真实询价」的间隔。
 *
 * ⚠️ 这是**客户端复用窗口**，与服务端幂等记录（永久唯一约束、无 TTL）无关：
 *    即便客户端因过期换了新键，服务端也只是「不认识这个新键」而新建一单 ——
 *    真正的重复风险仅在「首次提交其实已成功 + 顾客 >24h 后仍用同一购物车重提」，
 *    该场景概率低且可人工合并，故接受此取舍。
 */
export const PENDING_KEY_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * 落盘的记录结构（**刻意最小化**：只存指纹 / 键 / 时间，不含任何隐私或凭证）。
 *
 * ⚠️ 存储里的**容器**是这种记录的数组（多槽），见 `MAX_PENDING_RECORDS`；
 *    读取侧同时容忍「单条旧结构」（G6-3.0 的写法）以便升级时**不丢失**未决键。
 */
interface PendingKeyRecord {
  /** 结构版本，不匹配即视为无效并丢弃。 */
  v: number;
  fingerprint: string;
  key: string;
  createdAt: number;
}

const SCHEMA_VERSION = 1;

/**
 * 本地最多保留的**待确认记录条数**（多槽上限）。
 *
 * 为什么必须是「多条」而不是单条：
 *   单槽下 `A → B → A` 会把 A 的原键挤掉，顾客切回 A 重试时只能拿到**新键**，
 *   服务端视为一笔新请求 ⇒ **重复建单**。多标签页（各持不同购物车）同理。
 * 为什么要有上限：
 *   记录常驻 `localStorage`，无上限会随使用无限增长；8 条远大于
 *   「同一浏览器同时未决的询价数」，又足够小到可忽略占用。
 */
export const MAX_PENDING_RECORDS = 8;

/** localStorage 不可用时的进程内降级存储（仅损失「跨刷新复用」能力）。 */
let memoryFallback: PendingKeyRecord[] = [];

function getStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    // 隐私模式 / 被策略禁用时，访问 localStorage 本身就可能抛错。
    return null;
  }
}

/** 把任意读到的值规整成合法记录；结构不符（损坏 / 旧版本 / 缺字段）返回 null。 */
function normalizeRecord(raw: unknown): PendingKeyRecord | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const record = raw as Record<string, unknown>;
  if (record.v !== SCHEMA_VERSION) return null;
  if (typeof record.fingerprint !== 'string') return null;
  if (typeof record.key !== 'string' || !isValidIdempotencyKey(record.key)) return null;
  if (typeof record.createdAt !== 'number' || !Number.isFinite(record.createdAt)) return null;
  return {
    v: SCHEMA_VERSION,
    fingerprint: record.fingerprint,
    key: record.key,
    createdAt: record.createdAt,
  };
}

/** 把任意读到的值规整成合法记录数组（容忍「数组新结构」与「单条旧结构」）。 */
function normalizeRecords(raw: unknown): PendingKeyRecord[] {
  // 单条旧结构（G6-3.0）⇒ 包成单元素数组，升级时**不丢**顾客的未决键。
  const list = Array.isArray(raw) ? raw : [raw];
  const result: PendingKeyRecord[] = [];
  for (const item of list) {
    const record = normalizeRecord(item);
    if (record) result.push(record);
  }
  return result;
}

/** 丢弃超过复用窗口的记录。 */
function pruneExpired(
  records: readonly PendingKeyRecord[],
  now: number,
): PendingKeyRecord[] {
  return records.filter((record) => !isExpired(record, now));
}

/**
 * 按「新在前」排序（`createdAt` 降序；同值保持原顺序）。
 *
 * 用途：截断上限时**优先保留最新的记录**（最可能仍属未决询价的那几条）。
 */
function sortNewestFirst(records: readonly PendingKeyRecord[]): PendingKeyRecord[] {
  return records
    .map((record, index) => ({ record, index }))
    .sort((a, b) => b.record.createdAt - a.record.createdAt || a.index - b.index)
    .map((entry) => entry.record);
}

/** 只读存储里的记录（**不做时效过滤、不回落内存**）。 */
function readStoredRecords(): PendingKeyRecord[] {
  const storage = getStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(PENDING_KEY_STORAGE_KEY);
    // 数据损坏（非法 JSON 等）⇒ 视为无记录，绝不抛错打断提交。
    return raw ? normalizeRecords(JSON.parse(raw)) : [];
  } catch {
    // 读取本身抛错（隐私模式 / 被策略禁用）⇒ 视为无记录。
    return [];
  }
}

/** 把记录写回存储；空数组 ⇒ 直接删除键，不留空壳。 */
function persistRecords(records: readonly PendingKeyRecord[]): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    if (records.length === 0) storage.removeItem(PENDING_KEY_STORAGE_KEY);
    else storage.setItem(PENDING_KEY_STORAGE_KEY, JSON.stringify(records));
  } catch {
    // 写入失败（配额 / 隐私模式）⇒ 以进程内镜像为准，不抛错。
  }
}

/**
 * 读出**未过期**的待确认记录（新在前）。
 *
 * 存储里没有可用记录时**回落到进程内记录**：
 *   `writeRecords` 在 `setItem` 抛错（配额超限 / 隐私模式）时会退化为写内存镜像。
 *   若读取侧只看存储，就会「写进了内存却永远读不到」⇒ 降级路径**静默失去去重
 *   能力**，同一笔询价重试时会换新键、重复建单。（G6-3.1 任务 C 发现并修复。）
 */
function readRecords(now: number): PendingKeyRecord[] {
  const stored = pruneExpired(readStoredRecords(), now);
  if (stored.length > 0) return stored;
  return pruneExpired(memoryFallback, now);
}

function writeRecords(records: readonly PendingKeyRecord[]): void {
  const capped = sortNewestFirst(records).slice(0, MAX_PENDING_RECORDS);
  // 进程内**镜像**始终与最后一次写入保持一致：
  // 存储可用时它是备份，存储不可用 / 写失败时它就是唯一副本。
  memoryFallback = capped;
  persistRecords(capped);
}

/**
 * 删除待确认记录。
 *
 * @param fingerprint 省略 ⇒ 清空**全部**记录（测试重置 / 显式作废全部）；
 *                    给出 ⇒ **只**删除该指纹的记录，其它未决询价不受影响。
 *
 * 为什么要支持按指纹删除：多槽之后，一次「提交成功」或 409 失效只应作废**它自己**
 * 那条记录；若仍然整表清空，就会把其它标签页里仍未决的询价键一并丢掉，
 * 反而给它们制造重复建单的机会。
 */
function removeRecords(fingerprint?: string): void {
  if (fingerprint === undefined) {
    memoryFallback = [];
    persistRecords([]);
    return;
  }

  memoryFallback = memoryFallback.filter((record) => record.fingerprint !== fingerprint);
  persistRecords(
    readStoredRecords().filter((record) => record.fingerprint !== fingerprint),
  );
}

/** 记录是否已超过复用窗口。时钟回拨（createdAt 在未来）按「未过期」处理。 */
function isExpired(record: PendingKeyRecord, now: number): boolean {
  return now - record.createdAt > PENDING_KEY_TTL_MS;
}

/**
 * 取本次提交要用的幂等键。
 *
 * 规则：
 *   - 存在**同一指纹且未过期**的待确认记录 ⇒ **复用**其键（重试 / 刷新 / 多标签页都命中同一条记录）；
 *   - 否则（首次提交 / 载荷变化 / 记录过期 / 数据损坏）⇒ 生成新键并落盘。
 *
 * 多槽（G6-3.1 任务 E）：写入时**保留其它指纹的记录** —— 单槽会让 `A → B → A`
 * 丢掉 A 的原键，顾客切回 A 重试时会换新键 ⇒ 重复建单。
 *
 * 多标签页：记录存在**共享的 localStorage**（`sessionStorage` 是每标签页独立，无法共享，
 * 故不采用）。收敛靠两次读：
 *   ① 写入**前**再读一次 —— 若另一标签页已为同一指纹写入，直接采用它的键（不覆盖）；
 *   ② 写入**后**回读一次 —— 若期间另一标签页抢先写入，采用它的键。
 * 两次读把「两标签页各持不同键、各自建单」的窗口压到最小。
 *
 * @param fingerprint 提交载荷指纹（`submitFingerprint(...)`）。
 * @param now         当前时间戳（毫秒），默认 `Date.now()`；仅供测试注入。
 */
export function acquireIdempotencyKey(fingerprint: string, now: number = Date.now()): string {
  // 空购物车不构成可提交的询价，不落任何记录（也避免残留 fingerprint='' 的记录）。
  if (fingerprint.length === 0) return newIdempotencyKey();

  const existing = readRecords(now);
  const hit = existing.find((record) => record.fingerprint === fingerprint);
  if (hit) return hit.key;

  // ① 写入前重读：另一标签页可能刚为同一指纹写入 ⇒ 直接采用，避免互相覆盖。
  const latest = readRecords(now);
  const raced = latest.find((record) => record.fingerprint === fingerprint);
  if (raced) return raced.key;

  const record: PendingKeyRecord = {
    v: SCHEMA_VERSION,
    fingerprint,
    key: newIdempotencyKey(),
    createdAt: now,
  };
  writeRecords([record, ...latest]);

  // ② 写入后回读：期间另一标签页抢先写入同一指纹 ⇒ 采用它的键（两标签页收敛）。
  const stored = readRecords(now).find((item) => item.fingerprint === fingerprint);
  return stored ? stored.key : record.key;
}

/**
 * 当前指纹是否有一笔**结果未知**的未决询价（G6-3.1 任务 E）。
 *
 * 用途：让结算 / 询价页在**刷新后**仍能提示顾客「上一笔提交结果未知」。
 * 否则刷新会丢掉全部上下文，顾客可能顺手改几个字重新提交 —— 载荷一变就换新键，
 * 于是**重复建单**（这正是幂等键存在的意义被绕开的路径）。
 *
 * @returns 指纹为空（空购物车）⇒ 恒 `false`。
 */
export function hasPendingKey(fingerprint: string, now: number = Date.now()): boolean {
  if (fingerprint.length === 0) return false;
  return readRecords(now).some((record) => record.fingerprint === fingerprint);
}

/**
 * 释放待确认的键 —— **「标记该次提交已结束」的唯一入口**。
 *
 * 调用时机（与契约一致）：
 *   - 提交**明确成功**（服务端已返回订单号）⇒ 该笔询价已完成，下一笔换新键；
 *   - 收到 409「商品不可询价」⇒ 原键绑定的购物车已失效，必须换新键。
 *
 * ⚠️ **不得**在「结果未知」（超时 / 断网）时调用 —— 那会导致刷新后换新键、
 *    把「可能已建单」的提交变成重复建单。
 *
 * @param fingerprint 建议**总是**传入本次提交的指纹：多槽存储下只作废这一条记录，
 *                    其它标签页里仍未决的询价键不受影响。省略则清空全部记录
 *                    （仅供测试重置等场景使用）。
 */
export function releaseIdempotencyKey(fingerprint?: string): void {
  removeRecords(fingerprint);
}

/** 仅供测试使用：清空存储与内存降级。 */
export function __resetIdempotencyForTest(): void {
  removeRecords();
}
