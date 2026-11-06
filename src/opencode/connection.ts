import streamDeck from "@elgato/streamdeck";
import { OpenCode, type OpenCodeClient, type SessionInfo } from "@opencode/client";
import { Service } from "@opencode/client/service";
import type { UsageWindow } from "../settings.js";

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

/** One OpenCode Go usage window. `percent` is the share of the limit already used. */
export type UsageMeter = {
	readonly percent: number;
	readonly limited: boolean;
	readonly resetsAt: number;
};

/** All three OpenCode Go usage windows. */
export type GoUsage = Record<UsageWindow, UsageMeter>;

export type UsageState = "unknown" | "ready" | "unsupported" | "unavailable" | "error";

type Listener = () => void;

type UsageLimitsResponse = {
	readonly data?: {
		readonly go?: {
			readonly rolling?: unknown;
			readonly weekly?: unknown;
			readonly monthly?: unknown;
		} | null;
	} | null;
};

/**
 * Maintains a live view of the local OpenCode service: sessions, active drains, and the input a
 * session is blocked on (permission prompts and question forms). It transparently discovers or
 * starts the shared background service through the official client.
 */
export class OpenCodeConnection {
	private client?: OpenCodeClient;
	private clientPromise?: Promise<OpenCodeClient | undefined>;
	private endpoint?: Awaited<ReturnType<typeof Service.ensure>>;
	private endpointUrl?: string;
	private timer?: ReturnType<typeof setInterval>;
	private usageTimer?: ReturnType<typeof setInterval>;
	private readonly listeners = new Set<Listener>();
	private view: SessionView[] = [];
	private currentState: ConnectionState = "connecting";
	private errorMessage?: string;
	private refreshing = false;
	private usageView?: GoUsage;
	private usageStatus: UsageState = "unknown";
	private usageErrorMessage?: string;
	private refreshingUsage = false;

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

	get usage(): GoUsage | undefined {
		return this.usageView;
	}

	get usageState(): UsageState {
		return this.usageStatus;
	}

	get usageError(): string | undefined {
		return this.usageErrorMessage;
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

	/** Refreshes Go usage once, then keeps polling while a usage key is visible. */
	startUsage(intervalMs = 60_000): void {
		void this.refreshUsage();
		this.usageTimer ??= setInterval(() => void this.refreshUsage(), intervalMs);
	}

	stopUsage(): void {
		if (this.usageTimer) {
			clearInterval(this.usageTimer);
			this.usageTimer = undefined;
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
					this.endpoint = endpoint;
					this.endpointUrl = endpoint.url;
					this.client = OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) });
					return this.client;
				} catch (error) {
					this.errorMessage = describe(error);
					this.client = undefined;
					this.endpoint = undefined;
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

			const activeIDs = new Set(active ? Object.keys(active) : []);
			const pending = new Map<string, number>();

			for (const request of permissions?.data ?? []) {
				pending.set(request.sessionID, (pending.get(request.sessionID) ?? 0) + 1);
			}

			// A session blocked on a question form (or a permission prompt) still reports as a
			// running drain, so probe the active sessions for pending input. This is scoped to the
			// active sessions to keep the polling cheap.
			await Promise.all(
				[...activeIDs].map(async (id) => {
					const [forms, requests] = await Promise.all([
						client.session.form.list({ sessionID: id }).catch(() => []),
						client.permission.list({ sessionID: id }).catch(() => []),
					]);
					const count = (forms?.length ?? 0) + (requests?.length ?? 0);

					if (count > 0) {
						pending.set(id, Math.max(pending.get(id) ?? 0, count));
					}
				}),
			);

			this.view = buildSessions(list.data, activeIDs, pending);
			this.errorMessage = undefined;
			this.setState("ready");
		} catch (error) {
			this.errorMessage = describe(error);
			// Drop the cached client so the next tick rediscovers the service.
			this.client = undefined;
			this.endpoint = undefined;
			this.setState("error");
		} finally {
			this.refreshing = false;
		}
	}

	/**
	 * Pulls the OpenCode Go allowance from the local service. The endpoint is available in newer
	 * OpenCode builds; older services answer 404 and the key explains that an update is needed.
	 */
	async refreshUsage(): Promise<void> {
		if (this.refreshingUsage) {
			return;
		}

		this.refreshingUsage = true;

		try {
			const client = await this.ensureClient();

			if (!client || !this.endpoint) {
				this.usageView = undefined;
				this.usageStatus = "error";
				this.usageErrorMessage = this.errorMessage ?? "OpenCode unavailable";
				return;
			}

			const response = await fetch(new URL("/api/experimental/usage/limits", this.endpoint.url), {
				headers: this.headers(),
				signal: AbortSignal.timeout(10_000),
			});

			if (response.status === 404) {
				this.usageView = undefined;
				this.usageStatus = "unsupported";
				this.usageErrorMessage = undefined;
				return;
			}

			if (!response.ok) {
				throw new Error(`Usage request failed (${response.status})`);
			}

			const go = parseGoUsage((await response.json()) as UsageLimitsResponse);

			if (!go) {
				this.usageView = undefined;
				this.usageStatus = "unavailable";
				this.usageErrorMessage = undefined;
				return;
			}

			this.usageView = go;
			this.usageStatus = "ready";
			this.usageErrorMessage = undefined;
		} catch (error) {
			this.usageView = undefined;
			this.usageStatus = "error";
			this.usageErrorMessage = describe(error);
			streamDeck.logger.error(`Usage refresh failed: ${describe(error)}`);
		} finally {
			this.refreshingUsage = false;
			this.emit();
		}
	}

	private headers(): Record<string, string> | undefined {
		const auth = this.endpoint?.auth;

		if (!auth) {
			return undefined;
		}

		return {
			authorization: `Basic ${Buffer.from(`${auth.username}:${auth.password}`).toString("base64")}`,
		};
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
function buildSessions(sessions: SessionInfo[], activeIDs: Set<string>, pending: Map<string, number>): SessionView[] {
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
	// A session blocked on input takes precedence over a plain running state.
	if (pending > 0) {
		return "waiting";
	}

	if (active) {
		return "running";
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

function parseGoUsage(payload: UsageLimitsResponse): GoUsage | undefined {
	const go = payload?.data?.go;

	if (!go) {
		return undefined;
	}

	const rolling = parseMeter(go.rolling);
	const weekly = parseMeter(go.weekly);
	const monthly = parseMeter(go.monthly);

	if (!rolling || !weekly || !monthly) {
		return undefined;
	}

	return { rolling, weekly, monthly };
}

function parseMeter(value: unknown): UsageMeter | undefined {
	if (typeof value !== "object" || value === null) {
		return undefined;
	}

	const meter = value as { percent?: unknown; limited?: unknown; resetsAt?: unknown };

	if (typeof meter.percent !== "number" || !Number.isFinite(meter.percent)) {
		return undefined;
	}

	return {
		percent: Math.min(100, Math.max(0, meter.percent)),
		limited: meter.limited === true,
		resetsAt: typeof meter.resetsAt === "number" && Number.isFinite(meter.resetsAt) ? meter.resetsAt : 0,
	};
}

function describe(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}

	return String(error);
}
