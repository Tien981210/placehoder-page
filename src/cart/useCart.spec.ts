import { beforeEach, describe, expect, it } from 'vitest';
import {
  __resetGuestCartForTest,
  GUEST_CART_STORAGE_KEY,
  MAX_LINE_QUANTITY,
  normalizeLineQuantity,
  parseQuantityInput,
  useCart,
} from './useCart';

const SAMPLE = {
  productId: '01920000-0000-7000-8000-000000000001',
  slug: 'cloud-cat-tower',
  name: '云朵猫爬架',
  unitPrice: '129.00',
  currency: 'USD',
  imageUrl: null,
};

describe('useCart（游客购物车）', () => {
  beforeEach(() => {
    localStorage.clear();
    __resetGuestCartForTest();
  });

  it('初始为空', () => {
    const cart = useCart();
    expect(cart.isEmpty.value).toBe(true);
    expect(cart.totalQuantity.value).toBe(0);
    expect(cart.subtotal.value).toBe('0.00');
  });

  it('加入商品后计算数量与小计', () => {
    const cart = useCart();
    cart.addLine(SAMPLE, 2);

    expect(cart.lines.value).toHaveLength(1);
    expect(cart.totalQuantity.value).toBe(2);
    expect(cart.subtotal.value).toBe('258.00');
  });

  it('重复加入同一商品累加数量而不是新增行', () => {
    const cart = useCart();
    cart.addLine(SAMPLE, 1);
    cart.addLine(SAMPLE, 3);

    expect(cart.lines.value).toHaveLength(1);
    expect(cart.lines.value[0]?.quantity).toBe(4);
  });

  it('持久化到 localStorage', () => {
    const cart = useCart();
    cart.addLine(SAMPLE, 1);
    expect(localStorage.getItem(GUEST_CART_STORAGE_KEY)).toContain('cloud-cat-tower');
  });

  it('数量设为 0 等价于移除该行', () => {
    const cart = useCart();
    cart.addLine(SAMPLE, 2);
    cart.setQuantity(SAMPLE.productId, 0);

    expect(cart.lines.value).toHaveLength(0);
  });

  it('移除与清空', () => {
    const cart = useCart();
    cart.addLine(SAMPLE, 1);
    cart.removeLine(SAMPLE.productId);
    expect(cart.isEmpty.value).toBe(true);

    cart.addLine(SAMPLE, 1);
    cart.clear();
    expect(cart.isEmpty.value).toBe(true);
  });

  it('忽略损坏的存储数据', () => {
    localStorage.setItem(GUEST_CART_STORAGE_KEY, '{not-json');
    __resetGuestCartForTest();
    const cart = useCart();
    expect(cart.isEmpty.value).toBe(true);
  });

  it('过滤掉结构不合法的行', () => {
    const validLine = { ...SAMPLE, quantity: 2 };
    localStorage.setItem(
      GUEST_CART_STORAGE_KEY,
      JSON.stringify([validLine, { productId: 'x' }, { ...validLine, quantity: 0 }]),
    );
    __resetGuestCartForTest();
    const cart = useCart();
    expect(cart.lines.value).toHaveLength(1);
    expect(cart.lines.value[0]?.quantity).toBe(2);
  });

  /* ---------------- 数量非法值防护（G6-2.6 任务 B） ---------------- */

  it('addLine 忽略非法数量，不写入任何行', () => {
    const cart = useCart();
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, 0, -3]) {
      cart.addLine(SAMPLE, bad);
    }
    expect(cart.lines.value).toHaveLength(0);
    expect(cart.totalQuantity.value).toBe(0);
  });

  it('setQuantity 收到 NaN 时保持原值，绝不删行', () => {
    const cart = useCart();
    cart.addLine(SAMPLE, 3);
    cart.setQuantity(SAMPLE.productId, Number.NaN);

    expect(cart.lines.value).toHaveLength(1);
    expect(cart.lines.value[0]?.quantity).toBe(3);
  });

  it('非整数数量被截断为整数（否则刷新后整行会被丢弃）', () => {
    const cart = useCart();
    cart.addLine(SAMPLE, 2);
    cart.setQuantity(SAMPLE.productId, 1.5);
    expect(cart.lines.value[0]?.quantity).toBe(1);

    // 持久化的是整数 ⇒ 重新加载不会被 isCartLine 过滤掉
    __resetGuestCartForTest();
    const reloaded = useCart();
    expect(reloaded.lines.value).toHaveLength(1);
    expect(reloaded.lines.value[0]?.quantity).toBe(1);
  });

  it('数量被夹到既有上限，累加同样受约束', () => {
    const cart = useCart();
    cart.addLine(SAMPLE, 1000);
    expect(cart.lines.value[0]?.quantity).toBe(MAX_LINE_QUANTITY);

    cart.setQuantity(SAMPLE.productId, MAX_LINE_QUANTITY - 1);
    cart.addLine(SAMPLE, 50);
    expect(cart.lines.value[0]?.quantity).toBe(MAX_LINE_QUANTITY);
  });

  it('金额不会因非法数量而变成 NaN', () => {
    const cart = useCart();
    cart.addLine(SAMPLE, 2);
    cart.setQuantity(SAMPLE.productId, Number.NaN);
    expect(cart.subtotal.value).toBe('258.00');
  });

  it('normalizeLineQuantity 的边界', () => {
    expect(normalizeLineQuantity(Number.NaN)).toBeNull();
    expect(normalizeLineQuantity(Number.POSITIVE_INFINITY)).toBeNull();
    expect(normalizeLineQuantity(0)).toBeNull();
    expect(normalizeLineQuantity(-1)).toBeNull();
    expect(normalizeLineQuantity('3')).toBeNull();
    expect(normalizeLineQuantity(1)).toBe(1);
    expect(normalizeLineQuantity(2.9)).toBe(2);
    expect(normalizeLineQuantity(MAX_LINE_QUANTITY + 1)).toBe(MAX_LINE_QUANTITY);
  });

  it('parseQuantityInput 区分「输入错误」与「明确的 0」', () => {
    expect(parseQuantityInput('')).toEqual({ kind: 'invalid' });
    expect(parseQuantityInput('   ')).toEqual({ kind: 'invalid' });
    expect(parseQuantityInput('abc')).toEqual({ kind: 'invalid' });
    expect(parseQuantityInput('-2')).toEqual({ kind: 'invalid' });
    expect(parseQuantityInput('0')).toEqual({ kind: 'remove' });
    expect(parseQuantityInput('7')).toEqual({ kind: 'set', quantity: 7 });
    expect(parseQuantityInput('2.9')).toEqual({ kind: 'set', quantity: 2 });
    expect(parseQuantityInput('9999')).toEqual({ kind: 'set', quantity: MAX_LINE_QUANTITY });
  });

  it('parseQuantityInput 对 (-1, 0) 区间的负数不得判为删行（-0 陷阱）', () => {
    // Math.trunc(-0.5) === -0，而 -0 === 0 ⇒ 若先截断再判 0 会被误判成 remove（静默删行）
    expect(parseQuantityInput('-0.5')).toEqual({ kind: 'invalid' });
    expect(parseQuantityInput('-0.9')).toEqual({ kind: 'invalid' });
    expect(parseQuantityInput('-0.1')).toEqual({ kind: 'invalid' });
    // 与其它负数保持一致
    expect(parseQuantityInput('-2')).toEqual({ kind: 'invalid' });
    expect(parseQuantityInput('-1')).toEqual({ kind: 'invalid' });
    // 真正的 0 仍然归零删行（含 -0 字面量，语义就是 0）
    expect(parseQuantityInput('0')).toEqual({ kind: 'remove' });
    expect(parseQuantityInput('0.0')).toEqual({ kind: 'remove' });
    expect(parseQuantityInput('-0')).toEqual({ kind: 'remove' });
  });

  /* ---------------- G6-2.9 任务 B：输入域边界补测 ---------------- */

  it('parseQuantityInput 覆盖全部分类：空串 / 非数字 / 负数 / 零 / 小数 / 极大数', () => {
    // 空串与纯空白（清空输入框）
    expect(parseQuantityInput('')).toEqual({ kind: 'invalid' });
    expect(parseQuantityInput('   ')).toEqual({ kind: 'invalid' });
    // 非数字
    expect(parseQuantityInput('abc')).toEqual({ kind: 'invalid' });
    expect(parseQuantityInput('1.2.3')).toEqual({ kind: 'invalid' });
    expect(parseQuantityInput('1e')).toEqual({ kind: 'invalid' });
    // 负数（整数 / 小数 / 极小值）
    expect(parseQuantityInput('-1')).toEqual({ kind: 'invalid' });
    expect(parseQuantityInput('-1.5')).toEqual({ kind: 'invalid' });
    expect(parseQuantityInput('-1e-9')).toEqual({ kind: 'invalid' });
    // 零
    expect(parseQuantityInput('0')).toEqual({ kind: 'remove' });
    expect(parseQuantityInput('0.0')).toEqual({ kind: 'remove' });
    expect(parseQuantityInput('0.4')).toEqual({ kind: 'remove' });
    // 小数（向下截断）
    expect(parseQuantityInput('2.9')).toEqual({ kind: 'set', quantity: 2 });
    expect(parseQuantityInput('3.0000001')).toEqual({ kind: 'set', quantity: 3 });
    // 极大数 / 科学计数法 —— 一律夹到既有上限 99，绝不写入巨大值
    expect(parseQuantityInput('9999')).toEqual({ kind: 'set', quantity: MAX_LINE_QUANTITY });
    expect(parseQuantityInput('999999999999')).toEqual({ kind: 'set', quantity: MAX_LINE_QUANTITY });
    expect(parseQuantityInput('1e3')).toEqual({ kind: 'set', quantity: MAX_LINE_QUANTITY });
    expect(parseQuantityInput('1e21')).toEqual({ kind: 'set', quantity: MAX_LINE_QUANTITY });
    // 溢出成 Infinity ⇒ 非有限数 ⇒ 输入错误（不得夹成 99）
    expect(parseQuantityInput('1e309')).toEqual({ kind: 'invalid' });
  });

  it('normalizeLineQuantity 对极大数 / 科学计数法同样夹到上限', () => {
    expect(normalizeLineQuantity(1e3)).toBe(MAX_LINE_QUANTITY);
    expect(normalizeLineQuantity(1e21)).toBe(MAX_LINE_QUANTITY);
    expect(normalizeLineQuantity(Number.MAX_SAFE_INTEGER)).toBe(MAX_LINE_QUANTITY);
    expect(normalizeLineQuantity(Number.POSITIVE_INFINITY)).toBeNull();
    expect(normalizeLineQuantity(Number.NEGATIVE_INFINITY)).toBeNull();
    expect(normalizeLineQuantity(-0.5)).toBeNull();
  });

  it('多行时「行小计之和」恒等于总小计（分运算，无浮点误差）', () => {
    const cart = useCart();
    cart.addLine({ ...SAMPLE, productId: 'p-a', unitPrice: '0.10' }, 3); // 0.30
    cart.addLine({ ...SAMPLE, productId: 'p-b', unitPrice: '0.20' }, 3); // 0.60
    cart.addLine({ ...SAMPLE, productId: 'p-c', unitPrice: '19.99' }, 7); // 139.93

    const rowSum = cart.lines.value.reduce(
      (sum, line) => sum + Math.round(Number(line.unitPrice) * 100) * line.quantity,
      0,
    );
    expect(cart.subtotalCents.value).toBe(rowSum);
    expect(cart.subtotal.value).toBe('140.83');
    expect(cart.totalQuantity.value).toBe(13);
  });

  it('数量变化后小计同步更新（增减与删除都反映到金额）', () => {
    const cart = useCart();
    cart.addLine(SAMPLE, 2); // 129.00 × 2 = 258.00
    expect(cart.subtotal.value).toBe('258.00');

    cart.setQuantity(SAMPLE.productId, 3);
    expect(cart.subtotal.value).toBe('387.00');

    cart.setQuantity(SAMPLE.productId, 0); // 归零 = 移除
    expect(cart.subtotal.value).toBe('0.00');
    expect(cart.lines.value).toHaveLength(0);
  });
});
