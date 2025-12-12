export interface Env {
	GITHUB_TOKEN: string;
	AUTH_TOKEN: string;
	FIREBASE_API_KEY: string;
	DISCORD_INVITE: string;
	REGISTER_PASSPHRASE: string;
	GOOGLE_DRIVE_TOKEN: string;

    BLOG_META: KVNamespace;
	INVITE_CODE: KVNamespace;
	LOGS: KVNamespace;
}