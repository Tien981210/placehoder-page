import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';
import App from './App.vue';
import { routes as realRoutes } from './router/routes';

/**
 * 根组件的 `<head>` 同步行为（Phase 2.1 新增）。
 *
 * 为什么单独测：
 *   `App.vue` 是**唯一**写入 `<title>` / `meta[name=description]` /
 *   `link[rel=canonical]` / `og:*` 的地方，而它是单页应用里最容易被忽略的
 *   一块 SEO 逻辑 —— 改错不会有任何界面变化，只会让搜索引擎看到重复或
 *   错误的页面信息。这里把四条行为固化下来。
 *
 * 测试用**精简路由表**而不是真实路由表：本文件验证的是「同步机制」，
 * 真实路由的 meta 完整性由 `src/router/meta.spec.ts` 负责。
 */

const testRoutes = [
  {
    path: '/',
    name: 'home',
    component: { template: '<div />' },
    meta: { title: '首页', description: '首页的描述文案。' },
  },
  {
    path: '/products',
    name: 'products',
    component: { template: '<div />' },
    meta: { title: '商品列表', description: '商品列表的描述文案。' },
  },
  {
    path: '/checkout/result/:inquiryNo?',
    name: 'inquiry-result',
    component: { template: '<div />' },
    meta: { title: '询价提交结果', description: '结果页描述。' },
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: { template: '<div />' },
    meta: { title: '页面不存在', description: '404 描述。' },
  },
];

/** 复刻 index.html 里声明过的标签 —— 同步逻辑只覆写已存在的标签。 */
const HEAD_FIXTURE = [
  ['meta[name="description"]', 'content', '静态兜底描述'],
  ['meta[property="og:title"]', 'content', 'BEAUTY STORE'],
  ['meta[property="og:description"]', 'content', '静态兜底描述'],
  ['meta[name="twitter:title"]', 'content', 'BEAUTY STORE'],
  ['meta[name="twitter:description"]', 'content', '静态兜底描述'],
] as const;

function resetHead(): void {
  document.head.querySelector('link[rel="canonical"]')?.remove();
  for (const [selector] of HEAD_FIXTURE) {
    document.head.querySelector(selector)?.remove();
  }
  for (const [selector, attr, value] of HEAD_FIXTURE) {
    const tag = document.createElement('meta');
    const nameMatch = /meta\[name="(.+)"\]/.exec(selector);
    const propMatch = /meta\[property="(.+)"\]/.exec(selector);
    if (nameMatch) tag.setAttribute('name', nameMatch[1]);
    if (propMatch) tag.setAttribute('property', propMatch[1]);
    tag.setAttribute(attr, value);
    document.head.appendChild(tag);
  }
}

function content(selector: string): string | null {
  return document.head.querySelector(selector)?.getAttribute('content') ?? null;
}

async function mountAt(path: string) {
  const router = createRouter({ history: createMemoryHistory(), routes: testRoutes });
  router.push(path);
  await router.isReady();

  const wrapper = mount(App, {
    global: {
      plugins: [router],
      // 只测 <head> 同步，子组件全部桩掉（它们各自有自己的用例）
      stubs: {
        AppHeader: true,
        AppFooter: true,
        CartDrawer: true,
        CartFab: true,
        ToastHost: true,
      },
    },
  });
  await router.isReady();
  return wrapper;
}

beforeEach(() => {
  resetHead();
  document.title = '';
});

afterEach(() => {
  resetHead();
});

describe('App.vue · <head> 同步', () => {
  it('按路由写入 title，并同步 og:title / twitter:title', async () => {
    await mountAt('/products');

    expect(document.title).toBe('商品列表 · BEAUTY STORE');
    expect(content('meta[property="og:title"]')).toBe('商品列表 · BEAUTY STORE');
    expect(content('meta[name="twitter:title"]')).toBe('商品列表 · BEAUTY STORE');
  });

  it('按路由写入 description，并同步 og:description / twitter:description', async () => {
    await mountAt('/products');

    expect(content('meta[name="description"]')).toBe('商品列表的描述文案。');
    expect(content('meta[property="og:description"]')).toBe('商品列表的描述文案。');
    expect(content('meta[name="twitter:description"]')).toBe('商品列表的描述文案。');
  });

  it('为普通页面生成自指向 canonical（用当前来源，不硬编码域名）', async () => {
    await mountAt('/products');

    const link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    expect(link).not.toBeNull();
    expect(link!.getAttribute('href')).toBe(`${window.location.origin}/products`);
  });

  it('404 页**不**生成 canonical（错误页不应自指向）', async () => {
    await mountAt('/no-such-page');

    expect(document.head.querySelector('link[rel="canonical"]')).toBeNull();
  });

  it('询价结果页**不**生成 canonical（路径含一次性凭证，不应被收录）', async () => {
    await mountAt('/checkout/result/INQ-2026-0001');

    expect(document.head.querySelector('link[rel="canonical"]')).toBeNull();
  });

  it('canonical 排除名单里的路由名在真实路由表中确实存在（防止改名后静默失效）', () => {
    const names = new Set(realRoutes.map((route) => route.name));
    for (const excluded of ['not-found', 'inquiry-result']) {
      expect(names, `真实路由表里找不到名为 ${excluded} 的路由`).toContain(excluded);
    }
  });
});
