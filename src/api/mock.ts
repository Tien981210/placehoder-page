import { BRAND_MARK_SVG_BODY, BRAND_MARK_VIEWBOX } from '@/common/brandMark';
import { detectPlaceholderTopic, placeholderImagesForTopic } from '@/common/placeholderImage';
import type { CategoryView, PaginatedResult, ProductImageView, ProductView } from './types';

/**
 * ⚠️ 演示（Mock）数据 —— 明确标记，绝不冒充后端真实数据。
 *
 * 仅在 VITE_USE_MOCK 为 true 时被 client.ts 使用。
 * 使用 Mock 时界面会显示「演示数据」角标（见 components/DemoDataBadge.vue）。
 *
 * 这些数据用于「页面骨架阶段」联调前验证页面与交互，
 * 阶段 3 前后端联调时应设置 VITE_USE_MOCK=false 走真实 API。
 *
 * 品类口径与站点四大目标品类（首饰 / 假发与发片 / 美妆工具 / 美容配件）
 * 保持一致，另保留真实后端已有的 `serum`（护肤精华）分类，
 * 以便同时验证「目标品类命中」与「真实分类未被覆盖」两条路径。
 */

const MOCK_DELAY_MS = 180;

/**
 * 生成一张「纯色底 + 品牌标记」的内联 SVG 占位图（不依赖任何外部网络）。
 *
 * 不用文字标签：占位图只负责表达「这里还没有真实商品图」，
 * 商品名由卡片自身的标题承担。
 */
/** 标记自身的 viewBox 边长（用于计算占位图里的缩放比例）。 */
const MARK_UNITS = Number(BRAND_MARK_VIEWBOX.split(' ')[2]);

/** 占位图边长（像素）。 */
const PLACEHOLDER_PX = 600;

/** 占位图里标记的目标边长（像素）。 */
const MARK_RENDER_PX = 300;

/** 由 viewBox 单位换算出的缩放比。 */
const MARK_SCALE = MARK_RENDER_PX / MARK_UNITS;

/** 标记居中放置时的左上角偏移。 */
const MARK_OFFSET = (PLACEHOLDER_PX - MARK_RENDER_PX) / 2;

function placeholderImage(hue: number): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${PLACEHOLDER_PX}" height="${PLACEHOLDER_PX}">` +
    `<rect width="${PLACEHOLDER_PX}" height="${PLACEHOLDER_PX}" fill="hsl(${hue}, 30%, 94%)"/>` +
    `<g transform="translate(${MARK_OFFSET} ${MARK_OFFSET}) scale(${MARK_SCALE.toFixed(4)})">${BRAND_MARK_SVG_BODY}</g>` +
    `</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/**
 * 演示商品的图片。
 *
 * 优先用 `public/placeholder/` 下的示意占位图（按商品名推断品类，
 * 与线上无图商品的兜底逻辑**完全一致**，因此 Mock 模式与真实后端的观感一致）；
 * 推断不出品类时退回内联 SVG，保证演示数据永远有图、不留破图。
 */
function buildMockImages(seed: MockProductSeed): ProductImageView[] {
  const topic = detectPlaceholderTopic([seed.name, seed.slug, seed.categorySlug]);
  if (topic) {
    return placeholderImagesForTopic(topic, seed.slug, 2, seed.name).map((photo, index) => ({
      id: `${seed.id}-img-${index + 1}`,
      storageKey: photo.url.replace(/^\//, ''),
      url: photo.url,
      altText: photo.alt,
      visibility: 'PUBLIC' as const,
      sortOrder: index,
      isPrimary: index === 0,
    }));
  }

  return [
    {
      id: `${seed.id}-img-1`,
      storageKey: `mock/${seed.slug}-1.svg`,
      url: placeholderImage(seed.hue),
      altText: `${seed.name} 主图（演示）`,
      visibility: 'PUBLIC' as const,
      sortOrder: 0,
      isPrimary: true,
    },
    {
      id: `${seed.id}-img-2`,
      storageKey: `mock/${seed.slug}-2.svg`,
      url: placeholderImage((seed.hue + 40) % 360),
      altText: `${seed.name} 细节图（演示）`,
      visibility: 'PUBLIC' as const,
      sortOrder: 1,
      isPrimary: false,
    },
  ];
}

interface MockProductSeed {
  id: string;
  slug: string;
  name: string;
  summary: string;
  description: string;
  price: string;
  compareAtPrice: string | null;
  sku: string;
  categorySlug: string;
  hue: number;
}

/**
 * 演示分类 —— 对齐站点四大目标品类，并保留真实后端已有的 `serum`。
 *
 * ⚠️ 这只是**演示数据**，不代表后台已经建立了这些分类；
 *    真实后端当前只返回 `serum` 一条，页面会如实退化为「全部商品」。
 */
const MOCK_CATEGORY_SEEDS: Array<{ slug: string; name: string; description: string }> = [
  { slug: 'jewelry', name: '首饰', description: '耳环、项链、戒指与手链' },
  { slug: 'wigs-hair', name: '假发与发片', description: '假发、发片与头发配饰' },
  { slug: 'makeup-tools', name: '美妆工具', description: '化妆刷、美妆蛋与上妆辅助' },
  { slug: 'beauty-accessories', name: '美容配件', description: '收纳、发饰与随身美容小物' },
  { slug: 'serum', name: '护肤精华', description: '面部精华类护肤产品' },
];

/** 13 件演示商品 —— 覆盖四个目标品类，另含 1 件真实后端已有的精华类商品。 */
const MOCK_PRODUCT_SEEDS: MockProductSeed[] = [
  {
    id: '01920000-0000-7000-8000-000000000001',
    slug: 'pearl-shell-earrings',
    name: '珍珠母贝耳环',
    summary: '轻量贴耳，日常通勤可戴。',
    description: '母贝贴面配镀金耳针，单只约 2.1g，贴耳不坠，适合日常与通勤。',
    price: '129.00',
    compareAtPrice: '169.00',
    sku: 'JW-1001',
    categorySlug: 'jewelry',
    hue: 30,
  },
  {
    id: '01920000-0000-7000-8000-000000000002',
    slug: 'minimal-clavicle-necklace',
    name: '极简锁骨链',
    summary: '细链配小吊坠，可调节长度。',
    description: '1.2mm 细链，链长 40cm + 5cm 延长链，小吊坠直径 8mm。',
    price: '159.00',
    compareAtPrice: null,
    sku: 'JW-1002',
    categorySlug: 'jewelry',
    hue: 340,
  },
  {
    id: '01920000-0000-7000-8000-000000000003',
    slug: 'zircon-band-ring',
    name: '锆石细圈戒指',
    summary: '可叠戴，多档尺码。',
    description: '925 银底托配碎锆石，圈口宽度 2mm，可单戴也可与其他细圈叠戴。',
    price: '99.00',
    compareAtPrice: null,
    sku: 'JW-1003',
    categorySlug: 'jewelry',
    hue: 200,
  },
  {
    id: '01920000-0000-7000-8000-000000000004',
    slug: 'long-straight-wig',
    name: '自然长直假发',
    summary: '哑光高温丝，可造型。',
    description: '哑光高温丝发丝，中分内网，长度 60cm，可低温卷烫与吹整。',
    price: '399.00',
    compareAtPrice: '459.00',
    sku: 'WH-2001',
    categorySlug: 'wigs-hair',
    hue: 24,
  },
  {
    id: '01920000-0000-7000-8000-000000000005',
    slug: 'air-bang-clip-piece',
    name: '空气刘海发片',
    summary: '隐形卡扣，秒换造型。',
    description: '一片式空气刘海，内置隐形卡扣，发丝可吹整，适合试新造型。',
    price: '89.00',
    compareAtPrice: null,
    sku: 'WH-2002',
    categorySlug: 'wigs-hair',
    hue: 45,
  },
  {
    id: '01920000-0000-7000-8000-000000000006',
    slug: 'invisible-hair-net-3pack',
    name: '隐形发网（3 件装）',
    summary: '细网不勒头皮，三只装。',
    description: '高弹细网，边缘包边不勒头皮，一次 3 只装，便于替换清洗。',
    price: '29.00',
    compareAtPrice: null,
    sku: 'WH-2003',
    categorySlug: 'wigs-hair',
    hue: 0,
  },
  {
    id: '01920000-0000-7000-8000-000000000007',
    slug: 'makeup-brush-set-5',
    name: '化妆刷五件套',
    summary: '散粉/腮红/眼影/遮瑕/晕染。',
    description: '五支常用刷型，人造纤维毛，配收纳袋，适合日常通勤妆容。',
    price: '189.00',
    compareAtPrice: '229.00',
    sku: 'MT-3001',
    categorySlug: 'makeup-tools',
    hue: 280,
  },
  {
    id: '01920000-0000-7000-8000-000000000008',
    slug: 'beauty-blender-duo',
    name: '美妆蛋（2 只装）',
    summary: '干湿两用，不吃粉。',
    description: '非乳胶海绵，干湿两用，斜切面适配鼻翼与眼下，一次 2 只装。',
    price: '49.00',
    compareAtPrice: null,
    sku: 'MT-3002',
    categorySlug: 'makeup-tools',
    hue: 320,
  },
  {
    id: '01920000-0000-7000-8000-000000000009',
    slug: 'portable-lash-curler',
    name: '便携睫毛夹',
    summary: '窄口设计，贴合眼型。',
    description: '窄口弧形夹头，配替换硅胶垫，折叠收纳后仅 7cm，适合随身携带。',
    price: '59.00',
    compareAtPrice: null,
    sku: 'MT-3003',
    categorySlug: 'makeup-tools',
    hue: 175,
  },
  {
    id: '01920000-0000-7000-8000-000000000010',
    slug: 'travel-makeup-pouch',
    name: '旅行化妆收纳包',
    summary: '分层收纳，可立放。',
    description: '外层防泼水面料，内里分层，可立放于台面，配独立刷具夹层。',
    price: '79.00',
    compareAtPrice: null,
    sku: 'BA-4001',
    categorySlug: 'beauty-accessories',
    hue: 215,
  },
  {
    id: '01920000-0000-7000-8000-000000000011',
    slug: 'satin-scrunchie-4pack',
    name: '缎面发圈（4 条装）',
    summary: '不勒发，减少压痕。',
    description: '缎面外层配柔软内芯，束发不勒头皮、减少压痕，一次 4 条装。',
    price: '39.00',
    compareAtPrice: '59.00',
    sku: 'BA-4002',
    categorySlug: 'beauty-accessories',
    hue: 350,
  },
  {
    id: '01920000-0000-7000-8000-000000000012',
    slug: 'folding-compact-mirror',
    name: '随身折叠化妆镜',
    summary: '双面镜，一键展开。',
    description: '一面正常、一面 3 倍放大，折叠后厚度 1.2cm，可放进随身小包。',
    price: '69.00',
    compareAtPrice: null,
    sku: 'BA-4003',
    categorySlug: 'beauty-accessories',
    hue: 165,
  },
  {
    id: '01920000-0000-7000-8000-000000000013',
    slug: 'revitalizing-serum-30ml',
    name: '焕活修护精华 30ml',
    summary: '面部精华，滴管取用。',
    description: '面部精华，配滴管取用；成分与功效以商品实物标签与客服答复为准。',
    price: '268.00',
    compareAtPrice: null,
    sku: 'SR-5001',
    categorySlug: 'serum',
    hue: 300,
  },
];

const MOCK_NOW = '2026-10-11T00:00:00.000Z';

export const mockCategories: CategoryView[] = MOCK_CATEGORY_SEEDS.map((seed, index) => ({
  id: `01920000-0000-7000-8000-00000000010${index}`,
  name: seed.name,
  slug: seed.slug,
  description: seed.description,
  sortOrder: index,
  isActive: true,
  parentId: null,
  createdAt: MOCK_NOW,
  updatedAt: MOCK_NOW,
}));

export const mockProducts: ProductView[] = MOCK_PRODUCT_SEEDS.map((seed) => {
  const category = mockCategories.find((item) => item.slug === seed.categorySlug) ?? null;
  return {
    id: seed.id,
    name: seed.name,
    slug: seed.slug,
    summary: seed.summary,
    description: seed.description,
    price: seed.price,
    currency: 'CNY',
    compareAtPrice: seed.compareAtPrice,
    sku: seed.sku,
    status: 'ACTIVE' as const,
    category: category ? { id: category.id, name: category.name, slug: category.slug } : null,
    images: buildMockImages(seed),
    publishedAt: MOCK_NOW,
    createdAt: MOCK_NOW,
    updatedAt: MOCK_NOW,
  };
});

function delay(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, MOCK_DELAY_MS));
}

/** 模拟后端的分页 + 过滤语义（仅 ACTIVE 商品、按分类 slug、模糊搜索）。 */
export function mockListProducts(params: {
  page: number;
  pageSize: number;
  q?: string;
  category?: string;
}): PaginatedResult<ProductView> {
  const keyword = params.q?.trim().toLowerCase() ?? '';
  const filtered = mockProducts.filter((product) => {
    const matchesCategory = !params.category || product.category?.slug === params.category;
    const matchesKeyword =
      !keyword ||
      product.name.toLowerCase().includes(keyword) ||
      product.slug.toLowerCase().includes(keyword) ||
      (product.sku ?? '').toLowerCase().includes(keyword);
    return matchesCategory && matchesKeyword;
  });

  const start = (params.page - 1) * params.pageSize;
  const items = filtered.slice(start, start + params.pageSize);

  return {
    items,
    page: params.page,
    pageSize: params.pageSize,
    total: filtered.length,
    totalPages: params.pageSize > 0 ? Math.ceil(filtered.length / params.pageSize) : 0,
  };
}

export function mockFindProductBySlug(slug: string): ProductView | null {
  return mockProducts.find((product) => product.slug === slug) ?? null;
}

export { delay as mockDelay };
