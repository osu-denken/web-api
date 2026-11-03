import { CustomHttpError } from "../util/CustomHttpError";
import { HttpError } from "../util/HttpError";
import { Permission } from "../util/permission";
import { b64ToStr, createFrontMatter, createJsonResponse, logInfo, parseFrontMatter } from "../util/utils";
import { IController } from "./IController";
import { DENKEN_TARGET } from "../util/service/github-client";

/** POST /v2/blog/update の本文 */
interface UpdateBody {
    page?: string;
    meta?: Record<string, any>;
    content?: string;
}

export class BlogController extends IController {
    /** メタデータのキャッシュのキーに付ける保存先の名前（既定は空） */
    private cachePrefix = "";

    /**
     * x-blog-target ヘッダーで保存先を選ぶ。ヘッダーが無ければ旧 blog（既定）
     */
    private applyTarget() {
        const name = this.request?.headers.get("x-blog-target");
        if (!name) return;
        if (name !== "denken") throw HttpError.createBadRequest("Unknown blog target");

        this.github?.setTarget(DENKEN_TARGET);
        this.cachePrefix = "denken:";
    }
    public getParentPath(): string {
        return "blog";
    }

    public constructor(path: string[]) {
        super(path);

        if (path.length < 3) {
            const action = path[1] ?? "list";
            path[0] = "v2";
            path[1] = "blog";
            path[2] = action;
        }
    }

    public route() {
        this.applyTarget();

        if (this.path[0] === "v1") {
            if (this.path[2] === "list") return this.getListV1();
            if (this.path[2] === "get") return this.getPostV1();
            if (this.path[2] === "get-static") return this.getStaticPageV1();
            if (this.path[2] === "update") return this.updatePostV1();
            if (this.path[2] === "update-static") return this.updateStaticPageV1();
        }

        if (this.path[0] === "v2") {
            if (this.path[2] === "list") return this.getPostList();
            if (this.path[2] === "list-static") return this.getStaticPageList();
            if (this.path[2] === "get") return this.getPost();
            if (this.path[2] === "update") return this.updatePost();
            if (this.path[2] === "delete") return this.deletePost();
            if (this.path[2] === "delete-static") return this.deleteStaticPage();
        }

        throw HttpError.createNotFound("Endpoint not found");
    }

    /**
     * 記事ページの一覧を取得する
     * @returns JsonResponse
     */
    public async getPostList() {
        if (!this.github) throw HttpError.createInternalServerError("GitHub service not initialized");

        const res: any = await this.github.getPostList();
        const posts: any[] = await res.json();

        // メタデータは保存先ごとに 1 つの KV にまとめる。変わった記事だけ GitHub から取り直す
        const indexKey = `meta-index:${this.cachePrefix || "blog"}`;
        const index: Record<string, { sha: string; meta: any }> = JSON.parse((await this.env.BLOG_META.get(indexKey)) ?? "{}");
        let changed = false;

        for (const post of posts) {
            if (!post.name.endsWith(".md"))
                continue;

            post.name = post.name.replace(".md", "");

            const hit = index[post.name];
            if (hit && hit.sha === post.sha) {
                post.meta = hit.meta;
                continue;
            }

            // 1本のメタが取れなくても一覧そのものは返す
            try {
                const file = await this.loadPostFile(post.name);
                let content = file?.content ?? "";
                if (file?.encoding === "base64") content = b64ToStr(content);
                post.meta = content ? parseFrontMatter(content).meta || {} : {};
                index[post.name] = { sha: post.sha, meta: post.meta };
                changed = true;
            } catch (e: any) {
                console.error(`Failed to load meta for "${post.name}":`, e?.message);
                post.meta = hit?.meta ?? {};
            }
        }

        // 消えた記事は索引からも消す
        const names = new Set(posts.map(post => post.name));
        for (const key of Object.keys(index)) {
            if (!names.has(key)) {
                delete index[key];
                changed = true;
            }
        }
        if (changed) await this.env.BLOG_META.put(indexKey, JSON.stringify(index));

        return createJsonResponse(
            posts.map(post => ({
                name: post.name,
                sha: post.sha,
                size: post.size,
                meta: post.meta
            }))
        );
    }

    /**
     * 固定ページの一覧を取得する
     * @returns JsonResponse
     */
    public async getStaticPageList() {
        if (!this.github) throw HttpError.createInternalServerError("GitHub service not initialized");

        const res: any = await this.github.getStaticPageList();
        const pages: any[] = await res.json();

        for (const page of pages) {
            if (!page.name.endsWith(".md"))
                continue;
            
            page.name = page.name.replace(".md", "");
            page.meta = await this.getMetaCached(page.name, page, slug => this.loadStaticPageFile(slug));
        }

        return createJsonResponse(
            pages.map(post => ({
                name: post.name,
                sha: post.sha,
                size: post.size,
                meta: post.meta
            }))
        );
    }

    /**
     * 記事ページを取得する
     * @returns JsonResponse
     */
    public async getPost() {
        if (!this.github) throw HttpError.createInternalServerError("GitHub service not initialized");

        const slug = this.url?.searchParams.get("page");
        if (!slug) throw HttpError.createBadRequest("Query parameter 'page' is required");

        const post: any = await this.github.getPost(slug);
        
        const cacheKey = `meta:${this.cachePrefix}${slug}`;
        await this.env.BLOG_META.put(cacheKey, JSON.stringify({ sha: post.sha, meta: post.meta }));

        return createJsonResponse({
            name: post.name,
            sha: post.sha,
            size: post.size,
            meta: post.meta,
            content: post.content,
            raw: post.raw
        });
    }

    /**
     * 記事ページを更新する
     * @returns JsonResponse
     */
    public async updatePost() {
        if (!this.github) throw HttpError.createInternalServerError("GitHub service not initialized");
        if (this.request?.method !== "POST") throw HttpError.createMethodNotAllowedPostOnly();

        const { user: data } = await this.checkAuthAndPermission(Permission.BlogEdit);

        await this.github.useUserGitHubToken(this.env, data.localId);

        // メタデータはヘッダの長さ制限に収まらないことがあるので本文で受け取る
        let body: UpdateBody;
        try {
            body = await this.request.json() as UpdateBody;
        } catch (e) {
            throw HttpError.createBadRequest("Request body is not valid JSON");
        }

        const page = body.page ?? this.request.headers.get("page");
        const { meta, content: _content } = body;

        // text があれば、front matter を含む元のテキストをそのまま保存する（管理画面のエディタ用）
        const text = (body as any).text as string | undefined;
        if (!page || (!text && (!_content || !meta))) throw HttpError.createBadRequest("page and text (or meta and content) are required");

        const content = text ?? createFrontMatter(meta!, _content!);

        const res = await this.github.updatePost(`${page}`, content);
        const data2: any = await res.json();

        data2.success = true;

        await logInfo(this.request, this.env, "blog_update", `Update blog post "${page}" by ${data.localId}`);

        const kvKey = `meta:${page}`;
        await this.env.BLOG_META.put(
            kvKey,
            JSON.stringify({
                sha: data2.content.sha,
                meta: meta
            })
        );
        
        return createJsonResponse(data2);
    }

    /**
     * 記事ページのファイルを取得する
     * @param slug ページ名
     * @returns GitHub Contents API のファイルデータ
     */
    private async loadPostFile(slug: string) {
        const res: any = await this.github!.getPostRaw(`${slug}.md`);

        // GitHub が 5xx を返すと本文は JSON ではない。読む前に弾く
        if (!res.ok) throw new HttpError(502, "BAD_GATEWAY", `GitHub returned ${res.status} for "${slug}"`);

        return await res.json();
    }

    /**
     * 固定ページのファイルを取得する
     * @param slug ページ名
     * @returns GitHub Contents API のファイルデータ
     */
    private async loadStaticPageFile(slug: string) {
        return await this.github!.getStaticPageRaw(`${slug}.md`);
    }

    /**
     * メタデータを取得する
     * @param slug ページ名
     * @param entry 一覧から得たデータ (content を持たないことがある)
     * @param load content を持つファイルデータを取り直す関数
     * @returns メタデータ
     */
    private async getMetaCached(slug: string, entry: any, load: (slug: string) => Promise<any>) {
        const cacheKey = `meta:${this.cachePrefix}${slug}`;
        const cachedStr = await this.env.BLOG_META.get(cacheKey);
        const cached = cachedStr ? JSON.parse(cachedStr) : null;

        // 一覧の sha で先に照合する。ここで返せれば記事の数だけ GitHub を叩かずに済む
        if (cached && entry?.sha && cached.sha === entry.sha) return cached.meta;

        let file = entry;
        if (!file?.content) file = await load(slug);
        if (!file?.content) return {};

        const sha = file.sha;
        if (cached?.sha === sha) return cached.meta;

        let content = file.content;
        if (file.encoding === "base64")
            content = b64ToStr(content);

        if (!content) throw new CustomHttpError(404, "NOT_FOUND", "Content not found", file);
        const meta = parseFrontMatter(content).meta || {};
        await this.env.BLOG_META.put(cacheKey, JSON.stringify({ sha, meta }));

        return meta;
    }

    public async getListV1() {
        if (!this.github) throw HttpError.createInternalServerError("GitHub service not initialized");

        const res: any = await this.github.getPostList();
        const data: any = await res?.json();

        const result = data.map((page: any) => ({
            name: page.name.replace(".md", ""),
            sha: page.sha,
            size: page.size
        }));

        return createJsonResponse(result);
    }
    
    public async getPostV1() {
        if (!this.github) throw HttpError.createInternalServerError("GitHub service not initialized");

        let slug = this.url?.searchParams.get("page") || "";
        if (slug === "") throw HttpError.createBadRequest("Query parameter 'page' is required");
        slug = `${slug}.md`;

        const res: any = await this.github.getPostRaw(slug);
        const post: any = await res.json();

        if (!post.content) throw new CustomHttpError(404, "NOT_FOUND", "Post not found", post);

        let content = post.content;
        if (post.encoding && post.encoding === "base64")
            content = b64ToStr(content);
        
        return createJsonResponse({
            name: slug.replace(".md", ""),
            sha: post.sha,
            size: post.size,
            content: content
        });
    }
    
    public async getStaticPageV1() {
        if (!this.github) throw HttpError.createInternalServerError("GitHub service not initialized");

        let slug = this.url?.searchParams.get("page") || "";
        if (slug === "") throw HttpError.createBadRequest("Query parameter 'page' is required");
        slug = `${slug}.md`;

        const page: any = await this.github.getStaticPageRaw(slug);

        if (!page.content) throw new CustomHttpError(404, "NOT_FOUND", "Static page not found", page);

        let content = page.content;
        if (page.encoding && page.encoding === "base64")
            content = b64ToStr(content);
        
        return createJsonResponse({
            name: slug.replace(".md", ""),
            sha: page.sha,
            size: page.size,
            content: content
        });
    }
    
    public async updatePostV1() {
        if (!this.github) throw HttpError.createInternalServerError("GitHub service not initialized");
        if (this.request?.method !== "POST") throw HttpError.createMethodNotAllowedPostOnly();

        const { user: data } = await this.checkAuthAndPermission(Permission.BlogEdit);

        await this.github.useUserGitHubToken(this.env, data.localId);

        const page = this.request.headers.get("page");
        const content = this.request.headers.get("content") || await this.request.text();
        
        if (!page || !content) throw HttpError.createBadRequest("page and content headers are required");

        const res = await this.github.updatePost(`${page}`, content);
        const data2: any = await res.json();

        data2.success = true;

        await logInfo(this.request, this.env, "blog_update", `Update blog post "${page}" by ${data.localId}`);

        return createJsonResponse(data2);
    }
    
    public async updateStaticPageV1() {
        if (!this.github) throw HttpError.createInternalServerError("GitHub service not initialized");
        if (this.request?.method !== "POST") throw HttpError.createMethodNotAllowedPostOnly();

        const { user: data } = await this.checkAuthAndPermission(Permission.PageEdit);

        await this.github.useUserGitHubToken(this.env, data.localId);

        const page = this.request.headers.get("page");
        const content = this.request.headers.get("content") || await this.request.text();
        
        if (!page || !content) throw HttpError.createBadRequest("page and content headers are required");

        const res = await this.github.updateStaticPage(`${page}`, content);
        const data2: any = await res.json();

        data2.success = true;

        await logInfo(this.request, this.env, "blog_update", `Update blog static page "${page}" by ${data.localId}`);

        return createJsonResponse(data2);
    }

    public async deletePost() {
        if (!this.github) throw HttpError.createInternalServerError("GitHub service not initialized");
        if (this.request?.method !== "POST") throw HttpError.createMethodNotAllowedPostOnly();
        const { user: data } = await this.checkAuthAndPermission(Permission.BlogEdit);

        await this.github.useUserGitHubToken(this.env, data.localId);
        const page = this.request.headers.get("page");
        if (!page) throw HttpError.createBadRequest("page header is required");

        const res = await this.github.deletePost(page);
        const data2: any = await res.json();

        data2.success = true;

        await logInfo(this.request, this.env, "blog_delete", `Delete blog post "${page}" by ${data.localId}`);

        const kvKey = `meta:${page.replace(".md", "")}`;
        await this.env.BLOG_META.delete(kvKey);
        return createJsonResponse(data2);
    }

    public async deleteStaticPage() {
        if (!this.github) throw HttpError.createInternalServerError("GitHub service not initialized");
        if (this.request?.method !== "POST") throw HttpError.createMethodNotAllowedPostOnly();
        const { user: data } = await this.checkAuthAndPermission(Permission.PageEdit);
        await this.github.useUserGitHubToken(this.env, data.localId);
        const page = this.request.headers.get("page");
        if (!page) throw HttpError.createBadRequest("page header is required");

        const res = await this.github.deleteStaticPage(page);
        const data2: any = await res.json();

        data2.success = true;

        await logInfo(this.request, this.env, "blog_delete", `Delete blog static page "${page}" by ${data.localId}`);

        const kvKey = `meta:${page.replace(".md", "")}`;
        await this.env.BLOG_META.delete(kvKey);
        return createJsonResponse(data2);
    }
}
