// The one test both hosts sit: what "keeping state" has to mean, whoever is keeping it.
//
// ⛔ ONE FUNCTION, RUN FROM TWO TEST FILES. `test/host-node.test.ts` runs it over the Node host and
//    the SDK's `test/host-browser.test.ts` runs it over the browser one. Two tests written
//    separately would drift, and the way that drift shows up is a half-finished upload that
//    resumes on a laptop and starts again in a browser — the same account, the same file, two
//    answers.
//
// ⛔ IT REPORTS EVERY VIOLATION RATHER THAN THROWING AT THE FIRST. A host that is wrong is usually
//    wrong about one thing; a list says which, and a caller that wanted an assertion gets one by
//    asserting the list is empty.
//
// ⚠ IT WRITES. The keys all sit under `contract/`, which nothing else uses, and each one is
//   removed before the function returns — including when a check above it failed.

import type { Host } from "./host.ts";

/** Where this check keeps its scratch. Nothing else in the package writes under it. */
const AREA = "contract";

function sample(length: number, seed: number): Uint8Array {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) out[i] = (i * 31 + seed) & 0xff;
  return out;
}

function same(left: Uint8Array | undefined, right: Uint8Array): boolean {
  if (left === undefined || left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) if (left[i] !== right[i]) return false;
  return true;
}

/**
 * Put a host's state through everything the package relies on, and say what it got wrong.
 *
 * An empty array is a pass.
 */
export async function hostContract(host: Host): Promise<string[]> {
  const state = host.state;
  const problems: string[] = [];
  const one = `${AREA}/one`;
  const two = `${AREA}/two`;
  const big = `${AREA}/big`;
  const say = (what: string): void => void problems.push(what);

  try {
    // A key nothing has written is not an error and not empty bytes: it is nothing.
    if ((await state.read(`${AREA}/never-written`)) !== undefined) {
      say("read() of a key that was never written answered bytes instead of undefined");
    }

    const first = sample(64, 1);
    await state.write(one, first);
    if (!same(await state.read(one), first)) say("read() did not hand back the bytes write() was given");

    // ⛔ THE SECOND WRITE REPLACES. A store that appended, or that kept the first value, would make
    //    every record in the package grow a second version nobody reads.
    const second = sample(96, 2);
    await state.write(one, second);
    if (!same(await state.read(one), second)) say("writing a key a second time did not replace what was there");

    await state.write(two, sample(8, 3));
    const listed = await state.keys(`${AREA}/`);
    for (const key of [one, two]) {
      if (!listed.includes(key)) say(`keys("${AREA}/") did not include ${key}`);
    }
    if (listed.includes(`${AREA}/never-written`)) say("keys() listed a key that was never written");

    await state.remove(one);
    if ((await state.read(one)) !== undefined) say("remove() left the bytes readable");
    if ((await state.keys(`${AREA}/`)).includes(one)) say("remove() left the key in keys()");
    // Removing what is not there is how every caller here clears a record it may never have made.
    await state.remove(one);

    // ⛔ ONE MEBIBYTE, BECAUSE THAT IS WHAT AN UPLOAD KEEPS. A reservation holds a sealed part, and
    //    a store that quietly truncated or refused at some smaller size would lose exactly the
    //    records that let a large upload resume — and nothing else would notice.
    const large = sample(1024 * 1024, 4);
    await state.write(big, large);
    if (!same(await state.read(big), large)) say("a 1 MiB value did not come back as it was written");
  } catch (error) {
    say(`a call threw instead of answering: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    for (const key of [one, two, big]) {
      try {
        await state.remove(key);
      } catch {
        // The store is somebody else's; a scratch key left behind is not this check's to report.
      }
    }
  }
  return problems;
}
