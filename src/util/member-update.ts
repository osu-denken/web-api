import { HttpError } from "./HttpError";
import { Member, MemberStatus, normalizeStudentEmail } from "./member";
import { hasPermission, normalizeRoles, Permission, Role } from "./permission";
import { MemberPatch } from "./service/members-d1";

/** 部員管理画面からまとめて更新できる項目 */
export interface UpdateBody {
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

/** 認証と権限解決の結果のうち、更新の可否判定に要る部分 */
interface Actor {
    member: Member;
    permissions: Permission;
}

/** 承認・却下を経ずに直接切り替えてよい在籍状態 */
const EDITABLE_STATUSES: MemberStatus[] = ["active", "withdrawn", "graduated"];

/** 電話番号の閲覧・編集は幹部に限る */
const isExecutive = (member: Member) => Boolean(normalizeRoles(member.roleBits) & Role.Executive);

/** 役職ビットと権限ビットの上限。未知のビットは受け付けない */
const ALL_ROLE_BITS = Object.values(Role).reduce<number>((a, b) => typeof b === "number" ? a | b : a, 0);
const ALL_PERMISSION_BITS = Object.values(Permission).reduce<number>((a, b) => typeof b === "number" ? a | b : a, 0);

/**
 * 更新本文から差分の patch を組み立て、項目ごとに必要な権限を検査する。
 * I/O は持たず、検査結果として MemberPatch を返すだけにとどめる。
 */
export class MemberUpdateService {
    private allowedEmailDomain: string;

    public constructor(allowedEmailDomain: string) {
        this.allowedEmailDomain = allowedEmailDomain;
    }

    /**
     * 変更のあった項目だけを取り出し、それぞれに必要な権限を検査する
     * @param body リクエスト本文
     * @param target 更新対象
     * @param actor 操作する側
     */
    public buildPatch(body: UpdateBody, target: Member, actor: Actor): MemberPatch {
        const patch: MemberPatch = {};

        if (body.name !== undefined && body.name !== target.name) {
            if (!body.name.trim()) throw HttpError.createBadRequest("name must not be empty");
            patch.name = body.name.trim();
        }

        if (body.furigana !== undefined && body.furigana !== target.furigana)
            patch.furigana = body.furigana || null;

        if (body.email !== undefined && body.email.toLowerCase() !== target.email)
            patch.email = normalizeStudentEmail(body.email, this.allowedEmailDomain);

        if (body.joinDate !== undefined && body.joinDate !== target.joinDate)
            patch.joinDate = body.joinDate || null;

        // 電話番号は幹部しか閲覧できないので、編集も幹部に限る
        if (body.tel !== undefined && body.tel !== target.tel) {
            if (!isExecutive(actor.member)) throw HttpError.createForbidden("Only executives can edit tel");
            patch.tel = body.tel || null;
        }

        if (body.roleBits !== undefined && body.roleBits !== target.roleBits) {
            this.require(actor, Permission.MemberRoleEdit);
            if (body.roleBits & ~ALL_ROLE_BITS) throw HttpError.createBadRequest("Unknown role bits");
            patch.roleBits = body.roleBits as Role;
        }

        if (body.permBits !== undefined && body.permBits !== target.permBits) {
            this.require(actor, Permission.MemberPermissionEdit);
            if (body.permBits & ~ALL_PERMISSION_BITS) throw HttpError.createBadRequest("Unknown permission bits");
            patch.permBits = body.permBits as Permission;
        }

        if (body.status !== undefined && body.status !== target.status)
            Object.assign(patch, this.statusPatch(body, target, actor));

        return patch;
    }

    /**
     * 在籍状態の変更。承認・却下は専用のエンドポイントに任せる
     */
    private statusPatch(body: UpdateBody, target: Member, actor: Actor): MemberPatch {
        this.require(actor, Permission.MemberDelete);

        if (!EDITABLE_STATUSES.includes(body.status!))
            throw HttpError.createBadRequest("status must be active, withdrawn or graduated");

        // 自分自身を在籍から外すと権限を失って復帰できなくなる
        if (target.id === actor.member.id)
            throw HttpError.createBadRequest("Cannot change your own status");

        if (body.status === "active") return { status: "active", leaveDate: null };

        return {
            status: body.status,
            leaveDate: body.leaveDate || new Date().toISOString().slice(0, 10)
        };
    }

    private require(actor: Actor, required: Permission) {
        if (!hasPermission(actor.permissions, required))
            throw HttpError.createForbidden("You are not have permissions");
    }
}
