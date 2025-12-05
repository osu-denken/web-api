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
}

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

function getList(token: string) {
	try {
		const url = `https://api.github.com/repos/osu-denken/blog/contents/_posts`;
		return requestGitHub(url, "GET", token);
	} catch (e) {
		return Promise.reject(e);
	}
}

function getPost(path: string, token: string) {
	try {
		const url = `https://api.github.com/repos/osu-denken/blog/contents/_posts/${path}`;
		return requestGitHub(url, "GET", token);
	} catch (e) {
		return Promise.reject(e);
	}
}

async function updatePost(path: string, content: string, message: string, token: string, sha?: string) {
	try {
		const url = `https://api.github.com/repos/osu-denken/blog/contents/${path}`;
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

			// 記事一覧の取得
			if (pathname === "/list") {
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
			if (pathname === "/get") {
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
				const authHeader = request.headers.get("Authorization");
				let user_id: string | null = null;
				let hashed_pass: string | null = null; // sha256されたパスワード

				if (authHeader && authHeader.startsWith("Basic ")) {
					const base64Credentials = authHeader.replace("Basic ", "");
					const credentials = atob(base64Credentials);
					const [user, pass] = credentials.split(":");
					user_id = user;
					hashed_pass = pass;
				} else {
					user_id = url.searchParams.get("user");
					hashed_pass = url.searchParams.get("pass");
				}
				
				if (!user_id || !hashed_pass) {
					return createJsonResponse(400, "Bad Request", { error: "user and pass (sha256) are required" });
				}

				// sha256
				const hashed_hashed_pass = await sha256(hashed_pass);
				if (user_id === "admin" && hashed_hashed_pass === "3eaff5f1080be960f83978f99acce9a19ed2f0a0d197f7a816fadec50d9d1286") {
					return createJsonResponseRaw({ token: env.AUTH_TOKEN });
				} else {
					return createJsonResponse(403, "Forbidden", { error: "Invalid user or pass (sha256)" });
				}
			}

			// 記事の更新、作成
			if (pathname === "/update") {
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

				return createJsonResponse(res.status, res.statusText, data);
			}
			
		} catch (e: any) {
			return createJsonResponse(500, "Internal Server Error", { error: e.toString() });
		}

		return createJsonResponse(404, "Not Found", { error: "Endpoint not found" });
	}
} satisfies ExportedHandler<Env>;
