import { Permission, Role, resolvePermissions } from "./permission";

/**
 * 在籍状態。
 * pre-active: 仮登録 (承認待ち) / active: 在籍中 / withdrawn: 退部 /
 * graduated: 卒業 / rejected: 仮登録が却下された
 */
export type MemberStatus = "pre-active" | "active" | "withdrawn" | "graduated" | "rejected";

/** 在籍中でなくなった状態。leave_date を持つ */
export const LEFT_STATUSES: readonly MemberStatus[] = ["withdrawn", "graduated"];

export interface Member {
    id: number;
    studentId: string;
    email: string;
    localId: string | null;
    name: string;
    furigana: string | null;
    tel: string | null;
    status: MemberStatus;
    roleBits: Role;
    permBits: Permission;
    joinDate: string | null;
    leaveDate: string | null;
    approvedBy: number | null;
    approvedAt: string | null;
    customData: Record<string, any>;
}

/** 名簿から外部へ返してよい項目 (部員内であっても取り扱いに注意) */
export interface PublicMember {
    studentId: string;
    name: string;
    furigana: string | null;
    status: MemberStatus;
    roleBits: Role;
    joinDate: string | null;
    leaveDate: string | null;
}

/**
 * 学籍番号の正規化。先頭の s を落として大文字に揃える
 * @param studentId 学籍番号
 */
export function normalizeStudentId(studentId: string): string {
    const trimmed = studentId.trim();
    const withoutPrefix = trimmed.startsWith("s") || trimmed.startsWith("S")
        ? trimmed.slice(1)
        : trimmed;

    return withoutPrefix.toUpperCase();
}

/**
 * 実効権限。承認済みの部員でなければ一切の権限を持たない
 * @param member 部員
 */
export function effectivePermissions(member: Member): Permission {
    if (member.status !== "active") return Permission.None;

    return resolvePermissions(member.roleBits, member.permBits);
}

/**
 * 名簿の公開用の写像。電話番号とメールアドレスは含めない
 * @param member 部員
 */
export function toPublicMember(member: Member): PublicMember {
    return {
        studentId: member.studentId,
        name: member.name,
        furigana: member.furigana,
        status: member.status,
        roleBits: member.roleBits,
        joinDate: member.joinDate,
        leaveDate: member.leaveDate
    };
}
