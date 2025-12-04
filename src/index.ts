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

function getListPosts(token: string) {
	const url = `https://api.github.com/repos/osu-denken/blog/contents/_posts`;
	return requestGitHub(url, "GET", token);
}

function getPost(path: string, token: string) {
	const url = `https://api.github.com/repos/osu-denken/blog/contents/${path}`;
	return requestGitHub(url, "GET", token);
}

async function updatePost(path: string, content: string, message: string, token: string, sha?: string) {
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
}

export default {
	async fetch(request: Request, env: Env, ctx: any): Promise<Response> {
		if (!env.GITHUB_TOKEN) return new Response("GITHUB_TOKEN is not set", { status: 500 });

		const path = `_posts/test.md`;
		const url = `https://api.github.com/repos/` + OWNER + `/` + REPO + `/contents/${path}`;

		let text = `"# hogehoge\n`;

		text += Date.now().toString();

		const content = txt2base64(text);

		try {
			const res = await updatePost(path, content, "Add test post via Cloudflare Worker", env.GITHUB_TOKEN);

			const text = await res.text();
			return new Response(
			JSON.stringify({
				status: res.status,
				statusText: res.statusText,
				body: text
			}, null, 2),
			{ status: res.status, headers: { "Content-Type": "application/json" } }
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
