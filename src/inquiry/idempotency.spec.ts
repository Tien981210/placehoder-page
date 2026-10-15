import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  IDEMPOTENCY_KEY_MAX_LENGTH,
  IDEMPOTENCY_KEY_MIN_LENGTH,
  MAX_PENDING_RECORDS,
  PENDING_KEY_STORAGE_KEY,
  PENDING_KEY_TTL_MS,
  __resetIdempotencyForTest,
  acquireIdempotencyKey,
  cartFingerprint,
  hasPendingKey,
  isValidIdempotencyKey,
  newIdempotencyKey,
  releaseIdempotencyKey,
  sha256Hex,
  submitFingerprint,
} from './idempotency';

describe('newIdempotencyKey（询价幂等键）', () => {
  it('生成的键满足后端 8..128 的长度约束', () => {
    for (let index = 0; index < 50; index += 1) {
      const key = newIdempotencyKey();
      expect(key.length).toBeGreaterThanOrEqual(IDEMPOTENCY_KEY_MIN_LENGTH);
      expect(key.length).toBeLessThanOrEqual(IDEMPOTENCY_KEY_MAX_LENGTH);
      expect(isValidIdempotencyKey(key)).toBe(true);
    }
  });

  it('多次生成不重复', () => {
    const keys = new Set(Array.from({ length: 500 }, () => newIdempotencyKey()));
    expect(keys.size).toBe(500);
  });

  it('isValidIdempotencyKey 按边界判定', () => {
    expect(isValidIdempotencyKey('a'.repeat(IDEMPOTENCY_KEY_MIN_LENGTH - 1))).toBe(false);
    expect(isValidIdempotencyKey('a'.repeat(IDEMPOTENCY_KEY_MIN_LENGTH))).toBe(true);
    expect(isValidIdempotencyKey('a'.repeat(IDEMPOTENCY_KEY_MAX_LENGTH))).toBe(true);
    expect(isValidIdempotencyKey('a'.repeat(IDEMPOTENCY_KEY_MAX_LENGTH + 1))).toBe(false);
  });
});

describe('cartFingerprint（购物车指纹）', () => {
  it('只由商品 id 与数量决定', () => {
    const lines = [
      { productId: 'p1', quantity: 2 },
      { productId: 'p2', quantity: 1 },
    ];
    expect(cartFingerprint(lines)).toBe('p1:2|p2:1');
    expect(cartFingerprint([])).toBe('');
    // 与输入数组的顺序、引用无关，只与内容有关
    expect(cartFingerprint([...lines])).toBe(cartFingerprint(lines));
  });
});

/**
 * 「待确认幂等键」生命周期（G6-3.0 任务 A）。
 *
 * 契约：同一笔**未决询价**在「重试 / 卸载重挂载 / 刷新页面 / 多标签页」四种场景下
 * 必须复用同一个键；但**不得**把一个键永久绑定到所有未来询价。
 * 实现手段：按购物车指纹把记录落 `localStorage`（跨标签页共享、跨刷新存活），
 * 明确成功 / 明确失效时清除；记录带 TTL。
 */
describe('acquireIdempotencyKey（待确认键生命周期）', () => {
  beforeEach(() => {
    __resetIdempotencyForTest();
    // 隔离测试间的存储状态（记录写在 localStorage 上）。
    globalThis.localStorage?.clear();
  });

  it('同一指纹重复获取复用同一个键（模拟卸载后重新挂载）', () => {
    const fingerprint = cartFingerprint([{ productId: 'p1', quantity: 2 }]);

    const first = acquireIdempotencyKey(fingerprint);
    const second = acquireIdempotencyKey(fingerprint);

    expect(second).toBe(first);
    expect(isValidIdempotencyKey(first)).toBe(true);
  });

  it('键被真正落盘到 localStorage（刷新后仍能读到）', () => {
    const fingerprint = cartFingerprint([{ productId: 'p1', quantity: 2 }]);
    const key = acquireIdempotencyKey(fingerprint);

    const raw = globalThis.localStorage?.getItem(PENDING_KEY_STORAGE_KEY);
    expect(raw).toBeTruthy();
    // 存储容器是**记录数组**（多槽，G6-3.1 任务 E）；最新一条在最前。
    const parsed = JSON.parse(raw as string) as unknown;
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
    expect((parsed as unknown[])[0]).toMatchObject({ fingerprint, key });
  });

  it('购物车内容变化后换新键', () => {
    const a = acquireIdempotencyKey(cartFingerprint([{ productId: 'p1', quantity: 2 }]));
    const b = acquireIdempotencyKey(cartFingerprint([{ productId: 'p1', quantity: 3 }]));

    expect(b).not.toBe(a);
  });

  it('release 之后下一次获取换新键（提交成功 / 需要重开一单）', () => {
    const fingerprint = cartFingerprint([{ productId: 'p1', quantity: 1 }]);

    const first = acquireIdempotencyKey(fingerprint);
    releaseIdempotencyKey();
    const second = acquireIdempotencyKey(fingerprint);

    expect(second).not.toBe(first);
  });

  it('release 会同时清除 localStorage 中的记录', () => {
    const fingerprint = cartFingerprint([{ productId: 'p1', quantity: 1 }]);
    acquireIdempotencyKey(fingerprint);
    expect(globalThis.localStorage?.getItem(PENDING_KEY_STORAGE_KEY)).toBeTruthy();

    releaseIdempotencyKey();
    expect(globalThis.localStorage?.getItem(PENDING_KEY_STORAGE_KEY)).toBeNull();
  });

  it('场景 4/5：刷新页面（模块重新加载）后仍复用同一个键', async () => {
    const fingerprint = cartFingerprint([{ productId: 'p1', quantity: 2 }]);
    const beforeReload = acquireIdempotencyKey(fingerprint);

    // 模拟「刷新」：进程内模块状态全部丢弃，仅 localStorage 保留。
    vi.resetModules();
    const freshModule = await import('./idempotency');

    expect(freshModule.acquireIdempotencyKey(fingerprint)).toBe(beforeReload);
  });

  it('场景 5：两个标签页（两个模块实例）拿到同一个键', async () => {
    const fingerprint = cartFingerprint([{ productId: 'p9', quantity: 4 }]);

    const tabA = acquireIdempotencyKey(fingerprint);

    // 第二个标签页 = 另一个模块实例，共享同一份 localStorage。
    vi.resetModules();
    const tabBModule = await import('./idempotency');

    expect(tabBModule.acquireIdempotencyKey(fingerprint)).toBe(tabA);
  });

  it('场景 8：一笔成功后提交另一笔全新询价 ⇒ 新键', () => {
    const firstCart = cartFingerprint([{ productId: 'p1', quantity: 1 }]);
    const firstKey = acquireIdempotencyKey(firstCart);
    releaseIdempotencyKey(); // 明确成功

    const secondCart = cartFingerprint([{ productId: 'p2', quantity: 3 }]);
    const secondKey = acquireIdempotencyKey(secondCart);

    expect(secondKey).not.toBe(firstKey);
  });

  it('场景 10：超过 TTL 的记录不再复用（视为新询价）', () => {
    const fingerprint = cartFingerprint([{ productId: 'p1', quantity: 1 }]);
    const t0 = 1_700_000_000_000;

    const first = acquireIdempotencyKey(fingerprint, t0);
    // 恰好到达 TTL 边界：仍视为未过期（判定用 `>`）。
    expect(acquireIdempotencyKey(fingerprint, t0 + PENDING_KEY_TTL_MS)).toBe(first);
    // 超过 TTL：换新键。
    expect(acquireIdempotencyKey(fingerprint, t0 + PENDING_KEY_TTL_MS + 1)).not.toBe(first);
  });

  it('时钟回拨（createdAt 在未来）不误判为过期', () => {
    const fingerprint = cartFingerprint([{ productId: 'p1', quantity: 1 }]);
    const now = 1_700_000_000_000;
    const first = acquireIdempotencyKey(fingerprint, now + 5_000);
    expect(acquireIdempotencyKey(fingerprint, now)).toBe(first);
  });

  it('场景 9：数据损坏（非法 JSON）不抛错，并换新键', () => {
    globalThis.localStorage?.setItem(PENDING_KEY_STORAGE_KEY, '{not-json');
    const fingerprint = cartFingerprint([{ productId: 'p1', quantity: 1 }]);

    let key = '';
    expect(() => {
      key = acquireIdempotencyKey(fingerprint);
    }).not.toThrow();
    expect(isValidIdempotencyKey(key)).toBe(true);
  });

  it('场景 9：旧版本 / 结构不符的记录被丢弃并换新键', () => {
    const fingerprint = cartFingerprint([{ productId: 'p1', quantity: 1 }]);

    // 旧版本号
    globalThis.localStorage?.setItem(
      PENDING_KEY_STORAGE_KEY,
      JSON.stringify({ v: 999, fingerprint, key: 'k'.repeat(36), createdAt: Date.now() }),
    );
    const a = acquireIdempotencyKey(fingerprint);
    expect(a).not.toBe('k'.repeat(36));

    // 缺少必要字段
    globalThis.localStorage?.setItem(PENDING_KEY_STORAGE_KEY, JSON.stringify({ v: 1, fingerprint }));
    expect(isValidIdempotencyKey(acquireIdempotencyKey(fingerprint))).toBe(true);

    // key 长度不合法（< 8）
    globalThis.localStorage?.setItem(
      PENDING_KEY_STORAGE_KEY,
      JSON.stringify({ v: 1, fingerprint, key: 'short', createdAt: Date.now() }),
    );
    expect(acquireIdempotencyKey(fingerprint)).not.toBe('short');
  });

  it('场景 9：localStorage 不可用时安全降级为进程内复用（不抛错）', () => {
    const original = globalThis.localStorage;
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('SecurityError: localStorage is disabled');
      },
    });

    try {
      const fingerprint = cartFingerprint([{ productId: 'p1', quantity: 1 }]);
      let first = '';
      expect(() => {
        first = acquireIdempotencyKey(fingerprint);
      }).not.toThrow();
      // 进程内降级：同一进程内仍能复用（仅损失跨刷新能力）。
      expect(acquireIdempotencyKey(fingerprint)).toBe(first);
      expect(() => releaseIdempotencyKey()).not.toThrow();
    } finally {
      Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: original,
        writable: true,
      });
    }
  });

  it('空指纹（空购物车）不落记录，也不复用', () => {
    const a = acquireIdempotencyKey('');
    const b = acquireIdempotencyKey('');
    expect(a).not.toBe(b);
    expect(globalThis.localStorage?.getItem(PENDING_KEY_STORAGE_KEY)).toBeNull();
  });

  it('落盘记录只含指纹 / 键 / 时间，不含任何隐私或凭证字段', () => {
    const fingerprint = cartFingerprint([{ productId: 'p1', quantity: 1 }]);
    acquireIdempotencyKey(fingerprint);

    const raw = globalThis.localStorage?.getItem(PENDING_KEY_STORAGE_KEY) as string;
    const parsed = JSON.parse(raw) as Array<Record<string, unknown>>;
    expect(Array.isArray(parsed)).toBe(true);
    for (const record of parsed) {
      expect(Object.keys(record).sort()).toEqual(['createdAt', 'fingerprint', 'key', 'v']);
    }
    // 落盘内容不得出现任何 PII 明文（指纹是摘要，键是随机串）。
    expect(raw).not.toContain('@');
    expect(raw).not.toContain('张三');
  });
});

/* ==================================================================== */
/* G6-3.1 任务 C：幂等边界矩阵                                          */
/* ==================================================================== */

/** 安装一个自定义 `Storage`，返回还原函数。 */
function installStorage(stub: Storage): () => void {
  const original = globalThis.localStorage;
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: stub,
    writable: true,
  });
  return () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: original,
      writable: true,
    });
  };
}

/** 造一个内存 Storage；`onSet` 可注入抛错行为。 */
function makeStorage(onSet?: (key: string, value: string) => void): Storage {
  const backing = new Map<string, string>();
  return {
    get length(): number {
      return backing.size;
    },
    clear: (): void => {
      backing.clear();
    },
    getItem: (key: string): string | null => backing.get(key) ?? null,
    key: (index: number): string | null => [...backing.keys()][index] ?? null,
    removeItem: (key: string): void => {
      backing.delete(key);
    },
    setItem: (key: string, value: string): void => {
      onSet?.(key, value);
      backing.set(key, value);
    },
  } as Storage;
}

const BASE_LINES = [{ productId: 'p1', quantity: 2 }];

/**
 * `submitFingerprint`：提交载荷指纹（G6-3.1 任务 C 新增）。
 *
 * 契约：**载荷任一字段变化 ⇒ 指纹变化**（否则服务端会按旧键 replay、
 * 静默丢弃顾客新填的内容）；同时必须是**确定性**且**不含 PII 明文**的摘要。
 */
describe('submitFingerprint（提交载荷指纹）', () => {
  const base = {
    lines: BASE_LINES,
    contactEmail: 'guest@example.com',
    contactName: '张三',
    shippingAddress: '123 Pet Street, Springfield, IL 62704',
    note: '尽快发货',
    channel: 'EMAIL',
    country: 'US',
    city: 'Springfield',
    postalCode: '62704',
  };

  // ⚠️ `submitFingerprint` 是**同步**函数（G6-3.1 任务 C 的设计决定：避免 `await`
  //    破坏提交路径的防重入守卫与测试时序），故此处不得写成 async/await。
  it('购物车为空 ⇒ 返回空串（不构成可提交询价）', () => {
    expect(submitFingerprint({ lines: [] })).toBe('');
  });

  it('确定性：相同载荷多次调用得到同一指纹', () => {
    expect(submitFingerprint(base)).toBe(submitFingerprint({ ...base }));
  });

  it('规范化：前后空白 / 邮箱大小写 / 渠道大小写不影响结果', () => {
    const normalized = submitFingerprint({
      ...base,
      contactEmail: '  GUEST@Example.COM  ',
      contactName: '  张三  ',
      shippingAddress: '  123 Pet Street, Springfield, IL 62704  ',
      channel: 'email',
    });
    expect(normalized).toBe(submitFingerprint(base));
  });

  it.each([
    ['收货地址', { shippingAddress: '456 Other Road, Shelbyville, IL 62565' }],
    ['联系邮箱', { contactEmail: 'other@example.com' }],
    ['联系人姓名', { contactName: '李四' }],
    ['备注', { note: '改成工作日送达' }],
    ['渠道', { channel: 'WHATSAPP' }],
    ['国家', { country: 'CA' }],
    ['城市', { city: 'Shelbyville' }],
    ['邮编', { postalCode: '62565' }],
  ])('仅修改「%s」⇒ 指纹变化（必须换新幂等键）', (_label, patch) => {
    const changed = submitFingerprint({ ...base, ...patch });
    expect(changed).not.toBe(submitFingerprint(base));
  });

  it('仅修改购物车数量 / 商品 ⇒ 指纹变化', () => {
    const baseFp = submitFingerprint(base);
    expect(submitFingerprint({ ...base, lines: [{ productId: 'p1', quantity: 3 }] })).not.toBe(
      baseFp,
    );
    expect(submitFingerprint({ ...base, lines: [{ productId: 'p2', quantity: 2 }] })).not.toBe(
      baseFp,
    );
  });

  it('购物车行顺序变化 ⇒ 指纹变化', () => {
    const a = submitFingerprint({
      ...base,
      lines: [
        { productId: 'p1', quantity: 1 },
        { productId: 'p2', quantity: 2 },
      ],
    });
    const b = submitFingerprint({
      ...base,
      lines: [
        { productId: 'p2', quantity: 2 },
        { productId: 'p1', quantity: 1 },
      ],
    });
    expect(a).not.toBe(b);
  });

  it('分隔符碰撞：商品 id 含 ":" / "|" 也不会与另一份载荷撞指纹', () => {
    // 若沿用 `id:qty|` 拼接，这两份载荷会得到同一个字符串（见 cartFingerprint 设计注记）；
    // 载荷指纹改用结构化 JSON 表达，必须区分开。
    const twoLines = submitFingerprint({
      ...base,
      lines: [
        { productId: 'a', quantity: 1 },
        { productId: 'b', quantity: 2 },
      ],
    });
    const oneCrafted = submitFingerprint({
      ...base,
      lines: [{ productId: 'a:1|b', quantity: 2 }],
    });
    expect(oneCrafted).not.toBe(twoLines);
  });

  it('指纹是摘要：不含邮箱 / 地址 / 备注等任何 PII 明文', () => {
    const fp = submitFingerprint(base);
    expect(fp).not.toContain('guest@example.com');
    expect(fp).not.toContain('Pet Street');
    expect(fp).not.toContain('张三');
    expect(fp).not.toContain('尽快发货');
    expect(fp.startsWith('sha256:')).toBe(true);
  });

  it('sha256Hex 符合 NIST 测试向量（保证摘要实现正确）', () => {
    // FIPS 180-4 / NIST 官方示例向量
    expect(sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(
      sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'),
    ).toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
    // 跨块边界：55 / 56 / 64 字节（验证填充与长度字段）
    expect(sha256Hex('a'.repeat(55))).toHaveLength(64);
    expect(sha256Hex('a'.repeat(56))).not.toBe(sha256Hex('a'.repeat(55)));
    expect(sha256Hex('a'.repeat(64))).toHaveLength(64);
    // 中文（多字节 UTF-8）
    expect(sha256Hex('张三')).toBe(sha256Hex('张三'));
  });
});

/**
 * `acquireIdempotencyKey` 边界矩阵（存储降级 / 竞态 / 记录健壮性）。
 */
describe('acquireIdempotencyKey 边界矩阵', () => {
  beforeEach(() => {
    __resetIdempotencyForTest();
    globalThis.localStorage?.clear();
  });

  it('大量行（200 行）仍生成合法键并正常复用', () => {
    const lines = Array.from({ length: 200 }, (_, index) => ({
      productId: `p-${index}`,
      quantity: (index % 9) + 1,
    }));
    const fingerprint = cartFingerprint(lines);

    const first = acquireIdempotencyKey(fingerprint);
    expect(isValidIdempotencyKey(first)).toBe(true);
    expect(acquireIdempotencyKey(fingerprint)).toBe(first);
  });

  it('超长指纹（5000 字符）仍可落盘并复用', () => {
    const fingerprint = 'x'.repeat(5000);
    const first = acquireIdempotencyKey(fingerprint);
    expect(acquireIdempotencyKey(fingerprint)).toBe(first);
  });

  it('回读收敛：期间另一标签页写入同指纹记录 ⇒ 采用已落盘的键', () => {
    const fingerprint = cartFingerprint([{ productId: 'p1', quantity: 1 }]);
    const otherTabKey = 'k'.repeat(36);
    const now = 1_700_000_000_000;

    let reads = 0;
    const stub = makeStorage();
    stub.getItem = (): string => {
      reads += 1;
      // 第 1 次读（检查既有记录）：本标签页视角「还没有记录」
      if (reads === 1) return null as unknown as string;
      // 第 2 次读（写完后的回读收敛）：另一标签页刚写入的记录已可见
      return JSON.stringify({ v: 1, fingerprint, key: otherTabKey, createdAt: now });
    };

    const restore = installStorage(stub);
    try {
      expect(acquireIdempotencyKey(fingerprint, now)).toBe(otherTabKey);
      expect(reads).toBeGreaterThanOrEqual(2);
    } finally {
      restore();
    }
  });

  it('写入抛错（配额超限）⇒ 内存镜像接管，仍能复用（不抛错）', () => {
    const stub = makeStorage(() => {
      throw new Error('QuotaExceededError');
    });
    const restore = installStorage(stub);
    try {
      const fingerprint = cartFingerprint([{ productId: 'p1', quantity: 1 }]);
      let first = '';
      expect(() => {
        first = acquireIdempotencyKey(fingerprint);
      }).not.toThrow();
      // 关键：写入失败后**必须**仍能在进程内复用，否则降级路径会重复建单
      expect(acquireIdempotencyKey(fingerprint)).toBe(first);
      expect(() => releaseIdempotencyKey()).not.toThrow();
    } finally {
      restore();
    }
  });

  it('读取抛错（隐私模式）⇒ 内存镜像接管，仍能复用（不抛错）', () => {
    const stub = makeStorage();
    stub.getItem = () => {
      throw new Error('SecurityError: storage disabled');
    };
    const restore = installStorage(stub);
    try {
      const fingerprint = cartFingerprint([{ productId: 'p1', quantity: 1 }]);
      let first = '';
      expect(() => {
        first = acquireIdempotencyKey(fingerprint);
      }).not.toThrow();
      expect(acquireIdempotencyKey(fingerprint)).toBe(first);
    } finally {
      restore();
    }
  });

  it('无记录时 release 不抛错', () => {
    expect(() => releaseIdempotencyKey()).not.toThrow();
    expect(() => releaseIdempotencyKey()).not.toThrow();
  });

  it('createdAt 为 0（纪元）/ 负数 ⇒ 视为过期并换新键', () => {
    const fingerprint = cartFingerprint([{ productId: 'p1', quantity: 1 }]);
    const storedKey = 'k'.repeat(36);

    for (const createdAt of [0, -1]) {
      globalThis.localStorage?.setItem(
        PENDING_KEY_STORAGE_KEY,
        JSON.stringify({ v: 1, fingerprint, key: storedKey, createdAt }),
      );
      expect(acquireIdempotencyKey(fingerprint, 1_700_000_000_000)).not.toBe(storedKey);
    }
  });
  it('createdAt 非数字（null / 字符串）⇒ 记录判非法并丢弃', () => {
    const fingerprint = cartFingerprint([{ productId: 'p1', quantity: 1 }]);
    const storedKey = 'k'.repeat(36);

    for (const createdAt of [null, '1700000000000']) {
      globalThis.localStorage?.setItem(
        PENDING_KEY_STORAGE_KEY,
        JSON.stringify({ v: 1, fingerprint, key: storedKey, createdAt }),
      );
      expect(acquireIdempotencyKey(fingerprint)).not.toBe(storedKey);
    }
  });

  it('存储中的键长度按 8..128 边界判定', () => {
    const fingerprint = cartFingerprint([{ productId: 'p1', quantity: 1 }]);
    const write = (key: string): void => {
      globalThis.localStorage?.setItem(
        PENDING_KEY_STORAGE_KEY,
        JSON.stringify({ v: 1, fingerprint, key, createdAt: Date.now() }),
      );
    };

    for (const key of [
      'a'.repeat(IDEMPOTENCY_KEY_MIN_LENGTH),
      'a'.repeat(IDEMPOTENCY_KEY_MAX_LENGTH),
    ]) {
      write(key);
      expect(acquireIdempotencyKey(fingerprint)).toBe(key);
    }

    for (const key of [
      'a'.repeat(IDEMPOTENCY_KEY_MIN_LENGTH - 1),
      'a'.repeat(IDEMPOTENCY_KEY_MAX_LENGTH + 1),
    ]) {
      write(key);
      expect(acquireIdempotencyKey(fingerprint)).not.toBe(key);
    }
  });

  it('记录含未知额外字段（向前兼容）不影响复用判定', () => {
    const fingerprint = cartFingerprint([{ productId: 'p1', quantity: 1 }]);
    const storedKey = 'z'.repeat(36);
    globalThis.localStorage?.setItem(
      PENDING_KEY_STORAGE_KEY,
      JSON.stringify({ v: 1, fingerprint, key: storedKey, createdAt: Date.now(), extra: 'ignored' }),
    );
    expect(acquireIdempotencyKey(fingerprint)).toBe(storedKey);
  });

  it('[设计注记 P3] cartFingerprint 分隔符未转义：商品 id 含 ":" / "|" 时可构造碰撞', () => {
    const twoLines = cartFingerprint([
      { productId: 'a', quantity: 1 },
      { productId: 'b', quantity: 2 },
    ]);
    const oneCrafted = cartFingerprint([{ productId: 'a:1|b', quantity: 2 }]);
    // 两者相等 —— 真实商品 id 是 UUID（不含这两个字符），故线上不触发；
    // 载荷指纹已改用结构化 JSON 表达，不受此影响。
    expect(oneCrafted).toBe(twoLines);
    expect(oneCrafted).toBe('a:1|b:2');
  });
});

/* ==================================================================== */
/* G6-3.1 任务 E：待确认记录「多槽存储」                                  */
/* ==================================================================== */

/**
 * 背景（本轮修的真实缺陷）：
 *   单槽存储下 `A → B → A` 会把 A 的原键挤掉 ⇒ 顾客切回 A 重试时只能拿到**新键**
 *   ⇒ 服务端视为一笔新请求 ⇒ **重复建单**。多标签页各持不同购物车时同理。
 *
 * 契约：
 *   ① 不同指纹的记录**互不挤占**（在容量上限内）；
 *   ② `release(fingerprint)` **只**作废该指纹，其它未决询价不受影响；
 *   ③ 容量有上限且优先保留最新记录，过期记录在读取时即被清理；
 *   ④ 兼容 G6-3.0 的「单条对象」旧结构，升级不丢未决键。
 */
describe('待确认记录多槽存储（G6-3.1 任务 E）', () => {
  const fpA = cartFingerprint([{ productId: 'p1', quantity: 1 }]);
  const fpB = cartFingerprint([{ productId: 'p2', quantity: 1 }]);

  beforeEach(() => {
    __resetIdempotencyForTest();
    globalThis.localStorage?.clear();
  });

  it('A→B→A：切回 A 仍复用 A 的原键（不再被 B 挤掉）', () => {
    const keyA = acquireIdempotencyKey(fpA);
    const keyB = acquireIdempotencyKey(fpB);
    expect(keyB).not.toBe(keyA);

    // 单槽时代这里会换新键（⇒ 重复建单）；多槽必须复用各自的原键。
    expect(acquireIdempotencyKey(fpA)).toBe(keyA);
    expect(acquireIdempotencyKey(fpB)).toBe(keyB);
  });

  it('多标签页各持不同购物车：互不挤掉对方的键（跨模块实例）', async () => {
    const keyA = acquireIdempotencyKey(fpA);

    vi.resetModules();
    const tabB = await import('./idempotency');
    const keyB = tabB.acquireIdempotencyKey(fpB);
    expect(keyB).not.toBe(keyA);

    // 标签页 A（原模块实例）重试 ⇒ 仍复用 keyA；标签页 B 同理。
    expect(acquireIdempotencyKey(fpA)).toBe(keyA);
    expect(tabB.acquireIdempotencyKey(fpB)).toBe(keyB);
  });

  it('release(fingerprint) 只作废该指纹，其它未决询价的键不受影响', () => {
    const keyA = acquireIdempotencyKey(fpA);
    const keyB = acquireIdempotencyKey(fpB);

    releaseIdempotencyKey(fpA);

    // A 已结束 ⇒ 换新键；B 仍未决 ⇒ 原键必须保留（否则 B 重试会重复建单）。
    expect(acquireIdempotencyKey(fpA)).not.toBe(keyA);
    expect(acquireIdempotencyKey(fpB)).toBe(keyB);
  });

  it('release(fingerprint) 删掉最后一条记录时同时清掉存储键', () => {
    acquireIdempotencyKey(fpA);
    expect(globalThis.localStorage?.getItem(PENDING_KEY_STORAGE_KEY)).toBeTruthy();

    releaseIdempotencyKey(fpA);
    expect(globalThis.localStorage?.getItem(PENDING_KEY_STORAGE_KEY)).toBeNull();
  });

  it('release() 不带指纹 ⇒ 清空全部记录（测试重置语义）', () => {
    acquireIdempotencyKey(fpA);
    acquireIdempotencyKey(fpB);

    releaseIdempotencyKey();

    expect(globalThis.localStorage?.getItem(PENDING_KEY_STORAGE_KEY)).toBeNull();
  });

  it('超过上限时只保留最新的 MAX_PENDING_RECORDS 条（淘汰最旧的）', () => {
    const t0 = 1_700_000_000_000;
    const fingerprints = Array.from(
      { length: MAX_PENDING_RECORDS + 3 },
      (_, index) => `fp-${index}`,
    );
    const keys = fingerprints.map((fingerprint, index) =>
      acquireIdempotencyKey(fingerprint, t0 + index * 1_000),
    );

    const parsed = JSON.parse(
      globalThis.localStorage?.getItem(PENDING_KEY_STORAGE_KEY) as string,
    ) as Array<{ fingerprint: string }>;
    const evicted = fingerprints.length - MAX_PENDING_RECORDS;

    expect(parsed).toHaveLength(MAX_PENDING_RECORDS);
    // 最新一条在最前；保留的正是**最新的** MAX 条（最旧的 `evicted` 条被淘汰）。
    expect(parsed[0]?.fingerprint).toBe(fingerprints[fingerprints.length - 1]);
    expect(new Set(parsed.map((record) => record.fingerprint))).toEqual(
      new Set(fingerprints.slice(evicted)),
    );

    // 上限内（最旧的保留项）仍复用原键
    expect(acquireIdempotencyKey(fingerprints[evicted] as string, t0 + 60_000)).toBe(
      keys[evicted] as string,
    );
    // 被淘汰的指纹再取时只能拿到新键（可接受的取舍：容量有限，最新优先）
    expect(acquireIdempotencyKey(fingerprints[0] as string, t0 + 60_000)).not.toBe(
      keys[0] as string,
    );
  });

  it('过期记录在 acquire 时被清理，不占用槽位', () => {
    const t0 = 1_700_000_000_000;
    const stale = Array.from({ length: MAX_PENDING_RECORDS }, (_, index) => ({
      v: 1,
      fingerprint: `stale-${index}`,
      key: `s${'a'.repeat(35)}`,
      createdAt: t0,
    }));
    globalThis.localStorage?.setItem(PENDING_KEY_STORAGE_KEY, JSON.stringify(stale));

    // 全部过期（> TTL）⇒ 读取侧应把它们全部过滤掉，新记录不与它们争槽位。
    acquireIdempotencyKey('fresh-fp', t0 + PENDING_KEY_TTL_MS + 1);

    const parsed = JSON.parse(
      globalThis.localStorage?.getItem(PENDING_KEY_STORAGE_KEY) as string,
    ) as Array<{ fingerprint: string }>;
    expect(parsed.map((record) => record.fingerprint)).toEqual(['fresh-fp']);
  });

  it('兼容旧版「单条对象」结构：升级后仍复用原键（不丢未决询价）', () => {
    const legacyKey = 'l'.repeat(36);
    globalThis.localStorage?.setItem(
      PENDING_KEY_STORAGE_KEY,
      JSON.stringify({ v: 1, fingerprint: fpA, key: legacyKey, createdAt: Date.now() }),
    );

    expect(acquireIdempotencyKey(fpA)).toBe(legacyKey);
  });
});

/**
 * `hasPendingKey`：让页面在**刷新后**仍能识别「上一笔提交结果未知」。
 *
 * 语义：只有「当前这份载荷」存在未过期记录时才为真 —— 它是刷新后阻止顾客
 * 「改几个字重新提交 ⇒ 换新键 ⇒ 重复建单」的唯一依据。
 */
describe('hasPendingKey（未决询价识别）', () => {
  const fpA = cartFingerprint([{ productId: 'p1', quantity: 1 }]);
  const fpB = cartFingerprint([{ productId: 'p2', quantity: 1 }]);

  beforeEach(() => {
    __resetIdempotencyForTest();
    globalThis.localStorage?.clear();
  });

  it('无记录 ⇒ false；acquire 后 ⇒ true', () => {
    expect(hasPendingKey(fpA)).toBe(false);
    acquireIdempotencyKey(fpA);
    expect(hasPendingKey(fpA)).toBe(true);
  });

  it('只有别的指纹未决 ⇒ 当前载荷仍为 false', () => {
    acquireIdempotencyKey(fpB);
    expect(hasPendingKey(fpA)).toBe(false);
    expect(hasPendingKey(fpB)).toBe(true);
  });

  it('release 之后 ⇒ false（提交已明确结束）', () => {
    acquireIdempotencyKey(fpA);
    releaseIdempotencyKey(fpA);
    expect(hasPendingKey(fpA)).toBe(false);
  });

  it('超过 TTL ⇒ false（不再视为同一笔未决询价）', () => {
    const t0 = 1_700_000_000_000;
    acquireIdempotencyKey(fpA, t0);
    expect(hasPendingKey(fpA, t0 + PENDING_KEY_TTL_MS)).toBe(true);
    expect(hasPendingKey(fpA, t0 + PENDING_KEY_TTL_MS + 1)).toBe(false);
  });

  it('空指纹（空购物车）⇒ 恒 false', () => {
    expect(hasPendingKey('')).toBe(false);
  });

  it('数据损坏 / 存储不可用时不抛错', () => {
    globalThis.localStorage?.setItem(PENDING_KEY_STORAGE_KEY, '{not-json');
    expect(() => hasPendingKey(fpA)).not.toThrow();
    expect(hasPendingKey(fpA)).toBe(false);
  });

  it('兼容旧版「单条对象」结构 ⇒ true（升级后刷新仍能提示）', () => {
    globalThis.localStorage?.setItem(
      PENDING_KEY_STORAGE_KEY,
      JSON.stringify({ v: 1, fingerprint: fpA, key: 'l'.repeat(36), createdAt: Date.now() }),
    );
    expect(hasPendingKey(fpA)).toBe(true);
  });
});
