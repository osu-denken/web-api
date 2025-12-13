import { Env } from "./util/types";
import { HttpError } from "./util/HttpError";
import { UserController } from "./api/UserController";
import { IController } from "./api/IController";
import { FirebaseService } from "./service/firebase";
import { GitHubService } from "./service/github";
import { InviteController } from "./api/InviteController";
import { BlogController } from "./api/BlogController";
import { PortalController } from "./api/PortalController";

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

		const path: string[] = pathname.split("/");

		let controller: IController | null = null;
		let authorization = request.headers.get("Authorization") ?? null;

		try {
			if (!env.GITHUB_TOKEN) throw new HttpError(500, "INTERNAL_SERVER_ERROR", "GITHUB_TOKEN is not set");
			if (!env.FIREBASE_API_KEY) throw new HttpError(500, "INTERNAL_SERVER_ERROR", "FIREBASE_API_KEY is not set");

			const github = new GitHubService(env.GITHUB_TOKEN);
			const firebase = new FirebaseService(env.FIREBASE_API_KEY);

			if (pathname === "/") return new Response("Welcome to osu-denken api!", { status: 200 });
			if (path[0] === "ping") return new Response("pong", { status: 200 });
			if (path[0] === "user") controller = new UserController(path);
			if (path[0] === "blog") controller = new BlogController(path);
			if (path[0] === "invite") controller = new InviteController(path);

			// TODO: versioning, impl in IController
			if (path[0] === "v1" && path[1] === "blog") controller = new BlogController(path);
			if (path[0] === "v2" && path[1] === "blog") controller = new BlogController(path);

			// TODO: split
			if (path[0] === "portal" || path[0] === "discord" || path[0] === "github") controller = new PortalController(path);

			if (controller) {
				controller.setServices(firebase, github);
				controller.setRequest(request);
				controller.setAuthorization(authorization);
				controller.setEnv(env);
				controller.setUrl(url);
				return await controller.toResponse();
			}

			throw new HttpError(404, "NOT_FOUND", "Endpoint not found");

		} catch (e: any) {
			if (e instanceof HttpError) {
				return e.toResponse();
			}
			
			return new HttpError(500, "INTERNAL_SERVER_ERROR", e.toString).toResponse();
		}
	}
} satisfies ExportedHandler<Env>;
