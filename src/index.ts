import { Env } from "./util/types";
import { HttpError } from "./util/HttpError";
import { UserController } from "./control/UserController";
import { IController } from "./control/IController";
import { FirebaseService } from "./util/service/firebase";
import { GitHubService } from "./util/service/github";
import { InviteController } from "./control/InviteController";
import { BlogController } from "./control/BlogController";
import { PortalController } from "./control/PortalController";
import { PingController } from "./control/PingController";
import { MembersGSheetsService } from "./util/service/members-gs";
import { ImageController } from "./control/ImageController";

type ControllerFactory = (path: string[]) => IController;

const routes: Record<string, ControllerFactory> = {
  "ping" : (path) => new PingController(path),
  "user": (path) => new UserController(path),
  "blog": (path) => new BlogController(path),
  "invite": (path) => new InviteController(path),
  "image": (path) => new ImageController(path),
  "portal": (path) => new PortalController(path),
  "v1/ping" : (path) => new PingController(path),
  "v1/user": (path) => new UserController(path),
  "v1/blog": (path) => new BlogController(path),
  "v1/invite": (path) => new InviteController(path),
  "v1/image": (path) => new ImageController(path),
  "v1/portal": (path) => new PortalController(path),
  "v2/blog": (path) => new BlogController(path),
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

		const path = pathname.split("/").filter(Boolean);

		let controller: IController | null = null;

		let base = path[0];
		if (path[0] === "v1" || path[0] === "v2") { // v1 / v2がある場合
			base = `${path[0]}/${path[1]}`;
		}

		const factory = routes[base];
		if (factory) {
			controller = factory(path);
		}

		let authorization = request.headers.get("Authorization") ?? null;

		try {
			// if (!env.GITHUB_TOKEN) throw new HttpError(500, "INTERNAL_SERVER_ERROR", "GITHUB_TOKEN is not set");
			if (!env.FIREBASE_API_KEY) throw new HttpError(500, "INTERNAL_SERVER_ERROR", "FIREBASE_API_KEY is not set");
			if (!env.MEMBERS_SPREADSHEET_ID) throw new HttpError(500, "INTERNAL_SERVER_ERROR", "MEMBERS_SPREADSHEET_ID is not set");

			const github = new GitHubService(env.GITHUB_TOKEN);
			const firebase = new FirebaseService(env.FIREBASE_API_KEY);
			const members_googlesheets = new MembersGSheetsService(env.GOOGLE_SA_KEY, env.MEMBERS_SPREADSHEET_ID, ctx, env);

			if (pathname === "/") return new Response("Welcome to osu-denken web-api!", { status: 200 });

			if (controller) {
				controller.setServices(firebase, github, members_googlesheets);
				controller.setRequest(request);
				controller.setAuthorization(authorization);
				controller.setEnv(env);
				controller.setUrl(url);
				controller.setCtx(ctx);
				return await controller.toResponse();
			}

			throw new HttpError(404, "NOT_FOUND", "Endpoint not found");

		} catch (e: any) {
			if (e instanceof HttpError) {
				return e.toResponse();
			}
			
			return new HttpError(500, "INTERNAL_SERVER_ERROR", 
				JSON.stringify({
					name: e?.name,
					message: e?.message,
					stack: e?.stack,
				}, null, 2)
			).toResponse();
		}
	}
} satisfies ExportedHandler<Env>;
