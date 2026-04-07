import { HttpError } from "../util/HttpError";
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
        if (this.path[1] == "unlock") return this.unlock();
        if (this.path[1] == "list") return this.list();

        throw HttpError.createNotFound("Endpoint not found");
    }

    public async validate() {
        this.checkAuthAndPermission();

        const res = await this.switchbot?.request("devices", "GET");
        if (!res) throw HttpError.createInternalServerError("SwitchBotService is not initialized");

        const data = await res.json() as SwitchBotResponse;

        if (data.statusCode === 100) {
            return createJsonResponse({ valid: true, success: true });
        }

        return createJsonResponse({ valid: false, message: data.message, success: false });
    }

    public async list() {
        this.checkAuthAndPermission();

        const res = await this.switchbot?.request("devices", "GET");
        if (!res) throw HttpError.createInternalServerError("SwitchBotService is not initialized");
        const data = await res.json() as SwitchBotResponse;

        if (data.statusCode === 100) {
            return createJsonResponse({ success: true, devices: data.body?.deviceList || [] });
        }

        return createJsonResponse({ success: false, message: data.message });
    }

    public async lock() {
        this.checkAuthAndPermission();
        const res = await this.switchbot?.request("devices", "GET");
        if (!res) throw HttpError.createInternalServerError("SwitchBotService is not initialized");
        const data = await res.json() as SwitchBotResponse;
        if (data.statusCode === 100) {
            const devices = data.body?.deviceList || [];
            const lock = devices.find((d: any) => d.type === "Smart Lock");
            if (!lock) throw HttpError.createNotFound("No Smart Lock device found");
            const res2 = await this.switchbot?.request(`devices/${lock.deviceId}/commands`, "POST", {
                commandType: "command",
                command: "lock"
            });
            if (!res2) throw HttpError.createInternalServerError("Failed to send lock command");
            const data2 = await res2.json() as SwitchBotResponse;
            if (data2.statusCode === 100) {
                return createJsonResponse({ success: true });
            }
        }
        return createJsonResponse({ success: false, message: data.message });
    }

    public async unlock() {
        this.checkAuthAndPermission();

        const res = await this.switchbot?.request("devices", "GET");
        if (!res) throw HttpError.createInternalServerError("SwitchBotService is not initialized");
        const data = await res.json() as SwitchBotResponse;

        if (data.statusCode === 100) {
            const devices = data.body?.deviceList || [];
            const lock = devices.find((d: any) => d.type === "Smart Lock");
            if (!lock) throw HttpError.createNotFound("No Smart Lock device found");

            const res2 = await this.switchbot?.request(`devices/${lock.deviceId}/commands`, "POST", {
                commandType: "command",
                command: "unlock"
            });
            if (!res2) throw HttpError.createInternalServerError("Failed to send unlock command");
        
            const data2 = await res2.json() as SwitchBotResponse;

            if (data2.statusCode === 100) {
                return createJsonResponse({ success: true });
            }
            
        }

        return createJsonResponse({ success: false, message: data.message });
    }
}
