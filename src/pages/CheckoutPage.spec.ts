import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/http';
import type { InquirySubmitResult, PublicChannelCatalogView } from '@/api/types';
import { __resetGuestCartForTest, useCart } from '@/cart/useCart';
import { __resetIdempotencyForTest } from '@/inquiry/idempotency';
import { __resetInquirySessionForTest, lastSubmitResult } from '@/inquiry/session';
import CheckoutPage from './CheckoutPage.vue';

/**
 * 结算页测试（阶段 8）。
 *
 * 覆盖任务书要求的「checkout 流程 / 未登录提交」。
 *
 * 🔴 Luxra Beauty 临时站裁剪：原「登录自动填充」「401 清会话」「403 保留会话」
 *    三组用例已删除 —— 临时站没有顾客账户体系，所有提交一律走游客路径。
 */

const { submitInquiryMock, fetchContactCatalogMock } = vi.hoisted(() => ({
  submitInquiryMock: vi.fn(),
  fetchContactCatalogMock: vi.fn(),
}));

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return {
    ...actual,
    submitInquiry: submitInquiryMock,
    fetchContactCatalog: fetchContactCatalogMock,
  };
});

const SAMPLE = {
  productId: '01920000-0000-7000-8000-000000000001',
  slug: 'cloud-cat-tower',
  name: '云朵猫爬架',
  unitPrice: '88.00',
  currency: 'CNY',
  imageUrl: null,
};

const RESULT: InquirySubmitResult = {
  orderNo: 'LP-261012-A1B2C3D4',
  submittedAt: '2026-10-12T00:00:00.000Z',
  accessToken: 'Zm9vYmFyLXRva2VuLXZhbHVlLTEyMzQ1Ng',
  accessExpiresAt: '2026-11-11T00:00:00.000Z',
  currency: 'CNY',
  submittedSubtotal: '176.00',
  itemCount: 1,
  emailDelivery: { queued: 1, transportConfigured: false },
  // G6 新增字段
  channel: 'EMAIL',
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

/** 公开业务类型目录（与后端迁移内置 5 类一致）。 */
const CATALOG: PublicChannelCatalogView = {
  channels: ['EMAIL', 'WHATSAPP'],
  businessTypes: [
    { key: 'sales', label: '销售咨询', description: '售前咨询', sortOrder: 10, channels: ['EMAIL', 'WHATSAPP'] },
    { key: 'after-sales', label: '售后服务', description: '售后问题', sortOrder: 20, channels: ['EMAIL'] },
    { key: 'general-support', label: '通用客服', description: '默认回退', sortOrder: 90, channels: ['EMAIL', 'WHATSAPP'] },
  ],
};

const Dummy = { template: '<div />' };

function createTestRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: Dummy },
      { path: '/products', name: 'products', component: Dummy },
      { path: '/cart', name: 'cart', component: Dummy },
      { path: '/checkout', name: 'checkout', component: Dummy },
      // 阶段 8-R1：结果页路径已收敛到 /checkout/result（旧路径仅重定向）
      { path: '/checkout/result/:inquiryNo?', name: 'inquiry-result', component: Dummy },
      { path: '/account/inquiries', name: 'account-inquiries', component: Dummy },
    ],
  });
}

async function mountPage(): Promise<{ wrapper: VueWrapper; router: Router }> {
  const router = createTestRouter();
  await router.push('/checkout');
  await router.isReady();
  const wrapper = mount(CheckoutPage, { global: { plugins: [router] } });
  await flushPromises();
  return { wrapper, router };
}

async function fillValidForm(wrapper: VueWrapper): Promise<void> {
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
  submitInquiryMock.mockReset();
  fetchContactCatalogMock.mockReset();
  fetchContactCatalogMock.mockResolvedValue({
    channels: [...CATALOG.channels],
    businessTypes: CATALOG.businessTypes.map((type) => ({ ...type })),
  });
});

/**
 * `window.location` 的替身 —— 用于断言 G6-2.8 的「同标签导航」目标地址。
 *
 * jsdom 不实现真实导航（直接赋值只会打印 `Not implemented: navigation`），
 * 因此换成可观测对象；`afterEach` 负责还原。
 */
const REAL_LOCATION = window.location;

function stubLocation(): { href: string } {
  const stub = { href: '' };
  Object.defineProperty(window, 'location', { configurable: true, writable: true, value: stub });
  return stub;
}

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: REAL_LOCATION,
  });
});

describe('CheckoutPage（结算）', () => {
  it('购物车为空时提示先挑选商品，不渲染表单', async () => {
    const { wrapper } = await mountPage();

    expect(wrapper.find('form').exists()).toBe(false);
    expect(wrapper.text()).toContain('询价清单为空');
  });

  it('游客提交：不预填，提交后进入结果页（携带一次性凭证），且不附带令牌', async () => {
    const cart = useCart();
    cart.addLine(SAMPLE, 2);
    const { wrapper, router } = await mountPage();
    submitInquiryMock.mockResolvedValue(RESULT);

    expect((wrapper.get('#checkout-email').element as HTMLInputElement).value).toBe('');
    expect(wrapper.text()).toContain('无需注册登录');

    await fillValidForm(wrapper);
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(submitInquiryMock).toHaveBeenCalledTimes(1);
    // 临时站没有顾客令牌：submitInquiry 只接受一个参数
    expect(submitInquiryMock.mock.calls[0]).toHaveLength(1);
    expect(router.currentRoute.value.name).toBe('inquiry-result');
    expect(router.currentRoute.value.path).toBe(`/checkout/result/${RESULT.orderNo}`);
    expect(router.currentRoute.value.params.inquiryNo).toBe(RESULT.orderNo);
    expect(cart.lines.value).toHaveLength(0);
    expect(lastSubmitResult.value).toEqual(RESULT);
  });

  /**
   * G6-2.6 任务 C：顾客在「提交中」离开结算页再回来时，重试必须复用同一个幂等键。
   * 组件内的 ref 会随卸载销毁 —— 键若丢失，服务端就会当成新单再建一张。
   */
  it('提交失败后离开页面再回来重试：复用同一个幂等键', async () => {
    const cart = useCart();
    cart.addLine(SAMPLE, 2);

    const first = await mountPage();
    submitInquiryMock.mockRejectedValueOnce(new ApiError(503, 'Unavailable', '服务暂时不可用'));

    await fillValidForm(first.wrapper);
    await first.wrapper.get('form').trigger('submit');
    await flushPromises();

    const firstKey = (submitInquiryMock.mock.calls[0]?.[0] as { idempotencyKey?: string })
      .idempotencyKey;
    expect(typeof firstKey).toBe('string');
    // 失败后购物车必须保留，用户才可能重试
    expect(cart.lines.value).toHaveLength(1);

    // 模拟「离开结算页再回来」：卸载后重新挂载（组件内 ref 归零）
    first.wrapper.unmount();
    submitInquiryMock.mockResolvedValueOnce(RESULT);
    const second = await mountPage();

    await fillValidForm(second.wrapper);
    await second.wrapper.get('form').trigger('submit');
    await flushPromises();

    const secondKey = (submitInquiryMock.mock.calls[1]?.[0] as { idempotencyKey?: string })
      .idempotencyKey;
    expect(secondKey).toBe(firstKey);
  });

  /**
   * G6-3.1 任务 E：刷新会丢掉 `submitError`，顾客看不到「结果未知」的提示；
   * 若顺手改一个字再提交 ⇒ 载荷变化 ⇒ 换新键 ⇒ **重复建单**。
   * 因此只要**当前载荷**仍有未决记录，重进页面就必须继续提示。
   */
  it('「结果未知」后刷新重进：当前载荷仍有未决记录 ⇒ 继续提示（防改字重提重复建单）', async () => {
    const cart = useCart();
    cart.addLine(SAMPLE, 2);

    const first = await mountPage();
    submitInquiryMock.mockRejectedValueOnce(
      new ApiError(0, 'NETWORK_ERROR', '无法连接到 API（网络中断）'),
    );
    await fillValidForm(first.wrapper);
    await first.wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(first.wrapper.get('.notice--error').text()).toContain('结果未知');
    // 提交中/失败时不显示「未决提示」条（避免与错误提示重复）
    expect(first.wrapper.find('.notice--warn').exists()).toBe(false);
    first.wrapper.unmount();

    // 「刷新」：组件重建、错误提示归零，但未决记录仍在 ⇒ 必须继续提示
    const second = await mountPage();
    await fillValidForm(second.wrapper);
    await flushPromises();

    expect(second.wrapper.find('.notice--warn').exists()).toBe(true);
    expect(second.wrapper.get('.notice--warn').text()).toContain('结果未知');
    expect(second.wrapper.get('.notice--warn').text()).toContain('不会重复下单');
    // 这不是「提交失败」，不应出现 error 级提示
    expect(second.wrapper.find('.notice--error').exists()).toBe(false);

    // 载荷变化（改一个字段）⇒ 指纹不同 ⇒ 未决提示自然消失（新的一笔询价）
    await second.wrapper.get('#checkout-address').setValue('456 Other Road, Shelbyville, IL 62565');
    await flushPromises();
    expect(second.wrapper.find('.notice--warn').exists()).toBe(false);
  });

  it('邮箱格式非法时阻止提交，且不调用后端', async () => {
    useCart().addLine(SAMPLE, 1);
    const { wrapper } = await mountPage();

    await wrapper.get('#checkout-email').setValue('not-an-email');
    await wrapper.get('#checkout-name').setValue('张三');
    await wrapper.get('#checkout-address').setValue('123 Pet Street, Springfield');
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(wrapper.text()).toContain('请填写有效的联系邮箱');
    expect(submitInquiryMock).not.toHaveBeenCalled();
  });
});

describe('CheckoutPage · G6-2.8（幂等键语义与提交状态）', () => {
  /** 取第 n 次提交请求体中的幂等键。 */
  function keyOf(callIndex: number): string {
    const body = submitInquiryMock.mock.calls[callIndex]?.[0] as { idempotencyKey?: string };
    return body.idempotencyKey ?? '';
  }

  it('A4-1 提交进行中再次点击：被忽略，只发出一次请求，按钮禁用且文案为「提交中…」', async () => {
    useCart().addLine(SAMPLE, 2);
    const { wrapper } = await mountPage();

    let release!: (value: InquirySubmitResult) => void;
    submitInquiryMock.mockImplementation(
      () =>
        new Promise<InquirySubmitResult>((resolve) => {
          release = resolve;
        }),
    );

    await fillValidForm(wrapper);
    const form = wrapper.get('form');
    // 连点三次（第一次仍在飞行中）
    void form.trigger('submit');
    await form.trigger('submit');
    await form.trigger('submit');
    await flushPromises();

    expect(submitInquiryMock).toHaveBeenCalledTimes(1);

    const button = wrapper.get('button[type="submit"]');
    expect(button.attributes('disabled')).toBeDefined();
    expect(button.text()).toContain('提交中…');

    release(RESULT);
    await flushPromises();
  });

  it('A4-3 失败后在同页直接重试：复用同一个幂等键，且不清空用户已填内容', async () => {
    useCart().addLine(SAMPLE, 2);
    const { wrapper } = await mountPage();

    submitInquiryMock.mockRejectedValueOnce(new ApiError(503, 'Unavailable', '服务暂时不可用'));
    await fillValidForm(wrapper);
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    const firstKey = keyOf(0);
    expect(firstKey).not.toBe('');
    expect(wrapper.get('.notice--error').text()).toContain('服务暂时不可用');
    // 失败绝不清空表单
    expect((wrapper.get('#checkout-email').element as HTMLInputElement).value).toBe('guest@example.com');
    expect((wrapper.get('#checkout-name').element as HTMLInputElement).value).toBe('张三');
    // 按钮切换为「重试提交」
    expect(wrapper.get('button[type="submit"]').text()).toContain('重试提交');

    submitInquiryMock.mockResolvedValueOnce(RESULT);
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(submitInquiryMock).toHaveBeenCalledTimes(2);
    expect(keyOf(1)).toBe(firstKey);
  });

  it('A4-4 超时（结果未知）：提示「结果未知 / 重试安全」，且保留幂等键供重试复用', async () => {
    useCart().addLine(SAMPLE, 2);
    const { wrapper } = await mountPage();

    submitInquiryMock.mockRejectedValueOnce(
      new ApiError(0, 'TIMEOUT', '请求超时（15000ms）：POST /inquiries'),
    );
    await fillValidForm(wrapper);
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    const alert = wrapper.get('.notice--error');
    expect(alert.text()).toContain('结果未知');
    expect(alert.text()).toContain('不会重复建单');

    // 结果未知时必须保留键 —— 否则重试会变成新单
    const firstKey = keyOf(0);
    submitInquiryMock.mockResolvedValueOnce(RESULT);
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(keyOf(1)).toBe(firstKey);
  });

  it('A4-5 成功提交后开始新的询价：即使购物车指纹完全相同，也必须使用新键', async () => {
    const cart = useCart();
    cart.addLine(SAMPLE, 2);
    const { wrapper } = await mountPage();

    submitInquiryMock.mockResolvedValue(RESULT);
    await fillValidForm(wrapper);
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    const firstKey = keyOf(0);
    expect(cart.lines.value).toHaveLength(0); // 成功后购物车清空

    // 再次加购**完全相同的商品与数量**（指纹与上一单一致）——这是最容易复用旧键的情形
    cart.addLine(SAMPLE, 2);
    await flushPromises();
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(submitInquiryMock).toHaveBeenCalledTimes(2);
    expect(keyOf(1)).not.toBe(firstKey);
  });

  it('A4-7 购物车内容变化后：不复用旧键（不同商品/数量不得被当成同一单）', async () => {
    const cart = useCart();
    cart.addLine(SAMPLE, 2);
    const { wrapper } = await mountPage();

    submitInquiryMock.mockRejectedValueOnce(new ApiError(503, 'Unavailable', '服务暂时不可用'));
    await fillValidForm(wrapper);
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    const firstKey = keyOf(0);

    // 改数量 ⇒ 指纹变化 ⇒ 必须换新键
    cart.setQuantity(SAMPLE.productId, 5);
    await flushPromises();

    submitInquiryMock.mockResolvedValueOnce(RESULT);
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(keyOf(1)).not.toBe(firstKey);
    const secondBody = submitInquiryMock.mock.calls[1]?.[0] as { lines: { quantity: number }[] };
    expect(secondBody.lines[0]?.quantity).toBe(5);
  });
});

describe('CheckoutPage · G6（询盘渠道与邮编）', () => {
  it('默认渠道为邮件，且提供 WhatsApp 选项（来自服务端目录）', async () => {
    useCart().addLine(SAMPLE, 1);
    const { wrapper } = await mountPage();

    const email = wrapper.get('#checkout-channel-email').element as HTMLInputElement;
    const whatsapp = wrapper.get('#checkout-channel-whatsapp').element as HTMLInputElement;
    expect(email.checked).toBe(true);
    expect(whatsapp.checked).toBe(false);
    expect(wrapper.text()).toContain('邮件询盘');
    expect(wrapper.text()).toContain('WhatsApp 询盘');
  });

  it('选择 WhatsApp 时明确说明「不会自动发送、需手动发送」', async () => {
    useCart().addLine(SAMPLE, 1);
    const { wrapper } = await mountPage();

    await wrapper.get('#checkout-channel-whatsapp').setValue();
    await flushPromises();

    const text = wrapper.text();
    expect(text).toContain('不会自动发送');
    expect(text).toContain('手动发送');
    expect(text).not.toContain('已发送');
  });

  it('G6-2.6：页面不再提供业务类型下拉，提交载荷恒不含 businessTypeKey', async () => {
    useCart().addLine(SAMPLE, 1);
    const { wrapper } = await mountPage();
    submitInquiryMock.mockResolvedValue(RESULT);

    // 顾客不需要、也不应该选择业务类型 —— 由服务端自动派单
    expect(wrapper.find('#checkout-business-type').exists()).toBe(false);

    await fillValidForm(wrapper);
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    const payload = submitInquiryMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.channel).toBe('EMAIL');
    expect(payload).not.toHaveProperty('businessTypeKey');
    expect(payload).not.toHaveProperty('postalCode');
  });

  it('提交时携带渠道与地址字段（邮编保留内部格式）', async () => {
    useCart().addLine(SAMPLE, 1);
    const { wrapper } = await mountPage();
    submitInquiryMock.mockResolvedValue(RESULT);

    await fillValidForm(wrapper);
    await wrapper.get('#checkout-channel-whatsapp').setValue();
    await flushPromises();
    await wrapper.get('#checkout-country').setValue('United Kingdom');
    await wrapper.get('#checkout-city').setValue('London');
    await wrapper.get('#checkout-postal').setValue('  SW1A 1AA  ');
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    const payload = submitInquiryMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.channel).toBe('WHATSAPP');
    expect(payload).not.toHaveProperty('businessTypeKey');
    expect(payload.country).toBe('United Kingdom');
    expect(payload.city).toBe('London');
    // 只去首尾空格，内部空格必须保留
    expect(payload.postalCode).toBe('SW1A 1AA');
  });

  it('邮政编码不要求纯数字：含字母与连字符均通过', async () => {
    useCart().addLine(SAMPLE, 1);
    const { wrapper } = await mountPage();
    submitInquiryMock.mockResolvedValue(RESULT);

    await fillValidForm(wrapper);
    await wrapper.get('#checkout-postal').setValue('K1A-0B1');
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(submitInquiryMock).toHaveBeenCalledTimes(1);
    expect((submitInquiryMock.mock.calls[0]?.[0] as Record<string, unknown>).postalCode).toBe('K1A-0B1');
  });

  it('邮政编码格式非法时阻止提交，且不调用后端', async () => {
    useCart().addLine(SAMPLE, 1);
    const { wrapper } = await mountPage();

    await fillValidForm(wrapper);
    await wrapper.get('#checkout-postal').setValue('!!');
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(wrapper.text()).toContain('请填写有效的邮政编码');
    expect(submitInquiryMock).not.toHaveBeenCalled();
  });

  it('渠道目录加载失败时不阻断提交，只给出提示', async () => {
    fetchContactCatalogMock.mockRejectedValueOnce(new ApiError(500, 'InternalError', '目录服务不可用'));
    useCart().addLine(SAMPLE, 1);
    const { wrapper } = await mountPage();
    submitInquiryMock.mockResolvedValue(RESULT);

    expect(wrapper.text()).toContain('渠道目录加载失败');

    await fillValidForm(wrapper);
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(submitInquiryMock).toHaveBeenCalledTimes(1);
  });

  it('G6-2.7：WhatsApp 渠道说明已改为「提交后将打开 WhatsApp」', async () => {
    useCart().addLine(SAMPLE, 1);
    const { wrapper } = await mountPage();

    expect(wrapper.text()).toContain('提交后将打开 WhatsApp');
  });
});

describe('CheckoutPage · G6-2.7（WhatsApp 测试按钮）', () => {
  it('未配置 VITE_WHATSAPP_TEST_NUMBER ⇒ 不渲染测试按钮（生产默认）', async () => {
    // 显式清空：本机 .env.local 配了测试号码，这里模拟「生产未配置」的情形
    vi.stubEnv('VITE_WHATSAPP_TEST_NUMBER', '');
    useCart().addLine(SAMPLE, 1);
    const { wrapper } = await mountPage();

    expect(wrapper.find('#checkout-test-whatsapp').exists()).toBe(false);
  });

  it('配置了测试号码 ⇒ 渲染按钮，点击后在手势内同步导航到 whatsapp://（不弹窗口、不跳转）', async () => {
    vi.stubEnv('VITE_WHATSAPP_TEST_NUMBER', '8613900139000');
    const open = vi.spyOn(window, 'open');
    const location = stubLocation();

    useCart().addLine(SAMPLE, 1);
    const { wrapper } = await mountPage();

    const button = wrapper.get('#checkout-test-whatsapp');
    expect(button.text()).toContain('打开 WhatsApp');

    await button.trigger('click');

    expect(open).not.toHaveBeenCalled();
    expect(String(location.href)).toContain('whatsapp://send?phone=8613900139000&text=');
    expect(String(location.href)).not.toContain('https://');
  });

  it('测试按钮不创建询盘单（绝不调用提交接口）', async () => {
    vi.stubEnv('VITE_WHATSAPP_TEST_NUMBER', '8613900139000');
    stubLocation();

    useCart().addLine(SAMPLE, 1);
    const { wrapper } = await mountPage();

    await wrapper.get('#checkout-test-whatsapp').trigger('click');
    await flushPromises();

    expect(submitInquiryMock).not.toHaveBeenCalled();
  });
});

describe('CheckoutPage · G6-2.2（渠道可用性联动）', () => {
  /** 服务端在「没有任何可用 WhatsApp 联系人」时下发的目录。 */
  const CATALOG_EMAIL_ONLY: PublicChannelCatalogView = {
    channels: ['EMAIL'],
    businessTypes: [
      { key: 'general-support', label: '通用客服', description: '默认回退', sortOrder: 90, channels: ['EMAIL'] },
    ],
  };

  it('目录中没有可用 WhatsApp 联系人 ⇒ 不展示 WhatsApp 渠道，只保留邮件', async () => {
    fetchContactCatalogMock.mockResolvedValue({
      channels: [...CATALOG_EMAIL_ONLY.channels],
      businessTypes: CATALOG_EMAIL_ONLY.businessTypes.map((type) => ({ ...type })),
    });
    useCart().addLine(SAMPLE, 1);
    const { wrapper } = await mountPage();

    expect(wrapper.find('#checkout-channel-email').exists()).toBe(true);
    expect(wrapper.find('#checkout-channel-whatsapp').exists()).toBe(false);
    expect(wrapper.text()).toContain('邮件询盘');
    expect(wrapper.text()).not.toContain('WhatsApp 询盘');
  });

  it('目录加载失败 ⇒ 只保留邮件渠道（绝不因目录不可用而放行 WhatsApp）', async () => {
    fetchContactCatalogMock.mockRejectedValueOnce(new ApiError(500, 'InternalError', '目录服务不可用'));
    useCart().addLine(SAMPLE, 1);
    const { wrapper } = await mountPage();

    expect(wrapper.find('#checkout-channel-email').exists()).toBe(true);
    expect(wrapper.find('#checkout-channel-whatsapp').exists()).toBe(false);
  });

  it('目录只有邮件渠道时，提交载荷的渠道恒为 EMAIL', async () => {
    fetchContactCatalogMock.mockResolvedValue({
      channels: [...CATALOG_EMAIL_ONLY.channels],
      businessTypes: CATALOG_EMAIL_ONLY.businessTypes.map((type) => ({ ...type })),
    });
    useCart().addLine(SAMPLE, 1);
    const { wrapper } = await mountPage();
    submitInquiryMock.mockResolvedValue(RESULT);

    await fillValidForm(wrapper);
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(submitInquiryMock).toHaveBeenCalledTimes(1);
    expect((submitInquiryMock.mock.calls[0]?.[0] as Record<string, unknown>).channel).toBe('EMAIL');
  });

  it('目录含 WhatsApp 时渠道选择器恢复为两项', async () => {
    useCart().addLine(SAMPLE, 1);
    const { wrapper } = await mountPage();

    expect(wrapper.find('#checkout-channel-email').exists()).toBe(true);
    expect(wrapper.find('#checkout-channel-whatsapp').exists()).toBe(true);
  });
});

describe('CheckoutPage · G6-2.9（提交失败恢复 / 结果未知区分 / 刷新重进）', () => {
  function keyOf(callIndex: number): string {
    const body = submitInquiryMock.mock.calls[callIndex]?.[0] as { idempotencyKey?: string };
    return body.idempotencyKey ?? '';
  }

  it('明确失败（500）：提示「确定失败」而非「结果未知」，且购物车与地址全部保留', async () => {
    const cart = useCart();
    cart.addLine(SAMPLE, 2);
    const { wrapper } = await mountPage();

    submitInquiryMock.mockRejectedValueOnce(new ApiError(500, 'InternalError', '服务器内部错误'));
    await fillValidForm(wrapper);
    await wrapper.get('#checkout-address').setValue('北京市朝阳区望京 SOHO T1 2001');
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    const alert = wrapper.get('.notice--error').text();
    expect(alert).toContain('服务器内部错误');
    // 500 是**确定失败**：不得把用户引向「结果未知」的措辞
    expect(alert).not.toContain('结果未知');

    // 失败后：表单、地址、购物车都必须原样保留，用户才可能修正并重试
    expect((wrapper.get('#checkout-email').element as HTMLInputElement).value).toBe('guest@example.com');
    expect((wrapper.get('#checkout-name').element as HTMLInputElement).value).toBe('张三');
    expect((wrapper.get('#checkout-address').element as HTMLTextAreaElement).value).toBe(
      '北京市朝阳区望京 SOHO T1 2001',
    );
    expect(cart.lines.value).toHaveLength(1);
    expect(cart.lines.value[0]?.quantity).toBe(2);
    expect(wrapper.get('button[type="submit"]').text()).toContain('重试提交');
  });

  it('网络断开（NETWORK_ERROR）：提示「结果未知」并保留键；与明确失败的措辞严格区分', async () => {
    useCart().addLine(SAMPLE, 1);
    const { wrapper } = await mountPage();

    submitInquiryMock.mockRejectedValueOnce(
      new ApiError(0, 'NETWORK_ERROR', '无法连接到 API（网络中断）'),
    );
    await fillValidForm(wrapper);
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    const alert = wrapper.get('.notice--error').text();
    expect(alert).toContain('结果未知');
    expect(alert).toContain('不会重复建单');

    // 键必须保留：重试复用同一键，服务端据此返回原单
    const firstKey = keyOf(0);
    expect(firstKey).not.toBe('');
    submitInquiryMock.mockResolvedValueOnce(RESULT);
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(keyOf(1)).toBe(firstKey);
  });

  it('刷新页面后重新进入结算页：购物车由 localStorage 还原并正常渲染', async () => {
    const cart = useCart();
    cart.addLine(SAMPLE, 3);

    const first = await mountPage();
    expect(first.wrapper.text()).toContain('询价商品（1 项）');
    expect(first.wrapper.text()).toContain('云朵猫爬架');
    first.wrapper.unmount();

    // 模拟「整页刷新」：只保留 localStorage，丢弃内存态
    __resetGuestCartForTest();
    const second = await mountPage();
    expect(second.wrapper.text()).toContain('询价商品（1 项）');
    expect(second.wrapper.text()).toContain('云朵猫爬架');
    expect(second.wrapper.find('form').exists()).toBe(true);
  });

  it('提交成功后：购物车清空、跳转结果页，且不残留错误提示', async () => {
    const cart = useCart();
    cart.addLine(SAMPLE, 2);
    const { wrapper, router } = await mountPage();

    submitInquiryMock.mockResolvedValue(RESULT);
    await fillValidForm(wrapper);
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(submitInquiryMock).toHaveBeenCalledTimes(1);
    expect(cart.lines.value).toHaveLength(0);
    expect(router.currentRoute.value.name).toBe('inquiry-result');
    // 成功后购物车已清空 ⇒ 页面切到空态，错误提示不残留
    expect(wrapper.find('.notice--error').exists()).toBe(false);
    expect(wrapper.text()).toContain('询价清单为空');
  });

  it('失败重试成功后，新一笔询价的结算页恢复为「提交询价」且无残留错误', async () => {
    const cart = useCart();
    cart.addLine(SAMPLE, 2);
    const first = await mountPage();

    submitInquiryMock.mockRejectedValueOnce(new ApiError(503, 'Unavailable', '服务暂时不可用'));
    await fillValidForm(first.wrapper);
    await first.wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(first.wrapper.get('button[type="submit"]').text()).toContain('重试提交');

    submitInquiryMock.mockResolvedValueOnce(RESULT);
    await first.wrapper.get('form').trigger('submit');
    await flushPromises();
    first.wrapper.unmount();

    // 新一笔询价：全新挂载 ⇒ 按钮与错误态回到初始
    cart.addLine(SAMPLE, 1);
    const second = await mountPage();
    expect(second.wrapper.get('button[type="submit"]').text()).toContain('提交询价');
    expect(second.wrapper.find('.notice--error').exists()).toBe(false);
  });
});
