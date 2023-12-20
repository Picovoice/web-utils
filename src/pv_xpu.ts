/*
  Copyright 2023 Picovoice Inc.

  You may not use this file except in compliance with the license. A copy of the license is located in the "LICENSE"
  file accompanying this source.

  Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on
  an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the
  specific language governing permissions and limitations under the License.
*/

/* eslint camelcase: 0 */

import { simd } from 'wasm-feature-detect';

import XpuWasm from '../lib/xpu-helper/pv_xpu_helper.wasm';
import XpuWasmSimd from '../lib/xpu-helper/pv_xpu_helper_simd.wasm';
import XpuWorker from 'web-worker:./pv_xpu_utils/pv_xpu_worker.ts';
import { base64ToUint8Array } from './utils';

import { PvXpuAction } from './pv_xpu_utils/pv_xpu_types';

const PV_XPU_MEM_SETTING_SHARED = 1;

type XpuType = {
  deviceMem: Set<number>,
  numWorkers: number,
  workers: Worker[],
  workerActive: boolean[],
  numParts: number,
};

type MemType = {
  objAddress: number,
  // isShared: boolean,
  // allocSize: number,
  buffer: Uint8Array,
};

class PvXpu {
  private static xpuObjects: Map<number, XpuType> = new Map();
  private static memoryObjects: Map<number, MemType> = new Map();

  public static addXpu(objAddress: number, data: XpuType) {
    PvXpu.xpuObjects.set(objAddress, data);
  }

  public static getXpu(objAddress: number): XpuType | undefined {
    return PvXpu.xpuObjects.get(objAddress);
  }

  public static hasXpu(objAddress: number) {
    return PvXpu.xpuObjects.has(objAddress);
  }

  public static removeXpu(objAddress: number) {
    if (PvXpu.xpuObjects.has(objAddress)) {
      const { deviceMem } = PvXpu.xpuObjects.get(objAddress)!;
      for (const memAddress of deviceMem) {
        PvXpu.memoryObjects.delete(memAddress);
      }
      PvXpu.xpuObjects.delete(objAddress);
    }
  }

  public static addMemory(memAddress: number, data: MemType) {
    PvXpu.memoryObjects.set(memAddress, data);
    PvXpu.xpuObjects.get(data.objAddress)!.deviceMem.add(memAddress);
  }

  public static getMemory(memAddress: number): MemType | undefined {
    return PvXpu.memoryObjects.get(memAddress);
  }

  public static hasMemory(memAddress: number) {
    return PvXpu.memoryObjects.has(memAddress);
  }

  public static removeMemory(memAddress: number) {
    if (PvXpu.hasMemory(memAddress)) {
      PvXpu.xpuObjects.get(PvXpu.getMemory(memAddress)!.objAddress)!.deviceMem.delete(memAddress);
    }
    PvXpu.memoryObjects.delete(memAddress);
  }
}

const total: number[] = [];
const workerTotal: number[] = [];
const totalSync: number[] = [];
const totalResult: number[] = [];

const initXpu = (
  memory: WebAssembly.Memory,
) => {
  const waitForWorker = (worker: Worker, command: any, options?: any) => {
    worker.postMessage(command, options);
    return new Promise((resolve, reject) => {
      worker.onmessage = e => {
        switch (e.data.command) {
          case "ok":
            resolve(e.data.result);
            break;
          case "failed":
          case "error":
            reject(e.data.message);
            break;
          default:
            reject(`Unrecognized command: ${e.data.command}`);
        }
      };
    });
  };

  const setStatus = (statusAddress: number, value: number) => {
    const memoryBufferInt32 = new Int32Array(memory.buffer);
    memoryBufferInt32[
      statusAddress / Int32Array.BYTES_PER_ELEMENT
    ] = value;
  };

  const pvXpuDeviceInit = async (objAddress: number, numWorkers: number, statusAddress: number): Promise<void> => {
    const isSimd = await simd();
    const wasm = base64ToUint8Array(isSimd ? XpuWasmSimd : XpuWasm);

    const workers: Worker[] = [];
    const workerActive: boolean[] = [];
    for (let i = 0; i < numWorkers; i++) {
      const worker = new XpuWorker();
      workers.push(worker);
      workerActive.push(false);
      await waitForWorker(worker, {
        action: PvXpuAction.INIT,
        wasm: wasm,
      });
    }

    PvXpu.addXpu(objAddress, {
      deviceMem: new Set(),
      numWorkers: numWorkers,
      workers: workers,
      workerActive: workerActive,
      numParts: 512,
    });
    setStatus(statusAddress, 0);
  };

  const pvXpuDeviceCleanup = (objAddress: number) => {
    const obj = PvXpu.getXpu(objAddress);
    if (!obj) {
      return;
    }

    for (const worker of obj.workers) {
      worker.terminate();
    }
    PvXpu.removeXpu(objAddress);

    const sum = total.reduce((a, b) => a + b, 0);
    const avg = (sum / total.length);
    console.log("Total time in mult: ", avg);

    const workerSum = workerTotal.reduce((a, b) => a + b, 0);
    const workerAvg = (workerSum / workerTotal.length);
    console.log("Worker Total time in mult: ", workerAvg);

    const worker1Sum = totalResult.reduce((a, b) => a + b, 0);
    const worker1Avg = (worker1Sum / totalResult.length);
    console.log("Worker result Total time in mult: ", worker1Avg);

    const syncSum = totalSync.reduce((a, b) => a + b, 0);
    const syncAvg = (syncSum / totalSync.length);
    console.log("Sync Total time: ", syncAvg);
  };

  const pvXpuDeviceMemAlloc = async (objAddress: number, memAddress: number, sizeBytes: number, isShared: number, statusAddress: number): Promise<void> => {
    const obj = PvXpu.getXpu(objAddress);
    if (!obj) {
      setStatus(statusAddress, -1);
      return;
    }

    // const chunkSize = sizeBytes / obj.numWorkers;
    // const workerResults: Promise<any>[] = [];
    // for (let i = 0; i < obj.numWorkers; i++) {
    //   if (isShared === PV_XPU_MEM_SETTING_SHARED) {
    //     workerResults.push(waitForWorker(obj.workers[i], {
    //       action: PvXpuAction.ALLOC,
    //       size: sizeBytes,
    //       memAddress: memAddress,
    //     }));
    //   } else {
    //     workerResults.push(waitForWorker(obj.workers[i], {
    //       action: PvXpuAction.ALLOC,
    //       size: chunkSize,
    //       memAddress: memAddress,
    //     }));
    //   }
    // }
    //
    // await Promise.all(workerResults);

    PvXpu.addMemory(memAddress, {
      objAddress: objAddress,
      // isShared: isShared === PV_XPU_MEM_SETTING_SHARED,
      // allocSize: sizeBytes,
      buffer: new Uint8Array(sizeBytes)
    });
    setStatus(statusAddress, 0);
  };

  const pvXpuDeviceMemFree = async (memAddress: number): Promise<void> => {
    if (PvXpu.hasMemory(memAddress)) {
      const { objAddress } = PvXpu.getMemory(memAddress)!;
      const obj = PvXpu.getXpu(objAddress)!;

      // const workerResults: Promise<any>[] = [];
      //
      // for (let i = 0; i < obj.numWorkers; i++) {
      //   workerResults.push(waitForWorker(obj.workers[i], {
      //     action: PvXpuAction.FREE,
      //     memAddress: memAddress,
      //   }));
      // }
      //
      // await Promise.all(workerResults);

      PvXpu.removeMemory(memAddress);
    }
  };

  const pvXpuDeviceMemCopyToXpu = async (memAddress: number, hostAddress: number, sizeBytes: number): Promise<void> => {
    const mem = PvXpu.getMemory(memAddress);
    if (!mem) {
      return;
    }

    const memoryBufferUint8 = new Uint8Array(memory.buffer);
    mem.buffer.set(memoryBufferUint8.slice(hostAddress, hostAddress + sizeBytes));

    // const { objAddress, isShared } = mem;
    // const obj = PvXpu.getXpu(objAddress)!;
    //
    // const memoryBufferUint8 = new Uint8Array(memory.buffer);
    // const chunkSize = sizeBytes / obj.numWorkers;
    //
    // const workerResults: Promise<any>[] = [];
    //
    // for (let i = 0; i < obj.numWorkers; i++) {
    //   if (isShared) {
    //     workerResults.push(waitForWorker(obj.workers[i], {
    //       action: PvXpuAction.COPY_TO_XPU,
    //       memAddress: memAddress,
    //       buffer: memoryBufferUint8.slice(hostAddress, hostAddress + sizeBytes)
    //     }));
    //   } else {
    //     workerResults.push(waitForWorker(obj.workers[i], {
    //       action: PvXpuAction.COPY_TO_XPU,
    //       memAddress: memAddress,
    //       buffer: memoryBufferUint8.slice(hostAddress + (i * chunkSize), hostAddress + ((i + 1) * chunkSize))
    //     }));
    //   }
    // }
    //
    // await Promise.all(workerResults);
  };

  const pvXpuDeviceMemCopyFromXpu = async (memAddress: number, hostAddress: number, sizeBytes: number): Promise<void> => {
    const mem = PvXpu.getMemory(memAddress);
    if (!mem) {
      return;
    }

    const memoryBufferUint8 = new Uint8Array(memory.buffer);
    memoryBufferUint8.set(mem.buffer.slice(0, sizeBytes), hostAddress);

    // const { objAddress, allocSize, isShared } = mem;
    // const obj = PvXpu.getXpu(objAddress)!;
    //
    // const memoryBufferUint8 = new Uint8Array(memory.buffer);
    // const workerResults: Promise<any>[] = [];
    // const chunkSize = allocSize / obj.numWorkers;
    //
    // if (isShared) {
    //   workerResults.push(waitForWorker(obj.workers[0], {
    //     action: PvXpuAction.COPY_FROM_XPU,
    //     memAddress: memAddress,
    //     size: allocSize,
    //   }));
    // } else {
    //   for (let i = 0; i < obj.numWorkers; i++) {
    //     workerResults.push(waitForWorker(obj.workers[i], {
    //       action: PvXpuAction.COPY_FROM_XPU,
    //       memAddress: memAddress,
    //       size: chunkSize,
    //     }));
    //   }
    // }
    //
    // const results = await Promise.all(workerResults);
    //
    // let copied = 0;
    // for (let i = 0; i < results.length; i++) {
    //   const result = results[i];
    //   if ((copied + result.length) > sizeBytes) {
    //     memoryBufferUint8.set(result.slice(0, sizeBytes - copied), hostAddress + copied);
    //     break;
    //   } else {
    //     memoryBufferUint8.set(result, hostAddress + copied);
    //     copied += result.length;
    //   }
    // }
  };

  const pvXpuMatrixVectorMultiply = async (
    objAddress: number,
    matrixAddress: number,
    vectorAddress: number,
    m: number,
    n: number,
    resultAddress: number,
    statusAddress: number
  ) => {
    const before = Date.now() / 1000;

    const obj = PvXpu.getXpu(objAddress);
    if (!obj) {
      setStatus(statusAddress, -1);
      return;
    }

    const matrixBuffer = new Uint8Array(PvXpu.getMemory(matrixAddress)!.buffer.buffer);
    const vectorBuffer = new Float32Array(PvXpu.getMemory(vectorAddress)!.buffer.buffer);
    const resultBuffer = new Float32Array(PvXpu.getMemory(resultAddress)!.buffer.buffer);

    // const numWorkers = obj.numWorkers;
    // const chunkSize = m / numWorkers;
    //
    // let workerResults: Promise<any>[] = [];

    const getAvailableWorker = (): Promise<[Worker, number]> => {
      return new Promise(resolve => {
        const interval = setInterval(() => {
          for (let i = 0; i < obj.numWorkers; i++) {
            if (!obj.workerActive[i]) {
              obj.workerActive[i] = true;
              clearInterval(interval);
              resolve([obj.workers[i], i]);
              return;
            }
          }
        });
      });
    };

    let workerProcTime = 0;

    const processWorker = (worker: Worker, index: number, message: any): Promise<void> => {
      worker.postMessage(message);

      return new Promise(resolve => {
        worker.onmessage = (e) => {
          if (e.data && e.data.result && e.data.offset !== undefined) {
            resultBuffer.set(e.data.result, e.data.offset);
            obj.workerActive[index] = false;
            workerProcTime += e.data.procSec;
          } else {
            console.log(e.data)
            obj.workerActive[index] = false;
          }
          resolve();
        };
      });
    };

    let processed = 0;
    const jobs = [];

    const n_real = n / 2;

    const before3 = Date.now() / 1000;

    while (processed < m) {
      const [worker, index] = await getAvailableWorker();
      const slicedMatrix = matrixBuffer.slice(processed * n_real, (processed + obj.numParts) * n_real)

      jobs.push(
      processWorker(worker, index, {
        action: PvXpuAction.MATRIX_VECTOR_MULTIPLY,
        matrix: slicedMatrix,
        vector: vectorBuffer,
        offset: processed
      }));

      processed += obj.numParts;
    }

    await Promise.all(jobs);

    // for (let i = 0; i < numWorkers; i++) {
    //   workerResults.push(waitForWorker(obj.workers[i], {
    //     action: PvXpuAction.MATRIX_VECTOR_MULTIPLY,
    //     matrixAddress: matrixAddress,
    //     vectorAddress: vectorAddress,
    //     m: chunkSize,
    //     n: n,
    //     resultAddress: resultAddress,
    //   }));
    // }
    //
    // const resultBuffer = new Float32Array(n);
    // const results = await Promise.all(workerResults);
    //
    // for (let i = 0; i < results.length; i++) {
    //   resultBuffer.set(results[i].buffer, i * chunkSize);
    //   if (results[i].procSec > workerProcTime) {
    //     workerProcTime = results[i].procSec;
    //   }
    // }

    const after3 = Date.now() / 1000;

    const before2 = Date.now() / 1000;

    // workerResults = [];
    // for (let i = 0; i < numWorkers; i++) {
    //   workerResults.push(waitForWorker(obj.workers[i], {
    //     action: PvXpuAction.SYNC_VECTOR,
    //     vectorAddress: resultAddress,
    //     buffer: resultBuffer,
    //   }));
    // }
    // await Promise.all(workerResults);

    const after2 = Date.now() / 1000;

    const after = Date.now() / 1000;
    total.push(after - before);
    workerTotal.push(workerProcTime);
    totalSync.push(after2 - before2);
    totalResult.push(after3 - before3);
  };

  return {
    pv_xpu_device_init_wasm: pvXpuDeviceInit,
    pv_xpu_device_cleanup_wasm: pvXpuDeviceCleanup,
    pv_xpu_device_mem_alloc_wasm: pvXpuDeviceMemAlloc,
    pv_xpu_device_mem_free_wasm: pvXpuDeviceMemFree,
    pv_xpu_device_mem_copy_to_xpu_wasm: pvXpuDeviceMemCopyToXpu,
    pv_xpu_device_mem_copy_from_xpu_wasm: pvXpuDeviceMemCopyFromXpu,

    pv_matrix_vector_multiply_device_wasm: pvXpuMatrixVectorMultiply,
  };
};

export {
  initXpu
};
