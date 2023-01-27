/*
  Copyright 2022-2023 Picovoice Inc.

  You may not use this file except in compliance with the license. A copy of the license is located in the "LICENSE"
  file accompanying this source.

  Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on
  an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the
  specific language governing permissions and limitations under the License.
*/

/* eslint camelcase: 0 */

import { PvModel } from './types';
import { aligned_alloc_type, pv_free_type, buildWasm } from './wasm';

import {
  arrayBufferToBase64AtIndex,
  arrayBufferToStringAtIndex,
  base64ToUint8Array,
  fetchWithTimeout,
  fromBase64,
  fromPublicDirectory,
  isAccessKeyValid,
  loadModel,
  stringHeaderToObject,
  open,
} from './utils';

import { PvFile } from './pv_file';
import { PvError } from './pv_error';

import { PvFileMem } from './pv_file_mem';

import {
  PvFileIDB,
  getDB,
  DB_NAME,
  DB_VERSION,
  PV_FILE_STORE,
} from './pv_file_idb';

const dbConfig = {
  DB_NAME,
  DB_VERSION,
  PV_FILE_STORE,
};

export {
  // wasm exports
  aligned_alloc_type,
  pv_free_type,
  buildWasm,
  // utils exports
  arrayBufferToBase64AtIndex,
  arrayBufferToStringAtIndex,
  base64ToUint8Array,
  fetchWithTimeout,
  isAccessKeyValid,
  stringHeaderToObject,
  fromBase64,
  fromPublicDirectory,
  loadModel,
  // PvFile
  open,
  dbConfig,
  getDB,
  PvFile,
  PvFileIDB,
  PvFileMem,
  PvError,
  // types
  PvModel,
};
