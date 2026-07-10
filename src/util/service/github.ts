import { HttpError } from "../HttpError";
import { toBase64 } from "../utils";
import { GitHubBlogClient } from "./github-blog";
import { BRANCH, OWNER } from "./github-client";

/** fake terminal のリポジトリ。サイト側にはサブモジュールとして取り込まれている */
const TERMINAL_REPO = "ecrd-fake-terminal";

/** サイト本体のリポジトリ。ビルドを起動するために叩く */
const SITE_REPO = "osu-denken.github.io";
const SITE_WORKFLOW = "deploy.yml";

/** 管理画面から編集してよい fake terminal のファイル */
const TERMINAL_EDITABLE_FILES = ["welcome.md", "welcome-log.md"];

/**
 * 管理画面から編集してよいサイト本体のファイル。
 * 任意のパスを書けるようにするとリポジトリ全体を書き換えられるため、必ずここで固定する
 */
const SITE_EDITABLE_FILES = ["content/pages/about.md", "content/pages/access.md", "content/works.json"];

/**
 * サイト本体と fake terminal のコンテンツ、および Organization への招待。
 * blog リポジトリの操作は GitHubBlogClient が持つ。
 */
export class GitHubService extends GitHubBlogClient {
    public async inviteOrganization(email: string) {
        const url = `https://api.github.com/orgs/${OWNER}/invitations`;

        const res = await fetch(url, {
            method: "POST",
            headers: {
                "Authorization": `token ${this.token}`,
                "Content-Type": "application/json",
                "Accept": "application/vnd.github+json",
                "User-Agent": "osu-denken-admin-cloudflare-worker"
            },
            body: JSON.stringify({
                email,
                role: "direct_member"
            })
        });

        return res;
    }

    /**
     * fake terminal の編集対象として許可されたファイルかどうか
     * @param filename ファイル名 (.md を含む)
     */
    public static isEditableTerminalFile(filename: string): boolean {
        return TERMINAL_EDITABLE_FILES.includes(filename);
    }

    /**
     * fake terminal のファイルを取得する
     * @param filename ファイル名 (.md を含む)
     */
    public async getTerminalFile(filename: string) {
        if (!GitHubService.isEditableTerminalFile(filename))
            throw new HttpError(400, "INVALID_SLUG", "Not an editable terminal file");

        const res = await this.getFileContent(filename, TERMINAL_REPO);

        if (res.status === 404) throw new HttpError(404, "NOT_FOUND", "Terminal file not found");

        return res;
    }

    /**
     * fake terminal のファイルを更新する
     * @param filename ファイル名 (.md を含む)
     * @param content ソース
     * @param message コミットメッセージ
     */
    public async updateTerminalFile(filename: string, content: string, message: string = "Update terminal file via Cloudflare Worker") {
        if (!GitHubService.isEditableTerminalFile(filename))
            throw new HttpError(400, "INVALID_SLUG", "Not an editable terminal file");

        return this.uploadFile(filename, toBase64(content), message, undefined, TERMINAL_REPO);
    }

    /**
     * 管理画面から編集してよいサイト本体のファイルか
     * @param path リポジトリのルートからのパス
     */
    public static isEditableSiteFile(path: string): boolean {
        return SITE_EDITABLE_FILES.includes(path);
    }

    /** 編集してよいサイト本体のファイルの一覧 */
    public static editableSiteFiles(): readonly string[] {
        return SITE_EDITABLE_FILES;
    }

    /**
     * サイト本体のファイルを取得する
     * @param path リポジトリのルートからのパス
     */
    public async getSiteFile(path: string) {
        if (!GitHubService.isEditableSiteFile(path))
            throw new HttpError(400, "INVALID_SLUG", "Not an editable site file");

        const res = await this.getFileContent(path, SITE_REPO);

        if (res.status === 404) throw new HttpError(404, "NOT_FOUND", "Site file not found");

        return res;
    }

    /**
     * サイト本体のファイルを更新する
     * @param path リポジトリのルートからのパス
     * @param content ソース
     * @param message コミットメッセージ
     */
    public async updateSiteFile(path: string, content: string, message: string = "Update site page via Cloudflare Worker") {
        if (!GitHubService.isEditableSiteFile(path))
            throw new HttpError(400, "INVALID_SLUG", "Not an editable site file");

        return this.uploadFile(path, toBase64(content), message, undefined, SITE_REPO);
    }

    /**
     * サイトの再ビルドを起動する。
     * サブモジュールは --remote で main の先頭を取り込むため、これで編集内容が公開される
     */
    public async dispatchSiteBuild() {
        const url = `https://api.github.com/repos/${OWNER}/${SITE_REPO}/actions/workflows/${SITE_WORKFLOW}/dispatches`;

        return fetch(url, {
            method: "POST",
            headers: {
                "Authorization": `token ${this.token}`,
                "Content-Type": "application/json",
                "Accept": "application/vnd.github+json",
                "User-Agent": "osu-denken-admin-cloudflare-worker"
            },
            body: JSON.stringify({ ref: BRANCH })
        });
    }
}
