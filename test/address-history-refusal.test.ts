// The command-line copy of the history reader on a node refusal in words it has never seen (2026-11-09).
// `nmts wallet activity` and `nmts wallet list` ask the same question the browser does; the 2026-11-08
// reader threw on such a refusal, so one rephrased sentence in a node's reply failed both commands
// although Sui's GraphQL service held the whole history. The web suite holds the full rules
// (`web/test/address-history.test.ts`); this pins that the copy the CLI ships behaves the same.
import { strict as assert } from "node:assert";
import { test } from "node:test";

import { addressTransactions, graphqlHistory, hasAddressHistory, SUI_GRAPHQL_URLS } from "../src/shared/lib/wallet/address-history.ts";

const ADDRESS = `0x${"b".repeat(64)}`;

/** A node whose every history read fails with `message`. */
function refusingNode(message: string): Parameters<typeof addressTransactions>[0] {
  const client = {
    ledgerService: {
      listTransactions() {
        return {
          responses: (async function* (): AsyncGenerator<never> {
            throw new Error(message);
          })(),
        };
      },
    },
  };
  // The fake implements the one method the reader calls; the SDK's own type has dozens more.
  return client as unknown as Parameters<typeof addressTransactions>[0];
}

/** Sui's GraphQL answer with one transaction, as the service sends it. */
function graphqlAnswer(): Response {
  const node = {
    digest: "FROM-GRAPHQL",
    transactionJson: {
      digest: "FROM-GRAPHQL",
      sender: ADDRESS,
      kind: { programmableTransaction: { inputs: [], commands: [] } },
      gasPayment: { objects: [], owner: ADDRESS, price: "1000", budget: "2000000" },
      expiration: { kind: "NONE" },
    },
    effects: {
      status: "SUCCESS",
      timestamp: "2026-08-09T08:30:10.227Z",
      checkpoint: { sequenceNumber: 7 },
      balanceChangesJson: [{ address: ADDRESS, coinType: "0x2::sui::SUI", amount: "-1000" }],
    },
  };
  return new Response(JSON.stringify({ data: { transactions: { nodes: [node] } } }), { status: 200 });
}

test("an unseen node refusal is answered from GraphQL, and the first GraphQL service failing moves to the second", async () => {
  const asked: string[] = [];
  const fetchFn = async (input: string): Promise<Response> => {
    asked.push(input);
    return asked.length === 1 ? new Response("unavailable", { status: 503 }) : graphqlAnswer();
  };
  const deeper = graphqlHistory(SUI_GRAPHQL_URLS.mainnet, fetchFn);
  const node = refusingNode("FAILED_PRECONDITION: history before checkpoint 391000000 is no longer served");
  const history = await addressTransactions(node, ADDRESS, 5, undefined, deeper);
  assert.deepEqual(history.transactions.map((tx) => tx.digest), ["FROM-GRAPHQL"]);
  assert.equal(history.complete, true);
  assert.deepEqual(asked, [...SUI_GRAPHQL_URLS.mainnet]);
  asked.length = 0;
  assert.equal(await hasAddressHistory(node, ADDRESS, undefined, deeper), true);
});
