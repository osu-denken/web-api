import { HttpError } from "../HttpError";
import { normalizeStudentEmail } from "../member";
import { Env } from "../types";
import { logInfo, timingSafeEqual } from "../utils";
import { FirebaseService } from "./firebase";
import { RateLimiter } from "./rate-limit";
import { TurnstileService } from "./turnstile";

/** 登録リクエストの本文 */
export interface RegisterBody {
    email?: string;
    password?: string;
    passphrase?: string;
    turnstileToken?: string;
}

/** 登録経路。招待は部員が門番、自己登録は Turnstile とメール確認が門番 */
type RegisterMode = "master" | "invite" | "self";

/**
 * 新規ユーザー登録。合言葉・招待コード・自己登録の3経路を扱い、
 * 自己登録にだけ bot 確認と確認メールを課す。
 */
export class RegistrationService {
    private env: Env;
    private request: Request;
    private firebase: FirebaseService;

    public constructor(env: Env, request: Request, firebase: FirebaseService) {
        this.env = env;
        this.request = request;
        this.firebase = firebase;
    }

    /**
     * 登録経路を見分ける。
     * 空の合言葉・空のシークレットをマスター一致と誤認しないよう、両方が非空であることを要る
     * @param passphrase 入力された合言葉または招待コード
     */
    private async classify(passphrase?: string): Promise<RegisterMode> {
        const isMaster = Boolean(passphrase) && Boolean(this.env.REGISTER_PASSPHRASE)
            && timingSafeEqual(passphrase!, this.env.REGISTER_PASSPHRASE);
        if (isMaster) return "master";

        if (passphrase && await this.env.INVITE_CODE.get(passphrase)) return "invite";

        // 合言葉を出したのに一致しなかった場合は、無言で自己登録に落とさず弾く
        if (passphrase) throw new HttpError(403, "FORBIDDEN", "Invalid passphrase or invite code");

        return "self";
    }

    /**
     * その登録経路が config で有効か。招待コードは常に有効。
     * 自己登録と合言葉は既定オフで、env が "true" のときだけ通す
     * @param mode 登録経路
     */
    private isModeEnabled(mode: RegisterMode): boolean {
        if (mode === "invite") return true;
        if (mode === "self") return this.env.ALLOW_SELF_REGISTRATION === "true";
        if (mode === "master") return this.env.ALLOW_PASSPHRASE_REGISTRATION === "true";
        return false;
    }

    /**
     * ユーザーを登録する
     * @param body 登録リクエストの本文
     */
    public async register(body: RegisterBody): Promise<any> {
        await new RateLimiter(this.env).consume(this.request, "registerIp");

        const mode = await this.classify(body.passphrase);

        // 無効化された経路 (既定では self と master) は、コードは残しつつ config で塞ぐ
        if (!this.isModeEnabled(mode))
            throw new HttpError(403, "REGISTRATION_DISABLED", `Registration via ${mode} is disabled`);

        // 招待経由は部員が門番になっているので、bot 確認は開かれた自己登録にだけ課す
        if (mode === "self")
            await new TurnstileService(this.env.TURNSTILE_SECRET_KEY)
                .verify(body.turnstileToken, this.request.headers.get("CF-Connecting-IP"));

        if (!body.email || !body.password)
            throw new HttpError(400, "BAD_REQUEST", "email and password are required");

        const email = normalizeStudentEmail(body.email, this.env.ALLOWED_EMAIL_DOMAIN);
        await new RateLimiter(this.env).consume(this.request, "register", email);

        const data: any = await this.firebase.registerUser(email, body.password);
        data.success = true;

        // 自己登録は本人確認が済んでいないので、確認メールを送って verified を待つ
        if (mode === "self" && data.idToken) {
            await this.firebase.sendVerifyEmail(data.idToken);
            data.verificationRequired = true;
        }

        if (mode === "invite")
            await this.env.INVITE_CODE.delete(body.passphrase!);

        const via = mode === "master" ? "REGISTER_PASSPHRASE" : mode === "invite" ? body.passphrase : "self-register";
        await logInfo(this.request, this.env, "register", `Register user "${email}" with code: ${via}`);

        return data;
    }
}
