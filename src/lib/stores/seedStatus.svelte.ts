// ─── Seed Status Store ─────────────────────────────────────
// Surfaces first-run seeding progress and failures to the UI
// (known-issues #16 - previously every seed error died in the console
// and boot always reported ready, so a QuotaExceededError or missing
// core data file left the user with a silently broken app).

export type SeedFailure = {
    /** Human-readable dataset name, e.g. "King James Version" */
    dataset: string;
    message: string;
};

function createSeedStatusStore() {
    // What the seeder is doing right now (null when idle/done) - shown
    // on the boot screen during the 1–2 minute first-run seed.
    let currentStep = $state<string | null>(null);
    let failures = $state<SeedFailure[]>([]);
    // Banner dismissal is session-only: failures reappear on next boot
    // if the underlying problem persists.
    let dismissed = $state(false);

    return {
        get currentStep() {
            return currentStep;
        },
        get failures() {
            return failures;
        },
        get dismissed() {
            return dismissed;
        },
        step(label: string | null) {
            currentStep = label;
        },
        fail(dataset: string, err: unknown) {
            const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
            failures = [...failures, { dataset, message }];
        },
        dismiss() {
            dismissed = true;
        },
    };
}

export const seedStatus = createSeedStatusStore();
