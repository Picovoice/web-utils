/*
  Copyright 2022 Picovoice Inc.

  You may not use this file except in compliance with the license. A copy of the license is located in the "LICENSE"
  file accompanying this source.

  Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on
  an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the
  specific language governing permissions and limitations under the License.
*/

import * as Asyncify from 'asyncify-wasm';

import {
  arrayBufferToBase64AtIndex,
  arrayBufferToStringAtIndex,
  base64ToUint8Array,
  fetchWithTimeout,
  getPvStorage,
  stringHeaderToObject,
} from './utils';

import { wasiSnapshotPreview1Emulator } from './wasi_snapshot';

export type aligned_alloc_type = (alignment: number, size: number) => Promise<number>;

/**
 * Imports and Exports functions required for WASM.
 * 
 * @param memory Initialized WebAssembly memory object.
 * @param wasm_base64 The wasm file in base64 string to initialize.
 * @returns An object containing the exported functions from WASM.
 */
export async function linkWasm(
  memory: WebAssembly.Memory,
  wasm_base64: string
): Promise<any> {
  const memoryBufferUint8 = new Uint8Array(memory.buffer);
  const memoryBufferInt32 = new Int32Array(memory.buffer);

  const storage = getPvStorage();

  const pvConsoleLogWasm = function (index: number): void {
    // eslint-disable-next-line no-console
    console.log(arrayBufferToStringAtIndex(memoryBufferUint8, index));
  };

  const pvAssertWasm = function (
    expr: number,
    line: number,
    fileNameAddress: number
  ): void {
    if (expr === 0) {
      const fileName = arrayBufferToStringAtIndex(
        memoryBufferUint8,
        fileNameAddress
      );
      throw new Error(`assertion failed at line ${line} in "${fileName}"`);
    }
  };

  const pvTimeWasm = function (): number {
    return Date.now() / 1000;
  };

  const pvHttpsRequestWasm = async function (
    httpMethodAddress: number,
    serverNameAddress: number,
    endpointAddress: number,
    headerAddress: number,
    bodyAddress: number,
    timeoutMs: number,
    responseAddressAddress: number,
    responseSizeAddress: number,
    responseCodeAddress: number
  ): Promise<void> {
    const httpMethod = arrayBufferToStringAtIndex(
      memoryBufferUint8,
      httpMethodAddress
    );
    const serverName = arrayBufferToStringAtIndex(
      memoryBufferUint8,
      serverNameAddress
    );
    const endpoint = arrayBufferToStringAtIndex(
      memoryBufferUint8,
      endpointAddress
    );
    const header = arrayBufferToStringAtIndex(
      memoryBufferUint8,
      headerAddress
    );
    const body = arrayBufferToStringAtIndex(memoryBufferUint8, bodyAddress);

    const headerObject = stringHeaderToObject(header);

    let response: Response;
    let responseText: string;
    let statusCode: number;

    try {
      response = await fetchWithTimeout(
        'https://' + serverName + endpoint,
        {
          method: httpMethod,
          headers: headerObject,
          body: body,
        },
        timeoutMs
      );
      statusCode = response.status;
    } catch (error) {
      statusCode = 0;
    }
    // @ts-ignore
    if (response !== undefined) {
      try {
        responseText = await response.text();
      } catch (error) {
        responseText = '';
        statusCode = 1;
      }
      // eslint-disable-next-line
      const responseAddress = await aligned_alloc(
        Int8Array.BYTES_PER_ELEMENT,
        (responseText.length + 1) * Int8Array.BYTES_PER_ELEMENT
      );
      if (responseAddress === 0) {
        throw new Error('malloc failed: Cannot allocate memory');
      }

      memoryBufferInt32[
        responseSizeAddress / Int32Array.BYTES_PER_ELEMENT
      ] = responseText.length + 1;
      memoryBufferInt32[
        responseAddressAddress / Int32Array.BYTES_PER_ELEMENT
      ] = responseAddress;

      for (let i = 0; i < responseText.length; i++) {
        memoryBufferUint8[responseAddress + i] = responseText.charCodeAt(i);
      }
      memoryBufferUint8[responseAddress + responseText.length] = 0;
    }

    memoryBufferInt32[
      responseCodeAddress / Int32Array.BYTES_PER_ELEMENT
    ] = statusCode;
  };

  const pvFileLoadWasm = async function (
    pathAddress: number,
    numContentBytesAddress: number,
    contentAddressAddress: number,
    succeededAddress: number
  ): Promise<void> {
    const path = arrayBufferToStringAtIndex(memoryBufferUint8, pathAddress);
    try {
      const contentBase64 = await storage.getItem(path);
      const contentBuffer = base64ToUint8Array(contentBase64);
      // eslint-disable-next-line
      const contentAddress = await aligned_alloc(
        Uint8Array.BYTES_PER_ELEMENT,
        contentBuffer.length * Uint8Array.BYTES_PER_ELEMENT
      );

      if (contentAddress === 0) {
        throw new Error('malloc failed: Cannot allocate memory');
      }

      memoryBufferInt32[
        numContentBytesAddress / Int32Array.BYTES_PER_ELEMENT
      ] = contentBuffer.byteLength;
      memoryBufferInt32[
        contentAddressAddress / Int32Array.BYTES_PER_ELEMENT
      ] = contentAddress;
      memoryBufferUint8.set(contentBuffer, contentAddress);
      memoryBufferInt32[
        succeededAddress / Int32Array.BYTES_PER_ELEMENT
      ] = 1;
    } catch (error) {
      memoryBufferInt32[
        succeededAddress / Int32Array.BYTES_PER_ELEMENT
      ] = 0;
    }
  };

  const pvFileSaveWasm = async function (
    pathAddress: number,
    numContentBytes: number,
    contentAddress: number,
    succeededAddress: number
  ): Promise<void> {
    const path = arrayBufferToStringAtIndex(memoryBufferUint8, pathAddress);
    const content = arrayBufferToBase64AtIndex(
      memoryBufferUint8,
      numContentBytes,
      contentAddress
    );
    try {
      await storage.setItem(path, content);
      memoryBufferInt32[
        succeededAddress / Int32Array.BYTES_PER_ELEMENT
      ] = 1;
    } catch (error) {
      memoryBufferInt32[
        succeededAddress / Int32Array.BYTES_PER_ELEMENT
      ] = 0;
    }
  };

  const pvFileExistsWasm = async function (
    pathAddress: number,
    isExistsAddress: number,
    succeededAddress: number
  ): Promise<void> {
    const path = arrayBufferToStringAtIndex(memoryBufferUint8, pathAddress);

    try {
      const isExists = await storage.getItem(path);
      memoryBufferUint8[isExistsAddress] = (isExists === undefined || isExists === null) ? 0 : 1;
      memoryBufferInt32[
        succeededAddress / Int32Array.BYTES_PER_ELEMENT
      ] = 1;
    } catch (error) {
      memoryBufferInt32[
        succeededAddress / Int32Array.BYTES_PER_ELEMENT
      ] = 0;
    }
  };

  const pvFileDeleteWasm = async function (
    pathAddress: number,
    succeededAddress: number
  ): Promise<void> {
    const path = arrayBufferToStringAtIndex(memoryBufferUint8, pathAddress);
    try {
      await storage.removeItem(path);
      memoryBufferInt32[
        succeededAddress / Int32Array.BYTES_PER_ELEMENT
      ] = 1;
    } catch (error) {
      memoryBufferInt32[
        succeededAddress / Int32Array.BYTES_PER_ELEMENT
      ] = 0;
    }
  };

  const pvGetBrowserInfo = async function (browserInfoAddressAddress: number): Promise<void> {
    const userAgent =
      navigator.userAgent !== undefined ? navigator.userAgent : 'unknown';
    // eslint-disable-next-line
    const browserInfoAddress = await aligned_alloc(
      Uint8Array.BYTES_PER_ELEMENT,
      (userAgent.length + 1) * Uint8Array.BYTES_PER_ELEMENT
    );

    if (browserInfoAddress === 0) {
      throw new Error('malloc failed: Cannot allocate memory');
    }

    memoryBufferInt32[
      browserInfoAddressAddress / Int32Array.BYTES_PER_ELEMENT
    ] = browserInfoAddress;
    for (let i = 0; i < userAgent.length; i++) {
      memoryBufferUint8[browserInfoAddress + i] = userAgent.charCodeAt(i);
    }
    memoryBufferUint8[browserInfoAddress + userAgent.length] = 0;
  };

  const pvGetOriginInfo = async function(originInfoAddressAddress: number): Promise<void> {
    const origin = self.origin ?? self.location.origin;
    // eslint-disable-next-line
    const originInfoAddress = await aligned_alloc(
      Uint8Array.BYTES_PER_ELEMENT,
      (origin.length + 1) * Uint8Array.BYTES_PER_ELEMENT
    );

    if (originInfoAddress === 0) {
      throw new Error('malloc failed: Cannot allocate memory');
    }

    memoryBufferInt32[
      originInfoAddressAddress / Int32Array.BYTES_PER_ELEMENT
    ] = originInfoAddress;
    for (let i = 0; i < origin.length; i++) {
      memoryBufferUint8[originInfoAddress + i] = origin.charCodeAt(i);
    }
    memoryBufferUint8[originInfoAddress + origin.length] = 0;
  };

  const importObject = {
    // eslint-disable-next-line camelcase
    wasi_snapshot_preview1: wasiSnapshotPreview1Emulator,
    env: {
      memory: memory,
      // eslint-disable-next-line camelcase
      pv_console_log_wasm: pvConsoleLogWasm,
      // eslint-disable-next-line camelcase
      pv_assert_wasm: pvAssertWasm,
      // eslint-disable-next-line camelcase
      pv_time_wasm: pvTimeWasm,
      // eslint-disable-next-line camelcase
      pv_https_request_wasm: pvHttpsRequestWasm,
      // eslint-disable-next-line camelcase
      pv_file_load_wasm: pvFileLoadWasm,
      // eslint-disable-next-line camelcase
      pv_file_save_wasm: pvFileSaveWasm,
      // eslint-disable-next-line camelcase
      pv_file_exists_wasm: pvFileExistsWasm,
      // eslint-disable-next-line camelcase
      pv_file_delete_wasm: pvFileDeleteWasm,
      // eslint-disable-next-line camelcase
      pv_get_browser_info: pvGetBrowserInfo,
      // eslint-disable-next-line camelcase
      pv_get_origin_info: pvGetOriginInfo,
    },
  };

  const wasmCodeArray = base64ToUint8Array(wasm_base64);
  const { instance } = await Asyncify.instantiate(
    wasmCodeArray,
    importObject
  );

  const aligned_alloc = instance.exports.aligned_alloc as aligned_alloc_type;

  return instance.exports;
}