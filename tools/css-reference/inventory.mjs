const inventorySchema = 'spinon-css-feature-inventory/v1';
const stableIdPattern = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
const selectorPattern = /^[a-z][a-z0-9-]*$/;
const propertyPattern = /^(?:[a-z][a-z0-9-]*|--[a-z][a-z0-9-]*)$/;

function invalid(message) {
  throw new Error(`C01 feature inventory가 올바르지 않습니다: ${message}`);
}

export function validateC01Inventory(inventory) {
  if (!inventory || typeof inventory !== 'object' || Array.isArray(inventory)) {
    invalid('최상위 값은 객체여야 합니다.');
  }
  if (inventory.schema !== inventorySchema) invalid(`schema는 ${inventorySchema}여야 합니다.`);
  for (const field of ['inventoryId', 'profileId', 'fixtureId']) {
    if (typeof inventory[field] !== 'string' || inventory[field].trim() === '') {
      invalid(`${field}가 비어 있습니다.`);
    }
  }
  if (inventory.completeness !== 'partial') {
    invalid('현재 인벤토리는 전체 CSS 범위를 대표하지 않으므로 completeness는 partial이어야 합니다.');
  }
  if (!Array.isArray(inventory.uncovered) || inventory.uncovered.length === 0
    || inventory.uncovered.some((item) => typeof item !== 'string' || item.trim() === '')) {
    invalid('미포함 범위를 설명하는 uncovered 항목이 필요합니다.');
  }
  if (!Array.isArray(inventory.elements) || inventory.elements.length === 0) {
    invalid('elements는 비어 있지 않은 배열이어야 합니다.');
  }

  const selectors = new Set();
  const nodeIds = new Set();
  const featureIds = new Set();
  for (const [elementIndex, element] of inventory.elements.entries()) {
    if (!element || typeof element !== 'object' || Array.isArray(element)) {
      invalid(`elements[${elementIndex}]는 객체여야 합니다.`);
    }
    if (typeof element.selector !== 'string' || !selectorPattern.test(element.selector)) {
      invalid(`elements[${elementIndex}].selector는 단일 HTML 태그 선택자여야 합니다.`);
    }
    if (selectors.has(element.selector)) invalid(`중복 selector: ${element.selector}`);
    selectors.add(element.selector);

    if (!Array.isArray(element.nodeIds) || element.nodeIds.length === 0) {
      invalid(`${element.selector}에 기대 nodeIds가 없습니다.`);
    }
    for (const nodeId of element.nodeIds) {
      if (typeof nodeId !== 'string' || !stableIdPattern.test(nodeId)) {
        invalid(`${element.selector}의 node ID 형식이 잘못됐습니다: ${String(nodeId)}`);
      }
      if (nodeIds.has(nodeId)) invalid(`중복 node ID: ${nodeId}`);
      nodeIds.add(nodeId);
    }

    if (!Array.isArray(element.features) || element.features.length === 0) {
      invalid(`${element.selector}에 비교 feature가 없습니다.`);
    }
    for (const feature of element.features) {
      if (!feature || typeof feature !== 'object' || Array.isArray(feature)) {
        invalid(`${element.selector}의 feature는 객체여야 합니다.`);
      }
      if (typeof feature.id !== 'string' || !stableIdPattern.test(feature.id)) {
        invalid(`${element.selector}의 안정 feature ID 형식이 잘못됐습니다.`);
      }
      if (featureIds.has(feature.id)) invalid(`중복 feature ID: ${feature.id}`);
      featureIds.add(feature.id);
      if (typeof feature.property !== 'string' || !propertyPattern.test(feature.property)) {
        invalid(`${feature.id}의 CSS property 이름이 잘못됐습니다.`);
      }
    }
  }

  return inventory;
}

export function summarizeC01Inventory(inventory) {
  const validInventory = validateC01Inventory(inventory);
  return {
    elementCount: validInventory.elements.length,
    featureCount: validInventory.elements.reduce((count, element) => count + element.features.length, 0),
  };
}
