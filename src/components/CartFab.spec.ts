import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';
import type { Router } from 'vue-router';
import CartFab from './CartFab.vue';
import { __resetCartDrawerForTest, useCartDrawer } from '@/composables/useCartDrawer';

/**
 * 悬浮球测试（Phase 2.2 新增）。
 *
 * 固化两件事：
 *   1. 它只做一件事 —— 打开询价清单抽屉，`aria-label` 是可读中文；
 *   2. **在 `/cart` 与 `/checkout` 上不渲染**：这两页的正文本身就是询价清单，
 *      悬浮球会构成同一业务动作的第二套入口，并且会盖住正文右下角的可点内容
 *      （真实浏览器实测见 `audit/phase22/probe_fab.py`）。
 */

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: { template: '<div />' } },
      { path: '/products', name: 'products', component: { template: '<div />' } },
      { path: '/cart', name: 'cart', component: { template: '<div />' } },
      { path: '/checkout', name: 'checkout', component: { template: '<div />' } },
      { path: '/checkout/result/:inquiryNo', name: 'inquiry-result', component: { template: '<div />' } },
    ],
  });
}

async function mountAt(path: string) {
  const router = makeRouter();
  await router.push(path);
  await router.isReady();
  __resetCartDrawerForTest();
  const wrapper = mount(CartFab, { global: { plugins: [router] } });
  return { wrapper, router };
}

describe('CartFab', () => {
  it('在商品页渲染，点击打开询价清单抽屉', async () => {
    const { wrapper } = await mountAt('/products');
    const { open } = useCartDrawer();

    const fab = wrapper.find('button.cart-fab');
    expect(fab.exists()).toBe(true);
    expect(fab.attributes('aria-label')).toBe('打开询价清单');
    // 询价制语义：不得出现购物车 / 支付字样
    expect(fab.attributes('aria-label')).not.toContain('购物车');
    expect(fab.attributes('aria-label')).not.toContain('支付');

    await fab.trigger('click');
    expect(open.value).toBe(true);
  });

  it('在 /cart 上不渲染（正文本身就是询价清单，避免重复入口与遮挡）', async () => {
    const { wrapper } = await mountAt('/cart');
    expect(wrapper.find('button.cart-fab').exists()).toBe(false);
  });

  it('在 /checkout 上不渲染（清单摘要已完整列在页面上）', async () => {
    const { wrapper } = await mountAt('/checkout');
    expect(wrapper.find('button.cart-fab').exists()).toBe(false);
  });

  it('在结果页与首页仍渲染（这两页没有其它清单入口）', async () => {
    for (const path of ['/', '/checkout/result/LP-261015-AAAA1111']) {
      const { wrapper } = await mountAt(path);
      expect(wrapper.find('button.cart-fab').exists(), `${path} 应保留悬浮球`).toBe(true);
      wrapper.unmount();
    }
  });

  it('角标显示真实件数，为 0 时带 zero 标记', async () => {
    const { wrapper } = await mountAt('/products');
    const badge = wrapper.find('.fab-badge');
    expect(badge.exists()).toBe(true);
    expect(badge.text()).toBe('0');
    expect(badge.classes()).toContain('zero');
  });
});
