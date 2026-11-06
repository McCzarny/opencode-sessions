/* global SDPIComponents */
(function () {
	const client = SDPIComponents.streamDeckClient;
	const statusEl = document.getElementById("status");

	function refreshStatus(payload) {
		if (!payload || payload.event !== "usage") {
			return;
		}

		if (payload.state !== "ready") {
			statusEl.dataset.state = "error";
			statusEl.textContent = payload.error ? `OpenCode unavailable · ${payload.error}` : "OpenCode unavailable";
			return;
		}

		if (payload.usageState === "ready" && payload.usage) {
			const { rolling, weekly, monthly } = payload.usage;

			statusEl.dataset.state = "ready";
			statusEl.textContent = `5h ${Math.round(rolling.percent)}% · week ${Math.round(
				weekly.percent,
			)}% · month ${Math.round(monthly.percent)}%`;
			return;
		}

		statusEl.dataset.state = "error";

		if (payload.usageState === "unknown") {
			statusEl.dataset.state = "connecting";
			statusEl.textContent = "Loading usage…";
		} else if (payload.usageState === "unsupported") {
			statusEl.textContent = "Update OpenCode to see Go usage";
		} else if (payload.usageState === "unavailable") {
			statusEl.textContent = "Not signed in to OpenCode Go";
		} else {
			statusEl.textContent = payload.error ? `Usage unavailable · ${payload.error}` : "Usage unavailable";
		}
	}

	client.sendToPropertyInspector.subscribe((event) => refreshStatus(event.payload));

	(async function () {
		client.send("sendToPlugin", { event: "getUsage" });
	})();
})();
