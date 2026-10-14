/* global SDPIComponents */
(function () {
	const client = SDPIComponents.streamDeckClient;

	const statusEl = document.getElementById("status");
	const modeEl = document.getElementById("mode");
	const sessionEl = document.getElementById("session");
	const slotModeEl = document.getElementById("slotMode");
	const autoFields = document.getElementById("auto-fields");
	const pinnedFields = document.getElementById("pinned-fields");
	const manualSlot = document.getElementById("manual-slot");
	const positionHint = document.getElementById("position-hint");

	let settings = {};

	function refreshMode() {
		const pinned = (settings.mode ?? "auto") === "pinned";
		const manual = (settings.slotMode ?? "position") === "number";

		autoFields.classList.toggle("hidden", pinned);
		pinnedFields.classList.toggle("hidden", !pinned);
		manualSlot.classList.toggle("hidden", !manual);
		positionHint.classList.toggle("hidden", manual);
	}

	function refreshStatus(payload) {
		const state = payload.state ?? "connecting";

		statusEl.dataset.state = state;

		if (state === "ready") {
			statusEl.textContent = payload.url ? `Connected · ${payload.url}` : "Connected";
		} else if (state === "error") {
			statusEl.textContent = payload.error ? `OpenCode unavailable · ${payload.error}` : "OpenCode unavailable";
		} else {
			statusEl.textContent = "Connecting to OpenCode…";
		}
	}

	function refreshSessions(sessions) {
		const current = settings.sessionID ?? "";
		sessionEl.textContent = "";

		if (!sessions || sessions.length === 0) {
			const option = document.createElement("option");
			option.value = "";
			option.textContent = "No sessions found";
			sessionEl.append(option);
			return;
		}

		for (const session of sessions) {
			const option = document.createElement("option");
			option.value = session.id;
			option.textContent = `${session.title} (${session.status})`;
			sessionEl.append(option);
		}

		sessionEl.value = current;
	}

	function applySettings(next) {
		settings = next ?? {};
		refreshMode();
	}

	function bindValue(element, onChange) {
		const handler = () => onChange(element.value);

		// sdpi-components emit a non-bubbling "valuechange"; native elements emit "change".
		element.addEventListener("valuechange", handler);
		element.addEventListener("change", handler);
	}

	bindValue(modeEl, (value) => {
		settings = { ...settings, mode: value };
		refreshMode();
	});

	bindValue(slotModeEl, (value) => {
		settings = { ...settings, slotMode: value };
		refreshMode();
	});

	sessionEl.addEventListener("change", () => {
		settings = { ...settings, sessionID: sessionEl.value };
		client.setSettings(settings);
	});

	client.didReceiveSettings.subscribe((event) => applySettings(event.payload.settings));
	client.sendToPropertyInspector.subscribe((event) => {
		const payload = event.payload;

		if (!payload || payload.event !== "sessions") {
			return;
		}

		refreshStatus(payload);
		refreshSessions(payload.sessions);
	});

	(async function () {
		const result = await client.getSettings();
		applySettings(result.settings);

		// Ask the plugin for the current session list; it also pushes on appear.
		client.send("sendToPlugin", { event: "getSessions" });
	})();
})();
