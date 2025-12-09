import { 
  txt2base64,
  base642txt,
  createJsonResponse,
  createJsonResponseRaw,
  sha256
} from "./util";

const OWNER = "osu-denken";
const REPO = "blog";
const BRANCH = "main";

export interface Env {
	GITHUB_TOKEN: string;
	AUTH_TOKEN: string;
	FIREBASE_API_KEY: string;
	DISCORD_INVITE: string;
}

// blog api
function requestGitHub(url: string, method: string, token: string, body?: any) {
	const headers: Record<string, string> = {
		"Authorization": `token ${token}`,
		"Content-Type": "application/json",
		"User-Agent": "osu-denken-admin-cloudflare-worker"
	};
	return fetch(url, {
		method,
		headers,
		body: body ? JSON.stringify(body) : undefined
	});
}

// invite github organization
async function inviteGitHubOrganization(env: Env, email: string) {
	const url = `https://api.github.com/orgs/${OWNER}/invitations`;

	const res = await fetch(url, {
		method: "POST",
		headers: {
			"Authorization": `token ${env.GITHUB_TOKEN}`,
			"Content-Type": "application/json",
			"Accept": "application/vnd.github+json",
			"User-Agent": "osu-denken-admin-cloudflare-worker"
		},
		body: JSON.stringify({
			email,
			role: "direct_member"
		})
	});

	return res;
}


function getList(token: string) {
	try {
		const url = `https://api.github.com/repos/${OWNER}/${REPO}/contents/_posts`;
		return requestGitHub(url, "GET", token);
	} catch (e) {
		return Promise.reject(e);
	}
}

function getPost(path: string, token: string) {
	try {
		const url = `https://api.github.com/repos/${OWNER}/${REPO}/contents/_posts/${path}`;
		return requestGitHub(url, "GET", token);
	} catch (e) {
		return Promise.reject(e);
	}
}

async function updatePost(path: string, content: string, message: string, token: string, sha?: string) {
	try {
		const url = `https://api.github.com/repos/${OWNER}/${REPO}/contents/_posts/${path}`;
		const body: { message: string; content: string; branch: string; sha?: string } = {
			message,
			content,
			branch: BRANCH
		};
		
		if (sha) {
			body.sha = sha;
		} else {
			const req = await requestGitHub(url, "GET", token);
			if (req.status === 200) {
				const data = await req.json() as { sha: string };
				body.sha = data.sha;
			}
		}

		return requestGitHub(url, "PUT", token, body);
	} catch (e) {
		return Promise.reject(e);
	}
}

// user api
async function registerUser(env: Env, email: string, password: string) {
	const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${env.FIREBASE_API_KEY}`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json"
		},
		body: JSON.stringify({
			email,
			password,
			returnSecureToken: true
		})
	});
	const data = await res.json();
	return data;
}

async function loginUser(env: Env, email: string, password: string) {
	const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${env.FIREBASE_API_KEY}`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json"
		},
		body: JSON.stringify({
			email,
			password,
			returnSecureToken: true
		})
	});
	const data = await res.json();
	return data;
}

async function resetPassword(env: Env, email: string) {
	const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${env.FIREBASE_API_KEY}`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json"
		},
		body: JSON.stringify({
			requestType: "PASSWORD_RESET",
			email
		})
	});
	const data = await res.json();
	return data;
}

async function verifyIdToken(env: Env, idToken: string) {
	const res = await fetch(
		`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${env.FIREBASE_API_KEY}`,
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ idToken })
		}
	);

	const data: any = await res.json();

	if (!res.ok || !data.users || data.users.length === 0) {
		return data; // 無効
	}

	return data.users[0]; // ユーザー情報
}


export default {
	async fetch(request: Request, env: Env, ctx: any): Promise<Response> {
		if (!env.GITHUB_TOKEN) return new Response("GITHUB_TOKEN is not set", { status: 500 });

		const url = new URL(request.url);
		const pathname: string = url.pathname;

		if (request.method === "OPTIONS") {
			return new Response(null, { status: 204, headers: {
				"Access-Control-Allow-Origin": "*",
				"Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
				"Access-Control-Allow-Headers": "Content-Type, Authorization",
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
			if (pathname === "/user/register") {
				if (request.method !== "POST") {
					return createJsonResponse(405, "Method Not Allowed", { error: "Only POST method is allowed" });
				}

				const { email, password } = await request.json() as { email: string; password: string };
				if (!email || !password) {
					return createJsonResponse(400, "Bad Request", { error: "email and password are required" });
				}

				if (!email.match(/@(.+?)\.osaka-sandai\.ac\.jp$/)) {
					return createJsonResponse(400, "Bad Request", { error: "Email must be from osaka-sandai.ac.jp domain" });
				}

				const data: any = await registerUser(env, email, password);
				data.success = true;

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

				if (env.AUTH_TOKEN === "") {
					return createJsonResponse(500, "Internal Server Error", { error: "AUTH_TOKEN is not set" });
				}

				const data: any = await loginUser(env, email, password);
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
				if (json.name) body.displayName = json.name;

				// プロフィール画像
				if (json.photoUrl) body.photoUrl = json.photoUrl;

				// メールアドレス
				if (json.email) body.email = json.email;

				const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:update?key=${env.FIREBASE_API_KEY}`, {
					method: "POST",
					headers: {
						"Content-Type": "application/json"
					},
					body: JSON.stringify(body)
				});
				const data: any = await res.json();
				data.success = true;

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

				const data: any = await resetPassword(env, email);
				data.success = true;

				return createJsonResponseRaw(data);
			}

			// TODO: ユーザー情報、メールアドレスやディスプレイネーム、作成日時といった情報
			if (pathname === "/user/info") {
				if (request.method !== "POST") {
					return createJsonResponse(405, "Method Not Allowed", { error: "Only POST method is allowed" });
				}

				let idToken = request.headers.get("Authorization");
				if (!idToken) {
					return createJsonResponse(401, "Unauthorized", { error: "Authorization header is required" });
				}
				idToken = idToken.replace("Bearer ", "");

				const data: any = await verifyIdToken(env, idToken);

				if (!data) {
					return createJsonResponse(401, "Unauthorized", { error: "Invalid idToken" });
				}

				data.success = true;

				return createJsonResponseRaw(data);
			}

			// blog api

			// 記事一覧の取得
			if (pathname === "/blog/list") {
				const res = await getList(env.GITHUB_TOKEN);
				const data: any = await res.json();

				const result = data.map((page: any) => ({
					name: page.name.replace(".md", ""),
					sha: page.sha,
					size: page.size
				}));
				
				return createJsonResponseRaw(result);
			}

			// 記事の取得
			if (pathname === "/blog/get") {
				let page = url.searchParams.get("page");
				if (!page) return createJsonResponse(400, "Bad Request", { error: "path parameter is required" });

				page = `${page}.md`;

				const res = await getPost(page, env.GITHUB_TOKEN);
				const data: any = await res.json();

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
				
				const data = await loginUser(env, email, password) as any;
				if (data.idToken) {
			        return createJsonResponseRaw({ token: env.AUTH_TOKEN, success: true });
				} else {
					return createJsonResponse(403, "Forbidden", { error: "Invalid email or password" });
				}
			}

			// 記事の更新、作成
			if (pathname === "/blog/update") {
				const token = request.headers.get("Authorization");

				// トークン認証
				if (!token || token.replace("Bearer ", "") !== env.AUTH_TOKEN) {
					return createJsonResponse(403, "Forbidden", { error: "Invalid authorization token" });
				}

				if (request.method !== "POST") { // postだけ許可する
					return createJsonResponse(405, "Method Not Allowed", { error: "Only POST method is allowed" });
				}

				const page = request.headers.get("page");
				const content = request.headers.get("content") || await request.text();
				if (!page || !content) {
					return createJsonResponse(400, "Bad Request", { error: "page and content headers are required" });
				}

				const res = await updatePost(`${page}.md`, content as string, "Update post via Cloudflare Worker", env.GITHUB_TOKEN);
				const data: any = await res.json();
				data.success = true;

				return createJsonResponse(res.status, res.statusText, data);
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

				const data: any = await verifyIdToken(env, idToken);

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

				const data: any = await verifyIdToken(env, idToken);

				if (!data) {
					return createJsonResponse(401, "Unauthorized", { error: "Invalid idToken" });
				}

				const { email } = await request.json() as { email: string };
				if (!email) {
					return createJsonResponse(400, "Bad Request", { error: "email is required" });
				}

				const res = await inviteGitHubOrganization(env, email);
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
