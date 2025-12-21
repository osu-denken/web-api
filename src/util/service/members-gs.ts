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

    private _normalizeStudentId(studentId: string): string {
        if (studentId.startsWith("s"))
            studentId = studentId.slice(1);

        return studentId.toUpperCase();
    }


    public async getMembersWithCache() {
        const cache = await this.env.MEMBERS.get("_all");
        if (cache) {
            return JSON.parse(cache);
        }

        const rows = await super.getRowsByHeader("main", "A1:K100");
        if (!rows) throw HttpError.createNotFound(`All members not found`);

        await this.env.MEMBERS.put("_all", JSON.stringify(rows), { expirationTtl: 86400 });

        return rows;
    }

    public async getMemberWithCache(studentId: string) {
        studentId = this._normalizeStudentId(studentId);

        const members = await this.getMembersWithCache();
        let member = members.find((m: any) => this._normalizeStudentId(m.num) === studentId);

        if (member) return member;

        // Cache miss, refetch all members
        await this.env.MEMBERS.delete("_all");
        const newMembers = await this.getMembersWithCache();
        member = newMembers.find((m: any) => this._normalizeStudentId(m.num) === studentId);

        if (!member) throw HttpError.createNotFound(`Member ${studentId} not found`);

        return member;
    }
    
    /**
     * 権限があるか
     * @param studentId 学籍番号
     * @returns 
     */
    public async hasPermission(studentId: string): Promise<boolean> {
        const member: any = await this.getMemberWithCache(studentId);
        return member.permit === "1";
    }

    /**
     * 権限があるか
     * @param email 大学付与のメールアドレス
     * @returns boolean
     */
    public async hasPermissionByEmail(email: string): Promise<boolean> {
        let studentId = email.split("@")[0];       
        const member: any = await this.getMemberWithCache(studentId);
        return member.permit === "1";
    }

}