import { HttpError } from "../util/HttpError";
import { Member, MemberStatus, normalizeStudentEmail, normalizeStudentId, toAdminMember } from "../util/member";
import { hasPermission, normalizeRoles, Permission, Role } from "../util/permission";
import { MemberPatch, MemberRepository } from "../util/service/members-d1";
import { createJsonResponse, logInfo } from "../util/utils";
import { AuthContext, IController } from "./IController";

/** 仮登録の申請本文。電話番号は任意 (本人があとで、または承認後に幹部が入れる) */
interface RegisterBody {
    name?: string;
    furigana?: string | null;
    tel?: string | null;
    birthday?: string | null;
}

interface UpdateBody {
    id?: number;
    name?: string;
    furigana?: string | null;
    email?: string;
    tel?: string | null;
    roleBits?: number;
    permBits?: number;
    status?: MemberStatus;
    joinDate?: string | null;
    leaveDate?: string | null;
}

/** 承認・却下を経ずに直接切り替えてよい在籍状態 */
const EDITABLE_STATUSES: MemberStatus[] = ["active", "withdrawn", "graduated"];

/** 電話番号の閲覧・編集は幹部に限る */
const isExecutive = (member: Member) => Boolean(normalizeRoles(member.roleBits) & Role.Executive);

/** 役職ビットと権限ビットの上限。未知のビットは受け付けない */
const ALL_ROLE_BITS = Object.values(Role).reduce<number>((a, b) => typeof b === "number" ? a | b : a, 0);
const ALL_PERMISSION_BITS = Object.values(Permission).reduce<number>((a, b) => typeof b === "number" ? a | b : a, 0);

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
        const patch = this.buildPatch(body, target, auth);

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

    /**
     * 変更のあった項目だけを取り出し、それぞれに必要な権限を検査する
     * @param body リクエスト本文
     * @param target 更新対象
     * @param auth 操作する側
     */
    private buildPatch(body: UpdateBody, target: Member, auth: AuthContext): MemberPatch {
        const patch: MemberPatch = {};

        if (body.name !== undefined && body.name !== target.name) {
            if (!body.name.trim()) throw HttpError.createBadRequest("name must not be empty");
            patch.name = body.name.trim();
        }

        if (body.furigana !== undefined && body.furigana !== target.furigana)
            patch.furigana = body.furigana || null;

        if (body.email !== undefined && body.email.toLowerCase() !== target.email)
            patch.email = normalizeStudentEmail(body.email, this.env.ALLOWED_EMAIL_DOMAIN);

        if (body.joinDate !== undefined && body.joinDate !== target.joinDate)
            patch.joinDate = body.joinDate || null;

        // 電話番号は幹部しか閲覧できないので、編集も幹部に限る
        if (body.tel !== undefined && body.tel !== target.tel) {
            if (!isExecutive(auth.member)) throw HttpError.createForbidden("Only executives can edit tel");
            patch.tel = body.tel || null;
        }

        if (body.roleBits !== undefined && body.roleBits !== target.roleBits) {
            this.require(auth, Permission.MemberRoleEdit);
            if (body.roleBits & ~ALL_ROLE_BITS) throw HttpError.createBadRequest("Unknown role bits");
            patch.roleBits = body.roleBits as Role;
        }

        if (body.permBits !== undefined && body.permBits !== target.permBits) {
            this.require(auth, Permission.MemberPermissionEdit);
            if (body.permBits & ~ALL_PERMISSION_BITS) throw HttpError.createBadRequest("Unknown permission bits");
            patch.permBits = body.permBits as Permission;
        }

        if (body.status !== undefined && body.status !== target.status)
            Object.assign(patch, this.statusPatch(body, target, auth));

        return patch;
    }

    /**
     * 在籍状態の変更。承認・却下は専用のエンドポイントに任せる
     */
    private statusPatch(body: UpdateBody, target: Member, auth: AuthContext): MemberPatch {
        this.require(auth, Permission.MemberDelete);

        if (!EDITABLE_STATUSES.includes(body.status!))
            throw HttpError.createBadRequest("status must be active, withdrawn or graduated");

        // 自分自身を在籍から外すと権限を失って復帰できなくなる
        if (target.id === auth.member.id)
            throw HttpError.createBadRequest("Cannot change your own status");

        if (body.status === "active") return { status: "active", leaveDate: null };

        return {
            status: body.status,
            leaveDate: body.leaveDate || new Date().toISOString().slice(0, 10)
        };
    }

    private require(auth: AuthContext, required: Permission) {
        if (!hasPermission(auth.permissions, required))
            throw HttpError.createForbidden("You are not have permissions");
    }
}
