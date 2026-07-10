import { HttpError } from "../HttpError";
import { PrivatePost } from "../private-post";

interface PrivatePostRow {
    id: number;
    slug: string;
    title: string;
    content: string;
    author_id: number;
    author_name: string;
    created_at: string;
    updated_at: string;
}

const toPrivatePost = (row: PrivatePostRow): PrivatePost => ({
    id: row.id,
    slug: row.slug,
    title: row.title,
    content: row.content,
    authorId: row.author_id,
    authorName: row.author_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at
});

/** 記事を書いた部員。上書き時に更新者へ差し替える */
export interface PrivatePostAuthor {
    id: number;
    name: string;
}

export class PrivatePostRepository {
    private db: D1Database;

    public constructor(db: D1Database) {
        this.db = db;
    }

    /**
     * 更新の新しい順に一覧する。本文は載せない
     */
    public async list(): Promise<PrivatePost[]> {
        const { results } = await this.db
            .prepare(`SELECT * FROM private_posts ORDER BY updated_at DESC`)
            .all<PrivatePostRow>();

        return results.map(toPrivatePost);
    }

    /**
     * スラッグで引く
     * @param slug 正規化済みのスラッグ
     */
    public async findBySlug(slug: string): Promise<PrivatePost | null> {
        const row = await this.db.prepare(`SELECT * FROM private_posts WHERE slug = ?`)
            .bind(slug)
            .first<PrivatePostRow>();

        return row ? toPrivatePost(row) : null;
    }

    /**
     * スラッグで引く。無ければ 404
     * @param slug 正規化済みのスラッグ
     */
    public async requireBySlug(slug: string): Promise<PrivatePost> {
        const post = await this.findBySlug(slug);
        if (!post) throw HttpError.createNotFound(`Private post "${slug}" not found`);

        return post;
    }

    /**
     * 新規作成または上書き。作成日時は最初に書いた者のものを残す
     * @param slug 正規化済みのスラッグ
     * @param title 表題
     * @param content Markdown の本文
     * @param author 書き込んだ部員
     */
    public async upsert(slug: string, title: string, content: string, author: PrivatePostAuthor): Promise<void> {
        await this.db.prepare(
            `INSERT INTO private_posts (slug, title, content, author_id, author_name) VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(slug) DO UPDATE SET
                title = excluded.title,
                content = excluded.content,
                author_id = excluded.author_id,
                author_name = excluded.author_name,
                updated_at = datetime('now')`
        ).bind(slug, title, content, author.id, author.name).run();
    }

    /**
     * 削除する
     * @param slug 正規化済みのスラッグ
     */
    public async remove(slug: string): Promise<void> {
        await this.db.prepare(`DELETE FROM private_posts WHERE slug = ?`).bind(slug).run();
    }
}
