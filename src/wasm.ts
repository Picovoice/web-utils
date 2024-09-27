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
  open,
  unsignedAddress,
} from './utils';

import { PvFile } from './pv_file';
import { PvError } from './pv_error';

import { wasiSnapshotPreview1Emulator } from './wasi_snapshot';

export type aligned_alloc_type = (
  alignment: number,
  size: number
) => Promise<number>;
export type pv_free_type = (ptr: number) => Promise<void>;

/**
 * Imports and Exports functions required for WASM.
 *
 * @param memory Initialized WebAssembly memory object.
 * @param wasm The wasm file in base64 string or stream to public path (i.e. fetch("file.wasm")) to initialize.
 * @param pvError The PvError object to store error details.
 * @param additionalImports Extra WASM imports.
 * @param wasiImports Additional WASI imports.
 * @returns An object containing the exported functions from WASM.
 */
export async function buildWasm(
  memory: WebAssembly.Memory,
  wasm: string | Promise<Response>,
  pvError?: PvError,
  additionalImports: Record<string, any> = {},
  wasiImports: Record<string, any> = {}
): Promise<any> {
  const setInt = (address: number, value: number) => {
    const memoryBufferInt32 = new Int32Array(memory.buffer);
    memoryBufferInt32[address / Int32Array.BYTES_PER_ELEMENT] = value;
  };

  const alignedAlloc = async function (alignment: number, size: number) {
    // eslint-disable-next-line
    const pointer = await aligned_alloc(alignment, size);
    return unsignedAddress(pointer);
  };

  const pvConsoleLogWasm = function (index: number): void {
    index = unsignedAddress(index);

    const memoryBufferUint8 = new Uint8Array(memory.buffer);
    // eslint-disable-next-line no-console
    console.log(arrayBufferToStringAtIndex(memoryBufferUint8, index));
  };

  const pvAssertWasm = function (
    expr: number,
    line: number,
    fileNameAddress: number
  ): void {
    fileNameAddress = unsignedAddress(fileNameAddress);

    const memoryBufferUint8 = new Uint8Array(memory.buffer);
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
    httpMethodAddress = unsignedAddress(httpMethodAddress);
    serverNameAddress = unsignedAddress(serverNameAddress);
    endpointAddress = unsignedAddress(endpointAddress);
    headerAddress = unsignedAddress(headerAddress);
    bodyAddress = unsignedAddress(bodyAddress);
    responseAddressAddress = unsignedAddress(responseAddressAddress);
    responseSizeAddress = unsignedAddress(responseSizeAddress);
    responseCodeAddress = unsignedAddress(responseCodeAddress);

    const memoryBufferUint8 = new Uint8Array(memory.buffer);

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
    const header = arrayBufferToStringAtIndex(memoryBufferUint8, headerAddress);
    const body = arrayBufferToStringAtIndex(memoryBufferUint8, bodyAddress);

    const headerObject = stringHeaderToObject(header);

    const options: Record<string, any> = {
      method: httpMethod,
    };

    if (body.length > 0) {
      options.body = body;
    }

    if (Object.keys(headerObject).length > 0) {
      options.headers = headerObject;
    }

    let response: Response;
    let responseText: string;
    let statusCode: number;

    try {
      response = await fetchWithTimeout(
        'https://' + serverName + endpoint,
        options,
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
      pvError?.addError(
        'pvHttpsRequestWasm',
        `Failed to get response text: ${error}`
      );
      return;
    }

    // eslint-disable-next-line
    const responseAddress = await alignedAlloc(
      Int8Array.BYTES_PER_ELEMENT,
      (responseText.length + 1) * Int8Array.BYTES_PER_ELEMENT
    );
    if (responseAddress === 0) {
      pvError?.addError(
        'pvMallocError',
        'pvHttpsRequestWasm: cannot allocate memory for response'
      );
      setInt(responseAddressAddress, 0);
      return;
    }

    setInt(responseSizeAddress, responseText.length + 1);
    setInt(responseAddressAddress, responseAddress);

    for (let i = 0; i < responseText.length; i++) {
      memoryBufferUint8[responseAddress + i] = responseText.charCodeAt(i);
    }
    memoryBufferUint8[responseAddress + responseText.length] = 0;

    setInt(responseCodeAddress, statusCode);
  };

  const pvGetBrowserInfo = async function (
    browserInfoAddressAddress: number
  ): Promise<void> {
    browserInfoAddressAddress = unsignedAddress(browserInfoAddressAddress);

    const memoryBufferUint8 = new Uint8Array(memory.buffer);

    const userAgent =
      navigator.userAgent !== undefined ? navigator.userAgent : 'unknown';
    // eslint-disable-next-line
    const browserInfoAddress = await alignedAlloc(
      Uint8Array.BYTES_PER_ELEMENT,
      (userAgent.length + 1) * Uint8Array.BYTES_PER_ELEMENT
    );

    if (browserInfoAddress === 0) {
      pvError?.addError(
        'pvMallocError',
        'pvGetBrowserInfo: cannot allocate memory for browser info'
      );
      setInt(browserInfoAddressAddress, 0);
      return;
    }

    setInt(browserInfoAddressAddress, browserInfoAddress);
    for (let i = 0; i < userAgent.length; i++) {
      memoryBufferUint8[browserInfoAddress + i] = userAgent.charCodeAt(i);
    }
    memoryBufferUint8[browserInfoAddress + userAgent.length] = 0;
  };

  const pvGetOriginInfo = async function (
    originInfoAddressAddress: number
  ): Promise<void> {
    originInfoAddressAddress = unsignedAddress(originInfoAddressAddress);

    const memoryBufferUint8 = new Uint8Array(memory.buffer);

    const origin = self.origin ?? self.location.origin;
    const hostname = new URL(origin).hostname;
    // eslint-disable-next-line
    const originInfoAddress = await alignedAlloc(
      Uint8Array.BYTES_PER_ELEMENT,
      (hostname.length + 1) * Uint8Array.BYTES_PER_ELEMENT
    );

    if (originInfoAddress === 0) {
      pvError?.addError(
        'pvMallocError',
        'pvGetOriginInfo: cannot allocate memory for origin info'
      );
      setInt(originInfoAddressAddress, 0);
      return;
    }

    setInt(originInfoAddressAddress, originInfoAddress);
    for (let i = 0; i < hostname.length; i++) {
      memoryBufferUint8[originInfoAddress + i] = hostname.charCodeAt(i);
    }
    memoryBufferUint8[originInfoAddress + hostname.length] = 0;
  };

  const pvFileOpenWasm = async function (
    fileAddress: number,
    pathAddress: number,
    modeAddress: number,
    statusAddress: number
  ) {
    fileAddress = unsignedAddress(fileAddress);
    pathAddress = unsignedAddress(pathAddress);
    modeAddress = unsignedAddress(modeAddress);
    statusAddress = unsignedAddress(statusAddress);

    const memoryBufferUint8 = new Uint8Array(memory.buffer);

    const path = arrayBufferToStringAtIndex(memoryBufferUint8, pathAddress);
    const mode = arrayBufferToStringAtIndex(memoryBufferUint8, modeAddress);
    try {
      const file = await open(path, mode);
      PvFile.setPtr(fileAddress, file);
      setInt(statusAddress, 0);
    } catch (e: any) {
      if (e.name !== 'FileNotExists') {
        pvError?.addError('pvFileOpenWasm', e);
      }
      setInt(statusAddress, -1);
    }
  };

  const pvFileCloseWasm = async function (
    fileAddress: number,
    statusAddress: number
  ) {
    fileAddress = unsignedAddress(fileAddress);
    statusAddress = unsignedAddress(statusAddress);

    try {
      const file = await PvFile.getPtr(fileAddress);
      await file.close();
      setInt(statusAddress, 0);
    } catch (e: any) {
      pvError?.addError('pvFileCloseWasm', e);
      setInt(statusAddress, -1);
    }
  };

  const pvFileReadWasm = async function (
    fileAddress: number,
    contentAddress: number,
    size: number,
    count: number,
    numReadAddress: number
  ) {
    fileAddress = unsignedAddress(fileAddress);
    contentAddress = unsignedAddress(contentAddress);
    numReadAddress = unsignedAddress(numReadAddress);

    const memoryBufferUint8 = new Uint8Array(memory.buffer);

    try {
      const file = PvFile.getPtr(fileAddress);
      const content = await file.read(size, count);
      memoryBufferUint8.set(content, unsignedAddress(contentAddress));
      setInt(numReadAddress, content.length / size);
    } catch (e: any) {
      pvError?.addError('pvFileReadWasm', e);
      setInt(numReadAddress, -1);
    }
  };

  const pvFileWriteWasm = async function (
    fileAddress: number,
    contentAddress: number,
    size: number,
    count: number,
    numWriteAddress: number
  ) {
    fileAddress = unsignedAddress(fileAddress);
    contentAddress = unsignedAddress(contentAddress);
    numWriteAddress = unsignedAddress(numWriteAddress);

    const memoryBufferUint8 = new Uint8Array(memory.buffer);

    try {
      const file = PvFile.getPtr(fileAddress);
      const content = new Uint8Array(size * count);
      content.set(
        memoryBufferUint8.slice(
          unsignedAddress(contentAddress),
          unsignedAddress(contentAddress) + size * count
        ),
        0
      );
      await file.write(content);
      setInt(numWriteAddress, content.length / size);
    } catch (e: any) {
      pvError?.addError('pvFileWriteWasm', e);
      setInt(numWriteAddress, -1);
    }
  };

  const pvFileSeekWasm = function (
    fileAddress: number,
    offset: number,
    whence: number,
    statusAddress: number
  ) {
    fileAddress = unsignedAddress(fileAddress);
    statusAddress = unsignedAddress(statusAddress);

    try {
      const file = PvFile.getPtr(fileAddress);
      file.seek(offset, whence);
      setInt(statusAddress, 0);
    } catch (e: any) {
      pvError?.addError('pvFileSeekWasm', e);
      setInt(statusAddress, -1);
    }
  };

  const pvFileTellWasm = function (fileAddress: number, offsetAddress: number) {
    fileAddress = unsignedAddress(fileAddress);
    offsetAddress = unsignedAddress(offsetAddress);

    try {
      const file = PvFile.getPtr(fileAddress);
      setInt(offsetAddress, file.tell());
    } catch (e: any) {
      pvError?.addError('pvFileTellWasm', e);
      setInt(offsetAddress, -1);
    }
  };

  const pvFileRemoveWasm = async function (
    pathAddress: number,
    statusAddress: number
  ) {
    pathAddress = unsignedAddress(pathAddress);
    statusAddress = unsignedAddress(statusAddress);

    const memoryBufferUint8 = new Uint8Array(memory.buffer);

    const path = arrayBufferToStringAtIndex(memoryBufferUint8, pathAddress);
    try {
      const file = await open(path, 'w');
      await file.remove();
      setInt(statusAddress, 0);
    } catch (e: any) {
      pvError?.addError('pvFileRemoveWasm', e);
      setInt(statusAddress, -1);
    }
  };

  const pvSleepWasm = async function (ms: number) {
    return new Promise(resolve => {
      setTimeout(() => {
        resolve(null);
      }, ms);
    });
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
      pv_file_remove_wasm: pvFileRemoveWasm,
      pv_sleep_wasm: pvSleepWasm,
      ...additionalImports,
    },
    wasi: {
      ...wasiImports,
    },
  };

  let instance: WebAssembly.Instance;
  if (wasm instanceof Promise) {
    if (Asyncify.instantiateStreaming) {
      instance = (await Asyncify.instantiateStreaming(wasm, importObject))
        .instance;
    } else {
      const response = await wasm;
      const data = await response.arrayBuffer();
      instance = (
        await Asyncify.instantiate(new Uint8Array(data), importObject)
      ).instance;
    }
  } else {
    const wasmCodeArray = base64ToUint8Array(wasm);
    instance = (await Asyncify.instantiate(wasmCodeArray, importObject))
      .instance;
  }

  const aligned_alloc = instance.exports.aligned_alloc as aligned_alloc_type;

  return {
    ...instance.exports,
    aligned_alloc: alignedAlloc,
  };
}
