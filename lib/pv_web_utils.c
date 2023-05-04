/*
    Copyright 2023 Picovoice Inc.
    You may not use this file except in compliance with the license. A copy of the license is located in the "LICENSE"
    file accompanying this source.
    Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on
    an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the
    specific language governing permissions and limitations under the License.
*/

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define PV_API __attribute__((visibility("default")))

typedef enum pv_web_utils_status {
    SUCCESS = 0,
    FAILURE
} pv_web_utils_status_t;

extern void pv_console_log_wasm(const char *ch);
extern void pv_assert_wasm(int32_t expr, int32_t line, const char *file_name);
extern double pv_time_wasm(void);
extern void pv_https_request_wasm(
        const char *http_method,
        const char *server_name,
        const char *endpoint,
        const char *header,
        const char *body,
        int32_t timeout_msec,
        void **response,
        size_t *response_size,
        int32_t *response_code);
extern void pv_get_browser_info(char **browser_info);
extern void pv_get_origin_info(char **origin_info);
extern void pv_file_open_wasm(void *f, const char *path, const char *mode, int32_t *status);
extern void pv_file_close_wasm(void *f, int32_t *status);
extern void pv_file_write_wasm(void *f, const void *content, size_t size, size_t count, size_t *num_write);
extern void pv_file_read_wasm(void *f, void *content, size_t size, size_t count, int32_t *num_read);
extern void pv_file_seek_wasm(void *f, long int offset, int whence, int32_t *status);
extern void pv_file_tell_wasm(void *f, long *offset);
extern void pv_file_remove_wasm(const char *path, int32_t *status);

void *file = NULL;
const char test_path[] = "test_path";
const char test_content[] = "content";

PV_API pv_web_utils_status_t pv_web_utils_test_console_log(void) {
    pv_console_log_wasm("testing console log");
    return SUCCESS;
}

PV_API pv_web_utils_status_t pv_web_utils_test_assert(void) {
    pv_assert_wasm(1, __LINE__, __FILE__);
    return SUCCESS;
}

PV_API pv_web_utils_status_t pv_web_utils_test_time(void) {
    double time = pv_time_wasm();
    return (time > 0) ? SUCCESS : FAILURE;
}

PV_API pv_web_utils_status_t pv_web_utils_test_https_request(void) {
    char *response = NULL;
    size_t response_size = 0;
    int32_t response_code = 0;

    pv_https_request_wasm(
            "GET",
            "localhost",
            "/test_route",
            "",
            "",
            7000,
            (void **) &response,
            &response_size,
            &response_code);

    pv_console_log_wasm(response);

    if (response_code != 200) {
        return FAILURE;
    }

    return (strncmp(response, "test data", response_size) == 0) ? SUCCESS : FAILURE;
}

PV_API pv_web_utils_status_t pv_web_utils_test_browser_info(void) {
    char *browser_info = NULL;
    pv_get_browser_info(&browser_info);

    if (!browser_info) {
        return FAILURE;
    }

    free(browser_info);
    return SUCCESS;
}

PV_API pv_web_utils_status_t pv_web_utils_test_origin_info(void) {
    char *origin_info = NULL;
    pv_get_origin_info(&origin_info);

    if (!origin_info) {
        return FAILURE;
    }

    free(origin_info);
    return SUCCESS;
}

PV_API pv_web_utils_status_t pv_web_utils_test_file_open(void) {
    file = malloc(sizeof (void *));
    if (!file) {
        return FAILURE;
    }

    int32_t status = -1;
    pv_file_open_wasm(file, test_path, "w", &status);
    if (status != 0) {
        return FAILURE;
    }

    return SUCCESS;
}

PV_API pv_web_utils_status_t pv_web_utils_test_file_write(void) {
    if (!file) {
        return FAILURE;
    }

    size_t num_write = -1;
    pv_file_write_wasm(file, test_content, sizeof (char), sizeof (test_content), &num_write);

    return (num_write == sizeof (test_content)) ? SUCCESS : FAILURE;
}

PV_API pv_web_utils_status_t pv_web_utils_test_file_tell(void) {
    if (!file) {
        return FAILURE;
    }

    long offset = -1;
    pv_file_tell_wasm(file, &offset);

    return (offset == sizeof (test_content)) ? SUCCESS : FAILURE;
}

PV_API pv_web_utils_status_t pv_web_utils_test_file_seek(void) {
    if (!file) {
        return FAILURE;
    }

    int32_t status = -1;
    pv_file_seek_wasm(file, 0, 0, &status);

    return (status == 0) ? SUCCESS : FAILURE;
}

PV_API pv_web_utils_status_t pv_web_utils_test_file_read(void) {
    if (!file) {
        return FAILURE;
    }

    char content[sizeof (test_content)];
    int32_t num_read = -1;
    pv_file_read_wasm(file, content, sizeof (char), sizeof (test_content), &num_read);

    if (num_read != sizeof (test_content)) {
        return FAILURE;
    }

    return (strncmp(content, test_content, sizeof (test_content)) == 0) ? SUCCESS : FAILURE;
}

PV_API pv_web_utils_status_t pv_test_utils_test_file_close(void) {
    if (!file) {
        return FAILURE;
    }

    int32_t status = -1;
    pv_file_close_wasm(file, &status);

    if (status != 0) {
        return FAILURE;
    }

    int32_t num_read = -1;
    char content[1];
    pv_file_read_wasm(file, content, sizeof (char), 1, &num_read);

    return (num_read == -1) ? SUCCESS : FAILURE;
}

PV_API pv_web_utils_status_t pv_test_utils_test_remove(void) {
    if (!file) {
        return FAILURE;
    }

    int32_t status = -1;
    pv_file_remove_wasm(test_path, &status);

    if (status != 0) {
        return FAILURE;
    }

    pv_file_open_wasm(file, test_path, "r", &status);

    return (status == -1) ? SUCCESS : FAILURE;
}
