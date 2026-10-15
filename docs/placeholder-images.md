# 占位图（示意图）说明

> 相关代码：`src/common/placeholderImage.ts`、`src/cart/cartLineImage.ts`
> 相关资源：`public/placeholder/*.jpg`
> 相关测试：`src/common/placeholderImage.spec.ts`

## 1 为什么需要它

后端商品目前**普遍没有图片** —— `GET /api/v1/products` 返回的每件商品
`images` 都是 `[]`（图片上传能力尚未接通，后端驱动为 `none`）。

没有占位图时，商品卡、详情页、购物车行都会回落到品牌标记，
整站看上去像空的，无法对设计做评审。因此引入一组占位图，
**在真实商品图补齐之前**让页面可被正常评估。

## 2 三层约束（这是「不误导」的关键）

占位图最容易出的问题是**张冠李戴** —— 给一瓶精华配一张项链照片。
为避免这一点，`placeholderImage.ts` 做了三层约束：

| # | 约束 | 实现 |
| --- | --- | --- |
| 1 | **只在没有真实图时启用** | 调用方一律先判断 `product.images.length === 0`；有真实图时绝不走占位逻辑 |
| 2 | **按关键词匹配主题** | 用商品名 / slug / 分类名 / 分类 slug 推断品类，再取对应主题的图 |
| 3 | **推断不出就不给图** | 返回 `null`，调用方回落到品牌标记 —— **宁可朴素，不可误导** |

第 4 层在界面侧：用到占位图的地方都渲染「示意图」标注
（`.card-ph-note` / `.detail__note`），真实图片接入后标注**自动消失**，
判断依据同样是 `images` 是否为空。

## 3 主题与匹配规则

| 主题 | 图数 | 命中关键词（节选） |
| --- | --- | --- |
| `jewelry` 首饰 | 5 | 耳环 / 项链 / 锁骨链 / 戒指 / 手链 / 吊坠 / 首饰 / 珍珠 / 锆石 · earring / necklace / ring / bracelet / pendant / jewelry / pearl |
| `hair` 假发与发片 | 4 | 假发 / 发片 / 发套 / 刘海 / 发网 / 接发 · hair / wig / extension / ponytail |
| `makeup` 美妆工具 | 4 | 化妆刷 / 美妆蛋 / 粉扑 / 睫毛夹 / 口红 / 眼影 · makeup / brush / sponge / palette / lipstick |
| `accessory` 美容配件 | 4 | 收纳 / 化妆包 / 化妆镜 / 发圈 / 发夹 / 美甲 / 刮痧 · pouch / mirror / comb / manicure / accessories |
| `skincare` 护肤 | 4 | 精华 / 面霜 / 面膜 / 洁面 / 防晒 / 精油 · serum / cream / mask / toner / skincare |

另有 `hero.jpg` 一张用于首页主视觉。

### 3.1 两条容易踩的匹配细节

1. **ASCII 关键词走词边界匹配**，中文关键词走子串匹配。
   否则 `ring` 会命中 `spring-collection` 这种 slug。
   （见 `hasLatinKeyword()`；测试用例：`detectPlaceholderTopic(['spring-collection']) === null`）
2. **关键词之间刻意不互相包含**：没有裸的「化妆」，
   只有「化妆刷」（→ makeup）和「化妆包」（→ accessory）。
   否则「化妆包」会被判成美妆工具。

### 3.2 线索顺序即优先级

```ts
// 商品名 > 商品 slug > 分类名 > 分类 slug
productPlaceholder({ name, slug, category })
```

商品名最贴近「这件东西到底是什么」，分类名最粗粒度、放最后兜底。
因此「商品名说是耳环、分类名说是护肤」时，以**商品名**为准。

## 4 确定性选择

同一件商品在**列表页 / 详情页 / 购物车抽屉 / 购物车页 / 询价结果页**
必须显示**同一张**图，否则同一件商品换个页面就换张照片，看起来像数据错乱。

因此用 FNV-1a 对 `slug` 做稳定哈希，从主题池里取图：

```ts
files[hashString(seed) % files.length]
```

不是随机 —— 同一 slug 永远得到同一张图。
详情页图集用 `placeholderImagesForTopic(topic, slug, 2)`，
从哈希偏移处顺序取 2 张，保证不重复。

## 5 图片来源与许可

22 张图全部来自 **Unsplash**（`images.unsplash.com`），
按 **Unsplash License** 使用：**可免费用于商业与非商业用途，无需署名**
（署名非强制，但在此保留来源说明）。

下载参数固定为 4:5 竖版：

```
https://images.unsplash.com/<photo-id>?w=680&h=850&fit=crop&crop=entropy&q=70&fm=jpg
```

主视觉为 `w=900&h=1125`。

### 5.1 已做的合规检查

- **剔除了带可辨识第三方品牌的图**：例如一张 `COCOOIL` 身体油、
  一张 Clinique 口红、一张 Gucci 手袋、一张 Chanel 化妆品 —— 均已弃用。
- **剔除了一张衣服上带半截标语的人像**（lavender hair）：改用 `crop=top`
  重切并本地裁掉底部后重新导出。
- 全部图片经过人工目视核对（联系表 → 逐张确认），不是盲选。

> ⚠️ 这些图是**设计评审用的占位素材**，不是商品实拍。
> 上线前必须替换为真实商品图，或至少在内容上确认可用。

## 6 如何替换为真实商品图

**首选：在后台为商品上传图片。** 一旦 `product.images` 非空，
占位逻辑自动失效、「示意图」标注自动消失 —— 不需要改任何前端代码。

**若要整体换掉这组占位图：**

1. 用同名文件覆盖 `public/placeholder/*.jpg`（保持 4:5，建议 ≥680×850）；
2. 若要增删图或调整主题归属，改 `src/common/placeholderImage.ts` 的 `POOLS`；
3. `placeholderImage.spec.ts` 会自动校验「模块引用的每个文件都真实存在」，
   文件缺失时测试直接失败 —— 不需要额外记清单。

**若要彻底移除占位图能力：** 删除 `public/placeholder/`、
`src/common/placeholderImage.ts`、`src/cart/cartLineImage.ts` 与对应 spec，
并把 4 个调用点（`ProductCard` / `ProductDetailPage` / `CartDrawer` / `CartPage`）
的占位分支删掉，回落到品牌标记。

## 7 目录内容

```
public/placeholder/
  hero.jpg           900×1125  首页主视觉
  jewelry-1..5.jpg   680×850   首饰
  hair-1..4.jpg      680×850   假发与发片
  makeup-1..4.jpg    680×850   美妆工具
  accessory-1..4.jpg 680×850   美容配件
  skincare-1..4.jpg  680×850   护肤
```

合计 22 张，约 1.9 MB（`q=70`，已 `optimize`）。
