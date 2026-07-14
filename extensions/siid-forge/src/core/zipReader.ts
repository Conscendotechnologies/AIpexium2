/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as fs from 'fs';
import * as zlib from 'zlib';

/**
 * Minimal, dependency-free ZIP reader. A `.jar` is a standard ZIP archive, so
 * this lets us enumerate/extract entries from the bundled Apex LSP jar without
 * pulling in a third-party unzip library (the extension ships with no
 * dependencies and is compiled with plain `tsc`).
 *
 * Supports the two storage methods that appear in a jar: STORED (0) and
 * DEFLATE (8). Reads the End Of Central Directory record, then walks the
 * central directory; per entry it seeks to the local header to find the true
 * data offset (the local header's extra-field length can differ from the
 * central one). No ZIP64, no encryption — none of which the Apex jar uses.
 */

const EOCD_SIG = 0x06054b50;      // End Of Central Directory
const CEN_SIG = 0x02014b50;       // Central directory file header
const LOC_SIG = 0x04034b50;       // Local file header

export interface ZipEntry {
  /** Entry path, e.g. `StandardApexLibrary/System/Database.cls`. */
  name: string;
  compressionMethod: number;      // 0 = stored, 8 = deflate
  compressedSize: number;
  uncompressedSize: number;
  /** Offset of the local file header within the archive. */
  localHeaderOffset: number;
}

/** Locates and parses the central directory, returning all entries. */
export function readZipEntries(buf: Buffer): ZipEntry[] {
  const eocd = findEocd(buf);
  const centralDirOffset = buf.readUInt32LE(eocd + 16);
  const entryCount = buf.readUInt16LE(eocd + 10);

  const entries: ZipEntry[] = [];
  let p = centralDirOffset;
  for (let i = 0; i < entryCount; i++) {
    if (buf.readUInt32LE(p) !== CEN_SIG) {
      break; // defensive: malformed central directory
    }
    const compressionMethod = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const uncompressedSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localHeaderOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);

    entries.push({ name, compressionMethod, compressedSize, uncompressedSize, localHeaderOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Extracts and decompresses a single entry's bytes. */
export function readEntry(buf: Buffer, entry: ZipEntry): Buffer {
  // The local header repeats name/extra lengths; the extra field may differ in
  // size from the central-directory copy, so compute the data start from it.
  const lh = entry.localHeaderOffset;
  if (buf.readUInt32LE(lh) !== LOC_SIG) {
    throw new Error(`Bad local header for ${entry.name}`);
  }
  const nameLen = buf.readUInt16LE(lh + 26);
  const extraLen = buf.readUInt16LE(lh + 28);
  const dataStart = lh + 30 + nameLen + extraLen;
  const data = buf.subarray(dataStart, dataStart + entry.compressedSize);

  if (entry.compressionMethod === 0) {
    return Buffer.from(data);
  }
  if (entry.compressionMethod === 8) {
    return zlib.inflateRawSync(data);
  }
  throw new Error(`Unsupported compression method ${entry.compressionMethod} for ${entry.name}`);
}

/** Reads the jar from disk and returns entries plus a bound extractor. */
export function openZip(jarPath: string): {
  entries: ZipEntry[];
  extractText(entry: ZipEntry): string;
} {
  const buf = fs.readFileSync(jarPath);
  const entries = readZipEntries(buf);
  return {
    entries,
    extractText: (entry: ZipEntry) => readEntry(buf, entry).toString('utf8')
  };
}

/**
 * Scans backwards for the EOCD signature. The record is near the end but a
 * trailing comment (rare in jars) can push it up to 64KB from EOF.
 */
function findEocd(buf: Buffer): number {
  const minPos = Math.max(0, buf.length - 22 - 0xffff);
  for (let p = buf.length - 22; p >= minPos; p--) {
    if (buf.readUInt32LE(p) === EOCD_SIG) {
      return p;
    }
  }
  throw new Error('Not a valid ZIP/JAR: End Of Central Directory not found');
}
