import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import { beforeEach, describe, expect, it } from 'vitest';
import { GUEST_CART_STORAGE_KEY, __resetGuestCartForTest, useCart } from '@/cart/useCart';
import { __resetNewTabPreferenceForTest } from '@/composables/useNewTabPreference';
import CartPage from './CartPage.vue';

/**
 * 购物车页测试（G6-2.6 任务 B 补齐）。
 *
 * 此前本项目没有 CartPage 的组件测试 —— 数量输入框的「非法输入」路径
 * 完全没有被覆盖。这里聚焦「界面显示与购物车真实状态是否一致」：
 *   - 空态、行渲染、数量增减、移除、清空；
 *   - 非法数量输入**不得**误删整行；
 *   - 明确的 0 沿用既有约定（移除该行）；
 *   - 超上限的数量被规整并回显。
 */

const Dummy = { template: '<div />' };

const LINE = {
  productId: 'p-vest',
  slug: 'cat-vest',
  name: '猫咪弹力毛衣',
  unitPrice: '88.00',
  currency: 'CNY',
  imageUrl: null,
};

async function mountPage(): Promise<{ wrapper: VueWrapper; router: Router }> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: Dummy },
      { path: '/products', name: 'products', component: Dummy },
      { path: '/products/:slug', name: 'product-detail', component: Dummy },
      { path: '/cart', name: 'cart', component: CartPage },
      { path: '/checkout', name: 'checkout', component: Dummy },
    ],
  });
  await router.push('/cart');
  await router.isReady();

  const wrapper = mount(CartPage, { global: { plugins: [router] } });
  await flushPromises();
  return { wrapper, router };
}

/** 直接改输入框的值并派发 change（模拟用户改完数量后失焦）。 */
async function commitQuantity(wrapper: VueWrapper, value: string): Promise<void> {
  const input = wrapper.get('.qty-control__input');
  (input.element as HTMLInputElement).value = value;
  await input.trigger('change');
  await flushPromises();
}

beforeEach(() => {
  localStorage.clear();
  __resetGuestCartForTest();
  __resetNewTabPreferenceForTest();
});

describe('CartPage（购物车）', () => {
  it('购物车为空时渲染空状态并提供浏览商品入口', async () => {
    const { wrapper } = await mountPage();

    expect(wrapper.text()).toContain('询价清单是空的');
    expect(wrapper.find('.cart-table').exists()).toBe(false);
  });

  it('渲染行、总件数与商品小计（整数分运算，无浮点误差）', async () => {
    useCart().addLine(LINE, 3);
    const { wrapper } = await mountPage();

    expect(wrapper.text()).toContain('猫咪弹力毛衣');
    expect(wrapper.text()).toContain('共 3 件商品');
    // 88.00 × 3 = 264.00
    expect(wrapper.text()).toContain('¥264.00');
  });

  it('加号按钮累加数量，减号按钮减到 0 时移除该行', async () => {
    useCart().addLine(LINE, 1);
    const { wrapper } = await mountPage();

    const buttons = wrapper.findAll('.qty-control__btn');
    await buttons[1]!.trigger('click'); // +
    await flushPromises();
    expect(useCart().lines.value[0]?.quantity).toBe(2);

    await buttons[0]!.trigger('click'); // −
    await wrapper.findAll('.qty-control__btn')[0]!.trigger('click'); // − → 0
    await flushPromises();
    expect(useCart().isEmpty.value).toBe(true);
  });

  it('清空输入框不会误删整行（非法输入还原为当前数量）', async () => {
    useCart().addLine(LINE, 4);
    const { wrapper } = await mountPage();

    await commitQuantity(wrapper, '');

    expect(useCart().lines.value).toHaveLength(1);
    expect(useCart().lines.value[0]?.quantity).toBe(4);
    expect((wrapper.get('.qty-control__input').element as HTMLInputElement).value).toBe('4');
  });

  it('负数输入同样不改变购物车', async () => {
    useCart().addLine(LINE, 2);
    const { wrapper } = await mountPage();

    await commitQuantity(wrapper, '-3');

    expect(useCart().lines.value[0]?.quantity).toBe(2);
  });

  it('明确的 0 沿用既有约定：移除该行', async () => {
    useCart().addLine(LINE, 2);
    const { wrapper } = await mountPage();

    await commitQuantity(wrapper, '0');

    expect(useCart().isEmpty.value).toBe(true);
  });

  it('超过上限的数量被夹到 99 并回显', async () => {
    useCart().addLine(LINE, 2);
    const { wrapper } = await mountPage();

    await commitQuantity(wrapper, '500');

    expect(useCart().lines.value[0]?.quantity).toBe(99);
    expect((wrapper.get('.qty-control__input').element as HTMLInputElement).value).toBe('99');
  });

  /* ---------------- G6-2.9 任务 B：输入域边界补测 ---------------- */

  it('负小数输入不删行、不改数量，且输入框还原为当前值', async () => {
    useCart().addLine(LINE, 3);
    const { wrapper } = await mountPage();

    // -0.5 曾被误判为「数量归零」而静默删行（Math.trunc(-0.5) === -0 陷阱）
    await commitQuantity(wrapper, '-0.5');

    expect(useCart().lines.value).toHaveLength(1);
    expect(useCart().lines.value[0]?.quantity).toBe(3);
    expect((wrapper.get('.qty-control__input').element as HTMLInputElement).value).toBe('3');
  });

  it('科学计数法 / 极大数输入被夹到 99，绝不写入巨大值', async () => {
    useCart().addLine(LINE, 2);
    const { wrapper } = await mountPage();

    await commitQuantity(wrapper, '1e21');

    expect(useCart().lines.value[0]?.quantity).toBe(99);
    expect((wrapper.get('.qty-control__input').element as HTMLInputElement).value).toBe('99');
  });

  it('小数输入向下截断为整数并回显', async () => {
    useCart().addLine(LINE, 2);
    const { wrapper } = await mountPage();

    await commitQuantity(wrapper, '2.9');

    expect(useCart().lines.value[0]?.quantity).toBe(2);
    expect((wrapper.get('.qty-control__input').element as HTMLInputElement).value).toBe('2');
  });

  it('移除按钮删除该行，并同步持久化', async () => {
    useCart().addLine(LINE, 1);
    const { wrapper } = await mountPage();

    const removeButton = wrapper
      .findAll('button')
      .find((button) => button.text() === '移除');
    await removeButton!.trigger('click');
    await flushPromises();

    expect(useCart().isEmpty.value).toBe(true);
    expect(JSON.parse(localStorage.getItem(GUEST_CART_STORAGE_KEY)!)).toEqual([]);
  });

  it('清空清单按钮清掉全部行', async () => {
    useCart().addLine(LINE, 1);
    useCart().addLine({ ...LINE, productId: 'p-ball', slug: 'ball', name: '互动球' }, 2);
    const { wrapper } = await mountPage();

    const clearButton = wrapper
      .findAll('button')
      .find((button) => button.text() === '清空清单');
    await clearButton!.trigger('click');
    await flushPromises();

    expect(useCart().isEmpty.value).toBe(true);
  });

  it('刷新后按 localStorage 还原（持久化的是合法整数行）', async () => {
    useCart().addLine(LINE, 2);
    const raw = localStorage.getItem(GUEST_CART_STORAGE_KEY);
    expect(raw).toBeTruthy();

    // 模拟「重新加载页面」：丢弃内存状态，只留 localStorage
    __resetGuestCartForTest();
    const { wrapper } = await mountPage();

    expect(wrapper.text()).toContain('猫咪弹力毛衣');
    expect(wrapper.text()).toContain('共 2 件商品');
  });
});
