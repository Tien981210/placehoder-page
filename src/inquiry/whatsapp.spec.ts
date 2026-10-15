import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WhatsAppPreviewView } from '@/api/types';
import {
  PLACEHOLDER_WHATSAPP_NUMBERS,
  WHATSAPP_MANUAL_SEND_NOTICE,
  WHATSAPP_MAX_DIGITS,
  WHATSAPP_MIN_DIGITS,
  WHATSAPP_OPEN_HINT,
  buildWhatsAppAppUrl,
  buildWhatsAppCopyText,
  buildWhatsAppUrl,
  digitsOnly,
  formatInternationalPhone,
  isUsableWhatsAppNumber,
  isWhatsAppOpenable,
  openWhatsApp,
} from './whatsapp';

/**
 * WhatsApp 唤起工具测试（G6 功能四；G6-2.2-WA 修复；G6-2.2-WA-R3 纯打开 App）。
 *
 * 核心断言方向：**只用官方支持的链接，只承诺能做到的事** ——
 *   1. **网页版**链接一律是 `https://wa.me/<纯数字国际号码>?text=<编码消息>`；
 *      **App 唤起**链接一律是官方 `whatsapp://send?phone=<号码>&text=<编码消息>`；
 *   2. 唤起在**用户手势内同步**完成：单次导航、
 *      **不注册任何定时器**、不做重试、**不新开窗口 / 标签**（不调用 `window.open`）；
 *   3. **不自作主张跳转网页版** —— 用户明确要求「不弹页面、不跳转、纯打开」，
 *      网页版链接只作为「用户主动点击」的兜底返回；
 *   4. 号码缺失 / 为占位号码时**不得**生成可跳转链接；
 *   5. 不得出现「已发送 / 已送达」等无法确认的状态措辞。
 */

/** 已规范化的国际号码（本仓库测试夹具统一使用的占位号码，只用于「构造」用例）。 */
const PHONE = '8613800138000';
/** 一个**非**占位名单内的合法号码 —— 用于唤起链路用例。 */
const REAL_PHONE = '8613900139000';

const preview = (overrides: Partial<WhatsAppPreviewView> = {}): WhatsAppPreviewView => ({
  available: true,
  phoneNumber: REAL_PHONE,
  message: 'Hello LUXRA BEAUTY',
  url: `https://wa.me/${REAL_PHONE}?text=Hello%20LUXRA%20BEAUTY`,
  truncated: false,
  omittedItems: 0,
  totalItems: 2,
  manualSendRequired: true,
  ...overrides,
});

/**
 * `window.location` 的替身 —— 用于断言「同标签导航」的目标地址。
 *
 * jsdom 不实现真实导航（直接赋值只会打印 `Not implemented: navigation`），
 * 因此这里用 `Object.defineProperty` 换成一个可观测对象；`afterEach` 负责还原。
 */
const REAL_LOCATION = window.location;

function stubLocation(options: { throwOnSet?: boolean } = {}): { href: string } {
  const stub = { href: '' } as { href: string };
  if (options.throwOnSet) {
    // 模拟「环境禁止导航」的极端情况：赋值即抛错
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
  vi.useRealTimers();
  vi.restoreAllMocks();
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: REAL_LOCATION,
  });
});

describe('buildWhatsAppUrl（标准 Click to Chat 链接）', () => {
  it('使用 https://wa.me/<号码>?text=<编码消息> 形式', () => {
    expect(buildWhatsAppUrl(PHONE, 'Hi')).toBe(`https://wa.me/${PHONE}?text=Hi`);
  });

  it('对消息做 URL 编码：换行、空格、& ? # 等都不会破坏链接结构', () => {
    const message = 'line1\nline2 & more? #tag';
    const url = buildWhatsAppUrl(PHONE, message);

    expect(url.startsWith(`https://wa.me/${PHONE}?text=`)).toBe(true);
    expect(url).not.toContain('\n');
    expect(url).not.toContain(' ');
    // 消息里的裸 & 必须被编码，否则会被解析成额外的查询参数
    expect(url.slice(`https://wa.me/${PHONE}?text=`.length)).toBe(encodeURIComponent(message));
    expect(new URL(url).searchParams.get('text')).toBe(message);
  });

  it('不重复编码：已经编码过的内容不会被二次编码', () => {
    // `%20` 是「已编码」的空格；若被二次编码会变成 `%2520`
    const url = buildWhatsAppUrl(PHONE, 'a%20b');
    expect(url).toBe(`https://wa.me/${PHONE}?text=a%2520b`); // encodeURIComponent('%') => '%25'
    expect(new URL(url).searchParams.get('text')).toBe('a%20b');
  });

  it('兼容中文与表情符号（UTF-8 + encodeURIComponent）', () => {
    const message = '你好 LUXRA BEAUTY 🐶 我想咨询玩具';
    const url = buildWhatsAppUrl(PHONE, message);

    expect(url).not.toContain(' ');
    expect(new URL(url).searchParams.get('text')).toBe(message);
  });

  it('HTTPS 链接绝不混入私有协议', () => {
    const url = buildWhatsAppUrl(PHONE, 'Hi');
    expect(url.startsWith('https://')).toBe(true);
    expect(url).not.toContain('whatsapp://');
  });

  it('不暴露顾客个人信息以外的敏感内容 —— 链接里只有号码与消息正文', () => {
    const url = buildWhatsAppUrl(REAL_PHONE, 'Hello');
    expect(new URL(url).origin).toBe('https://wa.me');
    expect(new URL(url).pathname).toBe(`/${REAL_PHONE}`);
    expect([...new URL(url).searchParams.keys()]).toEqual(['text']);
  });
});

describe('digitsOnly / isUsableWhatsAppNumber（号码可用性守卫）', () => {
  it('digitsOnly 去掉一切非数字字符', () => {
    expect(digitsOnly('+86 (138) 0013-8000')).toBe('8613800138000');
  });

  it('缺失 / 空白号码不可用', () => {
    expect(isUsableWhatsAppNumber(null)).toBe(false);
    expect(isUsableWhatsAppNumber(undefined)).toBe(false);
    expect(isUsableWhatsAppNumber('')).toBe(false);
    expect(isUsableWhatsAppNumber('   ')).toBe(false);
  });

  it('未规范化的号码（含 + / 空格 / 括号 / 连字符）不可用', () => {
    expect(isUsableWhatsAppNumber('+8613900139000')).toBe(false);
    expect(isUsableWhatsAppNumber('86 139 0013 9000')).toBe(false);
    expect(isUsableWhatsAppNumber('(86)13900139000')).toBe(false);
    expect(isUsableWhatsAppNumber('86-139-0013-9000')).toBe(false);
  });

  it(`长度必须落在 ${WHATSAPP_MIN_DIGITS}–${WHATSAPP_MAX_DIGITS} 位之间`, () => {
    expect(isUsableWhatsAppNumber('1'.repeat(WHATSAPP_MIN_DIGITS - 1))).toBe(false);
    expect(isUsableWhatsAppNumber('1'.repeat(WHATSAPP_MAX_DIGITS + 1))).toBe(false);
    expect(isUsableWhatsAppNumber('1'.repeat(WHATSAPP_MIN_DIGITS))).toBe(true);
    expect(isUsableWhatsAppNumber('1'.repeat(WHATSAPP_MAX_DIGITS))).toBe(true);
  });

  it('已知占位 / 测试号码一律不可用（绝不把测试号码当正式号码）', () => {
    expect(PLACEHOLDER_WHATSAPP_NUMBERS.length).toBeGreaterThan(0);
    for (const placeholder of PLACEHOLDER_WHATSAPP_NUMBERS) {
      expect(isUsableWhatsAppNumber(placeholder)).toBe(false);
    }
  });

  it('合法且非占位的国际号码可用', () => {
    expect(isUsableWhatsAppNumber(REAL_PHONE)).toBe(true);
    expect(isUsableWhatsAppNumber('14155552671')).toBe(true); // 美国
    expect(isUsableWhatsAppNumber('442071838750')).toBe(true); // 英国
  });
});

describe('formatInternationalPhone（仅用于展示）', () => {
  it('补上前导 +', () => {
    expect(formatInternationalPhone(REAL_PHONE)).toBe(`+${REAL_PHONE}`);
  });

  it('号码本身不含 + 号（wa.me 路径不能带 +）', () => {
    expect(formatInternationalPhone(REAL_PHONE).slice(1)).not.toContain('+');
  });
});

describe('buildWhatsAppAppUrl（App 自定义协议 · G6-2.2-WA-R3）', () => {
  it('使用 whatsapp://send?phone=<号码>&text=<编码消息> 形式', () => {
    expect(buildWhatsAppAppUrl(PHONE, 'Hi')).toBe(`whatsapp://send?phone=${PHONE}&text=Hi`);
  });

  it('号码不带 +，消息正确编码：换行、空格、& ? # 都不会破坏链接结构', () => {
    const message = 'line1\nline2 & more? #tag';
    const url = buildWhatsAppAppUrl(REAL_PHONE, message);
    const prefix = `whatsapp://send?phone=${REAL_PHONE}&text=`;

    expect(url.startsWith(prefix)).toBe(true);
    expect(url).not.toContain('\n');
    expect(url).not.toContain(' ');
    expect(url.slice(prefix.length)).toBe(encodeURIComponent(message));
  });

  it('与网页版链接共用同一套号码与编码（只换协议）', () => {
    const message = '你好 LUXRA BEAUTY 🐶 line\n2';
    const appUrl = buildWhatsAppAppUrl(REAL_PHONE, message);
    const webUrl = buildWhatsAppUrl(REAL_PHONE, message);

    expect(appUrl).toContain(`phone=${REAL_PHONE}`);
    expect(webUrl).toContain(`wa.me/${REAL_PHONE}`);
    expect(appUrl.split('text=')[1]).toBe(webUrl.split('text=')[1]);
  });

  it('不是 http(s) 链接 —— 浏览器无法渲染它，因此当前页面不会被替换', () => {
    const url = buildWhatsAppAppUrl(REAL_PHONE, 'Hi');
    expect(url.startsWith('whatsapp://')).toBe(true);
    expect(url.startsWith('http')).toBe(false);
  });
});

describe('openWhatsApp（手势内同步 · G6-2.2-WA-R3 纯打开 App：不弹窗口、不跳转）', () => {
  it('导航到 whatsapp:// 协议：不调用 window.open，也不跳向任何网页', () => {
    const open = vi.spyOn(window, 'open');
    const location = stubLocation();

    const result = openWhatsApp(REAL_PHONE, 'Hi');

    expect(open).not.toHaveBeenCalled();
    expect(result.attempted).toBe(true);
    expect(location.href).toBe(`whatsapp://send?phone=${REAL_PHONE}&text=Hi`);
    // 绝不自作主张跳到网页版（用户明确拒绝「跳转页面」）
    expect(String(location.href)).not.toContain('https://');
    expect(String(location.href)).not.toContain('wa.me');
    // 但网页版链接仍作为兜底返回，供用户**主动点击**
    expect(result.webUrl).toBe(`https://wa.me/${REAL_PHONE}?text=Hi`);
  });

  it('**同步**返回结果，不返回 Promise、不注册任何定时器（异步兜底已被移除）', () => {
    vi.useFakeTimers();
    stubLocation();

    const result = openWhatsApp(REAL_PHONE, 'Hi');

    // 返回值不是 thenable ⇒ 调用方不需要 await
    expect(typeof (result as unknown as { then?: unknown }).then).toBe('undefined');
    // 没有 setTimeout / setInterval 残留 ⇒ 不会「过一会儿又跳一次」
    expect(vi.getTimerCount()).toBe(0);
  });

  it('只导航一次：不预开空白标签、不使用隐藏 iframe', () => {
    const location = stubLocation();
    const framesBefore = window.frames.length;

    openWhatsApp(REAL_PHONE, 'Hi');

    expect(window.frames.length).toBe(framesBefore);
    expect(String(location.href)).toBe(`whatsapp://send?phone=${REAL_PHONE}&text=Hi`);
  });

  it('环境禁止导航（赋值抛错）时 attempted 为 false，但两条链接仍返回供兜底', () => {
    stubLocation({ throwOnSet: true });

    const result = openWhatsApp(REAL_PHONE, 'Hi');

    expect(result.attempted).toBe(false);
    expect(result.appUrl).toBe(`whatsapp://send?phone=${REAL_PHONE}&text=Hi`);
    expect(result.webUrl).toBe(`https://wa.me/${REAL_PHONE}?text=Hi`);
  });

  it('消息被正确编码进 App 链接（换行不会破坏链接结构）', () => {
    const location = stubLocation();

    openWhatsApp(REAL_PHONE, 'EDITED BY USER 中文\n第二行');

    expect(String(location.href)).toContain(encodeURIComponent('EDITED BY USER 中文\n第二行'));
    expect(String(location.href)).not.toContain('\n');
  });

  it('不触发任何真实发送（不发网络请求、不调用 window.open）', () => {
    const open = vi.spyOn(window, 'open');
    const fetchSpy = typeof globalThis.fetch === 'function' ? vi.spyOn(globalThis, 'fetch') : null;
    stubLocation();

    openWhatsApp(REAL_PHONE, 'Hi');

    expect(open).not.toHaveBeenCalled();
    expect(fetchSpy?.mock.calls.length ?? 0).toBe(0);
  });
});

describe('buildWhatsAppCopyText（唤起失败时的兜底）', () => {
  it('包含消息正文、展示用号码与询盘号', () => {
    const text = buildWhatsAppCopyText(preview(), 'LP-261012-A1B2C3D4');

    expect(text).toContain('Hello LUXRA BEAUTY');
    expect(text).toContain(`+${REAL_PHONE}`);
    expect(text).toContain('LP-261012-A1B2C3D4');
  });

  it('未解析到联系人时仍保留消息正文与询盘号（不静默丢失）', () => {
    const text = buildWhatsAppCopyText(
      preview({ phoneNumber: null, url: null, available: false }),
      'LP-261012-AAAABBBB',
    );

    expect(text).toContain('Hello LUXRA BEAUTY');
    expect(text).toContain('LP-261012-AAAABBBB');
    expect(text).not.toContain('+null');
  });

  it('用户编辑后的消息优先于原始消息（复制的是用户当前看到的内容）', () => {
    const text = buildWhatsAppCopyText(preview({ message: 'EDITED CONTENT' }), 'LP-1');
    expect(text).toContain('EDITED CONTENT');
  });
});

describe('isWhatsAppOpenable（是否可唤起）', () => {
  it('null 预览不可唤起', () => {
    expect(isWhatsAppOpenable(null)).toBe(false);
  });

  it('未解析到联系人（available=false）不可唤起', () => {
    expect(isWhatsAppOpenable(preview({ available: false, phoneNumber: null, url: null }))).toBe(
      false,
    );
  });

  it('号码缺失不可唤起', () => {
    expect(isWhatsAppOpenable(preview({ phoneNumber: null }))).toBe(false);
  });

  it('号码为占位 / 测试号码不可唤起', () => {
    expect(isWhatsAppOpenable(preview({ phoneNumber: PLACEHOLDER_WHATSAPP_NUMBERS[0] }))).toBe(
      false,
    );
  });

  it('url 为空串不可唤起', () => {
    expect(isWhatsAppOpenable(preview({ url: '' }))).toBe(false);
  });

  it('已解析到联系人且号码可用、链接已构造时可唤起', () => {
    expect(isWhatsAppOpenable(preview())).toBe(true);
  });
});

describe('文案约束（不得伪造发送状态 / 不得承诺一定成功）', () => {
  it('人工发送说明明确要求用户手动发送，且不出现「已发送 / 已送达」', () => {
    expect(WHATSAPP_MANUAL_SEND_NOTICE).toContain('手动');
    expect(WHATSAPP_MANUAL_SEND_NOTICE).toContain('不会自动发送');
    expect(WHATSAPP_MANUAL_SEND_NOTICE).not.toContain('已发送');
    expect(WHATSAPP_MANUAL_SEND_NOTICE).not.toContain('已送达');
  });

  it('唤起提示如实说明「未安装 App 时不会有任何反应」，并给出手动出路', () => {
    expect(WHATSAPP_OPEN_HINT).toContain('未安装');
    expect(WHATSAPP_OPEN_HINT).toContain('复制消息');
    expect(WHATSAPP_OPEN_HINT).toContain('网页版');
    expect(WHATSAPP_OPEN_HINT).not.toContain('已发送');
    expect(WHATSAPP_OPEN_HINT).not.toContain('一定能打开');
  });
});
