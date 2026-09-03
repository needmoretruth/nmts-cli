// Asking the person, once per share, over the protocol.
//
// ⛔ EVERY TEST HERE IS BUILT TO FAIL FOR ONE REASON. The thing being protected is that a file is
//    not handed to somebody without a person saying so, and a test that passes for two different
//    reasons cannot tell you which one broke.

import { strict as assert } from "node:assert";
import { Readable } from "node:stream";
import { test } from "node:test";

import { askerFor, declaredElicitation, readAnswer, CONFIRM_SCHEMA, type Asker } from "../src/mcp-ask.ts";
import { serve, type ToolDefinition } from "../src/mcp.ts";
import { CANNOT_ASK, SAID_NO, confirmShare } from "../src/mcp-tools/share.ts";
import { PRODUCT_NAME, VERSION } from "../src/product.ts";

const INFO = { name: PRODUCT_NAME, version: VERSION };

test("only an accept with the box ticked is a yes", () => {
  assert.equal(readAnswer({ action: "accept", content: { confirm: true } }), "yes");
});

test("every other answer the protocol allows is a no", () => {
  // ⛔ `decline` and `cancel` mean different things to a server that has something else to offer.
  //    This one does not, so both are the same refusal — and an accept with the box left off is
  //    the case a client produces when somebody reads the question and does not agree.
  for (const answer of [
    { action: "accept", content: { confirm: false } },
    { action: "accept" },
    { action: "accept", content: {} },
    { action: "decline" },
    { action: "cancel" },
    { action: "accept", content: { confirm: "true" } },
    null,
    "yes",
    {},
  ]) {
    assert.equal(readAnswer(answer), "no", `${JSON.stringify(answer)} must not be read as a yes`);
  }
});

test("a client is only asked when it said it could be asked", () => {
  assert.equal(declaredElicitation({ elicitation: {} }), true);
  assert.equal(declaredElicitation({ elicitation: { anything: 1 } }), true);
  // A declaration that is not an object is not the declaration the specification describes.
  for (const capabilities of [{}, { elicitation: true }, { elicitation: null }, null, undefined, { tools: {} }]) {
    assert.equal(declaredElicitation(capabilities), false, `${JSON.stringify(capabilities)} is not a declaration`);
  }
});

test("no declaration means no asker at all, rather than an asker that always says no", () => {
  // The difference matters: the caller turns `null` into "run it in a terminal instead", and a
  // silent no would tell the person their share was refused by somebody.
  assert.equal(
    askerFor({ tools: {} }, () => Promise.reject(new Error("must not be sent"))),
    null,
  );
});

test("the question goes out as elicitation/create with the one-boolean schema", async () => {
  const sent: { method: string; params: Record<string, unknown> }[] = [];
  const ask = askerFor({ elicitation: {} }, (method, params) => {
    sent.push({ method, params });
    return Promise.resolve({ action: "accept", content: { confirm: true } });
  });
  assert.notEqual(ask, null);
  if (ask === null) return;
  assert.equal(await ask("share it?"), "yes");
  assert.equal(sent.length, 1);
  assert.equal(sent[0]?.method, "elicitation/create");
  assert.equal(sent[0]?.params["message"], "share it?");
  assert.deepEqual(sent[0]?.params["requestedSchema"], CONFIRM_SCHEMA);
});

test("a client that declared it can be asked and then fails is a no, not a hang", async () => {
  const ask = askerFor({ elicitation: {} }, () => Promise.reject(new Error("client blew up")));
  assert.notEqual(ask, null);
  if (ask === null) return;
  assert.equal(await ask("share it?"), "no");
});

test("the refusal for a client that cannot be asked names the way round it", () => {
  // ⛔ A refusal with no way forward is a dead end, and this is the one refusal a person meets
  //    through no fault of their own — their client simply cannot show a question.
  assert.match(CANNOT_ASK, /nmts share/);
});

test("with no mode set, no asker means refused rather than shared", async () => {
  assert.equal(await confirmShare("off", null, "a.txt", "CODE"), CANNOT_ASK);
});

test("with no mode set, a no is refused and says nothing happened", async () => {
  assert.equal(await confirmShare("off", () => Promise.resolve("no"), "a.txt", "CODE"), SAID_NO);
});

test("with no mode set, a yes goes ahead", async () => {
  assert.equal(await confirmShare("off", () => Promise.resolve("yes"), "a.txt", "CODE"), null);
});

test("the question names the file and the code, because that is what is being checked", async () => {
  let asked = "";
  await confirmShare(
    "off",
    (message) => {
      asked = message;
      return Promise.resolve("yes");
    },
    "reports/q3.pdf",
    "PUB-1234",
  );
  assert.match(asked, /reports\/q3\.pdf/);
  assert.match(asked, /PUB-1234/);
});

test("a mode that is on is the answer already given, and nothing is asked", async () => {
  // ⛔ The person typed a flag that spells out the risk to turn one of these on. Asking anyway
  //    would be overriding the setting they made, in the one case where nobody is there to answer.
  for (const mode of ["auto", "skip-permissions"] as const) {
    let asked = 0;
    const refusal = await confirmShare(
      mode,
      () => {
        asked += 1;
        return Promise.resolve("no");
      },
      "a.txt",
      "CODE",
    );
    assert.equal(refusal, null, `${mode} must go ahead`);
    assert.equal(asked, 0, `${mode} must not put a question in front of anybody`);
  }
});

/** Drive `serve` over a pipe the way a client does, collecting every line it writes. */
async function session(
  lines: unknown[],
  tools: readonly ToolDefinition[],
  answer: (request: Record<string, unknown>) => unknown,
  onAsker?: (asker: Asker) => void,
): Promise<Record<string, unknown>[]> {
  const written: Record<string, unknown>[] = [];
  const input = new Readable({ read() {} });
  const output = (line: string) => {
    const parsed: unknown = JSON.parse(line);
    if (typeof parsed !== "object" || parsed === null) return;
    // Narrowed by the two checks above; JSON.parse gives no type of its own.
    const message: Record<string, unknown> = { ...(parsed as Record<string, unknown>) };
    written.push(message);
    if (typeof message["method"] === "string") {
      // A request FROM the server is answered the way the client under test would answer it.
      input.push(`${JSON.stringify({ jsonrpc: "2.0", id: message["id"], result: answer(message) })}\n`);
      return;
    }
    // ⚠ THE PIPE CLOSES ON THE LAST REPLY, NOT AFTER THE LAST LINE IS PUSHED. A server waiting for
    //   an answer to its own question needs the pipe open to receive it, so the test cannot end
    //   the input until the exchange it is testing has come back.
    if (message["id"] === "done") input.push(null);
  };
  for (const line of lines) input.push(`${JSON.stringify(line)}\n`);
  await serve({ input, output, tools, info: INFO, onAsker });
  return written;
}

/** A tool that asks and reports the answer, so a test can see which branch ran. */
function asking(hold: { asker: Asker }): ToolDefinition {
  return {
    name: "confirm_it",
    description: "asks",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run: async () => {
      const ask = hold.asker;
      if (ask === null) return "no way to ask";
      return await ask("may I?");
    },
  };
}

test("a tool call asks the client and reads the answer that comes back", async () => {
  const hold: { asker: Asker } = { asker: null };
  const written = await session(
    [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { capabilities: { elicitation: {} } } },
      { jsonrpc: "2.0", id: "done", method: "tools/call", params: { name: "confirm_it", arguments: {} } },
    ],
    [asking(hold)],
    (request) => {
      assert.equal(request["method"], "elicitation/create");
      return { action: "accept", content: { confirm: true } };
    },
    (built) => {
      hold.asker = built;
    },
  );
  const call = written.find((m) => m["id"] === "done");
  const result = call?.["result"];
  assert.equal(typeof result, "object");
  const content = result !== null && typeof result === "object" ? Reflect.get(result, "content") : null;
  assert.equal(Array.isArray(content) ? Reflect.get(content[0], "text") : null, "yes");
});

test("an answer from the client is not mistaken for a malformed request", async () => {
  // ⛔ THIS IS WHY THE ROUTING EXISTS. Before it, every answer the client sent came back marked
  //    "not a JSON-RPC 2.0 request" — an error on the wire for a message that was perfectly well
  //    formed, and the tool waiting for it never heard anything.
  const written = await session(
    [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { capabilities: {} } },
      { jsonrpc: "2.0", id: "nmts-999", result: { action: "cancel" } },
      { jsonrpc: "2.0", id: "done", method: "ping" },
    ],
    [],
    () => ({}),
  );
  assert.equal(
    written.some((m) => m["error"] !== undefined),
    false,
    "a stray answer must not put an error on the wire",
  );
});

test("a session whose client declared nothing hands its tools no way to ask", async () => {
  const hold: { asker: Asker } = { asker: null };
  const written = await session(
    [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { capabilities: { tools: {} } } },
      { jsonrpc: "2.0", id: "done", method: "tools/call", params: { name: "confirm_it", arguments: {} } },
    ],
    [asking(hold)],
    () => {
      assert.fail("nothing may be asked of a client that did not declare it");
    },
    (built) => {
      hold.asker = built;
    },
  );
  assert.equal(hold.asker, null);
  const call = written.find((m) => m["id"] === "done");
  const result = call?.["result"];
  const content = result !== null && typeof result === "object" ? Reflect.get(result, "content") : null;
  assert.equal(Array.isArray(content) ? Reflect.get(content[0], "text") : null, "no way to ask");
});
