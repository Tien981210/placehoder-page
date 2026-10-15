import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __setMockModeForTest, submitInquiry } from './client';
import { API_BASE_URL } from './http';

/**
 * 询价接口的两条分支验证。
 *
 * 核心约束：**绝不伪造成功**。
 *   - 演示模式下必须明确失败，而不是返回一个看起来像真单的假结果；
 *   - 真实模式下必须原样上送 { productId, quantity }，且后端报错时如实抛出。
 *
 * 说明：本仓库存在 .env.local（VITE_USE_MOCK=false），Vite 会把它一并加载，
 * 因此这里用 __setMockModeForTest 显式切换两条分支，不依赖环境文件。
 *
 * 🔴 Luxra Beauty 临时站裁剪：`lookupOrder`（游客订单查询）与
 *    `acceptMyInquiryQuote`（账户确认报价）两个函数的用例已删除 ——
 *    这两个能力随账户体系与订单查询页一并移除。
 */

const PRODUCT_ID = '01920000-0000-7000-8000-000000000001';

const REQUEST = {
  contactEmail: 'guest@example.com',
  contactName: '张三',
  shippingAddress: '123 Pet Street, Springfield, IL 62704, USA',
  lines: [{ productId: PRODUCT_ID, quantity: 2 }],
  idempotencyKey: 'a'.repeat(36),
};

beforeEach(() => {
  __setMockModeForTest(true);
});

afterEach(() => {
  vi.unstubAllGlobals();
  __setMockModeForTest(true);
});

describe('演示模式（VITE_USE_MOCK=true）', () => {
  it('submitInquiry 明确失败且不发起任何网络请求', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    await expect(submitInquiry(REQUEST)).rejects.toMatchObject({
      name: 'ApiError',
      code: 'MOCK_MODE',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('真实模式（VITE_USE_MOCK=false）', () => {
  it('提交到 POST /api/v1/inquiries，并原样透传商品行', async () => {
    __setMockModeForTest(false);
    const fetchSpy = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(JSON.stringify({ orderNo: 'LP-261012-A1B2C3D4', accessToken: 'tok' }), {
          status: 201,
        }),
    );
    vi.stubGlobal('fetch', fetchSpy);

    const result = await submitInquiry(REQUEST);

    expect(result.orderNo).toBe('LP-261012-A1B2C3D4');
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toBe(`${API_BASE_URL}/api/v1/inquiries`);
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual(REQUEST);
    // 临时站没有顾客令牌 ⇒ 绝不应出现 Authorization 头
    expect((init?.headers as Record<string, string> | undefined)?.Authorization).toBeUndefined();
  });

  it('后端报错时如实抛出，不返回伪造的成功结果', async () => {
    __setMockModeForTest(false);
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (_url: string, _init?: RequestInit) =>
          new Response(JSON.stringify({ statusCode: 503, message: '邮件服务不可用' }), {
            status: 503,
          }),
      ),
    );

    await expect(submitInquiry(REQUEST)).rejects.toMatchObject({
      name: 'ApiError',
      status: 503,
      message: '邮件服务不可用',
    });
  });

  it('部分商品不可询价时透出 409 明细供界面定位', async () => {
    __setMockModeForTest(false);
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (_url: string, _init?: RequestInit) =>
          new Response(
            JSON.stringify({
              statusCode: 409,
              message: '部分商品当前不可询价',
              error: 'Conflict',
              unavailable: [{ productId: PRODUCT_ID, reason: 'INACTIVE' }],
            }),
            { status: 409 },
          ),
      ),
    );

    await expect(submitInquiry(REQUEST)).rejects.toMatchObject({
      status: 409,
      details: { unavailable: [{ productId: PRODUCT_ID, reason: 'INACTIVE' }] },
    });
  });
});
