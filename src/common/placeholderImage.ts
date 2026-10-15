/**
 * ============================================================================
 * 商品占位图（示意图片）解析器
 * ============================================================================
 *
 * 背景：后端商品目前**普遍没有图片**（`images: []`），
 *      页面只能回落到品牌标记，商品列表看上去像空的。
 *      这里提供一组**设计评审用占位图**，让真实商品图补齐前页面可被正常评估。
 *
 * ⚠️ 这些是**示意图，不是商品实拍**。因此本模块刻意做了三层约束：
 *
 *   1. **只在 `product.images` 为空时启用** —— 有真实图片时一律用真实图片。
 *   2. **按关键词匹配主题** —— 用商品名 / slug / 分类名 / 分类 slug 推断品类，
 *      避免「精华液配一条项链」这种张冠李戴的误导。
 *   3. **匹配不到主题时返回 `null`** —— 宁可回落到朴素的品牌标记，
 *      也不随便塞一张不相干的照片。
 *
 * 界面侧还有第 4 层：用到占位图的地方都会显示「示意图」标注，
 * 真实图片接入后标注自动消失（判断依据同样是 `images` 是否为空）。
 *
 * 🔴 第 5 层（Phase 2.2 新增，**硬约束**）：**素材里不得出现可辨识的第三方品牌**。
 *    原因：占位图会被渲染在「本站在售商品」的商品卡上，一旦画面里能读出
 *    NARS / Bobbi Brown / Estée Lauder / tarte / Too Faced / Nécessaire 这类
 *    别家商标，就等于在暗示本站代理这些品牌 —— 既是商标风险，也是误导顾客。
 *    2026-10-15 复核时发现原有 skincare-1/2/3 与 makeup-1/2 共 5 张存在该问题，
 *    已全部替换为逐张人工放大核验过的无品牌素材（旧图备份见
 *    `.workbuddy-ai/backup/phase2.2/placeholder-before/`）。
 *
 *    2026-10-15 第二轮逐张放大核验（680×850 原图按 3–4 倍放大到能读清标签）
 *    又查出 3 张，已从本目录删除并从主题池移除：
 *      · `accessory-4.jpg` —— 表盘上印着 **TISSOT**（且是腕表，本就不属美容配件）
 *      · `hair-2.jpg`      —— 吹风机机身上印着 **CPV**
 *      · `hair-4.jpg`      —— 画面里同时出现 **ISDIN** 面霜罐与 **gama professional** 吹风机
 *    另外发现 `makeup-5.jpg` 与 `makeup-3.jpg` 是**同一张图**（下载失败后被复制），
 *    同一主题池里放两份会让同页出现两张一模一样的图，已一并移除。
 *    → **今后往本目录加图，必须先把图放大到能看清瓶身标签再入库。**
 *
 * 图片来源：Unsplash（Unsplash License：可免费商用、无需署名），
 * 存放于 `public/placeholder/`，均为 4:5 竖版。
 * 替换真实商品图后，整个目录与本模块都可以删除。
 */

/** 占位图主题 —— 与四大目标品类 + 当前后端真实品类（护肤）对齐。 */
export type PlaceholderTopic = 'jewelry' | 'hair' | 'makeup' | 'accessory' | 'skincare';

/** 占位图目录（`public/` 下的路径，构建后原样可访问）。 */
export const PLACEHOLDER_DIR = '/placeholder';

/** 首页主视觉占位图。 */
export const HERO_PLACEHOLDER_URL = `${PLACEHOLDER_DIR}/hero.jpg`;

interface TopicPool {
  readonly topic: PlaceholderTopic;
  readonly files: readonly string[];
  /**
   * 命中关键词。
   *
   * · 含中文的关键词按「子串包含」匹配（中文没有词边界）；
   * · 纯 ASCII 关键词按「词边界」匹配 —— 否则 `ring` 会命中 `spring`。
   */
  readonly keywords: readonly string[];
}

/**
 * 主题池。
 *
 * ⚠️ 顺序即优先级，靠前的主题先匹配。这里刻意让**更具体**的品类在前，
 *    且各主题的关键词互不包含（例如没有裸的 `化妆`，只有 `化妆刷` / `化妆包`），
 *    避免「化妆包」被判成美妆工具。
 */
const POOLS: readonly TopicPool[] = [
  {
    topic: 'jewelry',
    files: ['jewelry-1.jpg', 'jewelry-2.jpg', 'jewelry-3.jpg', 'jewelry-4.jpg', 'jewelry-5.jpg'],
    keywords: [
      '耳环',
      '耳钉',
      '耳饰',
      '耳夹',
      '项链',
      '锁骨链',
      '颈链',
      '戒指',
      '指环',
      '手链',
      '手镯',
      '脚链',
      '吊坠',
      '挂坠',
      '胸针',
      '首饰',
      '珠宝',
      '珍珠',
      '水钻',
      '锆石',
      '宝石',
      'earring',
      'necklace',
      'ring',
      'bracelet',
      'bangle',
      'pendant',
      'brooch',
      'jewelry',
      'jewellery',
      'gem',
      'gemstone',
      'pearl',
      'crystal',
      'zircon',
    ],
  },
  {
    topic: 'hair',
    files: ['hair-1.jpg', 'hair-3.jpg'],
    keywords: [
      '假发',
      '发片',
      '发套',
      '发帘',
      '刘海',
      '发网',
      '接发',
      '发丝',
      '发排',
      '发髻',
      '马尾',
      '编发',
      'hair',
      'wig',
      'wigs',
      'extension',
      'toupee',
      'bang',
      'ponytail',
      'braid',
    ],
  },
  {
    topic: 'makeup',
    files: ['makeup-3.jpg', 'makeup-4.jpg'],
    keywords: [
      '化妆刷',
      '刷具',
      '刷子',
      '美妆蛋',
      '粉扑',
      '睫毛夹',
      '化妆棉',
      '眉笔',
      '眼线',
      '粉底',
      '口红',
      '唇膏',
      '眼影',
      '腮红',
      '散粉',
      'makeup',
      'make-up',
      'brush',
      'sponge',
      'eyelash',
      'curler',
      'blender',
      'palette',
      'applicator',
      'lipstick',
      'eyeshadow',
      'foundation',
      'concealer',
      'mascara',
    ],
  },
  {
    topic: 'accessory',
    files: ['accessory-1.jpg', 'accessory-2.jpg', 'accessory-3.jpg'],
    keywords: [
      '收纳',
      '化妆包',
      '化妆镜',
      '镜子',
      '发圈',
      '发带',
      '发夹',
      '抓夹',
      '梳子',
      '美甲',
      '指甲',
      '刮痧',
      '滚轮',
      '按摩',
      '美容仪',
      '配件',
      '小物',
      'pouch',
      'organizer',
      'mirror',
      'comb',
      'clip',
      'scrunchie',
      'headband',
      'roller',
      'guasha',
      'manicure',
      'nail',
      'bag',
      'case',
      'accessories',
      'accessory',
    ],
  },
  {
    topic: 'skincare',
    files: ['skincare-4.jpg', 'skincare-5.jpg', 'skincare-6.jpg'],
    keywords: [
      '精华',
      '面霜',
      '乳液',
      '洁面',
      '洗面',
      '面膜',
      '护肤',
      '爽肤',
      '化妆水',
      '眼霜',
      '防晒',
      '精油',
      '安瓶',
      'serum',
      'cream',
      'lotion',
      'cleanser',
      'mask',
      'toner',
      'essence',
      'moisturizer',
      'moisturiser',
      'skincare',
      'ampoule',
      'sunscreen',
      'oil',
    ],
  },
];

/** 配置品类的 `key` → 占位图主题（分类卡片用）。 */
const SITE_CATEGORY_TOPIC: Readonly<Record<string, PlaceholderTopic>> = {
  jewelry: 'jewelry',
  'wigs-hair': 'hair',
  'makeup-tools': 'makeup',
  'beauty-accessories': 'accessory',
};

/* -------------------------------------------------------------------------- */
/* 匹配                                                                        */
/* -------------------------------------------------------------------------- */

function isAsciiOnly(value: string): boolean {
  return /^[\x20-\x7e]+$/.test(value);
}

/** ASCII 关键词按词边界匹配，避免 `ring` 命中 `spring`。 */
function hasLatinKeyword(haystack: string, keyword: string): boolean {
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(keyword, from);
    if (at === -1) return false;
    const before = at === 0 ? '' : haystack[at - 1];
    const after = haystack[at + keyword.length] ?? '';
    const isWordChar = (char: string) => char !== '' && /[a-z0-9]/.test(char);
    if (!isWordChar(before) && !isWordChar(after)) return true;
    from = at + 1;
  }
}

function matchesKeyword(haystack: string, keyword: string): boolean {
  return isAsciiOnly(keyword) ? hasLatinKeyword(haystack, keyword) : haystack.includes(keyword);
}

/**
 * 按线索推断占位图主题。
 *
 * 线索按给定顺序拼接后整体匹配 —— 因此**调用方给的顺序就是优先级**，
 * 一般把「商品名」放最前、「分类名」放最后。
 */
export function detectPlaceholderTopic(
  hints: readonly (string | null | undefined)[],
): PlaceholderTopic | null {
  const haystack = hints
    .filter((hint): hint is string => typeof hint === 'string' && hint.length > 0)
    .join(' ')
    .toLowerCase();
  if (haystack.length === 0) return null;

  for (const pool of POOLS) {
    for (const keyword of pool.keywords) {
      if (matchesKeyword(haystack, keyword)) return pool.topic;
    }
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* 选择                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * FNV-1a —— 稳定哈希。
 *
 * 用途：同一个商品在列表页、详情页、购物车、询价结果里必须拿到**同一张**图，
 *      否则同一件商品换个页面就换张照片，看起来像数据错乱。
 *      因此这里对 seed（商品 slug）做确定性哈希，而不是随机。
 */
function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export interface PlaceholderImage {
  /** 可直接用于 `<img src>`。 */
  readonly url: string;
  /** 建议的 alt 文本（已含「示意图」说明）。 */
  readonly alt: string;
  readonly topic: PlaceholderTopic;
  /** 恒为 `true`：提醒调用方这是示意图，界面应如实标注。 */
  readonly isPlaceholder: true;
}

function buildImages(
  topic: PlaceholderTopic,
  seed: string,
  count: number,
  label?: string | null,
): PlaceholderImage[] {
  const pool = POOLS.find((item) => item.topic === topic);
  // POOLS 是模块内常量，主题必然存在；这里的兜底只是让类型收敛。
  const files = pool?.files ?? ['skincare-1.jpg'];
  const start = hashString(seed) % files.length;
  const total = Math.max(1, Math.min(count, files.length));
  const name = label && label.trim().length > 0 ? label.trim() : '商品';

  const result: PlaceholderImage[] = [];
  for (let index = 0; index < total; index += 1) {
    result.push({
      url: `${PLACEHOLDER_DIR}/${files[(start + index) % files.length]}`,
      alt: `${name}（示意图，非商品实拍）`,
      topic,
      isPlaceholder: true,
    });
  }
  return result;
}

/** 指定主题取图（分类卡片等「已知品类」的场景用）。 */
export function placeholderImageForTopic(
  topic: PlaceholderTopic,
  seed: string,
  label?: string | null,
): PlaceholderImage {
  return buildImages(topic, seed, 1, label)[0];
}

/**
 * 同一主题下取 `count` 张**互不相同**的图。
 *
 * 用途：详情页图集需要多张图，而占位图池每个主题只有 4–5 张 ——
 * 这里从哈希偏移处顺序取，既不重复，也能保证同一商品每次拿到同一组。
 */
export function placeholderImagesForTopic(
  topic: PlaceholderTopic,
  seed: string,
  count: number,
  label?: string | null,
): PlaceholderImage[] {
  return buildImages(topic, seed, count, label);
}

/**
 * 按线索取占位图；推断不出主题时返回 `null`（由调用方回落到品牌标记）。
 */
export function placeholderImageFor(
  seed: string,
  hints: readonly (string | null | undefined)[],
  label?: string | null,
): PlaceholderImage | null {
  const topic = detectPlaceholderTopic(hints);
  return topic ? buildImages(topic, seed, 1, label)[0] : null;
}

/** 商品占位图所需的最小结构（结构化类型，便于测试与复用）。 */
export interface PlaceholderHintSource {
  readonly name: string;
  readonly slug: string;
  readonly category?: { readonly name: string; readonly slug: string } | null;
}

/**
 * 商品占位图。
 *
 * 线索顺序 = 优先级：**商品名 > 商品 slug > 分类名 > 分类 slug**。
 * 商品名最贴近「这件东西到底是什么」，分类名最粗粒度，放最后兜底。
 */
export function productPlaceholder(product: PlaceholderHintSource): PlaceholderImage | null {
  const seed = product.slug || product.name;
  return placeholderImageFor(
    seed,
    [product.name, product.slug, product.category?.name, product.category?.slug],
    product.name,
  );
}

/** 分类卡片占位图（按配置品类的 `key` 取主题）。 */
export function categoryPlaceholder(
  key: string,
  seed?: string,
  label?: string | null,
): PlaceholderImage | null {
  const topic = SITE_CATEGORY_TOPIC[key];
  return topic ? buildImages(topic, seed ?? key, 1, label)[0] : null;
}

/** 仅供测试：暴露主题池，用于校验文件确实存在。 */
export function __placeholderFilesForTest(): readonly string[] {
  return POOLS.flatMap((pool) => pool.files);
}

/**
 * 仅供测试使用：按主题返回各自的文件清单。
 *
 * 与 `__placeholderFilesForTest()` 的区别：这里保留**主题分组**，
 * 用于校验「同一主题池内不得出现两张内容相同的图」这类池内约束
 * （跨主题复用同一张图是允许的，见 `skincare` 池的说明）。
 */
export function __placeholderPoolsForTest(): readonly { topic: string; files: readonly string[] }[] {
  return POOLS.map((pool) => ({ topic: pool.topic, files: pool.files }));
}
