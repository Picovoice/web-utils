/*
  Copyright 2023 Picovoice Inc.

  You may not use this file except in compliance with the license. A copy of the license is located in the "LICENSE"
  file accompanying this source.

  Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on
  an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the
  specific language governing permissions and limitations under the License.
*/


import { buildWasm, PvError } from '../';

const memory = new WebAssembly.Memory({ initial: 256 });
const pvError = new PvError();

enum WebUtilsStatus {
  SUCCESS,
  FAILURE
}

describe("WASM Exports", () => {
  let wasmExports: Record<string, Function> = {};

  it("should be able to load wasm", () => {
    cy.readFile("lib/build/pv_web_utils.wasm", "base64").then(async wasmBase64 => {
      wasmExports = await buildWasm(memory, wasmBase64, pvError);
    });
  });

  it("should be able to console log", async () => {
    const result = await wasmExports.pv_web_utils_test_console_log();
    expect(result).to.eq(WebUtilsStatus.SUCCESS, pvError.getErrorString());
  });

  it("should be able to assert", async () => {
    const result = await wasmExports.pv_web_utils_test_assert();
    expect(result).to.eq(WebUtilsStatus.SUCCESS, pvError.getErrorString());
  });

  it("should be able to get time", async () => {
    const result = await wasmExports.pv_web_utils_test_time();
    expect(result).to.eq(WebUtilsStatus.SUCCESS, pvError.getErrorString());
  });

  it("should be able to https request", () => {
    cy.intercept("GET", `https://localhost/test_route`, {
      body: "test data"
    }).then(async () => {
      const result = await wasmExports.pv_web_utils_test_https_request();
      expect(result).to.eq(WebUtilsStatus.SUCCESS, pvError.getErrorString());
    });
  });

  it("should be able to get browser info", async () => {
    const result = await wasmExports.pv_web_utils_test_browser_info();
    expect(result).to.eq(WebUtilsStatus.SUCCESS, pvError.getErrorString());
  });

  it("should be able to get origin info", async () => {
    const result = await wasmExports.pv_web_utils_test_origin_info();
    expect(result).to.eq(WebUtilsStatus.SUCCESS, pvError.getErrorString());
  });

  it("should be able to open file", async () => {
    const result = await wasmExports.pv_web_utils_test_file_open();
    expect(result).to.eq(WebUtilsStatus.SUCCESS, pvError.getErrorString());
  });

  it("should be able to write file", async () => {
    const result = await wasmExports.pv_web_utils_test_file_write();
    expect(result).to.eq(WebUtilsStatus.SUCCESS, pvError.getErrorString());
  });

  it("should be able to tell file", async () => {
    const result = await wasmExports.pv_web_utils_test_file_tell();
    expect(result).to.eq(WebUtilsStatus.SUCCESS, pvError.getErrorString());
  });

  it("should be able to seek file", async () => {
    const result = await wasmExports.pv_web_utils_test_file_seek();
    expect(result).to.eq(WebUtilsStatus.SUCCESS, pvError.getErrorString());
  });

  it("should be able to read file", async () => {
    const result = await wasmExports.pv_web_utils_test_file_read();
    expect(result).to.eq(WebUtilsStatus.SUCCESS, pvError.getErrorString());
  });

  it("should be able to close file", async () => {
    const result = await wasmExports.pv_test_utils_test_file_close();
    expect(result).to.eq(WebUtilsStatus.SUCCESS, pvError.getErrorString());
  });

  it("should be able to remove file", async () => {
    const result = await wasmExports.pv_test_utils_test_remove();
    expect(result).to.eq(WebUtilsStatus.SUCCESS, pvError.getErrorString());
  });
});
