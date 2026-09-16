<script lang="ts">
    import SettingsCard from './SettingsCard.svelte';
    import SettingRow from './SettingRow.svelte';
    import Button from '$lib/components/ui/Button.svelte';
    import { ui } from '$lib/stores/ui.svelte';
    import { WHATS_NEW } from '$lib/whats-new';

    const FEEDBACK_EMAIL = 'steveanil2003@gmail.com';
    const feedbackHref = `mailto:${FEEDBACK_EMAIL}`
        + `?subject=${encodeURIComponent('Codex Scriptura feedback')}`
        + `&body=${encodeURIComponent(`App update: ${WHATS_NEW[0].id}\nWhat I was doing:\n\nWhat happened:\n`)}`;
</script>

<SettingsCard id="about" kicker="About">
    <SettingRow label="Latest update" hint="{WHATS_NEW[0].title} · {WHATS_NEW[0].date}">
        <Button variant="secondary" onclick={() => { ui.whatsNewOpen = true; }}>What's new</Button>
    </SettingRow>
    <SettingRow label="Send feedback" hint="Found a bug or have an idea? An email goes straight to the developer.">
        <a class="about-btn" href={feedbackHref}>Email feedback</a>
    </SettingRow>
</SettingsCard>

<style>
    .about-btn {
        display: inline-flex;
        align-items: center;
        height: var(--row-h-sm);
        padding: 0 var(--space-3);
        background: var(--color-bg-surface);
        border: 1px solid var(--color-border-control);
        border-radius: var(--radius-sm);
        color: var(--color-text-primary);
        font-size: var(--font-size-sm);
        font-weight: 600;
        white-space: nowrap;
    }
    .about-btn:hover { background: var(--color-bg-hover); color: var(--color-text-primary); }
</style>
