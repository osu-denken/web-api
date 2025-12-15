import { HttpError } from "../HttpError";
import { Env } from "../types";
import { GoogleSheetsService } from "./googlesheets";

export class MembersGSheetsService extends GoogleSheetsService {

    private ctx: any;
    private env: Env;

    public constructor(saKey: string, spreadsheetId: string, ctx: any, env: any) {
        super(saKey, spreadsheetId);
        this.ctx = ctx;
        this.env = env;
    }

    public async getMembers() {
        const rows = await super.getRowsByHeader("main", "A1:K100");
        if (!rows) throw HttpError.createNotFound(`All members not found`);
        return rows;
    }

    public async getMembersWithCache() {
        const cacheIndex = await this.env.MEMBERS.get("_index");

        if (cacheIndex) {
            const keys: string[] = JSON.parse(cacheIndex);
            const members = await Promise.all(
                keys.map(key => this.env.MEMBERS.get(key))
            );

            return members
                .filter(Boolean)
                .map(v => JSON.parse(v as string));
        }

        const rows: any = await this.getMembers();
        const index: string[] = [];
        for (let row of rows) {
            const studentId: string = "s" + (row.num as string);
            index.push(studentId.toLowerCase());
            await this.env.MEMBERS.put(studentId.toLowerCase(), JSON.stringify(row), { expirationTtl: 86400 });
        }

        await this.env.MEMBERS.put("_index", JSON.stringify(index), { expirationTtl: 86400 });

        return rows;
    }

    public async getMember(studentId: string) {
        if (studentId.startsWith("s"))
            studentId = studentId.slice(1);

        studentId = studentId.toUpperCase();

        const row = await super.findRowByHeader("main", "A1:K100", "num", studentId);
        if (!row) throw HttpError.createNotFound(`Member ${studentId} not found`);

        return row;
    }

    public async getMemberWithCache(studentId: string) {
        if (studentId.startsWith("s"))
            studentId = studentId.slice(1);

        const cache = await this.env.MEMBERS.get("s" + studentId);
        if (cache) return JSON.parse(cache);

        const row = await this.getMember(studentId);
        await this.env.MEMBERS.put("s" + studentId, JSON.stringify(row), { expirationTtl: 86400 });

        return row;
    }
    
    /**
     * 権限があるか
     * @param studentId 学籍番号
     * @returns 
     */
    public async hasPermission(studentId: string): Promise<boolean> {
        // if (!this.members_googlesheets) throw HttpError.createInternalServerError("GoogleSheets service of members not initialized");

        const member: any = await this.getMemberWithCache(studentId);
        return member.permit === "1";
    }

    /**
     * 権限があるか
     * @param email 大学付与のメールアドレス
     * @returns boolean
     */
    public async hasPermissionByEmail(email: string): Promise<boolean> {
        // if (!this.members_googlesheets) throw HttpError.createInternalServerError("GoogleSheets service of members not initialized");

        let studentId = email.split("@")[0];       
        const member: any = await this.getMemberWithCache(studentId);
        return member.permit === "1";
    }

}