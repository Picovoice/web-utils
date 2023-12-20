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

// const matrixVectorMultiply = (data: any) => {
//   try {
//     const before = Date.now() / 1000;
//
//     const { exports, memAlloc, memory } = data.globals;
//     const { matrixAddress, vectorAddress, m, n, resultAddress } = data;
//     const { pv_matrix_vector_multiply } = exports;
//
//     const memoryBufferFloat32 = new Float32Array(memory.buffer);
//
//     const { workerMemAddress: workerMatrixAddress } = memAlloc.get(matrixAddress)!;
//     const { workerMemAddress: workerVectorAddress } = memAlloc.get(vectorAddress)!;
//     const { workerMemAddress: workerResultAddress } = memAlloc.get(resultAddress)!;
//
//     pv_matrix_vector_multiply(workerMatrixAddress, workerVectorAddress, m, n, workerResultAddress);
//
//     const after = Date.now() / 1000;
//
//     const result = memoryBufferFloat32.slice(
//       workerResultAddress / Float32Array.BYTES_PER_ELEMENT,
//       (workerResultAddress / Float32Array.BYTES_PER_ELEMENT) + m
//     );
//
//     self.postMessage({
//       command: 'ok',
//       result: {
//         buffer: result,
//         procSec: after - before
//       }
//     });
//   } catch (e: any) {
//     self.postMessage({
//       command: 'error',
//       message: e.message
//     });
//   }
// };

const matrixVectorMultiply = (data: any) => {
  try {
    const { memAlloc, memory, exports } = data.globals;
    const { matrix, vector, offset } = data;
    const { aligned_alloc, pv_matrix_vector_multiply, free } = exports!;

    const m = matrix.length / vector.length * 2;

    const matrixAddress = aligned_alloc(Uint8Array.BYTES_PER_ELEMENT, matrix.length * Uint8Array.BYTES_PER_ELEMENT);
    const vectorAddress = aligned_alloc(Float32Array.BYTES_PER_ELEMENT, vector.length * Float32Array.BYTES_PER_ELEMENT);
    const resultAddress = aligned_alloc(Float32Array.BYTES_PER_ELEMENT, m * Float32Array.BYTES_PER_ELEMENT);

    const memoryBufferUint8 = new Uint8Array(memory.buffer);
    const memoryBufferFloat32 = new Float32Array(memory.buffer);

    memoryBufferUint8.set(matrix, matrixAddress);
    memoryBufferFloat32.set(vector, vectorAddress / Float32Array.BYTES_PER_ELEMENT);

    const before = Date.now() / 1000;

    pv_matrix_vector_multiply(matrixAddress, vectorAddress, m, vector.length, resultAddress);

    const after = Date.now() / 1000;

    const result = memoryBufferFloat32.slice(resultAddress / Float32Array.BYTES_PER_ELEMENT, (resultAddress / Float32Array.BYTES_PER_ELEMENT) + m);

    free(matrixAddress);
    free(vectorAddress);
    free(resultAddress);

    self.postMessage({
      command: 'ok',
      result: result,
      offset: offset,
      procSec: after - before
    });
  } catch (e: any) {
    self.postMessage({
      command: 'error',
      message: e.message
    });
  }
}

const syncVector = (data: any) => {
  try {
    const { memAlloc, memory } = data.globals;
    const { vectorAddress, buffer } = data;

    const memoryBufferFloat32 = new Float32Array(memory.buffer);
    const { workerMemAddress } = memAlloc.get(vectorAddress)!;
    memoryBufferFloat32.set(buffer, workerMemAddress / Float32Array.BYTES_PER_ELEMENT);

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

export const pvMvmActionMap: Partial<Record<PvXpuAction, CallableFunction>> = {
  [PvXpuAction.MATRIX_VECTOR_MULTIPLY]: matrixVectorMultiply,
  [PvXpuAction.SYNC_VECTOR]: syncVector,
};

