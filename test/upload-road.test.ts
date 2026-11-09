// The second upload road (D50): with Mysten Labs' relay blocked, an upload from this tool goes
// through NMTS's own relay, on a fake one here, and with Mysten answering it never does.
//
// ⛔ IT DRIVES THE SDK'S OWN RELAY CLIENT. The protocol below is the one `put` and `push` use; only
//    the network under it is faked, so the request that reaches the fake relay is the request the
//    real one would get: its address, its credential, and no tip announced.

import { strict as assert } from "node:assert";
import { test } from "node:test";

import { forgetReach, useReach } from "../src/reach.ts";
import { buyAndPushPart } from "../src/upload.ts";
import { chooseUploadRoad, OWN_RELAY_PART_BYTES, partSizeForRoad, resetUploadRoad, uploadRelay } from "../src/upload-road.ts";
import { createBlobProtocol } from "../src/walrus-write.ts";
import { RELAY_HOSTS } from "../src/walrus.ts";
import { apiThat, inputFor, isolate, protocolThat } from "./upload-fixture.ts";

const MYSTEN = RELAY_HOSTS.mainnet[0];
const SERVER = "https://nmts.example";
const GiB = 2 ** 30;

const blocked: typeof fetch = async (input) => {
  if (String(input).startsWith(MYSTEN)) throw new TypeError("blocked: Mysten's relay host does not answer");
  return new Response("not here", { status: 404 });
};

test("Mysten's relay blocked: the run takes the own relay, with 64 MiB parts, before any price", async (t) => {
  t.after(resetUploadRoad);
  assert.equal(await chooseUploadRoad({ network: "mainnet", server: `${SERVER}/`, apiKey: "key-1", probe: blocked }), true);
  assert.equal(uploadRelay("mainnet"), `${SERVER}/v1/relay`);
  assert.equal(partSizeForRoad(GiB), OWN_RELAY_PART_BYTES);
  assert.equal(partSizeForRoad(16 * 2 ** 20), 16 * 2 ** 20);

  const answering: typeof fetch = async () => Response.json({ send_tip: { address: "0x1", kind: { const: 1 } } });
  assert.equal(await chooseUploadRoad({ network: "mainnet", server: SERVER, apiKey: "key-1", probe: answering }), false);
  assert.equal(uploadRelay("mainnet"), MYSTEN);
  assert.equal(partSizeForRoad(GiB), GiB);
});

test("the bytes reach the own relay with the account's key, wait out a busy relay, and announce no tip", async (t) => {
  const seen: { url: string; auth: string | null }[] = [];
  let busyOnce = true;
  useReach({
    fetch: async (input, init) => {
      const url = String(input);
      if (url.startsWith(MYSTEN)) throw new TypeError("blocked");
      if (url.startsWith(`${SERVER}/v1/relay/v1/blob-upload-relay`)) {
        seen.push({ url, auth: new Headers(init?.headers).get("authorization") });
        if (busyOnce) {
          busyOnce = false;
          return new Response(JSON.stringify({ error: { code: "relay_busy" } }), { status: 503, headers: { "retry-after": "1" } });
        }
        return Response.json({
          blob_id: "blob-1",
          confirmation_certificate: { signers: [0, 3], serialized_message: [1, 2, 3], signature: "c2ln" },
        });
      }
      return new Response("not here", { status: 404 });
    },
  });
  t.after(() => {
    forgetReach();
    resetUploadRoad();
  });

  assert.equal(await chooseUploadRoad({ network: "mainnet", server: SERVER, apiKey: "key-1" }), true);
  const protocol = createBlobProtocol("mainnet", 10);
  assert.equal(protocol.relayUrl, `${SERVER}/v1/relay`);
  const certificate = await protocol.uploadToRelay({
    blobId: "blob-1",
    bytes: new Uint8Array(10),
    nonce: new Uint8Array(32),
    registerTxDigest: "0xtx",
    blobObjectId: "0xb",
  });
  assert.deepEqual(certificate.signers, [0, 3]);
  assert.equal(seen.length, 2, "the busy answer is waited out and the same bytes asked again");
  for (const one of seen) {
    assert.equal(one.auth, "Bearer key-1");
    const query = new URL(one.url).searchParams;
    assert.equal(query.get("blob_id"), "blob-1");
    assert.equal(query.get("tx_id"), null, "a no-tip relay is not told which transaction paid a tip");
  }
});

test("a part bought for the own relay is registered with no tip", async () => {
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
  await buyAndPushPart({ ...inputFor(watched, protocolThat(), "road-key"), relayUrl: `${SERVER}/v1/relay` });
  assert.equal(relay, null);
});
