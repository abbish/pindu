import { test } from "node:test";
import assert from "node:assert/strict";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { withReason } from "./reason.ts";

test("工具多一个必填的 reason，执行时去掉", async () => {
  let received: unknown;
  const tool = withReason(
    defineTool({
      name: "view_image",
      label: "看图片",
      description: "view",
      parameters: Type.Object({ file: Type.String(), scale: Type.Optional(Type.Number()) }),
      async execute(_id, args) {
        received = args;
        return { content: [], details: undefined };
      },
    }),
  );
  const schema = tool.parameters as unknown as { required: string[]; properties: Record<string, unknown> };
  assert.deepEqual(schema.required.sort(), ["file", "reason"]);
  assert.ok("scale" in schema.properties);
  await tool.execute("1", { reason: "看看这张截图", file: "a.png" } as never, undefined, undefined, {} as never);
  assert.deepEqual(received, { file: "a.png" });
});
