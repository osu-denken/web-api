import { HttpError } from "./HttpError";
import { createJsonResponse } from "./utils";

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
    
    public toResponse() {
        return createJsonResponse({
            status: this.status,
            error: this.error,
            message: this.message,
            data: this.data
        }, this.status);
    }
}
