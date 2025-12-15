import { HttpError } from "../util/HttpError";
import { createJsonResponse, generateInviteCode, logInfo } from "../util/utils";
import { IController } from "./IController";

export class InviteController extends IController {    
    public getParentPath(): string {
        return "invite";
    }

    public constructor(path: string[]) {
        super(path);
        if (path.length < 2) path[1] = "validate";
    }

    public route() {
        if (this.path[1] == "validate") return this.validate();
        if (this.path[1] == "create") return this.create();
        if (this.path[1] == "delete") return this.delete();

        throw HttpError.createNotFound("Endpoint not found");
    }

    public async validate() {
        if (this.request?.method !== "POST") throw HttpError.createMethodNotAllowedPostOnly();
        
        const { code } = await this.request.json() as { code: string };
        if (!code) throw HttpError.createBadRequest("Code is required");
        
        const localId = await this.env.INVITE_CODE.get(code);

        if (!localId)
            return createJsonResponse({ valid: false });
        
        return createJsonResponse({ valid: true, localId });
    }

    public async create() {
        if (this.request?.method !== "POST") throw HttpError.createMethodNotAllowedPostOnly();
        if (!this.authorization) throw HttpError.createUnauthorizedHeaderRequired();

        const data: any = await this.firebase?.verifyIdToken?(this.authorization) : null;
        await this.checkPermissionByEmail(data.email);
        
        const code = generateInviteCode(12);

        // 24時間有効
        await this.env.INVITE_CODE.put(code, data.localId, { expirationTtl: 86400 });
        await logInfo(this.request, this.env, "invite", `Create invite-code "${code}" by ${data.localId}: ${code}`);

        return createJsonResponse({ code, success: true });
    }

    public async delete() {
        if (this.request?.method !== "POST") throw HttpError.createMethodNotAllowedPostOnly();
        if (!this.authorization) throw HttpError.createUnauthorizedHeaderRequired();

        const data: any = await this.firebase?.verifyIdToken?(this.authorization) : null;
        await this.checkPermissionByEmail(data.email);
        
        const { code } = await this.request.json() as { code: string };

        if (!code) throw HttpError.createBadRequest("Code is required");

        await this.env.INVITE_CODE.delete(code);
        await logInfo(this.request, this.env, "invite", `Delete invite-code "${code}" by ${data.localId}: ${code}`);
        
        return createJsonResponse({ success: true });
    }
}
