import { CustomHttpError } from "../CustomHttpError";
import { HttpError } from "../HttpError";
import { Env } from "../types";
import { b64ToStr, decrypt, toBase64, parseFrontMatter } from "../utils";

const OWNER = "osu-denken";
const REPO = "blog";
const BRANCH = "main";

/** fake terminal のリポジトリ。サイト側にはサブモジュールとして取り込まれている */
const TERMINAL_REPO = "ecrd-fake-terminal";

/** サイト本体のリポジトリ。ビルドを起動するために叩く */
const SITE_REPO = "osu-denken.github.io";
const SITE_WORKFLOW = "deploy.yml";

/** 管理画面から編集してよい fake terminal のファイル */
const TERMINAL_EDITABLE_FILES = ["welcome.md", "welcome-log.md"];

export class GitHubService {
    private token: string;

    public constructor(token: string) {
        this.token = token;
    }

    private async request(url: string, method: string, body?: any) {
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
    private static async checkSafePath(path: string, denySlash: boolean = false) {
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
     * 記事ページの一覧
     */
    public async getPostList() {
        const res = await this.getFileContent("_posts");

        if (res.status === 404)
            throw new HttpError(404, "NOT_FOUND", "All posts not found");

        return res;
    }

    /**
     * 固定ページの一覧
     */
    public async getStaticPageList() {
        const res = await this.getFileContent("");

        if (res.status === 404)
            throw new HttpError(404, "NOT_FOUND", "All files not found");

        return res;
    }

    /**
     * 
     * @param path パス .mdを含む
     */
    public async getPostRaw(path: string) {
        await GitHubService.checkSafePath(path);

        const res = await this.getFileContent(`_posts/${path}`);

        if (res.status === 404) throw new HttpError(404, "NOT_FOUND", "Post not found");
        return res;
    }

    /**
     * 固定ページの取得
     * @param path 固定ページのパス .mdを含む
     * @returns ソース
     */
    public async getStaticPageRaw(path: string) {
        await GitHubService.checkSafePath(path);

        const res: any = await this.getFileContent(`${path}`);

        if (res.status === 404) 
            throw new HttpError(404, "NOT_FOUND", "Static page not found");

        return await res.json();
    }

    /**
     * split content and meta
     * @param slug ページ名
     * @returns 記事データ
     */
    public async getPost(slug: string) {
        const filename = `${slug}.md`;

        const res: any = await this.getPostRaw(filename);
        const post: any = await res.json();

        if (!post.content) throw new CustomHttpError(404, "NOT_FOUND", "Post not found", post);
        
        let source = post.content;
        if (post.encoding && post.encoding === "base64")
            source = b64ToStr(source);

        const parsed = parseFrontMatter(source);

        post.content = parsed.content;
        post.meta = parsed.meta;

        return post;
    }

    /**
     * 固定ページの更新
     * @param slug ページ名
     * @param content ソース
     * @param message コミットメッセージ
     * @param sha ハッシュ値
     * @returns 
     */
    public async updateStaticPage(slug: string, content: string, message: string = "Update static page via Cloudflare Worker", sha?: string) {
        await GitHubService.checkSafePath(slug, true);

        return this.uploadFile(`${slug}.md`, toBase64(content), message, sha);
    }

    /**
     * 記事ページの更新
     * @param slug ページ名
     * @param content ソース
     * @param message コミットメッセージ
     * @param sha ハッシュ値
     * @returns 
     */
    public async updatePost(slug: string, content: string, message: string = "Update post via Cloudflare Worker", sha?: string) {
        await GitHubService.checkSafePath(slug);

        return this.uploadFile(`_posts/${slug}.md`, toBase64(content), message, sha);
    }
    
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
     * 画像の一覧 (images/)
     */
    public async getImageList() {
        const res = await this.getFileContent("images");

        if (res.status === 404)
            throw new HttpError(404, "NOT_FOUND", "Image directory not found");

        return res;
    }

    /**
     * 画像をアップロードする (images/)
     * @param filename ファイル名
     * @param contentBase64 base64エンコードしたデータ
     * @param message コミットメッセージ
     * @returns 
     */
    public async uploadImage(filename: string, contentBase64: string, message: string = "Upload image via Cloudflare Worker") {
        await GitHubService.checkSafePath(filename, true);
        return this.uploadFile(`images/${filename}`, contentBase64, message);
    }

    /**
     * 画像を削除する
     * @param filename images/ 配下のファイル名
     * @param sha GitHub 上の SHA
     * @param message コミットメッセージ
     */
    public async deleteImage(filename: string, sha?: string, message: string = "Delete image via Cloudflare Worker") {
        await GitHubService.checkSafePath(filename, true);
        return this.deleteFile(`images/${filename}`, sha, message);
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
     * 記事ページの削除
     */
    public async deletePost(slug: string, message: string = "Delete post via Cloudflare Worker") {
        await GitHubService.checkSafePath(slug);
        return this.deleteFile(`_posts/${slug}.md`, undefined, message);
    }

    /**
     * 固定ページの削除
     */
    public async deleteStaticPage(slug: string, message: string = "Delete static page via Cloudflare Worker") {
        await GitHubService.checkSafePath(slug, true);
        return this.deleteFile(`${slug}.md`, undefined, message);
    }
}