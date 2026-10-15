import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  HERO_PLACEHOLDER_URL,
  PLACEHOLDER_DIR,
  __placeholderFilesForTest,
  __placeholderPoolsForTest,
  categoryPlaceholder,
  detectPlaceholderTopic,
  placeholderImageFor,
  placeholderImageForTopic,
  productPlaceholder,
} from './placeholderImage';

describe('detectPlaceholderTopic', () => {
  it('按中文关键词识别主题', () => {
    expect(detectPlaceholderTopic(['珍珠母贝耳环'])).toBe('jewelry');
    expect(detectPlaceholderTopic(['自然长直假发'])).toBe('hair');
    expect(detectPlaceholderTopic(['化妆刷五件套'])).toBe('makeup');
    expect(detectPlaceholderTopic(['旅行化妆收纳包'])).toBe('accessory');
    expect(detectPlaceholderTopic(['焕活修护精华 30ml'])).toBe('skincare');
  });

  it('英文关键词走词边界，不让 ring 命中 spring', () => {
    expect(detectPlaceholderTopic(['spring-collection'])).toBeNull();
    expect(detectPlaceholderTopic(['gold-plated-ring'])).toBe('jewelry');
    expect(detectPlaceholderTopic(['pearl-necklace'])).toBe('jewelry');
  });

  it('化妆包判成配件、化妆刷判成美妆工具（关键词互不包含）', () => {
    expect(detectPlaceholderTopic(['cosmetic-pouch'])).toBe('accessory');
    expect(detectPlaceholderTopic(['makeup-brush-set'])).toBe('makeup');
  });

  it('线索顺序即优先级：商品名优先于分类名', () => {
    // 商品名说「耳环」，分类名说「护肤」→ 以商品名为准
    expect(detectPlaceholderTopic(['锆石细圈戒指', '护肤精华'])).toBe('jewelry');
  });

  it('推断不出主题时返回 null，不硬塞照片', () => {
    expect(detectPlaceholderTopic(['神秘新品'])).toBeNull();
    expect(detectPlaceholderTopic([])).toBeNull();
    expect(detectPlaceholderTopic([null, undefined, ''])).toBeNull();
  });
});

describe('placeholderImageFor', () => {
  it('同一 seed 稳定返回同一张图（跨页面一致）', () => {
    const first = placeholderImageFor('pearl-shell-earrings', ['珍珠母贝耳环'], '珍珠母贝耳环');
    const second = placeholderImageFor('pearl-shell-earrings', ['珍珠母贝耳环'], '珍珠母贝耳环');
    expect(first?.url).toBe(second?.url);
  });

  it('不同 seed 会分散到池内不同文件', () => {
    const urls = new Set(
      ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(
        (seed) => placeholderImageFor(seed, ['项链'])?.url,
      ),
    );
    expect(urls.size).toBeGreaterThan(1);
  });

  it('url 落在占位图目录下，alt 明确标注是示意图', () => {
    const image = placeholderImageForTopic('jewelry', 'seed', '珍珠耳环');
    expect(image.url.startsWith(`${PLACEHOLDER_DIR}/`)).toBe(true);
    expect(image.url.endsWith('.jpg')).toBe(true);
    expect(image.alt).toContain('珍珠耳环');
    expect(image.alt).toContain('示意图');
    expect(image.isPlaceholder).toBe(true);
  });

  it('标签缺失时 alt 有兜底文案', () => {
    const image = placeholderImageForTopic('hair', 'seed');
    expect(image.alt).toContain('商品');
    expect(image.alt).toContain('示意图');
  });

  it('推断不出主题时返回 null', () => {
    expect(placeholderImageFor('seed', ['神秘新品'])).toBeNull();
  });
});

describe('productPlaceholder', () => {
  it('用商品名 / slug / 分类共同推断', () => {
    expect(
      productPlaceholder({
        name: '空气刘海发片',
        slug: 'air-bang-hairpiece',
        category: { name: '假发与发片', slug: 'wigs-hair' },
      })?.topic,
    ).toBe('hair');
  });

  it('商品名无法判断时靠分类兜底', () => {
    expect(
      productPlaceholder({
        name: '新品 A',
        slug: 'new-a',
        category: { name: '护肤精华', slug: 'serum' },
      })?.topic,
    ).toBe('skincare');
  });

  it('完全没有线索时返回 null（由界面回落到品牌标记）', () => {
    expect(productPlaceholder({ name: '新品 A', slug: 'new-a', category: null })).toBeNull();
  });

  it('商品名与分类冲突时以商品名为准', () => {
    expect(
      productPlaceholder({
        name: '极简锁骨链',
        slug: 'minimal-collar-chain',
        category: { name: '护肤精华', slug: 'serum' },
      })?.topic,
    ).toBe('jewelry');
  });
});

describe('categoryPlaceholder', () => {
  it('四大目标品类都能取到图', () => {
    expect(categoryPlaceholder('jewelry')?.topic).toBe('jewelry');
    expect(categoryPlaceholder('wigs-hair')?.topic).toBe('hair');
    expect(categoryPlaceholder('makeup-tools')?.topic).toBe('makeup');
    expect(categoryPlaceholder('beauty-accessories')?.topic).toBe('accessory');
  });

  it('未知品类返回 null', () => {
    expect(categoryPlaceholder('pet-toys')).toBeNull();
  });
});

describe('占位图文件完整性', () => {
  it('模块引用的每个文件都真实存在于 public/placeholder 下', () => {
    const missing = __placeholderFilesForTest().filter(
      (file) => !existsSync(resolve(process.cwd(), 'public/placeholder', file)),
    );
    expect(missing).toEqual([]);
  });

  it('首页主视觉占位图存在', () => {
    const file = HERO_PLACEHOLDER_URL.replace(`${PLACEHOLDER_DIR}/`, '');
    expect(existsSync(resolve(process.cwd(), 'public/placeholder', file))).toBe(true);
  });

  it('没有重复引用同一张图（池内文件唯一）', () => {
    const files = __placeholderFilesForTest();
    expect(new Set(files).size).toBe(files.length);
  });

  /*
   * Phase 2.2 新增：**池内内容唯一**。
   *
   * 只比文件名不够 —— 实测 `makeup-5.jpg` 与 `makeup-3.jpg` 是两个不同文件名、
   * 但字节完全相同（下载失败后被复制成另一份）。一个主题池里塞两份同样的图，
   * 说明素材本身有问题（本该是不同的图）。
   *
   * ⚠️ 这里只约束**同一主题池内**。跨主题复用同一张图是**刻意**的：
   *    `skincare-6.jpg` 与 `accessory-1.jpg` 是同一张无品牌精华瓶图，
   *    在只有 2–3 张可用素材时用来补足护肤主题，属已知且接受的取舍。
   */
  it('同一主题池内的文件内容互不相同（防止「同图不同名」）', () => {
    const problems: string[] = [];
    for (const pool of __placeholderPoolsForTest()) {
      const seen = new Map<string, string>();
      for (const file of pool.files) {
        const bytes = readFileSync(resolve(process.cwd(), 'public/placeholder', file));
        const digest = createHash('sha256').update(bytes).digest('hex');
        const previous = seen.get(digest);
        if (previous) problems.push(`[${pool.topic}] ${file} 与 ${previous} 内容完全相同`);
        else seen.set(digest, file);
      }
    }
    expect(problems).toEqual([]);
  });
});
