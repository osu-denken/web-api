import { FirebaseService } from "../service/firebase";
import { GitHubService } from "../service/github";

export abstract class IController {
    public path: string[];
    public firebase: FirebaseService | null = null;
    public github: GitHubService | null = null;

    public request: Request | null = null;
    public authorization: string | null = null;
    public env: any = null;
    public url: URL | null = null;

    public abstract getParentPath(): string;

    constructor(path: string[]) {
        this.path = path;
    }

    /**
     * ルーティング
     */
    public abstract route() : Promise<any> | any;

    public async toResponse() {
        return new Response(await this.route(), {
            status: 200,
            headers: {
				"Content-Type": "application/json",
            }
        });
    }

    public setServices(firebase: FirebaseService | null, github: GitHubService | null) {
        this.firebase = firebase;
        this.github = github;
    }

    public setRequest(request: Request) {
        this.request = request;
    }

    public setAuthorization(authorization: string | null) {
        
        this.authorization = authorization;
        if (this.authorization == null) return;
 
        this.authorization = this.authorization.replace("Bearer ", "");
    }

    public setEnv(env: any) {
        this.env = env;
    }

	public setUrl(url: URL) {
        this.url = url;
	}
}