// Taken from https://github.com/ngraveio/bc-ur

import assert from "assert";
const crc32 = require("crc").crc32;

export const partition = (s: string, n: number): string[] =>
  s.match(new RegExp(".{1," + n + "}", "g")) || [s];
export const getCRCHex = (message: Buffer): string =>
  crc32(message).toString(16).padStart(8, "0");
export const split = (s: Buffer, length: number): [Buffer, Buffer] => [
  s.slice(0, -length),
  s.slice(-length),
];

const bytewords =
  "ableacidalsoapexaquaarchatomauntawayaxisbackbaldbarnbeltbetabiasbluebodybragbrewbulbbuzzcalmcashcatschefcityclawcodecolacookcostcruxcurlcuspcyandarkdatadaysdelidicedietdoordowndrawdropdrumdulldutyeacheasyechoedgeepicevenexamexiteyesfactfairfernfigsfilmfishfizzflapflewfluxfoxyfreefrogfuelfundgalagamegeargemsgiftgirlglowgoodgraygrimgurugushgyrohalfhanghardhawkheathelphighhillholyhopehornhutsicedideaidleinchinkyintoirisironitemjadejazzjoinjoltjowljudojugsjumpjunkjurykeepkenokeptkeyskickkilnkingkitekiwiknoblamblavalazyleaflegsliarlimplionlistlogoloudloveluaulucklungmainmanymathmazememomenumeowmildmintmissmonknailnavyneednewsnextnoonnotenumbobeyoboeomitonyxopenovalowlspaidpartpeckplaypluspoempoolposepuffpumapurrquadquizraceramprealredorichroadrockroofrubyruinrunsrustsafesagascarsetssilkskewslotsoapsolosongstubsurfswantacotasktaxitenttiedtimetinytoiltombtoystriptunatwinuglyundouniturgeuservastveryvetovialvibeviewvisavoidvowswallwandwarmwaspwavewaxywebswhatwhenwhizwolfworkyankyawnyellyogayurtzapszerozestzinczonezoom";
let bytewordsLookUpTable: number[] = [];
const BYTEWORDS_NUM = 256;
const BYTEWORD_LENGTH = 4;
const MINIMAL_BYTEWORD_LENGTH = 2;

export enum STYLES {
  STANDARD = "standard",
  URI = "uri",
  MINIMAL = "minimal",
}

const getWord = (index: number): string => {
  return bytewords.slice(
    index * BYTEWORD_LENGTH,
    index * BYTEWORD_LENGTH + BYTEWORD_LENGTH
  );
};

const getMinimalWord = (index: number): string => {
  const byteword = getWord(index);

  return `${byteword[0]}${byteword[BYTEWORD_LENGTH - 1]}`;
};

const addCRC = (string: string): string => {
  const crc = getCRCHex(Buffer.from(string, "hex"));

  return `${string}${crc}`;
};

const encodeWithSeparator = (word: string, separator: string): string => {
  const crcAppendedWord = addCRC(word);
  const crcWordBuff = Buffer.from(crcAppendedWord, "hex");
  const result = crcWordBuff.reduce(
    (result: string[], w) => [...result, getWord(w)],
    []
  );

  return result.join(separator);
};

const encodeMinimal = (word: string): string => {
  const crcAppendedWord = addCRC(word);
  const crcWordBuff = Buffer.from(crcAppendedWord, "hex");
  const result = crcWordBuff.reduce(
    (result, w) => result + getMinimalWord(w),
    ""
  );

  return result;
};

const decodeWord = (word: string, wordLength: number): string => {
  assert(
    word.length === wordLength,
    "Invalid Bytewords: word.length does not match wordLength provided"
  );

  const dim = 26;

  // Since the first and last letters of each Byteword are unique,
  // we can use them as indexes into a two-dimensional lookup table.
  // This table is generated lazily.
  if (bytewordsLookUpTable.length === 0) {
    const array_len = dim * dim;
    bytewordsLookUpTable = [...new Array(array_len)].map(() => -1);

    for (let i = 0; i < BYTEWORDS_NUM; i++) {
      const byteword = getWord(i);
      let x = byteword[0].charCodeAt(0) - "a".charCodeAt(0);
      let y = byteword[3].charCodeAt(0) - "a".charCodeAt(0);
      let offset = y * dim + x;
      bytewordsLookUpTable[offset] = i;
    }
  }

  // If the coordinates generated by the first and last letters are out of bounds,
  // or the lookup table contains -1 at the coordinates, then the word is not valid.
  let x = word[0].toLowerCase().charCodeAt(0) - "a".charCodeAt(0);
  let y =
    word[wordLength == 4 ? 3 : 1].toLowerCase().charCodeAt(0) -
    "a".charCodeAt(0);

  assert(
    0 <= x && x < dim && 0 <= y && y < dim,
    "Invalid Bytewords: invalid word"
  );

  let offset = y * dim + x;
  let value = bytewordsLookUpTable[offset];

  assert(value !== -1, "Invalid Bytewords: value not in lookup table");

  // If we're decoding a full four-letter word, verify that the two middle letters are correct.
  if (wordLength == BYTEWORD_LENGTH) {
    const byteword = getWord(value);
    let c1 = word[1].toLowerCase();
    let c2 = word[2].toLowerCase();

    assert(
      c1 === byteword[1] && c2 === byteword[2],
      "Invalid Bytewords: invalid middle letters of word"
    );
  }

  // Successful decode.
  return Buffer.from([value]).toString("hex");
};

const _decode = (
  string: string,
  separator: string,
  wordLength: number
): string => {
  const words =
    wordLength == BYTEWORD_LENGTH
      ? string.split(separator)
      : partition(string, 2);
  const decodedString = words
    .map((word: string) => decodeWord(word, wordLength))
    .join("");

  assert(
    decodedString.length >= 5,
    "Invalid Bytewords: invalid decoded string length"
  );

  const [body, bodyChecksum] = split(Buffer.from(decodedString, "hex"), 4);
  const checksum = getCRCHex(body); // convert to hex

  assert(checksum === bodyChecksum.toString("hex"), "Invalid Checksum");

  return body.toString("hex");
};

export const decode = (
  string: string,
  style: STYLES = STYLES.MINIMAL
): string => {
  switch (style) {
    case STYLES.STANDARD:
      return _decode(string, " ", BYTEWORD_LENGTH);
    case STYLES.URI:
      return _decode(string, "-", BYTEWORD_LENGTH);
    case STYLES.MINIMAL:
      return _decode(string, "", MINIMAL_BYTEWORD_LENGTH);
    default:
      throw new Error(`Invalid style ${style}`);
  }
};

export const encode = (
  string: string,
  style: STYLES = STYLES.MINIMAL
): string => {
  switch (style) {
    case STYLES.STANDARD:
      return encodeWithSeparator(string, " ");
    case STYLES.URI:
      return encodeWithSeparator(string, "-");
    case STYLES.MINIMAL:
      return encodeMinimal(string);
    default:
      throw new Error(`Invalid style ${style}`);
  }
};
