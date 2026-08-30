/**
 * App-wide toasts (issue #169): brief confirmation for actions that used
 * to give no feedback, and the Undo channel for destructive deletes.
 * Rendered once by Toaster.svelte in the root layout.
 */

export type ToastAction = { label: string; run: () => void | Promise<void> };
export type Toast = { id: number; message: string; action?: ToastAction };

const DEFAULT_MS = 4000;
// Undo needs time to be noticed and reached
const ACTION_MS = 8000;
const MAX_VISIBLE = 3;

export class ToastState {
    items = $state<Toast[]>([]);
    #nextId = 1;
    #timers = new Map<number, ReturnType<typeof setTimeout>>();

    /** Show a toast; returns its id. Toasts with an action stay up longer. */
    show(message: string, opts: { action?: ToastAction; duration?: number } = {}): number {
        const id = this.#nextId++;
        const next = [...this.items, { id, message, action: opts.action }];
        while (next.length > MAX_VISIBLE) this.#clearTimer(next.shift()!.id);
        this.items = next;
        const ms = opts.duration ?? (opts.action ? ACTION_MS : DEFAULT_MS);
        this.#timers.set(id, setTimeout(() => this.dismiss(id), ms));
        return id;
    }

    dismiss(id: number): void {
        this.#clearTimer(id);
        this.items = this.items.filter((t) => t.id !== id);
    }

    /** Run the toast's action (Undo) and take the toast down. */
    async act(id: number): Promise<void> {
        const t = this.items.find((t) => t.id === id);
        if (!t) return;
        this.dismiss(id);
        await t.action?.run();
    }

    #clearTimer(id: number) {
        const timer = this.#timers.get(id);
        if (timer) clearTimeout(timer);
        this.#timers.delete(id);
    }
}

export const toast = new ToastState();
