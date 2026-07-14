/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// 本番ビルドの出力 HTML にのみ CSP メタタグを注入する。
// connect-src 'none' により設定データの外部送信(fetch/XHR/WebSocket)を技術的に禁止する(基本設計 §8.1)。
// dev サーバでは Vite の HMR(WebSocket)を維持するため注入しない。
const cspPlugin = (): Plugin => {
  const csp = [
    "default-src 'self'",
    "connect-src 'none'",
    "img-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    "script-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
  ].join('; ');
  return {
    name: 'aclvision-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '</title>',
        `</title>\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`,
      );
    },
  };
};

// GitHub Pages 配信時にサブパス配下でも動くよう相対パスでビルドする。
export default defineConfig({
  base: './',
  // vitest が同梱する vite と本体 vite の Plugin 型が別インスタンスになるため、
  // プラグイン配列のみ型の橋渡しをする(実行時は同一で問題ない)。
  plugins: [react(), cspPlugin()] as never,
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});
