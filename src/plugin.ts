import streamDeck from "@elgato/streamdeck";
import { SessionAction } from "./actions/session.js";
import { OpenCodeConnection } from "./opencode/connection.js";

const connection = new OpenCodeConnection();
const sessionAction = new SessionAction(connection);

streamDeck.actions.registerAction(sessionAction);

// Re-render keys whenever the connection state or session list changes.
connection.on(() => sessionAction.refresh());

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

streamDeck.ui.onDidAppear(() => publishSessions());

streamDeck.ui.onSendToPlugin((ev) => {
	const payload = ev.payload as { event?: string } | undefined;

	if (payload?.event === "getSessions") {
		publishSessions();
	}
});

connection.start();

await streamDeck.connect();
