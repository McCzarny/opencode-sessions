import streamDeck, {
	action,
	type Coordinates,
	type DidReceiveSettingsEvent,
	type KeyAction,
	type KeyDownEvent,
	type WillAppearEvent,
	type WillDisappearEvent,
	SingletonAction,
} from "@elgato/streamdeck";
import type { OpenCodeConnection, SessionView } from "../opencode/connection.js";
import { DEFAULTS, type SessionSettings } from "../settings.js";
import { sessionImage } from "../render.js";
import { emptyReason, resolveTarget } from "../target.js";

type Handle = {
	action: KeyAction<SessionSettings>;
	settings: SessionSettings;
	coordinates?: Coordinates;
};

/**
 * Shows a single OpenCode session and its status. Pressing the key forces a refresh.
 *
 * In the default "position" slot mode, keys claim their slot from their place on the deck, so a row
 * of Session keys lines up with the first, second, third … session automatically.
 */
@action({ UUID: "ai.opencode.streamdeck.session" })
export class SessionAction extends SingletonAction<SessionSettings> {
	private readonly handles = new Map<string, Handle>();

	constructor(private readonly connection: OpenCodeConnection) {
		super();
	}

	override onWillAppear(ev: WillAppearEvent<SessionSettings>): void {
		if (!ev.action.isKey()) {
			return;
		}

		this.handles.set(ev.action.id, {
			action: ev.action,
			settings: ev.payload.settings,
			coordinates: ev.action.coordinates,
		});

		// A new key shifts the position slots of the others, so refresh them all.
		this.refresh();
	}

	override onWillDisappear(ev: WillDisappearEvent<SessionSettings>): void {
		this.handles.delete(ev.action.id);
		this.refresh();
	}

	override onDidReceiveSettings(ev: DidReceiveSettingsEvent<SessionSettings>): void {
		const handle = this.handles.get(ev.action.id);

		if (handle) {
			handle.settings = ev.payload.settings;
		}

		this.refresh();
	}

	override async onKeyDown(ev: KeyDownEvent<SessionSettings>): Promise<void> {
		await this.connection.refresh();

		if (this.connection.state === "ready") {
			await ev.action.showOk();
			return;
		}

		streamDeck.logger.error(`Session refresh failed: ${this.connection.error ?? "OpenCode unavailable"}`);
		await ev.action.showAlert();
	}

	/** Re-renders every visible session key. */
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

		const settings = this.effective(id, handle.settings);

		if (this.connection.state !== "ready") {
			await handle.action.setImage(
				sessionImage({
					title: "",
					status: "offline",
					subtitle: this.connection.state === "connecting" ? "Connecting…" : "Start OpenCode",
				}),
			);
			return;
		}

		const target = resolveTarget(this.connection.sessions, settings);

		if (!target) {
			await handle.action.setImage(sessionImage({ title: "", status: "empty", subtitle: emptyReason(settings) }));
			return;
		}

		await handle.action.setImage(sessionImage({ title: target.title, status: target.status, subtitle: subtitle(target) }));
	}

	/**
	 * Applies the position slot to the settings when the key uses position-based slots.
	 */
	private effective(id: string, settings: SessionSettings): SessionSettings {
		if ((settings.mode ?? "auto") === "pinned") {
			return settings;
		}

		if ((settings.slotMode ?? DEFAULTS.slotMode) === "position") {
			return { ...settings, slot: this.positionSlots().get(id) ?? 0 };
		}

		// Manual slot is one-based; convert to a zero-based index.
		const manual = Math.trunc(Number(settings.slot ?? DEFAULTS.slot));

		return { ...settings, slot: Math.max(0, (Number.isFinite(manual) ? manual : DEFAULTS.slot) - 1) };
	}

	/**
	 * Maps each slot-mode Session key to an index based on its physical position (row, then column).
	 * Pinned keys and keys without coordinates are excluded so they do not consume a slot.
	 */
	private positionSlots(): Map<string, number> {
		const ordered = [...this.handles.entries()]
			.filter(([, handle]) => (handle.settings.mode ?? "auto") !== "pinned" && handle.coordinates !== undefined)
			.sort(([, left], [, right]) => {
				const l = left.coordinates!;
				const r = right.coordinates!;

				return l.row - r.row || l.column - r.column;
			});

		return new Map(ordered.map(([id], index) => [id, index]));
	}
}

function subtitle(session: SessionView): string {
	const parts: string[] = [];

	if (session.agent) {
		parts.push(session.agent);
	}

	if (session.pending > 0) {
		parts.push(`${session.pending} pending`);
	}

	parts.push(session.id.slice(0, 8));

	return parts.join(" · ");
}
