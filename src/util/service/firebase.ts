import { HttpError } from "../HttpError";

const BASE_URL = "https://identitytoolkit.googleapis.com/v1/accounts";

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

    async verifyIdToken(idToken: string) {
        const res = await this.request("lookup", { idToken });
        const data: any = await res.json();

        if (!res.ok || !data.users || data.users.length === 0) {
            return data; // 無効
        }

        let result = data.users[0];

        if (!result) throw HttpError.createUnauthorizedInvalidToken();
        if (result.disabled) throw HttpError.createForbidden("User account is disabled");
        if (result.error && result.error.message === "INVALID_ID_TOKEN") throw HttpError.createUnauthorizedInvalidToken();

        return result; // ユーザー情報
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
}