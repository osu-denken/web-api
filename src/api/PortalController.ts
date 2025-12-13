import { HttpError } from "../util/HttpError";
import { createJsonResponse, generateInviteCode, logInfo } from "../util/utils";
import { IController } from "./IController";

export class PortalController extends IController {    
    public getParentPath(): string {
        return "portal";
    }

    public constructor(path: string[]) {
        super(path);
    }

    public route() {
        if (this.path[0] === "portal") return this.postPortal();
        if (this.path[0] === "github" && this.path[1] === "invite") return this.postGithubInvite();
        if (this.path[0] === "discord" && this.path[1] === "invite") return this.postDiscordInvite();

        throw HttpError.createNotFound("Endpoint not found");
    }

    /**
     * 部員ポータル用にまとめた情報を返す
     */
    public async postPortal() {
        if (this.request?.method !== "POST") throw HttpError.createMethodNotAllowedPostOnly();
        if (!this.authorization) throw HttpError.createUnauthorizedHeaderRequired();

        const verifyData: any = await this.firebase?.verifyIdToken(this.authorization);

        if (!verifyData || (verifyData.error && verifyData.error.message === "INVALID_ID_TOKEN")) {
            throw new HttpError(401, "UNAUTHORIZED", "Invalid idToken");
        }

        if (verifyData.disabled) {
            throw new HttpError(403, "FORBIDDEN", "User account is disabled");
        }

        return createJsonResponse({
            success: true,
            user: verifyData,
            limits: {
                discordInviteCode: this.env.DISCORD_INVITE,
            },
            idToken: this.authorization
        });
    }

    /**
     * GitHub Organizationに招待する
     */
    public async postGithubInvite() {
        if (this.request?.method !== "POST") throw HttpError.createMethodNotAllowedPostOnly();
        if (!this.authorization) throw HttpError.createUnauthorizedHeaderRequired();

        const data: any = await this.firebase?.verifyIdToken(this.authorization);
        if (!data) throw new HttpError(401, "UNAUTHORIZED", "Invalid idToken");

        const { email } = await this.request.json() as { email: string };
        if (!email) throw new HttpError(400, "BAD_REQUEST", "email is required");

        const res = await this.github?.inviteOrganization(email);
        if (!res) throw new HttpError(500, "INTERNAL_SERVER_ERROR", "GitHub service not available");
        
        const data2: any = await res.json();

        if (!res.ok) {
            throw new HttpError(res.status, res.statusText, data2.message || "GitHub invite failed");
        }

        return createJsonResponse({
            success: true,
            invited: email
        });
    }

    /**
     * Discordの招待コードを返す
     */
    public async postDiscordInvite() {
        if (this.request?.method !== "POST") throw HttpError.createMethodNotAllowedPostOnly();
        if (!this.authorization) throw HttpError.createUnauthorizedHeaderRequired();

        const data: any = await this.firebase?.verifyIdToken(this.authorization);

        if (data.disabled) {
            throw new HttpError(403, "FORBIDDEN", "User account is disabled");
        }

        if ((data.error || !data.localId)) {
            throw new HttpError(401, "UNAUTHORIZED", "Invalid idToken");
        }

        return createJsonResponse({ code: this.env.DISCORD_INVITE, success: true });
    }
}
