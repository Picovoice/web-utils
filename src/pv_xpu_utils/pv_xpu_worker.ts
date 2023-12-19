/*
  Copyright 2023 Picovoice Inc.

  You may not use this file except in compliance with the license. A copy of the license is located in the "LICENSE"
  file accompanying this source.

  Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on
  an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the
  specific language governing permissions and limitations under the License.
*/

/* eslint camelcase: 0 */

import { PvXpuAction } from './pv_xpu_types';
import { wasiSnapshotPreview1Emulator } from '../wasi_snapshot';

import { pvMvmActionMap } from './pv_mvm_worker';

let exports: any = null;
let memory: WebAssembly.Memory;
const memAlloc: Map<number, { allocSize: number, workerMemAddress: number }> = new Map();

const getWasm = async (wasm: Uint8Array) => {
  const instance = (await WebAssembly.instantiate(wasm, {
    wasi_snapshot_preview1: wasiSnapshotPreview1Emulator,
    env: {
      memory: memory,
    }
  })).instance;
  return instance.exports;
};

const init = async (data: any) => {
  try {
    memory = new WebAssembly.Memory({ initial: 4096 });
    exports = await getWasm(data.wasm);
    self.postMessage({
      command: 'ok'
    });
  } catch (e: any) {
    self.postMessage({
      command: 'error',
      message: e.message
    });
  }
};

const allocMem = (data: any) => {
  try {
    const { size, memAddress } = data;
    const { aligned_alloc } = exports!;

    const workerMemAddress = aligned_alloc(Uint8Array.BYTES_PER_ELEMENT, size * Uint8Array.BYTES_PER_ELEMENT);
    memAlloc.set(memAddress, {
      allocSize: size,
      workerMemAddress: workerMemAddress,
    });

    self.postMessage({
      command: 'ok'
    });
  } catch (e: any) {
    self.postMessage({
      command: 'error',
      message: e.message
    });
  }
};

const freeMem = (data: any) => {
  try {
    const { memAddress } = data;
    const { free } = exports!;

    if (memAlloc.has(memAddress)) {
      const { workerMemAddress } = memAlloc.get(memAddress)!;
      free(workerMemAddress);
      memAlloc.delete(memAddress);
    }

    self.postMessage({
      command: 'ok',
    });
  } catch (e: any) {
    self.postMessage({
      command: 'error',
      message: e.message
    });
  }
};

const copyToXpu = (data: any) => {
  try {
    const { memAddress } = data;

    const { workerMemAddress } = memAlloc.get(memAddress)!;

    const memoryBufferUint8 = new Uint8Array(memory.buffer);
    memoryBufferUint8.set(data.buffer, workerMemAddress);

    self.postMessage({
      command: 'ok',
    });
  } catch (e: any) {
    self.postMessage({
      command: 'error',
      message: e.message
    });
  }
};

const copyFromXpu = (data: any) => {
  try {
    const { memAddress, size } = data;

    const { workerMemAddress } = memAlloc.get(memAddress)!;

    const memoryBufferUint8 = new Uint8Array(memory.buffer);
    self.postMessage({
      command: 'ok',
      result: memoryBufferUint8.slice(workerMemAddress, workerMemAddress + size),
    });
  } catch (e: any) {
    self.postMessage({
      command: 'error',
      message: e.message
    });
  }
};

const xpuActionMap: Partial<Record<PvXpuAction, CallableFunction>> = {
  [PvXpuAction.INIT]: init,
  [PvXpuAction.ALLOC]: allocMem,
  [PvXpuAction.FREE]: freeMem,
  [PvXpuAction.COPY_TO_XPU]: copyToXpu,
  [PvXpuAction.COPY_FROM_XPU]: copyFromXpu,

  // matrix vector multiply
  ...pvMvmActionMap,
};

self.onmessage = async function(
  event: MessageEvent,
): Promise<void> {
  if (event.data.action in xpuActionMap) {
    event.data.globals = {
      exports,
      memory,
      memAlloc,
    };
    await xpuActionMap[event.data.action as PvXpuAction]!(event.data);
  } else {
    self.postMessage({
      command: 'failed',
      message: `Unrecognized command: ${event.data.action}`,
    });
  }
};

