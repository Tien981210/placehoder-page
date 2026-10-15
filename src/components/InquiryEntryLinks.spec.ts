import { mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import { beforeEach, describe, expect, it } from 'vitest';
import { GUEST_CART_STORAGE_KEY, __resetGuestCartForTest } from '@/cart/useCart';
import AppFooter from './AppFooter.vue';
import CartDrawer from './CartDrawer.vue';
import CartPage from '@/pages/CartPage.vue';

/**
 * 阶段 8-R：询价入口收敛 —— 站内入口链接专项。
 *
 * 目标：站内**所有**询价入口都必须**直接**指向 `/checkout`；
 * 不得再出现指向 `/inquiry` 的入口（`/inquiry` 只是重定向兼容入口，
 * 多一跳既浪费一次路由解析，也让代码语义含混）。
 */

const Dummy = { template: '<div />' };

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: Dummy },
      { path: '/categories', name: 'categories', component: Dummy },
      { path: '/products', name: 'products', component: Dummy },
      { path: '/products/:slug', name: 'product-detail', component: Dummy },
      { path: '/cart', name: 'cart', component: Dummy },
      { path: '/checkout', name: 'checkout', component: Dummy },
      // 临时站页脚新增的入口（写死号码的 WhatsApp 联系为外链，不需要路由）
      { path: '/articles', name: 'articles', component: Dummy },
    ],
  });
}

const CART_LINE = {
  productId: 'p-vest',
  slug: 'cat-vest',
  name: '猫咪弹力毛衣',
  unitPrice: '88.00',
  currency: 'CNY',
  imageUrl: null,
  quantity: 2,
};

function seedCart(): void {
  localStorage.setItem(GUEST_CART_STORAGE_KEY, JSON.stringify([CART_LINE]));
}

beforeEach(() => {
  localStorage.clear();
  __resetGuestCartForTest();
});

describe('阶段 8-R：页脚询价入口', () => {
  it('页脚「提交询价」直接指向 /checkout', async () => {
    const router = makeRouter();
    await router.push('/');
    await router.isReady();

    const wrapper = mount(AppFooter, { global: { plugins: [router] } });

    const link = wrapper.findAll('a').find((anchor) => anchor.text() === '提交询价');
    expect(link, '页脚缺少「提交询价」入口').toBeTruthy();
    expect(link!.attributes('href')).toBe('/checkout');
  });

  it('页脚不再出现任何指向 /inquiry 的入口', async () => {
    const router = makeRouter();
    await router.push('/');
    await router.isReady();

    const wrapper = mount(AppFooter, { global: { plugins: [router] } });

    expect(wrapper.findAll('a[href="/inquiry"]')).toHaveLength(0);
  });
});

describe('阶段 8-R：购物车抽屉询价入口', () => {
  it('抽屉「去提交询价」直接指向 /checkout', async () => {
    seedCart();
    const router = makeRouter();
    await router.push('/');
    await router.isReady();

    const wrapper = mount(CartDrawer, { global: { plugins: [router] } });

    const link = wrapper.findAll('a').find((anchor) => anchor.text().includes('去提交询价'));
    expect(link, '购物车抽屉缺少「去提交询价」入口').toBeTruthy();
    expect(link!.attributes('href')).toBe('/checkout');
    expect(wrapper.findAll('a[href="/inquiry"]')).toHaveLength(0);
  });
});

describe('阶段 8-R：购物车页询价入口', () => {
  it('购物车页「去结算」直接指向 /checkout', async () => {
    seedCart();
    const router = makeRouter();
    await router.push('/cart');
    await router.isReady();

    const wrapper = mount(CartPage, { global: { plugins: [router] } });

    const link = wrapper.findAll('a').find((anchor) => anchor.text() === '提交询价');
    expect(link, '询价清单页缺少「提交询价」入口').toBeTruthy();
    expect(link!.attributes('href')).toBe('/checkout');
    expect(wrapper.findAll('a[href="/inquiry"]')).toHaveLength(0);
  });

  it('购物车为空时给出「浏览商品」引导，不出现询价入口', async () => {
    const router = makeRouter();
    await router.push('/cart');
    await router.isReady();

    const wrapper = mount(CartPage, { global: { plugins: [router] } });

    expect(wrapper.text()).toContain('询价清单是空的');
    expect(wrapper.findAll('a[href="/inquiry"]')).toHaveLength(0);
  });
});
