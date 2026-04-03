import { Session } from './session.js';
interface ProjectInfo {
    slug: string;
    repoPath: string;
    description: string;
}
export declare class SessionManager {
    private _sessions;
    private _port;
    constructor(port: number);
    register(repoPath: string, opts?: {
        description?: string;
        baseBranch?: string;
    }): {
        slug: string;
        url: string;
    };
    get(slug: string): Session | undefined;
    findByRepoPath(repoPath: string): {
        slug: string;
        session: Session;
    } | undefined;
    list(): ProjectInfo[];
    deregister(slug: string): boolean;
    private _deriveSlug;
}
export {};
