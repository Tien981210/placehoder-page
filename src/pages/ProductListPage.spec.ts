import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CategoryView, PaginatedResult, ProductView } from '@/api/types';
import { GUEST_CART_STORAGE_KEY, __resetGuestCartForTest } from '@/cart/useCart';
import { __resetCategoryCatalogForTest } from '@/composables/useCategoryCatalog';
import { __resetToastForTest } from '@/composables/useToast';
import ProductListPage from './ProductListPage.vue';

/**
 * 商品列表页测试（阶段 7 · 阶段 2 补齐）。
 *
 * 覆盖任务书要求的「商品列表测试」：
 *   - 商品卡片 / 图片 / 价格渲染；
 *   - 分类筛选（真实分类 chip）；
 *   - 状态处理（空结果 → 空状态 + 清空筛选）；
 *   - 加入询价清单（保持询价制，不触发支付）。
 *
 * 后端侧「ACTIVE 商品可见 / 非 ACTIVE 不可见」由
 * luxra-beauty-backend/src/catalog/catalog.integration.spec.ts 覆盖。
 */

const { fetchProductsMock, fetchCategoriesMock } = vi.hoisted(() => ({
  fetchProductsMock: vi.fn(),
  fetchCategoriesMock: vi.fn(),
}));

vi.mock('@/api/client', () => ({
  fetchProducts: fetchProductsMock,
  fetchCategories: fetchCategoriesMock,
}));

const Dummy = { template: '<div />' };

function makeProduct(overrides: Partial<ProductView> = {}): ProductView {
  return {
    id: 'p-rope',
    name: '耐咬绳结玩具',
    slug: 'rope-toy',
    summary: '适合中大型犬',
    description: null,
    price: '49.90',
    currency: 'CNY',
    compareAtPrice: null,
    sku: null,
    status: 'ACTIVE',
    category: { id: 'c1', name: '宠物玩具', slug: 'pet-toys' },
    images: [
      {
        id: 'img-1',
        storageKey: 'products/p-rope/main.png',
        url: 'https://cdn.example.test/main.png',
        altText: '绳结玩具主图',
        visibility: 'PUBLIC',
        sortOrder: 0,
        isPrimary: true,
      },
    ],
    publishedAt: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

function makePage(
  items: ProductView[],
  extra: Partial<PaginatedResult<ProductView>> = {},
): PaginatedResult<ProductView> {
  return { items, page: 1, pageSize: 12, total: items.length, totalPages: 1, ...extra };
}

const CATEGORIES: CategoryView[] = [
  {
    id: 'c1',
    name: '宠物玩具',
    slug: 'pet-toys',
    description: null,
    sortOrder: 0,
    isActive: true,
    parentId: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  },
  {
    id: 'c2',
    name: '宠物服饰',
    slug: 'pet-apparel',
    description: null,
    sortOrder: 1,
    isActive: true,
    parentId: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  },
];

async function mountPage(query = ''): Promise<{ wrapper: VueWrapper; router: Router }> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: Dummy },
      { path: '/products', name: 'products', component: Dummy },
      { path: '/products/:slug', name: 'product-detail', component: Dummy },
      { path: '/inquiry', name: 'inquiry', component: Dummy },
    ],
  });
  await router.push(`/products${query}`);
  await router.isReady();

  const wrapper = mount(ProductListPage, { global: { plugins: [router] } });
  await flushPromises();
  return { wrapper, router };
}

beforeEach(() => {
  localStorage.clear();
  __resetGuestCartForTest();
  __resetToastForTest();
  // 列表页与页头共用分类目录缓存（P7 去重），用例之间必须清空，
  // 否则前一个用例的分类列表会被后一个用例复用。
  __resetCategoryCatalogForTest();
  fetchProductsMock.mockReset();
  fetchCategoriesMock.mockReset();
  fetchCategoriesMock.mockResolvedValue(CATEGORIES);
  fetchProductsMock.mockResolvedValue(makePage([makeProduct()]));
});

describe('ProductListPage（商品列表）', () => {
  it('渲染商品卡片：名称、价格、主图与详情链接', async () => {
    const { wrapper } = await mountPage();

    expect(wrapper.text()).toContain('耐咬绳结玩具');
    expect(wrapper.text()).toContain('¥49.90');

    const image = wrapper.get('.card-ph img');
    expect(image.attributes('src')).toBe('https://cdn.example.test/main.png');
    expect(image.attributes('alt')).toBe('绳结玩具主图');

    // 卡片是「导航类」链接 → 走 SmartLink，指向详情页
    const detailLinks = wrapper.findAll('a.card-name');
    expect(detailLinks).toHaveLength(1);
    expect(detailLinks[0]!.attributes('href')).toContain('/products/rope-toy');
  });

  it('展示分页信息与商品总数', async () => {
    fetchProductsMock.mockResolvedValue(
      makePage([makeProduct()], { total: 25, totalPages: 3, page: 1 }),
    );
    const { wrapper } = await mountPage();

    expect(wrapper.text()).toContain('第 1 / 3 页');
    expect(wrapper.text()).toContain('共 25 件');
  });

  it('点击真实分类 chip 后带 category 查询参数重新请求', async () => {
    const { wrapper, router } = await mountPage();
    fetchProductsMock.mockClear();

    const chips = wrapper.findAll('button.chip');
    const apparelChip = chips.find((chip) => chip.text() === '宠物服饰');
    expect(apparelChip).toBeTruthy();

    await apparelChip!.trigger('click');
    await flushPromises();

    expect(router.currentRoute.value.query.category).toBe('pet-apparel');
    expect(fetchProductsMock).toHaveBeenCalledTimes(1);
    expect(fetchProductsMock.mock.calls[0]![0]).toMatchObject({
      page: 1,
      pageSize: 12,
      category: 'pet-apparel',
    });
  });

  it('空结果时渲染空状态并提供「清空筛选条件」', async () => {
    fetchProductsMock.mockResolvedValue(makePage([]));
    const { wrapper, router } = await mountPage('?category=pet-apparel');

    expect(wrapper.text()).toContain('没有找到商品');

    const resetButton = wrapper
      .findAll('button.btn--ghost')
      .find((button) => button.text() === '清空筛选条件');
    expect(resetButton).toBeTruthy();

    await resetButton!.trigger('click');
    await flushPromises();

    expect(router.currentRoute.value.query.category).toBeUndefined();
  });

  it('URL 里的分类不存在时如实提示，且不再按导航矩阵渲染', async () => {
    fetchProductsMock.mockResolvedValue(makePage([]));
    // dog-supplies 是导航矩阵的候选 slug，但**不在**后端分类库里
    const { wrapper } = await mountPage('?category=dog-supplies&need=toys');

    expect(wrapper.text()).toContain('不存在或已下架');
    // 该分类不存在 ⇒ 不应再出现「需求 chip + 品类库尚未建立」那套矩阵文案
    expect(wrapper.text()).not.toContain('需求的品类库尚未建立');

    // 真实分类 chip 仍然可用，且「全部」处于选中态（避免出现「无任何筛选被选中」）
    const chips = wrapper.findAll('button.chip');
    expect(chips.find((chip) => chip.text() === '宠物玩具')).toBeTruthy();
    expect(chips[0]!.classes()).toContain('on');
  });

  it('分类列表加载失败时不误判「分类不存在」', async () => {
    fetchProductsMock.mockResolvedValue(makePage([makeProduct()]));
    fetchCategoriesMock.mockRejectedValue(new Error('boom'));
    const { wrapper } = await mountPage('?category=pet-apparel');

    expect(wrapper.text()).not.toContain('不存在或已下架');
  });

  /**
   * G6-3.0 任务 B：子分类（`parentId` 非空）虽**没有导航入口**，
   * 但必须在筛选栏中作为 chip 出现并可点击 —— 否则其商品只能从「全部商品」进入。
   */
  it('子分类（有 parentId）同样渲染为 chip，点击后按其 slug 请求', async () => {
    fetchCategoriesMock.mockResolvedValue([
      ...CATEGORIES,
      {
        id: 'c3',
        name: '磨牙玩具',
        slug: 'moya-wanju',
        description: null,
        sortOrder: 2,
        isActive: true,
        parentId: 'c1',
        createdAt: '2026-10-01T00:00:00.000Z',
        updatedAt: '2026-10-01T00:00:00.000Z',
      },
    ]);
    const { wrapper, router } = await mountPage();
    fetchProductsMock.mockClear();

    const chip = wrapper.findAll('button.chip').find((item) => item.text() === '磨牙玩具');
    expect(chip).toBeTruthy();

    await chip!.trigger('click');
    await flushPromises();

    expect(router.currentRoute.value.query.category).toBe('moya-wanju');
    expect(fetchProductsMock.mock.calls[0]![0]).toMatchObject({ category: 'moya-wanju' });
  });

  /**
   * G6-3.0 任务 B3：父分类筛选由**服务端**返回「自身 + 全部后代分类」的商品，
   * 前端如实渲染后端返回的每一条（这里含一条挂在子分类下的商品）。
   */
  it('父分类筛选如实渲染服务端返回的全部商品（含子分类商品）', async () => {
    fetchProductsMock.mockResolvedValue(
      makePage([
        makeProduct({ id: 'p1', name: '绳结玩具', slug: 'rope-toy' }),
        makeProduct({
          id: 'p2',
          name: '磨牙骨',
          slug: 'chew-bone',
          category: { id: 'c3', name: '磨牙玩具', slug: 'moya-wanju' },
        }),
      ]),
    );
    const { wrapper } = await mountPage('?category=pet-toys');

    expect(wrapper.text()).toContain('绳结玩具');
    expect(wrapper.text()).toContain('磨牙骨');
    expect(fetchProductsMock.mock.calls[0]![0]).toMatchObject({ category: 'pet-toys' });
  });

  it('请求失败时渲染错误状态且不伪造商品', async () => {
    fetchProductsMock.mockRejectedValue(new Error('boom'));
    const { wrapper } = await mountPage();

    expect(wrapper.text()).toContain('出错了');
    expect(wrapper.findAll('article.card')).toHaveLength(0);
  });

  it('加入询价清单写入本地清单（询价制，不触发任何支付）', async () => {
    const { wrapper } = await mountPage();

    const addButton = wrapper.get('button.add-btn');
    expect(addButton.text()).toBe('加入询价清单');

    await addButton.trigger('click');
    await flushPromises();

    const stored = localStorage.getItem(GUEST_CART_STORAGE_KEY);
    expect(stored).toBeTruthy();
    const lines = JSON.parse(stored!) as Array<{ productId: string; quantity: number; unitPrice: string }>;
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ productId: 'p-rope', quantity: 1, unitPrice: '49.90' });
  });
});
