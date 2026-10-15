<script setup lang="ts">
import { computed, onBeforeUnmount, watch } from 'vue';
import { useCart, type CartLine } from '@/cart/useCart';
import { resolveCartLineImage, type CartLineImage } from '@/cart/cartLineImage';
import { useCartDrawer } from '@/composables/useCartDrawer';
import { useScrollLock } from '@/composables/useScrollLock';
import { formatMoney } from '@/common/money';
import { pastelFor } from '@/common/pastel';
import { BRAND } from '@/config';
import SmartLink from '@/components/SmartLink.vue';

/**
 * 询价清单抽屉（购物车抽屉）。
 *
 * 契约保持：「去提交询价」直接指向 `/checkout`（不经过 `/inquiry` 重定向）。
 * 品牌兜底图来自品牌配置；文案中不含任何支付语义。
 */

const { lines, subtotal, totalQuantity, setQuantity, removeLine } = useCart();
const { open, closeDrawer } = useCartDrawer();

/**
 * 购物车行 + 展示用图片。
 *
 * 图片解析规则见 `cart/cartLineImage.ts`（与购物车页共用，保证两处同一张图）。
 */
interface CartLineView {
  line: CartLine;
  image: CartLineImage | null;
}

const linesWithImage = computed<CartLineView[]>(() =>
  lines.value.map((line) => ({ line, image: resolveCartLineImage(line) })),
);

const currency = computed(() => lines.value[0]?.currency ?? 'CNY');
const subtotalText = computed(() => formatMoney(subtotal.value, currency.value));

function lineTotal(unitPrice: string, quantity: number): string {
  return formatMoney(String(Number(unitPrice) * quantity), currency.value);
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && open.value) closeDrawer();
}

/*
 * 背景滚动锁交给共享的 `useScrollLock()`。
 *
 * ⚠️ 原先这里直接写 `document.body.style.overflow = value ? 'hidden' : ''`。
 *    移动端菜单（`AppHeader`）也要锁同一个属性 —— 两处各自写 / 清，
 *    在「抽屉与菜单同时打开」时先关掉的那个会把 body 解锁，另一个还开着
 *    背景却能滚动。改用带引用计数的共享锁即可避免互相踩踏。
 */
useScrollLock(open);

watch(open, (value) => {
  if (value) {
    window.addEventListener('keydown', onKeydown);
  } else {
    window.removeEventListener('keydown', onKeydown);
  }
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown);
});
</script>

<template>
  <div class="scrim" :class="{ show: open }" @click="closeDrawer"></div>

  <aside
    class="drawer"
    :class="{ show: open }"
    role="dialog"
    aria-modal="true"
    aria-label="询价清单"
    :aria-hidden="!open"
  >
    <div class="drawer-head">
      <div class="drawer-title">
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M5 8h14l-1.2 12.5H6.2L5 8z" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round" />
          <path d="M9 8V6.4a3 3 0 016 0V8" stroke="currentColor" stroke-width="1.9" />
        </svg>
        询价清单
        <span v-if="totalQuantity > 0" class="drawer-count">{{ totalQuantity }}</span>
      </div>
      <button type="button" class="drawer-close icon-btn" aria-label="关闭询价清单" @click="closeDrawer">
        <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M2 2l12 12M14 2L2 14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
        </svg>
      </button>
    </div>

    <div class="drawer-body">
      <div v-if="lines.length === 0" class="empty">
        <div class="empty-ic">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M5 8h14l-1.2 12.5H6.2L5 8z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" />
          </svg>
        </div>
        询价清单还是空的
        <p class="empty__hint">去挑几件喜欢的商品，加入后即可提交询价。</p>
      </div>

      <div v-for="item in linesWithImage" v-else :key="item.line.productId" class="ci">
        <div class="ci-ph" :style="{ background: pastelFor(item.line.slug) }">
          <img v-if="item.image" :src="item.image.url" :alt="item.image.alt" />
          <img v-else class="ci-ph-mark" :src="BRAND.brandLogo" alt="" aria-hidden="true" />
        </div>
        <div class="ci-main">
          <SmartLink
            :to="{ name: 'product-detail', params: { slug: item.line.slug } }"
            class="ci-name"
            @click="closeDrawer"
          >
            {{ item.line.name }}
          </SmartLink>
          <div class="ci-price">单价 {{ formatMoney(item.line.unitPrice, item.line.currency) }}</div>
          <div class="ci-ctrl">
            <div class="qty">
              <button
                type="button"
                :aria-label="`减少 ${item.line.name} 的数量`"
                @click="setQuantity(item.line.productId, item.line.quantity - 1)"
              >
                <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
                  <path d="M2 6h8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
                </svg>
              </button>
              <span>{{ item.line.quantity }}</span>
              <button
                type="button"
                :aria-label="`增加 ${item.line.name} 的数量`"
                @click="setQuantity(item.line.productId, item.line.quantity + 1)"
              >
                <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
                  <path d="M6 2v8M2 6h8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
                </svg>
              </button>
            </div>
            <span class="ci-line-total">{{ lineTotal(item.line.unitPrice, item.line.quantity) }}</span>
            <button
              type="button"
              class="ci-del"
              :aria-label="`从询价清单移除 ${item.line.name}`"
              @click="removeLine(item.line.productId)"
            >
              删除
            </button>
          </div>
        </div>
      </div>
    </div>

    <div v-if="lines.length > 0" class="drawer-foot">
      <div class="sum-row"><span>商品小计</span><span>{{ subtotalText }}</span></div>
      <div class="sum-row">
        <span>运费</span>
        <span class="sum-row__note">客服按收货地址核算后报价</span>
      </div>
      <div class="sum-row total">
        <span>商品合计</span>
        <span>{{ subtotalText }}<small class="sum-row__suffix"> + 运费</small></span>
      </div>

      <SmartLink :to="{ name: 'checkout' }" class="btn btn--primary btn--block" @click="closeDrawer">
        去提交询价
      </SmartLink>
      <SmartLink
        :to="{ name: 'cart' }"
        class="btn btn--ghost btn--block"
        style="margin-top: 10px"
        @click="closeDrawer"
      >
        查看完整清单
      </SmartLink>
      <p class="foot-hint">
        本站为询价制：提交后由客服核实库存与运费并报价，不直接在线支付。
      </p>
    </div>
  </aside>
</template>

<style scoped>
.empty__hint {
  margin: 0.35rem 0 0;
  font-size: var(--fs-xs);
  color: var(--ink-3);
}

/*
 * 下面两条原先写成模板上的内联 `style="…"` ——
 * 内联样式优先级最高、且无法被主题 / 令牌统一调整，
 * 属设计令牌体系里的漂移点。改成 class + 令牌。
 */
.sum-row__note {
  color: var(--ink-3);
}

.sum-row__suffix {
  font-size: var(--fs-xs);
  font-weight: 500;
  color: var(--ink-3);
}
</style>
