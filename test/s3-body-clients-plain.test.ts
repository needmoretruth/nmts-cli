// Plain uploads -- no `aws-chunked` framing -- exactly as real S3 clients sent them, replayed over a
// real socket into the signature check and the body decoder. Why captures, and how they were made:
// `s3-body-captures.ts`.

import { strict as assert } from "node:assert";
import { after, test } from "node:test";

import { FOX, replayer, type Capture } from "./s3-body-captures.ts";

const CAPTURES: readonly Capture[] = [
  {
    name: "AWS SDK for JavaScript v3, PutObject, Buffer body (signed digest, x-amz-checksum-crc32 header)",
    method: "PUT",
    url: "/drive/buffer.txt?x-id=PutObject",
    headers: {
      "host": "127.0.0.1:41787",
      "content-type": "application/octet-stream",
      "content-length": "45",
      "x-amz-sdk-checksum-algorithm": "CRC32",
      "x-amz-checksum-crc32": "61DMag==",
      "x-amz-user-agent": "aws-sdk-js/3.1137.0",
      "amz-sdk-invocation-id": "8e01b312-11fe-4674-8818-39a3900302b5",
      "amz-sdk-request": "attempt=1; max=3",
      "x-amz-date": "20260924T013316Z",
      "x-amz-content-sha256": "b47cc0f104b62d4c7c30bcd68fd8e67613e287dc4ad8c310ef10cbadea9c4380",
      "authorization": "AWS4-HMAC-SHA256 Credential=NMTSEXAMPLEKEYID0001/20260924/us-east-1/s3/aws4_request, SignedHeaders=amz-sdk-invocation-id;amz-sdk-request;content-length;content-type;host;x-amz-checksum-crc32;x-amz-content-sha256;x-amz-date;x-amz-sdk-checksum-algorithm;x-amz-user-agent, Signature=e89d9e8dfa93fc180bd08a5a564625de73ee6a242175497a0ca06ed3277b0edd",
    },
    body: "The quick brown fox jumps over the lazy dog.\n",
  },
  {
    name: "rclone v1.74.4, copyto (UNSIGNED-PAYLOAD, Content-MD5)",
    method: "PUT",
    url: "/drive/fox.txt?x-id=PutObject",
    headers: {
      "host": "127.0.0.1:38195",
      "user-agent": "rclone/v1.74.4",
      "content-length": "45",
      "accept-encoding": "identity",
      "amz-sdk-invocation-id": "8b18516e-7d03-4ca2-8b4c-399ebb790ac4",
      "amz-sdk-request": "attempt=1; max=1",
      "authorization": "AWS4-HMAC-SHA256 Credential=NMTSEXAMPLEKEYID0001/20260924/us-east-1/s3/aws4_request, SignedHeaders=accept-encoding;amz-sdk-invocation-id;amz-sdk-request;content-length;content-md5;content-type;host;x-amz-content-sha256;x-amz-date;x-amz-meta-mtime, Signature=edf4c162f7a378302b48d51e97a5801346a59b15575afe68c046da8a5969101c",
      "content-md5": "DXAGzQVelM9hRYfh0q4Mjg==",
      "content-type": "text/plain; charset=utf-8",
      "x-amz-content-sha256": "UNSIGNED-PAYLOAD",
      "x-amz-date": "20260924T013352Z",
      "x-amz-meta-mtime": "1790213631.77375786",
    },
    body: "The quick brown fox jumps over the lazy dog.\n",
  },
  {
    name: "botocore 1.34.46 over http, put_object (signed digest, Content-MD5)",
    method: "PUT",
    url: "/drive/plain.txt",
    headers: {
      "host": "127.0.0.1:9000",
      "content-md5": "DXAGzQVelM9hRYfh0q4Mjg==",
      "x-amz-date": "20260924T013413Z",
      "x-amz-content-sha256": "b47cc0f104b62d4c7c30bcd68fd8e67613e287dc4ad8c310ef10cbadea9c4380",
      "authorization": "AWS4-HMAC-SHA256 Credential=NMTSEXAMPLEKEYID0001/20260924/us-east-1/s3/aws4_request, SignedHeaders=content-md5;host;x-amz-content-sha256;x-amz-date, Signature=6d718e6a6ac3a7ae2c7fb0b82d380ef01cf1d57810565b1478c9979f54e1f502",
      "amz-sdk-invocation-id": "92dce8c2-7b62-4198-b307-c2c1c9d579c5",
      "amz-sdk-request": "attempt=1",
      "content-length": "45",
    },
    body: "The quick brown fox jumps over the lazy dog.\n",
  },
  {
    name: "botocore 1.34.46 over http, put_object ChecksumAlgorithm=SHA256 (header)",
    method: "PUT",
    url: "/drive/sha256.txt",
    headers: {
      "host": "127.0.0.1:9000",
      "x-amz-sdk-checksum-algorithm": "SHA256",
      "x-amz-checksum-sha256": "tHzA8QS2LUx8MLzWj9jmdhPih9xK2MMQ7xDLreqcQ4A=",
      "x-amz-date": "20260924T013413Z",
      "x-amz-content-sha256": "b47cc0f104b62d4c7c30bcd68fd8e67613e287dc4ad8c310ef10cbadea9c4380",
      "authorization": "AWS4-HMAC-SHA256 Credential=NMTSEXAMPLEKEYID0001/20260924/us-east-1/s3/aws4_request, SignedHeaders=host;x-amz-checksum-sha256;x-amz-content-sha256;x-amz-date;x-amz-sdk-checksum-algorithm, Signature=d7937fd0e7ff3494476e72506db1d82074ffca96a7b20ff7f0e49d92bfae22d7",
      "amz-sdk-invocation-id": "69fce30c-afba-48cd-ab1f-06d7d9802778",
      "amz-sdk-request": "attempt=1",
      "content-length": "45",
    },
    body: "The quick brown fox jumps over the lazy dog.\n",
  },
  {
    name: "botocore 1.34.46 over https, put_object (UNSIGNED-PAYLOAD, Content-MD5)",
    method: "PUT",
    url: "/drive/plain.txt",
    headers: {
      "host": "127.0.0.1:9000",
      "content-md5": "DXAGzQVelM9hRYfh0q4Mjg==",
      "x-amz-date": "20260924T013414Z",
      "x-amz-content-sha256": "UNSIGNED-PAYLOAD",
      "authorization": "AWS4-HMAC-SHA256 Credential=NMTSEXAMPLEKEYID0001/20260924/us-east-1/s3/aws4_request, SignedHeaders=content-md5;host;x-amz-content-sha256;x-amz-date, Signature=c0b7ac13adcf5095e1494b277267098f23f7ead114eb70a233f0418a862cbb92",
      "amz-sdk-invocation-id": "09ad8e18-ff0a-4ed0-8253-63a6c934ce16",
      "amz-sdk-request": "attempt=1",
      "content-length": "45",
    },
    body: "The quick brown fox jumps over the lazy dog.\n",
  },
];

/** What a changed byte of the object must be refused as, per capture: the first check to fail. */
const TAMPERED_CODE: Readonly<Record<string, string>> = {
  "AWS SDK for JavaScript v3, PutObject, Buffer body (signed digest, x-amz-checksum-crc32 header)":
    "XAmzContentSHA256Mismatch",
  "botocore 1.34.46 over http, put_object (signed digest, Content-MD5)": "XAmzContentSHA256Mismatch",
  "botocore 1.34.46 over http, put_object ChecksumAlgorithm=SHA256 (header)": "XAmzContentSHA256Mismatch",
};

const replay = await replayer();
after(() => replay.close());

test("every captured plain upload is verified and decoded to the file its client sent", async () => {
  assert.equal(CAPTURES.length, 5);
  for (const capture of CAPTURES) {
    const answer = await replay.send(capture);
    assert.equal(answer.status, 200, `${capture.name}: ${answer.body}`);
    assert.equal(answer.body, FOX, capture.name);
  }
});

test("⛔ every captured plain upload with one byte of the file changed is refused", async () => {
  for (const capture of CAPTURES) {
    const changed = capture.body.replace("quick", "quack");
    assert.notEqual(changed, capture.body);
    const answer = await replay.send(capture, changed);
    assert.equal(answer.status, 400, `${capture.name}: ${answer.body}`);
    assert.equal(answer.body, TAMPERED_CODE[capture.name] ?? "BadDigest", capture.name);
  }
});
