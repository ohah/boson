import * as path from 'node:path';
import { defineConfig } from '@rspress/core';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');
const configuredOutDir = process.env.SPINON_DOC_OUT_DIR;

export default defineConfig({
  root: path.join(repositoryRoot, 'spec'),
  outDir: configuredOutDir
    ? path.resolve(repositoryRoot, configuredOutDir)
    : path.join(import.meta.dirname, 'build/site'),
  base: process.env.SPINON_DOC_BASE ?? '/spinon/',
  themeDir: path.join(repositoryRoot, 'theme'),
  lang: 'ko',
  title: '스피논 문서',
  description: '스피논의 구현 상태와 버전별 API 명세',
  icon: '/icon.svg',
  logo: '/logo.svg',
  logoText: '스피논',
  globalStyles: path.join(repositoryRoot, 'spec/styles.css'),
  themeConfig: {
    socialLinks: [
      { icon: 'github', mode: 'link', content: 'https://github.com/ohah/spinon' },
    ],
  },
});
