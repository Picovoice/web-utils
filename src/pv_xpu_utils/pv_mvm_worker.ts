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

const matrixVectorMultiply = (data: any) => {
  try {
    const { exports, memAlloc } = data.globals;
    const { matrixAddress, vectorAddress, m, n, resultAddress } = data;
    const { pv_matrix_vector_multiply } = exports;

    const { workerMemAddress: workerMatrixAddress } = memAlloc.get(matrixAddress)!;
    const { workerMemAddress: workerVectorAddress } = memAlloc.get(vectorAddress)!;
    const { workerMemAddress: workerResultAddress } = memAlloc.get(resultAddress)!;

    pv_matrix_vector_multiply(workerMatrixAddress, workerVectorAddress, m, n, workerResultAddress);

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
  [PvXpuAction.MATRIX_VECTOR_MULTIPLY]: matrixVectorMultiply
};

