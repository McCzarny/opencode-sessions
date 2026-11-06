import streamDeck, {
	action,
	type DidReceiveSettingsEvent,
	type KeyAction,
	type KeyDownEvent,
	type WillAppearEvent,
	type WillDisappearEvent,
	SingletonAction,
} from "@elgato/streamdeck";
import type { OpenCodeConnection } from "../opencode/connection.js";
import { USAGE_DEFAULTS, type UsageSettings, type UsageWindow } from "../settings.js";
import { usageImage, type UsageVisual } from "../render.js";

type Handle = {
	action: KeyAction<UsageSettings>;
	settings: UsageSettings;
};

/**
 * Shows how much of the OpenCode Go allowance has been used. Pressing the key forces a refresh.
 *
 * The tile can display the rolling five-hour, weekly, or monthly window; the window is chosen in
 * the property inspector.
 */
@action({ UUID: "ai.opencode.streamdeck.usage" })
export class UsageAction extends SingletonAction<UsageSettings> {
	private readonly handles = new Map<string, Handle>();

	constructor(private readonly connection: OpenCodeConnection) {
		super();
	}

	override onWillAppear(ev: WillAppearEvent<UsageSettings>): void {
		if (!ev.action.isKey()) {
			return;
		}

		this.handles.set(ev.action.id, {
			action: ev.action,
			settings: ev.payload.settings,
		});

		this.connection.startUsage();
		void this.render(ev.action.id);
	}

	override onWillDisappear(ev: WillDisappearEvent<UsageSettings>): void {
		this.handles.delete(ev.action.id);

		if (this.handles.size === 0) {
			this.connection.stopUsage();
		}
	}

	override onDidReceiveSettings(ev: DidReceiveSettingsEvent<UsageSettings>): void {
		const handle = this.handles.get(ev.action.id);

		if (handle) {
			handle.settings = ev.payload.settings;
		}

		void this.render(ev.action.id);
	}

	override async onKeyDown(ev: KeyDownEvent<UsageSettings>): Promise<void> {
		await this.connection.refresh();
		await this.connection.refreshUsage();

		if (this.connection.state === "ready" && this.connection.usageState === "ready") {
			await ev.action.showOk();
			return;
		}

		streamDeck.logger.error(
			`Usage refresh failed: ${this.connection.usageError ?? this.connection.error ?? "OpenCode unavailable"}`,
		);
		await ev.action.showAlert();
	}

	/** Re-renders every visible usage key. */
	refresh(): void {
		for (const id of this.handles.keys()) {
			void this.render(id);
		}
	}

	private async render(id: string): Promise<void> {
		const handle = this.handles.get(id);

		if (!handle) {
			return;
		}

		const window = handle.settings.window ?? USAGE_DEFAULTS.window;

		await handle.action.setImage(usageImage(visual(this.connection, window)));
	}
}

function visual(connection: OpenCodeConnection, window: UsageWindow): UsageVisual {
	if (connection.state === "connecting") {
		return { window, state: "loading", message: "Connecting…" };
	}

	if (connection.state !== "ready") {
		return { window, state: "offline", message: "Start OpenCode" };
	}

	switch (connection.usageState) {
		case "ready": {
			const meter = connection.usage?.[window];

			return meter
				? { window, state: "ready", percent: meter.percent, limited: meter.limited, resetsAt: meter.resetsAt }
				: { window, state: "unavailable", message: "No usage data" };
		}
		case "unsupported":
			return { window, state: "unsupported", message: "Update OpenCode" };
		case "unavailable":
			return { window, state: "unavailable", message: "Not signed in" };
		case "error":
			return { window, state: "error", message: "Unavailable" };
		default:
			return { window, state: "loading", message: "Loading…" };
	}
}
