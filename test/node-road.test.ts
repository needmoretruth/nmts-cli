// The last road (D51): the Walrus storage nodes, straight from this machine.
//
// WHAT THIS PINS.
//   ① Mysten's relay blocked: the run takes the storage nodes before anything is priced, with
//     64 MiB parts and no tip, and the own relay is kept only as the fallback for a part the nodes
//     did not take (owner 11-09: the server the owner pays for is the last road).
//   ② A credit upload on that road is reserved with no tip.
//   ③ Reads: dozens of aggregators are asked as a staggered race, so dead ones cost the hedge and
//     not a minute each; three 404s end the read without asking the rest.

import { strict as assert } from "node:assert";
import { test } from "node:test";

import { forgetReach, useReach } from "../src/reach.ts";
import { buyAndPushPart } from "../src/upload.ts";
import {
  chooseUploadRoad,
  isTipFree,
  NODE_ROAD,
  OWN_RELAY_PART_BYTES,
  ownRelayFallback,
  partSizeForRoad,
  resetUploadRoad,
  uploadRelay,
} from "../src/upload-road.ts";
import { AGGREGATOR_HOSTS, readBlob, RELAY_HOSTS } from "../src/walrus.ts";
import { apiThat, inputFor, isolate, protocolThat } from "./upload-fixture.ts";

const MYSTEN = RELAY_HOSTS.mainnet[0];
const SERVER = "https://nmts.example";
const GiB = 2 ** 30;

const blocked: typeof fetch = async (input) => {
  if (String(input).startsWith(MYSTEN)) throw new TypeError("blocked: Mysten's relay host does not answer");
  return new Response("not here", { status: 404 });
};

test("① Mysten blocked: the storage nodes first, small parts, no tip; the own relay only behind them", async (t) => {
  t.after(resetUploadRoad);
  assert.equal(await chooseUploadRoad({ network: "mainnet", server: SERVER, apiKey: "key-1", probe: blocked }), true);
  assert.equal(uploadRelay("mainnet"), NODE_ROAD);
  assert.equal(partSizeForRoad(GiB), OWN_RELAY_PART_BYTES);
  assert.equal(isTipFree(uploadRelay("mainnet")), true);
  assert.equal(ownRelayFallback(), `${SERVER}/v1/relay`);

  const answering: typeof fetch = async () => Response.json({ send_tip: { address: "0x1", kind: { const: 1 } } });
  assert.equal(await chooseUploadRoad({ network: "mainnet", server: SERVER, apiKey: "key-1", probe: answering }), false);
  assert.equal(uploadRelay("mainnet"), MYSTEN);
  assert.equal(ownRelayFallback(), null);
});

test("①b Mysten blocked: wallet and credit uploads take Studio Mirai at today's tip; a raised tip sends credit to the nodes", async (t) => {
  t.after(resetUploadRoad);
  const other = RELAY_HOSTS.mainnet[1];
  assert.ok(other !== undefined, "a second company relay is listed");
  const asked: string[] = [];
  const onlyOther = (base: number, perKib: number): typeof fetch => async (input) => {
    asked.push(String(input));
    if (String(input).startsWith(other)) {
      return Response.json({ send_tip: { address: "0x2", kind: { linear: { base, encoded_size_mul_per_kib: perKib } } } });
    }
    throw new TypeError("blocked");
  };
  // Today's mainnet tip-config (2026-11-10).
  const today = onlyOther(3_000_000, 60);
  assert.equal(await chooseUploadRoad({ network: "mainnet", server: SERVER, apiKey: "k", probe: today, otherCompanies: true }), false);
  assert.equal(uploadRelay("mainnet"), other);
  assert.equal(isTipFree(uploadRelay("mainnet")), false, "the person pays that relay's tip, shown before signing");
  assert.equal(partSizeForRoad(GiB), GiB, "a company relay takes the parts Mysten's would");
  assert.equal(ownRelayFallback(), null);

  assert.equal(await chooseUploadRoad({ network: "mainnet", server: SERVER, apiKey: "k", probe: today, credit: true }), false);
  assert.equal(uploadRelay("mainnet"), other, "under three times Mysten's formula at every size, so the treasury tips it");

  // Raised above three times Mysten's formula for a small blob: a credit upload goes to the nodes.
  const raised = onlyOther(9_000_000, 60);
  assert.equal(await chooseUploadRoad({ network: "mainnet", server: SERVER, apiKey: "k", probe: raised, credit: true }), true);
  assert.equal(uploadRelay("mainnet"), NODE_ROAD, "the treasury does not pay that tip");
  // The person still may: their wallet pays and they see it.
  assert.equal(await chooseUploadRoad({ network: "mainnet", server: SERVER, apiKey: "k", probe: raised, otherCompanies: true }), false);
  assert.equal(uploadRelay("mainnet"), other);

  // A library caller that says neither asks Mysten alone.
  asked.length = 0;
  assert.equal(await chooseUploadRoad({ network: "mainnet", server: SERVER, apiKey: "k", probe: today }), true);
  assert.equal(uploadRelay("mainnet"), NODE_ROAD);
  assert.deepEqual(asked, [`${MYSTEN}/v1/tip-config`]);
});

test("② a credit part bought for the storage nodes is reserved with no tip", async () => {
  isolate();
  const { api } = apiThat();
  let relay: unknown = "unset";
  const watched = {
    ...api,
    async reserve(body: Parameters<typeof api.reserve>[0]) {
      relay = body.relay;
      return api.reserve(body);
    },
  };
  await buyAndPushPart({ ...inputFor(watched, protocolThat(), "node-road-key"), relayUrl: NODE_ROAD });
  assert.equal(relay, null);
});

const BLOB = "AlGDPxmnDlJsmfA8VEQB9kO5tnEMy-o54wbTKahpZbA";

test("③ every working aggregator in the registry is a read road, pinned rows first", () => {
  assert.deepEqual(AGGREGATOR_HOSTS.mainnet?.slice(0, 2), [
    "https://aggregator.walrus-mainnet.walrus.space",
    "https://sui-walrus-mainnet-aggregator.bwarelabs.com",
  ]);
  assert.ok((AGGREGATOR_HOSTS.mainnet?.length ?? 0) >= 10, "the probed registry rows are in the list");
  assert.ok((AGGREGATOR_HOSTS.testnet?.length ?? 0) >= 10);
});

test("③ ten dead aggregators first cost seconds, not ten minutes", async (t) => {
  const hosts = AGGREGATOR_HOSTS.mainnet ?? [];
  const live = hosts[10] ?? "";
  const asked: string[] = [];
  useReach({
    fetch: (input, init) => {
      const url = String(input);
      asked.push(url);
      if (url.startsWith(live)) return Promise.resolve(new Response(new Uint8Array([1, 2, 3])));
      // The first four take the connection and never answer; the next six refuse it.
      if (asked.length <= 4) {
        return new Promise((_, reject) =>
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))),
        );
      }
      return Promise.reject(new TypeError("connection refused"));
    },
  });
  t.after(forgetReach);
  const started = Date.now();
  const bytes = await readBlob("mainnet", BLOB);
  const took = Date.now() - started;
  assert.deepEqual([...bytes], [1, 2, 3]);
  // One more every 1.5 s while the hanging ones wait, one more at once after each refusal: about 6 s.
  assert.ok(took < 10_000, `took ${took} ms`);
  assert.ok(asked.length >= 11);
});

test("③ three 404s and nothing else end the read as 'not found' at once", async (t) => {
  let asked = 0;
  useReach({
    fetch: async () => {
      asked++;
      return new Response("", { status: 404 });
    },
  });
  t.after(forgetReach);
  await assert.rejects(readBlob("mainnet", BLOB), /could not be read/);
  assert.ok(asked <= 6, `asked ${asked} hosts`);
});
