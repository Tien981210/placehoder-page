/**
 * 统一 HTTP 调用层。
 *
 * 职责：
 *   - 拼接 API 源与 /api/v1 前缀；
 *   - 统一序列化 query / body；
 *   - 把后端的错误信封（NestJS 默认 { statusCode, message, error }）归一化为 ApiError；
 *   - 对超时 / 网络错误给出可读的错误信息。
 *
 * 注意：本文件不包含任何业务语义，业务调用见 client.ts。
 */

/** 后端统一 API 前缀（与 luxra-beauty-backend/src/app.setup.ts 的 API_PREFIX 一致）。 */
export const API_PREFIX = '/api/v1';

/** API 源，来自环境变量；默认指向本地后端。 */
export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:4000').replace(
  /\/+$/,
  '',
);

export type QueryValue = string | number | boolean | null | undefined;

export interface ApiRequestInit {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  query?: Record<string, QueryValue>;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** 毫秒；默认 15000 */
  timeoutMs?: number;
}

/** 归一化后的 API 错误。 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** 把后端错误信封转成一句可读文案。 */
function extractMessage(payload: unknown, fallback: string): string {
  if (typeof payload === 'string' && payload.trim()) return payload.trim();
  if (typeof payload === 'object' && payload !== null) {
    const message = (payload as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message.trim();
    if (Array.isArray(message) && message.length > 0) {
      return message.filter((item): item is string => typeof item === 'string').join('；');
    }
  }
  return fallback;
}

/**
 * 把「连不上」的**工程排查细节**写到控制台，而不是写进给顾客看的错误文案。
 *
 * 背景（Phase 2.2 真实浏览器实测）：原来这两条错误直接把
 *   `无法连接到 API（http://127.0.0.1:4100）。请确认后端已启动、地址正确，且已配置 CORS。`
 * 当作 `ApiError.message`。而 `StateError.vue` 与 `describeSubmitError()` 都会把
 * `error.message` 原样渲染到页面上 —— 也就是说**后端一挂，首页、商品列表页、
 * 结算页的顾客就会看到内部 API 地址和 CORS 这类开发指令**。
 * 这既暴露了内部拓扑，对顾客也毫无可操作性。
 *
 * 现在改成：文案只说明「没收到响应」，细节走这里。
 *   · 仅 DEV 构建输出，生产包不会打印；
 *   · 排除 `MODE === 'test'`，避免单测里大量刻意触发的网络错误把输出刷满。
 */
function logTransportDetail(detail: string, cause: unknown): void {
  if (!import.meta.env.DEV || import.meta.env.MODE === 'test') return;
  console.warn(`[api] ${detail}`, cause);
}

function extractCode(payload: unknown, status: number): string {
  if (typeof payload === 'object' && payload !== null) {
    const error = (payload as { error?: unknown }).error;
    if (typeof error === 'string' && error.trim()) return error.trim();
  }
  return `HTTP_${status}`;
}

export function buildUrl(path: string, query?: Record<string, QueryValue>): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const url = new URL(`${API_BASE_URL}${API_PREFIX}${normalizedPath}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === '') continue;
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

export async function apiRequest<T>(path: string, init: ApiRequestInit = {}): Promise<T> {
  const { method = 'GET', query, body, headers, timeoutMs = 15_000 } = init;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (init.signal) {
    init.signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  let response: Response;
  try {
    response = await fetch(buildUrl(path, query), {
      method,
      headers: {
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timer);
    if (error instanceof DOMException && error.name === 'AbortError') {
      logTransportDetail(`请求超时（${timeoutMs}ms）：${method} ${path}`, error);
      throw new ApiError(0, 'TIMEOUT', '请求超时，没有收到服务器响应。', error);
    }
    logTransportDetail(
      `无法连接到 ${API_BASE_URL}：请确认后端已启动、地址正确，且已配置 CORS。`,
      error,
    );
    throw new ApiError(0, 'NETWORK_ERROR', '网络连接中断，没有收到服务器响应。', error);
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const rawText = await response.text();
  let payload: unknown = null;
  if (rawText) {
    try {
      payload = JSON.parse(rawText);
    } catch {
      payload = rawText;
    }
  }

  if (!response.ok) {
    throw new ApiError(
      response.status,
      extractCode(payload, response.status),
      extractMessage(payload, `请求失败（HTTP ${response.status}）`),
      payload,
    );
  }

  return payload as T;
}
