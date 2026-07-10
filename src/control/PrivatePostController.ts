import { HttpError } from "../util/HttpError";
import { Permission } from "../util/permission";
import { normalizeSlug, toSummary } from "../util/private-post";
import { PrivatePostRepository } from "../util/service/private-posts-d1";
import { createJsonResponse, logInfo } from "../util/utils";
import { IController } from "./IController";

interface UpdateBody {
    slug?: string;
    title?: string;
    content?: string;
}

/**
 * 非公開記事。公開リポジトリに置けない内容を扱うため、
 * 一覧・本文ともに認証と権限を要求し、キャッシュもしない。
 */
export class PrivatePostController extends IController {
    public getParentPath(): string {
        return "private-posts";
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
                return this.get();
            case "update":
                return this.update();
            case "delete":
                return this.remove();
        }

        throw HttpError.createNotFound("Endpoint not found");
    }

    private get repository(): PrivatePostRepository {
        if (!this.privatePosts) throw HttpError.createInternalServerError("Private post repository not initialized");
        return this.privatePosts;
    }

    /**
     * POST の本文を読む
     */
    private async body<T>(): Promise<T> {
        if (this.request?.method !== "POST") throw HttpError.createMethodNotAllowedPostOnly();
        return await this.request.json() as T;
    }

    /**
     * 本文の slug を検証して取り出す
     */
    private async targetSlug(): Promise<string> {
        const { slug } = await this.body<{ slug?: string }>();
        if (!slug) throw HttpError.createBadRequest("slug is required");

        return normalizeSlug(slug);
    }

    /**
     * 一覧する。本文は含めない
     */
    public async list() {
        await this.checkAuthAndPermission(Permission.PrivatePostView);

        const posts = await this.repository.list();
        return createJsonResponse({ success: true, posts: posts.map(toSummary) });
    }

    /**
     * 1件の本文を返す。誰が読んだかは監査ログに残す
     */
    public async get() {
        const auth = await this.checkAuthAndPermission(Permission.PrivatePostView);
        const slug = await this.targetSlug();

        const post = await this.repository.requireBySlug(slug);
        await logInfo(this.request!, this.env, "private_post_read",
            `Read private post "${slug}" by #${auth.member.id}`);

        return createJsonResponse({ success: true, post });
    }

    /**
     * 新規作成または上書きする
     */
    public async update() {
        const auth = await this.checkAuthAndPermission(Permission.PrivatePostEdit);

        const body = await this.body<UpdateBody>();
        if (!body.slug) throw HttpError.createBadRequest("slug is required");
        if (typeof body.content !== "string") throw HttpError.createBadRequest("content is required");

        const slug = normalizeSlug(body.slug);
        const title = body.title?.trim() || slug;

        await this.repository.upsert(slug, title, body.content, { id: auth.member.id, name: auth.member.name });
        await logInfo(this.request!, this.env, "private_post_update",
            `Update private post "${slug}" by #${auth.member.id}`);

        return createJsonResponse({ success: true });
    }

    /**
     * 削除する
     */
    public async remove() {
        const auth = await this.checkAuthAndPermission(Permission.PrivatePostEdit);
        const slug = await this.targetSlug();

        await this.repository.requireBySlug(slug);
        await this.repository.remove(slug);

        await logInfo(this.request!, this.env, "private_post_delete",
            `Delete private post "${slug}" by #${auth.member.id}`);

        return createJsonResponse({ success: true });
    }
}
