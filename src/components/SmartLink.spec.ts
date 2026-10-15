import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter, type RouteLocationRaw, type Router } from 'vue-router';
import { beforeEach, describe, expect, it } from 'vitest';
import SmartLink from './SmartLink.vue';
import { __resetNewTabPreferenceForTest, useNewTabPreference } from '@/composables/useNewTabPreference';

const Dummy = { template: '<div>dummy</div>' };

function createTestRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: Dummy },
      { path: '/products', name: 'products', component: Dummy },
      { path: '/products/:slug', name: 'product-detail', component: Dummy },
    ],
  });
}

async function mountLink(to: RouteLocationRaw) {
  const router = createTestRouter();
  await router.push('/');
  await router.isReady();

  const wrapper = mount(SmartLink, {
    props: { to },
    slots: { default: '去商品列表' },
    global: { plugins: [router] },
  });

  return { wrapper, router };
}

/**
 * 🔴 回归护栏（原 P1 缺陷）：
 *   默认状态必须是「当前标签页内用 Vue Router 切换」。
 *   一旦有人把默认值改回 `true`，第一个用例就会失败。
 */
describe('SmartLink（站内导航链接）', () => {
  beforeEach(() => {
    localStorage.clear();
    __resetNewTabPreferenceForTest();
  });

  it('默认（未做任何设置）不带 target，点击在当前标签页切换路由', async () => {
    const { wrapper, router } = await mountLink({ name: 'products' });
    const anchor = wrapper.get('a');

    expect(anchor.attributes('target')).toBeUndefined();
    expect(anchor.attributes('rel')).toBeUndefined();
    // href 仍指向真实路由路径，保证刷新 / 中键打开都能正确加载
    expect(anchor.attributes('href')).toBe('/products');

    await anchor.trigger('click');
    await flushPromises();

    expect(router.currentRoute.value.name).toBe('products');
  });

  it('用户显式开启后渲染 target="_blank" 与 rel="noopener noreferrer"', async () => {
    useNewTabPreference().setOpenInNewTab(true);
    const { wrapper, router } = await mountLink({ name: 'products' });
    const anchor = wrapper.get('a');

    expect(anchor.attributes('target')).toBe('_blank');
    expect(anchor.attributes('rel')).toBe('noopener noreferrer');

    // 开启时由浏览器原生打开，本组件不拦截点击
    await anchor.trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.name).toBe('home');
  });

  it('默认状态下，带修饰键的点击不拦截（保留浏览器原生新标签页行为）', async () => {
    const { wrapper, router } = await mountLink({ name: 'products' });

    await wrapper.get('a').trigger('click', { ctrlKey: true });
    await flushPromises();

    // 未发生 SPA 跳转 —— 事件交给浏览器默认行为
    expect(router.currentRoute.value.name).toBe('home');
  });

  it('默认状态下，非左键点击不拦截', async () => {
    const { wrapper, router } = await mountLink({ name: 'products' });

    await wrapper.get('a').trigger('click', { button: 1 });
    await flushPromises();

    expect(router.currentRoute.value.name).toBe('home');
  });

  it('支持带参数的路由对象', async () => {
    const { wrapper } = await mountLink({
      name: 'product-detail',
      params: { slug: 'pearl-shell-earrings' },
    });
    expect(wrapper.get('a').attributes('href')).toBe('/products/pearl-shell-earrings');
  });

  it('开关切换后重新渲染的属性随之变化', async () => {
    const { wrapper } = await mountLink({ name: 'products' });
    expect(wrapper.get('a').attributes('target')).toBeUndefined();

    useNewTabPreference().setOpenInNewTab(true);
    await flushPromises();

    expect(wrapper.get('a').attributes('target')).toBe('_blank');
  });
});
