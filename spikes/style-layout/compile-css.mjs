import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { transform } from 'lightningcss';

const here = dirname(fileURLToPath(import.meta.url));
const input = process.argv[2] ?? join(here, 'sample.css');
const output = process.argv[3] ?? join(here, 'styles.json');
if (resolve(input) === resolve(output)) throw new Error('입력 CSS와 출력 JSON 경로는 달라야 합니다');
const styles = Object.create(null);

function pixels(value, property) {
  const dimension = value?.type === 'length-percentage' ? value.value : null;
  if (dimension?.type !== 'dimension' || dimension.value?.unit !== 'px') {
    throw new Error(`${property}: 이 실험에서는 px 값만 지원합니다`);
  }
  const number = dimension.value.value;
  if (!Number.isFinite(number) || number < 0) {
    throw new Error(`${property}: 0 이상의 유한한 px 값만 지원합니다`);
  }
  return number;
}

function parseDeclaration(declaration, style) {
  const { property, value } = declaration;
  switch (property) {
    case 'display':
      if (value?.inside?.type !== 'flex') throw new Error('display: flex만 지원합니다');
      style.display = 'flex';
      break;
    case 'flex-direction':
      if (!['row', 'column'].includes(value)) throw new Error(`flex-direction: ${value} 미지원`);
      style.flexDirection = value;
      break;
    case 'width':
    case 'height':
      style[property] = pixels(value, property);
      break;
    case 'padding':
      style.padding = Object.fromEntries(
        ['top', 'right', 'bottom', 'left'].map(side => [side, pixels(value[side], `padding-${side}`)]),
      );
      break;
    case 'gap':
      style.gap = { row: pixels(value.row, 'row-gap'), column: pixels(value.column, 'column-gap') };
      break;
    case 'flex-grow':
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error('flex-grow: 0 이상의 유한한 숫자만 지원합니다');
      style.flexGrow = value;
      break;
    default:
      throw new Error(`${property}: 이 실험에서는 지원하지 않습니다`);
  }
}

rmSync(output, { force: true });
transform({
  filename: input,
  code: readFileSync(input),
  visitor: {
    Rule(rule) {
      if (rule.type !== 'style') throw new Error(`${rule.type}: 이 실험에서는 일반 스타일 규칙만 지원합니다`);
      const selectors = rule.value.selectors;
      if (selectors.length !== 1 || selectors[0].length !== 1 || selectors[0][0].type !== 'class') {
        throw new Error('이 실험에서는 단일 클래스 선택자만 지원합니다');
      }
      const name = selectors[0][0].name;
      if (Object.hasOwn(styles, name)) throw new Error(`.${name}: 중복 규칙은 아직 지원하지 않습니다`);
      if (rule.value.declarations.importantDeclarations.length) throw new Error('!important는 아직 지원하지 않습니다');
      const style = {};
      for (const declaration of rule.value.declarations.declarations) parseDeclaration(declaration, style);
      styles[name] = style;
    },
  },
});

writeFileSync(output, `${JSON.stringify({ version: 1, styles }, null, 2)}\n`);
process.stdout.write(`${output}: ${Object.keys(styles).length}개 클래스 변환\n`);
