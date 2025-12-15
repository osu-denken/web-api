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
        const indexJson = await this.env.MEMBERS.get("_index", { type: "json" });
        if (indexJson && Array.isArray(indexJson)) {
            const members = await Promise.all(indexJson.map((key: string) => 
                this.env.MEMBERS.get(`${key}`, { type: "json" })));

            return members.filter(Boolean);
        }

        const index :string[] = [];
        const rows: any = await this.getMembers();
        for (let row of rows) {
            const studentId: string = "s" + (row.num as string);
            index.push(studentId);
            this.env.MEMBERS.put(studentId.toLowerCase(), JSON.stringify(row), { expirationTtl: 86400 });
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
    }

    public async getMemberWithCache(studentId: string) {
        if (studentId.startsWith("s"))
            studentId = studentId.slice(1);

        const cache = this.env.MEMBERS.get("s" + studentId);
        if (cache) return cache;

        const row = await this.getMember(studentId);
        await this.env.MEMBERS.put("s" + studentId, JSON.stringify(row), { expirationTtl: 86400 });

        return row;
    }

}