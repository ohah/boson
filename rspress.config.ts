import * as path from 'node:path';
import { defineConfig } from '@rspress/core';

export default defineConfig({
  root: path.join(import.meta.dirname, 'spec'),
  outDir: process.env.SPINON_DOC_OUT_DIR ?? path.join(import.meta.dirname, 'build/docs-site'),
  base: process.env.SPINON_DOC_BASE ?? '/spinon/',
  lang: 'ko',
  title: '스피논 문서',
  description: '스피논의 구현 상태와 버전별 API 명세',
  icon: '/icon.svg',
  logo: '/icon.svg',
  globalStyles: path.join(import.meta.dirname, 'spec/styles.css'),
  themeConfig: {
    socialLinks: [
      { icon: 'github', mode: 'link', content: 'https://github.com/ohah/spinon' },
    ],
  },
});
