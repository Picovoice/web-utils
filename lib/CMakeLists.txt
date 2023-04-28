cmake_minimum_required(VERSION 3.13)

project(picovoice-web-utils)

set(CMAKE_SYSTEM_NAME wasm)
set(TOOLCHAIN_DIR ${PROJECT_BINARY_DIR}/external)

set(WASI_SDK_VERSION 15)
set(WASI_SDK_DIR ${TOOLCHAIN_DIR}/wasi-sdk)
set(WASI_CLANG_VERSION 14.0.3)
set(BINARYEN_VERSION 109)
set(BINARYEN_DIR ${TOOLCHAIN_DIR}/binaryen)

if (MINGW)
    set(WASI_URL https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-${WASI_SDK_VERSION}/wasi-sdk-${WASI_SDK_VERSION}.0-mingw.tar.gz)
    set(BINARYEN_URL https://github.com/WebAssembly/binaryen/releases/download/version_${BINARYEN_VERSION}/binaryen-version_${BINARYEN_VERSION}-x86_64-windows.tar.gz)
elseif (UNIX AND APPLE)
    set(WASI_URL https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-${WASI_SDK_VERSION}/wasi-sdk-${WASI_SDK_VERSION}.0-macos.tar.gz)
    set(BINARYEN_URL https://github.com/WebAssembly/binaryen/releases/download/version_${BINARYEN_VERSION}/binaryen-version_${BINARYEN_VERSION}-x86_64-macos.tar.gz)
elseif (UNIX AND NOT APPLE)
    set(WASI_URL https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-${WASI_SDK_VERSION}/wasi-sdk-${WASI_SDK_VERSION}.0-linux.tar.gz)
    set(BINARYEN_URL https://github.com/WebAssembly/binaryen/releases/download/version_${BINARYEN_VERSION}/binaryen-version_${BINARYEN_VERSION}-x86_64-linux.tar.gz)
endif ()

if(NOT EXISTS ${TOOLCHAIN_DIR})
    message("Downloading wasi-sdk...")
    file(DOWNLOAD ${WASI_URL}
            ${WASI_SDK_DIR}/wasi_sdk.tar.gz
            SHOW_PROGRESS)
    execute_process(COMMAND tar --strip-components 1 -xzf ${WASI_SDK_DIR}/wasi_sdk.tar.gz WORKING_DIRECTORY ${WASI_SDK_DIR})
    message("Downloading binaryen...")
    file(DOWNLOAD ${BINARYEN_URL}
            ${BINARYEN_DIR}/binaryen.tar.gz
            SHOW_PROGRESS)
    execute_process(COMMAND tar --strip-components 1 -xzf ${BINARYEN_DIR}/binaryen.tar.gz WORKING_DIRECTORY ${BINARYEN_DIR})
endif()

find_program(WASI_CLANG clang "${WASI_SDK_DIR}/bin" NO_DEFAULT_PATH)
if (NOT WASI_CLANG)
    message(FATAL_ERROR "required 'wasi-sdk' in '/opt/' to compile for wasm")
endif ()
find_program(WASM_OPT wasm-opt "${BINARYEN_DIR}/bin" NO_DEFAULT_PATH)
if (NOT WASM_OPT)
    message(FATAL_ERROR "required binaryen package")
endif ()
message(STATUS "Using 'clang' in ${WASI_CLANG}")

set(CMAKE_C_COMPILER ${WASI_CLANG})
set(CMAKE_CXX_COMPILER ${WASI_SDK_DIR}/bin/clang++)
set(CMAKE_AR ${WASI_SDK_DIR}/bin/ar)
set(CMAKE_STRIP ${WASI_SDK_DIR}/bin/strip)
set(CMAKE_RANLIB ${WASI_SDK_DIR}/bin/ranlib)

# compiler has to be -O2 -fno-vectorize and wasm-opt has to be -O2 to see best performance on chrome for most devices
# -O2 and -O1 combinations slow down on some devices, fast on others. This only happens on chrome. (safari and firefox are ok).
# For now -O2 -fno-vectorize seems to produce most stable results based on test and trial.
set(WASM_COMPILER_FLAGS "-fvisibility=hidden -Wall -Wextra -O2 -fno-vectorize -flto --sysroot ${WASI_SDK_DIR}/share/wasi-sysroot")
if (APPLE)
    set(WASM_COMPILER_FLAGS "${WASM_COMPILER_FLAGS} -Wno-unused-command-line-argument")
endif ()

set(CMAKE_CXX_COMPILER_TARGET ${TARGET})
set(CMAKE_CXX_FLAGS_RELEASE ${WASM_COMPILER_FLAGS})
set(CMAKE_CXX_FLAGS_DEBUG ${WASM_COMPILER_FLAGS})
set(CMAKE_C_COMPILER_TARGET ${TARGET})
set(CMAKE_C_FLAGS_RELEASE ${WASM_COMPILER_FLAGS})
set(CMAKE_C_FLAGS_DEBUG ${WASM_COMPILER_FLAGS})
set(CMAKE_EXE_LINKER_FLAGS
        "-nostartfiles -Wl,--no-entry -Wl,--export=aligned_alloc -Wl,--export=malloc,--export=free -Wl,--export-dynamic -Wl,--lto-O2 -Wl,--allow-undefined-file=${CMAKE_SOURCE_DIR}/.wasm.syms -Wl,--import-memory")
set(CMAKE_EXE_LINKER_FLAGS "${CMAKE_EXE_LINKER_FLAGS} -Wl,--wrap=fopen -Wl,--wrap=fclose -Wl,--wrap=fread -Wl,--wrap=fwrite -Wl,--wrap=fgetc -Wl,--wrap=fseek -Wl,--wrap=ftell -Wl,--wrap=fflush -Wl,--wrap=fwrite -Wl,--wrap=remove")

set(WASM_ASYNCIFY_FUNCTION
        asyncify-imports@env.pv_https_request_wasm,env.pv_get_browser_info,env.pv_get_origin_info,env.pv_file_open_wasm,env.pv_file_close_wasm,env.pv_file_read_wasm,env.pv_file_write_wasm,env.pv_file_seek_wasm,env.pv_file_tell_wasm,env.pv_file_remove_wasm)

set(WASM_OPT_FLAGS
        --asyncify
        --pass-arg=${WASM_ASYNCIFY_FUNCTION}
        -O2
        VERBATIM)

set(WASM_RUNTIME_OUTPUT_DIRECTORY ${CMAKE_SOURCE_DIR}/wasm)

add_executable(pv_web_utils pv_web_utils.c)

add_custom_command(
        TARGET pv_web_utils
        POST_BUILD
        COMMAND ${WASM_OPT} $<TARGET_FILE:pv_web_utils> -o $<TARGET_FILE:pv_web_utils> ${WASM_OPT_FLAGS}
)
set_target_properties(
        pv_web_utils
        PROPERTIES PREFIX ""
        OUTPUT_NAME pv_web_utils
        SUFFIX ".wasm"
)
