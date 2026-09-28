import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const directory = mkdtempSync(join(tmpdir(), 'spinon-style-layout-'));
const input = join(directory, 'input.css');
const output = join(directory, 'output.json');

function compile(css) {
  writeFileSync(input, css);
  return spawnSync(process.execPath, [fileURLToPath(new URL('./compile-css.mjs', import.meta.url)), input, output], { encoding: 'utf8' });
}

try {
  const valid = compile('.screen { display: flex; width: 320px; padding: 8px }');
  assert.equal(valid.status, 0, valid.stderr);
  assert.equal(JSON.parse(readFileSync(output, 'utf8')).styles.screen.width, 320);

  for (const [name, css] of [
    ['미지원 속성', '.screen { display: flex; color: red }'],
    ['미지원 선택자', 'div.screen { display: flex }'],
    ['중복 규칙', '.screen { display: flex } .screen { width: 1px }'],
    ['미디어 규칙', '@media (min-width: 100px) { .screen { display: flex } }'],
    ['중요 선언', '.screen { display: flex !important }'],
    ['백분율', '.screen { display: flex; width: 50% }'],
    ['음수 크기', '.screen { display: flex; width: -20px }'],
    ['음수 패딩', '.screen { display: flex; padding: -5px }'],
    ['문법 오류', '.screen { display: flex; width: @@@ }'],
  ]) {
    const result = compile(css);
    assert.notEqual(result.status, 0, `${name}: 변환이 성공했습니다`);
    assert.throws(() => readFileSync(output), `${name}: 오래된 결과가 남았습니다`);
  }

  const unusual = compile('.constructor { display: flex }');
  assert.equal(unusual.status, 0, unusual.stderr);
  assert.equal(JSON.parse(readFileSync(output, 'utf8')).styles.constructor.display, 'flex');

  writeFileSync(input, '.screen { display: flex }');
  const samePath = spawnSync(process.execPath, [fileURLToPath(new URL('./compile-css.mjs', import.meta.url)), input, input], { encoding: 'utf8' });
  assert.notEqual(samePath.status, 0, '입력 파일 덮어쓰기가 성공했습니다');
  assert.equal(readFileSync(input, 'utf8'), '.screen { display: flex }');
  process.stdout.write('CSS 변환 경계 12개 확인 완료\n');
} finally {
  rmSync(directory, { recursive: true, force: true });
}
