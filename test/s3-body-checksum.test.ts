// The five S3 checksums, held to values nobody in this repository computed.
//
// ⛔ THREE SOURCES, NONE OF THEM OURS. The CRC parameter sets' published check values over
//    "123456789"; the values the AWS SDK for JavaScript v3 put in its trailers for one sentence
//    (the same captures `s3-body-clients.test.ts` replays); and the CRC32C in the AWS
//    documentation's trailing-checksum example. Two of the CRCs are written by hand in
//    `checksum.ts`, so these are the only thing standing between a typo there and a gateway that
//    refuses every upload with a CRC32C or CRC64NVME -- or accepts every one.

import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  CHECKSUM_ALGORITHMS,
  algorithmOfHeader,
  algorithmOfName,
  checksumOf,
  parseChecksumValue,
  runningChecksum,
  type ChecksumAlgorithm,
} from "../src/s3/checksum.ts";

test("the CRCs give their parameter sets' published check values", () => {
  const nine = Buffer.from("123456789");
  const check: ReadonlyArray<readonly [ChecksumAlgorithm, string]> = [
    ["crc32", "cbf43926"],
    ["crc32c", "e3069283"],
    ["crc64nvme", "ae8b14860a799888"],
  ];
  for (const [algorithm, hex] of check) {
    assert.equal(Buffer.from(checksumOf(algorithm, nine), "base64").toString("hex"), hex, algorithm);
  }
});

test("every algorithm gives what the AWS SDK for JavaScript sent for the same bytes", () => {
  const fox = Buffer.from("The quick brown fox jumps over the lazy dog.\n");
  const sent: ReadonlyArray<readonly [ChecksumAlgorithm, string]> = [
    ["crc32", "61DMag=="],
    ["crc32c", "mMP6ww=="],
    ["crc64nvme", "xSkvqfnNkUs="],
    ["sha1", "nATNY3IHfpsR9wyhEcmAfccTfks="],
    ["sha256", "tHzA8QS2LUx8MLzWj9jmdhPih9xK2MMQ7xDLreqcQ4A="],
  ];
  for (const [algorithm, value] of sent) assert.equal(checksumOf(algorithm, fox), value, algorithm);
});

test("CRC32C gives the value in the AWS documentation's trailing-checksum example", () => {
  assert.equal(checksumOf("crc32c", Buffer.alloc(66_560, "a")), "sOO8/Q==");
});

test("a checksum fed in pieces equals the checksum of the whole", () => {
  const bytes = Buffer.from(Array.from({ length: 10_000 }, (_, i) => (i * 131 + 7) & 0xff));
  for (const algorithm of CHECKSUM_ALGORITHMS) {
    const running = runningChecksum(algorithm);
    for (let at = 0; at < bytes.length; at += 333) running.update(bytes.subarray(at, at + 333));
    assert.equal(running.digest().toString("base64"), checksumOf(algorithm, bytes), algorithm);
  }
});

test("⛔ a checksum value is taken only as canonical base64 of its algorithm's length", () => {
  assert.equal(parseChecksumValue("crc32", "61DMag==")?.toString("hex"), "eb50cc6a");
  assert.equal(parseChecksumValue("crc32", "61DMag"), null, "padding left off");
  assert.equal(parseChecksumValue("crc32", "61DMah=="), null, "not canonical");
  assert.equal(parseChecksumValue("crc32", "xSkvqfnNkUs="), null, "a CRC64 where a CRC32 goes");
  assert.equal(parseChecksumValue("sha256", "not base64 at all!"), null);
  assert.equal(parseChecksumValue("crc64nvme", " xSkvqfnNkUs= ")?.length, 8, "surrounding space is not the value");
});

test("header and algorithm names are read the way S3 spells them", () => {
  assert.equal(algorithmOfHeader("x-amz-checksum-crc32c"), "crc32c");
  assert.equal(algorithmOfHeader("X-Amz-Checksum-CRC64NVME"), "crc64nvme");
  assert.equal(algorithmOfHeader("x-amz-checksum-md5"), null);
  assert.equal(algorithmOfHeader("x-amz-checksum-type"), null);
  assert.equal(algorithmOfName("CRC32C"), "crc32c");
  assert.equal(algorithmOfName("MD5"), null);
});
