import { base642txt,
  createJsonResponse, createJsonResponseRaw,
  parseFrontMatter, createFrontMatter,
  logInfo,
  generateInviteCode,
} from "./utils";
import { Env } from "./types";
import { GitHubService } from "./service/github";
import { FirebaseService } from "./service/firebase";

async function getFileFromDrive(env: Env, fileId: string) {
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: {
      "Authorization": `Bearer ${env.GOOGLE_DRIVE_TOKEN}`
    }
  });

  if (!res.ok) throw new Error("Failed to fetch file");
  return await res.text();
}

export default {
	async fetch(request: Request, env: Env, ctx: any): Promise<Response> {
		if (!env.GITHUB_TOKEN) return new Response("GITHUB_TOKEN is not set", { status: 500 });
		const github = new GitHubService(env.GITHUB_TOKEN);
		const firebase = new FirebaseService(env.FIREBASE_API_KEY);

		const url = new URL(request.url);
		const pathname: string = url.pathname;

		if (request.method === "OPTIONS") {
			return new Response(null, { status: 204, headers: {
				"Access-Control-Allow-Origin": "*",
				"Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
				"Access-Control-Allow-Headers": "Content-Type, Authorization, page",
			}});
		}

		try {
			if (pathname === "/") {
				return new Response("Welcome to osu-denken api!", { status: 200 });
			}

			if (pathname === "/ping") {
				return new Response("pong", { status: 200 });
			}

			// user api
			if (pathname === "/user/exists") {
				if (request.method !== "POST") {
					return createJsonResponse(405, "Method Not Allowed", { error: "Only POST method is allowed" });
				}

				let { email } = await request.json() as { email: string };
				if (!email) {
					return createJsonResponse(400, "Bad Request", { error: "email is required" });
				}

				if (!email.includes("@")) email = email + `@ge.osaka-sandai.ac.jp`;

				if (!email.match(/@(.+?)\.osaka-sandai\.ac\.jp$/)) {
					return createJsonResponse(400, "Bad Request", { error: "Email must be from osaka-sandai.ac.jp domain" });
				}

				// すべて小文字にし、先頭にsがなければsを追加する。
				email = email.toLowerCase();
				if (!email.startsWith("s")) {
					email = `s` + email;
				}

				return createJsonResponseRaw({ exists: firebase.existUser(email) });
			}

			if (pathname === "/invite/create") {
				if (request.method !== "POST") {
					return createJsonResponse(405, "Method Not Allowed", { error: "Only POST method is allowed" });
				}

				let idToken = request.headers.get("Authorization");
				if (!idToken) {
					return createJsonResponse(401, "Unauthorized", { error: "Authorization header is required" });
				}
				idToken = idToken.replace("Bearer ", "");

				const data: any = await firebase.verifyIdToken(idToken);

				if (!data) {
					return createJsonResponse(401, "Unauthorized", { error: "Invalid idToken" });
				}

				if (data.disabled) {
					return createJsonResponse(403, "Forbidden", { error: "User account is disabled" });
				}

				if (data.error && data.error.message === "INVALID_ID_TOKEN") {
					return createJsonResponse(401, "Unauthorized", { error: "Invalid idToken" });
				}

				const code = generateInviteCode(12);

				// 24h 有効
				await env.INVITE_CODE.put(code, data.localId, { expirationTtl: 86400 });
				await logInfo(request, env, "invite", `Create invite-code "${code}" by ${data.localId}: ${code}`);

				return createJsonResponseRaw({ code, success: true });
			}

			if (pathname === "/invite/validate") {
				if (request.method !== "POST") {
					return createJsonResponse(405, "Method Not Allowed", { error: "Only POST method is allowed" });
				}

				const { code } = await request.json() as { code: string };
				if (!code) {
					return createJsonResponse(400, "Bad Request", { error: "code is required" });
				}

				const localId = await env.INVITE_CODE.get(code);
				if (!localId) {
					return createJsonResponseRaw({ valid: false });
				}

				return createJsonResponseRaw({ valid: true, localId });
			}

			if (pathname === "/invite/delete") {
				if (request.method !== "POST") {
					return createJsonResponse(405, "Method Not Allowed", { error: "Only POST method is allowed" });
				}

				const { code } = await request.json() as { code: string };
				if (!code) {
					return createJsonResponse(400, "Bad Request", { error: "code is required" });
				}

				await env.INVITE_CODE.delete(code);
				await logInfo(request, env, "invite", `Delete invite-code "${code}"`);

				return createJsonResponseRaw({ success: true });
			}

			// ユーザー登録
			if (pathname === "/user/register") {
				if (request.method !== "POST") {
					return createJsonResponse(405, "Method Not Allowed", { error: "Only POST method is allowed" });
				}

				let { email, password, passphrase } = await request.json() as { email: string; password: string, passphrase: string };

				if (passphrase !== env.REGISTER_PASSPHRASE) {
					const localId = await env.INVITE_CODE.get(passphrase);
					if (!localId) {
						return createJsonResponse(403, "Forbidden", { error: "Invalid passphrase or invite code" });
					}
				}
				
				if (!email || !password) {
					return createJsonResponse(400, "Bad Request", { error: "email and password are required" });
				}

				if (!email.includes("@")) email += `@ge.osaka-sandai.ac.jp`;

				if (!email.match(/@(.+?)\.osaka-sandai\.ac\.jp$/)) {
					return createJsonResponse(400, "Bad Request", { error: "Email must be from osaka-sandai.ac.jp domain" });
				}

				// すべて小文字にし、先頭にsがなければsを追加する。
				email = email.toLowerCase();
				if (!email.startsWith("s")) {
					email = `s` + email;
				}				

				const data: any = await firebase.registerUser(email, password);
				data.success = true;
				
				if (passphrase !== env.REGISTER_PASSPHRASE) 
					await env.INVITE_CODE.delete(passphrase);

				await logInfo(request, env, "register", `Register user "${email}" with code: ${passphrase === env.REGISTER_PASSPHRASE ? "REGISTER_PASSPHRASE" : passphrase}`);

				return createJsonResponseRaw(data);
			}

			if (pathname === "/user/login") {
				if (request.method !== "POST") {
					return createJsonResponse(405, "Method Not Allowed", { error: "Only POST method is allowed" });
				}

				let { email, password } = await request.json() as { email: string; password: string };
				if (!email || !password) {
					return createJsonResponse(400, "Bad Request", { error: "email and password are required" });
				}

				if (!email.includes("@")) email = `${email}@ge.osaka-sandai.ac.jp`;

				// if (env.AUTH_TOKEN === "") {
				// 	return createJsonResponse(500, "Internal Server Error", { error: "AUTH_TOKEN is not set" });
				// }
				
				// すべて小文字にし、先頭にsがなければsを追加する。
				email = email.toLowerCase();
				if (!email.startsWith("s")) {
					email = `s` + email;
				}

				const data: any = await firebase.loginUser(email, password);

				await logInfo(request, env, "login", `Login "${email}"`);

				data.success = true;

				return createJsonResponseRaw(data);
			}

			if (pathname === "/user/update") { // 設定などの更新
				if (request.method !== "POST") {
					return createJsonResponse(405, "Method Not Allowed", { error: "Only POST method is allowed" });
				}

				let idToken = request.headers.get("Authorization");
				if (!idToken) {
					return createJsonResponse(401, "Unauthorized", { error: "Authorization header is required" });
				}
				idToken = idToken.replace("Bearer ", "");

				const body: any = {
					idToken,
					returnSecureToken: true
				};

				const json: any = await request.json();

				// ディスプレイ名
				if (json.displayName) body.displayName = json.displayName;

				// プロフィール画像
				if (json.photoUrl) body.photoUrl = json.photoUrl;

				// メールアドレス
				if (json.email) body.email = json.email;

				const data: any = await firebase.updateUser(idToken, json.displayName, json.photoUrl, json.password);
				data.success = true;

				await logInfo(request, env, "update_user", `Update user "${data.localId}": ${JSON.stringify(body, null, 2)}`);

				return createJsonResponseRaw(data);
			}

			if (pathname === "/user/resetPassword") {
				if (request.method !== "POST") {
					return createJsonResponse(405, "Method Not Allowed", { error: "Only POST method is allowed" });
				}
				
				const { email } = await request.json() as { email?: string };
				if (!email) {
					return createJsonResponse(400, "Bad Request", { error: "email is required" });
				}

				const data: any = await firebase.resetPassword(email);
				data.success = true;

				await logInfo(request, env, "reset_password", `Reset password for "${email}"`);

				return createJsonResponseRaw(data);
			}

			// ユーザー情報、メールアドレスやディスプレイネーム、作成日時といった情報
			if (pathname === "/user/info") {
				if (request.method !== "POST") {
					return createJsonResponse(405, "Method Not Allowed", { error: "Only POST method is allowed" });
				}

				let idToken = request.headers.get("Authorization");
				if (!idToken) {
					return createJsonResponse(401, "Unauthorized", { error: "Authorization header is required" });
				}
				idToken = idToken.replace("Bearer ", "");

				const data: any = await firebase.verifyIdToken(idToken);

				if (!data) {
					return createJsonResponse(401, "Unauthorized", { error: "Invalid idToken" });
				}

				if (data.disabled) {
					return createJsonResponse(403, "Forbidden", { error: "User account is disabled" });
				}

				if (data.error && data.error.message === "INVALID_ID_TOKEN") {
					return createJsonResponse(401, "Unauthorized", { error: "Invalid idToken" });
				}

				data.success = true;

				return createJsonResponseRaw(data);
			}

			// 部員ポータル用にまとめた情報を返す
			if (pathname === "/portal") {
				if (request.method !== "POST") {
					return createJsonResponse(405, "Method Not Allowed", { error: "Only POST method is allowed" });
				}

				let idToken = request.headers.get("Authorization");
				if (!idToken) {
					return createJsonResponse(401, "Unauthorized", { error: "Authorization header is required" });
				}
				idToken = idToken.replace("Bearer ", "");

				const verifyData: any = await firebase.verifyIdToken(idToken);

				if (!verifyData) return createJsonResponse(401, "Unauthorized", { error: "Invalid idToken" });

				if (verifyData.disabled) {
					return createJsonResponse(403, "Forbidden", { error: "User account is disabled" });
				}

				if (verifyData.error && verifyData.error.message === "INVALID_ID_TOKEN") {
					return createJsonResponse(401, "Unauthorized", { error: "Invalid idToken" });
				}

				return createJsonResponseRaw({
					success: true,
					user: verifyData,
					limits: {
						discordInviteCode: env.DISCORD_INVITE,
					},
					idToken: idToken
				});
			}

			// blog api

			// 記事一覧の取得
			if (pathname === "/v1/blog/list") {
				const res = await github.getList();
				const data: any = await res.json();

				const result = data.map((page: any) => ({
					name: page.name.replace(".md", ""),
					sha: page.sha,
					size: page.size
				}));
				
				return createJsonResponseRaw(result);
			}

			if (pathname === "/v2/blog/list") {
				const res = await github.getList();
				const data: any = await res.json();

				for (const page of data) {
					const kvKey = `meta:${page.name.replace(".md", "")}`;

					const cachedStr = await env.BLOG_META.get(kvKey);
					let cached = cachedStr ? JSON.parse(cachedStr) : null;

					if (cached && cached.sha === page.sha) {
						page.meta = cached.meta;
						continue;
					}

					const postRes = await github.getPost(page.name);
					const postData: any = await postRes.json();

					if (postData.content) {
						let content = postData.content;
						if (postData.encoding === "base64") {
							content = base642txt(content);
						}

						const parsed = parseFrontMatter(content);
						page.meta = parsed.meta || {};

						await env.BLOG_META.put(
							kvKey,
							JSON.stringify({
								sha: page.sha,
								meta: page.meta
							})
						);
					} else {
						page.meta = {};
					}
				}

				const result = data.map((page: any) => ({
					name: page.name.replace(".md", ""),
					sha: page.sha,
					size: page.size,
					meta: page.meta
				}));
				
				return createJsonResponseRaw(result);
			}

			// 記事の取得
			if (pathname === "/v1/blog/get") {
				let page = url.searchParams.get("page");
				if (!page) return createJsonResponse(400, "Bad Request", { error: "page parameter is required" });

				page = `${page}.md`;

				const res = await github.getPost(page);
				const data: any = await res.json();

				if (!data.content) {
					if (data.status === 404) {
						return createJsonResponse(404, "Not Found", { error: "Post not found" });
					}
					
					return createJsonResponse(404, "Not Found", { error: "Post not found", data });
				}

				let content = data.content;
				if (data.encoding && data.encoding === "base64")
					content = base642txt(data.content);

				return createJsonResponseRaw({
					name: data.name.replace(".md", ""),
					sha: data.sha,
					size: data.size,
					content: content
				});
			}

			if (pathname === "/v2/blog/get") {
				let page = url.searchParams.get("page");
				if (!page) {
					return createJsonResponse(400, "Bad Request", { error: "page parameter is required" });
				}

				const fileName = `${page}.md`;
				const kvKey = `meta:${page}`;

				const cachedStr = await env.BLOG_META.get(kvKey);
				let cached = cachedStr ? JSON.parse(cachedStr) : null;

				const res = await github.getPost(fileName);
				const data: any = await res.json();

				if (!data.content) {
					if (data.status === 404) {
						return createJsonResponse(404, "Not Found", { error: "Post not found" });
					}
					return createJsonResponse(404, "Not Found", { error: "Post not found", data });
				}

				if (cached && cached.sha === data.sha) {
					let content = data.content;
					if (data.encoding === "base64") {
						content = base642txt(data.content);
					}

					const parsed = parseFrontMatter(content);

					return createJsonResponseRaw({
						name: data.name.replace(".md", ""),
						sha: data.sha,
						size: data.size,
						meta: cached.meta,
						content: parsed.content
					});
				}

				let content = data.content;
				if (data.encoding === "base64") {
					content = base642txt(data.content);
				}

				const parsed = parseFrontMatter(content);

				await env.BLOG_META.put(
					kvKey,
					JSON.stringify({
						sha: data.sha,
						meta: parsed.meta
					})
				);

				return createJsonResponseRaw({
					name: data.name.replace(".md", ""),
					sha: data.sha,
					size: data.size,
					meta: parsed.meta,
					content: parsed.content
				});
			}

			// 認証テスト
			if (pathname === "/test") {
				const token = request.headers.get("Authorization");
				if (!token) {
					return createJsonResponse(401, "Unauthorized", { error: "Authorization header is required" });					
				}

				if (token.replace("Bearer ", "") !== env.AUTH_TOKEN) {
					return createJsonResponse(403, "Forbidden", { error: "Invalid authorization token" });
				}

				return createJsonResponseRaw({ message: "Authorized" });
			}

			// 認証してトークンを発行して返す
			if (pathname === "/auth") {
				if (request.method !== "POST") {
					return createJsonResponse(405, "Method Not Allowed", { error: "Only POST method is allowed" });
				}

				const { email, password } = await request.json() as { email: string; password: string };
				if (!email || !password) {
					return createJsonResponse(400, "Bad Request", { error: "email and password are required" });
				}
				
				const data = await firebase.loginUser(email, password) as any;
				if (data.idToken) {
			        return createJsonResponseRaw({ token: env.AUTH_TOKEN, success: true });
				} else {
					return createJsonResponse(403, "Forbidden", { error: "Invalid email or password" });
				}
			}

			// 記事の更新、作成
			if (pathname === "/v1/blog/update") {
				if (request.method !== "POST") {
					return createJsonResponse(405, "Method Not Allowed", { error: "Only POST method is allowed" });
				}

				let idToken = request.headers.get("Authorization");
				if (!idToken) {
					return createJsonResponse(401, "Unauthorized", { error: "Authorization header is required" });
				}
				idToken = idToken.replace("Bearer ", "");

				const data: any = await firebase.verifyIdToken(idToken);

				if (!data) {
					return createJsonResponse(401, "Unauthorized", { error: "Invalid idToken" });
				}

				if (data.disabled) {
					return createJsonResponse(403, "Forbidden", { error: "User account is disabled" });
				}

				if (data.error && data.error.message === "INVALID_ID_TOKEN") {
					return createJsonResponse(401, "Unauthorized", { error: "Invalid idToken" });
				}

				const page = request.headers.get("page");
				const content = request.headers.get("content") || await request.text();
				if (!page || !content) {
					return createJsonResponse(400, "Bad Request", { error: "page and content headers are required" });
				}

				const res = await github.updatePost(`${page}.md`, content as string, "Update post via Cloudflare Worker");
				const data2: any = await res.json();

				data2.success = true;

				await logInfo(request, env, "blog_update", `Update blog post "${page}" by ${data.localId}`);
				
				return createJsonResponseRaw(data2);
			}

			// v2ではメタデータを分離して扱う
			if (pathname === "/v2/blog/update") {
				if (request.method !== "POST") {
					return createJsonResponse(405, "Method Not Allowed", { error: "Only POST method is allowed" });
				}
				let idToken = request.headers.get("Authorization");
				if (!idToken) {
					return createJsonResponse(401, "Unauthorized", { error: "Authorization header is required" });
				}
				idToken = idToken.replace("Bearer ", "");

				const data: any = await firebase.verifyIdToken(idToken);

				if (!data) {
					return createJsonResponse(401, "Unauthorized", { error: "Invalid idToken" });
				}

				if (data.disabled) {
					return createJsonResponse(403, "Forbidden", { error: "User account is disabled" });
				}

				if (data.error && data.error.message === "INVALID_ID_TOKEN") {
					return createJsonResponse(401, "Unauthorized", { error: "Invalid idToken" });
				}

				const page = request.headers.get("page");
				const _meta = request.headers.get("meta");
				const _content = request.headers.get("content") || await request.text();
				if (!page || !_content || !_meta) {
					return createJsonResponse(400, "Bad Request", { error: "page, meta and content headers are required" });
				}

				let meta: any = {};
				try {
					meta = JSON.parse(_meta);
				} catch (e) {
					return createJsonResponse(400, "Bad Request", { error: "meta header is not valid JSON" });
				}

				const content = createFrontMatter(meta, _content as string);

				const res = await github.updatePost(`${page}.md`, content, "Update post via Cloudflare Worker");
				const data2: any = await res.json();

				data2.success = true;

				await logInfo(request, env, "blog_update", `Update blog post "${page}" by ${data.localId}`);

				const kvKey = `meta:${page}`;
				await env.BLOG_META.put(
					kvKey,
					JSON.stringify({
						sha: data2.content.sha,
						meta: meta
					})
				);
				
				return createJsonResponseRaw(data2);
			}

			// discord
			if (pathname === "/discord/invite") {
				if (request.method !== "POST") {
					return createJsonResponse(405, "Method Not Allowed", { error: "Only POST method is allowed" });
				}

				let idToken = request.headers.get("Authorization");
				if (!idToken) {
					return createJsonResponse(401, "Unauthorized", { error: "Authorization header is required" });
				}
				idToken = idToken.replace("Bearer ", "");

				const data: any = await firebase.verifyIdToken(idToken);

				if (data.disabled) {
					return createJsonResponse(403, "Forbidden", { error: "User account is disabled" });
				}

				if ((data.error || !data.localId)) {
					return createJsonResponse(401, "Unauthorized", { error: "Invalid idToken", data: data });
				}

				return createJsonResponseRaw({ code: env.DISCORD_INVITE, success: true });
			}

			// GitHub Organization
			if (pathname === "/github/invite") {
				if (request.method !== "POST") {
					return createJsonResponse(405, "Method Not Allowed", {
						error: "Only POST method is allowed"
					});
				}

				let idToken = request.headers.get("Authorization");
				if (!idToken) {
					return createJsonResponse(401, "Unauthorized", { error: "Authorization header is required" });
				}
				idToken = idToken.replace("Bearer ", "");

				const data: any = await firebase.verifyIdToken(idToken);

				if (!data) {
					return createJsonResponse(401, "Unauthorized", { error: "Invalid idToken" });
				}

				const { email } = await request.json() as { email: string };
				if (!email) {
					return createJsonResponse(400, "Bad Request", { error: "email is required" });
				}

				const res = await github.inviteOrganization(email);
				const data2: any = await res.json();

				if (!res.ok) {
					return createJsonResponse(res.status, res.statusText, {
						error: data2.message || "GitHub invite failed"
					});
				}

				return createJsonResponseRaw({
					success: true,
					invited: email
				});
			}

			
		} catch (e: any) {
			return createJsonResponse(500, "Internal Server Error", { error: e.toString() });
		}

		return createJsonResponse(404, "Not Found", { error: "Endpoint not found" });
	}
} satisfies ExportedHandler<Env>;
