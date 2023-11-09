/*
  Copyright 2022-2023 Picovoice Inc.

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
  private static _memFiles = new Map<string, Uint8Array>();

  private _pos = 0;
  private readonly _mode: IDBTransactionMode | undefined;

  protected constructor(path: string, meta?: PvFileMeta, db?: IDBDatabase, mode?: IDBTransactionMode) {
    super();
    this._path = path;
    this._meta = meta;
    this._mode = mode;
  }

  public static open(path: string, mode: string): PvFileMem {
    const file = PvFileMem._memFiles.get(path);
    const dbMode = mode.includes('r') ? "readonly" : "readwrite";
    if ((file === undefined) && (dbMode === "readonly")) {
      const error = new Error(`'${path}' doesn't exist.`);
      error.name = "FileNotExists";
      throw error;
    }
    const fileMem = new PvFileMem(path, undefined, undefined, dbMode);
    if (mode.includes('a')) {
      fileMem.seek(0, 2);
    }
    return fileMem;
  }

  public close() {
    return;
  }

  public read(size: number, count: number): Uint8Array {
    if (!this.exists()) {
      throw new Error(`'${this._path}' doesn't exist.`);
    }
    if (this._isEOF) {
      const err = new Error(`EOF`);
      err.name = "EndOfFile";
      throw err;
    }

    const toCopy = Math.min(size * count, this._file.length - this._pos);
    const totalElems = toCopy - (toCopy % size);
    const buffer = new Uint8Array(totalElems);

    buffer.set(this._file.slice(this._pos, this._pos + totalElems), 0);
    this._pos += totalElems;

    return buffer;
  }

  public write(content: Uint8Array, version: number = 1): void {
    const newFile = new Uint8Array(this._pos + content.length);
    if (this._file !== undefined) {
      newFile.set(this._file.slice(0, this._pos));
      newFile.set(content, this._pos);
    } else {
      newFile.set(content);
    }
    this._file = newFile;
    this._pos += content.length;
  }

  public seek(offset: number, whence: number): void {
    if (!this.exists() && this._mode === "readonly") {
      throw new Error(`'${this._path}' doesn't exist.`);
    }
    if (!this.exists()) {
      // This is valid in ISO C but not supported by this current implementation
      throw new Error(`'${this._path}' doesn't exist.`);
    }

    if (offset < 0) {
      const err = new Error(`EOF`);
      err.name = "EndOfFile";
      throw err;
    }

    let newOffset;
    if (whence === 0) {
      newOffset = Math.min(offset, this._file.length);
    } else if (whence === 1) {
      newOffset = Math.min(this._pos + offset, this._file.length);
    } else if (whence === 2) {
      newOffset = Math.min(this._file.length + offset, this._file.length);
    } else {
      throw new Error(`Invalid operation: ${whence}.`);
    }

    this._pos = newOffset;
  }

  public tell(): number {
    if (!this.exists()) {
      return -1;
    }
    return this._pos;
  }

  public async remove(): Promise<void> {
    if (!this.exists()) {
      throw new Error("ENOENT");
    }

    PvFileMem._memFiles.delete(this._path);
    this._pos = 0;
  }

  public exists(): boolean {
    return this._file !== undefined;
  }

  protected get _isEOF() {
    return this._pos >= this._file.length;
  }

  private get _file() {
    return PvFileMem._memFiles.get(this._path)!;
  }

  private set _file(content: Uint8Array) {
    PvFileMem._memFiles.set(this._path, content);
  }
}
