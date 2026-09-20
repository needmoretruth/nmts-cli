// Many buckets, and a pair held to one of them.
//
// ⛔ A BUCKET IS AN ACCOUNT, so the question this file answers is the one a business asks first:
//    can a pair I gave one customer reach another customer's account? What makes it answerable at
//    all is that the gateway no longer knows what a bucket is — it asks a resolver — and the
//    resolver here knows two.
//
// ⛔ REAL SOCKETS, NOT A CALLED HANDLER, for the reason `s3-gateway.test.ts` gives: the parsing
//    between a request line and a signature is where a gateway goes wrong.

import { strict as assert } from "node:assert";
import { after, test } from "node:test";
import type { AddressInfo } from "node:net";

import { createGateway, newCredential } from "../src/s3/server.ts";
import type { ManifestEntry } from "../src/shared/lib/drive/manifest-codec.ts";
import { CREDENTIAL, file, readOnly } from "./s3-gateway-drive.ts";
import { sign } from "./s3-sign.ts";

const OTHER: readonly ManifestEntry[] = [file("j1", "theirs.txt", null, 3)];
const HELD_TO_ONE = { ...newCredential(), buckets: ["mine"] };

const many = createGateway({
  credentials: [CREDENTIAL, HELD_TO_ONE],
  bucketOf: (name) => {
    if (name === "mine") return readOnly;
    if (name === "theirs") return { ...readOnly, entries: async () => OTHER };
    return null;
  },
  bucketNames: () => ["mine", "theirs"],
});
await new Promise<void>((resolve) => many.listen(0, "127.0.0.1", resolve));
const MANY_HOST = `127.0.0.1:${(many.address() as AddressInfo).port}`;
after(() => many.close());

async function asPair(
  credential: { accessKeyId: string; secretAccessKey: string },
  target: string,
): Promise<Response> {
  const signed = sign("GET", target, MANY_HOST, credential, new Date());
  return await fetch(signed.url, { method: "GET", headers: signed.headers });
}

test("two buckets are two drives, each listing its own files", async () => {
  const mine = await (await asPair(CREDENTIAL, "/mine?list-type=2&max-keys=1000")).text();
  assert.match(mine, /<Name>mine<\/Name>/);
  assert.match(mine, /<Key>readme\.txt<\/Key>/);
  const theirs = await (await asPair(CREDENTIAL, "/theirs?list-type=2&max-keys=1000")).text();
  assert.match(theirs, /<Name>theirs<\/Name>/);
  assert.match(theirs, /<Key>theirs\.txt<\/Key>/);
  assert.doesNotMatch(theirs, /readme\.txt/, "one bucket answered with another bucket's files");
});

// ⛔ THE ONE THAT KEEPS ONE CUSTOMER OUT OF ANOTHER'S ACCOUNT, and the two answers are the same
//    answer on purpose: a pair that could tell "no such bucket" from "not yours" would be a way to
//    ask whether a business has a customer by that name, one guess at a time.
test("⛔ a pair held to one bucket is refused at another — and at one that does not exist", async () => {
  const theirs = await asPair(HELD_TO_ONE, "/theirs?list-type=2");
  assert.equal(theirs.status, 403);
  const refused = await theirs.text();
  assert.match(refused, /<Code>AccessDenied<\/Code>/);
  assert.doesNotMatch(refused, /theirs\.txt/, "a refusal leaked what is in the bucket");

  const nowhere = await asPair(HELD_TO_ONE, "/no-such-bucket?list-type=2");
  assert.equal(nowhere.status, 403, "a missing bucket answered differently from a forbidden one");
  const bothSay = (body: string): string => body.replace(/<Resource>[^<]*<\/Resource>/, "");
  assert.equal(bothSay(await nowhere.text()), bothSay(refused), "the two refusals are tellable apart");

  // Its own bucket still works, so what was refused was the name and not the pair.
  assert.equal((await asPair(HELD_TO_ONE, "/mine?list-type=2")).status, 200);
});

// ⚠ A bucket name nobody is held to is still `NoSuchBucket` for a pair that may ask about it: the
//   sentence only has to be the same for the caller who may not look.
test("a bucket that is not there is NoSuchBucket for a pair that may ask", async () => {
  const res = await asPair(CREDENTIAL, "/no-such-bucket?list-type=2");
  assert.equal(res.status, 404);
  assert.match(await res.text(), /<Code>NoSuchBucket<\/Code>/);
});

test("ListBuckets names what the presented pair may touch, and nothing else", async () => {
  const all = await (await asPair(CREDENTIAL, "/")).text();
  assert.match(all, /<Name>mine<\/Name>/);
  assert.match(all, /<Name>theirs<\/Name>/);
  const held = await (await asPair(HELD_TO_ONE, "/")).text();
  assert.match(held, /<Name>mine<\/Name>/);
  assert.doesNotMatch(held, /theirs/, "a restricted pair was told a bucket it may not use");
});
