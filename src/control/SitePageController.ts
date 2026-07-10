import { CustomHttpError } from "../util/CustomHttpError";
import { HttpError } from "../util/HttpError";
import { Permission } from "../util/permission";
import { GitHubService } from "../util/service/github";
import { b64ToStr, createJsonResponse, logInfo } from "../util/utils";
import { IController } from "./IController";

/**
 * サイト本体 (Next.js) の固定ページ。
 * blog リポジトリを見る BlogController の update-static とは別物で、
 * こちらは osu-denken.github.io の content/ を書き換えて再ビルドを起こす。
 */
export class SitePageController extends IController {
    public getParentPath(): string {
        return "site-pages";
    }

    public constructor(path: string[]) {
        super(path);
        if (path.length < 2) path[1] = "list";
    }

    public route() {
        switch (this.path[1]) {
            case "list":
                return this.list();
            case "get":
                return this.getFile();
            case "update":
                return this.updateFile();
        }

        throw HttpError.createNotFound("Endpoint not found");
    }

    private get service(): GitHubService {
        if (!this.github) throw HttpError.createInternalServerError("GitHub service not initialized");
        return this.github;
    }

    /**
     * 許可リストに載っているパスだけを通す
     * @param path リポジトリのルートからのパス
     */
    private requirePath(path: string | null | undefined): string {
        if (!path) throw HttpError.createBadRequest("path is required");
        if (!GitHubService.isEditableSiteFile(path))
            throw HttpError.createBadRequest("Not an editable site file");

        return path;
    }

    /**
     * 編集できるファイルの一覧
     */
    public async list() {
        await this.checkAuthAndPermission(Permission.PageEdit);

        return createJsonResponse({ success: true, files: GitHubService.editableSiteFiles() });
    }

    /**
     * ファイルの中身を取得する
     */
    public async getFile() {
        await this.checkAuthAndPermission(Permission.PageEdit);

        const path = this.requirePath(this.url?.searchParams.get("path"));

        const res: any = await this.service.getSiteFile(path);
        const file: any = await res.json();

        if (!file.content) throw new CustomHttpError(404, "NOT_FOUND", "Site file not found", file);

        let content = file.content;
        if (file.encoding === "base64") content = b64ToStr(content);

        return createJsonResponse({ path, sha: file.sha, size: file.size, content });
    }

    /**
     * ファイルを更新し、サイトを再ビルドさせる
     */
    public async updateFile() {
        if (this.request?.method !== "POST") throw HttpError.createMethodNotAllowedPostOnly();

        const { user: data } = await this.checkAuthAndPermission(Permission.PageEdit);

        const { path: rawPath, content } = await this.request.json() as { path?: string; content?: string };

        const path = this.requirePath(rawPath);
        if (!content) throw HttpError.createBadRequest("content is required");

        // 壊れた JSON を載せるとサイトのビルドごと落ちる
        if (path.endsWith(".json")) SitePageController.requireValidJson(content);

        await this.service.useUserGitHubToken(this.env, data.localId);

        const res = await this.service.updateSiteFile(path, content);
        if (!res.ok) throw new CustomHttpError(500, "INTERNAL_SERVER_ERROR", "GitHub update failed", await res.text());

        const result: any = await res.json();
        result.success = true;

        // コミットが載ってから再ビルドさせる。順序が逆だと古い内容が公開されうる。
        // 利用者の PAT には workflow 権限がないことがあるため、既定のトークンで起動する
        const dispatched = await new GitHubService(this.env.GITHUB_TOKEN).dispatchSiteBuild();
        result.rebuildTriggered = dispatched.ok;

        if (!dispatched.ok) console.error("Failed to dispatch site build:", dispatched.status, await dispatched.text());

        await logInfo(this.request, this.env, "site_page_update", `Update site file "${path}" by ${data.localId}`);

        return createJsonResponse(result);
    }

    private static requireValidJson(content: string): void {
        try {
            JSON.parse(content);
        } catch (e: any) {
            throw HttpError.createBadRequest(`Invalid JSON: ${e?.message}`);
        }
    }
}
