import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';
import type { ProductView } from '@/api/types';
import ProductCard from './ProductCard.vue';

/**
 * 商品卡测试（第二阶段新增）。
 *
 * 固化三件事：
 *   1. **文案是询价制语义**（「加入询价清单」），且卡片内不出现支付 / 购物车字样；
 *   2. 无真实商品图时必须渲染「示意图」标注，且**不得**把它伪装成商品实拍；
 *   3. 状态标记（新品）是正文元信息，而不是压在图片上的浮动角标 ——
 *      当前商品库 6/6 件都是近期上架，浮动角标会退化成零信息量装饰。
 */

const router = createRouter({
  history: createMemoryHistory(),
  routes: [
    { path: '/', name: 'home', component: { template: '<div />' } },
    { path: '/products/:slug', name: 'product-detail', component: { template: '<div />' } },
  ],
});

function makeProduct(overrides: Partial<ProductView> = {}): ProductView {
  return {
    id: 'p-1',
    name: '玫瑰水润面膜',
    slug: 'rose-hydrating-mask',
    summary: '大马士革玫瑰纯露，即时补水舒缓。',
    description: null,
    price: '88.00',
    currency: 'CNY',
    compareAtPrice: null,
    sku: null,
    status: 'ACTIVE',
    category: { id: 'c1', name: '护肤精华', slug: 'serum' },
    images: [],
    publishedAt: null,
    createdAt: '2026-10-15T00:00:00.000Z',
    updatedAt: '2026-10-15T00:00:00.000Z',
    ...overrides,
  };
}

function mountCard(product: ProductView, extraProps: Record<string, unknown> = {}) {
  return mount(ProductCard, {
    props: { product, ...extraProps },
    global: { plugins: [router] },
  });
}

describe('ProductCard', () => {
  it('按钮文案为询价制语义，且卡片内不出现支付 / 购物车字样', () => {
    const wrapper = mountCard(makeProduct());
    const text = wrapper.text();

    expect(wrapper.find('button.add-btn').text()).toBe('加入询价清单');
    for (const forbidden of ['购物车', '立即购买', '去支付', '支付', '结算', 'Buy Now', 'Pay Now']) {
      expect(text, `商品卡出现了禁用措辞「${forbidden}」`).not.toContain(forbidden);
    }
  });

  it('点击按钮向父组件抛出 addToCart（只改文案，事件契约不变）', async () => {
    const wrapper = mountCard(makeProduct());
    await wrapper.find('button.add-btn').trigger('click');

    const emitted = wrapper.emitted('addToCart');
    expect(emitted).toHaveLength(1);
    expect((emitted?.[0]?.[0] as ProductView).slug).toBe('rose-hydrating-mask');
  });

  it('无真实商品图时渲染「示意图」标注', () => {
    const wrapper = mountCard(makeProduct({ images: [] }));
    expect(wrapper.find('.card-ph-note').exists()).toBe(true);
    expect(wrapper.find('.card-ph-note').text()).toBe('示意图');
  });

  it('「示意图」披露同时传达给屏幕阅读器（aria-label 会覆盖内部文本）', () => {
    const withPlaceholder = mountCard(makeProduct({ images: [] }));
    expect(withPlaceholder.find('.card-ph').attributes('aria-label')).toContain('示意图');

    const withRealImage = mountCard(
      makeProduct({
        images: [
          {
            id: 'img-1',
            storageKey: 'products/p-1/main.png',
            url: 'https://cdn.example.test/main.png',
            altText: '面膜主图',
            visibility: 'PUBLIC',
            sortOrder: 0,
            isPrimary: true,
          },
        ],
      }),
    );
    // 有真实图时不该再宣称是示意图
    expect(withRealImage.find('.card-ph').attributes('aria-label')).not.toContain('示意图');
  });

  it('有真实商品图时**不**渲染「示意图」标注（标注随真实素材自动消失）', () => {
    const wrapper = mountCard(
      makeProduct({
        images: [
          {
            id: 'img-1',
            storageKey: 'products/p-1/main.png',
            url: 'https://cdn.example.test/main.png',
            altText: '面膜主图',
            visibility: 'PUBLIC',
            sortOrder: 0,
            isPrimary: true,
          },
        ],
      }),
    );
    expect(wrapper.find('.card-ph-note').exists()).toBe(false);
    expect(wrapper.find('.card-ph img').attributes('src')).toBe('https://cdn.example.test/main.png');
  });

  it('30 天内上架的商品：状态标记是正文元信息，不是图片上的浮动角标', () => {
    const wrapper = mountCard(
      makeProduct({ publishedAt: new Date(Date.now() - 86400000).toISOString() }),
    );

    const meta = wrapper.find('.card-meta');
    expect(meta.exists()).toBe(true);
    expect(meta.text()).toContain('新品');
    // 图片容器内不得再出现任何角标元素
    expect(wrapper.find('.card-ph .card-tag').exists()).toBe(false);
    expect(wrapper.find('.card-ph .card-flag').exists()).toBe(false);
  });

  it('久远上架的商品不显示「新品」', () => {
    const wrapper = mountCard(
      makeProduct({ publishedAt: new Date(Date.now() - 400 * 86400000).toISOString() }),
    );
    expect(wrapper.find('.card-meta').text()).not.toContain('新品');
  });

  it('有划线价时同时展示现价与划线价（划线价不等于销量宣称）', () => {
    const wrapper = mountCard(makeProduct({ compareAtPrice: '128.00' }));
    expect(wrapper.find('.card-price').text()).toContain('¥88.00');
    expect(wrapper.find('.card-compare').text()).toContain('¥128.00');
  });

  /* ---------------- Phase 2.2（P1-16 / P1-17） ---------------- */

  it('默认（不传 showCategory）渲染分类名 —— 单卡场景行为不变', () => {
    const wrapper = mountCard(makeProduct());
    const meta = wrapper.find('.card-meta');

    expect(meta.exists()).toBe(true);
    expect(meta.text()).toContain('护肤精华');
  });

  it('showCategory=false 时不渲染分类名；无其它元信息时整行不渲染', () => {
    // 结果集只有一个分类（当前 6/6 件都在「护肤精华」下）时由调用方传 false
    const wrapper = mount(ProductCard, {
      props: { product: makeProduct(), showCategory: false },
      global: { plugins: [router] },
    });

    // 该商品没有「新品」标记 ⇒ 元信息行没有任何内容可渲染，整行消失
    expect(wrapper.find('.card-meta').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('护肤精华');
  });

  it('showCategory=false 但仍有「新品」标记时，只渲染标记、不渲染分类名', () => {
    const wrapper = mount(ProductCard, {
      props: {
        product: makeProduct({ publishedAt: new Date(Date.now() - 86400000).toISOString() }),
        showCategory: false,
      },
      global: { plugins: [router] },
    });

    const meta = wrapper.find('.card-meta');
    expect(meta.exists()).toBe(true);
    expect(meta.text()).toContain('新品');
    expect(meta.text()).not.toContain('护肤精华');
  });

  it('商品名默认是 h3（首页网格位于 <h2>在售商品</h2> 之下）', () => {
    const wrapper = mountCard(makeProduct());

    const heading = wrapper.find('h3.card-name-wrap');
    expect(heading.exists()).toBe(true);
    expect(heading.text()).toContain('玫瑰水润面膜');
    // 标题本身必须是链接的目标，而不是把链接当标题
    expect(heading.find('a.card-name').attributes('href')).toBe('/products/rose-hydrating-mask');
  });

  it('headingLevel=2 时商品名是 h2（列表页避免 H1 → H3 跳级）', () => {
    const wrapper = mountCard(makeProduct(), { headingLevel: 2 });

    const heading = wrapper.find('h2.card-name-wrap');
    expect(heading.exists()).toBe(true);
    expect(wrapper.find('h3.card-name-wrap').exists()).toBe(false);
    expect(heading.text()).toContain('玫瑰水润面膜');
    expect(heading.find('a.card-name').attributes('href')).toBe('/products/rose-hydrating-mask');
  });

  it('两个层级都只渲染一个标题元素，且不含其它标题', () => {
    for (const level of [2, 3] as const) {
      const wrapper = mountCard(makeProduct(), { headingLevel: level });
      expect(wrapper.findAll('h1, h2, h3, h4, h5, h6')).toHaveLength(1);
      expect(wrapper.find(`h${level}.card-name-wrap`).exists()).toBe(true);
    }
  });
});
