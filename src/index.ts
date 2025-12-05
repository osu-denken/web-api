const OWNER = "osu-denken";
const REPO = "blog";
const BRANCH = "main";

export interface Env {
	GITHUB_TOKEN: string;
}

function txt2base64(str: string) {
	const bytes = new TextEncoder().encode(str);
	let binary = '';
	for (let i = 0; i < bytes.length; i++) {
		binary += String.fromCharCode(bytes[i]);
	}
	return btoa(binary);
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

function createJsonResponse(status: number, statusText: string, body: any) {
	return new Response(
		JSON.stringify(
			{
				status,
				statusText,
				body
			}, null, 2
		),
		{ 
			status, 
			headers: {
				"Content-Type": "application/json" 
			} 
		}
	);
}

export default {
	async fetch(request: Request, env: Env, ctx: any): Promise<Response> {
		if (!env.GITHUB_TOKEN) return new Response("GITHUB_TOKEN is not set", { status: 500 });
		// REST API style
		// api.osudenken4dev.workers.dev/list
		// api.osudenken4dev.workers.dev/get?id=xxxx.md
		// api.osudenken4dev.workers.dev/update

		const url = new URL(request.url);
		const pathname: string = url.pathname;

		try {
			if (pathname === "/list") {
				const res = await getList(env.GITHUB_TOKEN);

				const data = await res.json();
				return createJsonResponse(res.status, res.statusText, data);
			}

			if (pathname === "/get") {
				const page = url.searchParams.get("page");
				if (!page) {
					return createJsonResponse(400, "Bad Request", { error: "path parameter is required" });
				}

				const res = await getPost(page, env.GITHUB_TOKEN);

				const data = await res.json();
				return createJsonResponse(res.status, res.statusText, data);
			}

			if (pathname === "/update") {
				return createJsonResponse(500, "Internal Server Error", { error: "現在、利用できません。" });

				if (request.method !== "POST") {
					return createJsonResponse(405, "Method Not Allowed", { error: "Only POST method is allowed" });
				}

				const reqBody = await request.json() as { path: string; content: string; message: string };
				const { path, content, message } = reqBody;
				if (!path || !content || !message) {
					return createJsonResponse(400, "Bad Request", { error: "path, content, and message are required" });
				}
				
				const res = await updatePost(path, content, message, env.GITHUB_TOKEN);
				const data = await res.json();
				return createJsonResponse(res.status, res.statusText, data);
			}
			
		} catch (e: any) {
			return createJsonResponse(500, "Internal Server Error", { error: e.toString() });
		}


		const path = `_posts/test.md`;

		let text = `# hogehoge\n\n`;

		text += Date.now().toString();

		const content = txt2base64(text);

		try {
			const res = await updatePost(path, content, "Add test post via Cloudflare Worker", env.GITHUB_TOKEN);

			const data = await res.json();
			return new Response(
				JSON.stringify(
					{
						status: res.status,
						statusText: res.statusText,
						body: data
					}, null, 2
				),
				{ 
					status: res.status, 
					headers: {
						"Content-Type": "application/json" 
					} 
				}
			);

		} catch (err: any) {
			return new Response(
			JSON.stringify({
				error: err.toString()
			}, null, 2),
			{ status: 500, headers: { "Content-Type": "application/json" } }
			);
		}
	}
} satisfies ExportedHandler<Env>;
