/*
  Copyright 2022 Picovoice Inc.

  You may not use this file except in compliance with the license. A copy of the license is located in the "LICENSE"
  file accompanying this source.

  Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on
  an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the
  specific language governing permissions and limitations under the License.
*/

import { PvFile } from "./pv_file";

/**
 * Convert a null terminated phrase stored inside an array buffer to a string
 *
 * @param arrayBuffer input array buffer
 * @param indexStart the index at which the phrase is stored
 * @return retrieved string
 */
export function arrayBufferToStringAtIndex(
  arrayBuffer: Uint8Array,
  indexStart: number,
): string {
  let indexEnd = indexStart;
  while (arrayBuffer[indexEnd] !== 0) {
    indexEnd++;
  }
  const utf8decoder = new TextDecoder('utf-8');
  return utf8decoder.decode(arrayBuffer.subarray(indexStart, indexEnd));
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
export function arrayBufferToBase64AtIndex(arrayBuffer: ArrayBuffer, size: number, index: number): string {
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
export async function fetchWithTimeout(uri: string, options = {}, time = 5000): Promise<Response> {
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
  if (typeof accessKey !== 'string' || accessKey === undefined || accessKey === null) {
    return false;
  }
  const accessKeyCleaned = accessKey.trim();
  if (accessKeyCleaned === '') { return false; }
  try {
    return btoa(atob(accessKeyCleaned)) === accessKeyCleaned;
  } catch (err) {
    return false;
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
  version: number,
) {
  const pvFile = await PvFile.open(modelPath, "w");
  if (forceWrite || (pvFile.meta === undefined) || (version > pvFile.meta.version)) {
    await pvFile.write(base64ToUint8Array(modelBase64), version);
  }
}

/**
 * PvFile helper.
 * Write publicPath's model to modelPath depending on options forceWrite and version.
 */
export async function fromPublicDirectory(
  modelPath: string,
  publicPath: string,
  forceWrite: boolean,
  version: number,
) {
  const pvFile = await PvFile.open(modelPath, "w");
  if (forceWrite || (pvFile.meta === undefined) || (version > pvFile.meta.version)) {
    const response = await fetch(publicPath);
    if (!response.ok) {
      throw new Error(`Failed to get model from '${publicPath}'`);
    }
    const data = await response.arrayBuffer();
    await pvFile.write(new Uint8Array(data));
  }
}
