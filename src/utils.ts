/*
  Copyright 2022 Picovoice Inc.

  You may not use this file except in compliance with the license. A copy of the license is located in the "LICENSE"
  file accompanying this source.

  Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on
  an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the
  specific language governing permissions and limitations under the License.
*/

import { PvFile } from './pv_file';
import { PvFileIDB } from './pv_file_idb';
import { PvFileMem } from './pv_file_mem';
import { PvModel } from './types';

/**
 * Cast a signed address to unsigned address.
 *
 * @param address The address to cast to unsigned address.
 */
export function unsignedAddress(address: number) {
  if (address < 0) {
    return address >>> 0;
  }
  return address;
}

/**
 * Convert a null terminated phrase stored inside an array buffer to a string
 *
 * @param arrayBuffer input array buffer
 * @param indexStart the index at which the phrase is stored
 * @return retrieved string
 */
export function arrayBufferToStringAtIndex(
  arrayBuffer: Uint8Array,
  indexStart: number
): string {
  let indexEnd = indexStart;
  while (arrayBuffer[indexEnd] !== 0) {
    indexEnd++;
  }
  const utf8decoder = new TextDecoder('utf-8');
  return utf8decoder.decode(arrayBuffer.slice(indexStart, indexEnd));
}

/**
 * Decode a base64 string and stored it in a Uint8Array array
 *
 * @param base64String input base64 string
 * @return decoded array
 */
export function base64ToUint8Array(base64String: string): Uint8Array {
  const base64StringDecoded = atob(base64String);
  const binaryArray = new Uint8Array(base64StringDecoded.length);
  for (let i = 0; i < base64StringDecoded.length; i++) {
    binaryArray[i] = base64StringDecoded.charCodeAt(i);
  }
  return binaryArray;
}

/**
 * Encode an ArrayBuffer array to base64 string
 *
 * @param arrayBuffer input array
 * @param size size of the phrase to be encoded
 * @param index the index at which the phrase is stored
 * @return base64 string
 */
export function arrayBufferToBase64AtIndex(
  arrayBuffer: ArrayBuffer,
  size: number,
  index: number
): string {
  let binary = '';
  for (let i = 0; i < size; i++) {
    // @ts-ignore
    binary += String.fromCharCode(arrayBuffer[index + i]);
  }
  return btoa(binary);
}

/**
 * Convert a string header to JS object
 *
 * @param stringHeader input string in json format
 * @return retrieved object
 */
// eslint-disable-next-line
export function stringHeaderToObject(stringHeader: string): object {
  const objectHeader = {};
  for (const property of stringHeader.split('\r\n')) {
    const keyValuePair = property.split(': ');
    if (keyValuePair[0] !== '') {
      // @ts-ignore
      objectHeader[keyValuePair[0]] = keyValuePair[1];
    }
  }
  return objectHeader;
}

/**
 * A wrapper to fetch that also supports timeout
 *
 * @param uri the URL of the resource
 * @param options other options related to fetch
 * @param time timeout value
 * @return received response
 */
export async function fetchWithTimeout(
  uri: string,
  options = {},
  time = 5000
): Promise<Response> {
  const controller = new AbortController();
  const config = { ...options, signal: controller.signal };
  const timeout = setTimeout(() => {
    controller.abort();
  }, time);
  const response = await fetch(uri, config);
  clearTimeout(timeout);
  return response;
}

/**
 * Checking whether the given AccessKey is valid
 *
 * @return true if the AccessKey is valid, false if not
 */
export function isAccessKeyValid(accessKey: string): boolean {
  if (typeof accessKey !== 'string') {
    return false;
  }
  const accessKeyCleaned = accessKey.trim();
  if (accessKeyCleaned === '') {
    return false;
  }
  try {
    return btoa(atob(accessKeyCleaned)) === accessKeyCleaned;
  } catch (err) {
    return false;
  }
}

/**
 * Opens the file given the path and mode.
 * @returns PvFile instance.
 */
export async function open(path: string, mode: string): Promise<PvFile> {
  try {
    return await PvFileIDB.open(path, mode);
  } catch (e: any) {
    if (e.name === 'IndexedDBNotSupported') {
      // eslint-disable-next-line no-console
      console.warn(
        'IndexedDB is not supported. Fallback to in-memory storage.'
      );
    } else if (e.name !== 'FileNotExists') {
      // eslint-disable-next-line no-console
      console.warn(
        `Unable to access IndexedDB (${e.toString()}). Fallback to in-memory storage.`
      );
    }

    if (
      // @ts-ignore
      typeof WorkerGlobalScope !== 'undefined' &&
      // @ts-ignore
      self instanceof WorkerGlobalScope
    ) {
      if (e.name === 'FileNotExists') {
        throw e;
      }

      // eslint-disable-next-line no-console
      console.error('In-memory storage cannot be used inside a worker.');
      const error = new Error(`Failed to start PvFile: ${e.toString()}`);
      error.name = 'PvFileNotSupported';
      throw error;
    }

    return PvFileMem.open(path, mode);
  }
}

/**
 * PvFile helper.
 * Write modelBase64 to modelPath depending on options forceWrite and version.
 */
export async function fromBase64(
  modelPath: string,
  modelBase64: string,
  forceWrite: boolean,
  version: number
) {
  const pvFile = await open(modelPath, 'w');
  if (
    forceWrite ||
    pvFile.meta === undefined ||
    version > pvFile.meta.version! ||
    (pvFile.meta.pageSize !== pvFile.pageSize)
  ) {
    await pvFile.write(base64ToUint8Array(modelBase64), version);
  }
}

const BACKOFF_CAP_MILLISECONDS = 5000;
const BACKOFF_START_MILLISECONDS = 2;

/**
 * PvFile helper.
 * Write publicPath's model to modelPath depending on options forceWrite and version.
 */
export async function fromPublicDirectory(
  modelPath: string,
  publicPath: string,
  forceWrite: boolean,
  version: number,
  numFetchReties: number
) {
  const pvFile = await open(modelPath, 'w');
  if (
    forceWrite ||
    pvFile.meta === undefined ||
    version > pvFile.meta.version! ||
    (pvFile.meta.pageSize !== pvFile.pageSize)
  ) {
    if (numFetchReties < 0) {
      throw Error('numFetchRetries must be a positive number');
    }

    let waitTimeMilliseconds = BACKOFF_START_MILLISECONDS;
    const delay = (delayMilliseconds: number) =>
      new Promise(resolve => {
        setTimeout(resolve, delayMilliseconds);
      });

    let numAttemptsLeft: number = numFetchReties + 1;
    let error: Error | null = null;
    while (numAttemptsLeft > 0) {
      error = null;
      try {
        const response = await fetch(publicPath, {
          cache: 'no-cache',
        });
        if (response.ok) {
          const data = await response.arrayBuffer();
          await pvFile.write(new Uint8Array(data), version);
          return;
        }
        const responseText = await response.text();
        error = new Error(
          `Error response returned while fetching model from '${publicPath}': ${responseText}`
        );
      } catch (e: any) {
        error = new Error(
          `Failed to fetch model from '${publicPath}': ${e.message}`
        );
      }

      numAttemptsLeft--;
      await delay(waitTimeMilliseconds);
      waitTimeMilliseconds = Math.min(
        BACKOFF_CAP_MILLISECONDS,
        waitTimeMilliseconds * BACKOFF_START_MILLISECONDS
      );
    }

    if (error !== null) {
      throw error;
    } else {
      throw new Error(
        `Unexpected error encountered while fetching model from '${publicPath}'`
      );
    }
  }
}

/**
 * Takes a Picovoice model file and either decodes it from base64 or fetches
 * it from the public directory. Saves the result to storage on version increase or
 * if forceWrite is enabled.
 */
export async function loadModel(model: PvModel): Promise<string> {
  if (model === undefined || model === null) {
    throw new Error('The model is undefined / empty');
  }

  const {
    base64,
    publicPath,
    customWritePath,
    forceWrite = false,
    version = 1,
    numFetchRetries = 0,
  } = model;

  if (customWritePath === undefined || customWritePath === null) {
    throw new Error(
      'The customWritePath of the provided model is undefined / empty'
    );
  }

  if (base64 !== undefined && base64 !== null) {
    await fromBase64(customWritePath, base64, forceWrite, version);
  } else if (publicPath !== undefined && publicPath !== null) {
    await fromPublicDirectory(
      customWritePath,
      publicPath,
      forceWrite,
      version,
      numFetchRetries
    );
  } else {
    throw new Error(
      "The provided model doesn't contain a valid publicPath or base64 value"
    );
  }

  return customWritePath;
}
