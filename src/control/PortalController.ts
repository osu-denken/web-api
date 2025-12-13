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
        if (this.path[0] === "portal" && this.path.length === 1) return this.portal();
        if (this.path[0] === "portal" && this.path[1] === "members") return this.members();
        if (this.path[0] === "github" && this.path[1] === "invite") return this.githubInvite();
        if (this.path[0] === "discord" && this.path[1] === "invite") return this.discordInvite();

        throw HttpError.createNotFound("Endpoint not found");
    }

    /**
     * 部員ポータル用にまとめた情報を返す
     */
    public async portal() {
        if (this.request?.method !== "POST") throw HttpError.createMethodNotAllowedPostOnly();
        if (!this.authorization) throw HttpError.createUnauthorizedHeaderRequired();

        const verifyData: any = await this.firebase?.verifyIdToken(this.authorization);

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
     * 部員一覧を返す
     */
    public async members() {
        if (!this.members_googlesheets) throw HttpError.createInternalServerError("GoogleSheets service of members not initialized");
        if (!this.authorization) throw HttpError.createUnauthorizedHeaderRequired();

        const verifyData: any = await this.firebase?.verifyIdToken(this.authorization);

        const email = verifyData.email;
        let studentId = email.split("@")[0];
        if (studentId.startsWith("s"))
            studentId = studentId.slice(1);

        studentId = studentId.toUpperCase();

        const row = await this.members_googlesheets.findRow("main", "A2:K100", 1, studentId);
        if (!row) throw HttpError.createNotFound(`Member ${studentId} not found`);

        return createJsonResponse(row);
    }

    /**
     * GitHub Organizationに招待する
     */
    public async githubInvite() {
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
    public async discordInvite() {
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
