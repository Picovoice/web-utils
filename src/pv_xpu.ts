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

// const buffers = new Map<number, {
//   deviceAddress: number,
//   bufferAddress: number
// }>;

const buffers = new Map<number, {
  deviceAddress: number,
  buffer: Uint8Array
}>;

const vs = `#version 300 es
in vec2 position;

void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const fs = `#version 300 es
precision mediump float;
precision mediump usampler2D;

uniform usampler2D u_matrix;
uniform sampler2D u_vector;
uniform int u_m;
uniform int u_n;

out vec4 fragColor;

int getMatrixValue(usampler2D tex, ivec2 dimensions, int index) {
  int y = index / dimensions.x;
  int x = index % dimensions.x;
  return int(texelFetch(tex, ivec2(x, y), 0).x);
}

void main() {
  ivec2 dimensions = textureSize(u_matrix, 0);

  int i = int(gl_FragCoord.x);
  float sum = 0.0;

  int n_real = u_n / 2;
  for (int j = 0; j < n_real; j++) {
    int matrix_index = (i * n_real) + j;
    int matrix_value = getMatrixValue(u_matrix, dimensions, matrix_index);

    int low_int = 0x0F & matrix_value;
    int high_int = 0x0F & (matrix_value >> 4);

    sum += float(low_int) * texelFetch(u_vector, ivec2(j * 2, 0), 0).x;
    sum += float(high_int) * texelFetch(u_vector, ivec2(j * 2 + 1, 0), 0).x;
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
    const ext = gl.getExtension("EXT_color_buffer_float")!;
    devices.set(objAddress, {
      gl,
      deviceMem: new Set()
    });
    setStatus(statusAddress, 0);
  };

  // const pvXpuDeviceMemAlloc = (objAddress: number, memAddress: number, bufferAddress: number, statusAddress: number): void => {
  //   const obj = devices.get(objAddress);
  //   if (!obj) {
  //     setStatus(statusAddress, -1);
  //     return;
  //   }
  //   obj.deviceMem.add(memAddress);
  //   buffers.set(memAddress, {
  //     deviceAddress: objAddress,
  //     bufferAddress: bufferAddress,
  //   });
  //   setStatus(statusAddress, 0);
  // };

  const pvXpuDeviceMemAlloc = (objAddress: number, memAddress: number, sizeBytes: number, statusAddress: number): void => {
    const obj = devices.get(objAddress);
    if (!obj) {
      setStatus(statusAddress, -1);
      return;
    }
    obj.deviceMem.add(memAddress);
    buffers.set(memAddress, {
      deviceAddress: objAddress,
      buffer: new Uint8Array(sizeBytes),
    });
    setStatus(statusAddress, 0);
  };

  const pvXpuDeviceMemFree = (memAddress: number): void => {
    if (buffers.has(memAddress)) {
      const { deviceAddress } = buffers.get(memAddress)!;
      devices.get(deviceAddress)?.deviceMem.delete(memAddress);
      buffers.delete(memAddress);
    }
  };

  const pvXpuDeviceMemCopyToXpu = (memAddress: number, hostAddress: number, sizeBytes: number): void => {
    const { buffer } = buffers.get(memAddress)!;

    const memoryBufferUint8 = new Uint8Array(memory.buffer);
    buffer.set(memoryBufferUint8.slice(hostAddress, hostAddress + sizeBytes));
  };

  const pvXpuDeviceMemCopyFromXpu = (memAddress: number, hostAddress: number, sizeBytes: number): void => {
    if (hostAddress < 0) {
      console.log("invalid host address", memAddress, hostAddress, sizeBytes);
      return;
    }

    const { buffer } = buffers.get(memAddress)!;

    const memoryBufferUint8 = new Uint8Array(memory.buffer);
    memoryBufferUint8.set(buffer.slice(0, sizeBytes), hostAddress);
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

    // Functions for shader, program, texture creation
    function createShader(type: number, source: string) {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);

      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error("Shader compilation error:", gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
      }

      return shader;
    }

    function createProgram(vertexShader: WebGLShader, fragmentShader: WebGLShader) {
      const program = gl.createProgram()!;
      gl.attachShader(program, vertexShader);
      gl.attachShader(program, fragmentShader);
      gl.linkProgram(program);

      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.error("Program link error:", gl.getProgramInfoLog(program));
        gl.deleteProgram(program);
        return null;
      }

      return program;
    }

    function createITexture(data: ArrayBufferView, width: number, height: number) {
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8UI, width, height, 0, gl.RED_INTEGER, gl.UNSIGNED_BYTE, data);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.bindTexture(gl.TEXTURE_2D, null);
      return texture;
    }

    function createTexture(data: ArrayBufferView, width: number, height: number) {
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, width, height, 0, gl.RED, gl.FLOAT, data);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.bindTexture(gl.TEXTURE_2D, null);
      return texture;
    }

    const n_real = Math.round(n / 2);
    // const a = memoryBufferUint8.slice(
    //   matrixAddress,
    //   matrixAddress + (m * n_real)
    // );
    const a = buffers.get(matrixAddress)!.buffer;
    // const b = memoryBufferFloat32.slice(
    //   vectorAddress / Float32Array.BYTES_PER_ELEMENT,
    //   (vectorAddress / Float32Array.BYTES_PER_ELEMENT) + n
    // );
    const b = new Float32Array(buffers.get(vectorAddress)!.buffer.buffer);
    // const resultVector = new Float32Array(n);
    const resultVector = new Float32Array(buffers.get(resultAddress)!.buffer.buffer);

    // Create shaders
    const vertexShader = createShader(gl.VERTEX_SHADER, vs)!;
    const fragmentShader = createShader(gl.FRAGMENT_SHADER, fs)!;

    const textureMatrix = createITexture(a, m, n_real);
    const textureVector = createTexture(b, n, 1);
    const textureResult = createTexture(resultVector, n, 1);

    // Create program
    const program = createProgram(vertexShader, fragmentShader)!;

    // Set up vertex buffer
    const vertexData = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
    const vertexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertexData, gl.STATIC_DRAW);

    // Set up vertex attribute
    const positionAttribLocation = gl.getAttribLocation(program, "position");
    gl.vertexAttribPointer(positionAttribLocation, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(positionAttribLocation);

    // Create framebuffer for rendering to result texture
    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, textureResult, 0);

    // Check framebuffer completeness
    const framebufferStatus = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (framebufferStatus !== gl.FRAMEBUFFER_COMPLETE) {
      console.error("Framebuffer is incomplete: " + framebufferStatus.toString(16));
    }

    // Render to result texture
    gl.useProgram(program);

    // Set shader uniforms
    const uMatrix = gl.getUniformLocation(program, "u_matrix");
    const uVector = gl.getUniformLocation(program, "u_vector");
    const uM = gl.getUniformLocation(program, "u_m");
    const uN = gl.getUniformLocation(program, "u_n");

    gl.uniform1i(uMatrix, 0);
    gl.uniform1i(uVector, 1);
    gl.uniform1i(uM, m);
    gl.uniform1i(uN, n);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, textureMatrix);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, textureVector);

    // Set the viewport
    gl.viewport(0, 0, n, 1);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // Read back the result from the texture (optional)
    const results = new Float32Array(n); // 4 components per pixel
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    gl.readPixels(0, 0, n, 1, gl.RED, gl.FLOAT, results);

    // Unbind framebuffer
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    gl.deleteTexture(textureMatrix);
    gl.deleteTexture(textureVector);
    gl.deleteTexture(textureVector);

    gl.deleteFramebuffer(framebuffer);
    gl.deleteBuffer(vertexBuffer);

    gl.deleteProgram(program);

    // memoryBufferFloat32.set(results, resultAddress / Float32Array.BYTES_PER_ELEMENT);
    resultVector.set(results);
  };

  return {
    pv_xpu_webgl_device_init_wasm: pvXpuDeviceInit,
    pv_xpu_webgl_device_mem_alloc_wasm: pvXpuDeviceMemAlloc,
    pv_xpu_webgl_device_mem_free_wasm: pvXpuDeviceMemFree,
    pv_matrix_vector_multiply_webgl_wasm: pvXpuMatrixVectorMultiply,
    pv_xpu_webgl_device_mem_copy_to_xpu_wasm: pvXpuDeviceMemCopyToXpu,
    pv_xpu_webgl_device_mem_copy_from_xpu_wasm: pvXpuDeviceMemCopyFromXpu
  };
};

export {
  initXpu
};
