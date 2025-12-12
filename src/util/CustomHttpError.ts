import { HttpError } from "./HttpError";

export class CustomHttpError extends HttpError {
    public data: any;
    
    /**
     * @param code エラーコード  - Eg. 404
     * @param error エラー識別名 - Eg. NOT_FOUND
     * @param message メッセージ - Eg. Not Found
     * @param data 追加データ - Eg. {}
     */
    constructor(code: number, error: string, message: string, data: any = {}) {
        super(code, error, message);
        super.name = "CustomHttpError";

        this.data = data;
    }

    public toJson() {
        const arr = {
            status: this.status,
            error: this.error,
            message: this.message,
            data: this.data
        };
        return JSON.stringify(arr, null, 2);
    }
}
