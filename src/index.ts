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

  const url = `https://api.github.com/repos/osu-denken/blog/contents/_posts/test.md`;
  const content = encodeBase64("# タイトル\nこれはテストです。");

  try {
    const res = await fetch(url, {
      method: "PUT",
      headers: {
        "Authorization": `token ${env.GITHUB_TOKEN}`,
        "Content-Type": "application/json",
		"User-Agent": "osu-denken-admin-cloudflare-worker"
      },
      body: JSON.stringify({
        message: "Add new post",
        content: content,
        branch: "main"
      })
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
