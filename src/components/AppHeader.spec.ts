import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CategoryView } from '@/api/types';
import { __resetCartDrawerForTest } from '@/composables/useCartDrawer';
import { __resetCategoryCatalogForTest } from '@/composables/useCategoryCatalog';
import { __resetNewTabPreferenceForTest } from '@/composables/useNewTabPreference';
import { BRAND, SITE_CATEGORIES } from '@/config';
import AppHeader from './AppHeader.vue';

/**
 * 顶部导航测试。
 *
 * 重点覆盖「导航品类与数据源解耦」这条既有契约（沿用自宠物版，品类换成美容四类）：
 *   - 数据源里存在候选分类 → 导航带 category 跳转；
 *   - 数据源里没有该分类 → **绝不**生成指向不存在分类的链接，
 *     退化为全部商品并给出如实提示；
 *   - 分类接口失败 → 降级为全部商品，不抛错也不生成死链。
 *
 * 另含品牌配置断言：导航里的品牌名与标记必须来自 `src/config/brand.ts`。
 */

const { fetchCategoriesMock } = vi.hoisted(() => ({ fetchCategoriesMock: vi.fn() }));

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, fetchCategories: fetchCategoriesMock };
});

const Dummy = { template: '<div />' };

function category(id: string, name: string, slug: string): CategoryView {
  return {
    id,
    name,
    slug,
    description: null,
    sortOrder: 0,
    isActive: true,
    parentId: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  };
}

/** 真实后端当前状态：只有 `serum` 一条分类。 */
const LIVE_CATEGORIES: CategoryView[] = [category('c1', '护肤精华', 'serum')];
/** 后台已经建好首饰分类的情形。 */
const WITH_JEWELRY: CategoryView[] = [
  category('c1', '首饰', 'jewelry'),
  category('c2', '护肤精华', 'serum'),
];

async function mountHeader(): Promise<{ wrapper: VueWrapper; router: Router }> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: Dummy },
      { path: '/categories', name: 'categories', component: Dummy },
      { path: '/products', name: 'products', component: Dummy },
      { path: '/products/:slug', name: 'product-detail', component: Dummy },
      { path: '/cart', name: 'cart', component: Dummy },
      { path: '/checkout', name: 'checkout', component: Dummy },
      { path: '/articles', name: 'articles', component: Dummy },
    ],
  });
  await router.push('/');
  await router.isReady();

  const wrapper = mount(AppHeader, { global: { plugins: [router] } });
  await flushPromises();
  return { wrapper, router };
}

/** 打开某个品类的一级菜单（点击 button.menu-btn）。 */
async function openCategory(wrapper: VueWrapper, label: string): Promise<void> {
  const button = wrapper.findAll('button.menu-btn').find((node) => node.text().includes(label));
  expect(button, `未找到一级菜单「${label}」`).toBeTruthy();
  await button!.trigger('click');
  await flushPromises();
}

beforeEach(() => {
  localStorage.clear();

  __resetCartDrawerForTest();
  __resetCategoryCatalogForTest();
  __resetNewTabPreferenceForTest();
  fetchCategoriesMock.mockReset();
});

describe('AppHeader（顶部导航）', () => {
  it('渲染品牌配置里的品牌名与标记（不写死品牌事实）', async () => {
    fetchCategoriesMock.mockResolvedValue(LIVE_CATEGORIES);
    const { wrapper } = await mountHeader();

    expect(wrapper.text()).toContain(BRAND.brandName);
    expect(wrapper.get('a.brand img').attributes('src')).toBe(BRAND.brandLogo);
  });

  it('四个目标品类都出现在一级导航里', async () => {
    fetchCategoriesMock.mockResolvedValue(LIVE_CATEGORIES);
    const { wrapper } = await mountHeader();

    for (const item of SITE_CATEGORIES) {
      expect(wrapper.text()).toContain(item.label);
    }
  });

  it('数据源存在对应分类时，Mega 面板带 category 跳转并标注「已在售」', async () => {
    fetchCategoriesMock.mockResolvedValue(WITH_JEWELRY);
    const { wrapper } = await mountHeader();

    await openCategory(wrapper, 'Jewelry');

    const hrefs = wrapper.findAll('a.subcat').map((node) => node.attributes('href'));
    expect(hrefs).toContain('/products?category=jewelry');
    expect(wrapper.get('a.mega-all').attributes('href')).toBe('/products?category=jewelry');
    expect(wrapper.text()).toContain('该品类已在售');
  });

  it('数据源缺少该分类时不生成指向不存在分类的链接，并如实提示', async () => {
    fetchCategoriesMock.mockResolvedValue(LIVE_CATEGORIES);
    const { wrapper } = await mountHeader();

    await openCategory(wrapper, 'Jewelry');

    // 「查看该品类」退化为全部商品，绝不出现 category=jewelry
    const hrefs = wrapper.findAll('a.subcat').map((node) => node.attributes('href'));
    expect(hrefs).not.toContain('/products?category=jewelry');
    expect(wrapper.get('a.mega-all').attributes('href')).toBe('/products');

    // 如实提示，而不是假装有该分类
    expect(wrapper.text()).toContain('暂时还没有商品');
    expect(wrapper.text()).toContain('查看全部商品');
  });

  it('Mega 面板里的「其他品类」可切换到另一个品类', async () => {
    fetchCategoriesMock.mockResolvedValue(WITH_JEWELRY);
    const { wrapper } = await mountHeader();

    await openCategory(wrapper, 'Jewelry');

    const otherLabels = wrapper.findAll('a.subcat').map((node) => node.text());
    expect(otherLabels).toContain('Wigs & Hair');
  });

  it('分类接口失败时导航降级为全部商品，不抛错也不生成死链', async () => {
    fetchCategoriesMock.mockRejectedValue(new Error('boom'));
    const { wrapper } = await mountHeader();

    // 「全部商品」直接入口始终可用
    const plainHrefs = wrapper.findAll('a.menu-btn').map((node) => node.attributes('href'));
    expect(plainHrefs).toContain('/products');

    await openCategory(wrapper, 'Jewelry');
    expect(wrapper.get('a.mega-all').attributes('href')).toBe('/products');
  });

  it('文章入口在内容能力未开启时不渲染', async () => {
    fetchCategoriesMock.mockResolvedValue(LIVE_CATEGORIES);
    const { wrapper } = await mountHeader();

    expect(wrapper.findAll('a[href="/articles"]')).toHaveLength(0);
  });

  it('WhatsApp 联系入口使用品牌配置的号码，并明确在新标签打开', async () => {
    fetchCategoriesMock.mockResolvedValue(LIVE_CATEGORIES);
    const { wrapper } = await mountHeader();

    const wa = wrapper.get('a[href^="https://wa.me/"]');
    expect(wa.attributes('href')).toContain(BRAND.brandWhatsApp);
    expect(wa.attributes('target')).toBe('_blank');
    expect(wa.attributes('rel')).toBe('noopener noreferrer');
  });

  it('购物车按钮展示件数，空车时不显示数字徽标', async () => {
    fetchCategoriesMock.mockResolvedValue(LIVE_CATEGORIES);
    const { wrapper } = await mountHeader();

    const badge = wrapper.get('span.badge');
    expect(badge.classes()).toContain('zero');
    expect(badge.text()).toBe('0');
  });

  it('移动端菜单渲染全部四个目标品类', async () => {
    fetchCategoriesMock.mockResolvedValue(LIVE_CATEGORIES);
    const { wrapper } = await mountHeader();

    const mobileLinks = wrapper.findAll('.mobile-menu a.mm-link').map((node) => node.text());
    expect(mobileLinks).toHaveLength(SITE_CATEGORIES.length);
    for (const item of SITE_CATEGORIES) {
      expect(mobileLinks.join(' ')).toContain(item.label);
    }
  });
});
