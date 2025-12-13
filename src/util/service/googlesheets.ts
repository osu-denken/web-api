import * as jose from 'jose';
import { HttpError } from "../HttpError";

const BASE_URL = "https://sheets.googleapis.com/v4/spreadsheets";

export class GoogleSheetsService {
    private saKey: string;
    private spreadsheetId: string;

    constructor(saKey: string, spreadsheetId: string) {
        this.saKey = saKey;
        this.spreadsheetId = spreadsheetId;
    }

    /**
     * アクセストークンの取得
     */
    private async getAccessToken(): Promise<string> {
        const SERVICE_ACCOUNT = JSON.parse(this.saKey);
        const iat = Math.floor(Date.now() / 1000);
        const payload = {
            iss: SERVICE_ACCOUNT.client_email,
            scope: "https://www.googleapis.com/auth/spreadsheets",
            aud: "https://oauth2.googleapis.com/token",
            exp: iat + 3600,
            iat: iat
        };

        const jwt = await new jose.SignJWT(payload)
            .setProtectedHeader({ alg: "RS256", typ: "JWT" })
            .sign(await jose.importPKCS8(SERVICE_ACCOUNT.private_key, "RS256"));

        const res = await fetch("https://oauth2.googleapis.com/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
                assertion: jwt
            })
        });
        const data: any = await res.json();
        if (!data)
            throw HttpError.createInternalServerError("Google Sheets service not available");

        return data.access_token;
    }

    /**
     * 
     * @param path エンドポイント
     * @param method メソッド GET | POST | PUT...
     * @param body 本文
     * @returns Response
     */
    private async request(path: string, method: string, body?: any) {
        const token = await this.getAccessToken();

        const url = `${BASE_URL}/${this.spreadsheetId}/${path}`;
        const headers: Record<string, string> = {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json",
            "User-Agent": "osu-denken-admin-cloudflare-worker"
        };

        return fetch(url, {
            method,
            headers, 
            body: body ? JSON.stringify(body) : undefined
        });
    }

    public async getValuesByRange(range: string) {
        const res = await this.request(`values/${range}`, "GET");
        if (!res.ok) 
            throw HttpError.createInternalServerError("Failed to fetch sheet data");

        const data: any = await res.json();
        return data.values; 
    }

    public async setValuesByRange(range: string, values: string[][]) {
        const res = await this.request(`values/${range}?valueInputOption=RAW`, "PUT", { values });
        if (!res.ok) throw HttpError.createInternalServerError("Failed to update sheet");
        return res.json();
    }

    public async getValues(sheet: string, start: string, end: string) {
        return this.getValuesByRange(`${sheet}!${start}:${end}`);
    }

    public async setValues(sheet: string, start: string, end: string, values: string[][]) {
        return this.setValuesByRange(`${sheet}!${start}:${end}`, values);
    }

    public async getValue(sheet: string, cell: string) {
        const values = await this.getValuesByRange(`${sheet}!${cell}`);
        return values?.[0]?.[0] ?? null;
    }

    public async setValue(sheet: string, cell: string, value: string) {
        return this.setValuesByRange(`${sheet}!${cell}`, [[value]]);
    }

    public async deleteValue(sheet: string, cell: string) {
        return this.setValuesByRange(`${sheet}!${cell}`, []);
    }

    public async appendValues(sheet: string, values: string[][]) {
        const res = await this.request(`values/${sheet}:append?valueInputOption=RAW`, "POST", { values });

        if (!res.ok) throw HttpError.createInternalServerError("Failed to append");
        return res.json();
    }

    /**
     * 指定列で検索して該当行を返す
     * @param sheet シート名
     * @param range 範囲 (例: "A1:C100")
     * @param columnIndex 検索する列の0始まりインデックス
     * @param value 検索する値
     */
    public async findRow(sheet: string, range: string, columnIndex: number, value: string) {
        const data = await this.getValuesByRange(`${sheet}!${range}`);
        if (!data) return null;

        return data.find((row: string[]) => row[columnIndex] === value) ?? null;
    }

    /**
     * 指定列で検索して該当行のインデックスを返す
     */
    public async findRowIndex(sheet: string, range: string, columnIndex: number, value: string) {
        const data = await this.getValuesByRange(`${sheet}!${range}`);
        if (!data) return -1;

        return data.findIndex((row: string[]) => row[columnIndex] === value);
    }
}