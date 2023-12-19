/*
  Copyright 2023 Picovoice Inc.

  You may not use this file except in compliance with the license. A copy of the license is located in the "LICENSE"
  file accompanying this source.

  Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on
  an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the
  specific language governing permissions and limitations under the License.
*/

export enum PvXpuAction {
  INIT,
  ALLOC,
  FREE,
  COPY_TO_XPU,
  COPY_FROM_XPU,

  // other xpu actions
  MATRIX_VECTOR_MULTIPLY,
}
