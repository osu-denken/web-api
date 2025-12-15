import { HttpError } from "../util/HttpError";
import { FirebaseService } from "../util/service/firebase";
import { GitHubService } from "../util/service/github";
import { MembersGSheetsService } from "../util/service/members-gs";

export abstract class IController {
    public path: string[];
    public firebase: FirebaseService | null = null;
    public github: GitHubService | null = null;
    public members_googlesheets: MembersGSheetsService | null = null;

    public request: Request | null = null;
    public authorization: string | null = null;
    public env: any = null;
    public url: URL | null = null;

    public ctx: any = null;

    public abstract getParentPath(): string;

    constructor(path: string[]) {
        this.path = path;
    }

    /**
     * ルーティング
     */
    public abstract route() : Promise<any> | any;
    
    private async isJsonBody(body: unknown) {
        return body !== null && typeof body === "object";
    }

    public async toResponse() {
        const res = await this.route();
        if (res instanceof Response)
            return res;

        return new Response(res, {
            status: 200,
        });
    }

    public setServices(firebase: FirebaseService | null, github: GitHubService | null, members_googlesheets: MembersGSheetsService | null) {
        this.firebase = firebase;
        this.github = github;
        this.members_googlesheets = members_googlesheets;
    }

    public setRequest(request: Request) {
        this.request = request;
    }

    public setAuthorization(authorization: string | null) {
        
        this.authorization = authorization;
        if (this.authorization == null) return;
 
        this.authorization = this.authorization.replace("Bearer ", "");
    }

    public setEnv(env: any) {
        this.env = env;
    }

	public setUrl(url: URL) {
        this.url = url;
	}

    public setCtx(ctx: any) {
        this.ctx = ctx;
    }
    
    /**
     * 権限があるか、なければエラーを出す
     * @param studentId 学籍番号
     */
    public async checkPermission(studentId: string) {
        if (!this.members_googlesheets) throw HttpError.createInternalServerError("GoogleSheets service of members not initialized");

        const member: any = await this.members_googlesheets.hasPermission(studentId);
        if (member.permit !== "1") throw HttpError.createForbidden("You are not have permissions");
    }

    /**
     * 権限があるか、なければエラーを出す
     * @param email 大学付与のメールアドレス
     */
    public async checkPermissionByEmail(email: string) {
        if (!email.endsWith("@ge.osaka-sandai.ac.jp")) throw HttpError.createBadRequest("Email must be from ge.osaka-sandai.ac.jp domain");

        const member: any = await this.members_googlesheets?.hasPermissionByEmail(email);
        if (member.permit !== "1") throw HttpError.createForbidden("You are not have permissions");
    }
}