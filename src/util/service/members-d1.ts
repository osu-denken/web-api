import { HttpError } from "../HttpError";
import { Member, MemberStatus, normalizeStudentId } from "../member";

type LeftStatus = Extract<MemberStatus, "withdrawn" | "graduated">;

/** 部員管理画面からまとめて更新できる項目 */
export interface MemberPatch {
    name?: string;
    furigana?: string | null;
    email?: string;
    tel?: string | null;
    roleBits?: Role;
    permBits?: Permission;
    status?: MemberStatus;
    joinDate?: string | null;
    leaveDate?: string | null;
}
import { Permission, Role } from "../permission";

interface MemberRow {
    id: number;
    student_id: string;
    email: string;
    local_id: string | null;
    name: string;
    furigana: string | null;
    tel: string | null;
    status: MemberStatus;
    role_bits: number;
    perm_bits: number;
    join_date: string | null;
    leave_date: string | null;
    approved_by: number | null;
    approved_at: string | null;
    custom_data: string;
}

const toMember = (row: MemberRow): Member => ({
    id: row.id,
    studentId: row.student_id,
    email: row.email,
    localId: row.local_id,
    name: row.name,
    furigana: row.furigana,
    tel: row.tel,
    status: row.status,
    roleBits: row.role_bits as Role,
    permBits: row.perm_bits as Permission,
    joinDate: row.join_date,
    leaveDate: row.leave_date,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    customData: JSON.parse(row.custom_data || `{}`)
});

const SELECT_ALL = `SELECT * FROM members`;

export class MemberRepository {
    private db: D1Database;

    public constructor(db: D1Database) {
        this.db = db;
    }

    /**
     * IDで引く。居なければ 404
     * @param id 部員ID
     */
    public async requireById(id: number): Promise<Member> {
        const row = await this.db.prepare(`${SELECT_ALL} WHERE id = ?`).bind(id).first<MemberRow>();
        if (!row) throw HttpError.createNotFound(`Member #${id} not found`);

        return toMember(row);
    }

    /**
     * メールアドレスで引く
     * @param email 大学付与のメールアドレス
     */
    public async findByEmail(email: string): Promise<Member | null> {
        const row = await this.db.prepare(`${SELECT_ALL} WHERE email = ?`)
            .bind(email.toLowerCase())
            .first<MemberRow>();

        return row ? toMember(row) : null;
    }

    /**
     * Firebase のアカウントで引く。メールアドレス変更に影響されない
     * @param localId Firebase Local ID
     */
    public async findByLocalId(localId: string): Promise<Member | null> {
        const row = await this.db.prepare(`${SELECT_ALL} WHERE local_id = ?`)
            .bind(localId)
            .first<MemberRow>();

        return row ? toMember(row) : null;
    }

    /**
     * 学籍番号で引く
     * @param studentId 学籍番号
     */
    public async findByStudentId(studentId: string): Promise<Member | null> {
        const row = await this.db.prepare(`${SELECT_ALL} WHERE student_id = ?`)
            .bind(normalizeStudentId(studentId))
            .first<MemberRow>();

        return row ? toMember(row) : null;
    }

    /**
     * メールアドレスで引く。居なければ 404
     * @param email 大学付与のメールアドレス
     */
    public async requireByEmail(email: string): Promise<Member> {
        const member = await this.findByEmail(email);
        if (!member) throw HttpError.createNotFound(`Member ${email} not found`);

        return member;
    }

    /**
     * 名簿の一覧
     * @param status 絞り込む承認状態。省略時は全件
     */
    public async list(status?: MemberStatus): Promise<Member[]> {
        const query = status
            ? this.db.prepare(`${SELECT_ALL} WHERE status = ? ORDER BY student_id`).bind(status)
            : this.db.prepare(`${SELECT_ALL} ORDER BY student_id`);

        const { results } = await query.all<MemberRow>();
        return results.map(toMember);
    }

    /**
     * 承認済みの部員数
     */
    public async countActive(): Promise<number> {
        const row = await this.db.prepare(`SELECT COUNT(*) AS count FROM members WHERE status = 'active'`)
            .first<{ count: number }>();

        return row?.count ?? 0;
    }

    /**
     * 仮登録。承認されるまで権限は付与されない。
     * 本人が認証済みで登録するので、その時点で Firebase と紐づける
     * @param member 学籍番号・メールアドレス・氏名・ふりがな・電話番号・Firebase Local ID・任意項目
     */
    public async createPreActive(
        member: Pick<Member, "studentId" | "email" | "name" | "furigana" | "tel" | "localId" | "customData">
    ): Promise<void> {
        await this.db.prepare(
            `INSERT INTO members (student_id, email, name, furigana, tel, local_id, custom_data, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'pre-active')`
        ).bind(
            normalizeStudentId(member.studentId),
            member.email.toLowerCase(),
            member.name,
            member.furigana,
            member.tel,
            member.localId,
            JSON.stringify(member.customData ?? {})
        ).run();
    }

    /**
     * 仮登録を承認して部員にする
     * @param id 対象の部員ID
     * @param approvedBy 承認した部員のID
     */
    public async approve(id: number, approvedBy: number): Promise<void> {
        const now = new Date().toISOString();

        await this.db.prepare(
            `UPDATE members SET status = 'active', role_bits = ?, join_date = COALESCE(join_date, ?),
             approved_by = ?, approved_at = ?
             WHERE id = ? AND status = 'pre-active'`
        ).bind(Role.Member, now, approvedBy, now, id).run();
    }

    /**
     * 変更のあった項目だけをまとめて更新する
     * @param id 対象の部員ID
     * @param patch 更新する項目
     */
    public async update(id: number, patch: MemberPatch): Promise<void> {
        const columns: [keyof MemberPatch, string][] = [
            ["name", "name"],
            ["furigana", "furigana"],
            ["email", "email"],
            ["tel", "tel"],
            ["roleBits", "role_bits"],
            ["permBits", "perm_bits"],
            ["status", "status"],
            ["joinDate", "join_date"],
            ["leaveDate", "leave_date"],
        ];

        const assignments: string[] = [];
        const values: unknown[] = [];

        for (const [key, column] of columns) {
            if (patch[key] === undefined) continue;

            assignments.push(`${column} = ?`);
            values.push(patch[key]);
        }

        if (assignments.length === 0) return;

        await this.db.prepare(`UPDATE members SET ${assignments.join(", ")} WHERE id = ?`)
            .bind(...values, id).run();
    }

    /**
     * Firebase のアカウントと名簿を紐づける
     * @param id 対象の部員ID
     * @param localId Firebase Local ID
     */
    public async linkLocalId(id: number, localId: string): Promise<void> {
        await this.db.prepare(`UPDATE members SET local_id = ? WHERE id = ?`).bind(localId, id).run();
    }

    /**
     * 仮登録を却下する
     * @param id 対象の部員ID
     */
    public async reject(id: number): Promise<void> {
        await this.db.prepare(`UPDATE members SET status = 'rejected' WHERE id = ? AND status = 'pre-active'`)
            .bind(id).run();
    }

    /**
     * 任意項目を更新する
     * @param id 対象の部員ID
     * @param customData JSON として保存する任意項目
     */
    public async updateCustomData(id: number, customData: Record<string, any>): Promise<void> {
        await this.db.prepare(`UPDATE members SET custom_data = ? WHERE id = ?`)
            .bind(JSON.stringify(customData), id).run();
    }
}
