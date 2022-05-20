/*
  Copyright 2022 Picovoice Inc.

  You may not use this file except in compliance with the license. A copy of the license is located in the "LICENSE"
  file accompanying this source.

  Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on
  an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the
  specific language governing permissions and limitations under the License.
*/

const { createFilter } = require("@rollup/pluginutils");
const { readFileSync } = require("fs");

function base64(opts= {}) {
  const filter = createFilter(opts.include, opts.exclude);
  return {
    name: "base64",
    transform(data, id) {
      if (filter(id)) {
        const fileData = readFileSync(id);
        return `export default "${fileData.toString('base64')}";`;
      }
    }
  };
}

module.exports = base64;
