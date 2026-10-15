import { createApp } from 'vue';
import App from './App.vue';
import { router } from './router';
import { applyBrandTheme } from './config';
import './styles/main.css';

// 品牌色在挂载前写入 CSS 变量 —— 保证首帧就是品牌色，不出现「先默认色再跳变」。
// 样式表里保留了同一套默认值，即使此处注入失败页面也不会失去配色。
applyBrandTheme();

createApp(App).use(router).mount('#app');
