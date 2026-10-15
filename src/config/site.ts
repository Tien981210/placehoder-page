/**
 * ============================================================================
 * 站点内容配置 —— 导航品类、首屏文案、区块标题、服务说明
 * ============================================================================
 *
 * 这里放的是**可运营的展示配置**：改文案、改导航结构不需要动组件。
 *
 * 与数据的边界（重要）：
 *   本文件只声明「期望展示什么」，**不声明数据一定存在**。
 *   每个品类只给一组**候选 slug**，实际跳转目标由
 *   `common/categories.ts` 的 `resolveCategorySlug()` 结合后端真实分类解析：
 *     · 命中 → 带 `category=<真实 slug>` 跳到商品列表；
 *     · 全不命中 → 退化为「全部商品」，并如实标注该品类商品尚未上架。
 *   这样后台一旦建立同名分类，导航自动生效，无需再改这里。
 */

export interface SiteCategory {
  /** 稳定标识（用于 v-for key 与测试）。 */
  readonly key: string;
  /** 英文品类名 —— 作为导航一级标签（面向国际化的消费品牌）。 */
  readonly label: string;
  /** 中文品类名 —— 用于分类卡片、Mega 面板与无障碍标签。 */
  readonly labelZh: string;
  /** 一句话说明，用于分类卡片与 Mega 面板。 */
  readonly blurb: string;
  /**
   * 候选后端分类 slug（按优先级）。
   *
   * ⚠️ 只是「期望」，不保证数据源里存在 —— 必须经 `resolveCategorySlug()` 解析。
   */
  readonly candidates: readonly string[];
}

/**
 * 四大目标商品品类。
 *
 * ⚠️ 这是**前端的展示目标**，不代表后台已经建立了这四个分类。
 *    当前后端只返回一个分类（`serum` / 护肤精华），
 *    因此这四个入口会如实退化为「全部商品」并给出提示，
 *    绝不把 `serum` 之类不相干的分类改头换面当成 Jewelry 展示。
 */
export const SITE_CATEGORIES: readonly SiteCategory[] = [
  {
    key: 'jewelry',
    label: 'Jewelry',
    labelZh: '首饰',
    blurb: '耳环、项链、戒指与手链 —— 日常可戴的精致点缀。',
    candidates: ['jewelry', 'jewellery', 'jewelry-accessories'],
  },
  {
    key: 'wigs-hair',
    label: 'Wigs & Hair',
    labelZh: '假发与发片',
    blurb: '假发、发片与相关头发产品，自然贴合、易打理。',
    candidates: ['wigs-hair', 'wigs', 'hair', 'hair-extensions'],
  },
  {
    key: 'makeup-tools',
    label: 'Makeup Tools',
    labelZh: '美妆工具',
    blurb: '化妆刷、美妆蛋与上妆辅助工具，手感与妆效兼顾。',
    candidates: ['makeup-tools', 'makeup', 'beauty-tools'],
  },
  {
    key: 'beauty-accessories',
    label: 'Beauty Accessories',
    labelZh: '美容配件',
    blurb: '化妆收纳、发饰与随身美容小物。',
    candidates: ['beauty-accessories', 'accessories'],
  },
];

/* -------------------------------------------------------------------------- */
/* 站点能力开关                                                                */
/* -------------------------------------------------------------------------- */

/**
 * 哪些站点能力**当前真实可用**。
 *
 * 判定标准只有一个：后端是否真的提供对应数据。
 * 关闭的能力，其入口一律不渲染 —— 不留「点进去是空白页」的死入口。
 *
 * ⚠️ 后端目前没有文章 / 内容接口（`GET /api/v1/articles` 不存在），
 *    因此 `articles = false`：首页与主导航都不展示文章入口，
 *    但 `/articles` 路由仍然保留，页面如实说明「内容筹备中」。
 */
export const SITE_FEATURES = {
  /** 文章 / Beauty Journal */
  articles: false,
  /** 「New Arrivals」独立入口（需要后端支持按上架时间排序，当前不支持） */
  newArrivals: false,
  /** 顾客账户体系（临时站已裁剪，登录 / 注册 / 我的询价页面均不存在） */
  customerAccount: false,
  /** 游客订单 / 询价查询页（临时站已裁剪） */
  orderLookup: false,
} as const;

/* -------------------------------------------------------------------------- */
/* 首屏与区块文案                                                              */
/* -------------------------------------------------------------------------- */

/**
 * 首屏主视觉文案。
 *
 * ⚠️ 刻意**不**包含品牌历史、成立年份、产地、认证、销量或供应链能力 ——
 *    这些事实品牌方尚未提供，写了就是编造。
 *    只描述「这里能买到什么品类」与「怎么买（询价制）」。
 */
export const HOME_HERO = {
  kicker: 'NEW SEASON',
  headline: '你的美，你的风格',
  supporting: '首饰、假发与发片、美妆工具与美容配件 —— 按你需要的方向慢慢逛。',
  primaryCta: '浏览全部商品',
  /**
   * 第二阶段起首屏不再放第二个按钮，而是把四个品类直接摊在首屏。
   * 因此这条文案改为**首屏品类快捷入口的分组标题**。
   */
  secondaryCta: '按品类选购',
} as const;

export const HOME_SECTIONS = {
  categories: {
    overline: 'SHOP BY CATEGORY',
    title: '按品类选购',
    subtitle: '先从品类进入，再看具体款式。已在售的品类排在最前面。',
    moreLabel: '查看全部分类',
  },
  /*
   * 商品墙 —— 首页**只有这一组**卡片网格。
   *
   * ⚠️ 原先拆成「精选好物」＋「更多商品」两组，两组模板与列数完全相同，
   *    属规范 2.1 禁止的「同页连续多组结构相同的卡片网格」；
   *    且 6 件商品被切成 4+2，第二组 2 张卡占 4 列、右侧空两列。
   *    现已合并为一组，标题也改成与"全部在售商品"相符的表述。
   */
  featured: {
    overline: 'IN STOCK',
    title: '在售商品',
    subtitle: '当前在售的全部商品，价格与库存以商品页信息为准。',
    moreLabel: '查看全部商品',
  },
  brandNote: {
    overline: 'HOW IT WORKS',
    title: '关于本站',
  },
} as const;

/**
 * 服务说明条（模块 F）。
 *
 * ⚠️ 只描述**本站真实存在**的流程步骤。不得出现配送承诺、退换货承诺、
 *    支付图标或客户评价 —— 这些既无数据来源，也与询价制业务不符。
 */
export const SITE_SERVICE_ITEMS: readonly { title: string; text: string }[] = [
  { title: '浏览商品', text: '商品参数、价格与库存以商品页信息为准。' },
  { title: '加入询价清单', text: '选好款式与数量，加入清单后可以随时调整。' },
  { title: '提交需求', text: '填写联系方式与收货信息，一次性提交。' },
  { title: '客服跟进报价', text: '客服核实库存与运费后，通过你选择的方式回复。' },
];

/* -------------------------------------------------------------------------- */
/* 联系入口文案（号码 / 邮箱本身来自 `brand.ts`）                                */
/* -------------------------------------------------------------------------- */

export const CONTACT_MESSAGES = {
  headerGreeting: 'Hello! I would like to know more about your products.',
  footerGreeting: 'Hello! I would like to ask about your products and pricing.',
  heroGreeting: 'Hello! I would like to ask about your products.',
} as const;

/* -------------------------------------------------------------------------- */
/* 询价流程说明（结算页 / 结果页复用）                                          */
/* -------------------------------------------------------------------------- */

/** 询价制流程四步 —— 与后端真实流程一致，不含任何付款环节。 */
export const INQUIRY_FLOW_STEPS: readonly string[] = [
  '选择商品并填写联系方式',
  '提交询价，获得询价单号与访问凭证',
  '客服核实商品信息、库存与适用费用',
  '客服通过你选择的方式回复报价',
];
