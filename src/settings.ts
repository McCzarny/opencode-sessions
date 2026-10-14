/**
 * Which sessions a slot-mode key is allowed to show.
 */
export type SessionScope = "active" | "all";

/**
 * How a slot-mode key picks its index.
 *
 * - `position` — derived from the key's place on the deck, so several Session keys line up with
 *   the first, second, third … session without any per-key configuration.
 * - `number` — an explicit slot index configured in the property inspector.
 */
export type SlotMode = "position" | "number";

/**
 * Settings for the `session` key action.
 */
export type SessionSettings = {
	/** Whether the key follows a live slot, or a pinned session. */
	mode?: "auto" | "pinned";
	/** How the slot index is chosen when in `auto` mode. */
	slotMode?: SlotMode;
	/** One-based session number when `slotMode` is `number` (1 = the first session). */
	slot?: number;
	/** Session identifier when in `pinned` mode. */
	sessionID?: string;
	/** Which sessions are considered when in `auto` mode. */
	scope?: SessionScope;
};

export const DEFAULTS = {
	mode: "auto" as const,
	slotMode: "position" as SlotMode,
	slot: 1,
	scope: "all" as SessionScope,
};
