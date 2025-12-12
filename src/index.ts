import { Env } from "./util/types";
import { HttpError } from "./util/HttpError";

const parentRoute = {
	
};

export default {
	async fetch(request: Request, env: Env, ctx: any): Promise<Response> {
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
			if (!env.GITHUB_TOKEN) throw new HttpError(500, "INTERNAL_SERVER_ERROR", "GITHUB_TOKEN is not set");
			if (!env.FIREBASE_API_KEY) throw new HttpError(500, "INTERNAL_SERVER_ERROR", "FIREBASE_API_KEY is not set");

			if (pathname === "/") return new Response("Welcome to osu-denken api!", { status: 200 });
			if (pathname === "/ping") return new Response("pong", { status: 200 });



			throw new HttpError(404, "NOT_FOUND", "Endpoint not found");

		} catch (e: any) {
			if (e instanceof HttpError) {
				return e.toResponse();
			}
			
			return new HttpError(500, "INTERNAL_SERVER_ERROR", e.toString).toResponse();
		}
	}
} satisfies ExportedHandler<Env>;
