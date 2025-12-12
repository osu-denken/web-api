import { CustomHttpError } from "../util/CustomHttpError";
import { HttpError } from "../util/HttpError";
import { base642txt, createJsonResponseRaw, parseFrontMatter } from "../util/utils";
import { IController } from "./IController";

export class BlogController extends IController {    
    public getParentPath(): string {
        return "blog";
    }

    public constructor(path: string[]) {
        super(path);

        if (path.length < 2) {
            path[0] = "v2";
            path[1] = "blog";
            path[2] = "list";
        }
    }

    public route() {
        if (this.path[0] === "v1") {
            if (this.path[2] == "list") return this.list();
            if (this.path[2] == "post") return this.getPost();
            if (this.path[2] == "update") throw HttpError.createNotImplemented("Update post not implemented in v1");
        }

        if (this.path[0] === "v2") {
            if (this.path[2] == "list") return this.list2();
            if (this.path[2] == "post") return this.getPost2();
            if (this.path[2] == "update") throw HttpError.createNotImplemented("Update post not implemented in v2");
        }

        throw HttpError.createNotFound("Endpoint not found");
    }

    public async list() {
        if (this.github == null) throw HttpError.createInternalServerError("GitHub service not initialized");

        const res = await this.github.getList();
        const data: any = await res?.json();

        const result = data.map((page: any) => ({
            name: page.name.replace(".md", ""),
            sha: page.sha,
            size: page.size
        }));

        return createJsonResponseRaw(result);
    }

    public async list2() {
        if (this.github == null) throw HttpError.createInternalServerError("GitHub service not initialized");

        const res = await this.github.getList();
        const data: any = await res.json();

        for (const page of data) {
            const kvKey = `meta:${page.name.replace(".md", "")}`;

            const cachedStr = await this.env.BLOG_META.get(kvKey);
            let cached = cachedStr ? JSON.parse(cachedStr) : null;

            if (cached && cached.sha === page.sha) {
                page.meta = cached.meta;
                continue;
            }

            const postRes = await this.github.getPost(page.name);
            const postData: any = await postRes.json();

            if (postData.content) {
                let content = postData.content;
                if (postData.encoding === "base64") {
                    content = base642txt(content);
                }

                const parsed = parseFrontMatter(content);
                page.meta = parsed.meta || {};

                await this.env.BLOG_META.put(
                    kvKey,
                    JSON.stringify({
                        sha: page.sha,
                        meta: page.meta
                    })
                );
            } else {
                page.meta = {};
            }
        }

        const result = data.map((page: any) => ({
            name: page.name.replace(".md", ""),
            sha: page.sha,
            size: page.size,
            meta: page.meta
        }));
        
        return createJsonResponseRaw(result);
    }
    
    public async getPost() {
        if (this.github == null) throw HttpError.createInternalServerError("GitHub service not initialized");

        let page = this.url?.searchParams.get("page") || "";
        if (page === "") throw HttpError.createBadRequest("Query parameter 'page' is required");
        page = `${page}.md`;

        const res = await this.github.getPost(page);
        const data: any = await res.json();

        if (!data.content) throw new CustomHttpError(404, "NOT_FOUND", "Post not found", data);

        let content = data.content;
        if (data.encoding && data.encoding === "base64")
            content = base642txt(content);
        
        return createJsonResponseRaw({
            name: page.replace(".md", ""),
            sha: data.sha,
            size: data.size,
            content: content
        });
    }

    public async getPost2() {
        if (this.github == null) throw HttpError.createInternalServerError("GitHub service not initialized");

        let page = this.url?.searchParams.get("page") || "";
        if (page === "") throw HttpError.createBadRequest("Query parameter 'page' is required");
        
        const filename = `${page}.md`;
        const cacheKey = `meta:${page}`;

        const cachedStr = await this.env.BLOG_META.get(cacheKey);
        let cached = cachedStr ? JSON.parse(cachedStr) : null;

        const res = await this.github.getPost(filename);
        const data: any = await res?.json();

        if (!data.content) throw new CustomHttpError(404, "NOT_FOUND", "Post not found", data);

        if (cached && cached.sha === data.sha) {
            let content = data.content;
            if (data.encoding && data.encoding === "base64")
                content = base642txt(content);
            
            const parsed = parseFrontMatter(content);

            return createJsonResponseRaw({
                name: data.name.replace(".md", ""),
                sha: data.sha,
                size: data.size,
                meta: cached.meta,
                content: parsed.content || content
            });
        }

        let content = data.content;
        if (data.encoding && data.encoding === "base64")
            content = base642txt(content);
        
        const parsed = parseFrontMatter(content);

        await this.env.BLOG_META.put(
            cacheKey,
            JSON.stringify({
                sha: data.sha,
                meta: parsed.meta || {}
            })
        );

        return createJsonResponseRaw({
            name: data.name.replace(".md", ""),
            sha: data.sha,
            size: data.size,
            meta: parsed.meta || {},
            content: parsed.content || content
        });
    }
}