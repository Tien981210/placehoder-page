<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { formatMoney } from '@/common/money';
import SmartLink from '@/components/SmartLink.vue';
import { BRAND, brandFileSlug, brandWhatsAppUrl } from '@/config';
import { buildCredentialFileText, copyText, downloadTextFile } from '@/inquiry/credentials';
import { lastSubmitResult } from '@/inquiry/session';
import {
  WHATSAPP_MANUAL_SEND_NOTICE,
  WHATSAPP_OPEN_HINT,
  buildWhatsAppCopyText,
  buildWhatsAppUrl,
  formatInternationalPhone,
  isUsableWhatsAppNumber,
  openWhatsApp,
} from '@/inquiry/whatsapp';

/**
 * 询价提交结果页。
 *
 * 关键约束：
 *   - 访问凭证**只在提交响应中出现一次**，服务端只保存哈希，无法再次回显；
 *     因此本页必须醒目地引导用户立即保存。
 *   - 邮件状态如实呈现：传输层未配置真实发送能力时，明确说明「未发出任何邮件」，
 *     绝不显示成「已发送」。
 *
 * G6 增补（WhatsApp 渠道）：
 *   - 服务端只返回「消息已生成 / 链接已构造」，本页只呈现
 *     「内容已生成」→「已发起打开动作」两档状态，**绝不**呈现「已发送 / 已送达」；
 *   - 未解析到联系人时明确提示，并保留可复制、可恢复的询盘内容；
 *   - 唤起失败（含弹窗拦截）时保留消息正文，提供「复制消息」与「兜底链接」两条备用路径。
 *
 * G6-2.2-WA-R3 现行契约（唤起机制，本次改造**未**改动）：
 *   - 「打开 WhatsApp」按钮在用户点击手势内**同步**导航到 `whatsapp://` 自定义协议：
 *     装了 App 就唤起 App，没装就被静默忽略 —— 两种情况都**不新开窗口、不离开本页**；
 *   - 号码缺失或为占位号码时**阻止跳转**并给出配置提示（不把询盘发到未确认的号码）；
 *
 * ⚠️ 残留风险（已知，未在本轮修改）：
 *   本页承载**只在响应中出现一次**的访问凭证。下方「用网页版打开」兜底链接按既有
 *   契约**不带** `target="_blank"`（同标签导航），因此点击它会离开本页、导致凭证无法再查看。
 *   已在链接旁显式提示「先保存凭证」。若要彻底消除该风险，应把该链接改为新标签打开
 *   （需同步调整 `InquiryResultPage.spec.ts` 中 `fallback.attributes('target')` 的断言）。
 */
const route = useRoute();
const result = lastSubmitResult;

/** 刷新页面后内存中的结果会丢失，此时退化为「用订单号 + 凭证自查」引导。 */
const routeOrderNo = computed(() =>
  typeof route.params.inquiryNo === 'string' ? route.params.inquiryNo : '',
);

const copyState = ref<'idle' | 'ok' | 'fail'>('idle');
const downloadState = ref<'idle' | 'ok'>('idle');

const credentialText = computed(() => (result.value ? result.value.accessToken : ''));

/**
 * 无结果态可以给出的联系方式 —— **只列实际配置了的渠道**。
 *
 * ⚠️ 此前这段文案固定写「请通过邮件或 WhatsApp 联系客服」，
 *    但 `brandEmail` 是空串（邮箱入口全站已隐藏，页头/页脚都不渲染），
 *    顾客照着这句话去找邮箱是找不到的；而 WhatsApp 入口是真实存在的。
 *    → 联系方式文案必须由配置驱动，不能写死。
 */
const supportWhatsAppUrl = computed(() =>
  brandWhatsAppUrl('你好，我想查询一笔询价单的进度。'),
);

/* ------------------------------ G6：渠道与地址 ------------------------------ */

const CHANNEL_LABELS: Record<string, string> = {
  EMAIL: '邮件',
  WHATSAPP: 'WhatsApp',
};

const channelLabel = computed(() =>
  result.value ? (CHANNEL_LABELS[result.value.channel] ?? result.value.channel) : '',
);

/** 服务端返回的 WhatsApp 预览（仅 WhatsApp 渠道非 null）。 */
const whatsapp = computed(() => result.value?.whatsapp ?? null);

/**
 * 消息正文（**只读**，G6-2.7）。
 *
 * 按用户要求**去掉可编辑输入框** —— 内容完全由服务端生成，顾客不再在结果页
 * 修改消息，避免「改了一半就发出去」的歧义。想改写内容只能回结算页重新提交。
 */
const whatsappMessage = computed(() => whatsapp.value?.message ?? '');

/**
 * 可唤起的收件号码（G6-2.2-WA）。
 *
 * ⚠️ 必须**同时**满足两个条件才非空：
 *    1. 已解析到可用联系人（`available === true`）；
 *    2. 号码通过可用性校验（纯数字国际号码，且**不是**已知占位 / 测试号码）。
 *    任一不满足 ⇒ 一律为空 ⇒ 唤起按钮禁用、链接不生成 —— 宁可不让跳转，
 *    也绝不把询盘发到一个错误或未确认的号码上。
 */
const whatsappPhone = computed(() => {
  const phone = whatsapp.value?.phoneNumber ?? null;
  if (!whatsapp.value?.available || !isUsableWhatsAppNumber(phone)) return null;
  return phone;
});

/**
 * 唤起链接。
 *
 * 使用本地 `buildWhatsAppUrl` 重新拼装（而不是直接用服务端返回的 url），
 * 两者对同一输入必然等价；G6-2.7 起消息只读，链接不再随编辑变化。
 */
const whatsappUrl = computed(() => {
  const phone = whatsappPhone.value;
  return phone ? buildWhatsAppUrl(phone, whatsappMessage.value) : null;
});

/**
 * 号码不可用（缺失或仍是占位 / 测试号码）时的**配置提示**。
 *
 * 与「没有联系人」（走 `contactNotice`，卡片整块不渲染）区分开：
 * 这里是「解析到了联系人，但号码不可用」——卡片仍在，必须明确说明
 * 为什么不能跳转，并给出复制消息这条备用路径。
 */
const whatsappConfigNotice = computed(() => {
  if (result.value?.channel !== 'WHATSAPP') return null;
  if (!whatsapp.value?.available) return null; // 无联系人 ⇒ 交给 contactNotice
  if (whatsappPhone.value) return null; // 号码可用 ⇒ 正常唤起
  return (
    '当前 WhatsApp 客服号码不可用（未配置或仍是未确认的测试号码），已阻止跳转以避免把询盘发到错误对象。' +
    '请联系管理员在后台「联系方式配置」中补全真实号码；在此之前，可先用下方「复制消息」通过其他方式联系客服。'
  );
});

/** `idle` = 尚未尝试；`attempted` = 已发起打开动作；`blocked` = 被浏览器拦截。 */
const openState = ref<'idle' | 'attempted' | 'blocked'>('idle');
const messageCopyState = ref<'idle' | 'ok' | 'fail'>('idle');

/** 联系人解析提示 —— 未解析到联系人时必须明确告知，且强调询盘已保存。 */
const contactNotice = computed(() => {
  if (!result.value) return null;
  const resolution = result.value.contactResolution;
  if (resolution.resolved) {
    const owner = resolution.contactOwnerName ?? '客服';
    const label = resolution.businessTypeLabel ? `（${resolution.businessTypeLabel}）` : '';
    return {
      tone: 'info' as const,
      text: `已按业务类型与渠道为你分配联系人：${owner}${label}。`,
    };
  }
  // G6-2.2：WhatsApp 消息区块**只在确有可用联系人时**渲染（见模板 `v-if`），
  // 所以「请使用下方复制消息」这句仅在区块存在时才成立；
  // 没有联系人时区块整块不展示，必须换成通用跟进说明，避免指向一个不存在的按钮。
  const hasWhatsappBlock = result.value.channel === 'WHATSAPP' && whatsapp.value?.available === true;
  return {
    tone: 'warn' as const,
    text:
      `当前没有可用的${channelLabel.value}联系人，系统未能自动分配。` +
      `你的询盘已经保存（订单号 ${result.value.orderNo}），内容不会丢失 —— ` +
      (hasWhatsappBlock
        ? '请使用下方「复制消息」自行联系客服，客服也会在后台看到这张询盘单。'
        : '客服会在后台看到这张询盘单并跟进。'),
  };
});

/** 唤起结果文案 —— 只描述「已发起打开动作」，绝不描述「已发送」。 */
const openNotice = computed(() => {
  if (openState.value === 'attempted') {
    return {
      tone: 'info' as const,
      text:
        '已发起打开 WhatsApp App 的动作（不新开窗口、不离开本页面）。' +
        '若设备上未安装 WhatsApp，点击不会有任何反应 —— 请改用「复制消息」或下方「用网页版打开」。' +
        '系统无法确认你是否发出了消息。',
    };
  }
  if (openState.value === 'blocked') {
    return {
      tone: 'warn' as const,
      text: '打开动作未能发起。请改用下方「复制消息」后手动发送，或点击下方「用网页版打开」。',
    };
  }
  return null;
});

/**
 * 打开 WhatsApp。
 *
 * ⚠️ **同步**执行：`openWhatsApp` 必须在点击处理函数里直接调用，
 *    中间不能有任何 `await` / 定时器 —— 否则会被浏览器判定为「非用户手势」，
 *    在部分浏览器（尤其移动端）上会拒绝导航。本函数刻意写成同步的 `void` 函数。
 *
 * G6-2.2-WA-R3：`openWhatsApp` 为**当前标签内导航**（不新开窗口、不跳转网页）。
 */
function onOpenWhatsApp(): void {
  const phoneNumber = whatsappPhone.value;
  if (!phoneNumber) return;
  const outcome = openWhatsApp(phoneNumber, whatsappMessage.value);
  openState.value = outcome.attempted ? 'attempted' : 'blocked';
}

async function onCopyWhatsAppMessage(): Promise<void> {
  const preview = whatsapp.value;
  if (!result.value || !preview) return;
  const ok = await copyText(
    buildWhatsAppCopyText({ ...preview, message: whatsappMessage.value }, result.value.orderNo),
  );
  messageCopyState.value = ok ? 'ok' : 'fail';
}

/* ---------------------- G6-2.7：自动弹出的确认框 ---------------------- */

/**
 * 确认框状态。
 *
 * 用户要求「提交后自动弹确认框，确认将会打开 WhatsApp」。
 *
 * ⚠️ 为什么在**结果页**弹、而不是在结算页点「提交询价」时弹：
 *    浏览器只认「用户手势内发起的导航」。在结果页弹出确认框后，
 *    用户点「确认」这一下**本身就是用户手势** ⇒ 导航必然被允许。
 *    若在结算页弹，确认后还要先 `await` 提交、再跳转，手势早已失效，
 *    自动唤起会被浏览器拒绝。
 */
const confirmOpen = ref(false);
/** 一旦用户处理过确认框（确认或稍后再说），本次会话不再自动弹。 */
const confirmHandled = ref(false);

watch(
  [() => whatsapp.value?.available === true, whatsappPhone],
  ([available, phone]) => {
    if (available && phone && !confirmHandled.value) {
      confirmOpen.value = true;
    }
  },
  { immediate: true },
);

/** 确认打开 —— 同步调用，正处于点击手势内。 */
function onConfirmOpenWhatsApp(): void {
  confirmOpen.value = false;
  confirmHandled.value = true;
  onOpenWhatsApp();
}

/** 稍后再说 —— 保留卡片上的「打开 WhatsApp」按钮作为手动入口。 */
function onDismissConfirm(): void {
  confirmOpen.value = false;
  confirmHandled.value = true;
}

const expiresText = computed(() => {
  if (!result.value) return '';
  const date = new Date(result.value.accessExpiresAt);
  return Number.isNaN(date.getTime()) ? result.value.accessExpiresAt : date.toLocaleString();
});

const submittedText = computed(() => {
  if (!result.value) return '';
  const date = new Date(result.value.submittedAt);
  return Number.isNaN(date.getTime()) ? result.value.submittedAt : date.toLocaleString();
});

/** 邮件投递状态文案 —— 只说「已排入队列」，不说「已发送」。 */
const emailNotice = computed(() => {
  const delivery = result.value?.emailDelivery;
  if (!delivery) return null;
  if (!delivery.transportConfigured) {
    return {
      tone: 'warn' as const,
      text: '真实邮件发送尚未启用（当前邮件传输层为占位实现）：系统未发出任何邮件。请立即用下方按钮保存订单号与访问凭证。',
    };
  }
  if (delivery.queued > 0) {
    return {
      tone: 'info' as const,
      text: `确认邮件已排入发送队列（${delivery.queued} 封），将由后台任务投递；投递失败会自动重试，且不会影响本询价单的保存。`,
    };
  }
  return { tone: 'info' as const, text: '本次没有需要发送的邮件。' };
});

async function onCopy(): Promise<void> {
  if (!result.value) return;
  const ok = await copyText(buildCredentialFileText(result.value));
  copyState.value = ok ? 'ok' : 'fail';
}

function onDownload(): void {
  if (!result.value) return;
  downloadTextFile(
    `${brandFileSlug()}-inquiry-${result.value.orderNo}.txt`,
    buildCredentialFileText(result.value),
  );
  downloadState.value = 'ok';
}
</script>

<template>
  <div class="page container">
    <header class="page__header">
      <p class="overline">{{ BRAND.brandName }}</p>
      <h1 class="page__title">询价提交结果</h1>
      <!--
        ⚠️ 这句只在**确有提交结果**时渲染。
           此前无条件渲染，导致「本次没有可展示的提交结果」的页面顶部
           却在让用户「先保存访问凭证」—— 同一屏自相矛盾。
      -->
      <p v-if="result" class="page__subtitle">
        本页信息只保存在当前页面的内存中，请先保存访问凭证，再离开本页。
      </p>
      <p v-else class="page__subtitle">
        提交结果仅在提交成功后的这一次跳转中可查看，刷新或重新打开本页后会失效。
      </p>
    </header>

    <div v-if="result" class="panel">
      <p class="result__banner" role="status">
        <strong>提交成功。</strong>本单<strong>不会自动扣减库存</strong>，也<strong>未产生任何付款</strong>；
        客服将核实库存与运费后回复报价。
      </p>

      <dl class="result__grid">
        <div>
          <dt>订单号</dt>
          <dd class="result__no">{{ result.orderNo }}</dd>
        </div>
        <div>
          <dt>提交时间</dt>
          <dd>{{ submittedText }}</dd>
        </div>
        <div>
          <dt>商品项数</dt>
          <dd>{{ result.itemCount }} 项</dd>
        </div>
        <div>
          <dt>商品小计（服务端核验）</dt>
          <dd>{{ formatMoney(result.submittedSubtotal, result.currency) }}</dd>
        </div>
        <div>
          <dt>询盘方式</dt>
          <dd>{{ channelLabel }}</dd>
        </div>
        <div v-if="result.businessType">
          <dt>业务类型</dt>
          <dd>{{ result.businessType.label }}</dd>
        </div>
        <div v-if="result.country || result.city || result.postalCode">
          <dt>国家 / 城市 / 邮编</dt>
          <dd>{{ [result.country, result.city, result.postalCode].filter(Boolean).join(' · ') }}</dd>
        </div>
      </dl>

      <section class="credential" aria-labelledby="credential-title">
        <h2 id="credential-title" class="credential__title">访问凭证（请立即保存）</h2>
        <p class="credential__hint">
          查询订单进度时必须同时提供<strong>订单号</strong>与<strong>访问凭证</strong>。
          凭证仅显示这一次，服务端只保存其哈希，<strong>关闭或刷新页面后无法再次查看</strong>。
        </p>
        <code class="credential__value">{{ credentialText }}</code>
        <p class="credential__expiry">凭证有效期至：{{ expiresText }}</p>

        <div class="row">
          <button type="button" class="btn btn--primary" @click="onCopy">
            {{ copyState === 'ok' ? '已复制' : '复制订单号与凭证' }}
          </button>
          <button type="button" class="btn btn--ghost" @click="onDownload">
            {{ downloadState === 'ok' ? '已下载' : '下载为 txt 文件' }}
          </button>
        </div>
        <p v-if="copyState === 'fail'" class="form-field__error" role="alert">
          复制失败：请手动选中上方凭证文本复制，或改用「下载为 txt 文件」。
        </p>
        <p class="subtle">请勿把凭证转发给他人或公开发布 —— 它等同于取件凭据。</p>
      </section>

      <p
        v-if="emailNotice"
        class="notice"
        :class="emailNotice.tone === 'warn' ? 'notice--warn' : 'notice--info'"
        role="status"
      >
        {{ emailNotice.text }}
      </p>

      <p
        v-if="contactNotice"
        class="notice"
        :class="contactNotice.tone === 'warn' ? 'notice--warn' : 'notice--info'"
        role="status"
      >
        {{ contactNotice.text }}
      </p>

      <!--
        G6：WhatsApp 唤起区块。
        G6-2.2：**仅在有可用 WhatsApp 联系人时**渲染 ——
        没有联系人时整块不展示（顾客也不会在结算页选到 WhatsApp 渠道，
        此处是配置在提交后发生变化等边界情况的双保险）。
      -->
      <section v-if="whatsapp && whatsapp.available" class="whatsapp" aria-labelledby="whatsapp-title">
        <h2 id="whatsapp-title" class="whatsapp__title">WhatsApp 询盘消息</h2>

        <p class="whatsapp__status" role="status">
          <strong>状态：消息内容已生成。</strong>
          <template v-if="openState === 'attempted'">链接已发起打开。</template>
          <template v-else-if="openState === 'blocked'">打开动作被浏览器拦截。</template>
          <template v-else>尚未尝试打开。</template>
          <span class="muted">（本链接不会自动发送消息，需你手动发送）</span>
        </p>

        <!--
          G6-2.2-WA：联系人解析成功、但号码不可用（缺失 / 占位号码）时，
          必须明确阻止跳转并说明原因，而不是给一个点了没反应的按钮。
        -->
        <p v-if="whatsappConfigNotice" class="notice notice--warn" role="alert">
          {{ whatsappConfigNotice }}
        </p>

        <p v-if="whatsapp.truncated" class="notice notice--warn" role="status">
          消息过长，已省略 {{ whatsapp.omittedItems }} 项商品（共 {{ whatsapp.totalItems }} 项）。
          完整清单以本询盘单（{{ result.orderNo }}）为准，可在下方自行补全。
        </p>

        <div class="whatsapp__number">
          <span class="whatsapp__number-label">收件号码</span>
          <code v-if="whatsappPhone">{{ formatInternationalPhone(whatsappPhone) }}</code>
          <span v-else class="muted">不可用（未配置或未确认的号码）</span>
        </div>

        <div class="form-field">
          <span class="form-field__label">消息内容（已由系统生成，只读）</span>
          <pre id="whatsapp-message" class="whatsapp__preview">{{ whatsappMessage }}</pre>
        </div>

        <div class="row">
          <button
            id="whatsapp-open"
            type="button"
            class="btn btn--primary"
            :disabled="!whatsappUrl"
            @click="onOpenWhatsApp"
          >
            {{ openState === 'idle' ? '打开 WhatsApp' : '重新打开 WhatsApp' }}
          </button>
          <button type="button" class="btn btn--ghost" @click="onCopyWhatsAppMessage">
            {{ messageCopyState === 'ok' ? '已复制消息' : '复制消息' }}
          </button>
        </div>

        <p v-if="openNotice" class="notice" :class="openNotice.tone === 'warn' ? 'notice--warn' : 'notice--info'" role="status">
          {{ openNotice.text }}
        </p>
        <!--
          G6-2.2-WA-R3：「纯打开 App」方案的必然代价 —— 设备未安装 WhatsApp 时，
          导航 `whatsapp://` 会被系统静默忽略（表现为「点了没反应」）。
          因此这里**始终**给出一条**用户主动点击**才生效的网页版出路
          （同标签，不开新窗口）。本模块**不会**自动回退到网页版 ——
          自动回退就是「跳转页面」，正是本次要避免的行为。
        -->
        <p v-if="whatsappUrl" class="form-field__hint">
          点了没反应？（设备未安装 WhatsApp 时会出现）改用
          <a :href="whatsappUrl" rel="noopener noreferrer">用网页版打开</a>。
          <strong>该链接会在当前标签页打开，请先保存上方访问凭证再点击</strong>
          （凭证只显示这一次，离开本页后无法再查看）。
        </p>
        <p v-if="messageCopyState === 'fail'" class="form-field__error" role="alert">
          复制失败：请手动选中上方消息文本复制。
        </p>

        <p class="subtle">{{ WHATSAPP_OPEN_HINT }}</p>
        <p class="subtle">{{ WHATSAPP_MANUAL_SEND_NOTICE }}</p>
      </section>

      <div class="row">
        <SmartLink :to="{ name: 'products' }" class="btn btn--primary">继续浏览商品</SmartLink>
      </div>
    </div>

    <div v-else class="panel">
      <p class="notice notice--warn" role="status">
        <strong>本次没有可展示的提交结果。</strong>
        提交结果只保存在当前页面的内存中，刷新或重新打开页面后即失效。
      </p>
      <p v-if="routeOrderNo" class="muted">
        链接中的询价单号：<strong>{{ routeOrderNo }}</strong>
      </p>
      <p v-if="routeOrderNo" class="muted">
        如需查询进度，请提供该单号联系客服<span v-if="supportWhatsAppUrl">（可通过
          <a :href="supportWhatsAppUrl" target="_blank" rel="noopener noreferrer">WhatsApp</a> 联系我们）</span>。
      </p>
      <div class="row">
        <SmartLink :to="{ name: 'home' }" class="btn btn--primary">返回首页</SmartLink>
        <SmartLink :to="{ name: 'products' }" class="btn btn--ghost">继续浏览商品</SmartLink>
      </div>
    </div>

    <!--
      G6-2.7：自动弹出的「即将打开 WhatsApp」确认框。
      只在确有可用号码时出现；点「确认」时正处于用户手势内 ⇒ 打开动作不会被拦截。
    -->
    <div
      v-if="confirmOpen"
      class="wa-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="wa-confirm-title"
    >
      <div class="wa-modal__box">
        <h2 id="wa-confirm-title" class="wa-modal__title">即将打开 WhatsApp</h2>
        <p class="wa-modal__text">
          确认后将<strong>直接打开 WhatsApp App</strong>（不会新开窗口，也不会离开本页面），
          并把本次询盘消息<strong>预填</strong>到 WhatsApp 的输入框。
          消息<strong>不会自动发送</strong>，需要你在 WhatsApp 中手动点击发送。
        </p>
        <p class="wa-modal__number">
          收件号码：
          <code>{{ whatsappPhone ? formatInternationalPhone(whatsappPhone) : '不可用' }}</code>
        </p>
        <div class="row">
          <button
            id="wa-confirm-open"
            type="button"
            class="btn btn--primary"
            @click="onConfirmOpenWhatsApp"
          >
            确认，打开 WhatsApp
          </button>
          <button
            id="wa-confirm-cancel"
            type="button"
            class="btn btn--ghost"
            @click="onDismissConfirm"
          >
            稍后再说
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.result__banner {
  margin: 0 0 1rem;
}

.result__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
  gap: 0.9rem 1.5rem;
  margin: 0 0 1.25rem;
}

.result__grid dt {
  font-size: var(--fs-sm);
  color: var(--ink-2);
}

.result__grid dd {
  margin: 0.15rem 0 0;
  font-weight: 600;
}

.result__no {
  font-family: var(--font-mono);
  letter-spacing: 0.04em;
}

.credential {
  border: 1px solid var(--line-2);
  border-radius: var(--r-sm);
  padding: 1rem;
  margin: 0 0 1rem;
  background: var(--brand-50);
}

.credential__title {
  margin: 0 0 0.4rem;
  font-size: var(--fs-lg);
}

.credential__hint {
  margin: 0 0 0.6rem;
  font-size: var(--fs-sm);
}

.credential__value {
  display: block;
  word-break: break-all;
  padding: 0.6rem 0.7rem;
  border-radius: var(--r-sm);
  background: var(--surface);
  border: 1px dashed var(--line-2);
  font-family: var(--font-mono);
  font-size: var(--fs-base);
  margin-bottom: 0.5rem;
}

.credential__expiry {
  margin: 0 0 0.75rem;
  font-size: var(--fs-sm);
  color: var(--ink-2);
}

/* --------------------------- G6：WhatsApp 区块 --------------------------- */

.whatsapp {
  border: 1px solid var(--line-2);
  border-radius: var(--r-sm);
  padding: 1rem;
  margin: 0 0 1rem;
  background: var(--surface-2);
}

.whatsapp__title {
  margin: 0 0 0.4rem;
  font-size: var(--fs-lg);
}

.whatsapp__status {
  margin: 0 0 0.6rem;
  font-size: var(--fs-base);
}

.whatsapp__number {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  margin-bottom: 0.6rem;
}

.whatsapp__number-label {
  font-size: var(--fs-sm);
  color: var(--ink-3);
}

.whatsapp__number code {
  font-family: var(--font-mono);
  font-size: var(--fs-base);
}

/* G6-2.7：消息改为只读展示（原 textarea 已移除）。 */
.whatsapp__preview {
  margin: 0;
  padding: 0.7rem 0.8rem;
  border: 1px solid var(--line-2);
  border-radius: var(--r-sm);
  background: var(--surface);
  font-family: var(--font-mono);
  font-size: var(--fs-sm);
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 16rem;
  overflow: auto;
}

/* G6-2.7：「即将打开 WhatsApp」确认框。 */
.wa-modal {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  background: rgb(36 35 33 / 45%);
}

.wa-modal__box {
  width: min(30rem, 100%);
  padding: 1.25rem;
  border: 1px solid var(--line-2);
  border-radius: var(--r-sm);
  background: var(--surface);
  box-shadow: var(--shadow-lg);
}

.wa-modal__title {
  margin: 0 0 0.5rem;
  font-size: var(--fs-lg);
}

.wa-modal__text {
  margin: 0 0 0.5rem;
  font-size: var(--fs-base);
  line-height: 1.6;
}

.wa-modal__number {
  margin: 0 0 0.9rem;
  font-size: var(--fs-sm);
  color: var(--ink-3);
}
</style>
