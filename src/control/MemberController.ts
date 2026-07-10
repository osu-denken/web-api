import { HttpError } from "../util/HttpError";
import { Member, MemberStatus, toAdminMember } from "../util/member";
import { Permission, Role } from "../util/permission";
import { MemberRepository } from "../util/service/members-d1";
import { createJsonResponse, logInfo } from "../util/utils";
import { IController } from "./IController";

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
            case "list":
                return this.list();
            case "detail":
                return this.detail();
            case "approve":
                return this.approve();
            case "reject":
                return this.reject();
            case "roles":
                return this.updateRoles();
            case "permissions":
                return this.updatePermissions();
            case "leave":
                return this.leave();
        }

        throw HttpError.createNotFound("Endpoint not found");
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
     * 1名分の全項目を返す。電話番号を含むため、誰がいつ誰の情報を開いたかを記録する
     */
    public async detail() {
        const auth = await this.checkAuthAndPermission(Permission.MemberManage);
        const target = await this.targetMember();

        await logInfo(this.request!, this.env, "member_detail",
            `Read member #${target.id} (${target.studentId}) by #${auth.member.id}`);

        return createJsonResponse({ success: true, member: target });
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
     * 役職を変更する
     */
    public async updateRoles() {
        const auth = await this.checkAuthAndPermission(Permission.MemberRoleEdit);

        const { id, roleBits } = await this.body<{ id?: number; roleBits?: number }>();
        if (typeof id !== "number" || typeof roleBits !== "number")
            throw HttpError.createBadRequest("id and roleBits are required");

        if (roleBits & ~ALL_ROLE_BITS) throw HttpError.createBadRequest("Unknown role bits");

        const target = await this.repository.requireById(id);
        await this.repository.updateRoles(target.id, roleBits as Role);
        await logInfo(this.request!, this.env, "member_roles", `Set roles ${roleBits} to #${target.id} by #${auth.member.id}`);

        return createJsonResponse({ success: true });
    }

    /**
     * 個人単位の追加権限を変更する
     */
    public async updatePermissions() {
        const auth = await this.checkAuthAndPermission(Permission.MemberPermissionEdit);

        const { id, permBits } = await this.body<{ id?: number; permBits?: number }>();
        if (typeof id !== "number" || typeof permBits !== "number")
            throw HttpError.createBadRequest("id and permBits are required");

        if (permBits & ~ALL_PERMISSION_BITS) throw HttpError.createBadRequest("Unknown permission bits");

        const target = await this.repository.requireById(id);
        await this.repository.updatePermissions(target.id, permBits as Permission);
        await logInfo(this.request!, this.env, "member_permissions", `Set permissions ${permBits} to #${target.id} by #${auth.member.id}`);

        return createJsonResponse({ success: true });
    }

    /**
     * 退部・卒業にする
     */
    public async leave() {
        const auth = await this.checkAuthAndPermission(Permission.MemberDelete);

        const { id, status, leaveDate } = await this.body<{ id?: number; status?: string; leaveDate?: string }>();
        if (typeof id !== "number") throw HttpError.createBadRequest("id is required");
        if (status !== "withdrawn" && status !== "graduated")
            throw HttpError.createBadRequest("status must be withdrawn or graduated");

        const target = await this.repository.requireById(id);

        // 自分自身を在籍から外すと権限を失って復帰できなくなる
        if (target.id === auth.member.id) throw HttpError.createBadRequest("Cannot leave yourself");

        await this.repository.leave(target.id, status, leaveDate);
        await logInfo(this.request!, this.env, "member_leave", `Set ${status} to #${target.id} by #${auth.member.id}`);

        return createJsonResponse({ success: true });
    }
}
