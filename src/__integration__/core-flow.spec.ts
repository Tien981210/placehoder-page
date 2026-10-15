import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/http';
import type {
  CategoryView,
  InquirySubmitRequest,
  InquirySubmitResult,
  PaginatedResult,
  ProductView,
  PublicChannelCatalogView,
} from '@/api/types';
import { __resetGuestCartForTest, useCart } from '@/cart/useCart';
import { __resetToastForTest } from '@/composables/useToast';
import { __resetCategoryCatalogForTest } from '@/composables/useCategoryCatalog';
import { __resetIdempotencyForTest } from '@/inquiry/idempotency';
import { __resetInquirySessionForTest } from '@/inquiry/session';
import CheckoutPage from '@/pages/CheckoutPage.vue';
import InquiryResultPage from '@/pages/InquiryResultPage.vue';
import ProductListPage from '@/pages/ProductListPage.vue';

/**
 * G6-2.9 · 任务 G：**安全的核心流程集成测试（Mock / 隔离）**。
 *
 * 目标：在**不接触任何真实后端 / 数据库 / 邮件 / WhatsApp / 支付**的前提下，
 *      用真实页面组件 + 真实路由 + 真实购物车 / 幂等键模块，
 *      走通「商品 → 购物车 → 询价提交 → 结果页 → 订单查询 → 报价历史」这条链。
 *
 * 为什么用「进程内假后端」而不是 Playwright：
 *   任务书禁止连接共享活环境执行真实写操作。这里把 `@/api/client` 整体替换为
 *   一个**内存实现**（含幂等表），因此整条链的每一次写都只发生在内存里，
 *   可重复执行、无副作用、无凭据需求。
 *
 * ⚠️ 本文件**不覆盖**后端真实持久化与并发语义 —— 那部分由
 *    `luxra-beauty-backend` 的 `test:db`（隔离临时库）覆盖，见本轮报告。
 */

interface FakeOrder {
  orderNo: string;
  idempotencyKey: string | null;
  lines: { productId: string; quantity: number }[];
  contactEmail: string;
  contactName: string;
  shippingAddress: string;
  channel: string;
}

const { fake } = vi.hoisted(() => {
  const CATEGORIES: CategoryView[] = [
    {
      id: 'c-toys',
      name: '宠物玩具',
      slug: 'pet-toys',
      description: null,
      sortOrder: 10,
      isActive: true,
      parentId: null,
      createdAt: '2026-10-12T00:00:00.000Z',
      updatedAt: '2026-10-12T00:00:00.000Z',
    },
    {
      id: 'c-apparel',
      name: '宠物服饰',
      slug: 'pet-apparel',
      description: null,
      sortOrder: 20,
      isActive: true,
      parentId: null,
      createdAt: '2026-10-12T00:00:00.000Z',
      updatedAt: '2026-10-12T00:00:00.000Z',
    },
  ];

  const PRODUCT: ProductView = {
    id: 'p-rope',
    name: '耐咬绳结玩具',
    slug: 'rope-toy',
    summary: '适合中大型犬',
    description: null,
    price: '49.90',
    currency: 'USD',
    compareAtPrice: null,
    sku: 'DT-1001',
    status: 'ACTIVE',
    category: { id: 'c-toys', name: '宠物玩具', slug: 'pet-toys' },
    images: [
      {
        id: 'img-1',
        storageKey: 'mock/rope-1.svg',
        url: 'https://cdn.test/rope-1.svg',
        altText: '主图',
        visibility: 'PUBLIC',
        isPrimary: true,
        sortOrder: 0,
      },
    ],
    publishedAt: '2026-10-12T00:00:00.000Z',
    createdAt: '2026-10-12T00:00:00.000Z',
    updatedAt: '2026-10-12T00:00:00.000Z',
  };

  const CATALOG: PublicChannelCatalogView = {
    channels: ['EMAIL'],
    businessTypes: [
      { key: 'general-support', label: '通用客服', description: null, sortOrder: 90, channels: ['EMAIL'] },
    ],
  };

  const state = {
    orders: [] as FakeOrder[],
    byKey: new Map<string, FakeOrder>(),
    /** 下一次提交要抛的错误（一次性）。 */
    nextSubmitError: null as ApiError | null,
    /** 下一次提交要「结果未知」的错误（一次性）—— 抛错但服务端其实已建单。 */
    nextUnknownButCreated: false,
    submitCalls: [] as InquirySubmitRequest[],
    orderSeq: 0,
  };

  function createOrder(request: InquirySubmitRequest): FakeOrder {
    state.orderSeq += 1;
    return {
      orderNo: `LP-261013-${String(state.orderSeq).padStart(8, '0')}`,
      idempotencyKey: request.idempotencyKey ?? null,
      lines: request.lines.map((line) => ({ ...line })),
      contactEmail: request.contactEmail,
      contactName: request.contactName,
      shippingAddress: request.shippingAddress,
      channel: request.channel ?? 'EMAIL',
    };
  }

  const fake = {
    state,
    reset(): void {
      state.orders = [];
      state.byKey = new Map();
      state.nextSubmitError = null;
      state.nextUnknownButCreated = false;
      state.submitCalls = [];
      state.orderSeq = 0;
    },
    async fetchCategories(): Promise<CategoryView[]> {
      return CATEGORIES.map((item) => ({ ...item }));
    },
    async fetchProducts(): Promise<PaginatedResult<ProductView>> {
      return { items: [{ ...PRODUCT }], page: 1, pageSize: 20, total: 1, totalPages: 1 };
    },
    async fetchProductBySlug(): Promise<ProductView> {
      return { ...PRODUCT };
    },
    async fetchContactCatalog(): Promise<PublicChannelCatalogView> {
      return { channels: [...CATALOG.channels], businessTypes: CATALOG.businessTypes.map((t) => ({ ...t })) };
    },
    /**
     * 假后端提交：**按 idempotencyKey 去重**（与真实后端 `inquiry_order.idempotency_key`
     * 唯一约束的语义一致：同键返回原单，不新建）。
     */
    async submitInquiry(
      request: InquirySubmitRequest,
      _accessToken?: string,
    ): Promise<InquirySubmitResult> {
      state.submitCalls.push(request);

      if (state.nextSubmitError) {
        const error = state.nextSubmitError;
        state.nextSubmitError = null;
        // 「结果未知」：服务端其实已建单，只是响应没回来
        if (state.nextUnknownButCreated && request.idempotencyKey) {
          const created = createOrder(request);
          state.orders.push(created);
          state.byKey.set(request.idempotencyKey, created);
          state.nextUnknownButCreated = false;
        }
        throw error;
      }

      const key = request.idempotencyKey ?? null;
      let order = key ? state.byKey.get(key) ?? null : null;
      if (!order) {
        order = createOrder(request);
        state.orders.push(order);
        if (key) state.byKey.set(key, order);
      }

      return {
        orderNo: order.orderNo,
        submittedAt: '2026-10-13T00:00:00.000Z',
        accessToken: 'Zm9vYmFyLXRva2VuLXZhbHVlLTEyMzQ1Ng',
        accessExpiresAt: '2026-11-12T00:00:00.000Z',
        currency: 'USD',
        submittedSubtotal: '49.90',
        itemCount: order.lines.length,
        emailDelivery: { queued: 1, transportConfigured: false },
        channel: order.channel as 'EMAIL',
        businessType: null,
        country: null,
        city: null,
        postalCode: null,
        contactResolution: {
          resolved: true,
          channel: 'EMAIL',
          source: 'GENERAL_DEFAULT',
          reason: null,
          contactOwnerName: '客服小张',
          businessTypeLabel: '通用客服',
        },
        whatsapp: null,
      };
    },
  };

  return { fake };
});

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return {
    ...actual,
    fetchCategories: () => fake.fetchCategories(),
    fetchProducts: () => fake.fetchProducts(),
    fetchProductBySlug: () => fake.fetchProductBySlug(),
    fetchContactCatalog: () => fake.fetchContactCatalog(),
    submitInquiry: (request: InquirySubmitRequest) => fake.submitInquiry(request),
  };
});

const Dummy = { template: '<div />' };
const App = { template: '<router-view />' };

function createTestRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: Dummy },
      { path: '/products', name: 'products', component: ProductListPage },
      { path: '/products/:slug', name: 'product-detail', component: Dummy },
      { path: '/cart', name: 'cart', component: Dummy },
      { path: '/checkout', name: 'checkout', component: CheckoutPage },
      { path: '/checkout/result/:inquiryNo?', name: 'inquiry-result', component: InquiryResultPage },
    ],
  });
}

async function mountApp(initial = '/products'): Promise<{ wrapper: VueWrapper; router: Router }> {
  const router = createTestRouter();
  await router.push(initial);
  await router.isReady();
  const wrapper = mount(App, { global: { plugins: [router] } });
  await flushPromises();
  return { wrapper, router };
}

async function fillCheckoutForm(wrapper: VueWrapper): Promise<void> {
  await wrapper.get('#checkout-email').setValue('guest@example.com');
  await wrapper.get('#checkout-name').setValue('张三');
  await wrapper.get('#checkout-address').setValue('123 Pet Street, Springfield, IL 62704');
}

beforeEach(() => {
  localStorage.clear();
  vi.unstubAllEnvs();
  __resetGuestCartForTest();
  __resetIdempotencyForTest();
  __resetInquirySessionForTest();
  __resetCategoryCatalogForTest();
  __resetToastForTest();
  fake.reset();
});

describe('核心流程集成（Mock 隔离）：商品 → 购物车 → 询价 → 结果页', () => {
  it('全链路走通：列表页加购 → 结算页提交 → 结果页；后端只收到 1 次建单', async () => {
    const { wrapper, router } = await mountApp('/products');

    // ① 商品列表：真实分类 + 商品卡片
    expect(wrapper.text()).toContain('耐咬绳结玩具');

    // ② 加购（真实 useCart + localStorage 持久化）
    await wrapper.get('button.add-btn').trigger('click');
    await flushPromises();
    expect(useCart().lines.value).toHaveLength(1);
    expect(useCart().lines.value[0]).toMatchObject({ productId: 'p-rope', quantity: 1 });

    // ③ 进入结算页（同一 router 实例，真实页面切换）
    await router.push('/checkout');
    await flushPromises();
    await fillCheckoutForm(wrapper);
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    // ④ 提交载荷只含 { productId, quantity }，且携带幂等键
    expect(fake.state.submitCalls).toHaveLength(1);
    const sent = fake.state.submitCalls[0]!;
    expect(sent.lines).toEqual([{ productId: 'p-rope', quantity: 1 }]);
    expect(typeof sent.idempotencyKey).toBe('string');
    expect((sent.idempotencyKey ?? '').length).toBeGreaterThanOrEqual(8);

    // ⑤ 路由进入结果页，页面展示订单号
    expect(router.currentRoute.value.name).toBe('inquiry-result');
    expect(wrapper.text()).toContain(fake.state.orders[0]!.orderNo);

    // ⑥ 服务端侧只有 1 张单
    expect(fake.state.orders).toHaveLength(1);
  });

  it('连续点击提交：只发出一次请求，只建一单', async () => {
    useCart().addLine(
      {
        productId: 'p-rope',
        slug: 'rope-toy',
        name: '耐咬绳结玩具',
        unitPrice: '49.90',
        currency: 'USD',
        imageUrl: null,
      },
      1,
    );
    const { wrapper, router } = await mountApp('/checkout');
    await fillCheckoutForm(wrapper);

    const form = wrapper.get('form');
    await form.trigger('submit');
    await form.trigger('submit');
    await form.trigger('submit');
    await flushPromises();

    expect(fake.state.submitCalls).toHaveLength(1);
    expect(fake.state.orders).toHaveLength(1);
    expect(router.currentRoute.value.name).toBe('inquiry-result');
  });

  it('结果未知（超时）后重试：复用同一幂等键 ⇒ 仍然只有一单', async () => {
    useCart().addLine(
      {
        productId: 'p-rope',
        slug: 'rope-toy',
        name: '耐咬绳结玩具',
        unitPrice: '49.90',
        currency: 'USD',
        imageUrl: null,
      },
      2,
    );
    const { wrapper, router } = await mountApp('/checkout');

    // 服务端其实已建单，但响应丢失 ⇒ 前端看到「结果未知」
    fake.state.nextSubmitError = new ApiError(0, 'TIMEOUT', '请求超时（15000ms）');
    fake.state.nextUnknownButCreated = true;

    await fillCheckoutForm(wrapper);
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(wrapper.get('.notice--error').text()).toContain('结果未知');
    expect(fake.state.orders).toHaveLength(1);
    const createdOrderNo = fake.state.orders[0]!.orderNo;

    // 用户直接重试 —— 必须复用同键，服务端据此返回原单而不是再建一张
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    const keys = fake.state.submitCalls.map((call) => call.idempotencyKey);
    expect(keys[1]).toBe(keys[0]);
    expect(fake.state.orders).toHaveLength(1);
    // 重试拿到的**就是原单**（同一订单号），不是新单
    expect(router.currentRoute.value.params.inquiryNo).toBe(createdOrderNo);
  });

  it('明确失败（500）：不建单、不清空购物车、不跳转，且提示不含「结果未知」', async () => {
    useCart().addLine(
      {
        productId: 'p-rope',
        slug: 'rope-toy',
        name: '耐咬绳结玩具',
        unitPrice: '49.90',
        currency: 'USD',
        imageUrl: null,
      },
      3,
    );
    const { wrapper, router } = await mountApp('/checkout');
    fake.state.nextSubmitError = new ApiError(500, 'InternalError', '服务器内部错误');

    await fillCheckoutForm(wrapper);
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    const alert = wrapper.get('.notice--error').text();
    expect(alert).toContain('服务器内部错误');
    expect(alert).not.toContain('结果未知');

    expect(fake.state.orders).toHaveLength(0);
    expect(useCart().lines.value).toHaveLength(1);
    expect(useCart().lines.value[0]?.quantity).toBe(3);
    expect(router.currentRoute.value.name).toBe('checkout');
    // 表单内容保留，用户可直接修正后重试
    expect((wrapper.get('#checkout-email').element as HTMLInputElement).value).toBe('guest@example.com');
  });
});

describe('幂等键生命周期（Mock 隔离）：刷新与多标签页', () => {
  function addRope(quantity: number): void {
    useCart().addLine(
      {
        productId: 'p-rope',
        slug: 'rope-toy',
        name: '耐咬绳结玩具',
        unitPrice: '49.90',
        currency: 'USD',
        imageUrl: null,
      },
      quantity,
    );
  }

  it('场景 4：刷新页面后重试同一笔未决询价 ⇒ 复用同一幂等键，不重复建单', async () => {
    addRope(2);
    const first = await mountApp('/checkout');

    // 服务端其实已建单，但响应丢失 ⇒ 键保留在本地存储中（未决）
    fake.state.nextSubmitError = new ApiError(0, 'TIMEOUT', '请求超时（15000ms）');
    fake.state.nextUnknownButCreated = true;
    await fillCheckoutForm(first.wrapper);
    await first.wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(first.wrapper.get('.notice--error').text()).toContain('结果未知');

    const keyBeforeReload = fake.state.submitCalls[0]?.idempotencyKey;
    expect(typeof keyBeforeReload).toBe('string');
    first.wrapper.unmount();

    // 模拟「刷新」：进程内购物车状态丢弃（下次访问将从 localStorage 还原），另起应用实例
    __resetGuestCartForTest();
    const second = await mountApp('/checkout');
    expect(useCart().lines.value).toHaveLength(1); // 购物车已从 localStorage 还原

    await fillCheckoutForm(second.wrapper);
    await second.wrapper.get('form').trigger('submit');
    await flushPromises();

    // 刷新后重试必须复用刷新前的键 ⇒ 服务端识别为同一笔，恒只有一单
    expect(fake.state.submitCalls[1]?.idempotencyKey).toBe(keyBeforeReload);
    expect(fake.state.orders).toHaveLength(1);
    expect(second.router.currentRoute.value.name).toBe('inquiry-result');
  });

  it('场景 5：两个标签页操作同一笔未决询价 ⇒ 同一个键，只建一单', async () => {
    addRope(3);

    // 标签页 A：提交「结果未知」（键留在共享的 localStorage 中，仍未决）
    const tabA = await mountApp('/checkout');
    fake.state.nextSubmitError = new ApiError(0, 'NETWORK_ERROR', '网络连接中断');
    fake.state.nextUnknownButCreated = true;
    await fillCheckoutForm(tabA.wrapper);
    await tabA.wrapper.get('form').trigger('submit');
    await flushPromises();

    const keyA = fake.state.submitCalls[0]?.idempotencyKey;
    expect(fake.state.orders).toHaveLength(1);
    tabA.wrapper.unmount();

    // 标签页 B：另一个应用实例（共享同一份 localStorage）
    const tabB = await mountApp('/checkout');
    await fillCheckoutForm(tabB.wrapper);
    await tabB.wrapper.get('form').trigger('submit');
    await flushPromises();

    // 两个标签页必须拿到**同一个键** ⇒ 假后端按 key 去重 ⇒ 仍只有一单、同一订单号
    expect(fake.state.submitCalls[1]?.idempotencyKey).toBe(keyA);
    expect(fake.state.orders).toHaveLength(1);
    expect(tabB.router.currentRoute.value.name).toBe('inquiry-result');
    expect(tabB.wrapper.text()).toContain(fake.state.orders[0]!.orderNo);
  });
});

describe('幂等键 × 提交载荷绑定（Mock 隔离）', () => {
  function addRope(quantity: number): void {
    useCart().addLine(
      {
        productId: 'p-rope',
        slug: 'rope-toy',
        name: '耐咬绳结玩具',
        unitPrice: '49.90',
        currency: 'USD',
        imageUrl: null,
      },
      quantity,
    );
  }

  it('修改收货地址后重试 ⇒ 换新键、建新单（绝不静默返回旧单）', async () => {
    addRope(2);
    const { wrapper, router } = await mountApp('/checkout');

    // 服务端其实已建单，但响应丢失 ⇒ 前端看到「结果未知」，键被保留
    fake.state.nextSubmitError = new ApiError(0, 'TIMEOUT', '请求超时（15000ms）');
    fake.state.nextUnknownButCreated = true;

    await fillCheckoutForm(wrapper);
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    const firstKey = fake.state.submitCalls[0]?.idempotencyKey;
    const firstOrderNo = fake.state.orders[0]!.orderNo;
    expect(fake.state.orders).toHaveLength(1);

    // 顾客改了收货地址再提交 —— 这是**新内容**，不能复用旧键
    await wrapper.get('#checkout-address').setValue('456 Other Road, Shelbyville, IL 62565');
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    const secondKey = fake.state.submitCalls[1]?.idempotencyKey;
    expect(secondKey).not.toBe(firstKey);
    // 新内容落成新单（而不是返回旧单）
    expect(fake.state.orders).toHaveLength(2);
    expect(fake.state.orders[1]!.shippingAddress).toBe('456 Other Road, Shelbyville, IL 62565');
    expect(router.currentRoute.value.params.inquiryNo).not.toBe(firstOrderNo);
    expect(router.currentRoute.value.params.inquiryNo).toBe(fake.state.orders[1]!.orderNo);
  });

  it('原样重试（不改任何字段）⇒ 仍复用同一键、恒只有一单', async () => {
    addRope(2);
    const { wrapper, router } = await mountApp('/checkout');

    fake.state.nextSubmitError = new ApiError(0, 'TIMEOUT', '请求超时（15000ms）');
    fake.state.nextUnknownButCreated = true;

    await fillCheckoutForm(wrapper);
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    // 服务端其实已建单，只是响应丢了 ⇒ 前端留在结算页并提示「结果未知」
    expect(fake.state.submitCalls).toHaveLength(1);
    expect(wrapper.get('.notice--error').text()).toContain('结果未知');
    const firstKey = fake.state.submitCalls[0]!.idempotencyKey;
    const createdOrderNo = fake.state.orders[0]!.orderNo;
    expect(fake.state.orders).toHaveLength(1);

    // 原样重试（不改任何字段）⇒ 必须复用同一个键，拿回**原单**而不是新单
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(fake.state.submitCalls).toHaveLength(2);
    expect(fake.state.submitCalls[1]!.idempotencyKey).toBe(firstKey);
    expect(fake.state.orders).toHaveLength(1);
    expect(router.currentRoute.value.params.inquiryNo).toBe(createdOrderNo);
  });

  it('明确失败（500）后原样重试 ⇒ 复用同一键（不因一次失败就换键）', async () => {
    addRope(1);
    const { wrapper } = await mountApp('/checkout');

    fake.state.nextSubmitError = new ApiError(500, 'InternalError', '服务器内部错误');
    await fillCheckoutForm(wrapper);
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    const firstKey = fake.state.submitCalls[0]?.idempotencyKey;
    expect(fake.state.orders).toHaveLength(0);

    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(fake.state.submitCalls[1]?.idempotencyKey).toBe(firstKey);
    expect(fake.state.orders).toHaveLength(1);
  });

  it('提交成功后再次提交同一购物车 ⇒ 换新键、建新单（release 已生效）', async () => {
    addRope(2);
    const { wrapper, router } = await mountApp('/checkout');

    await fillCheckoutForm(wrapper);
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    const firstKey = fake.state.submitCalls[0]?.idempotencyKey;
    expect(fake.state.orders).toHaveLength(1);

    // 成功已 release：重新加入同一商品再提交，必须是**新键 + 新单**
    addRope(2);
    await router.push('/checkout');
    await flushPromises();
    await fillCheckoutForm(wrapper);
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(fake.state.submitCalls[1]?.idempotencyKey).not.toBe(firstKey);
    expect(fake.state.orders).toHaveLength(2);
  });
});
