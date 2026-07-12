import { HttpError } from "../util/HttpError";
import { ROSTER_STATUSES, toPublicMember } from "../util/member";
import { Permission } from "../util/permission";
import { UserCustomService } from "../util/service/user-custom";
import { createJsonResponse } from "../util/utils";
import { IController } from "./IController";

/**
 * 部員ポータルのエンドポイント。ポータル情報・名簿・Discord 招待を扱う。
 * GitHub 連携は GitHubController に分けた。
 */
export class PortalController extends IController {
    public getParentPath(): string {
        return "portal";
    }

    public route() {
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

        return createJsonResponse({ success: false });
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
}
