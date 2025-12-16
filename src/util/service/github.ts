import { CustomHttpError } from "../CustomHttpError";
import { HttpError } from "../HttpError";
import { base642txt, parseFrontMatter, txt2base64 } from "../utils";

const OWNER = "osu-denken";
const REPO = "blog";
const BRANCH = "main";

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
        // 英数字ハイフンスラッシュのみを許可する
        // if (!/^[a-zA-Z0-9\-\/]+$/.test(slug))
        //     throw new HttpError(400, "INVALID_SLUG", "Invalid slug");

        // / を拒否
        if (denySlash && path.includes("/")) 
            throw new HttpError(400, "INVALID_SLUG", "Using slash in slug is deny");
        

        // ../ を拒否
        if (path.includes(".."))
            throw new HttpError(400, "INVALID_SLUG", "Path traversal detected");
    }

    /**
     * 記事ページの一覧
     */
    public async getPostList() {
        try {
            const url = `https://api.github.com/repos/${OWNER}/${REPO}/contents/_posts`;
            const res = await this.request(url, "GET");

            if (res.status === 404)
                throw new HttpError(404, "NOT_FOUND", "All posts not found");

            return res;
        } catch (e) {
            return Promise.reject(e);
        }
    }

    /**
     * 固定ページの一覧
     */
    public async getStaticPageList() {
        try {
            const url = `https://api.github.com/repos/${OWNER}/${REPO}/contents`;
            const res = await this.request(url, "GET");

            if (res.status === 404)
                throw new HttpError(404, "NOT_FOUND", "All files not found");

            return res;
        } catch (e) {
            return Promise.reject(e);
        }
    }

    /**
     * 
     * @param path パス .mdを含む
     */
    public async getPostRaw(path: string) {
        await GitHubService.checkSafePath(path);

        try {
            const url = `https://api.github.com/repos/${OWNER}/${REPO}/contents/_posts/${path}`;
            const res = await this.request(url, "GET");

            if (res.status === 404) throw new HttpError(404, "NOT_FOUND", "Post not found");

            return res;
        } catch (e) {
            return Promise.reject(e);
        }
    }

    /**
     * 固定ページの取得
     * @param path 固定ページのパス .mdを含む
     * @returns ソース
     */
    public async getStaticPageRaw(path: string) {
        await GitHubService.checkSafePath(path);

        const url = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}`;
        const res = await this.request(url, "GET");

        if (res.status === 404) 
            throw new HttpError(404, "NOT_FOUND", "Static page not found");

        const page: any = await res.json();
        
        let source = page.content;
        if (page.encoding && page.encoding === "base64")
            source = base642txt(source);

        return page;
    }

    /**
     * split content and meta
     * @param slug ページ名
     * @returns 記事データ
     */
    public async getPost(slug: string) {
        const filename = `${slug}.md`;

        const res = await this.getPostRaw(filename);
        const post: any = await res.json();

        if (!post.content) throw new CustomHttpError(404, "NOT_FOUND", "Post not found", post);
        
        let source = post.content;
        if (post.encoding && post.encoding === "base64")
            source = base642txt(source);

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

        const filename = `${slug}.md`;

        try {
            const url = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${filename}`;
            const body: { message: string; content: string; branch: string; sha?: string } = {
                message,
                content: txt2base64(content),
                branch: BRANCH
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
        } catch (e) {
            return Promise.reject(e);
        }
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

        const filename = `${slug}.md`;

        try {
            const url = `https://api.github.com/repos/${OWNER}/${REPO}/contents/_posts/${filename}`;
            const body: { message: string; content: string; branch: string; sha?: string } = {
                message,
                content: txt2base64(content),
                branch: BRANCH
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
        } catch (e) {
            return Promise.reject(e);
        }
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
}