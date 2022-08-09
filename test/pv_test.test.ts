/*
  Copyright 2022 Picovoice Inc.

  You may not use this file except in compliance with the license. A copy of the license is located in the "LICENSE"
  file accompanying this source.

  Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on
  an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the
  specific language governing permissions and limitations under the License.
*/

/// <reference types="cypress" />

import { open } from "../src";

const buildData = (size: number) => {
  const data = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    data[i] = Math.floor(Math.random() * 256);
  }
  return data;
};

const path = "testPath";
const basicData = buildData(1024);

describe("PvFile", () => {
  it("Write file", async () => {
    try {
      const file = await open(path, "w");
      await file.write(basicData);
    } catch (e) {
      expect(e).eq(undefined, e?.message);
    }
  });

  it("Exists file", async () => {
    try {
      const file = await open(path, "r");
      const exists = file.exists();
      expect(exists).eq(true);
    } catch (e) {
      expect(e).eq(undefined, e?.message);
    }
  });

  it("Write file increment version", async () => {
    try {
      const file = await open(path, "w");
      await file.write(basicData, 2);
      expect(file.meta.version).eq(2);
    } catch (e) {
      expect(e).eq(undefined, e?.message);
    }
  });

  it("Seek file", async () => {
    try {
      const file = await open(path, "r");
      file.seek(512, 0);
      const data = await file.read(1, 512);
      expect(data).length(512);
    } catch (e) {
      expect(e).eq(undefined, e?.message);
    }
  });

  it("Tell file", async () => {
    try {
      const file = await open(path, "r");
      file.seek(0, 2);
      const offset = file.tell();
      expect(offset).eq(1024);
    } catch (e) {
      expect(e).eq(undefined, e?.message);
    }
  });

  it("Read file", async () => {
    try {
      const file = await open(path, "r");
      const data = await file.read(1, 1024);
      expect(data).length(1024);
      expect(data).to.deep.eq(basicData);
    } catch (e) {
      expect(e).eq(undefined, e?.message);
    }
  });

  it("Read file different element size", async () => {
    try {
      const file = await open(path, "r");
      const data = await file.read(3, 999);
      expect(data).length(1023);
      expect(data).to.deep.eq(basicData.slice(0, 1024 - (1024 % 3)));
    } catch (e) {
      expect(e).eq(undefined, e?.message);
    }
  });

  it("Remove file", async () => {
    try {
      const file = await open(path, "w");
      await file.remove();
      const exists = file.exists();
      expect(exists).eq(false);
    } catch (e) {
      expect(e).eq(undefined, e?.message);
    }
  });

  it("Big file operation", async () => {
    try {
      const fileSize = 12345678;
      const file = await open(path, "w");
      await file.write(buildData(fileSize));
      await file.seek(0, 0);

      const fullData = await file.read(1, fileSize);
      expect(fullData).length(fileSize);
      await file.seek(0, 0);

      const reads = [123, 12345, 1234567];
      const seeks = [1234, 123456, 1234567];

      let readAcc = 0;
      let seekAcc = 0;
      for (let i = 0; i < reads.length; i++) {
        const data = await file.read(1, reads[i]);
        expect(data).length(reads[i]);
        expect(data).to.deep.eq(fullData.slice(readAcc + seekAcc, readAcc + seekAcc + reads[i]));

        await file.seek(seeks[i], 1);

        readAcc += reads[i];
        seekAcc += seeks[i];

        const offset = file.tell();
        expect(offset).eq(readAcc + seekAcc);
      }

      const remaining = await file.read(1, fileSize);
      expect(remaining).length(fileSize - readAcc - seekAcc);
      expect(remaining).to.deep.eq(fullData.slice(readAcc + seekAcc));
    } catch (e) {
      expect(e).eq(undefined, e?.message);
    }
  });

  it("Write file twice", async () => {
    try {
      const file = await open(path, "w");
      await file.write(basicData);
      await file.write(basicData);
      expect(file.tell()).eq(basicData.length * 2);
    } catch (e) {
      expect(e).eq(undefined, e?.message);
    }
  });

  it("Write file append", async () => {
    try {
      const file = await open(path, "a");
      await file.write(basicData);
      expect(file.tell()).eq(basicData.length * 3);
    } catch (e) {
      expect(e).eq(undefined, e?.message);
    }
  });

  it("Read then Write", async () => {
    try {
      const file = await open(path, "w");
      const data = await file.read(1, basicData.length / 2);
      expect(data.length).eq(basicData.length / 2);
      await file.write(basicData);
      expect(file.tell()).eq(basicData.length + basicData.length / 2);
    } catch (e) {
      expect(e).eq(undefined, e?.message);
    }
  });
});
