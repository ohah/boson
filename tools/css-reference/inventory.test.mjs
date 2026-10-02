import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { validateC01Inventory, summarizeC01Inventory } from './inventory.mjs';

const inventoryPath = new URL('../../tests/fixtures/css/c01/inventory.v1.json', import.meta.url);
const inventory = JSON.parse(await readFile(inventoryPath, 'utf8'));

test('C01 inventory v1의 입력 hash·정체성·부분 범위를 고정한다', async () => {
  const bytes = await readFile(inventoryPath);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  assert.equal(sha256, '1293be438ca54d184c0f614d49fb0549bded5484806e73467a73898e6dc4fc6c');
  assert.equal(inventory.inventoryId, 'C01-UAv0-supported-html-elements');
  assert.equal(inventory.profileId, 'spinon-html-ua/0.1.0-draft');
  assert.equal(inventory.fixtureId, 'C01-UAv0-supported-html-elements');
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
  duplicateNode.elements[0].nodeIds.push(duplicateNode.elements[0].nodeIds[0]);
  assert.throws(() => validateC01Inventory(duplicateNode), /중복 node ID/);

  const overlappingSelectorMatch = structuredClone(inventory);
  overlappingSelectorMatch.elements[1].nodeIds[0] = overlappingSelectorMatch.elements[0].nodeIds[0];
  assert.doesNotThrow(() => validateC01Inventory(overlappingSelectorMatch));
});

test('부분 인벤토리를 전체 지원 목록으로 오인할 수 없게 거부한다', () => {
  const complete = structuredClone(inventory);
  complete.completeness = 'complete';
  assert.throws(() => validateC01Inventory(complete), /completeness는 partial/);

  const undocumented = structuredClone(inventory);
  undocumented.uncovered = [];
  assert.throws(() => validateC01Inventory(undocumented), /uncovered 항목/);
});
