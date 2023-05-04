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
  private _maxNumErrors = 10;
  private _errors: PvErrorType[] = [];
  private _lastError: Error = new Error('null');

  /**
   * Store an error with a key and message.
   */
  public addError(key: string, error?: string | Error) {
    this._lastError = (error instanceof Error) ? error : new Error(error);

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
  public getErrors() {
    const errors = [...this._errors];
    this._errors = [];
    return errors;
  }

  /**
   * Get errors formatted into a string.
   */
  public getErrorString() {
    return this.getErrors().map(({ key, message }) => `'${key}' failed with: ${message}.`).join('\n');
  }

  /**
   * Returns the last error message added to the object.
   */
  public getLastError() {
    return this._lastError;
  }

  /**
   * Sets the maximum number of errors it can store.
   */
  public setMaxErrorNum(num: number) {
    this._maxNumErrors = num;
  }
}
