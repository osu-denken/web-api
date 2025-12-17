import { CustomHttpError } from "../util/CustomHttpError";
import { HttpError } from "../util/HttpError";
import { arrayBuffer2base64, createJsonResponse, logInfo } from "../util/utils";
import { IController } from "./IController";

export class ImageController extends IController {
    public static MAX_SIZE = 20 * 1024 * 1024; // 20MB

    public getParentPath(): string {
        return "image";
    }

    public constructor(path: string[]) {
        super(path);
        if (path.length < 3) {
            path[0] = "v1";
            path[1] = "image";
            path[2] = "upload";
        }
    }

    public route() {
        if (this.path[2] === "upload") return this.upload();
        if (this.path[2] === "delete") return this.delete();
        throw HttpError.createNotFound("Endpoint not found");
    }

    public async upload() {
        if (!this.github) throw HttpError.createInternalServerError("GitHub service not initialized");
        if (this.request?.method !== "POST") throw HttpError.createMethodNotAllowedPostOnly();
        if (!this.authorization) throw HttpError.createUnauthorizedHeaderRequired();

        const data: any = await this.firebase?.verifyIdToken(this.authorization);
        await this.checkPermissionByEmail(data.email);

        const contentType = this.request.headers.get("content-type") || "";
        if (!contentType.includes("multipart/form-data")) throw HttpError.createBadRequest("multipart/form-data required");

        const formData = await this.request.formData();
        const file = formData.get("file");
        let name = formData.get("name") as string | null;

        if (!(file instanceof File)) throw HttpError.createBadRequest("file is required");
        if (file.size > ImageController.MAX_SIZE) throw HttpError.createBadRequest("Image size must be <= 20MB");
        if (!this.isImage(file.type)) throw HttpError.createBadRequest("Unsupported image type");

        name = name ? name.replace(/[^a-zA-Z0-9_-]/g, "") : null;

        const ext = this.getExt(file.type);
        const filename = name
            ? `${name}.${ext}`
            : `${crypto.randomUUID()}.${ext}`;

        const base64 = arrayBuffer2base64(await file.arrayBuffer());
        const res = await this.github.uploadImage(filename, base64, `Upload image ${filename} via Cloudflare Worker`);

        if (!res.ok) throw new CustomHttpError(500, "INTERNAL_SERVER_ERROR", "GitHub upload failed", await res.text());

        const result: any = await res.json();

        await logInfo(this.request, this.env, "image_upload", `Upload image "${filename}" by ${data.localId}`);

        return createJsonResponse({
            success: true,
            name: filename,
            sha: result.content?.sha,
            url: `/images/${filename}`
        });
    }

    public async delete() {
        if (!this.github) throw HttpError.createInternalServerError("GitHub service not initialized");
        if (this.request?.method !== "POST") throw HttpError.createMethodNotAllowedPostOnly();
        if (!this.authorization) throw HttpError.createUnauthorizedHeaderRequired();

        const data: any = await this.firebase?.verifyIdToken(this.authorization);
        await this.checkPermissionByEmail(data.email);


        const body: any = await this.request.json();
        const filename = body?.filename as string;
        const sha = body?.sha as string | undefined;

        if (!filename) throw HttpError.createBadRequest("filename is required");
        await this.github.deleteImage(filename, sha);

        await logInfo(this.request, this.env, "image_delete", `Deleted image "${filename}" by ${data.localId}`);

        return createJsonResponse({ success: true, filename });
    }

    private isImage(type: string) {
        return ["image/jpeg", "image/png", "image/webp", "image/gif"].includes(type);
    }

    private getExt(type: string) {
        switch (type) {
            case "image/jpeg": return "jpg";
            case "image/png": return "png";
            case "image/webp": return "webp";
            case "image/gif": return "gif";
            default: return "bin";
        }
    }
}
