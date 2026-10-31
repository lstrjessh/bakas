import { test } from "node:test";
import assert from "node:assert/strict";
import { createFrameLoader } from "../lib/satellite-frames";

test("a prefetched frame and foreground request share one download", async () => {
  let calls = 0;
  const load = createFrameLoader((async () => {
    calls++;
    await new Promise((r) => setTimeout(r, 10));
    return new Response("png");
  }) as typeof fetch);
  const a = load("20261030075000"),
    b = load("20261030075000");
  assert.equal(a, b);
  assert.equal(await (await a).text(), "png");
  await load("20261030075000");
  assert.equal(calls, 1);
});
test("failed downloads can be retried instead of remaining cached", async () => {
  let calls = 0;
  const load = createFrameLoader(
    (async () =>
      new Response("png", {
        status: ++calls === 1 ? 503 : 200,
      })) as typeof fetch,
  );
  await assert.rejects(load("20261030075000"));
  await load("20261030075000");
  assert.equal(calls, 2);
});
test("frame cache evicts the least recently used frame", async () => {
  let calls = 0;
  const load = createFrameLoader(
    (async () => {
      calls++;
      return new Response("png");
    }) as typeof fetch,
    2,
  );
  await load("20261030075000");
  await load("20261030074000");
  await load("20261030075000");
  await load("20261030073000");
  await load("20261030074000");
  assert.equal(calls, 4);
});
test("invalid frame timestamps never reach the network", async () => {
  const load = createFrameLoader((async () => {
    throw new Error("should not fetch");
  }) as typeof fetch);
  await assert.rejects(load("../../file"), /Invalid satellite timestamp/);
});
