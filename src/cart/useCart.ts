import { computed, ref, type ComputedRef, type Ref } from 'vue';
import { formatCents, parseMoneyToCents } from '@/common/money';

/**
 * 游客购物车（本地持久化）。
 *
 * 说明：
 *   - 游客**无需登录**即可加购并提交询价；
 *   - 本阶段购物车只存在浏览器 localStorage 中，不做库存扣减、不与后端同步；
 *   - 提交询价时把购物车行作为「商品快照」一起提交（阶段 4 实现）。
 */

export const GUEST_CART_STORAGE_KEY = 'luxrabeauty.guest.cart.v1';

/**
 * 单行数量上限。
 *
 * ⚠️ **这不是本轮新加的业务限制**：商品详情页与购物车的数量输入框本来就声明了
 *    `max="99"`（见 `ProductDetailPage.vue` / `CartPage.vue`）。
 *    此前它只是 HTML 属性 —— 只要输入路径不是「用户手打」（`v-model.number` 收到
 *    `1e5`、程序化调用 `setQuantity`、粘贴超长数字）就能绕过，导致
 *    「界面显示上限 99、实际存了 100000」。
 *    这里把同一条既有规则下沉到状态层，保证声明与存储永远一致。
 */
export const MAX_LINE_QUANTITY = 99;

/**
 * 把任意输入规整成合法的行数量。
 *
 * 返回 `null` 表示**这次输入不构成一次有效变更**（非数字 / 非有限数 / NaN / ≤ 0），
 * 调用方据此决定「忽略」还是「删除该行」—— **绝不把非法值写进购物车**。
 *
 * 合法值会被截断为整数并夹到 `[1, MAX_LINE_QUANTITY]`。
 * 之所以必须夹整数：`isCartLine()` 在读取 localStorage 时要求
 * `Number.isInteger(quantity)`，一个 1.5 会被持久化后在下次加载时**整行丢掉**。
 */
export function normalizeLineQuantity(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const truncated = Math.trunc(value);
  if (truncated <= 0) return null;
  return Math.min(truncated, MAX_LINE_QUANTITY);
}

/** 数量输入框一次提交应当产生的动作。 */
export type QuantityInputOutcome =
  | { kind: 'set'; quantity: number }
  | { kind: 'remove' }
  | { kind: 'invalid' };

/**
 * 把数量输入框的**原始文本**解析成一个明确动作（纯函数，便于单测）。
 *
 * 为什么不能直接 `Number(input.value)`：
 *   `<input type="number">` 在用户清空或输入非法内容时，`.value` 返回**空串**，
 *   而 `Number('') === 0` —— 于是「清空重打」会被误判成「数量 0」而删掉整行。
 *   这里把四种情况分开：
 *     - 空串 / 非数字 / 负数 / 非有限数 → `invalid`（调用方还原输入框，不动购物车）；
 *     - 明确 `0`                        → `remove`（沿用既有约定：数量归零 = 移除该行）；
 *     - 合法正整数                      → `set`，并截断为整数、夹到 [1, 99]。
 */
export function parseQuantityInput(raw: string): QuantityInputOutcome {
  const trimmed = raw.trim();
  if (trimmed === '') return { kind: 'invalid' };

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return { kind: 'invalid' };

  /**
   * ⚠️ 负数必须在**截断之前**判断。
   *
   * `Math.trunc(-0.5) === -0`，而 `-0 === 0` 为 true ——
   * 若先截断再判 `=== 0`，`-0.5` 会被判成 `remove`（静默删掉整行），
   * 与 `-2` 判 `invalid` 自相矛盾。先看符号即可让所有负数统一为 `invalid`。
   */
  if (parsed < 0) return { kind: 'invalid' };

  const truncated = Math.trunc(parsed);
  if (truncated === 0) return { kind: 'remove' };

  return { kind: 'set', quantity: Math.min(truncated, MAX_LINE_QUANTITY) };
}

export interface CartLine {
  productId: string;
  slug: string;
  name: string;
  /** 提交时的单价快照（字符串，与后端 DECIMAL 表示一致） */
  unitPrice: string;
  currency: string;
  imageUrl: string | null;
  quantity: number;
}

const lines = ref<CartLine[]>([]);
let loadedFromStorage = false;

function isCartLine(value: unknown): value is CartLine {
  if (typeof value !== 'object' || value === null) return false;
  const line = value as Record<string, unknown>;
  return (
    typeof line.productId === 'string' &&
    typeof line.slug === 'string' &&
    typeof line.name === 'string' &&
    typeof line.unitPrice === 'string' &&
    typeof line.currency === 'string' &&
    (typeof line.imageUrl === 'string' || line.imageUrl === null) &&
    typeof line.quantity === 'number' &&
    Number.isInteger(line.quantity) &&
    line.quantity > 0
  );
}

function loadFromStorage(): void {
  try {
    const raw = globalThis.localStorage?.getItem(GUEST_CART_STORAGE_KEY);
    if (!raw) {
      lines.value = [];
      return;
    }
    const parsed: unknown = JSON.parse(raw);
    lines.value = Array.isArray(parsed) ? parsed.filter(isCartLine) : [];
  } catch {
    // 数据损坏 / 存储不可用 → 视为空购物车，不影响页面渲染
    lines.value = [];
  }
}

function ensureLoaded(): void {
  if (loadedFromStorage) return;
  loadFromStorage();
  loadedFromStorage = true;
}

function persist(): void {
  try {
    globalThis.localStorage?.setItem(GUEST_CART_STORAGE_KEY, JSON.stringify(lines.value));
  } catch {
    // 持久化失败时静默降级
  }
}

export interface GuestCartApi {
  readonly lines: Ref<CartLine[]>;
  readonly totalQuantity: ComputedRef<number>;
  readonly subtotalCents: ComputedRef<number>;
  readonly subtotal: ComputedRef<string>;
  readonly isEmpty: ComputedRef<boolean>;
  readonly addLine: (line: Omit<CartLine, 'quantity'>, quantity?: number) => void;
  readonly setQuantity: (productId: string, quantity: number) => void;
  readonly removeLine: (productId: string) => void;
  readonly clear: () => void;
}

export function useCart(): GuestCartApi {
  ensureLoaded();

  const totalQuantity = computed(() =>
    lines.value.reduce((sum, line) => sum + line.quantity, 0),
  );

  const subtotalCents = computed(() =>
    lines.value.reduce(
      (sum, line) => sum + parseMoneyToCents(line.unitPrice) * line.quantity,
      0,
    ),
  );

  const subtotal = computed(() => formatCents(subtotalCents.value));
  const isEmpty = computed(() => lines.value.length === 0);

  function addLine(line: Omit<CartLine, 'quantity'>, quantity = 1): void {
    const normalized = normalizeLineQuantity(quantity);
    if (normalized === null) return; // 非法数量：不写入任何东西
    const existing = lines.value.find((item) => item.productId === line.productId);
    if (existing) {
      existing.quantity = Math.min(existing.quantity + normalized, MAX_LINE_QUANTITY);
    } else {
      lines.value = [...lines.value, { ...line, quantity: normalized }];
    }
    persist();
  }

  function setQuantity(productId: string, quantity: number): void {
    const normalized = normalizeLineQuantity(quantity);
    if (normalized === null) {
      /**
       * 只有「明确的 ≤ 0」才按既有约定移除该行；
       * `NaN` / 非有限数属于**输入错误**（例如用户清空了数量框），
       * 此时必须保持原值不动 —— 静默删掉一行商品比不做任何事更糟。
       */
      const isExplicitZeroOrNegative =
        typeof quantity === 'number' && Number.isFinite(quantity) && Math.trunc(quantity) <= 0;
      if (isExplicitZeroOrNegative) removeLine(productId);
      return;
    }
    const existing = lines.value.find((item) => item.productId === productId);
    if (!existing) return;
    existing.quantity = normalized;
    persist();
  }

  function removeLine(productId: string): void {
    lines.value = lines.value.filter((item) => item.productId !== productId);
    persist();
  }

  function clear(): void {
    lines.value = [];
    persist();
  }

  return { lines, totalQuantity, subtotalCents, subtotal, isEmpty, addLine, setQuantity, removeLine, clear };
}

/** 仅供测试使用。 */
export function __resetGuestCartForTest(): void {
  lines.value = [];
  loadedFromStorage = false;
}
