export interface Env {
  GITHUB_TOKEN: string;
}

function encodeBase64(str: string) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}


export default {
  async fetch(request: Request, env: Env, ctx: any): Promise<Response> {
  if (!env.GITHUB_TOKEN) {
    return new Response("GITHUB_TOKEN is not set", { status: 500 });
  }

  const path = `_posts/test.md`;
  const url = `https://api.github.com/repos/osu-denken/blog/contents/${path}`;
  const content = encodeBase64("# タイトル\nこれはテストです。");

  try {
	const req = await fetch(url, {
		method: "GET",
		headers: {
			"Authorization": `token ${env.GITHUB_TOKEN}`,
			"User-Agent": "osu-denken-admin-cloudflare-worker"
		}
	})

	let sha: string | null = null;
	if (req.status === 200) {
		const data = await req.json() as { sha: string };
		sha = data.sha;
	}

	const bodyData: { message: string; content: string; branch: string; sha?: string } = {
		message: "Add new post",
		content: content,
		branch: "main"
	};

	if (sha) {
		bodyData.sha = sha;
	}

    const res = await fetch(url, {
      method: "PUT",
      headers: {
        "Authorization": `token ${env.GITHUB_TOKEN}`,
        "Content-Type": "application/json",
		"User-Agent": "osu-denken-admin-cloudflare-worker"
      },
      body: JSON.stringify(bodyData)
    });

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
