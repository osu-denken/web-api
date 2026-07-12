import { HttpError } from "../util/HttpError";
import { Permission } from "../util/permission";
import { createJsonResponse } from "../util/utils";
import { IController } from "./IController";

/** LOGS KV に put する際に添える metadata の形 */
interface LogMeta {
    type: string;
    ts: number;
    message: string;
    ip: string;
    userAgent: string;
}

export class LogController extends IController {
    public getParentPath(): string {
        return "logs";
    }

    public constructor(path: string[]) {
        super(path);
        if (path.length < 2) path[1] = "list";
    }

    public route() {
        if (this.path[1] == "list") return this.list();

        throw HttpError.createNotFound("Endpoint not found");
    }

    /**
     * 操作ログを新しい順に一覧する。ログ閲覧権限が要る。
     * クエリ: type (種別で絞り込み), cursor (続き), limit (1〜100, 既定50)
     */
    public async list() {
        if (this.request?.method !== "GET") throw HttpError.createMethodNotAllowed("Use GET");

        await this.checkAuthAndPermission(Permission.LogView);

        const params = this.url!.searchParams;
        const type = params.get("type")?.trim() || undefined;
        const cursor = params.get("cursor") || undefined;
        const limit = Math.min(Math.max(Number(params.get("limit")) || 50, 1), 100);

        // キーは `${type}:${反転タイムスタンプ}` なので、種別指定時は prefix で新しい順に取れる
        const listed = await this.env.LOGS.list({
            prefix: type ? `${type}:` : undefined,
            cursor,
            limit,
        });

        const logs: LogMeta[] = await Promise.all(listed.keys.map((key: any) => this.toLogMeta(key)));

        // prefix なし (全種別) だと種別ごとにまとまるため、ページ内を時刻降順にそろえる
        logs.sort((a: LogMeta, b: LogMeta) => b.ts - a.ts);

        return createJsonResponse({
            logs,
            cursor: listed.list_complete ? null : listed.cursor,
            complete: listed.list_complete,
        });
    }

    /**
     * KV のキーを1件分の表示データに変換する。
     * メタデータがあればそのまま使い、無い古いエントリは本体を読んで補う。
     * @param key list() が返すキー
     */
    private async toLogMeta(key: any): Promise<LogMeta> {
        const meta = key.metadata as LogMeta | undefined;
        if (meta) return meta;

        // メタデータ導入前のエントリ。キー末尾のタイムスタンプと本体 (JSON) から復元する。
        const colon = key.name.lastIndexOf(":");
        const type = colon >= 0 ? key.name.slice(0, colon) : "unknown";
        const suffix = colon >= 0 ? key.name.slice(colon + 1) : "";
        const ts = this.timestampFromSuffix(suffix);

        let message = "(メタデータなし)";
        let ip = "unknown";
        let userAgent = "unknown";
        try {
            const raw = await this.env.LOGS.get(key.name);
            if (raw) {
                const body = JSON.parse(raw);
                message = body.message ?? message;
                ip = body.ip ?? ip;
                userAgent = body.userAgent ?? userAgent;
            }
        } catch { /* 壊れた本体は既定値のまま */ }

        return { type, ts, message, ip, userAgent };
    }

    /**
     * キー末尾の数値からタイムスタンプを復元する。
     * 新形式は反転タイムスタンプ (15桁)、旧形式は生のエポックミリ秒。
     * @param suffix キー末尾
     */
    private timestampFromSuffix(suffix: string): number {
        const n = Number(suffix);
        if (!Number.isFinite(n)) return 0;
        // 反転タイムスタンプは 1e15 - ts。生のミリ秒 (約1.7e12) より桁が大きい
        return n > 5e14 ? 1e15 - n : n;
    }
}
