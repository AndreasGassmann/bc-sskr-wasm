import { encode, decode, STYLES } from "./bytewords";
declare let Module: any;
var CBOR = require("cbor-sync");

CBOR.addSemanticEncode(309, function (data: any) {
  if (data && data.sskrShard) {
    return Buffer.from(data.sskrShard, "hex");
  }
});
CBOR.addSemanticDecode(309, function (str: any) {
  return str;
});

// https://kapadia.github.io/emscripten/2013/09/13/emscripten-pointers-and-pointers.html
const allocateMemory = (length: number) => {
  const output = new Uint16Array(length);
  var nOutputBytes = output.length * output.BYTES_PER_ELEMENT;
  var outputPtr = (window as any).Module._malloc(nOutputBytes);
  var heap = new Uint8Array(
    (window as any).Module.HEAPU8.buffer,
    outputPtr,
    nOutputBytes
  );
  heap.set(new Uint8Array(output.buffer));
  return {
    output,
    heap,
  };
};

const hexStringToUint8Array = (data: string) => {
  var bytes = new Uint8Array(Math.ceil(data.length / 2));
  for (var i = 0; i < bytes.length; i++)
    bytes[i] = parseInt(data.substr(i * 2, 2), 16);
  return bytes;
};

const toHexString = (bytes: Uint8Array) =>
  bytes.reduce((str, byte) => str + byte.toString(16).padStart(2, "0"), "");

export const ready = new Promise<{
  _sskrShardCount: any;
  _sskrGenerate: any;
  _sskrCombine: any;
}>((resolve, reject) => {
  console.log("Module", Module);
  setTimeout(() => {
    const _sskrShardCount = (window as any).Module.cwrap(
      "sskr_count_shards", // name of C function
      "number", // return type
      ["number", "array", "number"] // argument types
    );

    // https://emscripten.org/docs/porting/connecting_cpp_and_javascript/Interacting-with-code.html#calling-compiled-c-functions-from-javascript-using-ccall-cwrap

    const _sskrGenerate = (window as any).Module.cwrap(
      "sskr_generate", // name of C function
      "number", // return type
      [
        "number",
        "array",
        "number",
        "array",
        "number",
        "number",
        "number",
        "number",
        "number",
        "number",
      ] // argument types
    );

    const _sskrCombine = (window as any).Module.cwrap(
      "sskr_combine", // name of C function
      "number", // return type
      ["number", "number", "number", "number", "number"] // argument types
    );

    resolve({
      _sskrShardCount,
      _sskrGenerate,
      _sskrCombine,
    });
  }, 2000);
});

export const sskrGenerate = async (
  groupThreshold: number,
  groups: [number, number][],
  secret: string
) => {
  const { _sskrShardCount, _sskrGenerate } = await ready;
  console.log("sskrGenerate", groupThreshold, groups, secret);

  const flattenedGroups: number[] = [];
  groups.forEach((g) => {
    flattenedGroups.push(...g);
  });
  const groupsArray = new Uint8Array(flattenedGroups);
  const groupLength = groups.length;

  const expectedShardCount = _sskrShardCount(
    groupThreshold,
    groupsArray,
    groupLength
  );

  const masterSecretString = secret;
  const masterSecret = hexStringToUint8Array(masterSecretString);
  const expectedShardLen = masterSecret.length + 5;
  const bufferLen = groups.reduce((pv, cv) => pv + cv[1], 0) * expectedShardLen;

  console.log("BUFFER LEN", bufferLen);
  // https://emscripten.org/docs/porting/connecting_cpp_and_javascript/Interacting-with-code.html#calling-javascript-functions-as-function-pointers-from-c
  // https://github.com/emscripten-core/emscripten/blob/master/tests/interop/test_add_function_post.js
  const newFuncPtr = (window as any).Module.addFunction(function (
    bufferPointer: number,
    count: number,
    contextPointer: number
  ) {
    // this implements arandom number generator
    // It is passed to a function pointer
    var array = new Uint8Array(count);

    // TODO: Node alternative
    window.crypto.getRandomValues(array);

    for (var i = 0; i < count; i++) {
      (window as any).Module.setValue(bufferPointer + i, array[i], "i8");
    }
  },
  "viii");

  const { output: shardLen, heap: shardLenHeap } = allocateMemory(1);
  const { output: output, heap: outputHeap } = allocateMemory(bufferLen);

  const shardCount = _sskrGenerate(
    groupThreshold,
    groupsArray,
    groupLength,
    masterSecret,
    masterSecret.length,
    shardLenHeap.byteOffset,
    outputHeap.byteOffset,
    output.length,
    null,
    newFuncPtr
  );

  if (shardCount < 0) {
    throw new Error(`sskrGenerate returned an error: ${shardCount}`);
  }

  console.assert(shardCount >= 0, "shard count error");

  var shardLenResult = new Uint8Array(
    shardLenHeap.buffer,
    shardLenHeap.byteOffset,
    shardLen.length
  )[0];
  var outputResult = new Uint8Array(
    outputHeap.buffer,
    outputHeap.byteOffset,
    output.length
  );

  console.log(shardCount, expectedShardCount);
  console.log(shardLenResult, expectedShardLen);

  console.assert(shardCount === expectedShardCount, "shard count is false!");
  console.assert(shardLenResult === expectedShardLen, "shard len is false!");

  const shards = [];
  for (let x = 0; x < shardCount; x++) {
    const pos = x * expectedShardLen;
    const slice = outputResult.slice(pos, pos + expectedShardLen);
    const shard = toHexString(slice);
    shards.push(shard);
  }

  return shards;
};

export const sskrCombine = async (shards: string[]) => {
  const { _sskrCombine } = await ready;

  // Convert shards to binary format
  // Let's restore from 3 shards of the first group and 3 shards of the second group
  var width = shards[0].length / 2;
  var height = shards.length;
  // https://kapadia.github.io/emscripten/2013/09/13/emscripten-pointers-and-pointers.html
  var data = new Uint8Array(height * width);
  var _shard;
  var k = 0;
  for (var j = 0; j < height; j++) {
    _shard = hexStringToUint8Array(shards[j]);
    for (var i = 0; i < width; i++) {
      data[k] = _shard[i];
      k = k + 1;
    }
  }

  var nDataBytes = data.length * data.BYTES_PER_ELEMENT;
  var dataPtr = (window as any).Module._malloc(nDataBytes);

  var dataHeap1 = new Uint8Array(
    (window as any).Module.HEAPU8.buffer,
    dataPtr,
    nDataBytes
  );
  dataHeap1.set(new Uint8Array(data.buffer));

  var pointers = new Uint32Array(height);
  for (var i = 0; i < pointers.length; i++) {
    pointers[i] = dataPtr + i * data.BYTES_PER_ELEMENT * width;
  }

  // Allocate bytes needed for the array of pointers
  var nPointerBytes = pointers.length * pointers.BYTES_PER_ELEMENT;
  var pointerPtr = (window as any).Module._malloc(nPointerBytes);

  // Copy array of pointers to Emscripten heap
  var pointerHeap = new Uint8Array(
    (window as any).Module.HEAPU8.buffer,
    pointerPtr,
    nPointerBytes
  );
  pointerHeap.set(new Uint8Array(pointers.buffer));

  const { output: recover, heap: recoverHeap } = allocateMemory(100);

  const combineResult = _sskrCombine(
    pointerHeap.byteOffset,
    width,
    height,
    recoverHeap.byteOffset,
    recover.length
  );

  if (combineResult < 0) {
    throw new Error(`sskrCombine returned an error: ${combineResult}`);
  }

  var outputResult = new Uint8Array(
    recoverHeap.buffer,
    recoverHeap.byteOffset,
    combineResult
  );

  const seed = toHexString(outputResult);

  return seed;
};

export const getShardInfo = async (shard: string) => {
  const result = {
    identifier: shard.slice(0, 4),
    groupThreshold: parseInt(shard.slice(4, 5), 16) + 1,
    groupCount: parseInt(shard.slice(5, 6), 16) + 1,
    groupIndex: parseInt(shard.slice(6, 7), 16),
    memberThreshold: parseInt(shard.slice(7, 8), 16) + 1,
    reserved: parseInt(shard.slice(8, 9), 16),
    memberIndex: parseInt(shard.slice(9, 10), 16),
    shareValue: shard.slice(10, shard.length),
  };

  return result;
};

export const shardToByteWords = (shard: string) => {
  var encodedBuffer: Buffer = CBOR.encode({
    sskrShard: shard,
  });

  const bw = encode(encodedBuffer.toString("hex"), STYLES.STANDARD);

  return bw;
};

export const byteWordsToShard = (bw: string) => {
  const encodedBuffer = decode(bw, STYLES.STANDARD);

  var decoded = CBOR.decode(Buffer.from(encodedBuffer, "hex"));

  return decoded.toString("hex");
};

export const bytewordEncode = (bytes: string, style: STYLES) => {
  console.log("bytes", bytes);
  const bw = encode(bytes, style);

  return bw;
};

export const bytewordDecode = (bw: string, style: STYLES) => {
  const encodedBuffer = decode(bw, style);

  return encodedBuffer;
};

ready.then();

// sskrGenerate(2, [[2, 3], [3, 5]], '301c29989a4792a00923ca10bbf264045a8ce6da98eacf03b0ec4877e6087579').then(shards => {
// // sskrGenerate(2, [[2, 3], [3, 5]], '7daa851251002874e1a1995f0897e6b1').then(shards => {
//     const byteWordShards = shards.map(s => shardToByteWords(s))
//     console.log('words', byteWordShards)
//     const processedShards = byteWordShards.map(s => byteWordsToShard(s))

//     console.log(getShardInfo(processedShards[2]))
//     sskrCombine([processedShards[0],processedShards[1],processedShards[3],processedShards[4],processedShards[5]])
// })
