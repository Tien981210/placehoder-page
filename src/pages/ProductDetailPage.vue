<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { fetchProductBySlug } from '@/api/client';
import { formatMoney } from '@/common/money';
import { pastelFor } from '@/common/pastel';
import { productPlaceholder } from '@/common/placeholderImage';
import { BRAND, INQUIRY_FLOW_STEPS } from '@/config';
import SmartLink from '@/components/SmartLink.vue';
import StateError from '@/components/StateError.vue';
import StateLoading from '@/components/StateLoading.vue';
import { useAsyncData } from '@/composables/useAsyncData';
import { useCart, MAX_LINE_QUANTITY, normalizeLineQuantity } from '@/cart/useCart';

/**
 * 商品详情页。
 *
 * 契约保持（未改动）：
 *   - 仍用 `fetchProductBySlug(slug)`，404 时渲染错误状态、**绝不伪造商品**；
 *   - 加入询价清单仍然只写本地购物车，不触发任何支付 / 下单请求；
 *   - 询价入口直接指向 `/checkout`（`/inquiry` 只是重定向兼容入口）。
 *
 * 第二阶段精修：
 *   · 操作区与信息区用分隔线分开，主 CTA 全宽并置于数量控件之下（视线顺序=操作顺序）；
 *   · 新增「规格参数」，**只列后端确有值的字段**，没有的字段直接不出现；
 *   · 文案统一为询价制语义（加入询价清单），不出现「购物车 / 结算 / 支付」字样。
 */

const route = useRoute();
const { addLine } = useCart();

const slug = computed(() => String(route.params.slug ?? ''));

const detail = useAsyncData(() => fetchProductBySlug(slug.value), { immediate: false });
watch(slug, () => void detail.load(), { immediate: true });

const product = computed(() => detail.data.value);
const images = computed(() => product.value?.images ?? []);
const activeImageIndex = ref(0);

watch(images, () => {
  activeImageIndex.value = 0;
});

const activeImage = computed(() => images.value[activeImageIndex.value] ?? null);
const price = computed(() => (product.value ? formatMoney(product.value.price, product.value.currency) : ''));
const compareAtPrice = computed(() =>
  product.value?.compareAtPrice ? formatMoney(product.value.compareAtPrice, product.value.currency) : null,
);

/** 无图时的兜底底色（与商品卡同一套色板，同一商品永远同色）。 */
const galleryTone = computed(() => pastelFor(product.value?.slug ?? 'placeholder'));

/**
 * 币种代码 → 顾客可读的表述。
 *
 * 只覆盖后端当前会返回的币种；出现未知代码时**原样显示代码**，
 * 不猜、不编造中文名。
 */
const CURRENCY_LABELS: Record<string, string> = {
  CNY: '人民币（CNY）',
  USD: '美元（USD）',
  EUR: '欧元（EUR）',
  GBP: '英镑（GBP）',
  HKD: '港币（HKD）',
};

function formatCurrencyLabel(code: string): string {
  return CURRENCY_LABELS[code] ?? code;
}

/**
 * 无真实商品图时的示意占位图。
 *
 * ⚠️ 详情页比列表页更需要说清楚：这里显示的不是商品实拍。
 *    因此除了占位图本身，下方还会渲染一行明确说明（见模板 `.detail__note`）。
 */
const placeholderImage = computed(() =>
  product.value && images.value.length === 0 ? productPlaceholder(product.value) : null,
);

/**
 * 规格参数 —— **只收后端确实返回了值**的字段。
 *
 * ⚠️ 规范要求「后端没有某项字段时隐藏该项，不得制造虚构规格」。
 *    因此这里不做「未提供」占位行：没有的字段整行不渲染，
 *    而不是铺一张大部分格子写着「未提供」的表格。
 */
const specs = computed<Array<{ label: string; value: string }>>(() => {
  const current = product.value;
  if (!current) return [];
  const rows: Array<{ label: string; value: string }> = [];
  if (current.category?.name) rows.push({ label: '所属分类', value: current.category.name });
  if (current.sku) rows.push({ label: '商品编码', value: current.sku });
  /*
   * ⚠️ 原先这一行渲染成「计价货币 / CNY」—— 裸 ISO 代码是给系统看的，
   *    不是给顾客看的。改成可读表述，代码仍保留在括号里以免丢失精度信息。
   */
  rows.push({ label: '价格币种', value: formatCurrencyLabel(current.currency) });
  return rows;
});

const quantity = ref(1);
const addedMessage = ref('');
const addError = ref('');

/**
 * 加入询价清单。
 *
 * ⚠️ **必须先校验数量再显示成功提示**：`v-model.number` 在用户清空输入框时
 *    会给出空串、粘贴非法内容时可能给出 `NaN`。此前这里无条件设置
 *    「已加入」文案，于是出现「提示已加入、清单却没有任何变化」
 *    这种自相矛盾的状态。现在非法输入一律给错误提示、不写清单。
 */
function handleAddToCart(): void {
  const current = product.value;
  if (!current) return;

  const normalized = normalizeLineQuantity(quantity.value);
  if (normalized === null) {
    addedMessage.value = '';
    addError.value = `请填写 1–${MAX_LINE_QUANTITY} 之间的整数数量。`;
    return;
  }

  addLine(
    {
      productId: current.id,
      slug: current.slug,
      name: current.name,
      unitPrice: current.price,
      currency: current.currency,
      imageUrl: current.images[0]?.url ?? null,
    },
    normalized,
  );

  // 回写规整后的数量：超上限 / 小数 / 空值都会立刻在输入框里得到纠正。
  quantity.value = normalized;
  addError.value = '';
  addedMessage.value = `已加入询价清单：${current.name} × ${normalized}`;
}

/**
 * 用户改动数量时立刻清掉上一次的反馈。
 *
 * ⚠️ 刻意用 `@input` 而不是 `watch(quantity)`：`handleAddToCart()` 内部会
 *    程序化回写 `quantity`，`watch` 会在之后异步触发，把刚设置好的成功文案抹掉。
 *    `@input` 只在真实用户输入时触发，不会与程序化回写打架。
 */
function onQuantityInput(): void {
  addedMessage.value = '';
  addError.value = '';
}

/**
 * − / + 步进。
 *
 * ⚠️ 此前详情页的数量控件是一个**裸 `<input type="number">`，没有任何加减按钮**，
 *    而 `/cart` 里同一个「数量」概念却带完整的 − 1 + 步进器 —— 同一业务动作
 *    在两页是两套交互。原生 number 输入框的微调箭头在触屏上几乎点不中
 *    （实测高度不足 44px 的一半），而数量恰恰是最需要明确加减反馈的控件。
 *    这里复用与购物车完全相同的 `.qty-control` 结构，边界规则沿用
 *    既有的 `normalizeLineQuantity` / `MAX_LINE_QUANTITY`，不改后端契约。
 */
function stepQuantity(delta: number): void {
  const current = normalizeLineQuantity(quantity.value) ?? 1;
  const next = Math.min(MAX_LINE_QUANTITY, Math.max(1, current + delta));
  quantity.value = next;
  addedMessage.value = '';
  addError.value = '';
}
</script>

<template>
  <div class="page container">
    <StateLoading v-if="detail.isLoading.value" />
    <StateError
      v-else-if="detail.isError.value"
      :error="detail.error.value"
      @retry="detail.load"
    />

    <template v-else-if="product">
      <nav class="breadcrumb" aria-label="面包屑">
        <SmartLink :to="{ name: 'home' }">首页</SmartLink>
        <span aria-hidden="true">/</span>
        <SmartLink :to="{ name: 'products' }">全部商品</SmartLink>
        <template v-if="product.category">
          <span aria-hidden="true">/</span>
          <SmartLink :to="{ name: 'products', query: { category: product.category.slug } }">
            {{ product.category.name }}
          </SmartLink>
        </template>
        <span aria-hidden="true">/</span>
        <span aria-current="page">{{ product.name }}</span>
      </nav>

      <div class="detail">
        <div class="detail__gallery">
          <div class="detail__main-image" :style="{ background: galleryTone }">
            <img
              v-if="activeImage"
              :src="activeImage.url"
              :alt="activeImage.altText ?? product.name"
              loading="eager"
              decoding="async"
            />
            <!-- 没有真实商品图时用主题相符的示意占位图 -->
            <img
              v-else-if="placeholderImage"
              :src="placeholderImage.url"
              :alt="placeholderImage.alt"
              loading="eager"
              decoding="async"
            />
            <!-- 连主题都推断不出：用品牌标记兜底，不留破图 -->
            <img
              v-else
              class="detail__image-mark"
              :src="BRAND.brandLogo"
              alt=""
              aria-hidden="true"
            />
          </div>

          <p v-if="placeholderImage" class="detail__note">
            图片为示意图，不是商品实拍 —— 实际外观、颜色与规格请以客服确认的信息为准。
          </p>

          <div v-if="images.length > 1" class="detail__thumbs">
            <!-- 缩略图切换属于非导航操作，使用原生 button -->
            <button
              v-for="(image, index) in images"
              :key="image.id"
              type="button"
              class="detail__thumb"
              :class="{ 'detail__thumb--active': index === activeImageIndex }"
              :aria-pressed="index === activeImageIndex"
              :aria-label="`查看第 ${index + 1} 张图片`"
              @click="activeImageIndex = index"
            >
              <img :src="image.url" :alt="image.altText ?? product.name" loading="lazy" decoding="async" />
            </button>
          </div>
        </div>

        <div class="detail__info">
          <p v-if="product.category" class="detail__cat overline">{{ product.category.name }}</p>
          <h1 class="detail__name">{{ product.name }}</h1>
          <p v-if="product.summary" class="detail__summary">{{ product.summary }}</p>

          <div class="detail__price-row">
            <span class="detail__price">{{ price }}</span>
            <s v-if="compareAtPrice" class="detail__compare">{{ compareAtPrice }}</s>
          </div>
          <p class="detail__meta">单价，不含运费 —— 运费由客服按收货地址核算后报价。</p>

          <dl v-if="specs.length > 0" class="detail__specs">
            <template v-for="row in specs" :key="row.label">
              <dt>{{ row.label }}</dt>
              <dd>{{ row.value }}</dd>
            </template>
          </dl>

          <div class="detail__buy">
            <div class="detail__qty-row">
              <label class="form-field__label" for="detail-qty">数量</label>
              <!-- 与 /cart 完全相同的步进器结构，保证同一业务动作全站一套交互 -->
              <div class="qty-control">
                <button
                  type="button"
                  class="qty-control__btn"
                  aria-label="减少数量"
                  @click="stepQuantity(-1)"
                >
                  −
                </button>
                <input
                  id="detail-qty"
                  v-model.number="quantity"
                  type="number"
                  min="1"
                  :max="MAX_LINE_QUANTITY"
                  class="qty-control__input"
                  inputmode="numeric"
                  @input="onQuantityInput"
                />
                <button
                  type="button"
                  class="qty-control__btn"
                  aria-label="增加数量"
                  @click="stepQuantity(1)"
                >
                  +
                </button>
              </div>
            </div>

            <button type="button" class="btn btn--primary btn--block" @click="handleAddToCart">
              加入询价清单
            </button>

            <p v-if="addError" class="notice notice--error" role="alert">{{ addError }}</p>
            <p v-else-if="addedMessage" class="notice notice--info" role="status">
              {{ addedMessage }}
            </p>

            <p class="notice notice--info">
              本站为询价制：加入询价清单后请前往
              <SmartLink :to="{ name: 'checkout' }">提交询价</SmartLink>，
              由客服核实库存与运费后报价。本站不提供在线支付。
            </p>

            <div class="detail__actions">
              <SmartLink :to="{ name: 'cart' }" class="btn btn--ghost">查看询价清单</SmartLink>
              <SmartLink :to="{ name: 'products' }" class="btn btn--quiet">继续挑选</SmartLink>
            </div>
          </div>
        </div>
      </div>

      <div class="detail-extra">
        <section class="panel">
          <h2 class="section__title">商品描述</h2>
          <!--
            ⚠️ 后端未填写描述时，这里必须给出**可用的下一步**，而不是一句
               干巴巴的「商家尚未填写详细描述。」就结束（规范 8.2）。
          -->
          <template v-if="product.description">
            <p class="detail-extra__text">{{ product.description }}</p>
          </template>
          <template v-else>
            <p class="detail-extra__text muted">
              这件商品还没有填写详细描述。规格参数见上方，其余细节可直接向客服确认。
            </p>
            <div class="row detail-extra__actions">
              <SmartLink :to="{ name: 'products' }" class="btn btn--ghost btn--sm">
                看看其它商品
              </SmartLink>
              <SmartLink :to="{ name: 'checkout' }" class="btn btn--ghost btn--sm">
                去提交询价
              </SmartLink>
            </div>
          </template>
        </section>

        <section class="panel">
          <h2 class="section__title">询价流程</h2>
          <ul class="flow-list">
            <li v-for="(step, index) in INQUIRY_FLOW_STEPS" :key="step">
              <span class="flow-list__no" aria-hidden="true">{{ index + 1 }}</span>
              <span>{{ step }}</span>
            </li>
          </ul>
        </section>
      </div>
    </template>
  </div>
</template>

<style scoped>
.detail-extra {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
  gap: var(--sp-4);
  align-items: start;
}

.detail-extra__text {
  color: var(--ink-2);
  line-height: 1.8;
  white-space: pre-line;
}

.detail-extra__actions {
  margin-top: var(--sp-4);
}

@media (max-width: 900px) {
  .detail-extra {
    grid-template-columns: 1fr;
  }
}
</style>
