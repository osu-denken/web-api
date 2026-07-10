import { HttpError } from "../HttpError";
import { Member, MemberStatus, normalizeStudentId } from "../member";

type LeftStatus = Extract<MemberStatus, "withdrawn" | "graduated">;
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
     * 仮登録。承認されるまで権限は付与されない
     * @param member 学籍番号・メールアドレス・氏名・ふりがな・電話番号
     */
    public async createPreActive(member: Pick<Member, "studentId" | "email" | "name" | "furigana" | "tel">): Promise<void> {
        await this.db.prepare(
            `INSERT INTO members (student_id, email, name, furigana, tel, status) VALUES (?, ?, ?, ?, ?, 'pre-active')`
        ).bind(
            normalizeStudentId(member.studentId),
            member.email.toLowerCase(),
            member.name,
            member.furigana,
            member.tel
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
     * 役職を変更する
     * @param id 対象の部員ID
     * @param roleBits 役職ビット
     */
    public async updateRoles(id: number, roleBits: Role): Promise<void> {
        await this.db.prepare(`UPDATE members SET role_bits = ? WHERE id = ?`).bind(roleBits, id).run();
    }

    /**
     * 個人単位の追加権限を変更する
     * @param id 対象の部員ID
     * @param permBits 追加権限ビット
     */
    public async updatePermissions(id: number, permBits: Permission): Promise<void> {
        await this.db.prepare(`UPDATE members SET perm_bits = ? WHERE id = ?`).bind(permBits, id).run();
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
     * 在籍を終える (行は残す)
     * @param id 対象の部員ID
     * @param status withdrawn (退部) または graduated (卒業)
     * @param leaveDate 退部日・卒業日 (ISO8601)
     */
    public async leave(id: number, status: LeftStatus, leaveDate: string = new Date().toISOString()): Promise<void> {
        await this.db.prepare(`UPDATE members SET status = ?, leave_date = ? WHERE id = ?`)
            .bind(status, leaveDate, id).run();
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
