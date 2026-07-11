import { HttpError } from "../HttpError";

const BASE_URL = "https://identitytoolkit.googleapis.com/v1/accounts";

export interface FirebaseUser {
    localId: string;
    email?: string;
    displayName?: string;
    emailVerified?: boolean;
    createdAt?: string;
    lastLoginAt?: string;
}

/**
 * accounts:lookup の生レスポンスには passwordHash と salt が含まれるため、
 * クライアントへ渡ってよいフィールドだけを写し取る。
 */
function toFirebaseUser(raw: any): FirebaseUser {
    return {
        localId: raw.localId,
        email: raw.email,
        displayName: raw.displayName,
        emailVerified: raw.emailVerified,
        createdAt: raw.createdAt,
        lastLoginAt: raw.lastLoginAt
    };
}

export class FirebaseService {
    private apiKey: string;

    constructor(apiKey: string) {
        this.apiKey = apiKey;
    }

    private async request(endpoint: string, body?: any) {
        const url = `${BASE_URL}:${endpoint}?key=${this.apiKey}`;
        const headers: Record<string, string> = {
            "Content-Type": "application/json",
            "User-Agent": "osu-denken-admin-cloudflare-worker"
        };
        return fetch(url, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
        });   
    }

    async registerUser(email: string, password: string) {
        const res = await this.request("signUp", {
            email,
            password,
            returnSecureToken: true
        });
        return await res.json();
    }

    async loginUser(email: string, password: string) {
        const res = await this.request("signInWithPassword", {
            email,
            password,
            returnSecureToken: true
        });
        return await res.json();
    }

    async updateUser(idToken: string, displayName?: string, photoUrl?: string, password?: string) {
        const body: { idToken: string; displayName?: string; photoUrl?: string; password?: string; returnSecureToken: boolean } = {
            idToken,
            returnSecureToken: true
        };
        if (displayName) body.displayName = displayName;
        if (photoUrl) body.photoUrl = photoUrl;
        if (password) body.password = password;

        const res = await this.request("update", body);
        return await res.json();
    }

    async resetPassword(email: string) {
        const res = await this.request("sendOobCode", {
            requestType: "PASSWORD_RESET",
            email
        });
        return await res.json();
    }

    /**
     * 確認メールを送る。大学のメールボックスを開けることの確認に使う
     * @param idToken 登録直後のユーザーの ID トークン
     */
    async sendVerifyEmail(idToken: string) {
        const res = await this.request("sendOobCode", {
            requestType: "VERIFY_EMAIL",
            idToken
        });
        return await res.json();
    }

    /**
     * Google などの IdP が発行した ID トークンを Firebase のトークンに交換する。
     * アカウントが無ければ作成される。署名検証は Identity Toolkit 側が行う。
     * @param providerIdToken IdP (Google) の ID トークン
     * @param providerId 例: "google.com"
     * @param requestUri 認証済みドメインのURL (Firebase の承認済みドメインに含まれること)
     */
    async signInWithIdp(providerIdToken: string, providerId: string, requestUri: string) {
        const res = await this.request("signInWithIdp", {
            postBody: `id_token=${encodeURIComponent(providerIdToken)}&providerId=${encodeURIComponent(providerId)}`,
            requestUri,
            returnSecureToken: true,
            returnIdpCredential: true
        });
        return await res.json();
    }

    async verifyIdToken(idToken: string): Promise<FirebaseUser> {
        const res = await this.request("lookup", { idToken });
        const data: any = await res.json();

        if (!res.ok || !data.users || data.users.length === 0) throw HttpError.createUnauthorizedInvalidToken();

        const result = data.users[0];

        if (!result) throw HttpError.createUnauthorizedInvalidToken();
        if (result.disabled) throw HttpError.createForbidden("User account is disabled");

        return toFirebaseUser(result);
    }

    async existUser(email: string): Promise<boolean> {
        const res = await this.request("lookup", { email });
        const data: any = await res.json();

        if (data.error && data.error.message === "EMAIL_NOT_FOUND") 
            return false;

        if (data.users && data.users.length > 0) {
            return true;
        }

        return false;
    }

    private async requestRefresh(refreshToken: string) {
        const url = `https://securetoken.googleapis.com/v1/token?key=${this.apiKey}`;
        const headers: Record<string, string> = {
            "Content-Type": "application/json",
            "User-Agent": "osu-denken-admin-cloudflare-worker"
        };
        return fetch(url, {
            method: "POST",
            headers,
            body: JSON.stringify({
                grant_type: "refresh_token",
                refresh_token: refreshToken
            }),
        });
    }

    async refreshToken(refreshToken: string) {
        const res = await this.requestRefresh(refreshToken);
        return await res.json();
    }
}