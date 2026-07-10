import { Env } from "../types";

/**
 * 有効化済みの TOTP 設定
 */
export interface TotpConfig {
    /** SECRET_KEY で暗号化した Base32 シークレット */
    secretEncoded: string;
    enabledAt: string;
    /** リカバリコードの SHA-256 ハッシュ。平文は発行時に一度しか見せない */
    recoveryCodeHashes: string[];
    /** 直近で受理したタイムステップ。同じコードの使い回しを弾く */
    lastUsedStep?: number;
}

/**
 * 有効化前の TOTP 設定。認証アプリの登録が済んだことをコードで確認できるまでここに置く
 */
export interface TotpPending {
    secretEncoded: string;
    createdAt: string;
}

/**
 * USER_CUSTOM KV に入るユーザー固有データ。
 * 役職と権限は名簿 (D1) が真実の源なのでここには置かない。
 */
export interface UserCustom {
    githubTokenEncoded?: string;
    totp?: TotpConfig;
    totpPending?: TotpPending;
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
