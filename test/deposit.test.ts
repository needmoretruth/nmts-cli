// The credit deposit an upload sets aside: refusing a number nobody could have meant, and getting
// the account's own default all the way into the request that spends.
//
// ⛔ THE REFUSAL HAS TO HAPPEN BEFORE THE SERVER IS ASKED ANYTHING. `--deposit 65` is a command
//    line to fix; a run that discovered it after sealing and buying would have spent real money to
//    produce a message about a typo, and one that clamped it into range would set aside an amount
//    nobody typed.
//
// ⛔ AND THE DEFAULT HAS TO SURVIVE THE SEALED LIST. It is a settings field, and a settings field
//    carried by neither direction of the codec is a defect this format has actually had — every
//    save dropped it, on every device, silently. Reading it back through the wire and watching the
//    number land in the reservation body is the only assertion that could fail for that.

import { strict as assert } from "node:assert";
import { after, test } from "node:test";

import { put } from "../src/commands/put.ts";
import { depositDefaultOf } from "../src/deposit.ts";
import { NmtsError } from "../src/errors.ts";
import { DERIVED, loadCrypto } from "../src/crypto.ts";
import {
  settingsFromWire,
  settingsToWire,
} from "../src/shared/lib/drive/manifest-settings.ts";
import { uploadFile, type PlaintextSource } from "../src/upload-file.ts";
import type { ReserveReply } from "../src/upload-wire.ts";
import { collect, entry, startFakeDrive, withSandbox } from "./fake-drive.ts";
import { apiThat, isolate, protocolThat } from "./upload-fixture.ts";
import { generateCode } from "./helpers.ts";

const drive = await startFakeDrive();
after(() => drive.close());

test("⛔ a deposit outside 0 to 64 is refused before anything is asked of the server", async () => {
  await withSandbox(drive, "deposit-range", async (code) => {
    await drive.serve(code, [entry({ id: "a", name: "a.txt" })]);
    for (const bad of ["65", "-1", "1.5", "sixty", "64.0.0"]) {
      const failure = await put("notes.txt", { deposit: bad, write: collect().write }).then(
        () => null,
        (error: unknown) => error,
      );
      assert.ok(failure instanceof NmtsError, `"${bad}" was not refused — ${String(failure)}`);
      assert.equal(failure.exitCode, 2);
      assert.match(failure.message, /--deposit takes a whole number of credits from 0 to 64/);
    }
    assert.deepEqual(drive.calls, [], `it asked the server: ${drive.calls.join(" · ")}`);
  });
});

test("with no --deposit, the account's sealed default is what the reservation carries", async () => {
  isolate();
  // ⛔ THROUGH THE CODEC, not around it. This is the number as another device would read it back
  //    out of the sealed list, which is the only place it lives.
  const settings = settingsFromWire(settingsToWire({ depositDefault: 5 }));
  assert.equal(settings?.depositDefault, 5, "the sealed list dropped the setting");

  const bodies: number[] = [];
  const { api } = apiThat({
    async reserve(body): Promise<ReserveReply> {
      bodies.push(body.deposit_credits);
      return {
        ledger_id: 77,
        state: "registered",
        blob_object_id: "0xblob",
        register_tx_digest: "0xtx",
        credits_spent: 1,
      };
    },
  });

  const crypt = await loadCrypto();
  const [from, to] = DERIVED.dataKey;
  const derived = crypt.kdf_derive(crypt.account_code_parse(await generateCode()));
  const dataKey = derived.slice(from, to);
  derived.fill(0);
  const bytes = new Uint8Array(64).fill(7);
  const source: PlaintextSource = {
    size: bytes.length,
    async *read(offset: number, length: number) {
      yield bytes.subarray(offset, offset + length);
    },
  };

  await uploadFile({
    api,
    protocol: protocolThat(),
    crypt,
    dataKey,
    source,
    name: "notes.txt",
    parentId: null,
    destination: "",
    relayUrl: "https://relay.example",
    epochs: 2,
    currentEpoch: 40,
    partSize: 1024,
    padding: { rule: "padme", unitBytes: 1024 * 1024 },
    depositCredits: depositDefaultOf(settings),
  });
  dataKey.fill(0);

  assert.deepEqual(bodies, [5], "the reservation did not carry the account's own default");
});
