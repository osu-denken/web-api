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
        const listed = await this.env.LOGS.list<LogMeta>({
            prefix: type ? `${type}:` : undefined,
            cursor,
            limit,
        });

        const logs = listed.keys.map((key: any) => {
            const meta = key.metadata as LogMeta | undefined;
            // メタデータ導入前の古いキー (`${type}:${ts}`) はキー名から最低限を補う
            return meta ?? {
                type: key.name.split(":")[0] ?? "unknown",
                ts: 0,
                message: "(メタデータなし)",
                ip: "unknown",
                userAgent: "unknown",
            };
        });

        // prefix なし (全種別) だと種別ごとにまとまるため、ページ内を時刻降順にそろえる
        logs.sort((a, b) => b.ts - a.ts);

        return createJsonResponse({
            logs,
            cursor: listed.list_complete ? null : listed.cursor,
            complete: listed.list_complete,
        });
    }
}
