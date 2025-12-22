import { CustomHttpError } from "../util/CustomHttpError";
import { HttpError } from "../util/HttpError";
import { b64ToStr, createFrontMatter, createJsonResponse, logInfo, parseFrontMatter } from "../util/utils";
import { IController } from "./IController";

export class BlogController extends IController {    
    public getParentPath(): string {
        return "blog";
    }

    public constructor(path: string[]) {
        super(path);

        if (path.length < 3) {
            let tmp = path[1];
            path[0] = "v2";
            path[1] = "blog";
            path[2] = tmp;
        }

        if (path.length < 2) {
            path[0] = "v2";
            path[1] = "blog";
            path[2] = "list";
        }
    }

    public route() {
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

        for (const post of posts) {
            if (!post.name.endsWith(".md")) 
                continue;

            post.name = post.name.replace(".md", "");
            post.meta = await this.getMetaCached(post.name, post);
        }

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
            page.meta = await this.getMetaStaticPageCached(page.name, page);
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
        
        const cacheKey = `meta:${slug}`;
        await this.env.BLOG_META.put(cacheKey, JSON.stringify({ sha: post.sha, meta: post.meta }));

        return createJsonResponse({
            name: post.name,
            sha: post.sha,
            size: post.size,
            meta: post.meta,
            content: post.content
        });
    }

    /**
     * 記事ページを更新する
     * @returns JsonResponse
     */
    public async updatePost() {
        if (!this.github) throw HttpError.createInternalServerError("GitHub service not initialized");
        if (this.request?.method !== "POST") throw HttpError.createMethodNotAllowedPostOnly();

        const data = await this.checkAuthAndPermission();
        
        await this.github.useUserGitHubToken(this.env, data.localId);

        const page = this.request.headers.get("page");
        const _meta = this.request.headers.get("meta");
        const _content = this.request.headers.get("content") || await this.request.text();
        
        if (!page || !_content || !_meta) throw HttpError.createBadRequest("page, meta and content headers are required");
        
        let meta: any = {};
        try {
            meta = JSON.parse(_meta);
        } catch (e) {
            throw HttpError.createBadRequest("meta header is not valid JSON");
        }

        const content = createFrontMatter(meta, _content as string);

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
     * 記事ページのメタデータを取得する
     * @param slug ページ名
     * @param post 記事のデータ
     * @returns メタデータ
     */
    private async getMetaCached(slug: string, post?: any) {
        const cacheKey = `meta:${slug}`;
        const cachedStr = await this.env.BLOG_META.get(cacheKey);
        const cached = cachedStr ? JSON.parse(cachedStr) : null;

        if (!post || (post && !post.content)) {
            const res: any = await this.github!.getPostRaw(`${slug}.md`);
            post = await res.json();
            if (!post.content) return {};
        }
        const sha = post.sha;
        if (cached?.sha === sha) return cached.meta;

        let content = post.content;
        if (post.encoding === "base64") 
            content = b64ToStr(content);

        if (!content) throw new CustomHttpError(404, "NOT_FOUND", "Post content not found", post);
        const meta = parseFrontMatter(content).meta || {};
        await this.env.BLOG_META.put(cacheKey, JSON.stringify({ sha, meta }));

        return meta;
    }

    /**
     * 固定ページのメタデータを取得する
     * @param slug ページ名
     * @param page 固定のデータ
     * @returns メタデータ
     */
    private async getMetaStaticPageCached(slug: string, page?: any) {
        const cacheKey = `meta:${slug}`;
        const cachedStr = await this.env.BLOG_META.get(cacheKey);
        const cached = cachedStr ? JSON.parse(cachedStr) : null;

        if (!page || (page && !page.content)) {
            const page: any = await this.github!.getStaticPageRaw(`${slug}.md`);
            if (!page.content) return {};
        }
        const sha = page.sha;
        if (cached?.sha === sha) return cached.meta;

        let content = page.content;
        if (page.encoding === "base64") 
            content = b64ToStr(content);

        if (!content) throw new CustomHttpError(404, "NOT_FOUND", "Page content not found", page);
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
        
        const data = await this.checkAuthAndPermission();
        
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
        
        const data = await this.checkAuthAndPermission();
        
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
}
