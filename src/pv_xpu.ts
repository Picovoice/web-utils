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
    device: GPUDevice;
    bindGroupLayout?: GPUBindGroupLayout;
    pipeline?: GPUComputePipeline;
    metadataBuffer?: GPUBuffer;
  }
>();

const gpuBuffers = new Map<
  number,
  {
    deviceAddress: number;
    buffer: GPUBuffer;
    stageBuffer?: GPUBuffer;
  }
>();

const WORKGROUP_SIZE = 16;

const shaderSource = `
@group(0) @binding(0)
var<storage, read> matrix: array<u32>;

@group(0) @binding(1)
var<storage, read> vector: array<f32>;

@group(0) @binding(2)
var<storage, read_write> result: array<f32>;

struct Metadata {
  m: u32,  
  n_real: u32,
}

@group(0) @binding(3)
var<uniform> metadata: Metadata;

@compute @workgroup_size(${WORKGROUP_SIZE})
fn main(
  @builtin(global_invocation_id)
  global_id : vec3u,
) {    
    let i: u32 = global_id.x;
    if (i >= metadata.m) {
        return;
    }

    var sum: f32 = 0.0;
    for (var j: u32 = 0u; j < metadata.n_real; j = j + 1u) {
        let matrix_value: u32 = matrix[(i * metadata.n_real) + j];
        let val_1 : f32 = f32(extractBits(matrix_value, 0u, 4u));
        let val_2 : f32 = f32(extractBits(matrix_value, 4u, 4u));
        let val_3 : f32 = f32(extractBits(matrix_value, 8u, 4u));
        let val_4 : f32 = f32(extractBits(matrix_value, 12u, 4u));
        let val_5 : f32 = f32(extractBits(matrix_value, 16u, 4u));
        let val_6 : f32 = f32(extractBits(matrix_value, 20u, 4u));
        let val_7 : f32 = f32(extractBits(matrix_value, 24u, 4u));
        let val_8 : f32 = f32(extractBits(matrix_value, 28u, 4u));
        
        let vector_index: u32 = j * 8u;
        sum += (val_1 * vector[vector_index]);
        sum += (val_2 * vector[vector_index + 1u]);
        sum += (val_3 * vector[vector_index + 2u]);
        sum += (val_4 * vector[vector_index + 3u]);
        sum += (val_5 * vector[vector_index + 4u]);
        sum += (val_6 * vector[vector_index + 5u]);
        sum += (val_7 * vector[vector_index + 6u]);
        sum += (val_8 * vector[vector_index + 7u]);        
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

      const device = await adapter.requestDevice();
      if (!device) {
        console.error('Could not find WebGPU GPU device.');
        setStatus(statusAddress, -1);
        return;
      }

      gpuDevices.set(objAddress, { device });
      setStatus(statusAddress, 0);
    } catch (e) {
      console.error(e);
      setStatus(statusAddress, -1);
    }
  };

  const pvXpuDeviceCleanup = (objAddress: number) => {
    const obj = gpuDevices.get(objAddress);
    if (!obj) {
      return;
    }

    if (obj.metadataBuffer) {
      obj.metadataBuffer.destroy();
    }

    gpuDevices.delete(objAddress);
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

    obj.bindGroupLayout = obj.device.createBindGroupLayout({
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
          buffer: { type: 'uniform' },
        },
      ],
    });

    const pipelineLayout = obj.device.createPipelineLayout({
      bindGroupLayouts: [obj.bindGroupLayout],
    });
    const shaderModule = obj.device.createShaderModule({
      code: shaderSource,
    });

    obj.pipeline = obj.device.createComputePipeline({
      layout: pipelineLayout,
      compute: {
        module: shaderModule,
        entryPoint: 'main',
      },
    });

    obj.metadataBuffer = obj.device.createBuffer({
      size: 2 * Uint32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    setStatus(statusAddress, 0);
  };

  const pvXpuDeviceMemAlloc = (
    objAddress: number,
    memAddress: number,
    sizeBytes: number,
    isOutput: boolean,
    statusAddress: number
  ): void => {
    const obj = gpuDevices.get(objAddress);
    if (!obj) {
      console.error('WebGPU device has not been initialized');
      setStatus(statusAddress, -1);
      return;
    }

    let usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;
    if (isOutput) {
      usage |= GPUBufferUsage.COPY_SRC;
    }

    gpuBuffers.set(memAddress, {
      deviceAddress: objAddress,
      buffer: obj.device.createBuffer({
        size: sizeBytes * Uint8Array.BYTES_PER_ELEMENT,
        usage,
      }),
      stageBuffer: isOutput
        ? obj.device.createBuffer({
            size: sizeBytes * Uint8Array.BYTES_PER_ELEMENT,
            usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
          })
        : undefined,
    });

    setStatus(statusAddress, 0);
  };

  const pvXpuDeviceMemFree = (memAddress: number): void => {
    if (gpuBuffers.has(memAddress)) {
      const { buffer, stageBuffer } = gpuBuffers.get(memAddress)!;
      buffer.destroy();
      if (stageBuffer) {
        stageBuffer.destroy();
      }

      gpuBuffers.delete(memAddress);
    }
  };

  const pvXpuDeviceMemCopyToXpu = async (
    memAddress: number,
    hostAddress: number,
    sizeBytes: number
  ): Promise<void> => {
    if (hostAddress < 0) {
      console.error('Invalid host address', memAddress, hostAddress, sizeBytes);
      return;
    }

    const gpuBuffer = gpuBuffers.get(memAddress);
    if (!gpuBuffer || !gpuBuffer.buffer || !gpuBuffer.deviceAddress) {
      console.error('GPU buffer has not been allocated');
      return;
    }

    const obj = gpuDevices.get(gpuBuffer.deviceAddress);
    if (!obj) {
      console.error('WebGPU device has not been initialized');
      return;
    }

    const memoryBufferUint8 = new Uint8Array(memory.buffer);
    obj.device.queue.writeBuffer(
      gpuBuffer.buffer,
      0,
      memoryBufferUint8.slice(hostAddress, hostAddress + sizeBytes)
    );
  };

  const pvXpuDeviceMemCopyFromXpu = async (
    memAddress: number,
    hostAddress: number,
    sizeBytes: number
  ): Promise<void> => {
    if (hostAddress < 0) {
      console.error('Invalid host address', memAddress, hostAddress, sizeBytes);
      return;
    }

    const gpuBuffer = gpuBuffers.get(memAddress);
    if (!gpuBuffer?.buffer || !gpuBuffer?.stageBuffer) {
      console.error('GPU buffer has not been allocated');
      return;
    }

    const obj = gpuDevices.get(gpuBuffer.deviceAddress);
    if (!obj) {
      console.error('WebGPU device has not been initialized');
      return;
    }

    await gpuBuffer.stageBuffer.mapAsync(GPUMapMode.READ, 0, sizeBytes);
    const mappedBuffer = new Uint8Array(
      gpuBuffer.stageBuffer.getMappedRange(0, sizeBytes)
    );
    const memoryBufferUint8 = new Uint8Array(memory.buffer);
    memoryBufferUint8.set(mappedBuffer.slice(0, sizeBytes), hostAddress);
    gpuBuffer.stageBuffer.unmap();
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
    if (!obj || !obj.device) {
      console.error('WebGPU device has not been initialized');
      setStatus(statusAddress, -1);
      return;
    }

    if (!obj.metadataBuffer || !obj.bindGroupLayout || !obj.pipeline) {
      console.error('Shader has not been loaded');
      setStatus(statusAddress, -1);
      return;
    }

    const metadataArray = new Uint32Array([m, Math.ceil(n / 8)]);
    obj.device.queue.writeBuffer(obj.metadataBuffer, 0, metadataArray);

    const matrixBuffer = gpuBuffers.get(matrixAddress)?.buffer;
    if (!matrixBuffer) {
      console.error('Matrix buffer has not been allocated');
      setStatus(statusAddress, -1);
      return;
    }

    const vectorBuffer = gpuBuffers.get(vectorAddress)?.buffer;
    if (!vectorBuffer) {
      console.error('Vector buffer has not been allocated');
      setStatus(statusAddress, -1);
      return;
    }

    const resultBuffers = gpuBuffers.get(resultAddress);
    if (!resultBuffers || !resultBuffers.buffer || !resultBuffers.stageBuffer) {
      console.error('Result vector buffer has not been allocated');
      setStatus(statusAddress, -1);
      return;
    }

    const bindGroup = obj.device.createBindGroup({
      layout: obj.bindGroupLayout,
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
          resource: { buffer: resultBuffers.buffer },
        },
        { binding: 3, resource: { buffer: obj.metadataBuffer! } },
      ],
    });

    const commandEncoder = obj.device.createCommandEncoder();
    const passEncoder = commandEncoder.beginComputePass();
    passEncoder.setBindGroup(0, bindGroup);
    passEncoder.setPipeline(obj.pipeline);
    passEncoder.dispatchWorkgroups(Math.ceil(m / WORKGROUP_SIZE));
    passEncoder.end();

    commandEncoder.copyBufferToBuffer(
      resultBuffers.buffer,
      0,
      resultBuffers.stageBuffer,
      0,
      resultBuffers.stageBuffer.size
    );
    obj.device.queue.submit([commandEncoder.finish()]);

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
    pv_xpu_webgpu_device_cleanup_wasm: pvXpuDeviceCleanup,
  };
};

export { initXpu };
