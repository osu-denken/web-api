import { createJsonResponseRaw } from "../util/utils";
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
        if (this.path[1] == "info") return this.info();

        // return JSON.stringify(arr, null, 2);
    }

    public async info() {
        const data: any = await this.firebase?.verifyIdToken?(this.authorization) : null;
        return createJsonResponseRaw(data);
    }

}