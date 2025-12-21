import { HttpError } from "../util/HttpError";
import { createJsonResponse, decrypt, encrypt, generateInviteCode, logInfo } from "../util/utils";
import { IController } from "./IController";

export class PortalController extends IController {    
    public getParentPath(): string {
        return "portal";
    }

    public constructor(path: string[]) {
        super(path);
    }

    public route() {
        if (this.path[0] === "github") {
            if (this.path[1] === "invite") return this.githubInvite();
            if (this.path[1] === "token") return this.githubToken();
        }


        if (this.path[0] === "discord" && this.path[1] === "invite") return this.discordInvite();
    
        if (this.path[0] !== "portal") 
            throw HttpError.createNotFound("Endpoint not found");

        if (this.path.length === 1) return this.portal();
        if (this.path[1] === "members") return this.members();
        if (this.path[1] === "memberCount") return this.memberCount();
        if (this.path[1] === "member" && this.path[2] === "me") return this.memberMe();

        throw HttpError.createNotFound("Endpoint not found");
    }

    /**
     * 部員ポータル用にまとめた情報を返す
     */
    public async portal() {
        if (this.request?.method !== "POST") throw HttpError.createMethodNotAllowedPostOnly();
        
        const data = await this.checkAuthAndPermission();

        return createJsonResponse({
            success: true,
            user: data,
            limits: {
                discordInviteCode: this.env.DISCORD_INVITE,
            },
            idToken: this.authorization
        });
    }

    /**
     * 名簿データ一覧を返す (部員内であっても取り扱いに注意すること)
     */
    public async members() {
        if (!this.members_googlesheets) throw HttpError.createInternalServerError("GoogleSheets service of members not initialized");
        
        await this.checkAuthAndPermission();

        const members = await this.members_googlesheets.getMembersWithCache();
        const response = createJsonResponse(members);

        return response;
    }

    /**
     * パーミッションチェック
     */
    public async hasPermission() {
        const studentId = this.url?.searchParams.get("id");
        if (!studentId) throw HttpError.createBadRequest("param has not id");

        await this.checkPermission(studentId);

        return new Response("yes");
    }

    /**
     * ユーザの名簿データを返す
     */
    public async memberMe() {
        if (!this.members_googlesheets) throw HttpError.createInternalServerError("GoogleSheets service of members not initialized");
        
        const data = await this.checkAuth();

        let studentId = data.email.split("@")[0];
        const member: any = await this.members_googlesheets.getMemberWithCache(studentId);

        return createJsonResponse(member);
    }

    /**
     * 部員数を取得する
     */
    public async memberCount() {
        if (!this.members_googlesheets) throw HttpError.createInternalServerError("GoogleSheets service of members not initialized");

        const rows = await this.members_googlesheets.getMembersWithCache();
        return createJsonResponse(rows.length);
    }
        

    /**
     * GitHub Organizationに招待する
     */
    public async githubInvite() {
        if (this.request?.method !== "POST") throw HttpError.createMethodNotAllowedPostOnly();
        
        await this.checkAuthAndPermission();

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

        await this.checkAuthAndPermission();

        return createJsonResponse({ code: this.env.DISCORD_INVITE, success: true });
    }

    /**
     * GitHub Token の設定
     */
    public async githubToken() {
        const data = await this.checkAuthAndPermission();

        // GET (check exist)
        if (this.request?.method === "GET") {
            const raw = await this.env.USER_CUSTOM.get(data.localId);
            const customData = JSON.parse((raw ?? `{}`));

            if (customData.githubTokenEncoded)
                return createJsonResponse({ success: true, isExist: true });

            return createJsonResponse({ success: true, isExist: false });
        }

        // POST
        if (this.request?.method === "POST" || this.request?.method === "PUT") {
            const raw = await this.env.USER_CUSTOM.get(data.localId);
            const customData = JSON.parse((raw ?? `{}`));

            const { githubToken } = await this.request.json() as { githubToken: string };
            customData.githubTokenEncoded = await encrypt(githubToken, this.env.SECRET_KEY);

            await this.env.USER_CUSTOM.put(data.localId, JSON.stringify(customData, null, 2));
            await logInfo(this.request, this.env, "portal", `set github token to ${data.localId}`);

            return createJsonResponse({ success: true });
        }

        // DELETE
        if (this.request?.method === "DELETE") {
            const raw = await this.env.USER_CUSTOM.get(data.localId);
            const customData = JSON.parse((raw ?? `{}`));

            delete customData.githubTokenEncoded;

            await this.env.USER_CUSTOM.put(data.localId, JSON.stringify(customData, null, 2));

            await logInfo(this.request, this.env, "portal", `delete github token from ${data.localId}`);

            return createJsonResponse({ success: true });
        }

        return createJsonResponse({ success: false });
    }
}
