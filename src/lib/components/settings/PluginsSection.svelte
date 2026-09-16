<script lang="ts">
    import SettingsCard from './SettingsCard.svelte';
    import Button from '$lib/components/ui/Button.svelte';
    import { MILESTONES } from '$lib/roadmap';
    const when = `Resource packs arrive with ${MILESTONES.resources}; executable plugins with ${MILESTONES.plugins}.`;
</script>

<SettingsCard id="plugins" kicker="Plugins">
    <div class="empty">
        <h3>No plugins installed</h3>
        <p>Plugins add Study Rail tabs, layers and corpora. Each gets its own panel in this section, plus a permissions summary before it is enabled.</p>
        <Button variant="secondary" disabled title={when}>Browse plugins</Button>
        <p class="when">{when}</p>
    </div>
</SettingsCard>

<style>
    .empty {
        text-align: center;
        padding: var(--space-8) var(--space-5) var(--space-6);
        border: 1px dashed var(--color-border);
        border-radius: var(--radius-md);
        margin-top: var(--space-3);
    }
    .empty h3 { color: var(--color-text-primary); font-size: var(--font-size-base); font-weight: 600; }
    .empty p { color: var(--color-text-muted); font-size: var(--font-size-xs); max-width: 44ch; margin: var(--space-2) auto var(--space-4); }
    .when { margin-top: var(--space-3) !important; margin-bottom: 0 !important; }
</style>
