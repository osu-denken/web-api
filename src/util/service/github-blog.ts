import { CustomHttpError } from "../CustomHttpError";
import { HttpError } from "../HttpError";
import { b64ToStr, toBase64, parseFrontMatter } from "../utils";
import { GitHubClient } from "./github-client";

/**
 * blog リポジトリのコンテンツ。記事、固定ページ、画像を扱う。
 */
export class GitHubBlogClient extends GitHubClient {
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
        await GitHubBlogClient.checkSafePath(path);

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
        await GitHubBlogClient.checkSafePath(path);

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
        await GitHubBlogClient.checkSafePath(slug, true);

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
        await GitHubBlogClient.checkSafePath(slug);

        return this.uploadFile(`_posts/${slug}.md`, toBase64(content), message, sha);
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
        await GitHubBlogClient.checkSafePath(filename, true);
        return this.uploadFile(`images/${filename}`, contentBase64, message);
    }

    /**
     * 画像を削除する
     * @param filename images/ 配下のファイル名
     * @param sha GitHub 上の SHA
     * @param message コミットメッセージ
     */
    public async deleteImage(filename: string, sha?: string, message: string = "Delete image via Cloudflare Worker") {
        await GitHubBlogClient.checkSafePath(filename, true);
        return this.deleteFile(`images/${filename}`, sha, message);
    }

    /**
     * 記事ページの削除
     */
    public async deletePost(slug: string, message: string = "Delete post via Cloudflare Worker") {
        await GitHubBlogClient.checkSafePath(slug);
        return this.deleteFile(`_posts/${slug}.md`, undefined, message);
    }

    /**
     * 固定ページの削除
     */
    public async deleteStaticPage(slug: string, message: string = "Delete static page via Cloudflare Worker") {
        await GitHubBlogClient.checkSafePath(slug, true);
        return this.deleteFile(`${slug}.md`, undefined, message);
    }
}
