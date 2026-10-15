import { createMemoryHistory, createRouter } from 'vue-router';
import { describe, expect, it } from 'vitest';
import { routes } from './routes';

/**
 * Luxra Beauty 临时站保留的全部**页面**路由。
 *
 * 🔴 已摘除：`/auth`、`/login`、`/register`、`/account*`、`/orders*`。
 */
const EXPECTED_ROUTES: Array<{ name: string; path: string }> = [
  { name: 'home', path: '/' },
  { name: 'categories', path: '/categories' },
  { name: 'products', path: '/products' },
  { name: 'product-detail', path: '/products/cloud-cat-tower' },
  { name: 'articles', path: '/articles' },
  { name: 'cart', path: '/cart' },
  // 阶段 8-R：/inquiry 已收敛为「重定向入口」，不再是页面路由（专项测试见下）。
  { name: 'checkout', path: '/checkout' },
  // 阶段 8-R1：结果页路径已收敛到 /checkout/result（旧路径仅重定向）。
  { name: 'inquiry-result', path: '/checkout/result' },
  { name: 'not-found', path: '/this-path-does-not-exist' },
];

/** 临时站已裁剪掉的路径 —— 必须落到 404，不得残留路由。 */
const REMOVED_PATHS = [
  '/auth',
  '/login',
  '/register',
  '/account',
  '/account/inquiries',
  '/account/inquiries/01920000-0000-7000-8000-000000000001',
  '/orders',
  '/orders/result',
];

describe('路由表', () => {
  const router = createRouter({ history: createMemoryHistory(), routes });

  it.each(EXPECTED_ROUTES)('$path 解析到路由 $name', ({ name, path }) => {
    const resolved = router.resolve(path);
    expect(resolved.name).toBe(name);
  });

  it.each(REMOVED_PATHS)('已裁剪路径 %s 落到 404', (path) => {
    expect(router.resolve(path).name).toBe('not-found');
  });

  it('每个路由都有 meta.title（用于浏览器标签标题）', () => {
    for (const route of routes) {
      expect(route.meta?.title, `路由 ${String(route.name)} 缺少 meta.title`).toBeTruthy();
    }
  });

  it('路由 name 唯一', () => {
    const names = routes.map((route) => route.name).filter(Boolean);
    expect(new Set(names).size).toBe(names.length);
  });

  it('未知路径回退到 not-found', () => {
    expect(router.resolve('/nope/nope/nope').name).toBe('not-found');
  });
});

/**
 * 阶段 8-R：询价入口收敛。
 *
 * 询价只保留**唯一入口** `/checkout`；`/inquiry` 降级为历史链接兼容入口（重定向）。
 * 🔴 临时站裁剪：`InquiryPage.vue` 已随 legacy 一并删除，该重定向保留只是为了
 *    旧书签不失效。
 */
describe('阶段 8-R：询价入口收敛（/inquiry → /checkout）', () => {
  const inquiryRecord = routes.find((route) => route.path === '/inquiry');

  it('/inquiry 仍注册为路由，且保留 name 与 meta.title', () => {
    expect(inquiryRecord, '路由表缺少 /inquiry 兼容入口').toBeDefined();
    expect(inquiryRecord!.name).toBe('inquiry');
    expect(inquiryRecord!.meta?.title).toBeTruthy();
  });

  it('/inquiry 是纯重定向记录：不再挂载任何页面组件', () => {
    expect(inquiryRecord!.redirect).toEqual({ name: 'checkout' });
    expect(inquiryRecord!.component).toBeUndefined();
    expect(inquiryRecord!.components).toBeUndefined();
  });

  it('访问 /inquiry 自动进入 /checkout', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes });
    await router.push('/inquiry');
    await router.isReady();

    expect(router.currentRoute.value.name).toBe('checkout');
    expect(router.currentRoute.value.path).toBe('/checkout');
  });

  it('router.push({ name: "inquiry" }) 仍可解析（旧代码不会因 name 失效而报错）', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes });
    await router.push({ name: 'inquiry' });
    await router.isReady();

    expect(router.currentRoute.value.name).toBe('checkout');
  });

  it('收敛后仍只有一个询价表单入口（/checkout）', () => {
    const pageRoutes = routes.filter(
      (route) => typeof route.component === 'function' || route.components !== undefined,
    );
    const paths = pageRoutes.map((route) => route.path);
    expect(paths).toContain('/checkout');
    expect(paths).not.toContain('/inquiry');
  });
});

/**
 * 阶段 8-R1：询价**结果页**路径收敛。
 *
 * 新路径 `/checkout/result/:inquiryNo?` 是唯一生产入口；旧路径
 * `/inquiry/result/:inquiryNo?` 保留为兼容重定向（旧书签 / 历史记录不失效）。
 * 路由 name 刻意保持 `inquiry-result`，因此站内按 name 跳转的代码零改动。
 */
describe('阶段 8-R1：结果页路径收敛（/inquiry/result → /checkout/result）', () => {
  const canonical = routes.find((route) => route.name === 'inquiry-result');
  const legacy = routes.find((route) => route.path === '/inquiry/result/:inquiryNo?');

  it('新路径是唯一挂载结果页组件的记录', () => {
    expect(canonical).toBeDefined();
    expect(canonical!.path).toBe('/checkout/result/:inquiryNo?');
    expect(typeof canonical!.component).toBe('function');
    expect(canonical!.meta?.title).toBeTruthy();
  });

  it('旧路径保留为纯重定向记录（不挂载组件）', () => {
    expect(legacy, '路由表缺少 /inquiry/result 兼容重定向').toBeDefined();
    expect(legacy!.component).toBeUndefined();
    expect(legacy!.components).toBeUndefined();
    expect(legacy!.redirect).toBeTypeOf('function');
    expect(legacy!.meta?.title).toBeTruthy();
  });

  it('新路径可直达，且 params 正确解析', () => {
    const router = createRouter({ history: createMemoryHistory(), routes });
    const resolved = router.resolve('/checkout/result/LP-261012-ABCD1234');

    expect(resolved.name).toBe('inquiry-result');
    expect(resolved.params.inquiryNo).toBe('LP-261012-ABCD1234');
  });

  it('旧路径带单号：自动跳转到新路径并保留单号', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes });
    await router.push('/inquiry/result/LP-261012-ABCD1234');
    await router.isReady();

    expect(router.currentRoute.value.name).toBe('inquiry-result');
    expect(router.currentRoute.value.path).toBe('/checkout/result/LP-261012-ABCD1234');
    expect(router.currentRoute.value.params.inquiryNo).toBe('LP-261012-ABCD1234');
  });

  it('旧路径不带单号：同样跳转到新路径（inquiryNo 为可选参数）', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes });
    await router.push('/inquiry/result');
    await router.isReady();

    expect(router.currentRoute.value.name).toBe('inquiry-result');
    expect(router.currentRoute.value.path).toBe('/checkout/result');
    expect(router.currentRoute.value.params.inquiryNo).toBeUndefined();
  });

  it('旧路径跳转时 query 与 hash 原样透传', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes });
    await router.push('/inquiry/result/LP-261012-ABCD1234?from=email#credential');
    await router.isReady();

    expect(router.currentRoute.value.path).toBe('/checkout/result/LP-261012-ABCD1234');
    expect(router.currentRoute.value.query.from).toBe('email');
    expect(router.currentRoute.value.hash).toBe('#credential');
  });

  it('按 name 跳转（站内既有写法）落到新路径', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes });
    await router.push({ name: 'inquiry-result', params: { inquiryNo: 'LP-261012-ZZZZ9999' } });
    await router.isReady();

    expect(router.currentRoute.value.path).toBe('/checkout/result/LP-261012-ZZZZ9999');
  });

  it('结果页只有一条挂载组件的记录（旧路径不得再挂组件）', () => {
    const mounted = routes.filter(
      (route) => route.name === 'inquiry-result' || route.path === '/inquiry/result/:inquiryNo?',
    );
    expect(mounted.filter((route) => typeof route.component === 'function')).toHaveLength(1);
  });
});
