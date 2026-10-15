import type { WhatsAppPreviewView } from '@/api/types';

/**
 * WhatsApp 唤起工具 —— 本文件是**唯一**的唤起实现。
 *
 * ===========================================================================
 * G6-2.2-WA-R3（现行契约，2026-10-13）：**纯打开 App，不弹页面、不跳转**
 * ---------------------------------------------------------------------------
 * 用户要求：「点一下直接打开 WhatsApp App，**不新开窗口、不跳转网页、页面保持不动**」。
 *
 * 浏览器里唯一同时满足这三条的方式，就是导航到 WhatsApp **官方自定义协议**：
 *   `whatsapp://send?phone=<纯数字国际号码>&text=<URL编码后的消息>`
 * 浏览器无法渲染非 http(s) 协议，因此**当前页面不会被替换**：
 *   · 已安装 WhatsApp ⇒ 由系统直接唤起 App，页面原地不动；
 *   · 未安装 WhatsApp ⇒ 导航被静默忽略，页面同样原地不动（不会有任何反馈）。
 *
 * ⚠️ 这正是「纯打开」的代价，**必须在界面上如实告知**：未安装 App 时点击不会有
 *    任何反应。因此页面**始终**保留两条手动出路：
 *    ① 「复制消息」；② 一个**用户主动点击**才生效的网页版链接（`https://wa.me/…`）。
 *    本模块**绝不自动回退**到 `wa.me` —— 自动回退就是「跳转页面」，正是被拒绝的行为。
 *
 * ---------------------------------------------------------------------------
 * 历史沿革（**均为已废弃方案，不要回退**）
 *   · G6-2.2 首版：`whatsapp://` + 超时后把**预开的空白标签**导航到 `wa.me`。
 *     缺陷：必定多留一个空白标签、依赖 `setTimeout` 异步兜底（会被弹窗拦截）。
 *   · G6-2.2-WA：只导航 `https://wa.me/…`（`window.open(url,'_blank')`）。
 *     缺陷：会**新开窗口 / 标签**。
 *   · G6-2.2-WA-R2：同标签导航 `https://wa.me/…`。
 *     缺陷：会**把结果页整个跳走**到 WhatsApp 网页版。
 *   · 现行（R3）：同标签导航 `whatsapp://`，页面原地不动。✅
 *
 * ---------------------------------------------------------------------------
 * 硬约束（逐条对应任务书）
 *   1. 号码只含国家代码与电话号码数字，不含 `+` / 空格 / 括号 / 连字符；
 *   2. 消息用 UTF-8 + `encodeURIComponent` 编码，**绝不重复编码**；
 *   3. 唤起必须在**用户手势内同步**完成（不 await、不 setTimeout、不重试）；
 *   4. **不新开窗口 / 标签**：不使用 `window.open`；
 *   5. **绝不**产出「已发送 / 已送达」—— 本模块只产出「链接已构造 /
 *      已发起打开动作」两档事实，且**从不声称「已打开 WhatsApp」**；
 *   6. 号码缺失或是已知占位号码时**阻止跳转**，交由页面给出配置提示。
 */

/** E.164 允许的最短位数（含国家代码）—— 与后端 `common/whatsapp-number.ts` 一致。 */
export const WHATSAPP_MIN_DIGITS = 8;
/** E.164 允许的最长位数（含国家代码）—— 与后端 `common/whatsapp-number.ts` 一致。 */
export const WHATSAPP_MAX_DIGITS = 15;

/*
 * ---------------------------------------------------------------------------
 * 客服号码的**唯一来源**是 `src/config/brand.ts` 的 `BRAND.brandWhatsApp`。
 *
 * 本文件**刻意不再保存号码副本**。此前这里有一个 `WHATSAPP_SUPPORT_NUMBER`
 * 常量（值与 brand.ts 相同），但它：
 *   · 全站无任何引用（含测试）；
 *   · 构成了同一个未确认号码的**第二份硬编码副本** ——
 *     一旦只改了 brand.ts，这份副本会静默过期，成为后续误用的陷阱。
 * 号码校验与链接构造仍然全部在本文件完成，只是**入参由调用方从品牌配置传入**。
 *
 * ⚠️ 当前号码的真实性**未经业务方确认**，公开上线前必须人工核验。
 * ---------------------------------------------------------------------------
 */

/**
 * 已知的**演示 / 测试**号码 —— 一旦命中就绝不发起跳转。
 *
 * 这些号码只出现在测试夹具与本地演示数据里，**不是**真实客服号码；
 * 把它们放进生产代码的用途是「阻止错误跳转」，而不是「当作默认号码」。
 * 真实号码只能由后台「联系方式配置」录入，本模块不提供任何默认值。
 */
export const PLACEHOLDER_WHATSAPP_NUMBERS: readonly string[] = [
  // 138 0013 8000 —— 本仓库测试夹具与演示数据统一使用的占位号码
  '8613800138000',
];

/** 去掉一切非数字字符。 */
export function digitsOnly(value: string): string {
  return value.replace(/\D+/g, '');
}

/**
 * 号码是否**可用于唤起**（纯数字、E.164 长度区间、且不是已知占位号码）。
 *
 * ⚠️ 这是一道**防御性**校验：后端已用 `normalizeWhatsAppNumber` 规范化过号码，
 *    正常路径下必然通过。它存在是为了兜住「后台配错号码」与
 *    「服务端返回异常数据」两类情况 —— 宁可不让跳转，也不能跳到错误对象。
 */
export function isUsableWhatsAppNumber(phoneNumber: string | null | undefined): boolean {
  const raw = (phoneNumber ?? '').trim();
  if (raw.length === 0) return false;
  // wa.me 路径必须是纯数字：出现 `+` / 空格 / 括号 / 连字符说明未被规范化
  if (digitsOnly(raw) !== raw) return false;
  if (raw.length < WHATSAPP_MIN_DIGITS || raw.length > WHATSAPP_MAX_DIGITS) return false;
  return !PLACEHOLDER_WHATSAPP_NUMBERS.includes(raw);
}

/**
 * 构造标准 Click to Chat 链接（与后端 `buildWhatsAppUrl` 完全一致）。
 *
 * ⚠️ 调用方必须先用 `isUsableWhatsAppNumber` 校验号码。
 *    本函数不做「尽力拼接」—— 传什么号码就拼什么号码，避免把错误号码
 *    悄悄修成「看起来能用」的链接。
 */
export function buildWhatsAppUrl(phoneNumber: string, message: string): string {
  return `https://wa.me/${phoneNumber}?text=${encodeURIComponent(message)}`;
}

/**
 * 构造 **App 自定义协议**链接（G6-2.2-WA-R3）—— 用于「纯打开 App、页面不跳转」。
 *
 * 形如 `whatsapp://send?phone=<纯数字国际号码>&text=<URL编码后的消息>`。
 * 这是 WhatsApp 官方文档给出的 scheme；`phone` 与 `wa.me` 一样必须是不带 `+`
 * 的纯数字国际号码。
 *
 * ⚠️ 导航到该协议时浏览器**不会**离开当前页：装了 App 就唤起 App，
 *    没装就静默忽略 —— 绝不会跳到一个网页。
 */
export function buildWhatsAppAppUrl(phoneNumber: string, message: string): string {
  return `whatsapp://send?phone=${phoneNumber}&text=${encodeURIComponent(message)}`;
}

/** 展示用国际号码：补上前导 `+`（仅用于界面展示，绝不放进 wa.me 路径）。 */
export function formatInternationalPhone(phoneNumber: string): string {
  return `+${phoneNumber}`;
}

export interface WhatsAppOpenResult {
  /**
   * 是否**成功发起了打开动作**。
   *
   * 导航到 `whatsapp://` 不会被弹窗拦截器拦截，所以正常路径下恒为 `true`；
   * 仅当浏览器拒绝赋值 `location.href`（极端情况）时才为 `false`。
   *
   * ⚠️ 无论取值如何，这都**不代表** WhatsApp 已打开，更不代表消息已发送 ——
   *    浏览器出于隐私限制无法得知后续结果（未装 App 时就是静默无反应）。
   */
  attempted: boolean;
  /** 本次导航使用的 **App 协议**链接（`whatsapp://send?…`）。 */
  appUrl: string;
  /** **网页版**兜底链接（`https://wa.me/…`）—— 供用户主动点击，本模块不自动使用。 */
  webUrl: string;
}

/**
 * 尝试打开 WhatsApp **App**（G6-2.2-WA-R3：纯打开，不弹窗口、不跳转网页）。
 *
 * 实现要点（全部为「必须」）：
 *   - **同步**执行：必须在用户点击事件处理函数里**直接**调用，
 *     不要 `await` 任何东西后再调用，否则会被浏览器判定为「非用户手势」而拒绝导航；
 *   - **单次**导航：只赋值一次 `location.href`，不做定时重试、
 *     不预开空白标签、不使用隐藏 iframe、**不自动回退到 `wa.me`**；
 *   - **不新开窗口 / 标签**：不使用 `window.open`；
 *   - **不离开当前页**：导航目标是 `whatsapp://`，浏览器不会渲染它。
 *
 * @param phoneNumber 已规范化的国际号码（纯数字、不含 `+`）
 * @param message     要预填的消息正文（会被 URL 编码）
 *
 * ⚠️ 返回 `attempted: true` 只说明**导航动作已发起**。设备未安装 WhatsApp 时
 *    系统会静默忽略，界面必须提示用户改用「复制消息」或网页版链接，
 *    绝不能声称「已打开」。
 */
export function openWhatsApp(phoneNumber: string, message: string): WhatsAppOpenResult {
  const appUrl = buildWhatsAppAppUrl(phoneNumber, message);
  const webUrl = buildWhatsAppUrl(phoneNumber, message);
  try {
    // G6-2.2-WA-R3：导航到 **App 自定义协议**。
    // 浏览器无法渲染 `whatsapp://` ⇒ 当前页面**原地保留**：
    //   装了 App ⇒ 系统直接唤起 App；没装 ⇒ 静默忽略（页面同样不动）。
    // 这样既满足「不新开窗口」，也满足「不跳转页面」。
    window.location.href = appUrl;
    return { attempted: true, appUrl, webUrl };
  } catch {
    // 极少数环境下（如被 CSP / 沙箱限制）赋值可能抛错；此时交由页面兜底。
    return { attempted: false, appUrl, webUrl };
  }
}

/** 复制用的纯文本：消息 + 号码 + 询盘号（便于用户在任意渠道手动发送）。 */
export function buildWhatsAppCopyText(preview: WhatsAppPreviewView, inquiryNo: string): string {
  const lines = [preview.message];
  if (preview.phoneNumber) {
    lines.push('', `WhatsApp: ${formatInternationalPhone(preview.phoneNumber)}`);
  }
  lines.push(`Inquiry No: ${inquiryNo}`);
  return lines.join('\n');
}

/**
 * 预览是否可用于唤起：必须解析到联系人号码、号码可用、且链接已构造。
 * 号码缺失 / 为占位号码 / 链接为空时，界面只能提供「复制消息」。
 */
export function isWhatsAppOpenable(preview: WhatsAppPreviewView | null): boolean {
  if (preview === null || !preview.available) return false;
  if (!isUsableWhatsAppNumber(preview.phoneNumber)) return false;
  return typeof preview.url === 'string' && preview.url.length > 0;
}

/**
 * 唤起结果文案。
 *
 * ⚠️ 刻意**不**包含任何「已发送 / 已送达」措辞 ——
 *    普通 wa.me / whatsapp:// 链接都无法确认发送结果，界面必须如实呈现。
 * ⚠️ G6-2.2-WA-R3：必须如实说明「未安装 App 时不会有任何反应」—— 这是「纯打开」方案的
 *    固有代价，不能让用户以为按钮坏了。
 */
export const WHATSAPP_OPEN_HINT =
  '点击后直接打开已安装的 WhatsApp App（不会新开窗口，也不会离开本页面）。' +
  '若设备上未安装 WhatsApp，点击不会有任何反应 —— 此时请改用「复制消息」，' +
  '或点击下方「用网页版打开」链接。';

/** 发送状态说明（任务书：必须区分各阶段，且不得伪造自动发送状态）。 */
export const WHATSAPP_MANUAL_SEND_NOTICE =
  '本链接不会自动发送消息：请在弹出的 WhatsApp 中确认内容后手动点击「发送」。' +
  '系统无法确认你最终是否发出了这条消息。';
