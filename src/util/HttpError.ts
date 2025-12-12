import { createJsonResponse2, createJsonResponseRaw } from "./utils";

export class HttpError extends Error {
    public status: number;
    public error: string;
    public message: string;
    
    /**
     * @param code エラーコード  - Eg. 404
     * @param error エラー識別名 - Eg. NOT_FOUND
     * @param message メッセージ - Eg. Not Found
     */
    constructor(code: number, error: string, message: string) {
        super(message);
        super.name = "HttpError";

        this.status = code;
        this.error = error;
        this.message = message;
    }

    public toJson() {
        const arr = {
            status: this.status,
            error: this.error,
            message: this.message
        };
        return JSON.stringify(arr, null, 2);
    }

    public toResponse() {
        return new Response(this.toJson(), {
            status: this.status,
            headers: {
				"Content-Type": "application/json",
				"Access-Control-Allow-Origin": "*",
				"Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
				"Access-Control-Allow-Headers": "Content-Type, Authorization",
            }
        });
    }
}
