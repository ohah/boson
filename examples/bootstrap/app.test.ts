import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

test("예제 번들이 HostDocument 커밋·rollback·getter 재진입·이벤트를 확인한다", () => {
  const source = readFileSync("app.js", "utf8");
  const batches: Array<unknown[]> = [];
  const texts: string[] = [];
  const createdNodes: Array<[number, string]> = [];
  let eventHandler: ((nodeId: number) => void) | undefined;
  let active = false;
  let documentRevision = 0n;
  let renderTreeRevision = 0n;
  let nodes = new Map<number, "element" | "text">();
  let textValues = new Map<number, string>();
  let connected = new Set<number>();
  const isWellFormedUtf16 = (value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      const unit = value.charCodeAt(index);
      if (unit >= 0xd800 && unit <= 0xdbff) {
        const next = value.charCodeAt(index + 1);
        if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
        index += 1;
      } else if (unit >= 0xdc00 && unit <= 0xdfff) {
        return false;
      }
    }
    return true;
  };

  const host = {
    createNode(id: number, tag: string) {
      createdNodes.push([id, tag]);
    },
    setText(text: string) {
      texts.push(text);
    },
    __internal: {
      commitDocumentBatch(operations: Array<Record<string, unknown>>) {
        if (!Array.isArray(operations)) throw new TypeError("배열 필요");
        if (active) throw new TypeError("중첩 호출");
        active = true;
        try {
          const operationCount = operations.length;
          if (operationCount > 256) throw new TypeError("작업 수 제한");
          const normalized: Array<Record<string, unknown>> = [];
          let batchStringUnits = 0;
          const readInteger = (value: unknown) => {
            if (
              typeof value !== "number" ||
              !Number.isInteger(value) ||
              value < -2_147_483_648 ||
              value > 2_147_483_647
            ) {
              throw new TypeError("정수 필드 형식 오류");
            }
            return value;
          };
          const readString = (value: unknown, maximum: number) => {
            if (typeof value !== "string" || value.length > maximum) {
              throw new TypeError("문자열 필드 형식 또는 길이 오류");
            }
            batchStringUnits += value.length;
            if (batchStringUnits > 1_048_576) throw new TypeError("묶음 문자열 상한");
            return value;
          };
          const readName = (value: unknown) => {
            const name = readString(value, 1024);
            if (!isWellFormedUtf16(name)) throw new TypeError("이름 UTF-16 오류");
            return name;
          };
          for (let index = 0; index < operationCount; index += 1) {
            const operation = operations[index];
            if (operation === undefined) throw new TypeError("빈 작업 슬롯");
            const type = operation.type;
            if (typeof type !== "string" || type.length > 32) {
              throw new TypeError("작업 종류 문자열 형식 또는 길이 오류");
            }
            const parsed: Record<string, unknown> = { type };
            if (type === "createElement") {
              parsed.id = readInteger(operation.id);
              parsed.name = readName(operation.name);
              parsed.namespace = readName(
                operation.namespace ?? "http://www.w3.org/1999/xhtml",
              );
            } else if (type === "createText") {
              parsed.id = readInteger(operation.id);
              parsed.data = readString(operation.data, 1_048_576);
            } else if (type === "append" || type === "remove") {
              parsed.parent = readInteger(operation.parent);
              parsed.node = readInteger(operation.node);
            } else if (type === "insertBefore") {
              parsed.parent = readInteger(operation.parent);
              parsed.node = readInteger(operation.node);
              parsed.before = readInteger(operation.before);
            } else if (type === "setText") {
              parsed.node = readInteger(operation.node);
              parsed.data = readString(operation.data, 1_048_576);
            } else if (type === "setAttribute") {
              parsed.node = readInteger(operation.node);
              parsed.name = readName(operation.name);
              parsed.value = readString(operation.value, 1_048_576);
            } else if (type === "removeAttribute") {
              parsed.node = readInteger(operation.node);
              parsed.name = readName(operation.name);
            } else {
              throw new TypeError("지원하지 않는 변경 종류");
            }
            normalized.push(parsed);
          }
          batches.push(normalized);

          const nextNodes = new Map(nodes);
          const nextTextValues = new Map(textValues);
          const nextConnected = new Set(connected);
          let changed = false;
          for (const operation of normalized) {
            const type = operation.type;
            const id = operation.id as number | undefined;
            const node = operation.node as number | undefined;
            if (type === "createElement" || type === "createText") {
              if (id === undefined || id <= 0 || nextNodes.has(id)) {
                throw new TypeError("중복 노드");
              }
              nextNodes.set(id, type === "createElement" ? "element" : "text");
              if (type === "createText") nextTextValues.set(id, operation.data as string);
              changed = true;
            } else if (type === "append") {
              if (!nextNodes.has(node as number)) throw new TypeError("없는 노드");
              nextConnected.add(node as number);
              if (operation.parent !== 0) nextConnected.add(operation.parent as number);
              changed = true;
            } else if (type === "insertBefore") {
              if (!nextNodes.has(node as number)) throw new TypeError("없는 노드");
              if (operation.parent !== 0 && !nextNodes.has(operation.parent as number)) {
                throw new TypeError("없는 부모");
              }
              nextConnected.add(node as number);
              if (operation.parent !== 0) nextConnected.add(operation.parent as number);
              changed = true;
            } else if (type === "remove") {
              if (!nextNodes.has(node as number)) throw new TypeError("없는 노드");
              nextConnected.delete(node as number);
              changed = true;
            } else if (type === "setText") {
              if (nextNodes.get(node as number) !== "text") throw new TypeError("텍스트 노드 아님");
              const value = operation.data as string;
              if (nextTextValues.get(node as number) !== value) {
                nextTextValues.set(node as number, value);
                changed = true;
              }
            } else if (type === "setAttribute") {
              if (nextNodes.get(node as number) !== "element") throw new TypeError("요소가 아님");
              changed = true;
            } else if (type === "removeAttribute") {
              if (nextNodes.get(node as number) !== "element") throw new TypeError("요소가 아님");
              changed = true;
            } else {
              throw new TypeError("지원하지 않는 작업");
            }
          }

          if (changed) {
            nodes = nextNodes;
            textValues = nextTextValues;
            connected = nextConnected;
            documentRevision += 1n;
            if (normalized.some((operation) => operation.type === "append") ||
                normalized.some((operation) => operation.type === "setText" && connected.has(operation.node as number))) {
              renderTreeRevision += 1n;
            }
          }
          return {
            changed,
            documentRevision,
            renderTreeRevision,
            nodeCount: BigInt(nodes.size),
          };
        } finally {
          active = false;
        }
      },
    },
    onEvent(handler: (nodeId: number) => void) {
      eventHandler = handler;
    },
  };

  new Function("spinon", source)(host);
  expect(batches).toEqual([
    [
      {
        type: "createElement",
        id: 1,
        name: "div",
        namespace: "http://www.w3.org/1999/xhtml",
      },
      { type: "createText", id: 2, data: "ready" },
      { type: "append", parent: 0, node: 1 },
      { type: "append", parent: 1, node: 2 },
      { type: "setAttribute", node: 1, name: "class", value: "counter" },
    ],
    [{ type: "setText", node: 999, data: "must roll back" }],
    [
      { type: "createText", id: 3, data: "temporary" },
      { type: "append", parent: 1, node: 3 },
      { type: "insertBefore", parent: 1, node: 3, before: 2 },
      { type: "setText", node: 2, data: "\uD800" },
      { type: "setText", node: 2, data: "ready" },
      { type: "setAttribute", node: 1, name: "data-temp", value: "yes" },
      { type: "removeAttribute", node: 1, name: "data-temp" },
      { type: "remove", parent: 1, node: 3 },
    ],
    [],
    [{ type: "setText", node: 2, data: "ready" }],
  ]);
  expect(createdNodes).toEqual([[1, "view"]]);
  expect(texts).toEqual(["문서 revision 1 · 노드 2"]);
  expect(eventHandler).toBeDefined();

  eventHandler?.(7);
  expect(batches.at(-1)).toEqual([
    { type: "setText", node: 2, data: "이벤트:7" },
  ]);
  expect(createdNodes).toEqual([
    [1, "view"],
    [8, "text"],
  ]);
  expect(texts.at(-1)).toBe("이벤트:7 · 문서 revision 3");
});
