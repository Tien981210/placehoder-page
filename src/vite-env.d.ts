/// <reference types="vite/client" />

/**
 * 本项目使用的环境变量白名单。
 * 只有以 VITE_ 前缀开头的变量会被注入到客户端代码中。
 */
interface ImportMetaEnv {
  /** 后端 API 源（不含 /api/v1 前缀），例如 http://127.0.0.1:4000 */
  readonly VITE_API_BASE_URL?: string;
  /** 'true' | 'false'：是否使用明确标记的演示（Mock）数据 */
  readonly VITE_USE_MOCK?: string;
  /** 站点标题，仅用于界面展示 */
  readonly VITE_APP_TITLE?: string;
  /**
   * 【仅本地联调 / 测试用】结算页「测试：打开 WhatsApp」按钮的目标号码
   * （纯数字国际格式，例如 `8613070758373`）。
   *
   * ⚠️ 公开目录刻意**不下发**客服号码（隐私不变量），所以测试按钮的号码
   *    只能来自构建期环境变量。**未配置时该按钮不渲染** ⇒
   *    生产构建天然不会暴露这个测试入口。
   */
  readonly VITE_WHATSAPP_TEST_NUMBER?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
