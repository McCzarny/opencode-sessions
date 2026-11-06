import streamDeck from "@elgato/streamdeck";
import { SessionAction } from "./actions/session.js";
import { UsageAction } from "./actions/usage.js";
import { OpenCodeConnection } from "./opencode/connection.js";

const connection = new OpenCodeConnection();
const sessionAction = new SessionAction(connection);
const usageAction = new UsageAction(connection);

streamDeck.actions.registerAction(sessionAction);
streamDeck.actions.registerAction(usageAction);

let lastUsageSignature: string | undefined;

// Serve session data to the property inspector (dropdown + status line).
function publishSessions(): void {
	void streamDeck.ui.sendToPropertyInspector({
		event: "sessions",
		state: connection.state,
		url: connection.url,
		error: connection.error,
		sessions: connection.sessions.map((session) => ({
			id: session.id,
			title: session.title,
			status: session.status,
			active: session.active,
		})),
	});
}

// Serve Go usage to the usage property inspector. Only send when something changed, because the
// connection also emits on every session poll.
function publishUsage(force = false): void {
	const payload = {
		event: "usage",
		state: connection.state,
		usageState: connection.usageState,
		usage: connection.usage,
		error: connection.usageError,
	};
	const signature = JSON.stringify(payload);

	if (!force && signature === lastUsageSignature) {
		return;
	}

	lastUsageSignature = signature;
	void streamDeck.ui.sendToPropertyInspector(payload);
}

// Re-render keys whenever the connection state or session list changes.
connection.on(() => {
	sessionAction.refresh();
	usageAction.refresh();
	publishUsage();
});

streamDeck.ui.onDidAppear(() => {
	publishSessions();
	publishUsage(true);
});

streamDeck.ui.onSendToPlugin((ev) => {
	const payload = ev.payload as { event?: string } | undefined;

	switch (payload?.event) {
		case "getSessions":
			publishSessions();
			break;
		case "getUsage":
			publishUsage(true);
			break;
	}
});

connection.start();

await streamDeck.connect();
