import { IController } from "./IController";

export class PingController extends IController {    
    public getParentPath(): string {
        return "ping";
    }

    public constructor(path: string[]) {
        super(path);
    }

    public route() {
        return new Response("pong", { status: 200 });
    }
}
