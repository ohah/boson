spinon.createNode(1, "view");

const initialDocumentReceipt = spinon.__internal.commitDocumentBatch([
  { type: "createElement", id: 1, name: "div" },
  { type: "createText", id: 2, data: "ready" },
  { type: "append", parent: 0, node: 1 },
  { type: "append", parent: 1, node: 2 },
  { type: "setAttribute", node: 1, name: "class", value: "counter" },
]);
let invalidCallShapeRejected = false;
try {
  spinon.__internal.commitDocumentBatch({});
} catch (error) {
  invalidCallShapeRejected = error instanceof TypeError;
}

let malformedNameRejected = false;
try {
  spinon.__internal.commitDocumentBatch([
    { type: "createElement", id: 4, name: "\uD800" },
  ]);
} catch {
  malformedNameRejected = true;
}

let unknownOperationRejected = false;
try {
  spinon.__internal.commitDocumentBatch([{ type: "unsupported" }]);
} catch {
  unknownOperationRejected = true;
}

let nonIntegerFieldRejected = false;
try {
  spinon.__internal.commitDocumentBatch([
    { type: "createText", id: 1.5, data: "must reject" },
  ]);
} catch {
  nonIntegerFieldRejected = true;
}

if (
  !invalidCallShapeRejected ||
  !malformedNameRejected ||
  !unknownOperationRejected ||
  !nonIntegerFieldRejected ||
  initialDocumentReceipt.documentRevision !== 1n ||
  initialDocumentReceipt.renderTreeRevision !== 1n ||
  initialDocumentReceipt.nodeCount !== 2n ||
  !initialDocumentReceipt.changed
) {
  throw new Error("초기 HostDocument 영수증이 예상과 다릅니다");
}

let invalidBatchRejected = false;
try {
  spinon.__internal.commitDocumentBatch([
    { type: "setText", node: 999, data: "must roll back" },
  ]);
} catch {
  invalidBatchRejected = true;
}
const getterError = new Error("getter failure sentinel");
let getterErrorPreserved = false;
try {
  spinon.__internal.commitDocumentBatch([
    {
      get type() {
        throw getterError;
      },
    },
  ]);
} catch (error) {
  getterErrorPreserved = error === getterError;
}

let sparseSlotRejected = false;
try {
  const sparseBatch = [];
  sparseBatch.length = 1;
  spinon.__internal.commitDocumentBatch(sparseBatch);
} catch {
  sparseSlotRejected = true;
}

let operationLimitRejected = false;
try {
  spinon.__internal.commitDocumentBatch(
    Array.from({ length: 257 }, (_, index) => ({
      type: "createText",
      id: 100 + index,
      data: "x",
    })),
  );
} catch {
  operationLimitRejected = true;
}

let longOperationTypeRejected = false;
try {
  spinon.__internal.commitDocumentBatch([
    { type: "x".repeat(33), id: 899, data: "must reject before conversion" },
  ]);
} catch {
  longOperationTypeRejected = true;
}

let stringLimitRejected = false;
try {
  spinon.__internal.commitDocumentBatch([
    { type: "createText", id: 900, data: "a".repeat(600_000) },
    { type: "createText", id: 901, data: "b".repeat(500_001) },
  ]);
} catch {
  stringLimitRejected = true;
}

const operationCoverageReceipt = spinon.__internal.commitDocumentBatch([
  { type: "createText", id: 3, data: "temporary" },
  { type: "append", parent: 1, node: 3 },
  { type: "insertBefore", parent: 1, node: 3, before: 2 },
  { type: "setText", node: 2, data: "\uD800" },
  { type: "setText", node: 2, data: "ready" },
  { type: "setAttribute", node: 1, name: "data-temp", value: "yes" },
  { type: "removeAttribute", node: 1, name: "data-temp" },
  { type: "remove", parent: 1, node: 3 },
]);
if (
  operationCoverageReceipt.documentRevision !== 2n ||
  operationCoverageReceipt.nodeCount !== 3n ||
  !operationCoverageReceipt.changed
) {
  throw new Error("V8 문서 변경 종류 8개의 실행 결과가 예상과 다릅니다");
}

const emptyReceipt = spinon.__internal.commitDocumentBatch([]);
if (
  !invalidBatchRejected ||
  !getterErrorPreserved ||
  !sparseSlotRejected ||
  !operationLimitRejected ||
  !longOperationTypeRejected ||
  !stringLimitRejected ||
  emptyReceipt.changed ||
  emptyReceipt.documentRevision !== operationCoverageReceipt.documentRevision ||
  emptyReceipt.nodeCount !== operationCoverageReceipt.nodeCount
) {
  throw new Error("거부된 HostDocument 묶음이 원자적으로 복구되지 않았습니다");
}

const growingBatch = [];
growingBatch.push({
  get type() {
    for (let index = 0; index < 300; index += 1) {
      growingBatch.push({ type: "unsupported" });
    }
    let nestedRejected = false;
    try {
      spinon.__internal.commitDocumentBatch([]);
    } catch {
      nestedRejected = true;
    }
    if (!nestedRejected) throw new Error("중첩 문서 묶음이 거부되지 않았습니다");
    return "setText";
  },
  node: 2,
  data: "ready",
});
const getterReceipt = spinon.__internal.commitDocumentBatch(growingBatch);
if (
  getterReceipt.changed ||
  getterReceipt.documentRevision !== operationCoverageReceipt.documentRevision ||
  getterReceipt.nodeCount !== operationCoverageReceipt.nodeCount
) {
  throw new Error("배열 getter 처리 중 변경 묶음 길이가 달라졌습니다");
}

spinon.setText(
  `문서 revision ${initialDocumentReceipt.documentRevision} · 노드 ${initialDocumentReceipt.nodeCount}`,
);

spinon.onEvent((nodeId) => {
  spinon.createNode(nodeId + 1, "text");
  const eventReceipt = spinon.__internal.commitDocumentBatch([
    { type: "setText", node: 2, data: `이벤트:${nodeId}` },
  ]);
  spinon.setText(
    `이벤트:${nodeId} · 문서 revision ${eventReceipt.documentRevision}`,
  );
});
