// `aws-chunked` uploads exactly as real S3 clients sent them, replayed over a real socket into the
// signature check and the body decoder. Why captures, and how they were made: `s3-body-captures.ts`.

import { strict as assert } from "node:assert";
import { after, test } from "node:test";

import { FOX, replayer, type Capture } from "./s3-body-captures.ts";

const CAPTURES: readonly Capture[] = [
  {
    name: "AWS SDK for JavaScript v3, PutObject, stream body (default CRC32 trailer)",
    method: "PUT",
    url: "/drive/stream-default.txt?x-id=PutObject",
    headers: {
      "host": "127.0.0.1:41787",
      "content-type": "application/octet-stream",
      "x-amz-sdk-checksum-algorithm": "CRC32",
      "content-encoding": "aws-chunked",
      "transfer-encoding": "chunked",
      "x-amz-decoded-content-length": "45",
      "x-amz-content-sha256": "STREAMING-UNSIGNED-PAYLOAD-TRAILER",
      "x-amz-trailer": "x-amz-checksum-crc32",
      "x-amz-user-agent": "aws-sdk-js/3.1137.0",
      "amz-sdk-invocation-id": "58c82565-e698-4171-988e-33da73d88a2b",
      "amz-sdk-request": "attempt=1; max=3",
      "x-amz-date": "20260924T013316Z",
      "authorization": "AWS4-HMAC-SHA256 Credential=NMTSEXAMPLEKEYID0001/20260924/us-east-1/s3/aws4_request, SignedHeaders=amz-sdk-invocation-id;amz-sdk-request;content-encoding;content-type;host;x-amz-content-sha256;x-amz-date;x-amz-decoded-content-length;x-amz-sdk-checksum-algorithm;x-amz-trailer;x-amz-user-agent, Signature=b844de393b59136c981c3615aa3a1a408ecb3f4ab3860273d0459a43e556b29d",
    },
    body: "14\r\nThe quick brown fox \r\n19\r\njumps over the lazy dog.\n\r\n0\r\nx-amz-checksum-crc32:61DMag==\r\n\r\n",
  },
  {
    name: "AWS SDK for JavaScript v3, PutObject, stream body, ChecksumAlgorithm CRC32C",
    method: "PUT",
    url: "/drive/stream-CRC32C.txt?x-id=PutObject",
    headers: {
      "host": "127.0.0.1:41787",
      "x-amz-sdk-checksum-algorithm": "CRC32C",
      "content-type": "application/octet-stream",
      "content-encoding": "aws-chunked",
      "transfer-encoding": "chunked",
      "x-amz-decoded-content-length": "45",
      "x-amz-content-sha256": "STREAMING-UNSIGNED-PAYLOAD-TRAILER",
      "x-amz-trailer": "x-amz-checksum-crc32c",
      "x-amz-user-agent": "aws-sdk-js/3.1137.0",
      "amz-sdk-invocation-id": "a9b019bf-9671-4a6c-9080-49faacfaa094",
      "amz-sdk-request": "attempt=1; max=3",
      "x-amz-date": "20260924T013316Z",
      "authorization": "AWS4-HMAC-SHA256 Credential=NMTSEXAMPLEKEYID0001/20260924/us-east-1/s3/aws4_request, SignedHeaders=amz-sdk-invocation-id;amz-sdk-request;content-encoding;content-type;host;x-amz-content-sha256;x-amz-date;x-amz-decoded-content-length;x-amz-sdk-checksum-algorithm;x-amz-trailer;x-amz-user-agent, Signature=424ff53594c19ad2b7a83140cefa03b63ec8d44cdd8aadd0be121910d326cd34",
    },
    body: "14\r\nThe quick brown fox \r\n19\r\njumps over the lazy dog.\n\r\n0\r\nx-amz-checksum-crc32c:mMP6ww==\r\n\r\n",
  },
  {
    name: "AWS SDK for JavaScript v3, PutObject, stream body, ChecksumAlgorithm SHA256",
    method: "PUT",
    url: "/drive/stream-SHA256.txt?x-id=PutObject",
    headers: {
      "host": "127.0.0.1:41787",
      "x-amz-sdk-checksum-algorithm": "SHA256",
      "content-type": "application/octet-stream",
      "content-encoding": "aws-chunked",
      "transfer-encoding": "chunked",
      "x-amz-decoded-content-length": "45",
      "x-amz-content-sha256": "STREAMING-UNSIGNED-PAYLOAD-TRAILER",
      "x-amz-trailer": "x-amz-checksum-sha256",
      "x-amz-user-agent": "aws-sdk-js/3.1137.0",
      "amz-sdk-invocation-id": "174eb1e7-49f6-442a-95aa-f6c39b6ea3d7",
      "amz-sdk-request": "attempt=1; max=3",
      "x-amz-date": "20260924T013316Z",
      "authorization": "AWS4-HMAC-SHA256 Credential=NMTSEXAMPLEKEYID0001/20260924/us-east-1/s3/aws4_request, SignedHeaders=amz-sdk-invocation-id;amz-sdk-request;content-encoding;content-type;host;x-amz-content-sha256;x-amz-date;x-amz-decoded-content-length;x-amz-sdk-checksum-algorithm;x-amz-trailer;x-amz-user-agent, Signature=2480e7486cfb74b3b24dc3c66742c3af66c16e836e918a3f039eeddda0b756d1",
    },
    body: "14\r\nThe quick brown fox \r\n19\r\njumps over the lazy dog.\n\r\n0\r\nx-amz-checksum-sha256:tHzA8QS2LUx8MLzWj9jmdhPih9xK2MMQ7xDLreqcQ4A=\r\n\r\n",
  },
  {
    name: "AWS SDK for JavaScript v3, PutObject, stream body, ChecksumAlgorithm SHA1",
    method: "PUT",
    url: "/drive/stream-SHA1.txt?x-id=PutObject",
    headers: {
      "host": "127.0.0.1:41787",
      "x-amz-sdk-checksum-algorithm": "SHA1",
      "content-type": "application/octet-stream",
      "content-encoding": "aws-chunked",
      "transfer-encoding": "chunked",
      "x-amz-decoded-content-length": "45",
      "x-amz-content-sha256": "STREAMING-UNSIGNED-PAYLOAD-TRAILER",
      "x-amz-trailer": "x-amz-checksum-sha1",
      "x-amz-user-agent": "aws-sdk-js/3.1137.0",
      "amz-sdk-invocation-id": "c40e6dc4-4e6c-416c-b93c-23602078195c",
      "amz-sdk-request": "attempt=1; max=3",
      "x-amz-date": "20260924T013316Z",
      "authorization": "AWS4-HMAC-SHA256 Credential=NMTSEXAMPLEKEYID0001/20260924/us-east-1/s3/aws4_request, SignedHeaders=amz-sdk-invocation-id;amz-sdk-request;content-encoding;content-type;host;x-amz-content-sha256;x-amz-date;x-amz-decoded-content-length;x-amz-sdk-checksum-algorithm;x-amz-trailer;x-amz-user-agent, Signature=604fcf5a65b067d6d94233a9abd68432464f0317f17ccc0a87d106cc6792207b",
    },
    body: "14\r\nThe quick brown fox \r\n19\r\njumps over the lazy dog.\n\r\n0\r\nx-amz-checksum-sha1:nATNY3IHfpsR9wyhEcmAfccTfks=\r\n\r\n",
  },
  {
    name: "AWS SDK for JavaScript v3, PutObject, stream body, ChecksumAlgorithm CRC64NVME",
    method: "PUT",
    url: "/drive/stream-CRC64NVME.txt?x-id=PutObject",
    headers: {
      "host": "127.0.0.1:41787",
      "x-amz-sdk-checksum-algorithm": "CRC64NVME",
      "content-type": "application/octet-stream",
      "content-encoding": "aws-chunked",
      "transfer-encoding": "chunked",
      "x-amz-decoded-content-length": "45",
      "x-amz-content-sha256": "STREAMING-UNSIGNED-PAYLOAD-TRAILER",
      "x-amz-trailer": "x-amz-checksum-crc64nvme",
      "x-amz-user-agent": "aws-sdk-js/3.1137.0",
      "amz-sdk-invocation-id": "1ca50379-370e-4ca7-94c0-1c5b248dec61",
      "amz-sdk-request": "attempt=1; max=3",
      "x-amz-date": "20260924T013316Z",
      "authorization": "AWS4-HMAC-SHA256 Credential=NMTSEXAMPLEKEYID0001/20260924/us-east-1/s3/aws4_request, SignedHeaders=amz-sdk-invocation-id;amz-sdk-request;content-encoding;content-type;host;x-amz-content-sha256;x-amz-date;x-amz-decoded-content-length;x-amz-sdk-checksum-algorithm;x-amz-trailer;x-amz-user-agent, Signature=311f8f994bde2bfbece820ee291b7bd6442edb9991bd8462dc25653ca9781850",
    },
    body: "14\r\nThe quick brown fox \r\n19\r\njumps over the lazy dog.\n\r\n0\r\nx-amz-checksum-crc64nvme:xSkvqfnNkUs=\r\n\r\n",
  },
  {
    name: "AWS SDK for JavaScript v3, UploadPart, stream body (default CRC32 trailer)",
    method: "PUT",
    url: "/drive/big.bin?partNumber=2&uploadId=UP1&x-id=UploadPart",
    headers: {
      "host": "127.0.0.1:41787",
      "content-type": "application/octet-stream",
      "x-amz-sdk-checksum-algorithm": "CRC32",
      "content-encoding": "aws-chunked",
      "transfer-encoding": "chunked",
      "x-amz-decoded-content-length": "45",
      "x-amz-content-sha256": "STREAMING-UNSIGNED-PAYLOAD-TRAILER",
      "x-amz-trailer": "x-amz-checksum-crc32",
      "x-amz-user-agent": "aws-sdk-js/3.1137.0",
      "amz-sdk-invocation-id": "d0f7b558-e86f-4a5f-bd70-6641132601de",
      "amz-sdk-request": "attempt=1; max=3",
      "x-amz-date": "20260924T013317Z",
      "authorization": "AWS4-HMAC-SHA256 Credential=NMTSEXAMPLEKEYID0001/20260924/us-east-1/s3/aws4_request, SignedHeaders=amz-sdk-invocation-id;amz-sdk-request;content-encoding;content-type;host;x-amz-content-sha256;x-amz-date;x-amz-decoded-content-length;x-amz-sdk-checksum-algorithm;x-amz-trailer;x-amz-user-agent, Signature=a2e5ae4f420c995bcf529dbefd5fb86d0844a49737073268221e2d776e6ca993",
    },
    body: "2d\r\nThe quick brown fox jumps over the lazy dog.\n\r\n0\r\nx-amz-checksum-crc32:61DMag==\r\n\r\n",
  },
  {
    name: "botocore 1.34.46 over https, put_object ChecksumAlgorithm=SHA256 (trailer)",
    method: "PUT",
    url: "/drive/sha256.txt",
    headers: {
      "host": "127.0.0.1:9000",
      "x-amz-sdk-checksum-algorithm": "SHA256",
      "transfer-encoding": "chunked",
      "content-encoding": "aws-chunked",
      "x-amz-trailer": "x-amz-checksum-sha256",
      "x-amz-decoded-content-length": "45",
      "x-amz-date": "20260924T013414Z",
      "x-amz-content-sha256": "STREAMING-UNSIGNED-PAYLOAD-TRAILER",
      "authorization": "AWS4-HMAC-SHA256 Credential=NMTSEXAMPLEKEYID0001/20260924/us-east-1/s3/aws4_request, SignedHeaders=content-encoding;host;transfer-encoding;x-amz-content-sha256;x-amz-date;x-amz-decoded-content-length;x-amz-sdk-checksum-algorithm;x-amz-trailer, Signature=81f783dfc3a15edff3415d134201290461e4cdb7af2b994466f0f7e691573576",
      "amz-sdk-invocation-id": "82f540ab-bea5-4d13-abe9-317b8b8aa398",
      "amz-sdk-request": "attempt=1",
    },
    body: "2d\r\nThe quick brown fox jumps over the lazy dog.\n\r\n0\r\nx-amz-checksum-sha256:tHzA8QS2LUx8MLzWj9jmdhPih9xK2MMQ7xDLreqcQ4A=\r\n\r\n",
  },
  {
    name: "botocore 1.34.46 over https, put_object ChecksumAlgorithm=CRC32 (trailer)",
    method: "PUT",
    url: "/drive/crc32.txt",
    headers: {
      "host": "127.0.0.1:9000",
      "x-amz-sdk-checksum-algorithm": "CRC32",
      "transfer-encoding": "chunked",
      "content-encoding": "aws-chunked",
      "x-amz-trailer": "x-amz-checksum-crc32",
      "x-amz-decoded-content-length": "45",
      "x-amz-date": "20260924T013414Z",
      "x-amz-content-sha256": "STREAMING-UNSIGNED-PAYLOAD-TRAILER",
      "authorization": "AWS4-HMAC-SHA256 Credential=NMTSEXAMPLEKEYID0001/20260924/us-east-1/s3/aws4_request, SignedHeaders=content-encoding;host;transfer-encoding;x-amz-content-sha256;x-amz-date;x-amz-decoded-content-length;x-amz-sdk-checksum-algorithm;x-amz-trailer, Signature=9619c516ab73cf576545f0b84658eea4636ffb0eb345b4159783a43a9b8d6f9c",
      "amz-sdk-invocation-id": "f1a569db-a05c-4a27-a098-1f16570d9815",
      "amz-sdk-request": "attempt=1",
    },
    body: "2d\r\nThe quick brown fox jumps over the lazy dog.\n\r\n0\r\nx-amz-checksum-crc32:61DMag==\r\n\r\n",
  },
];

const replay = await replayer();
after(() => replay.close());

test("every captured aws-chunked upload is verified and decoded to the file its client sent", async () => {
  assert.equal(CAPTURES.length, 8);
  for (const capture of CAPTURES) {
    const answer = await replay.send(capture);
    assert.equal(answer.status, 200, `${capture.name}: ${answer.body}`);
    assert.equal(answer.body, FOX, capture.name);
  }
});

test("⛔ every captured aws-chunked upload with one byte of the file changed is BadDigest", async () => {
  for (const capture of CAPTURES) {
    const changed = capture.body.replace("quick", "quack");
    assert.notEqual(changed, capture.body);
    const answer = await replay.send(capture, changed);
    assert.equal(answer.status, 400, `${capture.name}: ${answer.body}`);
    assert.equal(answer.body, "BadDigest", capture.name);
  }
});

test("⛔ a captured trailer with its checksum changed is refused", async () => {
  const trailed = CAPTURES.filter((c) => c.headers["x-amz-trailer"] !== undefined);
  assert.equal(trailed.length, CAPTURES.length);
  for (const capture of trailed) {
    const changed = capture.body.replace(/(x-amz-checksum-[a-z0-9]+:)(.)/, (_all, name: string, first: string) =>
      `${name}${first === "A" ? "B" : "A"}`,
    );
    assert.notEqual(changed, capture.body);
    const answer = await replay.send(capture, changed);
    assert.equal(answer.status, 400, `${capture.name}: ${answer.body}`);
    assert.equal(answer.body, "BadDigest", capture.name);
  }
});
