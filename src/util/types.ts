export interface Env {
	// Secret
	GITHUB_TOKEN: string;
	AUTH_TOKEN: string;
	FIREBASE_API_KEY: string;
	DISCORD_INVITE: string;
	REGISTER_PASSPHRASE: string;
	GOOGLE_DRIVE_TOKEN: string;
	GOOGLE_SA_KEY: string;

	MEMBERS_SPREADSHEET_ID: string;

	// Key-Value
    BLOG_META: KVNamespace;
	INVITE_CODE: KVNamespace;
	LOGS: KVNamespace;
}