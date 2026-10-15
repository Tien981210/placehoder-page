import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/http';
import type { ProductView } from '@/api/types';
import { GUEST_CART_STORAGE_KEY, __resetGuestCartForTest } from '@/cart/useCart';
import { BRAND } from '@/config';
import ProductDetailPage from './ProductDetailPage.vue';

/**
 * 商品详情页测试（阶段 7 · 阶段 2 补齐）。
 *
 * 覆盖任务书要求的「商品详情测试」：
 *   - 主图 / 多图切换 / 商品描述 / 分类 / 询价入口；
 *   - 商品不存在时（后端对非 ACTIVE 商品返回 404）渲染错误状态，绝不伪造商品。
 */

const { fetchProductBySlugMock } = vi.hoisted(() => ({ fetchProductBySlugMock: vi.fn() }));

vi.mock('@/api/client', () => ({
  fetchProductBySlug: fetchProductBySlugMock,
}));

const Dummy = { template: '<div />' };

function image(id: string, url: string, isPrimary = false) {
  return {
    id,
    storageKey: `products/p-vest/${id}.png`,
    url,
    altText: `图片 ${id}`,
    visibility: 'PUBLIC' as const,
    sortOrder: 0,
    isPrimary,
  };
}

const PRODUCT: ProductView = {
  id: 'p-vest',
  name: '猫咪弹力毛衣',
  slug: 'cat-vest',
  summary: '弹力不勒，秋冬保暖',
  description: '面料：棉混纺。可机洗，建议手洗延长寿命。',
  price: '88.00',
  currency: 'CNY',
  compareAtPrice: '128.00',
  sku: 'LP-VEST-001',
  status: 'ACTIVE',
  category: { id: 'c2', name: '宠物服饰', slug: 'pet-apparel' },
  images: [
    image('img-1', 'https://cdn.example.test/vest-1.png', true),
    image('img-2', 'https://cdn.example.test/vest-2.png'),
  ],
  publishedAt: '2026-10-01T00:00:00.000Z',
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
};

async function mountPage(slug = 'cat-vest'): Promise<{ wrapper: VueWrapper; router: Router }> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: Dummy },
      { path: '/products', name: 'products', component: Dummy },
      { path: '/products/:slug', name: 'product-detail', component: Dummy },
      // 阶段 8-R：询价入口已收敛为 /checkout（/inquiry 仅是重定向兼容入口）
      { path: '/checkout', name: 'checkout', component: Dummy },
      { path: '/cart', name: 'cart', component: Dummy },
      { path: '/categories', name: 'categories', component: Dummy },
    ],
  });
  await router.push(`/products/${slug}`);
  await router.isReady();

  const wrapper = mount(ProductDetailPage, { global: { plugins: [router] } });
  await flushPromises();
  return { wrapper, router };
}

beforeEach(() => {
  localStorage.clear();
  __resetGuestCartForTest();
  fetchProductBySlugMock.mockReset();
  fetchProductBySlugMock.mockResolvedValue(PRODUCT);
});

describe('ProductDetailPage（商品详情）', () => {
  it('渲染主图、名称、价格、划线价、分类与商品描述', async () => {
    const { wrapper } = await mountPage();

    expect(fetchProductBySlugMock).toHaveBeenCalledWith('cat-vest');
    expect(wrapper.text()).toContain('猫咪弹力毛衣');
    expect(wrapper.text()).toContain('宠物服饰');
    expect(wrapper.text()).toContain('¥88.00');
    expect(wrapper.text()).toContain('¥128.00');
    expect(wrapper.text()).toContain('面料：棉混纺');
    expect(wrapper.get('.detail__main-image img').attributes('src')).toBe(
      'https://cdn.example.test/vest-1.png',
    );
  });

  it('多图时渲染缩略图，点击可切换主图', async () => {
    const { wrapper } = await mountPage();

    const thumbs = wrapper.findAll('button.detail__thumb');
    expect(thumbs).toHaveLength(2);
    expect(thumbs[0]!.attributes('aria-pressed')).toBe('true');

    await thumbs[1]!.trigger('click');

    expect(wrapper.get('.detail__main-image img').attributes('src')).toBe(
      'https://cdn.example.test/vest-2.png',
    );
    expect(wrapper.findAll('button.detail__thumb')[1]!.attributes('aria-pressed')).toBe('true');
  });

  it('单图时不渲染缩略图列表', async () => {
    fetchProductBySlugMock.mockResolvedValue({ ...PRODUCT, images: [image('img-1', 'a.png', true)] });
    const { wrapper } = await mountPage();

    expect(wrapper.findAll('button.detail__thumb')).toHaveLength(0);
  });

  it('保持询价制：加入询价清单 + 引导至提交询价，不出现支付入口', async () => {
    const { wrapper } = await mountPage();

    const addButton = wrapper
      .findAll('button.btn--primary')
      .find((button) => button.text() === '加入询价清单');
    expect(addButton).toBeTruthy();

    await wrapper.get('#detail-qty').setValue(3);
    await addButton!.trigger('click');
    await flushPromises();

    const lines = JSON.parse(localStorage.getItem(GUEST_CART_STORAGE_KEY)!) as Array<{
      productId: string;
      quantity: number;
    }>;
    expect(lines[0]).toMatchObject({ productId: 'p-vest', quantity: 3 });

    // 询价引导链接存在；页面不出现「立即支付 / 结算」等支付语义按钮
    expect(wrapper.text()).toContain('提交询价');
    expect(wrapper.text()).not.toContain('立即支付');
    expect(wrapper.text()).not.toContain('去结算');
    expect(wrapper.text()).not.toContain('去支付');

    // 阶段 8-R：入口必须**直接**指向 /checkout（不再指向已收敛的 /inquiry）
    const inquiryLink = wrapper
      .findAll('a')
      .find((link) => link.text().includes('提交询价'));
    expect(inquiryLink, '商品详情页缺少询价引导链接').toBeTruthy();
    expect(inquiryLink!.attributes('href')).toBe('/checkout');
    expect(wrapper.findAll('a[href="/inquiry"]')).toHaveLength(0);
  });

  it('商品不存在或已下架（404）时渲染错误状态，不伪造商品', async () => {
    fetchProductBySlugMock.mockRejectedValue(
      new ApiError(404, 'Not Found', '商品不存在或已下架'),
    );
    const { wrapper } = await mountPage('removed-product');

    expect(wrapper.text()).toContain('出错了');
    expect(wrapper.text()).toContain('商品不存在或已下架');
    expect(wrapper.find('.detail__main-image').exists()).toBe(false);
  });

  it('无图片时使用品牌占位图而非破图', async () => {
    fetchProductBySlugMock.mockResolvedValue({ ...PRODUCT, images: [] });
    const { wrapper } = await mountPage();

    const mark = wrapper.get('.detail__main-image img');
    expect(mark.attributes('src')).toBe(BRAND.brandLogo);
  });

  /* ---------------- 数量校验与反馈（G6-2.6 任务 B） ---------------- */

  it('数量为空时给出错误提示，且不写入购物车、不显示成功文案', async () => {
    const { wrapper } = await mountPage();

    const addButton = wrapper
      .findAll('button.btn--primary')
      .find((button) => button.text() === '加入询价清单');

    await wrapper.get('#detail-qty').setValue('');
    await addButton!.trigger('click');
    await flushPromises();

    expect(localStorage.getItem(GUEST_CART_STORAGE_KEY)).toBeNull();
    expect(wrapper.text()).toContain('请填写 1–99 之间的整数数量');
    expect(wrapper.text()).not.toContain('已加入询价清单');
  });

  it('数量超过上限时夹到 99 并回显，成功提示使用真实数量', async () => {
    const { wrapper } = await mountPage();

    const addButton = wrapper
      .findAll('button.btn--primary')
      .find((button) => button.text() === '加入询价清单');

    await wrapper.get('#detail-qty').setValue('500');
    await addButton!.trigger('click');
    await flushPromises();

    const lines = JSON.parse(localStorage.getItem(GUEST_CART_STORAGE_KEY)!) as Array<{
      quantity: number;
    }>;
    expect(lines[0]?.quantity).toBe(99);
    expect(wrapper.text()).toContain('已加入询价清单：猫咪弹力毛衣 × 99');
    expect((wrapper.get('#detail-qty').element as HTMLInputElement).value).toBe('99');
  });

  it('小数数量被截断为整数', async () => {
    const { wrapper } = await mountPage();

    const addButton = wrapper
      .findAll('button.btn--primary')
      .find((button) => button.text() === '加入询价清单');

    await wrapper.get('#detail-qty').setValue('1.5');
    await addButton!.trigger('click');
    await flushPromises();

    const lines = JSON.parse(localStorage.getItem(GUEST_CART_STORAGE_KEY)!) as Array<{
      quantity: number;
    }>;
    expect(lines[0]?.quantity).toBe(1);
    expect(wrapper.text()).toContain('已加入询价清单：猫咪弹力毛衣 × 1');
  });

  it('再次改动数量会清掉上一次的反馈', async () => {
    const { wrapper } = await mountPage();

    const addButton = wrapper
      .findAll('button.btn--primary')
      .find((button) => button.text() === '加入询价清单');

    await wrapper.get('#detail-qty').setValue(2);
    await addButton!.trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('已加入询价清单');

    await wrapper.get('#detail-qty').setValue(4);
    await flushPromises();
    expect(wrapper.text()).not.toContain('已加入询价清单');
  });
});
