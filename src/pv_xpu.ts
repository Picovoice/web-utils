/*
  Copyright 2023 Picovoice Inc.

  You may not use this file except in compliance with the license. A copy of the license is located in the "LICENSE"
  file accompanying this source.

  Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on
  an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the
  specific language governing permissions and limitations under the License.
*/

/* eslint camelcase: 0 */

const devices = new Map<number, {
  gl: WebGL2RenderingContext,
  deviceMem: Set<number>
}>();

const buffers = new Map<number, {
  deviceAddress: number,
  bufferAddress: number
}>;

const vs = `#version 300 es
in uint a;
in vec2 b;

out float result;

void main() {
  uint low_int = uint(0x0F) & a;
  uint high_int = uint(0x0F) & (a >> 4);
  
  result = (float(low_int) * b[0]) + (float(high_int) * b[1]);
}
`;

const fs = `#version 300 es
void main() {
}
`;

const initXpu = (
  memory: WebAssembly.Memory,
  wasm: string | Promise<Response>
) => {

  const setStatus = (statusAddress: number, value: number) => {
    const memoryBufferInt32 = new Int32Array(memory.buffer);
    memoryBufferInt32[
      statusAddress / Int32Array.BYTES_PER_ELEMENT
    ] = value;
  };

  const pvXpuDeviceInit = (objAddress: number, statusAddress: number): void => {
    const gl = document.createElement("canvas").getContext("webgl2");
    if (!gl) {
      setStatus(statusAddress, -1);
      return;
    }
    devices.set(objAddress, {
      gl,
      deviceMem: new Set()
    });
    setStatus(statusAddress, 0);
  };

  const pvXpuDeviceMemAlloc = (objAddress: number, memAddress: number, bufferAddress: number, statusAddress: number): void => {
    const obj = devices.get(objAddress);
    if (!obj) {
      setStatus(statusAddress, -1);
      return;
    }
    obj.deviceMem.add(memAddress);
    buffers.set(memAddress, {
      deviceAddress: objAddress,
      bufferAddress: bufferAddress,
    });
    setStatus(statusAddress, 0);
  };

  const pvXpuMatrixVectorMultiply = (
    objAddress: number,
    matrixAddress: number,
    vectorAddress: number,
    m: number,
    n: number,
    resultAddress: number,
    statusAddress: number
  ) => {
    const obj = devices.get(objAddress);
    if (!obj) {
      setStatus(statusAddress, -1);
      return;
    }
    const { gl } = obj;

    function createShader(type: number, src: string) {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, src);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error(gl.getShaderInfoLog(shader)!);
      }
      return shader;
    }

    const vShader = createShader(gl.VERTEX_SHADER, vs);
    const fShader = createShader(gl.FRAGMENT_SHADER, fs);

    const program = gl.createProgram()!;
    gl.attachShader(program, vShader);
    gl.attachShader(program, fShader);
    gl.transformFeedbackVaryings(
      program,
      ['result'],
      gl.SEPARATE_ATTRIBS,
    );
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramParameter(program, gl.LINK_STATUS)!);
    }

    // Create a vertex array object (attribute state)
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);

    const aLoc = gl.getAttribLocation(program, 'a');
    const bLoc = gl.getAttribLocation(program, 'b');

    function makeBuffer(sizeOrData: any, usage: number = gl.STATIC_DRAW) {
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, sizeOrData, usage);
      return buf;
    }

    function makeTexture(width: number, height: number, data: ArrayBufferView) {
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, width, height, 0, gl.RED, gl.FLOAT, data);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.bindTexture(gl.TEXTURE_2D, null);
      return texture;
    }

    function makeBufferAndSetIAttribute(data: Uint8Array, loc: number) {
      const buf = makeBuffer(data);
      // setup our attributes to tell WebGL how to pull
      // the data from the buffer above to the attribute
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribIPointer(
        loc,
        1, // size (num components)
        gl.UNSIGNED_BYTE, // type of data in buffer
        0, // stride (0 = auto)
        0, // offset
      );
    }

    function makeBufferAndSetAttribute(data: Float32Array, loc: number, size: number) {
      const newData = new Float32Array(size);
      for (let i = 0; i < size; i += data.length) {
        newData.set(data, i);
      }
      const buf = makeBuffer(newData);
      // setup our attributes to tell WebGL how to pull
      // the data from the buffer above to the attribute
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(
        loc,
        2, // size (num components)
        gl.FLOAT, // type of data in buffer
        false,
        0, // stride (0 = auto)
        0, // offset
      );
    }
    const memoryBufferUint8 = new Uint8Array(memory.buffer);
    const memoryBufferFloat32 = new Float32Array(memory.buffer);

    const n_real = Math.round(n / 2);
    const a = memoryBufferUint8.slice(
      matrixAddress,
      matrixAddress + (m * n_real)
    );
    const b = memoryBufferFloat32.slice(
      vectorAddress / Float32Array.BYTES_PER_ELEMENT,
      (vectorAddress / Float32Array.BYTES_PER_ELEMENT) + n
    );

    // put data in buffers
    const aBuffer = makeBufferAndSetIAttribute(a, aLoc);
    const size = a.length * 2;
    const bBuffer = makeBufferAndSetAttribute(b, bLoc, size);

    // Create and fill out a transform feedback
    const tf = gl.createTransformFeedback();
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, tf);

    // make buffers for output
    const resultBuffer = makeBuffer(a.length * 4);

    // bind the buffers to the transform feedback
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, resultBuffer);

    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);

    // buffer's we are writing to can not be bound else where
    gl.bindBuffer(gl.ARRAY_BUFFER, null); // productBuffer was still bound to ARRAY_BUFFER so unbind it

    // above this line is setup
    // ---------------------------------
    // below this line is "render" time

    gl.useProgram(program);

    // no need to call the fragment shader
    gl.enable(gl.RASTERIZER_DISCARD);

    // bind our input attribute state for the a and b buffers
    gl.bindVertexArray(vao);

    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, tf);
    gl.beginTransformFeedback(gl.POINTS);
    gl.drawArrays(gl.POINTS, 0, a.length);
    gl.endTransformFeedback();
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);

    // turn on using fragment shaders again
    gl.disable(gl.RASTERIZER_DISCARD);

    const tmpResults = new Float32Array(a.length);
    gl.bindBuffer(gl.ARRAY_BUFFER, resultBuffer);
    gl.getBufferSubData(
      gl.ARRAY_BUFFER,
      0, // byte offset into GPU buffer,
      tmpResults,
    );

    const results = new Float32Array(n);
    for (let i = 0; i < results.length; i++) {
      for (let j = i * n_real; j < (i * n_real) + n_real; j++) {
        results[i] += tmpResults[j];
      }
    }

    memoryBufferFloat32.set(results, resultAddress / Float32Array.BYTES_PER_ELEMENT);
  };

  return {
    pv_xpu_webgl_device_init_wasm: pvXpuDeviceInit,
    pv_xpu_webgl_device_mem_alloc_wasm: pvXpuDeviceMemAlloc,
    pv_matrix_vector_multiply_webgl_wasm: pvXpuMatrixVectorMultiply
  };
};

export {
  initXpu
};
