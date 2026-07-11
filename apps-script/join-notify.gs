/**
 * 入部申請の通知メール送信GAS
 *
 * 発行されたURLを環境変数 MAIL_WEBHOOK_URL に設定
 */

// Worker側の MAIL_WEBHOOK_SECRET と同様
const SECRET = "...";

// 通知先
const TO = "denken.club@ge.osaka-sandai.ac.jp";

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);

    if (!body || body.secret !== SECRET) return json({ ok: false, error: "forbidden" });

    GmailApp.sendEmail(TO, body.subject, body.text || "", {
      htmlBody: body.html,
      replyTo: body.replyTo,
      name: "電研 入部申請",
    });

    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
  .setMimeType(ContentService.MimeType.JSON);
}
