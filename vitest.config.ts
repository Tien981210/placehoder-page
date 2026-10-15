import { fileURLToPath, URL } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

/**
 * 单元测试配置（jsdom）。
 *
 * ⚠️ 为什么不直接 `mergeConfig(viteConfig, ...)` 复用 vite.config.ts 的插件：
 *
 *   @vitejs/plugin-vue 在**没有 devServer** 时会把 `transformAssetUrls`
 *   默认成 `{ includeAbsolute: true }`，于是模板里的绝对资源路径
 *   （如 `src="/brand/logo-mark.png"`）会被改写成模块导入。
 *
 *   该路径指向 `public/` 目录：生产构建里由 Vite 的 `checkPublicFile`
 *   兜底（所以 `pnpm build` 正常），但在 vitest 的模块解析链路中会失败：
 *
 *     TypeError: The argument 'filename' must be a file URL object, file URL
 *     string, or absolute path string. Received 'file:///brand/logo-mark.png'
 *
 *   这里显式关闭 `includeAbsolute`，让绝对路径原样保留为字符串字面量 ——
 *   这正是 `public/` 资源的正确语义，也避免了「凡是渲染带品牌占位图的
 *   组件都无法测试」这个坑。
 *
 *   `resolve.alias['@']` 必须与 vite.config.ts 保持一致（见该文件的 alias）。
 */
export default defineConfig({
  plugins: [
    vue({
      template: {
        transformAssetUrls: {
          includeAbsolute: false,
        },
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.spec.ts', 'tests/**/*.spec.ts'],
    restoreMocks: true,
    clearMocks: true,
  },
});
