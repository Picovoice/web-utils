/*
  Copyright 2022 Picovoice Inc.

  You may not use this file except in compliance with the license. A copy of the license is located in the "LICENSE"
  file accompanying this source.

  Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on
  an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the
  specific language governing permissions and limitations under the License.
*/

import {
  PV_FILE_STORE,
  getDB
} from "./utils";

/**
 * PvFileMeta type.
 * Contains meta data for "PvFile".
 */
type PvFileMeta = {
  size: number;
  numPages: number;
  version: number;
}

/**
 * PvFile Class
 * This class mocks the file system using IndexedDB.
 * IndexedDB is REQUIRED.
 */
export class PvFile {
  private static _filePtrs = new Map<number, PvFile>();

  private readonly _pageSize = 65536;
  private readonly _path: string;

  private readonly _db: IDBDatabase;
  private readonly _mode: IDBTransactionMode;

  private _meta: PvFileMeta | undefined;
  private _pagePtr = 0;
  private _pageOffset = 0;

  /**
   * Constructor of PvFile instance.
   * @param path The path of a file.
   * @param meta The metadata of the file.
   * @param db The db instance currently related to the opened file.
   * @param mode The mode - either readonly or readwrite.
   * @private
   */
  private constructor(path: string, meta: PvFileMeta | undefined, db: IDBDatabase, mode: IDBTransactionMode) {
    this._path = path;
    this._meta = meta;
    this._db = db;
    this._mode = mode;
  }

  /**
   * Getter for file's meta information.
   */
  get meta() {
    return this._meta;
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
  public static open(path: string, mode: string): Promise<PvFile> {
    if (!self.indexedDB) {
      throw new Error("IndexedDB is not supported");
    }

    return new Promise(async(resolve, reject) => {
      const db = await getDB();
      const dbMode = mode.includes('r') ? "readonly" : "readwrite";
      const req = db.transaction(PV_FILE_STORE, dbMode).objectStore(PV_FILE_STORE).get(path);
      req.onerror = () => {
        reject(req.error);
      };
      req.onsuccess = () => {
        if (req.result === undefined && dbMode === "readonly") {
          reject(`Instance is readonly mode but '${path}' doesn't exist.`);
        } else {
          resolve(new PvFile(path, req.result, db, dbMode));
        }
      };
    });
  }

  /**
   * Removes a file and any related pages given the path.
   * @param path Path to file.
   * @throws Error if IndexedDB is not supported.
   */
  public static async remove(path: string): Promise<void> {
    if (!self.indexedDB) {
      throw new Error("IndexedDB is not supported");
    }

    return new Promise(async (resolve, reject) => {
      const file = await this.open(path, "w");
      const numPages = file._meta.numPages;
      const keyRange = IDBKeyRange.bound(file._path, `${file._path}-${PvFile.createPage(numPages)}`);
      const store = file._store;

      const req = store.delete(keyRange);
      req.onerror = () => {
        reject(req.error);
      };
      req.onsuccess = () => {
        resolve();
      };
    });
  }

  /**
   * Checks if the following path exists.
   * @param path Path to file.
   * @throws Error if IndexedDB is not supported.
   */
  public static async exists(path: string): Promise<boolean> {
    if (!self.indexedDB) {
      throw new Error("IndexedDB is not supported");
    }

    try {
      const file = await this.open(path, "r");
      return file._meta !== undefined;
    } catch (e) {
      return false;
    }
  }

  /**
   * Closes the db connection. Any other instance function call will not work once
   * the db is closed.
   */
  public async close() {
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
      if (this._meta === undefined) {
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

      const maxToCopy = Math.min(size * count, this._meta.size);
      const totalElems = maxToCopy - (maxToCopy % size);
      const buffer = new Uint8Array(totalElems);

      const keyRange = IDBKeyRange.bound(
        `${this._path}-${PvFile.createPage(this._pagePtr)}`,
        `${this._path}-${PvFile.createPage(this._meta.numPages)}`
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
   * Writes an Uint8array to IndexedDB seperated by pages.
   * @param content The bytes to save.
   * @param version Version of the file.
   */
  public async write(content: Uint8Array, version = 1): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this._mode === "readonly") {
        reject(new Error("Instance is readonly mode only."));
        return;
      }

      if (typeof version !== "number" && version <= 0) {
        reject(new Error("Version should be a positive number"));
        return;
      }

      const store = this._store;

      const pages = Math.ceil(content.length / this._pageSize);
      const meta: PvFileMeta = {
        size: content.length,
        numPages: pages,
        version: version
      };

      const addContent = () => {
        store.add(meta, this._path);
        for (let i = 0; i < pages; i++) {
          store.add(
            content.slice(i * this._pageSize, (i + 1) * this._pageSize),
            `${this._path}-${PvFile.createPage(i)}`
          );
        }
      };

      if (this._meta) {
        const numPages = this._meta.numPages;
        const keyRange = IDBKeyRange.bound(this._path, `${this._path}-${PvFile.createPage(numPages)}`);
        store.delete(keyRange).onsuccess = () => addContent();
      } else {
        addContent();
      }

      store.transaction.onerror = () => {
        reject(store.transaction.error);
      };
      store.transaction.oncomplete = () => {
        this._meta = meta;
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
    if (this._meta === undefined) {
      throw new Error(`'${this._path}' doesn't exist.`);
    }

    if (offset < 0) {
      const err = new Error(`EOF`);
      err.name = "EndOfFile";
      throw err;
    }

    let newOffset;
    if (whence === 0) {
      newOffset = Math.min(offset, this._meta.size);
    } else if (whence === 1) {
      const currentOffset = this._pageSize * this._pagePtr + this._pageOffset;
      newOffset = Math.min(currentOffset + offset, this._meta.size);
    } else if (whence === 2) {
      newOffset = Math.min(this._meta.size + offset, this._meta.size);
    } else {
      throw new Error(`Invalid operation: ${whence}.`);
    }

    this._pageOffset = newOffset % this._pageSize;
    this._pagePtr = Math.floor(newOffset / this._pageSize);
  }

  /**
   * Returns the number of bytes from the beginning of the file.
   */
  public tell(): number {
    return this._pagePtr * this._pageSize + this._pageOffset;
  }

  /**
   * Get the file pointer from the _filePtrs map.
   * @param ptr The pointer to PvFile instance to get from the map.
   * @returns PvFile returns the current file instance related to ptr.
   */
  public static getPtr(ptr: number): PvFile {
    return PvFile._filePtrs.get(ptr);
  }

  /**
   * Saves the PvFile instance to the map with an associated ptr.
   * @param ptr The file pointer to save as the key.
   * @param instance The PvFile instance to save as the value.
   */
  public static setPtr(ptr: number, instance: PvFile): void {
    PvFile._filePtrs.set(ptr, instance);
  }

  /**
   * Removes the ptr from the _filePtrs map.
   * @param ptr The file pointer to remove.
   */
  public static removePtr(ptr: number): void {
    PvFile._filePtrs.delete(ptr);
  }

  /**
   * Checks if the current stream is EOF.
   * @private
   */
  private get _isEOF() {
    return (this._pagePtr >= (this._meta.numPages - 1)) && (this._pageOffset >= (this._meta.size % this._pageSize));
  }

  /**
   * Creates an index which as a key to save page data to IndexedDB.
   * This formats the file into 0000, 0001, 0002 ...
   * @param page The page number to format.
   * @private
   */
  private static createPage(page: number) {
    return ("000" + page).slice(-4);
  }

  /**
   * Gets a objectStore instance from the PvFile instance.
   * @private
   */
  private get _store() {
    return this._db.transaction(PV_FILE_STORE, this._mode).objectStore(PV_FILE_STORE);
  }
}
