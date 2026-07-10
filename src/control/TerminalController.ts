import { CustomHttpError } from "../util/CustomHttpError";
import { HttpError } from "../util/HttpError";
import { Permission } from "../util/permission";
import { GitHubService } from "../util/service/github";
import { b64ToStr, createJsonResponse, logInfo } from "../util/utils";
import { IController } from "./IController";

export class TerminalController extends IController {
    public getParentPath(): string {
        return "terminal";
    }

    public constructor(path: string[]) {
        super(path);

        if (path.length < 3) {
            const action = path[1] ?? "get";
            path[0] = "v1";
            path[1] = "terminal";
            path[2] = action;
        }
    }

    public route() {
        if (this.path[2] === "get") return this.getFile();
        if (this.path[2] === "update") return this.updateFile();

        throw HttpError.createNotFound("Endpoint not found");
    }

    /**
     * クエリのページ名をファイル名に直す
     */
    private requireFilename(page: string | null | undefined): string {
        if (!page) throw HttpError.createBadRequest("page is required");

        const filename = `${page}.md`;
        if (!GitHubService.isEditableTerminalFile(filename))
            throw HttpError.createBadRequest("Not an editable terminal file");

        return filename;
    }

    /**
     * fake terminal のファイルを取得する
     */
    public async getFile() {
        if (!this.github) throw HttpError.createInternalServerError("GitHub service not initialized");

        const filename = this.requireFilename(this.url?.searchParams.get("page"));

        const res: any = await this.github.getTerminalFile(filename);
        const file: any = await res.json();

        if (!file.content) throw new CustomHttpError(404, "NOT_FOUND", "Terminal file not found", file);

        let content = file.content;
        if (file.encoding === "base64") content = b64ToStr(content);

        return createJsonResponse({
            name: filename.replace(".md", ""),
            sha: file.sha,
            size: file.size,
            content
        });
    }

    /**
     * fake terminal のファイルを更新し、サイトを再ビルドさせる
     */
    public async updateFile() {
        if (!this.github) throw HttpError.createInternalServerError("GitHub service not initialized");
        if (this.request?.method !== "POST") throw HttpError.createMethodNotAllowedPostOnly();

        const { user: data } = await this.checkAuthAndPermission(Permission.PageEdit);

        const filename = this.requireFilename(this.request.headers.get("page"));
        const content = this.request.headers.get("content") || await this.request.text();

        if (!content) throw HttpError.createBadRequest("content is required");

        await this.github.useUserGitHubToken(this.env, data.localId);

        const res = await this.github.updateTerminalFile(filename, content);
        if (!res.ok) throw new CustomHttpError(500, "INTERNAL_SERVER_ERROR", "GitHub update failed", await res.text());

        const result: any = await res.json();
        result.success = true;

        // コミットが載ってから再ビルドさせる。順序が逆だと古い内容が公開されうる。
        // 利用者の PAT には workflow 権限がないことがあるため、既定のトークンで起動する
        const dispatched = await new GitHubService(this.env.GITHUB_TOKEN).dispatchSiteBuild();
        result.rebuildTriggered = dispatched.ok;

        if (!dispatched.ok) console.error("Failed to dispatch site build:", dispatched.status, await dispatched.text());

        await logInfo(this.request, this.env, "terminal_update", `Update terminal file "${filename}" by ${data.localId}`);

        return createJsonResponse(result);
    }
}
