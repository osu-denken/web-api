import { HttpError } from "../util/HttpError";
import { Permission } from "../util/permission";
import { SwitchBotResponse } from "../util/types";
import { createJsonResponse, logInfo } from "../util/utils";
import { IController } from "./IController";

export class SwitchBotController extends IController {    
    public getParentPath(): string {
        return "switchbot";
    }

    public constructor(path: string[]) {
        super(path);
        if (path.length < 2) path[1] = "validate";
    }

    public route() {
        if (this.path[1] == "validate") return this.validate();
        if (this.path[1] == "lock") return this.lock();
        if (this.path[1] == "unlock") return this.unlock();
        if (this.path[1] == "list") return this.list();

        throw HttpError.createNotFound("Endpoint not found");
    }

    public async validate() {
        const json = await this.fetchDevices();

        if (json.statusCode === 100) {
            return createJsonResponse({ valid: true, success: true });
        }

        return createJsonResponse({ valid: false, message: json.message, success: false });
    }

    public async list() {
        const json = await this.fetchDevices();

        if (json.statusCode === 100) {
            return createJsonResponse({ success: true, devices: json.body?.deviceList || [] });
        }

        return createJsonResponse({ success: false, message: json.message });
    }

    public async lock() {
        return await this.sendLockCommand("lock");
    }

    public async unlock() {
        return await this.sendLockCommand("unlock");
    }

    /**
     * 認証・権限チェックのうえデバイス一覧を取得する
     */
    private async fetchDevices(): Promise<SwitchBotResponse> {
        if (!this.switchbot) throw HttpError.createInternalServerError("SwitchBot service not initialized");

        await this.checkAuthAndPermission(Permission.SwitchBotControl);

        const res = await this.switchbot.request("devices", "GET");
        return await res.json() as SwitchBotResponse;
    }

    /**
     * Smart Lock にコマンドを送る
     * @param command lock または unlock
     */
    private async sendLockCommand(command: "lock" | "unlock") {
        const json = await this.fetchDevices();
        if (json.statusCode !== 100) return createJsonResponse({ success: false, message: json.message });

        const devices = json.body?.deviceList || [];
        const lock = devices.find((d: any) => d.type === "Smart Lock");
        if (!lock) throw HttpError.createNotFound("No Smart Lock device found");

        const res = await this.switchbot!.request(`devices/${lock.deviceId}/commands`, "POST", {
            commandType: "command",
            command
        });

        const result = await res.json() as SwitchBotResponse;
        if (result.statusCode === 100) return createJsonResponse({ success: true });

        return createJsonResponse({ success: false, message: result.message });
    }
}
