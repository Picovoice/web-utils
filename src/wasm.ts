/*
  Copyright 2022-2023 Picovoice Inc.

  You may not use this file except in compliance with the license. A copy of the license is located in the "LICENSE"
  file accompanying this source.

  Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on
  an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the
  specific language governing permissions and limitations under the License.
*/

/* eslint camelcase: 0 */

import * as Asyncify from 'asyncify-wasm';

import {
  arrayBufferToStringAtIndex,
  base64ToUint8Array,
  fetchWithTimeout,
  stringHeaderToObject,
  open
} from './utils';

import { PvFile } from "./pv_file";
import { PvError } from './pv_error';

import { wasiSnapshotPreview1Emulator } from './wasi_snapshot';

export type aligned_alloc_type = (alignment: number, size: number) => Promise<number>;
export type pv_free_type = (ptr: number) => Promise<void>;

/**
 * Imports and Exports functions required for WASM.
 *
 * @param memory Initialized WebAssembly memory object.
 * @param wasm The wasm file in base64 string or stream to public path (i.e. fetch("file.wasm")) to initialize.
 * @param pvError The PvError object to store error details.
 * @returns An object containing the exported functions from WASM.
 */
export async function buildWasm(
  memory: WebAssembly.Memory,
  wasm: string | Promise<Response>,
  pvError?: PvError
): Promise<any> {
  const memoryBufferUint8 = new Uint8Array(memory.buffer);
  const memoryBufferInt32 = new Int32Array(memory.buffer);

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
      pvError?.addError('pvHttpsRequestWasm', `Failed to fetch: ${error}`);
      return;
    }

    try {
      responseText = await response.text();
    } catch (error) {
      pvError?.addError('pvHttpsRequestWasm', `Failed to get response text: ${error}`);
      return;
    }

    // eslint-disable-next-line
    const responseAddress = await aligned_alloc(
      Int8Array.BYTES_PER_ELEMENT,
      (responseText.length + 1) * Int8Array.BYTES_PER_ELEMENT
    );
    if (responseAddress === 0) {
      pvError?.addError('pvMallocError', "pvHttpsRequestWasm: cannot allocate memory for response");
      memoryBufferInt32[
        responseAddressAddress / Int32Array.BYTES_PER_ELEMENT
      ] = 0;
      return;
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

    memoryBufferInt32[
      responseCodeAddress / Int32Array.BYTES_PER_ELEMENT
    ] = statusCode;
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
      pvError?.addError('pvMallocError', "pvGetBrowserInfo: cannot allocate memory for browser info");
      memoryBufferInt32[
        browserInfoAddressAddress / Int32Array.BYTES_PER_ELEMENT
      ] = 0;
      return;
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
    const hostname = new URL(origin).hostname;
    // eslint-disable-next-line
    const originInfoAddress = await aligned_alloc(
      Uint8Array.BYTES_PER_ELEMENT,
      (hostname.length + 1) * Uint8Array.BYTES_PER_ELEMENT
    );

    if (originInfoAddress === 0) {
      pvError?.addError('pvMallocError', "pvGetOriginInfo: cannot allocate memory for origin info");
      memoryBufferInt32[
        originInfoAddressAddress / Int32Array.BYTES_PER_ELEMENT
      ] = 0;
      return;
    }

    memoryBufferInt32[
      originInfoAddressAddress / Int32Array.BYTES_PER_ELEMENT
    ] = originInfoAddress;
    for (let i = 0; i < hostname.length; i++) {
      memoryBufferUint8[originInfoAddress + i] = hostname.charCodeAt(i);
    }
    memoryBufferUint8[originInfoAddress + hostname.length] = 0;
  };

  const pvFileOpenWasm = async function(
    fileAddress: number,
    pathAddress: number,
    modeAddress: number,
    statusAddress: number
  ) {
    const path = arrayBufferToStringAtIndex(memoryBufferUint8, pathAddress);
    const mode = arrayBufferToStringAtIndex(memoryBufferUint8, modeAddress);
    try {
      const file = await open(path, mode);
      PvFile.setPtr(fileAddress, file);
      memoryBufferInt32[
        statusAddress / Int32Array.BYTES_PER_ELEMENT
      ] = 0;
    } catch (e) {
      if (e.name !== "FileNotExists") {
        pvError?.addError('pvFileOpenWasm', e);
      }
      memoryBufferInt32[
        statusAddress / Int32Array.BYTES_PER_ELEMENT
      ] = -1;
    }
  };

  const pvFileCloseWasm = async function(
    fileAddress: number,
    statusAddress: number
  ) {
    try {
      const file = await PvFile.getPtr(fileAddress);
      await file.close();
      memoryBufferInt32[
        statusAddress / Int32Array.BYTES_PER_ELEMENT
      ] = 0;
    } catch (e) {
      pvError?.addError('pvFileCloseWasm', e);
      memoryBufferInt32[
        statusAddress / Int32Array.BYTES_PER_ELEMENT
      ] = -1;
    }
  };

  const pvFileReadWasm = async function(
    fileAddress: number,
    contentAddress: number,
    size: number,
    count: number,
    numReadAddress: number
  ) {
    try {
      const file = await PvFile.getPtr(fileAddress);
      const content = await file.read(size, count);
      memoryBufferUint8.set(content, contentAddress);
      memoryBufferInt32[
        numReadAddress / Int32Array.BYTES_PER_ELEMENT
      ] = (content.length / size);
    } catch (e) {
      pvError?.addError('pvFileReadWasm', e);
      memoryBufferInt32[
        numReadAddress / Int32Array.BYTES_PER_ELEMENT
      ] = -1;
    }
  };

  const pvFileWriteWasm = async function(
    fileAddress: number,
    contentAddress: number,
    size: number,
    count: number,
    numWriteAddress: number,
  ) {
    try {
      const file = await PvFile.getPtr(fileAddress);
      const content = new Uint8Array(size * count);
      content.set(memoryBufferUint8.slice(contentAddress, contentAddress + (size * count)), 0);
      await file.write(content);
      memoryBufferInt32[
        numWriteAddress / Int32Array.BYTES_PER_ELEMENT
      ] = (content.length / size);
    } catch (e) {
      pvError?.addError('pvFileWriteWasm', e);
      memoryBufferInt32[
        numWriteAddress / Int32Array.BYTES_PER_ELEMENT
      ] = 1;
    }
  };

  const pvFileSeekWasm = function(
    fileAddress: number,
    offset: number,
    whence: number,
    statusAddress: number
  ) {
    try {
      const file = PvFile.getPtr(fileAddress);
      file.seek(offset, whence);
      memoryBufferInt32[
        statusAddress / Int32Array.BYTES_PER_ELEMENT
      ] = 0;
    } catch (e) {
      pvError?.addError('pvFileSeekWasm', e);
      memoryBufferInt32[
        statusAddress / Int32Array.BYTES_PER_ELEMENT
      ] = -1;
    }
  };

  const pvFileTellWasm = function(
    fileAddress: number,
    offsetAddress: number,
  ) {
    try {
      const file = PvFile.getPtr(fileAddress);
      memoryBufferInt32[
        offsetAddress / Int32Array.BYTES_PER_ELEMENT
      ] = file.tell();
    } catch (e) {
      pvError?.addError('pvFileTellWasm', e);
      memoryBufferInt32[
        offsetAddress / Int32Array.BYTES_PER_ELEMENT
      ] = -1;
    }
  };

  const pvFileRemoveWasm = async function(
    pathAddress: number,
    statusAddress: number
  ) {
    const path = arrayBufferToStringAtIndex(memoryBufferUint8, pathAddress);
    try {
      const file = await open(path, "w");
      await file.remove();
      memoryBufferInt32[
        statusAddress / Int32Array.BYTES_PER_ELEMENT
      ] = 0;
    } catch (e) {
      pvError?.addError('pvFileRemoveWasm', e);
      memoryBufferInt32[
        statusAddress / Int32Array.BYTES_PER_ELEMENT
      ] = -1;
    }
  };

  const importObject = {
    // eslint-disable-next-line camelcase
    wasi_snapshot_preview1: wasiSnapshotPreview1Emulator,
    env: {
      memory: memory,
      pv_console_log_wasm: pvConsoleLogWasm,
      pv_assert_wasm: pvAssertWasm,
      pv_time_wasm: pvTimeWasm,
      pv_https_request_wasm: pvHttpsRequestWasm,
      pv_get_browser_info: pvGetBrowserInfo,
      pv_get_origin_info: pvGetOriginInfo,
      pv_file_open_wasm: pvFileOpenWasm,
      pv_file_close_wasm: pvFileCloseWasm,
      pv_file_read_wasm: pvFileReadWasm,
      pv_file_write_wasm: pvFileWriteWasm,
      pv_file_seek_wasm: pvFileSeekWasm,
      pv_file_tell_wasm: pvFileTellWasm,
      pv_file_remove_wasm: pvFileRemoveWasm
    },
  };

  let instance: WebAssembly.Instance;
  if (wasm instanceof Promise) {
    if (Asyncify.instantiateStreaming) {
      instance = (await Asyncify.instantiateStreaming(wasm, importObject)).instance;
    } else {
      const response = await wasm;
      const data = await response.arrayBuffer();
      instance = (await Asyncify.instantiate(new Uint8Array(data), importObject)).instance;
    }
  } else {
    const wasmCodeArray = base64ToUint8Array(wasm);
    instance = (await Asyncify.instantiate(wasmCodeArray, importObject)).instance;
  }

  const aligned_alloc = instance.exports.aligned_alloc as aligned_alloc_type;

  return instance.exports;
}
