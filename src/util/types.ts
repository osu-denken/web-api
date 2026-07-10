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
