import { CustomHttpError } from "../CustomHttpError";
import { HttpError } from "../HttpError";
import { Env } from "../types";
import { decrypt } from "../utils";

export const OWNER = "osu-denken";
export const REPO = "blog";
export const BRANCH = "main";

/**
 * GitHub Contents API の薄いラッパ。
 * どのリポジトリのどのファイルを触るかは、これを継承した側が決める。
 */
export class GitHubClient {
    protected token: string;

    public constructor(token: string) {
        this.token = token;
    }

    protected async request(url: string, method: string, body?: any) {
        const headers: Record<string, string> = {
            "Authorization": `token ${this.token}`,
            "Content-Type": "application/json",
            "User-Agent": "osu-denken-admin-cloudflare-worker"
        };

        return fetch(url, {
            method,
            headers,
            body: body ? JSON.stringify(body) : undefined
        });
    }

    /**
     * ディレクトリトラバーサル対策
     * @param path ページ名
     * @param denySlash スラッシュ / を拒否するかどうか
     */
    protected static async checkSafePath(path: string, denySlash: boolean = false) {
        // / を拒否
        if (denySlash && path.includes("/"))
            throw new HttpError(400, "INVALID_SLUG", "Using slash in slug is deny");

        // ../ を拒否
        if (path.includes(".."))
            throw new HttpError(400, "INVALID_SLUG", "Path traversal detected");
    }

    /**
     * ファイルをアップロードする
     * @param path パス
     * @param contentBase64 base64エンコードしたデータ
     * @param message コミットメッセージ
     * @param sha ハッシュ値
     * @returns
     */
    public async uploadFile(path: string, contentBase64: string, message: string = "Upload file via Cloudflare Worker", sha?: string, repo: string = REPO) {
        const url = `https://api.github.com/repos/${OWNER}/${repo}/contents/${path}`
        const body: { message: string; content: string; branch: string; sha?: string } = {
            message: message,
            content: contentBase64,
            branch :BRANCH
        };

        if (sha) {
            body.sha = sha;
        } else {
            const req = await this.request(url, "GET");
            if (req.status === 200) {
                const data = await req.json() as { sha: string };
                body.sha = data.sha;
            }
        }

        return this.request(url, "PUT", body);
    }

    /**
     * ファイルを削除する
     * @param path ファイルパス
     * @param sha ハッシュ値
     * @param message コミットメッセージ
     */
    public async deleteFile(path: string, sha?: string, message: string = "Delete file via Cloudflare Worker") {
        if (!sha) sha = await this.getSha(path);

        const url = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}`;
        const body = { message, sha, branch: BRANCH };

        return this.request(url, "DELETE", body);
    }

    /**
     * ファイルを取得する
     * @param path ファイルパス
     */
    public async getFileContent(path: string, repo: string = REPO) {
        return this.request(`https://api.github.com/repos/${OWNER}/${repo}/contents/${path}`, "GET");
    }

    /**
     * ファイルの SHA を取得する
     * @param path ファイルパス
     */
    private async getSha(path: string): Promise<string> {
        const res: any = await this.getFileContent(path);
        if (!res.ok)
            throw new CustomHttpError(res.status, "NOT_FOUND", "File not found", await res.text());

        const data = await res.json() as { sha: string };
        return data.sha;
    }

    /**
     * GitHub Token の取得 (機密情報であるため、扱いには気を付けるやうに)
     * @param env 環境変数群
     * @param localId Firebase Local ID
     * @returns github token or null
     */
    private async getGitHubToken(env: Env, localId: string): Promise<string | null> {
        const raw = await env.USER_CUSTOM.get(localId);
        if (!raw) return null;

        const customData = JSON.parse(raw);
        if (!customData.githubTokenEncoded) return null;

        try {
            return await decrypt(customData.githubTokenEncoded, env.SECRET_KEY);
        } catch {
            return null;
        }
    }

    /**
     * ユーザーが設定しているGitHub Tokenを利用する
     * @param env 環境変数群
     * @param localId Firebase Local ID
     */
    public async useUserGitHubToken(env: Env, localId: string) {
        const token = await this.getGitHubToken(env, localId);
        if (token)
            this.token = token;
    }

    /**
     * 指定したトークンの持ち主の GitHub ログイン名を取得する。
     * this.token は変更しない (招待は管理トークンで行うため)。
     * @param token ユーザーの GitHub トークン
     * @returns ログイン名。取得できなければ null
     */
    public async getLoginForToken(token: string): Promise<string | null> {
        const res = await fetch("https://api.github.com/user", {
            headers: {
                "Authorization": `token ${token}`,
                "Accept": "application/vnd.github+json",
                "User-Agent": "osu-denken-admin-cloudflare-worker"
            }
        });

        if (!res.ok) return null;

        const data = await res.json() as { login?: string };
        return data.login ?? null;
    }
}
