import type { SessionStatus } from "./opencode/connection.js";
import type { UsageWindow } from "./settings.js";

export type VisualStatus = SessionStatus | "empty" | "offline";

type Palette = {
	accent: string;
	label: string;
};

const PALETTE: Record<VisualStatus, Palette> = {
	running: { accent: "#3b82f6", label: "RUNNING" },
	waiting: { accent: "#f59e0b", label: "NEEDS INPUT" },
	attention: { accent: "#facc15", label: "UNREAD" },
	error: { accent: "#ef4444", label: "FAILED" },
	interrupted: { accent: "#fb923c", label: "STOPPED" },
	done: { accent: "#22c55e", label: "DONE" },
	idle: { accent: "#64748b", label: "IDLE" },
	empty: { accent: "#334155", label: "NO SESSION" },
	offline: { accent: "#ef4444", label: "OFFLINE" },
};

const FONT = "SF Pro Text, Segoe UI, -apple-system, system-ui, sans-serif";
const BACKGROUND = "#0d1117";

export type SessionVisual = {
	title: string;
	subtitle?: string;
	status: VisualStatus;
};

/**
 * Renders a session key as an SVG data URL.
 */
export function sessionImage(visual: SessionVisual): string {
	const palette = PALETTE[visual.status];
	const lines = wrap(visual.title, 11, 3);
	const isPlaceholder = visual.status === "empty" || visual.status === "offline";

	const title = lines
		.map((line, index) => `<text x="26" y="${64 + index * 25}" font-family="${FONT}" font-size="20" font-weight="700" fill="#f8fafc">${escapeXml(line)}</text>`)
		.join("");

	const subtitle =
		!isPlaceholder && visual.subtitle
			? `<text x="26" y="132" font-family="${FONT}" font-size="12" font-weight="500" fill="#94a3b8">${escapeXml(truncate(visual.subtitle, 20))}</text>`
			: "";

	const body = isPlaceholder
		? `<text x="72" y="88" text-anchor="middle" font-family="${FONT}" font-size="14" font-weight="600" fill="#94a3b8">${escapeXml(truncate(visual.subtitle ?? palette.label, 18))}</text>`
		: title;

	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
	<defs><clipPath id="key"><rect width="144" height="144" rx="16" /></clipPath></defs>
	<rect width="144" height="144" rx="16" fill="${BACKGROUND}" />
	<rect x="0.5" y="0.5" width="143" height="143" rx="15.5" fill="none" stroke="#ffffff" stroke-opacity="0.06" />
	<g clip-path="url(#key)"><rect x="0" y="0" width="12" height="144" fill="${palette.accent}" /></g>
	<circle cx="27" cy="26" r="5" fill="${palette.accent}" />
	<text x="39" y="31" font-family="${FONT}" font-size="13" font-weight="700" letter-spacing="1.4" fill="${palette.accent}">${escapeXml(palette.label)}</text>
	${body}
	${subtitle}
</svg>`;

	return toDataUrl(svg);
}

export type UsageVisualState = "ready" | "loading" | "offline" | "unsupported" | "unavailable" | "error";

export type UsageVisual = {
	window: UsageWindow;
	state: UsageVisualState;
	percent?: number;
	limited?: boolean;
	resetsAt?: number;
	message?: string;
};

const USAGE_WINDOW_LABEL: Record<UsageWindow, string> = {
	rolling: "5 HOURS",
	weekly: "WEEKLY",
	monthly: "MONTHLY",
};

/**
 * Renders an OpenCode Go usage key as an SVG data URL.
 */
export function usageImage(visual: UsageVisual): string {
	const ready = visual.state === "ready";
	const percent = ready ? Math.min(100, Math.max(0, visual.percent ?? 0)) : 0;
	const accent = ready ? usageAccent(percent, visual.limited === true) : usageStateAccent(visual.state);
	const label = ready ? `GO · ${USAGE_WINDOW_LABEL[visual.window]}` : visual.state === "offline" ? "OFFLINE" : "GO USAGE";
	const value = ready ? `${Math.round(percent)}%` : "—";
	const detail = ready
		? visual.limited
			? "Limit reached"
			: resetsIn(visual.resetsAt ?? 0)
		: truncate(visual.message ?? "", 22);
	const filled = Math.max(percent > 0 ? 3 : 0, Math.round((92 * percent) / 100));
	const bar = ready
		? `<rect x="26" y="104" width="92" height="6" rx="3" fill="#1f2937" />
	<rect x="26" y="104" width="${filled}" height="6" rx="3" fill="${accent}" />`
		: "";

	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
	<defs><clipPath id="key"><rect width="144" height="144" rx="16" /></clipPath></defs>
	<rect width="144" height="144" rx="16" fill="${BACKGROUND}" />
	<rect x="0.5" y="0.5" width="143" height="143" rx="15.5" fill="none" stroke="#ffffff" stroke-opacity="0.06" />
	<g clip-path="url(#key)"><rect x="0" y="0" width="12" height="144" fill="${accent}" /></g>
	<circle cx="27" cy="26" r="5" fill="${accent}" />
	<text x="39" y="31" font-family="${FONT}" font-size="13" font-weight="700" letter-spacing="1.4" fill="${accent}">${escapeXml(label)}</text>
	<text x="72" y="88" text-anchor="middle" font-family="${FONT}" font-size="48" font-weight="800" fill="#f8fafc">${escapeXml(value)}</text>
	${bar}
	<text x="72" y="130" text-anchor="middle" font-family="${FONT}" font-size="11" font-weight="500" fill="#94a3b8">${escapeXml(detail)}</text>
</svg>`;

	return toDataUrl(svg);
}

function usageAccent(percent: number, limited: boolean): string {
	if (limited || percent >= 90) {
		return "#ef4444";
	}

	if (percent >= 70) {
		return "#f59e0b";
	}

	return "#3b82f6";
}

function usageStateAccent(state: UsageVisualState): string {
	if (state === "offline" || state === "error") {
		return "#ef4444";
	}

	return "#64748b";
}

/** Formats the time until a limit resets, e.g. "resets in 2d 4h". */
function resetsIn(resetsAt: number): string {
	const remaining = resetsAt - Date.now();

	if (!resetsAt || remaining <= 0) {
		return "reset pending";
	}

	const minutes = Math.ceil(remaining / 60_000);
	const days = Math.floor(minutes / 1_440);
	const hours = Math.floor((minutes % 1_440) / 60);
	const mins = minutes % 60;

	if (minutes <= 0) {
		return "resets soon";
	}

	if (days > 0) {
		return hours > 0 ? `resets in ${days}d ${hours}h` : `resets in ${days}d`;
	}

	if (hours > 0) {
		return mins > 0 ? `resets in ${hours}h ${mins}m` : `resets in ${hours}h`;
	}

	return `resets in ${mins}m`;
}

function toDataUrl(svg: string): string {
	return `data:image/svg+xml,${encodeURIComponent(svg.replace(/\n\s*/g, ""))}`;
}

/** Wraps text into at most `maxLines` lines of `maxChars` characters. */
function wrap(text: string, maxChars: number, maxLines: number): string[] {
	const words = text.split(/\s+/).filter(Boolean);
	const lines: string[] = [];
	let current = "";

	const flush = () => {
		if (current) {
			lines.push(current);
			current = "";
		}
	};

	for (const raw of words) {
		let word = raw;

		// Break words that cannot fit on a single line.
		while (word.length > maxChars) {
			flush();
			lines.push(`${word.slice(0, maxChars - 1)}…`);
			word = word.slice(maxChars - 1);

			if (lines.length >= maxLines) {
				return lines.slice(0, maxLines);
			}
		}

		if (!current) {
			current = word;
		} else if (current.length + 1 + word.length <= maxChars) {
			current += ` ${word}`;
		} else {
			flush();
			current = word;
		}

		if (lines.length >= maxLines) {
			current = "";
			break;
		}
	}

	flush();

	return lines.slice(0, maxLines);
}

function truncate(text: string, maxChars: number): string {
	return text.length <= maxChars ? text : `${text.slice(0, maxChars - 1)}…`;
}

function escapeXml(value: string): string {
	return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
