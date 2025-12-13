import { CustomHttpError } from "../util/CustomHttpError";
import { HttpError } from "../util/HttpError";
import { base642txt, parseFrontMatter, txt2base64 } from "../util/utils";

const OWNER = "osu-denken";
const REPO = "blog";
const BRANCH = "main";

export class GitHubService {
    private token: string;

    constructor(token: string) {
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

    async getList() {
        try {
            const url = `https://api.github.com/repos/${OWNER}/${REPO}/contents/_posts`;
            const res = await this.request(url, "GET");

            if (res.status === 404) throw new HttpError(404, "NOT_FOUND", "All posts not found");

            return res;
        } catch (e) {
            return Promise.reject(e);
        }
    }

    /**
     * 
     * @param path  パス .mdを含む
     */
    async getPostRaw(path: string) {
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
     * split content and meta
     * @param slug ページ名
     * @returns 記事データ
     */
    async getPost(slug: string) {
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

    async updatePost(path: string, content: string, message: string, sha?: string) {
        try {
            const url = `https://api.github.com/repos/${OWNER}/${REPO}/contents/_posts/${path}`;
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
    
    async inviteOrganization(email: string) {
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