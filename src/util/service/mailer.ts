import { Env } from "../types";

/** 入部申請の通知メールに載せる内容 */
export interface JoinNotification {
    studentId: string;
    email: string;
    name: string;
    furigana?: string | null;
    birthday?: string | null;
    tel?: string | null;
    hobby?: string | null;
    wish?: string | null;
    note?: string | null;
}

const escapeHtml = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * 入部申請 (仮登録) が届いたことを部のメールへ通知する。
 *
 * 送信は Google Apps Script のウェブアプリに中継させる (部の Google アカウントで
 * デプロイした doPost が GmailApp で送る)。これにより独自ドメインや有料の
 * メール送信サービスが要らない。
 *
 * MAIL_WEBHOOK_URL / MAIL_WEBHOOK_SECRET が未設定なら何もしない。
 * 仮登録そのものは成功させたいので、送信失敗も握りつぶす。
 * @param env 環境変数群
 * @param data 申請内容
 */
export async function sendJoinNotification(env: Env, data: JoinNotification): Promise<void> {
    if (!env.MAIL_WEBHOOK_URL || !env.MAIL_WEBHOOK_SECRET) return;

    const rows: [string, string | null | undefined][] = [
        ["学籍番号", data.studentId],
        ["メールアドレス", data.email],
        ["氏名", data.name],
        ["フリガナ", data.furigana],
        ["生年月日", data.birthday],
        ["電話番号", data.tel],
        ["趣味・特技", data.hobby],
        ["やってみたいこと", data.wish],
        ["連絡事項", data.note],
    ];

    const shown = rows.map(([k, v]) => [k, v?.trim() ? v.trim() : "(未入力)"] as const);

    const text = `入部申請（仮登録）が届きました。\n\n`
        + shown.map(([k, v]) => `${k}: ${v}`).join("\n") + "\n";

    const html = `<h2>入部申請（仮登録）が届きました</h2>`
        + `<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse">`
        + shown.map(([k, v]) => `<tr><th align="left">${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`).join("")
        + `</table>`;

    try {
        await fetch(env.MAIL_WEBHOOK_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                secret: env.MAIL_WEBHOOK_SECRET,
                subject: `【入部申請】${data.name}（${data.studentId}）`,
                text,
                html,
                // 返信すると申請者本人へ届くように
                replyTo: data.email
            })
        });
    } catch (e) {
        console.error("Failed to send join notification email:", e);
    }
}
