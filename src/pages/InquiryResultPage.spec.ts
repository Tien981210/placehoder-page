import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InquirySubmitResult, WhatsAppPreviewView } from '@/api/types';
import { __resetInquirySessionForTest, setLastSubmitResult } from '@/inquiry/session';
import InquiryResultPage from './InquiryResultPage.vue';

const Dummy = { template: '<div />' };

const RESULT: InquirySubmitResult = {
  orderNo: 'LP-261012-A1B2C3D4',
  submittedAt: '2026-10-12T00:00:00.000Z',
  accessToken: 'Zm9vYmFyLXRva2VuLXZhbHVlLTEyMzQ1Ng',
  accessExpiresAt: '2026-11-11T00:00:00.000Z',
  currency: 'USD',
  submittedSubtotal: '176.00',
  itemCount: 2,
  emailDelivery: { queued: 2, transportConfigured: false },
  // G6 新增字段（邮件渠道：无 WhatsApp 预览）
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

/** 已规范化的**非占位**国际号码（占位号码会被前端主动拦截，不能用于唤起用例）。 */
const WHATSAPP_PHONE = '8613900139000';

function whatsappPreview(overrides: Partial<WhatsAppPreviewView> = {}): WhatsAppPreviewView {
  return {
    available: true,
    phoneNumber: WHATSAPP_PHONE,
    message: 'Hello LUXRA BEAUTY',
    url: `https://wa.me/${WHATSAPP_PHONE}?text=Hello%20LUXRA%20BEAUTY`,
    truncated: false,
    omittedItems: 0,
    totalItems: 2,
    manualSendRequired: true,
    ...overrides,
  };
}

const WHATSAPP_RESULT: InquirySubmitResult = {
  ...RESULT,
  channel: 'WHATSAPP',
  businessType: { key: 'sales', label: '销售咨询' },
  country: 'United Kingdom',
  city: 'London',
  postalCode: 'SW1A 1AA',
  contactResolution: {
    resolved: true,
    channel: 'WHATSAPP',
    source: 'BUSINESS_TYPE_DEFAULT',
    reason: null,
    contactOwnerName: '业务员 Amy',
    businessTypeLabel: '销售咨询',
  },
  whatsapp: whatsappPreview(),
};

async function mountPage(params = ''): Promise<{ wrapper: VueWrapper; router: Router }> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: Dummy },
      { path: '/products', name: 'products', component: Dummy },
      { path: '/cart', name: 'cart', component: Dummy },
      // 阶段 8-R1：结果页路径已收敛到 /checkout/result
      { path: '/checkout/result/:inquiryNo?', name: 'inquiry-result', component: Dummy },
    ],
  });
  await router.push(`/checkout/result${params}`);
  await router.isReady();

  const wrapper = mount(InquiryResultPage, { global: { plugins: [router] } });
  return { wrapper, router };
}

beforeEach(() => {
  localStorage.clear();
  __resetInquirySessionForTest();
});

/**
 * `window.location` 的替身 —— 用于断言「同标签导航」的目标地址。
 *
 * jsdom 不实现真实导航（直接赋值只会打印 `Not implemented: navigation`），
 * 因此换成可观测对象；`afterEach` 负责还原。
 */
const REAL_LOCATION = window.location;

function stubLocation(options: { throwOnSet?: boolean } = {}): { href: string } {
  const stub = { href: '' } as { href: string };
  if (options.throwOnSet) {
    Object.defineProperty(stub, 'href', {
      configurable: true,
      get: () => '',
      set: () => {
        throw new Error('navigation blocked');
      },
    });
  }
  Object.defineProperty(window, 'location', { configurable: true, writable: true, value: stub });
  return stub;
}

afterEach(() => {
  Reflect.deleteProperty(navigator, 'clipboard');
  vi.restoreAllMocks();
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: REAL_LOCATION,
  });
});

describe('InquiryResultPage（询价提交结果）', () => {
  it('结果不在内存中时给出引导，并提示「联系客服查询进度」', async () => {
    const { wrapper } = await mountPage('/LP-261012-A1B2C3D4');

    expect(wrapper.text()).toContain('本次没有可展示的提交结果');
    expect(wrapper.text()).toContain('联系客服');
    expect(wrapper.text()).toContain('LP-261012-A1B2C3D4');
  });

  it('展示订单号、凭证、有效期与商品项数', async () => {
    setLastSubmitResult(RESULT);
    const { wrapper } = await mountPage('/LP-261012-A1B2C3D4');
    const text = wrapper.text();

    expect(text).toContain('LP-261012-A1B2C3D4');
    expect(text).toContain(RESULT.accessToken);
    expect(text).toContain('2 项');
    expect(text).toContain('$176.00');
    expect(text).toContain('凭证有效期至');
    expect(text).toContain('访问凭证（请立即保存）');
  });

  it('明确声明不自动扣减库存、未产生付款', async () => {
    setLastSubmitResult(RESULT);
    const { wrapper } = await mountPage();
    const text = wrapper.text();

    expect(text).toContain('不会自动扣减库存');
    expect(text).toContain('未产生任何付款');
  });

  it('邮件传输层未配置时明确说「未发出任何邮件」，绝不显示成已发送', async () => {
    setLastSubmitResult(RESULT);
    const { wrapper } = await mountPage();
    const text = wrapper.text();

    expect(text).toContain('未发出任何邮件');
    expect(text).not.toContain('已发送');
  });

  it('传输层已配置时只说「已排入发送队列」', async () => {
    setLastSubmitResult({ ...RESULT, emailDelivery: { queued: 2, transportConfigured: true } });
    const { wrapper } = await mountPage();
    const text = wrapper.text();

    expect(text).toContain('已排入发送队列');
    expect(text).toContain('不会影响本询价单的保存');
    expect(text).not.toContain('邮件已发送成功');
  });

  it('不渲染任何服务端内部字段', async () => {
    setLastSubmitResult(RESULT);
    const { wrapper } = await mountPage();
    const html = wrapper.html();

    for (const forbidden of ['tokenHash', 'idempotencyKey', 'createdByAdminId', 'revokedAt']) {
      expect(html).not.toContain(forbidden);
    }
  });

  it('点击复制会写入剪贴板，并显示成功反馈', async () => {
    setLastSubmitResult(RESULT);
    const writeText = vi.fn(async (_text: string) => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    const { wrapper } = await mountPage();
    const copyButton = wrapper.findAll('button').find((button) => button.text().includes('复制'));
    expect(copyButton).toBeDefined();

    await copyButton?.trigger('click');
    await flushPromises();

    expect(writeText).toHaveBeenCalledTimes(1);
    const copied = writeText.mock.calls[0]?.[0] as string;
    expect(copied).toContain(RESULT.orderNo);
    expect(copied).toContain(RESULT.accessToken);
    expect(wrapper.text()).toContain('已复制');
  });

  it('复制失败时如实提示，不谎报成功', async () => {
    setLastSubmitResult(RESULT);
    const { wrapper } = await mountPage();

    const copyButton = wrapper.findAll('button').find((button) => button.text().includes('复制'));
    await copyButton?.trigger('click');
    await flushPromises();

    // jsdom 既无 clipboard 也无 execCommand ⇒ 必然失败
    expect(wrapper.text()).toContain('复制失败');
  });
});

describe('InquiryResultPage · G6（WhatsApp 渠道与地址回显）', () => {
  it('邮件渠道不渲染 WhatsApp 区块', async () => {
    setLastSubmitResult(RESULT);
    const { wrapper } = await mountPage();

    expect(wrapper.text()).not.toContain('WhatsApp 询盘消息');
    expect(wrapper.text()).not.toContain('打开 WhatsApp');
  });

  it('回显询盘方式、业务类型与国家/城市/邮编', async () => {
    setLastSubmitResult(WHATSAPP_RESULT);
    const { wrapper } = await mountPage();
    const text = wrapper.text();

    expect(text).toContain('WhatsApp');
    expect(text).toContain('销售咨询');
    expect(text).toContain('United Kingdom · London · SW1A 1AA');
  });

  it('WhatsApp 渠道：展示号码、**只读**消息与「消息内容已生成」状态，绝不出现「已发送」', async () => {
    setLastSubmitResult(WHATSAPP_RESULT);
    const { wrapper } = await mountPage();
    const text = wrapper.text();

    expect(text).toContain('WhatsApp 询盘消息');
    expect(text).toContain(`+${WHATSAPP_PHONE}`);
    expect(text).toContain('消息内容已生成');
    expect(text).toContain('尚未尝试打开');
    expect(text).toContain('不会自动发送');
    expect(text).not.toContain('已发送');
    expect(text).not.toContain('已送达');

    // G6-2.7：输入框已移除 —— 消息改为只读展示
    const preview = wrapper.get('#whatsapp-message');
    expect(preview.element.tagName).toBe('PRE');
    expect(preview.text()).toBe('Hello LUXRA BEAUTY');
    expect(wrapper.find('textarea#whatsapp-message').exists()).toBe(false);
  });

  it('已分配联系人时给出明确的分配说明', async () => {
    setLastSubmitResult(WHATSAPP_RESULT);
    const { wrapper } = await mountPage();

    expect(wrapper.text()).toContain('已按业务类型与渠道为你分配联系人');
    expect(wrapper.text()).toContain('业务员 Amy');
  });

  it('未解析到联系人时：WhatsApp 区块整块不渲染，只保留「询盘已保存」的明确提示', async () => {
    setLastSubmitResult({
      ...WHATSAPP_RESULT,
      contactResolution: {
        resolved: false,
        channel: 'WHATSAPP',
        source: 'NONE',
        reason: '当前没有可用的 WhatsApp 联系人',
        contactOwnerName: null,
        businessTypeLabel: null,
      },
      whatsapp: whatsappPreview({ available: false, phoneNumber: null, url: null }),
    });
    const { wrapper } = await mountPage();
    const text = wrapper.text();

    // 明确提示：未分配 + 询盘已保存
    expect(text).toContain('当前没有可用的WhatsApp联系人');
    expect(text).toContain('你的询盘已经保存');
    // ⚠️ 不能再指向一个已不存在的「复制消息」按钮
    expect(text).toContain('客服会在后台看到这张询盘单并跟进');
    expect(text).not.toContain('请使用下方「复制消息」');

    // G6-2.2：没有可用联系人 ⇒ WhatsApp 消息卡片**整块不展示**
    expect(text).not.toContain('WhatsApp 询盘消息');
    expect(text).not.toContain('打开 WhatsApp');
    expect(text).not.toContain('复制消息');
    expect(text).not.toContain('未分配（无可用的 WhatsApp 联系人）');
    expect(wrapper.find('#whatsapp-message').exists()).toBe(false);
  });

  it('联系人解析成功但号码缺失（available=false）时同样不渲染 WhatsApp 区块', async () => {
    setLastSubmitResult({
      ...WHATSAPP_RESULT,
      whatsapp: whatsappPreview({ available: false, phoneNumber: null, url: null }),
    });
    const { wrapper } = await mountPage();
    const text = wrapper.text();

    expect(text).toContain('已按业务类型与渠道为你分配联系人');
    expect(text).not.toContain('WhatsApp 询盘消息');
    expect(text).not.toContain('打开 WhatsApp');
  });

  it('号码是已知占位 / 测试号码时：阻止跳转、给出配置提示并保留复制兜底', async () => {
    setLastSubmitResult({
      ...WHATSAPP_RESULT,
      whatsapp: whatsappPreview({ phoneNumber: '8613800138000' }),
    });
    const { wrapper } = await mountPage();
    const text = wrapper.text();

    // 联系人解析成功 ⇒ 卡片仍渲染，但必须明确说明号码不可用
    expect(text).toContain('WhatsApp 询盘消息');
    expect(text).toContain('已阻止跳转');
    expect(text).toContain('联系方式配置');
    expect(text).toContain('不可用（未配置或未确认的号码）');

    // 唤起按钮被禁用，绝不生成可跳转链接
    const openButton = wrapper.findAll('button').find((b) => b.text().includes('打开 WhatsApp'));
    expect(openButton?.attributes('disabled')).toBeDefined();
    expect(wrapper.find('a[href^="https://wa.me/"]').exists()).toBe(false);

    // 仍保留「复制消息」这条备用路径
    expect(wrapper.findAll('button').some((b) => b.text().includes('复制消息'))).toBe(true);
  });

  it('号码未规范化（含 + / 空格）时同样阻止跳转', async () => {
    setLastSubmitResult({
      ...WHATSAPP_RESULT,
      whatsapp: whatsappPreview({ phoneNumber: '+86 139 0013 9000' }),
    });
    const { wrapper } = await mountPage();

    expect(wrapper.text()).toContain('已阻止跳转');
    const openButton = wrapper.findAll('button').find((b) => b.text().includes('打开 WhatsApp'));
    expect(openButton?.attributes('disabled')).toBeDefined();
  });

  it('点击打开在用户手势内**同步**导航到 whatsapp://（G6-2.2-WA-R3：纯打开、不弹窗口、不跳转），并显示「已发起打开」状态', async () => {
    setLastSubmitResult(WHATSAPP_RESULT);
    const open = vi.spyOn(window, 'open');
    const location = stubLocation();

    const { wrapper } = await mountPage();
    const button = wrapper.findAll('button').find((b) => b.text().includes('打开 WhatsApp'));
    await button?.trigger('click');
    await flushPromises();

    // 同步单次导航：不多开窗口 / 标签、不跳向任何网页、不走异步兜底
    expect(open).not.toHaveBeenCalled();
    expect(String(location.href)).toContain(`whatsapp://send?phone=${WHATSAPP_PHONE}&text=`);
    expect(String(location.href)).not.toContain('https://');
    expect(wrapper.text()).toContain('已发起打开 WhatsApp App 的动作');
    expect(wrapper.text()).toContain('重新打开 WhatsApp');
  });

  it('页面**始终**保留一条用户主动点击才生效的网页版兜底链接（同标签、不开新窗口）', async () => {
    setLastSubmitResult(WHATSAPP_RESULT);
    const { wrapper } = await mountPage();

    // G6-2.2-WA-R3：未安装 App 时点击不会有任何反应 ⇒ 兜底链接必须常显，不能只在「被拦截」时出现
    const fallback = wrapper.find('a[href^="https://wa.me/"]');
    expect(fallback.exists()).toBe(true);
    expect(fallback.text()).toContain('用网页版打开');
    expect(fallback.attributes('target')).toBeUndefined();
    expect(String(fallback.attributes('rel'))).toContain('noopener');
  });

  it('导航未能发起时如实提示，并保留消息内容供复制', async () => {
    setLastSubmitResult(WHATSAPP_RESULT);
    stubLocation({ throwOnSet: true });

    const { wrapper } = await mountPage();
    const button = wrapper.findAll('button').find((b) => b.text().includes('打开 WhatsApp'));
    await button?.trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('打开动作未能发起');
    // G6-2.7：消息只读展示，仍保留全文供手动复制
    expect(wrapper.get('#whatsapp-message').text()).toBe('Hello LUXRA BEAUTY');
  });

  it('G6-2.7：消息只读 —— 页面不再提供输入框，链接恒用服务端生成的消息', async () => {
    setLastSubmitResult(WHATSAPP_RESULT);
    const location = stubLocation();

    const { wrapper } = await mountPage();
    expect(wrapper.find('textarea#whatsapp-message').exists()).toBe(false);

    const button = wrapper.findAll('button').find((b) => b.text().includes('打开 WhatsApp'));
    await button?.trigger('click');
    await flushPromises();

    expect(String(location.href)).toContain(encodeURIComponent('Hello LUXRA BEAUTY'));
  });

  it('G6-2.7：结果页自动弹出「即将打开 WhatsApp」确认框，点确认才唤起', async () => {
    setLastSubmitResult(WHATSAPP_RESULT);
    const location = stubLocation();

    const { wrapper } = await mountPage();

    // 自动弹出，且**尚未**发起任何打开动作
    expect(wrapper.find('#wa-confirm-title').exists()).toBe(true);
    expect(wrapper.text()).toContain('即将打开 WhatsApp');
    expect(location.href).toBe('');

    // 点「确认」⇒ 正处于用户手势内 ⇒ 同步导航
    await wrapper.get('#wa-confirm-open').trigger('click');
    await flushPromises();

    expect(String(location.href)).toContain(`whatsapp://send?phone=${WHATSAPP_PHONE}&text=`);
    expect(wrapper.find('#wa-confirm-title').exists()).toBe(false);
    expect(wrapper.text()).toContain('已发起打开 WhatsApp App 的动作');
  });

  it('G6-2.7：确认框点「稍后再说」不唤起，卡片按钮仍可手动打开', async () => {
    setLastSubmitResult(WHATSAPP_RESULT);
    const location = stubLocation();

    const { wrapper } = await mountPage();
    await wrapper.get('#wa-confirm-cancel').trigger('click');
    await flushPromises();

    expect(location.href).toBe('');
    expect(wrapper.find('#wa-confirm-title').exists()).toBe(false);

    await wrapper.get('#whatsapp-open').trigger('click');
    await flushPromises();
    expect(String(location.href)).toContain(`whatsapp://send?phone=${WHATSAPP_PHONE}&text=`);
  });

  it('G6-2.7：号码不可用（占位号码）时**不弹**确认框', async () => {
    setLastSubmitResult({
      ...WHATSAPP_RESULT,
      whatsapp: whatsappPreview({ phoneNumber: '8613800138000' }),
    });
    const { wrapper } = await mountPage();

    expect(wrapper.find('#wa-confirm-title').exists()).toBe(false);
  });

  it('复制 WhatsApp 消息会写入剪贴板，内容含消息、号码与询盘号', async () => {
    setLastSubmitResult(WHATSAPP_RESULT);
    const writeText = vi.fn(async (_text: string) => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    const { wrapper } = await mountPage();
    const button = wrapper.findAll('button').find((b) => b.text().includes('复制消息'));
    await button?.trigger('click');
    await flushPromises();

    expect(writeText).toHaveBeenCalledTimes(1);
    const copied = writeText.mock.calls[0]?.[0] as string;
    expect(copied).toContain('Hello LUXRA BEAUTY');
    expect(copied).toContain(`+${WHATSAPP_PHONE}`);
    expect(copied).toContain(WHATSAPP_RESULT.orderNo);
    expect(wrapper.text()).toContain('已复制消息');
  });

  it('消息被截断时明确告知省略项数，并指向询盘单号', async () => {
    setLastSubmitResult({
      ...WHATSAPP_RESULT,
      whatsapp: whatsappPreview({ truncated: true, omittedItems: 3, totalItems: 12 }),
    });
    const { wrapper } = await mountPage();
    const text = wrapper.text();

    expect(text).toContain('已省略 3 项商品');
    expect(text).toContain('共 12 项');
    expect(text).toContain(WHATSAPP_RESULT.orderNo);
  });
});
