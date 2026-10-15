<script setup lang="ts">
import { computed } from 'vue';
import { useCart, MAX_LINE_QUANTITY, parseQuantityInput, type CartLine } from '@/cart/useCart';
import { resolveCartLineImage, type CartLineImage } from '@/cart/cartLineImage';
import { formatCents, formatMoney, parseMoneyToCents } from '@/common/money';
import { BRAND } from '@/config';
import SmartLink from '@/components/SmartLink.vue';
import StateEmpty from '@/components/StateEmpty.vue';

/**
 * 询价清单页（购物车页）。
 *
 * 契约保持（与既有测试一致，本次改造未改动）：
 *   - 空车时不渲染 `.cart-table`，只给空状态 + 浏览商品入口；
 *   - 数量输入框的 `change` 处理沿用 `parseQuantityInput()`：
 *     非法输入**绝不删行**，只把输入框还原；
 *   - 「提交询价」直接指向 `/checkout`。
 *
 * 移动端：表格在 ≤720px 时由 CSS 折叠成卡片（见 `styles/main.css` 的
 *   `.cart-table` 媒体查询）。因此**不能**再给表格设 `min-width`，
 *   否则窄屏会出现横向滚动。每个 `<td>` 都带 `data-label`，
 *   折叠后由 `::before` 显示字段名。
 */

const { lines, subtotal, totalQuantity, setQuantity, removeLine, clear } = useCart();

const currency = computed(() => lines.value[0]?.currency ?? 'CNY');
const subtotalText = computed(() => formatMoney(subtotal.value, currency.value));

/**
 * 行 + 展示用图片。
 *
 * 图片解析规则见 `cart/cartLineImage.ts`（与购物车抽屉共用，
 * 保证同一件商品在抽屉里与询价清单页里显示同一张图）。
 */
interface CartLineView {
  line: CartLine;
  image: CartLineImage | null;
}

const linesWithImage = computed<CartLineView[]>(() =>
  lines.value.map((line) => ({ line, image: resolveCartLineImage(line) })),
);

/** 单行小计（按「分」做整数运算，避免浮点误差）。 */
function lineTotal(unitPrice: string, quantity: number): string {
  return formatCents(parseMoneyToCents(unitPrice) * quantity);
}

/**
 * 数量输入框提交（失焦 / 回车）时的处理。
 *
 * ⚠️ 输入框的 `max="99"` 只是 HTML 提示，`type="number"` 也不会阻止粘贴超长数字。
 *    解析规则见 `parseQuantityInput()` —— 关键是**非法输入绝不能删掉这一行**。
 */
function onQuantityChange(productId: string, currentQuantity: number, event: Event): void {
  const input = event.target as HTMLInputElement;
  const outcome = parseQuantityInput(input.value);

  if (outcome.kind === 'remove') {
    removeLine(productId);
    return;
  }
  if (outcome.kind === 'invalid') {
    // 空 / 非数字 / 负数：视为输入错误，把输入框还原成当前值。
    input.value = String(currentQuantity);
    return;
  }

  setQuantity(productId, outcome.quantity);
  // 超上限 / 小数被规整过时必须回显，否则界面显示与真实存储不一致。
  if (input.value.trim() !== String(outcome.quantity)) {
    input.value = String(outcome.quantity);
  }
}
</script>

<template>
  <div class="page container">
    <header class="page__header">
      <p class="overline">INQUIRY LIST</p>
      <h1 class="page__title">询价清单</h1>
      <p class="page__subtitle">
        游客询价清单，无需登录。共 {{ totalQuantity }} 件商品。本站为询价制，提交后由客服核实库存与运费并报价。
      </p>
    </header>

    <StateEmpty
      v-if="lines.length === 0"
      title="询价清单是空的"
      description="清单里还没有商品。挑好款式与数量后加入，清单会保存在这台设备上，可以随时回来调整数量或移除。"
    >
      <SmartLink :to="{ name: 'products' }" class="btn btn--primary">去挑选商品</SmartLink>
    </StateEmpty>

    <template v-else>
      <div class="panel">
        <table class="data-table cart-table">
          <thead>
            <tr>
              <th scope="col">商品</th>
              <th scope="col">单价</th>
              <th scope="col">数量</th>
              <th scope="col">小计</th>
              <th scope="col"><span class="visually-hidden">操作</span></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in linesWithImage" :key="item.line.productId">
              <td data-label="商品">
                <div class="cart-line">
                  <img
                    v-if="item.image"
                    :src="item.image.url"
                    :alt="item.image.alt"
                    class="cart-line__thumb"
                    loading="lazy"
                    decoding="async"
                  />
                  <img
                    v-else
                    class="cart-line__thumb cart-line__thumb--mark"
                    :src="BRAND.brandLogo"
                    alt=""
                    aria-hidden="true"
                  />
                  <SmartLink :to="{ name: 'product-detail', params: { slug: item.line.slug } }">
                    {{ item.line.name }}
                  </SmartLink>
                </div>
              </td>
              <td data-label="单价">{{ formatMoney(item.line.unitPrice, item.line.currency) }}</td>
              <td data-label="数量">
                <!-- 数量调整属于非导航操作：原生 button / input -->
                <div class="qty-control">
                  <button
                    type="button"
                    class="qty-control__btn"
                    :aria-label="`减少 ${item.line.name} 的数量`"
                    @click="setQuantity(item.line.productId, item.line.quantity - 1)"
                  >
                    −
                  </button>
                  <input
                    :value="item.line.quantity"
                    type="number"
                    min="1"
                    :max="MAX_LINE_QUANTITY"
                    class="qty-control__input"
                    inputmode="numeric"
                    :aria-label="`${item.line.name} 数量`"
                    @change="onQuantityChange(item.line.productId, item.line.quantity, $event)"
                  />
                  <button
                    type="button"
                    class="qty-control__btn"
                    :aria-label="`增加 ${item.line.name} 的数量`"
                    @click="setQuantity(item.line.productId, item.line.quantity + 1)"
                  >
                    +
                  </button>
                </div>
              </td>
              <td data-label="小计">{{ formatMoney(lineTotal(item.line.unitPrice, item.line.quantity), item.line.currency) }}</td>
              <td data-label="操作">
                <button
                  type="button"
                  class="btn btn--ghost btn--sm"
                  :aria-label="`从询价清单移除 ${item.line.name}`"
                  @click="removeLine(item.line.productId)"
                >
                  移除
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="cart-summary panel">
        <div>
          <p class="cart-summary__label">商品小计</p>
          <p class="cart-summary__value">{{ subtotalText }}</p>
          <p class="subtle">
            此处为加入询价清单时的价格快照，仅供参考：提交询价时服务端会重新核验商品状态与价格，
            已下架或不可询价的商品会被拒绝并提示移除；运费与最终价格由客服核实后报价。
            本站不提供在线支付，也不会自动扣款。
          </p>
        </div>
        <div class="cart-summary__actions">
          <!--
            ⚠️ 「清空清单」是**破坏性**操作（一次性清掉全部行、无撤销），
               不能与「继续挑选」共用同一个次级按钮外观 —— 规范 10.1 要求
               按钮层级至少包含 Primary / Secondary / Tertiary / Destructive。
               这里用 `.btn--danger`（描边 + 危险色文字，hover 才铺底色），
               危险层级靠**颜色与描边**表达，而不是做成一个大红实心块抢走
               「提交询价」的主操作权重。
          -->
          <button type="button" class="btn btn--danger" @click="clear">清空清单</button>
          <SmartLink :to="{ name: 'products' }" class="btn btn--ghost">继续挑选</SmartLink>
          <SmartLink :to="{ name: 'checkout' }" class="btn btn--primary">提交询价</SmartLink>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
/*
 * 只保留表格本身的最小必要样式。
 * 行 / 数量控件 / 汇总区的视觉**全部**交给全局 `styles/main.css`，
 * 避免同一套 class 在两处各写一份导致漂移。
 *
 * ⚠️ 刻意不设 `min-width`：窄屏靠 `main.css` 里的 `.cart-table` 媒体查询
 *    把每行折叠成卡片，设了 min-width 反而会撑出横向滚动。
 */
.cart-table {
  table-layout: auto;
}
</style>
