import { CustomHttpError } from "../CustomHttpError";
import { HttpError } from "../HttpError";
import { b64ToStr, toBase64, parseFrontMatter } from "../utils";
import { GitHubClient, ContentTarget, DEFAULT_TARGET, OWNER } from "./github-client";

/**
 * blog リポジトリのコンテンツ。記事、固定ページ、画像を扱う。
 */
export class GitHubBlogClient extends GitHubClient {
    /** 記事と画像の保存先。既定は旧 blog */
    protected target: ContentTarget = DEFAULT_TARGET;

    public setTarget(target: ContentTarget) {
        this.target = target;
    }

    public isDefaultTarget() {
        return this.target === DEFAULT_TARGET;
    }

    /** 固定ページのパス（保存先のフォルダの下） */
    protected pagePath(path: string) {
        return this.target.pagesDir ? `${this.target.pagesDir}/${path}` : path;
    }
    /**
     * 記事ページの一覧
     */
    public async getPostList() {
        const res = await this.getFileContent(this.target.postsDir, this.target.repo);

        if (res.status === 404)
            throw new HttpError(404, "NOT_FOUND", "All posts not found");

        return res;
    }

    /**
     * 固定ページの一覧
     */
    public async getStaticPageList() {
        const res = await this.getFileContent(this.target.pagesDir, this.target.repo);

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

        const res = await this.getFileContent(`${this.target.postsDir}/${path}`, this.target.repo);

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

        const res: any = await this.getFileContent(this.pagePath(path), this.target.repo);

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

        post.raw = source;
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

        return this.uploadFile(this.pagePath(`${slug}.md`), toBase64(content), message, sha, this.target.repo);
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

        return this.uploadFile(`${this.target.postsDir}/${slug}.md`, toBase64(content), message, sha, this.target.repo);
    }

    /**
     * 画像の一覧 (images/)
     */
    public async getImageList() {
        const res = await this.getFileContent(this.target.imagesDir, this.target.repo);

        if (res.status === 404)
            throw new HttpError(404, "NOT_FOUND", "Image directory not found");

        return res;
    }

    /**
     * 画像を最後にコミットした日時 (= アップロード日時) を取得する。
     * Contents API は日時を返さないので commits API を path で絞って引く。
     * @param filename images/ 配下のファイル名
     * @returns ISO8601 文字列。取得できなければ null
     */
    public async getImageCommitDate(filename: string): Promise<string | null> {
        await GitHubBlogClient.checkSafePath(filename, true);

        const url = `https://api.github.com/repos/${OWNER}/${this.target.repo}/commits?path=${this.target.imagesDir}/${encodeURIComponent(filename)}&per_page=1`;
        const res = await this.request(url, "GET");
        if (!res.ok) return null;

        const commits: any[] = await res.json();
        return commits[0]?.commit?.committer?.date ?? null;
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
        return this.uploadFile(`${this.target.imagesDir}/${filename}`, contentBase64, message, undefined, this.target.repo);
    }

    /**
     * 画像を削除する
     * @param filename images/ 配下のファイル名
     * @param sha GitHub 上の SHA
     * @param message コミットメッセージ
     */
    public async deleteImage(filename: string, sha?: string, message: string = "Delete image via Cloudflare Worker") {
        await GitHubBlogClient.checkSafePath(filename, true);
        return this.deleteFile(`${this.target.imagesDir}/${filename}`, sha, message, this.target.repo);
    }

    /**
     * 記事ページの削除
     */
    public async deletePost(slug: string, message: string = "Delete post via Cloudflare Worker") {
        await GitHubBlogClient.checkSafePath(slug);
        return this.deleteFile(`${this.target.postsDir}/${slug}.md`, undefined, message, this.target.repo);
    }

    /**
     * 固定ページの削除
     */
    public async deleteStaticPage(slug: string, message: string = "Delete static page via Cloudflare Worker") {
        await GitHubBlogClient.checkSafePath(slug, true);
        return this.deleteFile(this.pagePath(`${slug}.md`), undefined, message, this.target.repo);
    }
}
