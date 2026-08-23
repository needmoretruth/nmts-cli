// ⛔ THE DEFECT THESE GUARD. The web app's network variable silently means "testnet" when empty,
//    and a Node process does not refuse the way a production build does. A tool that inherited
//    that would look for a mainnet account's files on testnet and report success.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { NmtsError } from "../src/errors.ts";
import { NETWORK_ENV_VAR, resolveNetwork } from "../src/network.ts";
import { DEFAULT_SERVER } from "../src/server.ts";

function withEnv(value: string | undefined, body: () => void): void {
  const previous = process.env[NETWORK_ENV_VAR];
  if (value === undefined) delete process.env[NETWORK_ENV_VAR];
  else process.env[NETWORK_ENV_VAR] = value;
  try {
    body();
  } finally {
    if (previous === undefined) delete process.env[NETWORK_ENV_VAR];
    else process.env[NETWORK_ENV_VAR] = previous;
  }
}

test("the live server is mainnet without being told", () => {
  withEnv(undefined, () => assert.equal(resolveNetwork(DEFAULT_SERVER), "mainnet"));
});

test("⛔ an EMPTY network variable does not silently mean testnet — it means 'still unset'", () => {
  withEnv("", () => assert.equal(resolveNetwork(DEFAULT_SERVER), "mainnet"));
  withEnv("", () => assert.throws(() => resolveNetwork("http://localhost:3300"), NmtsError));
});

test("⛔ any server that is not the live one must SAY which network, or the run stops", () => {
  withEnv(undefined, () => {
    assert.throws(() => resolveNetwork("http://localhost:3300"), NmtsError);
    assert.throws(() => resolveNetwork("https://staging.example"), NmtsError);
  });
});

test("the refusal explains the cost of guessing rather than just naming the variable", () => {
  withEnv(undefined, () => {
    try {
      resolveNetwork("http://localhost:3300");
      assert.fail("an unknown server was accepted");
    } catch (error) {
      assert.ok(error instanceof NmtsError, "not the tool's own error type");
      // The message says what went wrong; the next step says what to do AND what guessing costs.
      assert.match(error.message, /Cannot tell which storage network/);
      assert.match(error.nextStep ?? "", /NMTS_NETWORK/);
      assert.match(error.nextStep ?? "", /never stored on/);
    }
  });
});

test("an explicit network is taken, and it beats the environment", () => {
  withEnv("mainnet", () => assert.equal(resolveNetwork("http://localhost:3300", "testnet"), "testnet"));
  withEnv(undefined, () => assert.equal(resolveNetwork("http://localhost:3300", "testnet"), "testnet"));
});

test("a network this tool does not know is refused, not passed through", () => {
  withEnv(undefined, () => assert.throws(() => resolveNetwork(DEFAULT_SERVER, "devnet"), NmtsError));
  withEnv("devnet", () => assert.throws(() => resolveNetwork(DEFAULT_SERVER), NmtsError));
});
