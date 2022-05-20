/*
  Copyright 2022 Picovoice Inc.

  You may not use this file except in compliance with the license. A copy of the license is located in the "LICENSE"
  file accompanying this source.

  Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on
  an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the
  specific language governing permissions and limitations under the License.
*/

/* eslint camelcase: 0 */

import { aligned_alloc_type, pv_free_type, buildWasm } from "./wasm";

import {
  DB_NAME,
  DB_VERSION,
  STORE_NAME,
  PV_FILE_STORE,
  arrayBufferToBase64AtIndex,
  arrayBufferToStringAtIndex,
  base64ToUint8Array,
  fetchWithTimeout,
  getDB,
  getPvStorage,
  isAccessKeyValid,
  stringHeaderToObject,
} from './utils';

import {
  PvFile
} from "./pv_file";

const dbConfig = {
  DB_NAME,
  DB_VERSION,
  STORE_NAME,
  PV_FILE_STORE
};

export {
  // wasm exports
  aligned_alloc_type,
  pv_free_type,
  buildWasm,
  // utils exports
  dbConfig,
  arrayBufferToBase64AtIndex,
  arrayBufferToStringAtIndex,
  base64ToUint8Array,
  fetchWithTimeout,
  getDB,
  getPvStorage,
  isAccessKeyValid,
  stringHeaderToObject,
  // PvFile
  PvFile,
};
