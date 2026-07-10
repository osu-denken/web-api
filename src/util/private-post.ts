import { HttpError } from "./HttpError";

/** 非公開記事。本文は D1 に持つ */
export interface PrivatePost {
    id: number;
    slug: string;
    title: string;
    content: string;
    authorId: number;
    authorName: string;
    createdAt: string;
    updatedAt: string;
}

/** 一覧に載せる項目。本文は含まない */
export type PrivatePostSummary = Omit<PrivatePost, "content">;

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

/**
 * スラッグを検証する。URL とテーブルのキーを兼ねるので文字種を絞る
 * @param input 入力されたスラッグ
 * @returns 正規化したスラッグ
 */
export function normalizeSlug(input: string): string {
    const slug = input.trim().toLowerCase();
    if (!SLUG_PATTERN.test(slug))
        throw HttpError.createBadRequest("slug must be lowercase alphanumerics and hyphens");

    return slug;
}

/**
 * 本文を除いた一覧用の形にする
 * @param post 非公開記事
 */
export function toSummary(post: PrivatePost): PrivatePostSummary {
    const { content, ...summary } = post;
    return summary;
}
