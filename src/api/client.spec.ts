import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * 演示模式开关的**缺省方向**（Phase 2.1 新增）。
 *
 * 背景：早期实现是 `(env ?? 'true') !== 'false'` —— 环境变量缺失时
 * **静默进入演示模式**。构建机没有 `.env`、或变量名写错时，产物会把
 * `mock.ts` 里约 20 件并不存在的商品当成真实商品库渲染出来，
 * 这直接违反「不得伪造数据」的硬约束。
 *
 * 现在的语义是：**只有显式 `VITE_USE_MOCK=true` 才进演示模式**。
 * 本文件把这条方向固定下来 —— 缺配置时应当走真实 API 并如实报错，
 * 而不是编造出一个看起来正常的商品列表。
 *
 * 实现说明：开关在**模块加载时**求值，因此每个用例都必须
 * `vi.resetModules()` 后动态 import，才能拿到重新求值的模块实例。
 */

async function loadClient() {
  vi.resetModules();
  return import('./client');
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('演示模式开关的缺省方向', () => {
  it('显式 VITE_USE_MOCK=true 时才进入演示模式', async () => {
    vi.stubEnv('VITE_USE_MOCK', 'true');
    const client = await loadClient();
    expect(client.isMockActive()).toBe(true);
  });

  it('VITE_USE_MOCK=false 时不进入演示模式', async () => {
    vi.stubEnv('VITE_USE_MOCK', 'false');
    const client = await loadClient();
    expect(client.isMockActive()).toBe(false);
  });

  it('VITE_USE_MOCK 未设置时不进入演示模式（缺配置 ⇒ 走真实 API）', async () => {
    vi.stubEnv('VITE_USE_MOCK', undefined);
    const client = await loadClient();
    expect(client.isMockActive()).toBe(false);
  });

  it('VITE_USE_MOCK 为空串 / 非法值时不进入演示模式（不把拼错当成开启）', async () => {
    vi.stubEnv('VITE_USE_MOCK', '');
    expect((await loadClient()).isMockActive()).toBe(false);

    vi.stubEnv('VITE_USE_MOCK', 'TRUE');
    expect((await loadClient()).isMockActive()).toBe(false);

    vi.stubEnv('VITE_USE_MOCK', 'yes');
    expect((await loadClient()).isMockActive()).toBe(false);
  });

  it('演示模式下提交询价**如实失败**，不返回伪造的成功结果', async () => {
    vi.stubEnv('VITE_USE_MOCK', 'true');
    const client = await loadClient();
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    await expect(
      client.submitInquiry({
        contactEmail: 'guest@example.com',
        contactName: '张三',
        shippingAddress: '123 Test Street',
        lines: [{ productId: '01920000-0000-7000-8000-000000000001', quantity: 1 }],
        idempotencyKey: 'a'.repeat(36),
      }),
    ).rejects.toMatchObject({ name: 'ApiError', code: 'MOCK_MODE' });

    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
