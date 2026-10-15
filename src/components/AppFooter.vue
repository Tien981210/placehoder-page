<script setup lang="ts">
import { computed } from 'vue';
import {
  BRAND,
  CONTACT_MESSAGES,
  SITE_FEATURES,
  brandEmailAddress,
  brandMailtoUrl,
  brandWhatsAppDisplay,
  brandWhatsAppUrl,
} from '@/config';
import DemoDataBadge from '@/components/DemoDataBadge.vue';
import SmartLink from '@/components/SmartLink.vue';

/**
 * 页脚。
 *
 * 品牌名 / 版权 / 联系方式全部来自 `src/config/brand.ts` —— 本组件不写死任何品牌事实。
 *
 * ⚠️ 已移除的内容（原 P6 假交互 / 误导性暗示）：
 *   - VISA / Mastercard / PayPal / Apple Pay 支付渠道角标：
 *     本站是询价制、**没有在线支付**，展示支付渠道属于虚假暗示；
 *   - 「新页面在新标签页打开」开关：属于内部调试入口，不应出现在消费者站点；
 *   - 「订阅新品」表单：原本就没有后端，只会提示「未接入」。
 *
 * 未配置的联系方式（邮箱 / 号码为空）**整块不渲染**，不留死链。
 */

const year = new Date().getFullYear();

const whatsappUrl = computed(() => brandWhatsAppUrl(CONTACT_MESSAGES.footerGreeting));
const whatsappDisplay = computed(() => brandWhatsAppDisplay());
const mailtoUrl = computed(() => brandMailtoUrl());
const emailAddress = computed(() => brandEmailAddress());
</script>

<template>
  <footer class="footer">
    <div class="wrap">
      <div class="foot-grid">
        <div>
          <div class="foot-brand">
            <img class="foot-brand__mark" :src="BRAND.brandLogo" alt="" width="26" height="26" />
            <span class="foot-brand__name">{{ BRAND.brandName }}</span>
          </div>
          <p class="foot-tagline">{{ BRAND.brandTagline }}</p>
          <p class="foot-note" style="margin-top: var(--sp-3)">
            本站为询价制：提交询价后由客服核实库存与运费并回复报价，不直接在线支付。
          </p>
        </div>

        <nav aria-label="选购入口">
          <div class="foot-h">选购</div>
          <div class="foot-l">
            <SmartLink :to="{ name: 'home' }">首页</SmartLink>
            <SmartLink :to="{ name: 'products' }">全部商品</SmartLink>
            <SmartLink :to="{ name: 'categories' }">商品分类</SmartLink>
            <SmartLink v-if="SITE_FEATURES.articles" :to="{ name: 'articles' }">文章</SmartLink>
          </div>
        </nav>

        <nav aria-label="询价入口">
          <div class="foot-h">询价</div>
          <div class="foot-l">
            <SmartLink :to="{ name: 'cart' }">询价清单</SmartLink>
            <SmartLink :to="{ name: 'checkout' }">提交询价</SmartLink>
            <SmartLink :to="{ name: 'products' }">继续挑选商品</SmartLink>
          </div>
        </nav>

        <div>
          <div class="foot-h">联系我们</div>
          <div class="foot-l">
            <a
              v-if="whatsappUrl"
              :href="whatsappUrl"
              target="_blank"
              rel="noopener noreferrer"
            >
              WhatsApp 联系我们<span aria-hidden="true"> ↗</span>
            </a>
            <span v-if="whatsappDisplay" class="foot-phone">客服号码：{{ whatsappDisplay }}</span>

            <a v-if="mailtoUrl" :href="mailtoUrl">{{ emailAddress }}</a>

            <span v-if="!whatsappUrl && !mailtoUrl" class="foot-note">
              客服联系方式尚未配置，请在商品页提交询价，我们会尽快回复。
            </span>
          </div>

          <div v-if="BRAND.brandSocialLinks.length > 0" class="foot-l" style="margin-top: var(--sp-4)">
            <a
              v-for="link in BRAND.brandSocialLinks"
              :key="link.href"
              :href="link.href"
              target="_blank"
              rel="noopener noreferrer"
            >
              {{ link.label }}<span aria-hidden="true"> ↗</span>
            </a>
          </div>
        </div>
      </div>

      <div class="foot-bottom">
        <div class="foot-utils">
          <DemoDataBadge />
          <span class="foot-hint">询价制独立站 · 无在线支付</span>
        </div>

        <div class="copy">© {{ year }} {{ BRAND.brandCopyright }}</div>
      </div>
    </div>
  </footer>
</template>
