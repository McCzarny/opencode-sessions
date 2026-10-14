import streamDeck from "@elgato/streamdeck";
import { OpenCode, type OpenCodeClient, type SessionActive, type SessionInfo, type PermissionRequestListOutput } from "@opencode/client";
import { Service } from "@opencode/client/service";

/**
 * Lifecycle status shown for a session on the Stream Deck key.
 */
export type SessionStatus = "running" | "waiting" | "attention" | "error" | "interrupted" | "done" | "idle";

/**
 * A flattened, render-ready view of an OpenCode session.
 */
export type SessionView = {
	readonly id: string;
	readonly title: string;
	readonly directory: string;
	readonly agent?: string;
	readonly status: SessionStatus;
	readonly active: boolean;
	readonly pending: number;
	readonly idle?: number;
	readonly updated: number;
};

export type ConnectionState = "connecting" | "ready" | "error";

type Listener = () => void;

/**
 * Maintains a live view of the local OpenCode service, polling sessions, active drains and
 * pending permission requests. It transparently discovers or starts the shared background
 * service through the official client.
 */
export class OpenCodeConnection {
	private client?: OpenCodeClient;
	private clientPromise?: Promise<OpenCodeClient | undefined>;
	private endpointUrl?: string;
	private timer?: ReturnType<typeof setInterval>;
	private readonly listeners = new Set<Listener>();
	private view: SessionView[] = [];
	private currentState: ConnectionState = "connecting";
	private errorMessage?: string;
	private refreshing = false;

	get state(): ConnectionState {
		return this.currentState;
	}

	get error(): string | undefined {
		return this.errorMessage;
	}

	/** Base URL of the discovered service, when known. */
	get url(): string | undefined {
		return this.endpointUrl;
	}

	get sessions(): SessionView[] {
		return this.view;
	}

	/** Subscribes to state/session updates; returns an unsubscribe function. */
	on(listener: Listener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	/** Refreshes once, then keeps polling in the background. */
	start(intervalMs = 2000): void {
		void this.refresh();
		this.timer ??= setInterval(() => void this.refresh(), intervalMs);
	}

	stop(): void {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = undefined;
		}
	}

	/** Resolves (and caches) an authenticated client for the local service. */
	async ensureClient(): Promise<OpenCodeClient | undefined> {
		if (this.client) {
			return this.client;
		}

		if (!this.clientPromise) {
			this.clientPromise = (async () => {
				try {
					const endpoint = await Service.ensure();
					this.endpointUrl = endpoint.url;
					this.client = OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) });
					return this.client;
				} catch (error) {
					this.errorMessage = describe(error);
					this.client = undefined;
					return undefined;
				} finally {
					this.clientPromise = undefined;
				}
			})();
		}

		return this.clientPromise;
	}

	/** Pulls the latest session state. Safe to call concurrently; overlapping calls are dropped. */
	async refresh(): Promise<void> {
		if (this.refreshing) {
			return;
		}

		this.refreshing = true;

		try {
			const client = await this.ensureClient();

			if (!client) {
				this.setState("error");
				return;
			}

			const [list, active, permissions] = await Promise.all([
				client.session.list({ limit: 40, order: "desc" }),
				client.session.active().catch(() => undefined),
				client.permission.request.list().catch(() => undefined),
			]);

			this.view = buildSessions(list.data, active, permissions);
			this.errorMessage = undefined;
			this.setState("ready");
		} catch (error) {
			this.errorMessage = describe(error);
			// Drop the cached client so the next tick rediscovers the service.
			this.client = undefined;
			this.setState("error");
		} finally {
			this.refreshing = false;
		}
	}

	private setState(state: ConnectionState): void {
		this.currentState = state;
		this.emit();
	}

	private emit(): void {
		for (const listener of this.listeners) {
			try {
				listener();
			} catch (error) {
				streamDeck.logger.error(`listener failed: ${describe(error)}`);
			}
		}
	}
}

/**
 * Builds the sorted session views from the API responses.
 */
function buildSessions(
	sessions: SessionInfo[],
	active: Record<string, SessionActive> | undefined,
	permissions: PermissionRequestListOutput | undefined,
): SessionView[] {
	const activeIDs = new Set(active ? Object.keys(active) : []);
	const pending = new Map<string, number>();

	for (const request of permissions?.data ?? []) {
		pending.set(request.sessionID, (pending.get(request.sessionID) ?? 0) + 1);
	}

	return sessions
		.map((session) => toView(session, activeIDs.has(session.id), pending.get(session.id) ?? 0))
		.sort((left, right) => right.updated - left.updated);
}

function toView(session: SessionInfo, active: boolean, pending: number): SessionView {
	const directory = session.location?.directory ?? "";

	return {
		id: session.id,
		title: resolveTitle(session, directory),
		directory,
		agent: session.agent,
		status: resolveStatus(session, active, pending),
		active,
		pending,
		idle: session.time.idle,
		updated: session.time.updated,
	};
}

function resolveTitle(session: SessionInfo, directory: string): string {
	if (session.title?.trim()) {
		return session.title.trim();
	}

	const folder = directory.split(/[\\/]/).filter(Boolean).pop();

	return folder || session.id.slice(0, 10);
}

function resolveStatus(session: SessionInfo, active: boolean, pending: number): SessionStatus {
	if (active) {
		return "running";
	}

	if (pending > 0) {
		return "waiting";
	}

	if (session.outcome === "failed") {
		return "error";
	}

	if (isUnviewed(session)) {
		return "attention";
	}

	if (session.outcome === "interrupted") {
		return "interrupted";
	}

	if (session.outcome === "succeeded") {
		return "done";
	}

	return "idle";
}

/** A finished session whose latest idle transition has not been viewed yet. */
function isUnviewed(session: SessionInfo): boolean {
	const { idle, viewed } = session.time;

	return idle !== undefined && (viewed === undefined || idle > viewed);
}

function describe(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}

	return String(error);
}
