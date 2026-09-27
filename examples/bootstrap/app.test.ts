import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

test("예제 번들이 호스트 콜백을 호출하고 네이티브 이벤트를 처리한다", () => {
  const source = readFileSync("app.js", "utf8");
  const nodes: Array<{ id: number; tag: string }> = [];
  const texts: string[] = [];
  let eventHandler: ((nodeId: number) => void) | undefined;

  const host = {
    createNode(id: number, tag: string) {
      nodes.push({ id, tag });
    },
    setText(text: string) {
      texts.push(text);
    },
    onEvent(handler: (nodeId: number) => void) {
      eventHandler = handler;
    },
  };

  new Function("spinon", source)(host);
  expect(nodes).toEqual([{ id: 1, tag: "view" }]);
  expect(texts).toEqual(["ready"]);
  expect(eventHandler).toBeDefined();

  eventHandler?.(7);
  expect(nodes.at(-1)).toEqual({ id: 8, tag: "text" });
  expect(texts.at(-1)).toBe("이벤트:7");
});
