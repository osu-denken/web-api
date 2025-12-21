import { createJsonResponse } from "./utils";

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

    public static createNotFound(message: string = "Not Found") {
        return new HttpError(404, "NOT_FOUND", message);
    }

    public static createBadRequest(message: string = "Bad Request") {
        return new HttpError(400, "BAD_REQUEST", message);
    }

    public static createUnauthorized(message: string = "Unauthorized") {
        return new HttpError(401, "UNAUTHORIZED", message);
    }

    public static createUnauthorizedHeaderRequired() {
        return this.createUnauthorized("Authorization header is required");
    }

    public static createUnauthorizedInvalidToken() {
        return this.createUnauthorized("Invalid authorization token");
    }

    public static createForbidden(message: string = "Forbidden") {
        return new HttpError(403, "FORBIDDEN", message);
    }

    public static createInternalServerError(message: string = "Internal Server Error") {
        return new HttpError(500, "INTERNAL_SERVER_ERROR", message);
    }

    public static createMethodNotAllowed(message: string = "Method Not Allowed") {
        return new HttpError(405, "METHOD_NOT_ALLOWED", message);
    }

    public static createMethodNotAllowedPostOnly() {
        return this.createMethodNotAllowed("Method Not Allowed: POST only");
    }

    public static createNotImplemented(message: string = "Not Implemented") {
        throw new HttpError(501, "NOT_IMPLEMENTED", message);
    }

    public toResponse() {
        return createJsonResponse({
            status: this.status,
            error: this.error,
            message: this.message
        }, this.status);
    }
}
