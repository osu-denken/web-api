import { HttpError } from "../util/HttpError";
import { createJsonResponse } from "../util/utils";
import { IController } from "./IController";

export class UserController extends IController {    
    public getParentPath(): string {
        return "user";
    }

    public constructor(path: string[]) {
        super(path);
        if (path.length < 2) path[1] = "info";
    }

    public route() {
        if (this.path[1] == "info") return this.getInfo();

        throw HttpError.createNotFound("Endpoint not found");
    }

    /**
     * ユーザー情報、メールアドレスやディスプレイネーム、作成日時といった情報を取得する
     * @returns JsonResponse
     */
    public async getInfo() {
        if (this.request?.method !== "POST") throw HttpError.createMethodNotAllowedPostOnly();
        if (!this.authorization) throw HttpError.createUnauthorizedHeaderRequired();

        const data: any = await this.firebase?.verifyIdToken?(this.authorization) : null;
        return createJsonResponse(data);
    }
}
