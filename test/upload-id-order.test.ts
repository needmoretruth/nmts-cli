// Upload ids sort in the order the uploads began, even inside one millisecond (2026-11-08).
// `ListMultipartUploads` resumes after an id; with a random tail breaking same-millisecond ties, the
// later of two uploads sorted first half the time and a resumed listing skipped it (the macOS release
// runner hit this in `s3-gateway-paging.test.ts`).
import test from "node:test";
import assert from "node:assert/strict";

import { newUploadId } from "../src/s3/multipart-view.ts";
import { UPLOAD_DIR } from "../src/s3/multipart-sweep.ts";

test("ids begun in the same millisecond still sort in the order they began", () => {
  const frozen = 1_762_540_000_000;
  const ids = Array.from({ length: 200 }, () => newUploadId(frozen));
  for (let i = 1; i < ids.length; i += 1) assert.ok((ids[i - 1] ?? "") < (ids[i] ?? ""), `id ${i} sorts before id ${i - 1}`);
});

test("a clock that steps back does not make a later id sort earlier", () => {
  const a = newUploadId(1_900_000_000_000);
  const b = newUploadId(1_899_999_999_000);
  assert.ok(a < b);
});

test("ids keep the 32-hex shape the sweeper reads", () => {
  const id = newUploadId(Date.now());
  assert.match(`nmts-mpu-${id}`, UPLOAD_DIR);
});
