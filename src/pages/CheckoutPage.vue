<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { fetchContactCatalog, submitInquiry } from '@/api/client';
import { ApiError } from '@/api/http';
import type {
  InquiryChannel,
  InquirySubmitRequest,
  PublicChannelCatalogView,
  UnavailableProductRef,
} from '@/api/types';
import { useCart } from '@/cart/useCart';
import { formatMoney } from '@/common/money';
import { BRAND } from '@/config';
import SmartLink from '@/components/SmartLink.vue';
import StateEmpty from '@/components/StateEmpty.vue';
import { describeSubmitError, extractUnavailableProducts } from '@/inquiry/apiErrors';
import { acquireIdempotencyKey, hasPendingKey, releaseIdempotencyKey, submitFingerprint } from '@/inquiry/idempotency';
import { setLastSubmitResult } from '@/inquiry/session';
import { unavailableReasonLabel } from '@/inquiry/statusLabels';
import { openWhatsApp } from '@/inquiry/whatsapp';

/**
 * 结算页（/checkout）—— 阶段 8。
 *
 * 与 /inquiry 的区别（**唯一**区别）：
 *   本页感知登录状态：
 *     1. 登录用户自动预填邮箱 / 联系人（仍可修改）；
 *     2. 提交时附带顾客令牌，服务端把询价单**归属到该账户**，
 *        成功后直接进入 /account/inquiries 查看；
 *     3. 游客提交则与阶段 4 完全一致 —— 成功后进入结果页，
 *        由用户自行保存一次性访问凭证。
 *
 * 三条硬约束（与 /inquiry 相同，不得放宽）：
 *   1. 只提交 { productId, quantity }，商品信息由服务端重读并写快照；
 *   2. 提交失败必须如实告知并可重试；重试复用同一幂等键，不会重复建单；
 *   3. 访问凭证只在提交响应中出现一次，绝不落 localStorage / URL。
 *
 * G6 增补（询盘渠道与地址）：
 *   4. 允许选择**邮件**或 **WhatsApp** 渠道；WhatsApp 渠道只生成预填消息与链接，
 *      **绝不**声称已自动发送（需用户在 WhatsApp 中手动发送）；
 *   5. （G6-2.6）**不再让顾客选择业务类型** —— 该下拉已移除。
 *      派单路由完全由服务端自动完成（通用客服 → 系统默认 → 系统任一）；
 *   6. 新增国家 / 地区、城市、邮政编码三个**可选**字段；
 *      邮编不做纯数字校验（不同国家格式不同），只校验长度与字符集。
 */
const router = useRouter();
const { lines, subtotal, removeLine, clear } = useCart();

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * 邮政编码校验（G6 功能五）。
 *
 * ⚠️ **刻意不做纯数字校验** —— 不同国家/地区的邮编可能含字母、空格与连字符
 *    （如 `SW1A 1AA`、`K1A 0B1`、`1234-567`）。
 *    规则与后端 `POSTAL_CODE_PATTERN` 保持一致：总长 2–24，首尾必须是字母或数字，
 *    中间允许字母/数字/空格/连字符；校验前只去首尾空格，**不改变内部格式**。
 */
const POSTAL_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 -]{0,22}[A-Za-z0-9]$/;

const COUNTRY_MAX = 80;
const CITY_MAX = 80;

/** 渠道选项 —— 与后端 `InquiryChannel` 枚举逐字对应（系统固定两种渠道）。 */
const CHANNEL_OPTIONS: Array<{ value: InquiryChannel; label: string; hint: string }> = [
  { value: 'EMAIL', label: '邮件询盘', hint: '提交后由客服通过邮箱回复报价' },
  {
    value: 'WHATSAPP',
    label: 'WhatsApp 询盘',
    // G6-2.7：按用户要求改成「将会打开 WhatsApp」的提示
    hint: '提交后将打开 WhatsApp，并预填本次询盘消息（不会自动发送）',
  },
];

/**
 * G6-2.7：**测试用** WhatsApp 唤起按钮的目标号码。
 *
 * ⚠️ 号码**不来自服务端** —— 公开目录刻意不下发客服号码（隐私不变量），
 *    因此测试按钮的号码只能来自构建期环境变量。
 *    **未配置时按钮不渲染** ⇒ 生产构建天然不会暴露这个测试入口。
 *
 * ⚠️ 刻意用 `computed` 惰性读取（而不是模块级常量）—— 便于单测用
 *    `vi.stubEnv` 覆盖，且构建期未配置时恒为空串。
 */
const whatsappTestNumber = computed(() =>
  (import.meta.env.VITE_WHATSAPP_TEST_NUMBER ?? '').trim(),
);

/** 测试消息 —— 明确标注为测试，避免被误当成真实询盘。 */
const WHATSAPP_TEST_MESSAGE = [
  `Hello ${BRAND.brandName} Team,`,
  '',
  'This is a TEST message from the website, used only to verify that WhatsApp opens correctly.',
].join('\n');

/**
 * 测试按钮处理函数。
 *
 * ⚠️ 与结果页一致：必须在**点击手势内同步**调用 `openWhatsApp`，
 *    中间不能有 `await` / 定时器，否则会被浏览器判定为非用户手势而拒绝导航。
 *
 * G6-2.2-WA-R3：`openWhatsApp` 为**纯打开 App**（导航 `whatsapp://`，不新开窗口、不跳转页面）。
 *    注意 —— 点测试按钮会离开结算页（浏览器「后退」可返回，询价清单内容不丢）。
 */
function onTestWhatsApp(): void {
  const phone = whatsappTestNumber.value;
  if (!phone) return;
  openWhatsApp(phone, WHATSAPP_TEST_MESSAGE);
}

const form = reactive({
  contactEmail: '',
  contactName: '',
  shippingAddress: '',
  note: '',
  // ---------------------------------------------------------------- G6
  channel: 'EMAIL' as InquiryChannel,
  country: '',
  city: '',
  postalCode: '',
});

/**
 * 公开渠道目录（`GET /contacts/business-types`）。
 *
 * ⚠️ G6-2.6：本页**只**用它的 `channels` 判断「是否展示 WhatsApp 渠道」。
 *    业务类型下拉已移除 —— 顾客不需要、也不应该关心内部派单路由，
 *    路由完全由服务端完成（通用客服 → 系统默认 → 系统任一）。
 *    目录加载失败时**不阻断提交**，只是收敛为仅邮件渠道并提示。
 */
const catalog = ref<PublicChannelCatalogView | null>(null);
const catalogError = ref<string | null>(null);

/**
 * 渠道选项。
 *
 * G6-2.2：**不再**在目录缺失时「放行两条硬编码渠道」——
 *   - 目录已加载 ⇒ 严格按服务端下发的可用渠道过滤（`catalog.channels`）；
 *   - 目录未加载 / 加载失败 ⇒ **只保留邮件渠道**。
 *
 * 为什么邮件渠道可以无条件保留：服务端保证 `channels` 恒含 `EMAIL`
 * —— 即便一条邮箱联系人也没配，询盘邮件也会兜底投递给**管理员账号邮箱**
 * （见后端 `InquiryService.adminNotifyEmail`），因此邮件询盘永远走得通。
 * 反之 WhatsApp 在没有可用联系人时**绝不展示**，避免顾客选了却落进死路。
 */
const channelOptions = computed(() => {
  const supported = catalog.value?.channels;
  if (!supported || supported.length === 0) {
    return CHANNEL_OPTIONS.filter((option) => option.value === 'EMAIL');
  }
  return CHANNEL_OPTIONS.filter((option) => supported.includes(option.value));
});

/**
 * 可用渠道收敛后，把**已失效**的选中项重置回邮件渠道。
 *
 * 典型场景：顾客已选中 WhatsApp，随后目录加载完成（或刷新后）发现
 * 没有任何可用 WhatsApp 联系人 ⇒ 必须同步纠正表单状态，
 * 绝不提交一个前台已经不再展示的渠道。
 */
watch(channelOptions, (options) => {
  if (!options.some((option) => option.value === form.channel)) {
    form.channel = 'EMAIL';
  }
});

onMounted(async () => {
  try {
    catalog.value = await fetchContactCatalog();
  } catch {
    catalog.value = null;
    catalogError.value = '渠道目录加载失败，已暂时只提供邮件询盘；可刷新重试。';
  }
});

const touched = ref(false);
const submitting = ref(false);
const submitError = ref<string | null>(null);
const unavailable = ref<UnavailableProductRef[]>([]);

/**
 * 幂等键：一次提交周期内保持不变，重试复用；
 * 一旦**提交载荷**（购物车或任一表单字段）变化就必须换新键
 * （否则服务端会当成同一单返回旧订单，顾客刚改的地址 / 邮箱被静默丢弃）。
 *
 * ⚠️ G6-3.0 任务 A：键由 `acquireIdempotencyKey()` 按指纹落 **localStorage**
 *    （而不是只放在组件 `ref` 或模块级变量里）—— 这样在「提交中」离开页面再回来、
 *    **刷新页面**、乃至**多标签页**同时操作时，重试仍会复用同一个键，
 *    服务端据此返回同一张单而不是再建一张。
 *    仅在**明确成功**（或 409 商品失效）时才 `releaseIdempotencyKey()` 换新键；
 *    「结果未知」的失败**刻意保留**键，以保证重试安全。
 *
 * ⚠️ G6-3.1 任务 C：指纹由「**仅购物车**」升级为「**整个提交载荷的隐私安全摘要**」——
 *    原先只按购物车绑定，导致「超时后修改地址 / 邮箱 / 备注再提交」会命中旧键，
 *    服务端 `replay()` **不比较载荷** ⇒ 静默返回旧单、丢弃顾客的新输入。
 *    现在载荷任一字段变化都会得到不同摘要 ⇒ 换新键 ⇒ 提交新内容。
 *
 * ⚠️ G6-3.1 任务 E：`releaseIdempotencyKey()` 现在**按指纹**释放（只作废本条记录），
 *    因此需要记住本次提交用的指纹；否则多标签页里其它仍未决的询价键会被一并清掉。
 */
const idempotencyKey = ref<string | null>(null);

/** 本次提交所用的载荷指纹（用于「只释放自己」）。 */
const pendingFingerprint = ref('');

/**
 * 是否有一笔**结果未知**的未决询价（G6-3.1 任务 E）。
 *
 * 判定依据：当前载荷指纹在本地**仍存在未过期**的待确认记录。
 * 该记录只在「提交明确成功」或「409 商品失效」时被释放，因此它存在 ⇔
 * 上一次用**完全相同的信息**提交过、但没拿到明确结果。
 *
 * 为什么需要它：刷新页面会丢掉 `submitError`，顾客看不到「结果未知」的提示，
 * 若顺手改一个字再提交 ⇒ 载荷变化 ⇒ 换新键 ⇒ **重复建单**。
 *
 * ⚠️ 页面内已有错误提示（`submitError`，其中已含「结果未知 / 重试安全」文案）时不再重复展示。
 */
const hasUnknownResult = computed(
  () =>
    !submitting.value &&
    submitError.value === null &&
    hasPendingKey(submitFingerprint(fingerprintInput.value)),
);

/**
 * 参与指纹的载荷字段（与 `onSubmit` 实际提交的字段保持一一对应）。
 *
 * ⚠️ 新增提交字段时**必须**同步加到这里，否则该字段的变化不会触发换键。
 */
const fingerprintInput = computed(() => ({
  lines: lines.value.map((line) => ({ productId: line.productId, quantity: line.quantity })),
  contactEmail: form.contactEmail,
  contactName: form.contactName,
  shippingAddress: form.shippingAddress,
  note: form.note,
  channel: form.channel,
  country: form.country,
  city: form.city,
  postalCode: form.postalCode,
}));

const currency = computed(() => lines.value[0]?.currency ?? 'USD');

const errors = computed(() => {
  const result: Record<string, string> = {};
  if (!EMAIL_PATTERN.test(form.contactEmail.trim())) {
    result.contactEmail = '请填写有效的联系邮箱，例如 name@example.com';
  }
  if (form.contactName.trim().length === 0) {
    result.contactName = '请填写联系人姓名';
  }
  if (form.shippingAddress.trim().length < 5) {
    result.shippingAddress = '请填写完整的收货地址（至少 5 个字符）';
  }
  if (form.country.trim().length > COUNTRY_MAX) {
    result.country = `国家 / 地区不超过 ${COUNTRY_MAX} 个字符`;
  }
  if (form.city.trim().length > CITY_MAX) {
    result.city = `城市不超过 ${CITY_MAX} 个字符`;
  }
  // 邮政编码为可选：留空即不校验；填写后只做「长度 + 字符集」校验，不强制纯数字。
  const postal = form.postalCode.trim();
  if (postal.length > 0 && !POSTAL_CODE_PATTERN.test(postal)) {
    result.postalCode = '请填写有效的邮政编码（2–24 个字符，可含字母、空格与连字符）';
  }
  if (lines.value.length === 0) {
    result.lines = '询价清单为空，请至少加入一件商品';
  }
  return result;
});

const isValid = computed(() => Object.keys(errors.value).length === 0);

function fieldError(key: string): string | undefined {
  return touched.value ? errors.value[key] : undefined;
}

function unavailableName(productId: string): string {
  return lines.value.find((line) => line.productId === productId)?.name ?? productId;
}

function removeUnavailable(): void {
  for (const item of unavailable.value) {
    removeLine(item.productId);
  }
  unavailable.value = [];
}

async function onSubmit(): Promise<void> {
  if (submitting.value) return;
  touched.value = true;
  submitError.value = null;
  unavailable.value = [];
  if (!isValid.value) return;

  // 先置 submitting 再算指纹 —— 指纹是同步纯函数，此处只为保持「进入提交态后
  // 不再接受重入」的单一顺序（守卫在最上方，连点不会产生并发提交）。
  submitting.value = true;
  try {
    pendingFingerprint.value = submitFingerprint(fingerprintInput.value);
    idempotencyKey.value = acquireIdempotencyKey(pendingFingerprint.value);

    const country = form.country.trim();
    const city = form.city.trim();
    const postalCode = form.postalCode.trim();

    /**
     * 可选字段只在**确有值**时才放进请求体。
     *
     * 原因：后端 `ValidationPipe` 开启了 `forbidNonWhitelisted`，
     * 且可空字段的校验条件是「显式传了值才校验」—— 传 `undefined` 与不传等价，
     * 但传空串会被当成「显式提供了空值」，语义不同，这里统一不发。
     */
    const payload: InquirySubmitRequest = {
      contactEmail: form.contactEmail.trim(),
      contactName: form.contactName.trim(),
      shippingAddress: form.shippingAddress.trim(),
      note: form.note.trim() || undefined,
      lines: lines.value.map((line) => ({ productId: line.productId, quantity: line.quantity })),
      idempotencyKey: idempotencyKey.value,
      channel: form.channel,
      // G6-2.6：**不再提交 `businessTypeKey`** —— 顾客不选择业务类型，由服务端自动派单。
      ...(country ? { country } : {}),
      ...(city ? { city } : {}),
      ...(postalCode ? { postalCode } : {}),
    };

    const result = await submitInquiry(payload);

    setLastSubmitResult(result);
    idempotencyKey.value = null;
    releaseIdempotencyKey(pendingFingerprint.value);
    pendingFingerprint.value = '';
    clear();

    // 临时站没有顾客账户 ⇒ 一律走游客路径：进入结果页，
    // 由用户自行保存一次性访问凭证。
    await router.push({ name: 'inquiry-result', params: { inquiryNo: result.orderNo } });
  } catch (error) {
    const blocked = extractUnavailableProducts(error);
    if (blocked.length > 0) {
      unavailable.value = blocked;
    }
    submitError.value = describeSubmitError(error);
    if (error instanceof ApiError && error.status === 409 && blocked.length > 0) {
      idempotencyKey.value = null;
      releaseIdempotencyKey(pendingFingerprint.value);
      pendingFingerprint.value = '';
    }
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="page container">
    <header class="page__header">
      <p class="overline">INQUIRY</p>
      <h1 class="page__title">提交询价</h1>
      <p class="page__subtitle">
        本站为<strong>询价制</strong>：确认商品与联系方式后提交询价，由客服核实库存与运费并回复报价。
        <strong>本页不涉及任何在线支付</strong>，提交后不会产生扣款。
      </p>
    </header>

    <StateEmpty
      v-if="lines.length === 0"
      title="询价清单为空"
      description="本页负责把询价清单一次性提交给客服，清单为空时没有内容可提交。请先到商品页挑选商品并加入清单，再回到本页填写联系方式。"
    >
      <SmartLink :to="{ name: 'products' }" class="btn btn--primary">去挑选商品</SmartLink>
    </StateEmpty>

    <div v-else class="checkout-layout">
      <form class="panel" novalidate @submit.prevent="onSubmit">
        <p class="notice notice--info" role="status">
          本站为<strong>询价制</strong>，无需注册登录。提交后请妥善保存一次性访问凭证以便查询进度。
        </p>

        <fieldset class="form-field channel-picker">
          <legend class="form-field__label">询盘方式 *</legend>
          <div class="channel-options">
            <label
              v-for="option in channelOptions"
              :key="option.value"
              class="channel-option"
              :class="{ 'channel-option--active': form.channel === option.value }"
            >
              <input
                :id="`checkout-channel-${option.value.toLowerCase()}`"
                v-model="form.channel"
                type="radio"
                name="checkout-channel"
                :value="option.value"
              />
              <span>
                <strong>{{ option.label }}</strong>
                <span class="channel-option__hint">{{ option.hint }}</span>
              </span>
            </label>
          </div>
          <!--
            ⚠️ 这里原先还有一条 `<p class="channel-hint">{{ channelHint }}</p>`，
               它渲染的正是**当前选中选项自己的 hint** —— 而每个 `.channel-option`
               内部已经渲染过一次（`channel-option__hint`）。当前只有 EMAIL 一个渠道时，
               同一句话会在同一屏出现两次，看起来像渲染重复。已删除。
          -->
          <p v-if="form.channel === 'WHATSAPP'" class="notice notice--info" role="status">
            选择 WhatsApp 后，提交时会生成一条<strong>预填消息与链接</strong>。
            该链接<strong>不会自动发送</strong>消息，需要你在 WhatsApp 中确认内容后手动发送；
            系统无法确认你最终是否发出。
          </p>
          <p v-if="catalogError" class="notice notice--warn" role="status">{{ catalogError }}</p>
          <!--
            G6-2.7：测试入口 —— 不填表、不提交即可验证「网页端能否拉起 WhatsApp」。
            号码来自构建期环境变量；**未配置时整块不渲染**（生产构建不会出现）。
          -->
          <p v-if="whatsappTestNumber" class="channel-test">
            <button
              id="checkout-test-whatsapp"
              type="button"
              class="btn btn--ghost"
              @click="onTestWhatsApp"
            >
              测试：打开 WhatsApp
            </button>
            <span class="subtle">仅验证唤起是否正常，不会创建询盘单。</span>
          </p>
        </fieldset>

        <div class="form-field">
          <label class="form-field__label" for="checkout-email">联系邮箱 *</label>
          <input
            id="checkout-email"
            v-model="form.contactEmail"
            type="email"
            autocomplete="email"
            placeholder="name@example.com"
            :aria-invalid="Boolean(fieldError('contactEmail'))"
          />
          <p v-if="fieldError('contactEmail')" class="form-field__error">
            {{ fieldError('contactEmail') }}
          </p>
        </div>

        <div class="form-field">
          <label class="form-field__label" for="checkout-name">联系人 *</label>
          <input
            id="checkout-name"
            v-model="form.contactName"
            type="text"
            autocomplete="name"
            maxlength="100"
            :aria-invalid="Boolean(fieldError('contactName'))"
          />
          <p v-if="fieldError('contactName')" class="form-field__error">
            {{ fieldError('contactName') }}
          </p>
        </div>

        <div class="form-field">
          <label class="form-field__label" for="checkout-address">收货地址（街道 / 完整地址）*</label>
          <textarea
            id="checkout-address"
            v-model="form.shippingAddress"
            rows="3"
            maxlength="500"
            :aria-invalid="Boolean(fieldError('shippingAddress'))"
          ></textarea>
          <p v-if="fieldError('shippingAddress')" class="form-field__error">
            {{ fieldError('shippingAddress') }}
          </p>
          <p class="form-field__hint">
            此处只填街道 / 门牌等详细地址；国家与城市请填在下方独立字段中。
          </p>
        </div>

        <div class="form-grid">
          <div class="form-field">
            <label class="form-field__label" for="checkout-country">国家 / 地区（可选）</label>
            <input
              id="checkout-country"
              v-model="form.country"
              type="text"
              autocomplete="country-name"
              :maxlength="COUNTRY_MAX"
              :aria-invalid="Boolean(fieldError('country'))"
            />
            <p v-if="fieldError('country')" class="form-field__error">{{ fieldError('country') }}</p>
          </div>

          <div class="form-field">
            <label class="form-field__label" for="checkout-city">城市（可选）</label>
            <input
              id="checkout-city"
              v-model="form.city"
              type="text"
              autocomplete="address-level2"
              :maxlength="CITY_MAX"
              :aria-invalid="Boolean(fieldError('city'))"
            />
            <p v-if="fieldError('city')" class="form-field__error">{{ fieldError('city') }}</p>
          </div>

          <div class="form-field">
            <label class="form-field__label" for="checkout-postal">邮政编码（可选）</label>
            <input
              id="checkout-postal"
              v-model="form.postalCode"
              type="text"
              inputmode="text"
              autocomplete="postal-code"
              maxlength="24"
              placeholder="如 SW1A 1AA / K1A 0B1"
              :aria-invalid="Boolean(fieldError('postalCode'))"
            />
            <p v-if="fieldError('postalCode')" class="form-field__error">
              {{ fieldError('postalCode') }}
            </p>
            <p class="form-field__hint">不同国家格式不同，允许字母、空格与连字符。</p>
          </div>
        </div>

        <div class="form-field">
          <label class="form-field__label" for="checkout-note">备注（可选）</label>
          <textarea id="checkout-note" v-model="form.note" rows="2" maxlength="500"></textarea>
        </div>

        <p v-if="hasUnknownResult" class="notice notice--warn" role="status">
          这份询价单上一次提交的<strong>结果未知</strong>（可能已送达服务器）。
          请直接用<strong>相同的信息</strong>重试：系统会复用同一次提交，不会重复下单。
        </p>

        <p v-if="submitError" class="notice notice--error" role="alert">{{ submitError }}</p>

        <div v-if="unavailable.length > 0" class="panel unavailable" role="alert">
          <p class="unavailable__title">以下商品当前无法询价：</p>
          <ul class="unavailable__list">
            <li v-for="item in unavailable" :key="item.productId">
              {{ unavailableName(item.productId) }}
              <span class="muted">（{{ unavailableReasonLabel(item.reason) }}）</span>
            </li>
          </ul>
          <button type="button" class="btn btn--ghost" @click="removeUnavailable">移除这些商品</button>
        </div>

        <div class="row">
          <button type="submit" class="btn btn--primary" :disabled="submitting">
            {{ submitting ? '提交中…' : submitError ? '重试提交' : '提交询价' }}
          </button>
          <SmartLink :to="{ name: 'cart' }" class="btn btn--ghost">返回询价清单</SmartLink>
        </div>
      </form>

      <aside class="panel checkout-summary">
        <h2 class="checkout-summary__title">询价商品（{{ lines.length }} 项）</h2>
        <ul class="checkout-summary__list">
          <li v-for="line in lines" :key="line.productId" class="checkout-summary__item">
            <span>{{ line.name }}</span>
            <span class="muted">× {{ line.quantity }}</span>
          </li>
        </ul>
        <p class="checkout-summary__total">
          本地参考小计：<strong>{{ formatMoney(subtotal, currency) }}</strong>
        </p>
        <p class="subtle">
          以上为加入询价清单时的价格快照，仅供参考；实际金额以服务端重新核验后的报价为准，且不含运费。
        </p>
        <p v-if="fieldError('lines')" class="form-field__error">{{ fieldError('lines') }}</p>
      </aside>
    </div>
  </div>
</template>

<style scoped>
/*
 * 本页所有视觉（表单、渠道选择、结算摘要、不可询价提示）都由
 * `styles/main.css` 的全局 class 承担，这里**不再重复定义** ——
 * 同一套 class 在两处各写一份必然漂移。
 *
 * 唯一需要页面级约束的是窄屏下把「表单 + 摘要」两栏收成单栏。
 */
@media (max-width: 900px) {
  .checkout-layout {
    grid-template-columns: 1fr;
  }

  /*
   * P2-4：移动端把「询价商品」摘要提到表单之前。
   *
   * 原先窄屏下摘要在表单之后，顾客在点「提交询价」前根本看不到自己要提交什么。
   * 这里只调 `order`（不改 DOM 顺序）是**安全的**：摘要里没有任何可聚焦元素
   * （只有 h2 / li / p），因此不会造成 Tab 顺序与视觉顺序错位。
   */
  .checkout-summary {
    order: -1;
  }
}
</style>
