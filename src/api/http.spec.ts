import { afterEach, describe, expect, it, vi } from 'vitest';
import { API_BASE_URL, ApiError, apiRequest, buildUrl } from './http';

describe('buildUrl', () => {
  it('拼接 API 前缀与路径', () => {
    expect(buildUrl('/products')).toBe(`${API_BASE_URL}/api/v1/products`);
  });

  it('自动补前导斜杠', () => {
    expect(buildUrl('categories')).toBe(`${API_BASE_URL}/api/v1/categories`);
  });

  it('忽略空值查询参数', () => {
    const url = buildUrl('/products', { page: 1, q: undefined, category: '' });
    expect(url).toBe(`${API_BASE_URL}/api/v1/products?page=1`);
  });

  it('序列化多个查询参数', () => {
    const url = buildUrl('/products', { page: 2, pageSize: 12, category: 'dog-outdoor' });
    expect(url).toContain('page=2');
    expect(url).toContain('pageSize=12');
    expect(url).toContain('category=dog-outdoor');
  });
});

describe('apiRequest', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('成功时返回解析后的 JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })),
    );

    await expect(apiRequest<{ ok: boolean }>('/health')).resolves.toEqual({ ok: true });
  });

  it('204 返回 undefined', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })));
    await expect(apiRequest('/anything')).resolves.toBeUndefined();
  });

  it('把后端错误信封归一化为 ApiError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ statusCode: 400, message: 'pageSize 最大为 50', error: 'Bad Request' }), {
            status: 400,
          }),
      ),
    );

    await expect(apiRequest('/products')).rejects.toMatchObject({
      name: 'ApiError',
      status: 400,
      code: 'Bad Request',
      message: 'pageSize 最大为 50',
    });
  });

  it('message 为数组时合并为一句', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ statusCode: 400, message: ['email 必须是邮箱', '密码过短'] }), {
            status: 400,
          }),
      ),
    );

    await expect(apiRequest('/x')).rejects.toThrow('email 必须是邮箱；密码过短');
  });

  it('网络错误转成 NETWORK_ERROR', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );

    await expect(apiRequest('/x')).rejects.toMatchObject({ code: 'NETWORK_ERROR', status: 0 });
  });

  it('超时转成 TIMEOUT', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              reject(new DOMException('Aborted', 'AbortError'));
            });
          }),
      ),
    );

    await expect(apiRequest('/x', { timeoutMs: 10 })).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('ApiError 是 Error 的子类', () => {
    expect(new ApiError(404, 'NotFound', 'x')).toBeInstanceOf(Error);
  });
});

/*
 * Phase 2.2 真实浏览器审计发现的缺陷：传输层错误（超时 / 连不上）的
 * `ApiError.message` 会被 `StateError.vue` 与 `describeSubmitError()` 原样
 * 渲染到页面上。原来的文案里带着**内部 API 地址**和「请确认后端已启动、
 * 地址正确，且已配置 CORS」这类开发指令 —— 后端一挂，顾客就会看到它们。
 *
 * 下面这组用例把「文案必须是给顾客看的」固化成断言，防止回归。
 */
describe('传输层错误文案不得暴露内部实现', () => {
  // 上面 `buildUrl` 那个 describe 里的 afterEach 不覆盖本块，这里单独清理。
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** 顾客不该在页面上看到的技术词。 */
  const LEAKS = ['CORS', 'http://', 'https://', '127.0.0.1', 'API', 'ms）', 'GET ', 'POST '];

  function expectCustomerFacing(message: string): void {
    for (const leak of LEAKS) {
      expect(message, `错误文案不应出现「${leak}」：${message}`).not.toContain(leak);
    }
    expect(message.length).toBeGreaterThan(0);
  }

  it('NETWORK_ERROR：文案不含内部地址与工程指令', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );

    const error = await apiRequest('/x').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expectCustomerFacing((error as ApiError).message);
  });

  it('TIMEOUT：文案不含超时毫秒数与 HTTP 方法与路径', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              reject(new DOMException('Aborted', 'AbortError'));
            });
          }),
      ),
    );

    const error = await apiRequest('/x', { timeoutMs: 10 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expectCustomerFacing((error as ApiError).message);
  });

  it('两条文案必须能区分「超时」与「连不上」，且都说明未收到响应', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    const net = (await apiRequest('/x').catch((e: unknown) => e)) as ApiError;

    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              reject(new DOMException('Aborted', 'AbortError'));
            });
          }),
      ),
    );
    const timeout = (await apiRequest('/x', { timeoutMs: 10 }).catch((e: unknown) => e)) as ApiError;

    expect(net.code).toBe('NETWORK_ERROR');
    expect(timeout.code).toBe('TIMEOUT');
    expect(net.message).not.toBe(timeout.message);
    expect(net.message).toContain('没有收到服务器响应');
    expect(timeout.message).toContain('没有收到服务器响应');
  });

  it('技术细节仍可从 details 取到，便于排查', async () => {
    const raw = new TypeError('Failed to fetch');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw raw;
      }),
    );

    const error = (await apiRequest('/x').catch((e: unknown) => e)) as ApiError;
    expect(error.details).toBe(raw);
  });
});
