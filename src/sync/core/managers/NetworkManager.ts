export abstract class NetworkManager {
    abstract get isOnline(): boolean;
}

export class NetworkManagerBrowser extends NetworkManager {
    override get isOnline(): boolean {
        return navigator.onLine;
    }
}
