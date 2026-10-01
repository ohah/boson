import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { validateC01Inventory, summarizeC01Inventory } from './inventory.mjs';

const inventoryPath = new URL('../../tests/fixtures/css/c01/inventory.v1.json', import.meta.url);
const inventory = JSON.parse(await readFile(inventoryPath, 'utf8'));

test('현재 C01 seed inventory의 요소·feature 수와 부분 범위를 고정한다', () => {
  assert.equal(inventory.completeness, 'partial');
  assert.deepEqual(summarizeC01Inventory(inventory), { elementCount: 9, featureCount: 19 });
  assert.ok(inventory.uncovered.length > 0);
});

test('안정 selector, node ID, feature ID를 검증한다', () => {
  assert.equal(validateC01Inventory(inventory), inventory);

  const duplicateFeature = structuredClone(inventory);
  duplicateFeature.elements[1].features[0].id = duplicateFeature.elements[0].features[0].id;
  assert.throws(() => validateC01Inventory(duplicateFeature), /중복 feature ID/);

  const duplicateNode = structuredClone(inventory);
  duplicateNode.elements[1].nodeIds[0] = duplicateNode.elements[0].nodeIds[0];
  assert.throws(() => validateC01Inventory(duplicateNode), /중복 node ID/);
});

test('부분 인벤토리를 전체 지원 목록으로 오인할 수 없게 거부한다', () => {
  const complete = structuredClone(inventory);
  complete.completeness = 'complete';
  assert.throws(() => validateC01Inventory(complete), /completeness는 partial/);

  const undocumented = structuredClone(inventory);
  undocumented.uncovered = [];
  assert.throws(() => validateC01Inventory(undocumented), /uncovered 항목/);
});
