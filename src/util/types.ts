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

	// GitHub OAuth App。CLIENT_ID は vars、CLIENT_SECRET は Cloudflare secret に置く。
	// 未設定なら「GitHubで接続」機能は無効 (PAT 手入力は引き続き使える)
	GITHUB_OAUTH_CLIENT_ID?: string;
	GITHUB_OAUTH_CLIENT_SECRET?: string;
	// 要求スコープ。未設定なら "public_repo read:org"
	GITHUB_OAUTH_SCOPE?: string;
	// 連携完了後に戻すサイトのオリジン。未設定なら本番ドメイン
	SITE_ORIGIN?: string;

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
