import { HttpError } from "../util/HttpError";
import { Member, MemberStatus, normalizeStudentEmail, normalizeStudentId, toAdminMember } from "../util/member";
import { MemberUpdateService, UpdateBody } from "../util/member-update";
import { normalizeRoles, Permission, Role } from "../util/permission";
import { MemberRepository } from "../util/service/members-d1";
import { createJsonResponse, logInfo } from "../util/utils";
import { IController } from "./IController";

/** 仮登録の申請本文。電話番号は任意 (本人があとで、または承認後に幹部が入れる) */
interface RegisterBody {
    name?: string;
    furigana?: string | null;
    tel?: string | null;
    birthday?: string | null;
}

/** 電話番号の閲覧・編集は幹部に限る */
const isExecutive = (member: Member) => Boolean(normalizeRoles(member.roleBits) & Role.Executive);

/**
 * 部員管理画面向け。名簿の全項目を返すため MemberManage 以上を要求する。
 */
export class MemberController extends IController {
    public getParentPath(): string {
        return "members";
    }

    public constructor(path: string[]) {
        super(path);
        if (path.length < 2) path[1] = "list";
    }

    public route() {
        switch (this.path[1]) {
            case "register":
                return this.register();
            case "list":
                return this.list();
            case "detail":
                return this.detail();
            case "approve":
                return this.approve();
            case "reject":
                return this.reject();
            case "update":
                return this.update();
        }

        throw HttpError.createNotFound("Endpoint not found");
    }

    /**
     * 仮登録を申請する。名簿に無い認証済みユーザーが自分で呼ぶため、
     * MemberManage ではなく認証のみを要求する。
     * 大学のメール確認を通していることを必須にし、他人の名で行を作れないようにする。
     */
    public async register() {
        const body = await this.body<RegisterBody>();

        const user = await this.checkAuth();
        if (!user.email) throw HttpError.createUnauthorized("Email is required");
        if (!user.email.endsWith(this.env.ALLOWED_EMAIL_DOMAIN))
            throw HttpError.createBadRequest(`Email must be from ${this.env.ALLOWED_EMAIL_DOMAIN} domain`);

        // メール確認を通すまで名簿に入れない。ここが本人性の担保になる
        if (!user.emailVerified) throw HttpError.createForbidden("Email must be verified before registration");

        if (!body.name?.trim()) throw HttpError.createBadRequest("name is required");

        // 学籍番号はメールアドレスから導く。本人の申告に頼らない
        const email = normalizeStudentEmail(user.email, this.env.ALLOWED_EMAIL_DOMAIN);
        const studentId = normalizeStudentId(email.split("@")[0]);

        await this.ensureNotRegistered(user.localId, studentId);

        await this.repository.createPreActive({
            studentId,
            email,
            name: body.name.trim(),
            furigana: body.furigana?.trim() || null,
            tel: body.tel?.trim() || null,
            localId: user.localId,
            customData: body.birthday ? { birthday: body.birthday } : {}
        });

        await logInfo(this.request!, this.env, "member_register", `Provisional register "${studentId}" (${email})`);

        return createJsonResponse({ success: true });
    }

    /**
     * 二重登録を防ぐ。同じ Firebase アカウントや学籍番号が既にあれば弾く
     * @param localId Firebase Local ID
     * @param studentId 学籍番号
     */
    private async ensureNotRegistered(localId: string, studentId: string): Promise<void> {
        if (await this.repository.findByLocalId(localId))
            throw HttpError.createBadRequest("Already registered");

        if (await this.repository.findByStudentId(studentId))
            throw HttpError.createBadRequest("This student ID is already registered");
    }

    private get repository(): MemberRepository {
        if (!this.members) throw HttpError.createInternalServerError("Member repository not initialized");
        return this.members;
    }

    /**
     * POST の本文を読む
     */
    private async body<T>(): Promise<T> {
        if (this.request?.method !== "POST") throw HttpError.createMethodNotAllowedPostOnly();
        return await this.request.json() as T;
    }

    /**
     * 操作対象の部員を本文の id から引く
     */
    private async targetMember(): Promise<Member> {
        const { id } = await this.body<{ id?: number }>();
        if (typeof id !== "number") throw HttpError.createBadRequest("id is required");

        return await this.repository.requireById(id);
    }

    /**
     * 名簿を一覧する (電話番号は含まない)
     */
    public async list() {
        await this.checkAuthAndPermission(Permission.MemberManage);

        const status = this.url?.searchParams.get("status") as MemberStatus | null;
        const rows = await this.repository.list(status ?? undefined);

        return createJsonResponse({ success: true, members: rows.map(toAdminMember) });
    }

    /**
     * 1名分を返す。電話番号は幹部の役職を持つ者にしか開示せず、開示は監査ログに残す
     */
    public async detail() {
        const auth = await this.checkAuthAndPermission(Permission.MemberManage);
        const target = await this.targetMember();

        // 電話番号は重大な個人情報。MemberManage を個人付与された非幹部には見せない
        const canSeeTel = isExecutive(auth.member);

        await logInfo(this.request!, this.env, "member_detail",
            `Read member #${target.id} (${target.studentId}) by #${auth.member.id}` +
            `${canSeeTel ? " with tel" : ""}`);

        return createJsonResponse({
            success: true,
            member: canSeeTel ? target : { ...target, tel: null },
            canEditTel: canSeeTel
        });
    }

    /**
     * 仮登録を承認して部員にする
     */
    public async approve() {
        const auth = await this.checkAuthAndPermission(Permission.MemberApprove);
        const target = await this.targetMember();

        if (target.status !== "pre-active")
            throw HttpError.createBadRequest("Member is not pre-active");

        await this.repository.approve(target.id, auth.member.id);
        await logInfo(this.request!, this.env, "member_approve", `Approve member #${target.id} by #${auth.member.id}`);

        return createJsonResponse({ success: true });
    }

    /**
     * 仮登録を却下する
     */
    public async reject() {
        const auth = await this.checkAuthAndPermission(Permission.MemberApprove);
        const target = await this.targetMember();

        if (target.status !== "pre-active")
            throw HttpError.createBadRequest("Member is not pre-active");

        await this.repository.reject(target.id);
        await logInfo(this.request!, this.env, "member_reject", `Reject member #${target.id} by #${auth.member.id}`);

        return createJsonResponse({ success: true });
    }

    /**
     * 変更のあった項目をまとめて更新する。項目ごとに必要な権限が異なる
     */
    public async update() {
        const auth = await this.checkAuthAndPermission(Permission.MemberManage);

        const body = await this.body<UpdateBody>();
        if (typeof body.id !== "number") throw HttpError.createBadRequest("id is required");

        const target = await this.repository.requireById(body.id);
        const updater = new MemberUpdateService(this.env.ALLOWED_EMAIL_DOMAIN);
        const patch = updater.buildPatch(body, target, auth);

        try {
            await this.repository.update(target.id, patch);
        } catch (e: any) {
            // email は UNIQUE。他の部員と衝突したら利用者に伝わる形で返す
            if (String(e?.message).includes("UNIQUE")) throw HttpError.createBadRequest("Email is already used");
            throw e;
        }

        await logInfo(this.request!, this.env, "member_update",
            `Update member #${target.id} (${Object.keys(patch).join(",")}) by #${auth.member.id}`);

        return createJsonResponse({ success: true });
    }
}
