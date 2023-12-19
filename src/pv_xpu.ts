/*
  Copyright 2023 Picovoice Inc.

  You may not use this file except in compliance with the license. A copy of the license is located in the "LICENSE"
  file accompanying this source.

  Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on
  an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the
  specific language governing permissions and limitations under the License.
*/

/* eslint camelcase: 0 */

const gpuDevices = new Map<
  number,
  {
    gpuDevice: GPUDevice;
    deviceAddresses: Set<number>;
  }
>();

const gpuBuffers = new Map<
  number,
  {
    deviceAddress: number;
    buffer: GPUBuffer;
  }
>();

const gpuStagingBuffers = new Map<
  number,
  {
    deviceAddress: number;
    buffer: GPUBuffer;
  }
>();

const gpuShaders = new Map<
  number,
  {
    bindGroupLayout: GPUBindGroupLayout;
    pipeline: GPUComputePipeline;
  }
>();

const shaderSource = `
@group(0) @binding(0)
var<storage, read> matrix: array<u32>;

@group(0) @binding(1)
var<storage, read> vector: array<f32>;

@group(0) @binding(2)
var<storage, read_write> result: array<f32>;

struct MetaData {
  m: u32,  
  n_real: u32,
}

@group(0) @binding(3)
var<storage, read> metadata: MetaData;

@compute @workgroup_size(16)
fn main(
  @builtin(global_invocation_id)
  global_id : vec3u,
) {    
    let i: u32 = global_id.x;
    if (i >= metadata.m) {
        return;
    }
                
    var sum : f32 = 0;
    for (var j: u32 = 0u; j < metadata.n_real; j = j + 1u) {
        var matrix_value: u32 = matrix[(i * metadata.n_real) + j];
        var val_1 : f32 = f32(0x0000000F & (matrix_value >> 0u));
        var val_2 : f32 = f32(0x0000000F & (matrix_value >> 4u));
        var val_3 : f32 = f32(0x0000000F & (matrix_value >> 8u));
        var val_4 : f32 = f32(0x0000000F & (matrix_value >> 12u));
        var val_5 : f32 = f32(0x0000000F & (matrix_value >> 16u));
        var val_6 : f32 = f32(0x0000000F & (matrix_value >> 20u));
        var val_7 : f32 = f32(0x0000000F & (matrix_value >> 24u));
        var val_8 : f32 = f32(0x0000000F & (matrix_value >> 28u));        
        
        sum = sum + (val_1 * vector[(j * 8u) + 0u]);
        sum = sum + (val_2 * vector[(j * 8u) + 1u]);
        sum = sum + (val_3 * vector[(j * 8u) + 2u]);
        sum = sum + (val_4 * vector[(j * 8u) + 3u]);
        sum = sum + (val_5 * vector[(j * 8u) + 4u]);
        sum = sum + (val_6 * vector[(j * 8u) + 5u]);
        sum = sum + (val_7 * vector[(j * 8u) + 6u]);
        sum = sum + (val_8 * vector[(j * 8u) + 7u]);        
    }
    
    result[i] = sum;
}
`;

const initXpu = (
  memory: WebAssembly.Memory,
  wasm: string | Promise<Response>
) => {
  const setStatus = (statusAddress: number, value: number) => {
    const memoryBufferInt32 = new Int32Array(memory.buffer);
    memoryBufferInt32[statusAddress / Int32Array.BYTES_PER_ELEMENT] = value;
  };

  const pvXpuDeviceInit = async (
    objAddress: number,
    statusAddress: number
  ): Promise<void> => {
    try {
      if (!window.isSecureContext) {
        console.error(
          'WebGPU is only available in secure contexts (e.g. HTTPS)'
        );
        setStatus(statusAddress, -1);
        return;
      }

      if (!navigator.gpu) {
        console.error('WebGPU not supported.');
        setStatus(statusAddress, -1);
        return;
      }

      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) {
        console.error(
          'WebGPU not supported, please enable it in your browser.'
        );
        setStatus(statusAddress, -1);
        return;
      }

      const device = await adapter!.requestDevice();
      if (!device) {
        console.error('Could not find WebGPU GPU device.');
        setStatus(statusAddress, -1);
        return;
      }

      gpuDevices.set(objAddress, {
        gpuDevice: device,
        deviceAddresses: new Set(),
      });
      setStatus(statusAddress, 0);
    } catch (e) {
      console.error(e);
      setStatus(statusAddress, -1);
    }
  };

  const pvXpuDeviceLoadShader = (
    objAddress: number,
    libNameAddress: number,
    shaderNameAddress: number,
    statusAddress: number
  ) => {
    const obj = gpuDevices.get(objAddress);
    if (!obj) {
      console.error('WebGPU device has not been initialized');
      setStatus(statusAddress, -1);
      return;
    }

    const bindGroupLayout = obj.gpuDevice.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'read-only-storage' },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'read-only-storage' },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'storage' },
        },
        {
          binding: 3,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'read-only-storage' },
        },
      ],
    });

    const pipelineLayout = obj.gpuDevice.createPipelineLayout({
      bindGroupLayouts: [bindGroupLayout],
    });
    const shaderModule = obj.gpuDevice.createShaderModule({
      code: shaderSource,
    });
    const pipeline = obj.gpuDevice.createComputePipeline({
      layout: pipelineLayout,
      compute: {
        module: shaderModule,
        entryPoint: 'main',
      },
    });

    gpuShaders.set(objAddress, { bindGroupLayout, pipeline });

    setStatus(statusAddress, 0);
  };

  const pvXpuDeviceMemAlloc = (
    objAddress: number,
    memAddress: number,
    sizeBytes: number,
    isCopySrc: boolean,
    isMapped: boolean,
    createStagedBuffer: boolean,
    statusAddress: number
  ): void => {
    const obj = gpuDevices.get(objAddress);
    if (!obj) {
      console.error('WebGPU device has not been initialized');
      setStatus(statusAddress, -1);
      return;
    }
    obj.deviceAddresses.add(memAddress);

    let usage = GPUBufferUsage.STORAGE;
    if (isCopySrc) {
      usage |= GPUBufferUsage.COPY_SRC;
    }
    gpuBuffers.set(memAddress, {
      deviceAddress: objAddress,
      buffer: obj.gpuDevice.createBuffer({
        mappedAtCreation: isMapped,
        size: sizeBytes * Uint8Array.BYTES_PER_ELEMENT,
        usage,
      }),
    });

    if (createStagedBuffer) {
      gpuStagingBuffers.set(memAddress, {
        deviceAddress: objAddress,
        buffer: obj.gpuDevice.createBuffer({
          size: sizeBytes * Uint8Array.BYTES_PER_ELEMENT,
          usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
        }),
      });
    }
    setStatus(statusAddress, 0);
  };

  const pvXpuDeviceMemFree = (memAddress: number): void => {
    if (gpuBuffers.has(memAddress)) {
      const { deviceAddress, buffer } = gpuBuffers.get(memAddress)!;
      buffer.destroy();

      gpuDevices.get(deviceAddress)?.deviceAddresses.delete(memAddress);
      gpuBuffers.delete(memAddress);
    }

    if (gpuStagingBuffers.has(memAddress)) {
      const { deviceAddress, buffer } = gpuStagingBuffers.get(memAddress)!;
      buffer.destroy();

      gpuDevices.get(deviceAddress)?.deviceAddresses.delete(memAddress);
      gpuStagingBuffers.delete(memAddress);
    }
  };

  const pvXpuDeviceMemCopyToXpu = (
    memAddress: number,
    hostAddress: number,
    sizeBytes: number
  ): void => {
    if (hostAddress < 0) {
      console.error('invalid host address', memAddress, hostAddress, sizeBytes);
      return;
    }

    const { deviceAddress, buffer } = gpuBuffers.get(memAddress)!;

    const obj = gpuDevices.get(deviceAddress);
    if (!obj) {
      console.error('WebGPU device has not been initialized');
      return;
    }

    const memoryBufferUint8 = new Uint8Array(memory.buffer);
    const bufferMap = new Uint8Array(buffer.getMappedRange());
    bufferMap.set(
      memoryBufferUint8.slice(hostAddress, hostAddress + sizeBytes)
    );
    buffer.unmap();
  };

  const pvXpuDeviceMemCopyFromXpu = async (
    memAddress: number,
    hostAddress: number,
    sizeBytes: number
  ): Promise<void> => {
    if (hostAddress < 0) {
      console.error('invalid host address', memAddress, hostAddress, sizeBytes);
      return;
    }

    const { deviceAddress, buffer } = gpuStagingBuffers.get(memAddress)!;
    if (!buffer) {
      console.error('Staging buffer has not been allocated');
      return;
    }

    const obj = gpuDevices.get(deviceAddress);
    if (!obj) {
      console.error('WebGPU device has not been initialized');
      return;
    }

    await buffer!.mapAsync(GPUMapMode.READ, 0, sizeBytes);
    const mappedBuffer = new Uint8Array(buffer!.getMappedRange(0, sizeBytes));
    const memoryBufferUint8 = new Uint8Array(memory.buffer);
    memoryBufferUint8.set(mappedBuffer.slice(0, sizeBytes), hostAddress);
    buffer!.unmap();
  };

  const pvXpuMatrixVectorMultiply = async (
    objAddress: number,
    matrixAddress: number,
    vectorAddress: number,
    m: number,
    n: number,
    resultAddress: number,
    statusAddress: number
  ): Promise<void> => {
    const obj = gpuDevices.get(objAddress);
    if (!obj) {
      console.error('WebGPU device has not been initialized');
      setStatus(statusAddress, -1);
      return;
    }

    const n_real = Math.ceil(n / 8);
    const metadataArray = new Uint32Array([m, n_real]);
    const metadataBuffer = obj.gpuDevice.createBuffer({
      mappedAtCreation: true,
      size: 2 * Uint32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.STORAGE,
    });
    const bufferMap = new Uint32Array(metadataBuffer.getMappedRange());
    bufferMap.set(metadataArray);
    metadataBuffer.unmap();

    const { bindGroupLayout, pipeline } = gpuShaders.get(objAddress)!;
    const matrixBuffer = gpuBuffers.get(matrixAddress)!.buffer;
    const vectorBuffer = gpuBuffers.get(vectorAddress)!.buffer;
    const resultBuffer = gpuBuffers.get(resultAddress)!.buffer;

    const bindGroup = obj.gpuDevice.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        {
          binding: 0,
          resource: { buffer: matrixBuffer },
        },
        {
          binding: 1,
          resource: { buffer: vectorBuffer },
        },
        {
          binding: 2,
          resource: { buffer: resultBuffer },
        },
        { binding: 3, resource: { buffer: metadataBuffer } },
      ],
    });

    const commandEncoder = obj.gpuDevice.createCommandEncoder();
    const passEncoder = commandEncoder.beginComputePass();
    passEncoder.setBindGroup(0, bindGroup);
    passEncoder.setPipeline(pipeline);
    passEncoder.dispatchWorkgroups(Math.ceil(m / 16));
    passEncoder.end();

    commandEncoder.copyBufferToBuffer(
      resultBuffer,
      0,
      gpuStagingBuffers.get(resultAddress)!.buffer,
      0,
      m * Float32Array.BYTES_PER_ELEMENT
    );
    obj.gpuDevice.queue.submit([commandEncoder.finish()]);

    setStatus(statusAddress, 0);
  };

  return {
    pv_xpu_webgpu_device_init_wasm: pvXpuDeviceInit,
    pv_xpu_webgpu_device_load_shader_wasm: pvXpuDeviceLoadShader,
    pv_xpu_webgpu_device_mem_alloc_wasm: pvXpuDeviceMemAlloc,
    pv_xpu_webgpu_device_mem_free_wasm: pvXpuDeviceMemFree,
    pv_matrix_vector_multiply_webgpu_wasm: pvXpuMatrixVectorMultiply,
    pv_xpu_webgpu_device_mem_copy_to_xpu_wasm: pvXpuDeviceMemCopyToXpu,
    pv_xpu_webgpu_device_mem_copy_from_xpu_wasm: pvXpuDeviceMemCopyFromXpu,
  };
};

export { initXpu };
