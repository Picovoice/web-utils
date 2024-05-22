/*
  Copyright 2022-2023 Picovoice Inc.

  You may not use this file except in compliance with the license. A copy of the license is located in the "LICENSE"
  file accompanying this source.

  Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on
  an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the
  specific language governing permissions and limitations under the License.
*/

/**
 * PvFileMeta type.
 * Contains meta data for "PvFile".
 */
export type PvFileMeta = {
  size: number;
  numPages: number;
  version?: number;
  pageSize?: number;
}

/**
 * BasePvFile Class
 * This class mocks the file system using in-memory storage.
 */
export abstract class PvFile {
  protected static _filePtrs = new Map<number, PvFile>();
  protected _path: string = '';
  protected _meta: PvFileMeta | undefined;

  /**
   * Getter for file's meta information.
   */
  get meta(): PvFileMeta | undefined {
    if (this._meta === undefined) {
      return undefined;
    }
    return {
      version: 0,
      ...this._meta
    };
  }

  get pageSize(): number | undefined {
    return undefined;
  }

  public abstract close(): Promise<void> | void;

  public abstract read(size: number, count: number): Promise<Uint8Array> | Uint8Array;

  public abstract write(content: Uint8Array, version?: number): Promise<void> | void;

  public abstract seek(offset: number, whence: number): void;

  public abstract tell(): number;

  public abstract remove(): Promise<void> | void;

  public abstract exists(): boolean;

  /**
   * Get the file pointer from the _filePtrs map.
   * @param ptr The pointer to BasePvFile instance to get from the map.
   * @returns BasePvFile returns the current file instance related to ptr.
   */
  public static getPtr(ptr: number): PvFile {
    if (PvFile._filePtrs.has(ptr)) {
      return PvFile._filePtrs.get(ptr)!;
    }
    throw new Error('File instance not found.');
  }

  /**
   * Saves the BasePvFile instance to the map with an associated ptr.
   * @param ptr The file pointer to save as the key.
   * @param instance The BasePvFile instance to save as the value.
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
   */
  protected abstract get _isEOF(): boolean;
}
