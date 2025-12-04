export interface Env {
  GITHUB_TOKEN: string;
}

export default {
  async fetch(request, env: Env, ctx: any): Promise<Response> {
    const url = `https://api.github.com/repos/osu-denken/blog/contents/_posts/test.md`;

    const content = btoa("# タイトル\nこれはテストです。");

    const res = await fetch(url, {
      method: "PUT",
      headers: {
        "Authorization": `token ${env.GITHUB_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: "Add new post",
        content: content,
		branch: "main"
      })
    });

    return new Response(await res.text(), { status: res.status });
  }
} satisfies ExportedHandler<Env>;