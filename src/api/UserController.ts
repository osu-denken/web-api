import { HttpError } from "../util/HttpError";
import { createJsonResponseRaw } from "../util/utils";
import { IController } from "./IController";

export class UserController extends IController {    
    public getParentPath(): string {
        return "user";
    }

    public constructor(path: string[]) {
        super(path);
        if (path.length < 2) path[1] = "info";
    }

    public route() {
        if (this.path[1] == "info") return this.info();

        throw HttpError.createNotFound("Endpoint not found");
    }

    public async info() {
        if (this.request?.method !== "POST") throw HttpError.createMethodNotAllowedPostOnly();
        if (!this.authorization) throw HttpError.createUnauthorizedHeaderRequired();

        const data: any = await this.firebase?.verifyIdToken?(this.authorization) : null;
        return createJsonResponseRaw(data);
    }
}
