import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  VISITOR_ID_STORAGE_KEY,
  __resetVisitorIdForTest,
  ensureVisitorId,
  generateUuidV4,
} from './visitor-id';

/**
 * 访客标识单测（G6-5.8）。
 *
 * 锁定：
 *   ① 首次生成 UUID v4 并持久化；再次调用返回**同一个**（刷新不变 ⇒ UV 不虚高）；
 *   ② 存储里的脏值被忽略并重新生成（不把垃圾当访客）；
 *   ③ 无法持久化 ⇒ **返回 null**（宁可少统计，也不给出错误的 UV）；
 *   ④ 非安全上下文（局域网 http）下 `crypto.randomUUID` 不可用时的降级仍产出合法 v4。
 */

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * ⚠️ 主站 vitest 配置**未**开启 `unstubGlobals` ⇒ 本文件自己收尾。
 *    否则「把 localStorage 桩成 undefined」的那条用例会污染后续用例。
 */
afterEach(() => {
  vi.unstubAllGlobals();
  globalThis.localStorage?.clear();
  __resetVisitorIdForTest();
});

describe('generateUuidV4', () => {
  it('产出符合 RFC 4122 v4 布局的字符串', () => {
    for (let index = 0; index < 20; index += 1) {
      const id = generateUuidV4();
      expect(id).not.toBeNull();
      expect(id!).toMatch(UUID_V4);
    }
  });

  it('两次生成不重复', () => {
    const ids = new Set(Array.from({ length: 50 }, () => generateUuidV4()));
    expect(ids.size).toBe(50);
  });

  it('🔴 非安全上下文（无 crypto.randomUUID）时降级到 getRandomValues，仍为合法 v4', () => {
    const original = globalThis.crypto;
    // 局域网 http 站就是这种情况：crypto 在，但 randomUUID 不在
    vi.stubGlobal('crypto', { getRandomValues: original.getRandomValues.bind(original) });

    const id = generateUuidV4();
    expect(id!).toMatch(UUID_V4);

    vi.stubGlobal('crypto', original);
  });

  it('🔴 连 crypto 都没有时用 Math.random 兜底，格式仍合法（visitorId 不是凭据）', () => {
    vi.stubGlobal('crypto', undefined);

    const id = generateUuidV4();
    expect(id!).toMatch(UUID_V4);
  });

  it('version / variant 位固定为 4 与 10xx', () => {
    vi.stubGlobal('crypto', undefined);
    for (let index = 0; index < 20; index += 1) {
      const id = generateUuidV4()!;
      expect(id[14]).toBe('4');
      expect(['8', '9', 'a', 'b']).toContain(id[19]!.toLowerCase());
    }
  });
});

describe('ensureVisitorId', () => {
  beforeEach(() => {
    globalThis.localStorage?.clear();
    __resetVisitorIdForTest();
  });

  it('首次调用生成并写入 localStorage', () => {
    const id = ensureVisitorId();

    expect(id).toMatch(UUID_V4);
    expect(localStorage.getItem(VISITOR_ID_STORAGE_KEY)).toBe(id);
  });

  it('🔴 再次调用返回同一个 id（刷新 / SPA 跳转不会变成新访客）', () => {
    const first = ensureVisitorId();
    const second = ensureVisitorId();

    expect(second).toBe(first);
  });

  it('🔴 模块状态重置后（等价于整页刷新）仍返回同一个 id', () => {
    const first = ensureVisitorId();

    __resetVisitorIdForTest(); // 模拟页面重新加载
    const afterReload = ensureVisitorId();

    expect(afterReload).toBe(first);
  });

  it('🔴 存储里的非法值被忽略并重新生成（不把垃圾当访客）', () => {
    for (const dirty of ['abc', '', '   ', '01920000-0000-7000-8000-000000000001', '{}']) {
      localStorage.setItem(VISITOR_ID_STORAGE_KEY, dirty);
      __resetVisitorIdForTest();

      const id = ensureVisitorId();
      expect(id).toMatch(UUID_V4);
      expect(id).not.toBe(dirty);
    }
  });

  it('容忍存储值首尾空白', () => {
    const id = generateUuidV4()!;
    localStorage.setItem(VISITOR_ID_STORAGE_KEY, `  ${id}  `);
    __resetVisitorIdForTest();

    expect(ensureVisitorId()).toBe(id);
  });

  it('🔴 无法持久化（隐私模式 / 配额报错）⇒ 返回 null，**绝不**用临时 id 冒充', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    expect(ensureVisitorId()).toBeNull();

    spy.mockRestore();
  });

  it('🔴 localStorage 完全不可用 ⇒ 返回 null', () => {
    vi.stubGlobal('localStorage', undefined);

    expect(ensureVisitorId()).toBeNull();
  });

  it('读存储抛错（隐私模式）⇒ 视为没有，且回读校验失败后返回 null', () => {
    const getSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });

    // 读失败 ⇒ 当作没有；写入后回读校验同样抛错 ⇒ persist() 返回 false ⇒ 不统计。
    // 这条路径与「无法持久化」是同一结论：**宁可少统计，也不给出错误的 UV**。
    expect(ensureVisitorId()).toBeNull();

    getSpy.mockRestore();
  });

  it('生成的 id 与登录态无关（本模块不读任何账号存储键）', () => {
    localStorage.setItem('luxrabeauty.account.token.v1', 'fake-token');
    __resetVisitorIdForTest();

    const id = ensureVisitorId();

    expect(id).toMatch(UUID_V4);
    // 访客标识与账号令牌是两个独立的键，互不影响
    expect(localStorage.getItem('luxrabeauty.account.token.v1')).toBe('fake-token');
    expect(localStorage.getItem(VISITOR_ID_STORAGE_KEY)).toBe(id);
  });
});
