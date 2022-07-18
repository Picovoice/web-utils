/*
  Copyright 2022 Picovoice Inc.

  You may not use this file except in compliance with the license. A copy of the license is located in the "LICENSE"
  file accompanying this source.

  Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on
  an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the
  specific language governing permissions and limitations under the License.
*/

import { PvFile, PvFileMeta } from "./pv_file";

/**
 * PvFileMem Class
 * This class mocks the file system using in-memory storage.
 */
export class PvFileMem extends PvFile {
  private static _fileMap = new Map<string, Uint8Array>();
  private _pos = 0;

  protected constructor(path: string, meta?: PvFileMeta, db?: IDBDatabase, mode?: IDBTransactionMode) {
    super();
    this._path = path;
    this._meta = meta;
  }

  public static open(path: string, mode?: string): PvFileMem {
    return new PvFileMem(path, undefined, undefined, mode.includes('r') ? "readonly" : "readwrite");
  }

  public close() {
    return;
  }

  public read(size: number, count: number): Uint8Array {
    if (this._isEOF) {
      const err = new Error(`EOF`);
      err.name = "EndOfFile";
      throw err;
    }

    const file = PvFileMem._fileMap.get(this._path);

    const toCopy = Math.min(size * count, file.length - this._pos);
    const totalElems = toCopy - (toCopy % size);
    const buffer = new Uint8Array(totalElems);

    buffer.set(file.slice(this._pos, this._pos + totalElems), 0);
    this._pos += totalElems;

    return buffer;
  }

  public write(content: Uint8Array, version: number = 1): void {
    PvFileMem._fileMap.set(this._path, content);
  }

  public seek(offset: number, whence: number): void {
    if (offset < 0) {
      const err = new Error(`EOF`);
      err.name = "EndOfFile";
      throw err;
    }

    const file = PvFileMem._fileMap.get(this._path);

    let newOffset;
    if (whence === 0) {
      newOffset = Math.min(offset, file.length);
    } else if (whence === 1) {
      newOffset = Math.min(this._pos + offset, file.length);
    } else if (whence === 2) {
      newOffset = Math.min(file.length + offset, file.length);
    } else {
      throw new Error(`Invalid operation: ${whence}.`);
    }

    this._pos = newOffset;
  }

  public tell(): number {
    return this._pos;
  }

  public async remove(): Promise<void> {
    if (PvFileMem._fileMap.has(this._path)) {
      PvFileMem._fileMap.delete(this._path);
      this._meta = undefined;
    }
  }

  public exists(): boolean {
    return PvFileMem._fileMap.has(this._path);
  }

  protected get _isEOF() {
    const file = PvFileMem._fileMap.get(this._path);
    return this._pos >= file.length;
  }
}
