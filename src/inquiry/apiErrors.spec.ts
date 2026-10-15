import { describe, expect, it } from 'vitest';
import { ApiError } from '@/api/http';
import {
  describeLoadError,
  describeLookupError,
  describeSubmitError,
  extractUnavailableProducts,
} from './apiErrors';

describe('extractUnavailableProducts（解析 409 不可询价明细）', () => {
  it('提取合法明细', () => {
    const error = new ApiError(409, 'Conflict', '部分商品当前不可询价', {
      statusCode: 409,
      message: '部分商品当前不可询价',
      error: 'Conflict',
      unavailable: [
        { productId: 'p1', reason: 'INACTIVE' },
        { productId: 'p2', reason: 'NOT_FOUND' },
      ],
    });

    expect(extractUnavailableProducts(error)).toEqual([
      { productId: 'p1', reason: 'INACTIVE' },
      { productId: 'p2', reason: 'NOT_FOUND' },
    ]);
  });

  it('非 ApiError 返回空数组', () => {
    expect(extractUnavailableProducts(new Error('boom'))).toEqual([]);
    expect(extractUnavailableProducts(undefined)).toEqual([]);
  });

  it('details 结构不符时安全返回空数组（脏载荷不崩页面）', () => {
    expect(extractUnavailableProducts(new ApiError(409, 'Conflict', 'x', null))).toEqual([]);
    expect(extractUnavailableProducts(new ApiError(409, 'Conflict', 'x', { unavailable: 'oops' }))).toEqual([]);
    expect(
      extractUnavailableProducts(new ApiError(409, 'Conflict', 'x', { unavailable: [{ productId: 1 }] })),
    ).toEqual([]);
    expect(
      extractUnavailableProducts(new ApiError(409, 'Conflict', 'x', { unavailable: [null, 'a', 3] })),
    ).toEqual([]);
  });
});

describe('describeLookupError（查询失败提示）', () => {
  it('404 给出统一中性提示，不猜测具体原因（避免枚举）', () => {
    const message = describeLookupError(new ApiError(404, 'Not Found', 'Not Found'));
    expect(message).toContain('未找到匹配的询价单');
    expect(message).toContain('订单号与访问凭证');
    // 不得暗示「凭证存在但订单号错」之类的可枚举信息
    expect(message).not.toContain('凭证错误');
  });

  it('400 提示格式问题', () => {
    const message = describeLookupError(new ApiError(400, 'Bad Request', 'accessToken 长度不合法'));
    expect(message).toContain('输入格式不正确');
  });

  it('其它错误透传 message，未知错误给兜底文案', () => {
    expect(describeLookupError(new ApiError(503, 'Service Unavailable', '服务暂不可用'))).toBe(
      '服务暂不可用',
    );
    expect(describeLookupError(new Error('x'))).toBe('查询失败，请稍后重试。');
  });
});

describe('describeSubmitError（提交失败提示）', () => {
  it('透传后端 message', () => {
    expect(describeSubmitError(new ApiError(409, 'Conflict', '部分商品当前不可询价'))).toBe(
      '部分商品当前不可询价',
    );
  });

  it('未知错误给兜底文案', () => {
    expect(describeSubmitError(new Error('x'))).toBe('提交失败，请稍后重试。');
  });

  it('超时（status=0/TIMEOUT）必须提示「结果未知」并说明重试安全', () => {
    const message = describeSubmitError(new ApiError(0, 'TIMEOUT', '请求超时（15000ms）：POST /inquiries'));
    expect(message).toContain('结果未知');
    expect(message).toContain('幂等键');
    expect(message).toContain('不会重复建单');
    // 不能只说「失败」——否则用户会误以为没提交成功而反复重提
    expect(message).not.toBe('请求超时（15000ms）：POST /inquiries');
  });

  it('网络错误（status=0/NETWORK_ERROR）同样提示「结果未知」', () => {
    const message = describeSubmitError(new ApiError(0, 'NETWORK_ERROR', '无法连接到 API'));
    expect(message).toContain('结果未知');
    expect(message).toContain('不会重复建单');
  });

  it('status=0 的文案若含内部细节（地址 / CORS），一律换成顾客文案', () => {
    const message = describeSubmitError(
      new ApiError(0, 'NETWORK_ERROR', '无法连接到 API（http://127.0.0.1:4100）。请配置 CORS。'),
    );
    expect(message).not.toContain('http://');
    expect(message).not.toContain('CORS');
    expect(message).not.toContain('API');
    expect(message).toContain('结果未知');
    expect(message).toContain('不会重复建单');
  });

  it('演示模式（status=0/MOCK_MODE）不得提示「结果未知」——请求从未发出', () => {
    const message = describeSubmitError(new ApiError(0, 'MOCK_MODE', '当前为演示数据模式'));
    expect(message).toBe('当前为演示数据模式');
    expect(message).not.toContain('结果未知');
  });

  it('有明确 HTTP 状态码的错误不得附加「结果未知」（确定失败）', () => {
    const message = describeSubmitError(new ApiError(500, 'Internal Server Error', '服务器内部错误'));
    expect(message).toBe('服务器内部错误');
    expect(message).not.toContain('结果未知');
  });

  /* ---------------- Phase 2.2（P1-11）：5xx 的英文框架文案必须本地化 ---------------- */

  it('5xx 且后端只给了英文框架文案时，替换为本地化、可操作的中文提示', () => {
    // 真实浏览器实测：后端 500 时把 NestJS 默认的 "Internal Server Error" 原样透出
    const message = describeSubmitError(
      new ApiError(500, 'Internal Server Error', 'Internal Server Error'),
    );

    expect(message).not.toContain('Internal Server Error');
    // 必须含中文，且告诉顾客「这次没成功」以及「接下来能做什么」
    expect(message).toMatch(/[\u4e00-\u9fff]/);
    expect(message).toContain('没有提交成功');
    expect(message).toContain('重试');
    // 拿到 5xx 响应 = 确定失败，不得误报「结果未知」
    expect(message).not.toContain('结果未知');
  });

  it('网关类英文文案（502 / 504）同样被本地化', () => {
    for (const [status, code] of [
      [502, 'Bad Gateway'],
      [504, 'Gateway Timeout'],
      [503, 'Service Unavailable'],
    ] as const) {
      const message = describeSubmitError(new ApiError(status, code, code));
      expect(message).not.toContain(code);
      expect(message).toMatch(/[\u4e00-\u9fff]/);
      expect(message).not.toContain('结果未知');
    }
  });

  it('5xx 但后端已给出中文说明时，保留后端文案（不覆盖业务话术）', () => {
    const message = describeSubmitError(new ApiError(503, 'Unavailable', '服务维护中，请稍后再试'));
    expect(message).toBe('服务维护中，请稍后再试');
  });

  it('4xx 不受本地化规则影响（业务错误照旧透传）', () => {
    expect(describeSubmitError(new ApiError(400, 'Bad Request', 'contactEmail 格式不正确'))).toBe(
      'contactEmail 格式不正确',
    );
  });
});

/*
 * `describeLoadError()` —— 数据加载失败（StateError.vue）。
 *
 * Phase 2.2 真实浏览器实测（`audit/phase22/apierr_probe.py`，route 拦截制造 500）：
 *   首页 / 商品列表 / 商品详情 / 分类页在 500 时，页面上直接渲染出
 *   `Internal Server Error`，因为 StateError 原本无条件透传 error.message。
 */
describe('describeLoadError（数据加载失败文案）', () => {
  it('5xx 的英文框架文案被本地化，不再出现 Internal Server Error', () => {
    for (const [status, code] of [
      [500, 'Internal Server Error'],
      [502, 'Bad Gateway'],
      [503, 'Service Unavailable'],
      [504, 'Gateway Timeout'],
    ] as const) {
      const message = describeLoadError(new ApiError(status, code, code));
      expect(message).not.toContain(code);
      expect(message).toMatch(/[\u4e00-\u9fff]/);
      expect(message).toContain('重试');
    }
  });

  it('后端已给出中文业务文案时原样保留（实测 404 返回「商品不存在或已下架」）', () => {
    expect(describeLoadError(new ApiError(404, 'Not Found', '商品不存在或已下架'))).toBe(
      '商品不存在或已下架',
    );
  });

  it('4xx 的英文文案也换成顾客文案，不把框架英文透出去', () => {
    const message = describeLoadError(new ApiError(400, 'Bad Request', 'Bad Request'));
    expect(message).not.toContain('Bad Request');
    expect(message).toMatch(/[\u4e00-\u9fff]/);
  });

  it('status 0：中文传输文案沿用（http.ts 已归一化）', () => {
    expect(describeLoadError(new ApiError(0, 'TIMEOUT', '请求超时，没有收到服务器响应。'))).toBe(
      '请求超时，没有收到服务器响应。',
    );
  });

  it('status 0 但文案非中文时兜底，不暴露内部细节', () => {
    const message = describeLoadError(
      new ApiError(0, 'NETWORK_ERROR', '无法连接到 API（http://127.0.0.1:4100）。请配置 CORS。'),
    );
    expect(message).not.toContain('http://');
    expect(message).not.toContain('CORS');
    expect(message).toMatch(/[\u4e00-\u9fff]/);
  });

  it('非 ApiError 的英文 Error 不透传，中文 Error 保留', () => {
    expect(describeLoadError(new TypeError('Failed to fetch'))).toMatch(/[\u4e00-\u9fff]/);
    expect(describeLoadError(new Error('自定义中文说明'))).toBe('自定义中文说明');
  });

  it('非 Error 值有兜底文案', () => {
    expect(describeLoadError(undefined)).toMatch(/[\u4e00-\u9fff]/);
    expect(describeLoadError('boom')).toMatch(/[\u4e00-\u9fff]/);
  });
});
