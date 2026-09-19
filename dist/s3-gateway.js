// The S3 gateway as a library: the server `nmts s3` runs, for somebody else's infrastructure.
//
// ⛔ ONE IMPLEMENTATION, AND THIS IS THE DOOR TO IT. A business putting NMTS behind its own storage
//    adapters needs the protocol this package already speaks, in its own process, in front of
//    whichever of its customers' accounts a request names. A copy of the server in the SDK would
//    be a second place for a signature check, a listing and a multipart upload to be got right,
//    and the copy nobody re-reads is the one that quietly disagrees.
//
// ⚠ WHAT IS NOT HERE: the bucket name `nmts s3` uses, the address it binds, and the pair it prints
//   when it starts. Those are that command's answers to questions a business answers for itself.
export { createGateway, gatewayHandler } from "./s3/server.js";
export { createDriveSource, fetchObject, placeOf, LIST_CACHE_MS } from "./s3/drive.js";
export { createStaging } from "./s3/staging.js";
