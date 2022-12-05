/*
  Copyright 2022 Picovoice Inc.

  You may not use this file except in compliance with the license. A copy of the license is located in the "LICENSE"
  file accompanying this source.

  Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on
  an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the
  specific language governing permissions and limitations under the License.
*/

export type PvModel = {
  /** Base64 representation of the file */
  base64?: string;
  /** The file path relative to the public directory */
  publicPath?: string;
  /** Custom path to save the model in storage. */
  customWritePath?: string;
  /** Flag to overwrite the model in storage even if it exists. */
  forceWrite?: boolean;
  /** Version of file in storage. Set to a higher number to update the model file. */
  version?: number;
  /** Number of fetch retry attempts (only applies when `publicPath` is defined) **/
  numFetchRetries?: number
};
