export interface Env {
	// Secret
	GITHUB_TOKEN: string;
	AUTH_TOKEN: string;
	FIREBASE_API_KEY: string;
	DISCORD_INVITE: string;
	REGISTER_PASSPHRASE: string;
	TURNSTILE_SECRET_KEY: string;
	GOOGLE_DRIVE_TOKEN: string;
	SECRET_KEY: string;
	SWBOT_TOKEN: string;
	SWBOT_CLIENT_SECRET: string;

	ALLOWED_EMAIL_DOMAIN: string;

	// 登録経路の有効/無効。"true" の文字列でのみ有効。未設定は無効扱い。
	// 招待コード (invite) は常に有効で、ここでは制御しない
	ALLOW_SELF_REGISTRATION?: string;
	ALLOW_PASSPHRASE_REGISTRATION?: string;

	// 入部申請の通知メール。部の Google アカウントでデプロイした Apps Script ウェブアプリに
	// 中継させる。URL は vars、SECRET は Cloudflare secret に置く。未設定なら送らない
	MAIL_WEBHOOK_URL?: string;
	MAIL_WEBHOOK_SECRET?: string;

	// Key-Value
    BLOG_META: KVNamespace;
	INVITE_CODE: KVNamespace;
	LOGS: KVNamespace;
	CACHE: KVNamespace;
	USER_CUSTOM: KVNamespace;

	// D1
	DB: D1Database;
}

export interface SwitchBotResponse {
	statusCode: number;
	message: string;
	body: any;
}
