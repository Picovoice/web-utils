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
 * Indexed DB configurations
 */
export const DB_NAME = 'pv_db';
export const PV_FILE_STORE = 'pv_file';
export const DB_VERSION = 3;

/**
 * Helper to get IndexedDB.
 */
export function getDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = self.indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => {
      reject(request.error);
    };
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(PV_FILE_STORE)) {
        request.result.createObjectStore(PV_FILE_STORE);
      }
    };
  });
}

/**
 * Cache Settings
 */
class PvCache {
  private _pos: number;
  private _data: Uint8Array;

  constructor() {
    this._pos = 0;
    this._data = new Uint8Array();
  }

  public get(bytes: number): Uint8Array | undefined {
    if (this._pos >= this._data.length) {
      return undefined;
    }

    const res = this._data.slice(this._pos, this._pos + bytes);
    this._pos += bytes;
    return res;
  }

  public set(pos: number, data: Uint8Array) {
    this._pos = pos;
    this._data = data;
  }

  public clear() {
    this._pos = 0;
    this._data = new Uint8Array();
  }
}

/**
 * PvFile Class
 * This class mocks the file system using IndexedDB.
 * IndexedDB is REQUIRED.
 */
export class PvFileIDB extends PvFile {
  private readonly _pageSize = 512 * 1024; // 512KB

  private readonly _db: IDBDatabase;
  private readonly _mode: IDBTransactionMode;

  private _pagePtr = 0;
  private _pageOffset = 0;

  private _cache: PvCache;

  get pageSize() {
    return this._pageSize;
  }

  /**
   * Constructor of PvFile instance.
   * @param path The path of a file.
   * @param meta The metadata of the file.
   * @param db The db instance currently related to the opened file.
   * @param mode The mode - either readonly or readwrite.
   */
  protected constructor(path: string, meta: PvFileMeta, db: IDBDatabase, mode: IDBTransactionMode) {
    super();
    this._path = path;
    this._meta = meta;
    this._db = db;
    this._mode = mode;

    this._cache = new PvCache();
  }

  /**
   * Opens a file and return an instance of PvFile. A file can be opened in readonly or readwrite mode
   * which follows IndexedDB standard of reading and writing values to the db.
   * The file is stored as an Uint8Array separated by pages.
   * NOTE: The key exactly matching the path expects a value of type PvFileMeta.
   * @param path The path of the file to open stored in IndexedDB.
   * @param mode A string, if it contains 'r' in the string, it will open the file in readonly mode, else it
   * will open in readwrite mode.
   * @returns Promise<PvFile> An instance of PvFile.
   * @throws Error if IndexedDB is not supported.
   */
  public static open(path: string, mode: string): Promise<PvFileIDB> {
    if (!self.indexedDB) {
      const error = new Error("IndexedDB is not supported");
      error.name = "IndexedDBNotSupported";
      throw error;
    }

    return new Promise(async(resolve, reject) => {
      try {
        const db = await getDB();
        const req = db.transaction(PV_FILE_STORE, "readwrite").objectStore(PV_FILE_STORE).get(path);
        req.onerror = () => {
          reject(req.error);
        };
        req.onsuccess = () => {
          const meta = req.result;
          const dbMode = mode.includes('r') ? "readonly" : "readwrite";
          if (meta === undefined && dbMode === "readonly") {
            const error = new Error(`'${path}' doesn't exist.`);
            error.name = "FileNotExists";
            reject(error);
            return;
          }
          const fileIDB = new PvFileIDB(path, meta, db, dbMode);
          if (mode.includes('a')) {
            fileIDB.seek(0, 2);
          }
          resolve(fileIDB);
        };
      } catch (e: any) {
        if (e.name === "InvalidStateError") {
          const error = new Error("IndexedDB is not supported");
          error.name = "IndexedDBNotSupported";
          reject(error);
        } else {
          reject(e);
        }
      }
    });
  }

  /**
   * Closes the db connection. Any other instance function call will not work once
   * the db is closed.
   */
  public async close(): Promise<void> {
    this._db.close();
  }

  /**
   * Reads a total of 'count' elements, each with a size of 'size' bytes from the current position in the stream.
   * Moves the stream by the amount of elements read.
   * If the last few bytes is smaller than 'size' it will not read (similar to fread) the bytes.
   * @param size The element size.
   * @param count The number of elements to read.
   * @returns Promise<Uint8Array> A Uint8Array with the elements copied to it.
   * @throws Error if file doesn't exist or if EOF.
   */
  public async read(size: number, count: number): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      if (!this.exists()) {
        reject(new Error(`'${this._path}' doesn't exist.`));
        return;
      }
      if (this._isEOF) {
        const err = new Error(`EOF`);
        err.name = "EndOfFile";
        reject(err);
        return;
      }

      let copied = 0;

      const maxToCopy = Math.min(size * count, this._meta!.size);
      const totalElems = maxToCopy - (maxToCopy % size);
      const buffer = new Uint8Array(totalElems);

      // check if there's data in cache
      const res = this._cache.get(totalElems);
      if (res) {
        copied += res.length;
        this._pageOffset += res.length;
        if (this._pageOffset === this._pageSize) {
          this._pagePtr += 1;
          this._pageOffset = 0;
        }

        if (totalElems === copied) {
          resolve(res);
          return;
        }

        buffer.set(res);
      }

      const keyRange = IDBKeyRange.bound(
        `${this._path}-${PvFileIDB.createPage(this._pagePtr)}`,
        `${this._path}-${PvFileIDB.createPage(this._pagePtr + Math.floor(totalElems / this._pageSize) + 1)}`
      );

      const store = this._store;
      const req = store.openCursor(keyRange);
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor || (this._isEOF)) {
          return;
        }

        const toCopy = Math.min(totalElems - copied, cursor.value.length - this._pageOffset);
        buffer.set(cursor.value.slice(this._pageOffset, this._pageOffset + toCopy), copied);
        copied += toCopy;
        this._pageOffset += toCopy;
        if (this._pageOffset === this._pageSize) {
          this._pagePtr += 1;
          this._pageOffset = 0;
        }
        if (copied < totalElems) {
          cursor.continue();
        } else {
          if (this._pageOffset !== 0) {
            this._cache.set(this._pageOffset, cursor.value);
          } else {
            this._cache.clear();
          }

          if (store.transaction?.commit) {
            store.transaction?.commit();
          }
        }
      };

      store.transaction.onerror = () => {
        reject(store.transaction.error);
      };

      store.transaction.oncomplete = () => {
        resolve(buffer.slice(0, copied));
      };
    });
  }

  /**
   * Writes an Uint8Array to IndexedDB seperated by pages.
   * @param content The bytes to save.
   * @param version Version of the file.
   */
  public async write(content: Uint8Array, version: any = 1): Promise<void> {
    return new Promise(async (resolve, reject) => {
      if (this._mode === "readonly") {
        reject(new Error("Instance is readonly mode only."));
        return;
      }

      if (typeof version !== "number" && version <= 0) {
        reject(new Error("Version should be a positive number"));
        return;
      }
      const store = this._store;

      const getCurrentPage = () => new Promise<Uint8Array>(res => {
        const req = store.get(`${this._path}-${PvFileIDB.createPage(this._pagePtr)}`);
        req.onsuccess = () => {
          if (req.result !== undefined) {
            res(req.result.slice(0, this._pageOffset));
          } else {
            res(new Uint8Array(0));
          }
        };
      });

      const last = await getCurrentPage();
      const newContent = new Uint8Array(last.length + content.length);
      newContent.set(last);
      newContent.set(content, last.length);

      const newSize = (this._pagePtr * this._pageSize) + newContent.length;
      const newMeta: PvFileMeta = {
        size: newSize,
        numPages: Math.ceil(newSize / this._pageSize),
        version: version,
        pageSize: this._pageSize,
      };
      store.put(newMeta, this._path);

      const pages = Math.ceil(newContent.length / this._pageSize);
      for (let i = 0; i < pages; i++) {
        store.put(
          newContent.slice(i * this._pageSize, (i + 1) * this._pageSize),
          `${this._path}-${PvFileIDB.createPage(this._pagePtr + i)}`);
      }

      if ((this.exists()) && (newMeta.numPages < this._meta!.numPages)) {
        const keyRange = IDBKeyRange.bound(
          `${this._path}-${PvFileIDB.createPage(newMeta.numPages)}`,
          `${this._path}-${PvFileIDB.createPage(this._meta!.numPages)}`,
          true);
        store.delete(keyRange);
      }

      if (store.transaction?.commit) {
        store.transaction?.commit();
      }

      store.transaction.onerror = () => {
        reject(store.transaction.error);
      };
      store.transaction.oncomplete = () => {
        this._meta = newMeta;
        this.seek(0, 2);
        resolve();
      };
    });
  }

  /**
   * Moves the current position in the stream by 'offset' elements at 'whence' position.
   * @param offset The number of bytes to move.
   * @param whence One of:
   *  - 0: moves position from beginning of file.
   *  - 1: moves position from current position in the stream.
   *  - 2: moves position from the last element of the file.
   * @throws Error if file doesn't exist or if EOF.
   */
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
      newOffset = Math.min(offset, this._meta!.size);
    } else if (whence === 1) {
      const currentOffset = this._pageSize * this._pagePtr + this._pageOffset;
      newOffset = Math.min(currentOffset + offset, this._meta!.size);
    } else if (whence === 2) {
      newOffset = Math.min(this._meta!.size + offset, this._meta!.size);
    } else {
      throw new Error(`Invalid operation: ${whence}.`);
    }

    this._pageOffset = newOffset % this._pageSize;
    this._pagePtr = Math.floor(newOffset / this._pageSize);

    this._cache.clear();
  }

  /**
   * Returns the number of bytes from the beginning of the file.
   */
  public tell(): number {
    if (!this.exists()) {
      return -1;
    }
    return this._pagePtr * this._pageSize + this._pageOffset;
  }

  /**
   * Removes a file and any related pages given the path.
   */
  public async remove(): Promise<void> {
    return new Promise(async (resolve, reject) => {
      if (!this.exists()) {
        reject(new Error("ENOENT"));
        return;
      }

      const numPages = this._meta!.numPages;
      const keyRange = IDBKeyRange.bound(this._path, `${this._path}-${PvFileIDB.createPage(numPages)}`);
      const store = this._store;

      const req = store.delete(keyRange);
      req.onerror = () => {
        reject(req.error);
      };
      req.onsuccess = () => {
        this._meta = undefined;
        this._pageOffset = 0;
        this._pagePtr = 0;
        resolve();
      };
    });
  }

  /**
   * Checks if the following path exists.
   */
  public exists(): boolean {
    return this._meta !== undefined;
  }

  /**
   * Checks if the current stream is EOF.
   */
  protected get _isEOF() {
    return (this._pagePtr >= (this._meta!.numPages - 1)) && (this._pageOffset >= (this._meta!.size % this._pageSize));
  }

  /**
   * Creates an index which as a key to save page data to IndexedDB.
   * This formats the file into 0000, 0001, 0002 ...
   * @param page The page number to format.
   */
  private static createPage(page: number) {
    return ("00000" + page).slice(-6);
  }

  /**
   * Gets a objectStore instance from the PvFile instance.
   */
  private get _store() {
    return this._db.transaction(PV_FILE_STORE, this._mode).objectStore(PV_FILE_STORE);
  }
}
