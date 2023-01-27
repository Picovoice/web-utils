/*
  Copyright 2023 Picovoice Inc.

  You may not use this file except in compliance with the license. A copy of the license is located in the "LICENSE"
  file accompanying this source.

  Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on
  an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the
  specific language governing permissions and limitations under the License.
*/

type PvErrorType = {
  key: string;
  message: string;
};


export class PvError {
  private static _maxNumErrors = 10;
  private static _errors: PvErrorType[] = [];

  /**
   * Store an error with a key and message.
   */
  public static addError(key: string, error?: string | Error) {
    if (this._errors.length >= this._maxNumErrors) {
      this._errors.shift();
    }

    if (error instanceof Error) {
      this._errors.push({
        key: key,
        message: error.toString()
      });
    } else {
      this._errors.push({
        key: key,
        message: JSON.stringify(error)
      });
    }
  }

  /**
   * Get all recent error messages. Cleans up error list.
   */
  public static getErrors() {
    const errors = [...this._errors];
    this._errors = [];
    return errors;
  }

  /**
   * Get errors formatted into a string.
   */
  public static getErrorString() {
    let message = '';
    for (const error of this.getErrors()) {
      message += `'${error.key}' failed with: ${error.message}.\n`;
    }
    return message;
  }

  /**
   * Sets the maximum number of errors it can store.
   */
  public static setMaxErrorNum(num: number) {
    this._maxNumErrors = num;
  }
}
