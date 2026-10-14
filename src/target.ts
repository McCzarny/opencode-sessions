import type { SessionView } from "./opencode/connection.js";
import { DEFAULTS, type SessionSettings } from "./settings.js";

/** A session is considered live while it is running or waiting on the user. */
export function isLive(session: SessionView): boolean {
	return session.status === "running" || session.status === "waiting";
}

/** Sessions a slot-mode key is allowed to display. */
export function candidates(sessions: SessionView[], settings: SessionSettings): SessionView[] {
	const scope = settings.scope ?? DEFAULTS.scope;

	return scope === "all" ? sessions : sessions.filter(isLive);
}

/** Resolves the session a key should currently represent, if any. */
export function resolveTarget(sessions: SessionView[], settings: SessionSettings): SessionView | undefined {
	if ((settings.mode ?? "auto") === "pinned") {
		return settings.sessionID ? sessions.find((session) => session.id === settings.sessionID) : undefined;
	}

	const slot = Math.max(0, Math.trunc(Number(settings.slot ?? 0)) || 0);

	return candidates(sessions, settings)[slot];
}

/** A short label describing why a key has no session to show. */
export function emptyReason(settings: SessionSettings): string {
	if ((settings.mode ?? "auto") === "pinned") {
		return "Choose a session";
	}

	return (settings.scope ?? DEFAULTS.scope) === "active" ? "No active session" : "No sessions";
}
