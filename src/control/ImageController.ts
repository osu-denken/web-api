import { CustomHttpError } from "../util/CustomHttpError";
import { HttpError } from "../util/HttpError";
import { Permission } from "../util/permission";
import { toBase64, createJsonResponse, logInfo } from "../util/utils";
import { GitHubService } from "../util/service/github";
import { FirebaseUser } from "../util/service/firebase";
import { IController } from "./IController";

/** 受け付ける画像 MIME と、保存時に使う拡張子の対応 */
const MIME_TO_EXT: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif"
};

/** アップロード日時キャッシュのキー。sha は内容が変われば必ず変わるので恒久キー化できる */
const dateCacheKey = (sha: string) => `img-date:${sha}`;

export class ImageController extends IController {
    public static MAX_SIZE = 20 * 1024 * 1024; // 20MB

    public getParentPath(): string {
        return "image";
    }

    public constructor(path: string[]) {
        super(path);

        if (path.length < 3) {
            const action = path[1] ?? "upload";
            path[0] = "v1";
            path[1] = "image";
            path[2] = action;
        }
    }

    public route() {
        if (this.path[2] === "list") return this.list();
        if (this.path[2] === "upload") return this.upload();
        if (this.path[2] === "delete") return this.delete();
        throw HttpError.createNotFound("Endpoint not found");
    }

    /** GitHub サービスが初期化済みであることを保証して返す */
    private requireGitHub(): GitHubService {
        if (!this.github) throw HttpError.createInternalServerError("GitHub service not initialized");
        return this.github;
    }

    /**
     * 更新系エンドポイント共通の前処理。
     * POST 検証・権限チェックを行い、ユーザーの GitHub トークンに切り替える。
     * @returns 認証済みユーザー
     */
    private async authorizeMutation(github: GitHubService): Promise<FirebaseUser> {
        if (this.request?.method !== "POST") throw HttpError.createMethodNotAllowedPostOnly();

        const { user } = await this.checkAuthAndPermission(Permission.BlogEdit);
        await github.useUserGitHubToken(this.env, user.localId);

        return user;
    }

    /**
     * images/ 配下の画像を一覧する
     * @returns JsonResponse
     */
    public async list() {
        const github = this.requireGitHub();
        await this.checkAuthAndPermission(Permission.BlogEdit);

        const res = await github.getImageList();
        if (!res.ok) throw new CustomHttpError(500, "INTERNAL_SERVER_ERROR", "GitHub list failed", await res.text());

        const entries: any[] = await res.json();

        const images = entries
            .filter(entry => entry.type === "file" && this.isImageName(entry.name))
            .map(entry => ({
                name: entry.name as string,
                sha: entry.sha as string,
                size: entry.size as number,
                url: `/images/${entry.name}`
            }));

        // アップロード日時を付与する。sha は内容が変われば必ず変わるので、
        // sha ごとにコミット日時を KV へ恒久キャッシュして commits API の呼び出しを抑える
        const withDates = await Promise.all(images.map(async img => ({
            ...img,
            uploadedAt: await this.resolveUploadedAt(github, img.sha, img.name)
        })));

        return createJsonResponse(withDates);
    }

    /**
     * 画像のアップロード日時を KV キャッシュ経由で解決する
     * @param github GitHub サービス
     * @param sha GitHub 上の blob SHA (キャッシュキー)
     * @param filename images/ 配下のファイル名
     * @returns ISO8601 文字列、取得できなければ null
     */
    private async resolveUploadedAt(github: GitHubService, sha: string, filename: string): Promise<string | null> {
        const key = dateCacheKey(sha);

        // 日時の付与はあくまで補助情報。KV や commits API が落ちても
        // 一覧そのものは返せるよう、ここで失敗を握りつぶして null にする
        try {
            const cached = await this.env.CACHE?.get(key);
            if (cached) return cached;

            const uploadedAt = await github.getImageCommitDate(filename);
            // sha に対する内容は不変なので TTL なしで置く
            if (uploadedAt) await this.env.CACHE?.put(key, uploadedAt);

            return uploadedAt;
        } catch (e) {
            console.error(`Failed to resolve uploadedAt for ${filename}:`, e);
            return null;
        }
    }

    public async upload() {
        const github = this.requireGitHub();
        const user = await this.authorizeMutation(github);

        const contentType = this.request!.headers.get("content-type") || "";
        if (!contentType.includes("multipart/form-data")) throw HttpError.createBadRequest("multipart/form-data required");

        const formData = await this.request!.formData();
        const file = formData.get("file");
        const rawName = formData.get("name") as string | null;

        if (!(file instanceof File)) throw HttpError.createBadRequest("file is required");
        if (file.size > ImageController.MAX_SIZE) throw HttpError.createBadRequest("Image size must be <= 20MB");

        const ext = MIME_TO_EXT[file.type];
        if (!ext) throw HttpError.createBadRequest("Unsupported image type");

        const name = rawName ? rawName.replace(/[^a-zA-Z0-9_-]/g, "") : null;
        const filename = name ? `${name}.${ext}` : `${crypto.randomUUID()}.${ext}`;

        const base64 = toBase64(await file.arrayBuffer());
        const res = await github.uploadImage(filename, base64, `Upload image ${filename} via Cloudflare Worker`);

        if (!res.ok) throw new CustomHttpError(500, "INTERNAL_SERVER_ERROR", "GitHub upload failed", await res.text());

        const result: any = await res.json();

        await logInfo(this.request!, this.env, "image", `Upload image "${filename}" by ${user.localId}`);

        return createJsonResponse({
            success: true,
            name: filename,
            sha: result.content?.sha,
            url: `/images/${filename}`
        });
    }

    public async delete() {
        const github = this.requireGitHub();
        const user = await this.authorizeMutation(github);

        const body: any = await this.request!.json();
        const filename = body?.filename as string;
        const sha = body?.sha as string | undefined;

        if (!filename) throw HttpError.createBadRequest("filename is required");
        await github.deleteImage(filename, sha);

        // アップロード日時キャッシュも掃除する (sha は削除後に再利用されない)
        if (sha) await this.env.CACHE.delete(dateCacheKey(sha));

        await logInfo(this.request!, this.env, "image", `Deleted image "${filename}" by ${user.localId}`);

        return createJsonResponse({ success: true, filename });
    }

    private isImageName(name: string) {
        return /\.(jpg|jpeg|png|webp|gif)$/i.test(name);
    }
}
