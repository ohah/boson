import { Layout as BasicLayout } from '@rspress/core/theme-original';

export function Layout() {
  return <BasicLayout afterNavTitle={<span className="spinon-version" aria-label="현재 문서 버전">0.1.0-draft</span>} />;
}

export * from '@rspress/core/theme-original';
