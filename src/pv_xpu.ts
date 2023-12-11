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

// const vs = `#version 300 es
// in uint a_matrix;
//
// uniform sampler2D u_vector;
// uniform int vectorLength;
//
// out float result;
//
// vec4 getAs1D(sampler2D tex, ivec2 dimensions, int index) {
//   int y = index / dimensions.x;
//   int x = index % dimensions.x;
//   return texelFetch(tex, ivec2(x, y), 0);
// }
//
// void main() {
//   ivec2 dimensions = textureSize(u_vector, 0);
//
//   uint low_int = uint(0x0F) & a_matrix;
//   uint high_int = uint(0x0F) & (a_matrix >> 4);
//
//   float total = 0.0;
//   for (int i = 0; i < vectorLength / 2; i++) {
//     float vectorValue0 = getAs1D(u_vector, dimensions, i * 2).x;
//     float vectorValue1 = getAs1D(u_vector, dimensions, i * 2 + 1).x;
//
//     total += (float(low_int) * vectorValue0) + (float(high_int) * vectorValue1);
//   }
//   result = total;
// }
// `;

const vs = `#version 300 es
void main() {
}
`;

const fs = `#version 300 es
precision mediump float;

uniform sampler2D u_matrix;
uniform sampler2D u_vector;
uniform int m;
uniform int n;

out vec4 result;

vec4 getAs1D(sampler2D tex, ivec2 dimensions, int index) {
  int y = index / dimensions.x;
  int x = index % dimensions.x;
  return texelFetch(tex, ivec2(x, y), 0);
}

void main() {
  ivec2 matrix_dimensions = textureSize(u_matrix, 0);
  ivec2 vector_dimensions = textureSize(u_vector, 0);

  int n_real = n / 2;

  int i = int(gl_FragCoord.y);
  float sum = 1.0;

  for (int j = 0; j < n_real; j++) {
    int matrix_index = (i * n_real) + j;
    float matrixValue = getAs1D(u_vector, matrix_dimensions, matrix_index).x;
    
    float vectorValue0 = getAs1D(u_vector, vector_dimensions, i * 2).x;
    float vectorValue1 = getAs1D(u_vector, vector_dimensions, i * 2 + 1).x;
    sum += matrixValue * vectorValue0;
  }

  fragColor = vec4(sum, 0.0, 0.0, 1.0);
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
    const resultVector = new Float32Array(n);

    function createShader(type: number, src: string) {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, src);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error(gl.getShaderInfoLog(shader)!);
      }
      return shader;
    }

    function createProgram(shaderSources: Record<number, string>, transformFeedbackVaryings: string[]) {
      const program = gl.createProgram()!;
      [gl.VERTEX_SHADER, gl.FRAGMENT_SHADER].forEach((type, ndx) => {
        const shader = createShader(type, shaderSources[ndx]);
        gl.attachShader(program, shader);
      });
      if (transformFeedbackVaryings) {
        gl.transformFeedbackVaryings(
          program,
          transformFeedbackVaryings,
          gl.SEPARATE_ATTRIBS,
        );
      }
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error(gl.getProgramInfoLog(program)!);
      }
      return program;
    }

    function makeBuffer(sizeOrData: any, usage: number) {
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, sizeOrData, usage);
      return buf;
    }

    const matrixBuffer = makeBuffer(a, gl.STATIC_DRAW)!;
    // const vectorBuffer = makeBuffer(b, gl.STATIC_DRAW)!;
    const resultBuffer = makeBuffer(n * 4, gl.STATIC_DRAW)!;

    function createDataITexture(data: Uint8Array, internalFormat: number, format: number, type: number) {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0, // mip level
        internalFormat,
        data.length,
        1,
        0, // border
        format,
        type,
        data,
      );
      gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      return { tex, dimensions: [data.length, 1] };
    }

    function createDataTexture(data: Float32Array, internalFormat: number, format: number, type: number) {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0, // mip level
        internalFormat,
        data.length,
        1,
        0, // border
        format,
        type,
        data,
      );
      gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      // gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return { tex, dimensions: [data.length, 1] };
    }

    const { tex: matrixText, dimensions: matrixTexDimensions } =
      createDataITexture(a, gl.R8UI, gl.RED, gl.UNSIGNED_BYTE);
    const { tex: linesTex, dimensions: linesTexDimensions } =
      createDataTexture(b, gl.R32F, gl.RED, gl.FLOAT);
    const { tex: resultTexture } = createDataTexture(resultVector, gl.R32F, gl.RED, gl.FLOAT);

    const program = createProgram([vs, fs], []);

    const locs = {
      // matrix: gl.getAttribLocation(program, 'a_matrix'),
      matrix: gl.getUniformLocation(program, 'u_matrix'),
      vector: gl.getUniformLocation(program, 'u_vector'),
      m: gl.getUniformLocation(program, 'm'),
      n: gl.getUniformLocation(program, 'n'),
    };

    function makeVertexArray(buffer: WebGLBuffer, loc: number) {
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribIPointer(
        loc,
        1, // size (num components)
        gl.UNSIGNED_BYTE, // type of data in buffer
        0, // stride (0 = auto)
        0, // offset
      );
    }

    const va = gl.createVertexArray();
    gl.bindVertexArray(va);
    // makeVertexArray(matrixBuffer, locs.matrix);

    function makeTransformFeedback(buffer: WebGLBuffer) {
      const tf = gl.createTransformFeedback();
      gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, tf);
      gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, buffer);
      return tf;
    }

    const resultTF = makeTransformFeedback(resultBuffer);

    gl.bindVertexArray(va);

    gl.viewport(0, 0, n, 1);
    gl.useProgram(program);

    gl.uniform1i(locs.matrix, 0);
    gl.uniform1i(locs.vector, 0);
    gl.uniform1i(locs.m, m);
    gl.uniform1i(locs.n, n);
    // gl.bindTexture(gl.TEXTURE_2D, resultTexture);

    // const frameBuffer = gl.createFramebuffer();
    // gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuffer);
    // gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, resultTexture, 0);

    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, resultTF);
    gl.beginTransformFeedback(gl.POINTS);
    // gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuffer);
    gl.drawArrays(gl.POINTS, 0, 1);
    // gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.endTransformFeedback();
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);

    // get the results.
    {
      const tmp_results = new Float32Array(n);
      // gl.readPixels(0, 0, n, 1, gl.RED, gl.FLOAT, tmp_results);
      gl.bindBuffer(gl.ARRAY_BUFFER, resultBuffer);
      gl.getBufferSubData(gl.ARRAY_BUFFER, 0, tmp_results);
      console.log(tmp_results);
    }
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
