import { Env } from "../types";

/**
 * USER_CUSTOM KV に入るユーザー固有データ。
 * 役職と権限は名簿 (D1) が真実の源なのでここには置かない。
 */
export interface UserCustom {
    githubTokenEncoded?: string;
}

export class UserCustomService {
    private env: Env;

    public constructor(env: Env) {
        this.env = env;
    }

    /**
     * ユーザー固有データを読む
     * @param localId Firebase Local ID
     */
    public async get(localId: string): Promise<UserCustom> {
        const raw = await this.env.USER_CUSTOM.get(localId);
        return JSON.parse(raw ?? `{}`);
    }

    /**
     * ユーザー固有データを書く
     * @param localId Firebase Local ID
     * @param data ユーザー固有データ
     */
    public async put(localId: string, data: UserCustom) {
        await this.env.USER_CUSTOM.put(localId, JSON.stringify(data, null, 2));
    }
}
