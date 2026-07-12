import { HttpError } from "../util/HttpError";
import { ROSTER_STATUSES, toPublicMember } from "../util/member";
import { Permission } from "../util/permission";
import { UserCustomService } from "../util/service/user-custom";
import { createJsonResponse, encrypt, logInfo } from "../util/utils";
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
            if (this.path[1] === "join") return this.githubJoin();
            if (this.path[1] === "token") return this.githubToken();
        }


        if (this.path[0] === "discord" && this.path[1] === "invite") return this.discordInvite();

        if (this.path[0] !== "portal")
            throw HttpError.createNotFound("Endpoint not found");

        if (this.path.length === 1) return this.portal();
        if (this.path[1] === "members") return this.memberList();
        if (this.path[1] === "memberCount") return this.memberCount();
        if (this.path[1] === "member" && this.path[2] === "me") return this.memberMe();

        if (this.path[1] === "univLimit") return this.limitedInfoAtUniv();

        throw HttpError.createNotFound("Endpoint not found");
    }

    private get userCustom(): UserCustomService {
        return new UserCustomService(this.env);
    }

    /**
     * 部員ポータル用にまとめた情報を返す
     */
    public async portal() {
        if (this.request?.method !== "POST") throw HttpError.createMethodNotAllowedPostOnly();

        const auth = await this.checkAuthAndPermission(Permission.DiscordInviteView);
        const customData = await this.userCustom.get(auth.user.localId);

        return createJsonResponse({
            success: true,
            user: auth.user,
            permissions: auth.permissions,
            roleBits: auth.member.roleBits,
            limits: {
                discordInviteCode: this.env.DISCORD_INVITE,
            },
            hasGitHubToken: Boolean(customData.githubTokenEncoded),
            hasTotp: Boolean(customData.totp),
            recoveryCodesLeft: customData.totp?.recoveryCodeHashes.length ?? 0
        });
    }

    /**
     * 大学のIPアドレスである場合の情報を返す
     */
    public async limitedInfoAtUniv() {

        const ip = this.request?.headers.get("CF-Connecting-IP");
        if (ip?.startsWith("133.64.")) {
            // 大学のIPであることが確認
            return createJsonResponse({
                success: true,
                limits: {
                    discordInviteCode: this.env.DISCORD_INVITE,
                }
            });
        }

        return createJsonResponse({
            success: false
        })
    }

    /**
     * 名簿データ一覧を返す (部員内であっても取り扱いに注意すること)
     */
    public async memberList() {
        if (!this.members) throw HttpError.createInternalServerError("Member repository not initialized");

        await this.checkAuthAndPermission(Permission.MemberView);

        // 仮登録と却下は名簿に出さない。承認は部員管理で行う
        const rows = await this.members.listByStatuses(ROSTER_STATUSES);

        return createJsonResponse(rows.map(toPublicMember));
    }

    /**
     * ユーザの名簿データを返す
     */
    public async memberMe() {
        const auth = await this.resolveAuth();

        return createJsonResponse(auth.member);
    }

    /**
     * 部員数を取得する
     */
    public async memberCount() {
        if (!this.members) throw HttpError.createInternalServerError("Member repository not initialized");

        return createJsonResponse(await this.members.countActive());
    }


    /**
     * GitHub Organizationに招待する
     */
    public async githubInvite() {
        if (this.request?.method !== "POST") throw HttpError.createMethodNotAllowedPostOnly();

        await this.checkAuthAndPermission(Permission.MemberManage);

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
     * 部員が自分の GitHub アカウント名を指定して Organization への招待を受け取る。
     * 幹部でなくても、認証済みの部員であれば自分で参加できる。
     */
    public async githubJoin() {
        if (this.request?.method !== "POST") throw HttpError.createMethodNotAllowedPostOnly();

        // 認証済みの部員であることだけ確認する (特別な権限は不要)
        const auth = await this.resolveAuth();

        const { username } = await this.request.json() as { username: string };
        const name = username?.trim();
        if (!name) throw new HttpError(400, "BAD_REQUEST", "username is required");

        // GitHub のユーザー名は英数字とハイフン、先頭末尾はハイフン不可、1〜39文字
        if (!/^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$/.test(name))
            throw new HttpError(400, "BAD_REQUEST", "Invalid GitHub username");

        const res = await this.github?.inviteOrganizationByUsername(name);
        if (!res) throw new HttpError(500, "INTERNAL_SERVER_ERROR", "GitHub service not available");

        const data: any = await res.json();

        if (!res.ok)
            throw new HttpError(res.status, res.statusText, data.message || "GitHub invite failed");

        await logInfo(this.request, this.env, "github_join",
            `Invite "${name}" to org by ${auth.member.email} (#${auth.member.id})`);

        return createJsonResponse({
            success: true,
            username: name,
            state: data.state ?? "pending"
        });
    }

    /**
     * Discordの招待コードを返す
     */
    public async discordInvite() {
        const ip = this.request?.headers.get("CF-Connecting-IP");
        if (!ip?.startsWith("133.64.")) {
            if (this.request?.method !== "POST") throw HttpError.createMethodNotAllowedPostOnly();
            await this.checkAuthAndPermission(Permission.DiscordInviteView);
        }

        return createJsonResponse({ code: this.env.DISCORD_INVITE, success: true });
    }

    /**
     * GitHub Token の設定
     */
    public async githubToken() {
        const auth = await this.checkAuthAndPermission(Permission.BlogEdit);

        switch (this.request?.method) {
            case "GET":
                return await this.getGitHubToken(auth.user.localId);
            case "POST":
            case "PUT":
                return await this.putGitHubToken(auth.user.localId);
            case "DELETE":
                return await this.deleteGitHubToken(auth.user.localId);
        }

        return createJsonResponse({ success: false });
    }

    private async getGitHubToken(localId: string) {
        const customData = await this.userCustom.get(localId);

        return createJsonResponse({ success: true, isExist: Boolean(customData.githubTokenEncoded) });
    }

    private async putGitHubToken(localId: string) {
        const customData = await this.userCustom.get(localId);

        const { githubToken } = await this.request!.json() as { githubToken: string };
        if (!githubToken) throw HttpError.createBadRequest("githubToken is required");

        customData.githubTokenEncoded = await encrypt(githubToken, this.env.SECRET_KEY);

        await this.userCustom.put(localId, customData);
        await logInfo(this.request!, this.env, "portal", `set github token to ${localId}`);

        return createJsonResponse({ success: true });
    }

    private async deleteGitHubToken(localId: string) {
        const customData = await this.userCustom.get(localId);

        delete customData.githubTokenEncoded;

        await this.userCustom.put(localId, customData);
        await logInfo(this.request!, this.env, "portal", `delete github token from ${localId}`);

        return createJsonResponse({ success: true });
    }
}
