<script module lang="ts">
    /** A highlight preset as the toolbar shows it: value is the stored colour. */
    export type HighlightSwatch = { name: string; id: string; value: string };
</script>

<script lang="ts">
    /**
     * Pick a highlight's colour from the user's presets (issue #322). The
     * stored colour is the preset's translucent value, so a highlight made
     * before a preset was recoloured in Settings matches none of them; it
     * shows as "Current" until another swatch is chosen.
     */
    let {
        color = $bindable(''),
        swatches,
    }: {
        color?: string;
        swatches: HighlightSwatch[];
    } = $props();

    const uid = $props.id();
    const original = color;
    let showCurrent = $derived(!!original && !swatches.some((s) => s.value === original));
</script>

<fieldset class="highlight-editor">
    <legend>Colour</legend>
    <div class="swatches">
        {#if showCurrent}
            <label class="swatch" title="Current colour">
                <input type="radio" name="{uid}-color" value={original} bind:group={color} aria-label="Current colour" />
                <span style="background-color: {original}"></span>
            </label>
        {/if}
        {#each swatches as s (s.id)}
            <label class="swatch" title={s.name}>
                <input type="radio" name="{uid}-color" value={s.value} bind:group={color} aria-label={s.name} />
                <span style="background-color: {s.value}"></span>
            </label>
        {/each}
    </div>
</fieldset>

<style>
    .highlight-editor {
        border: none;
        margin: 0;
        padding: 0;
        min-width: 0;
    }
    legend {
        padding: 0;
        margin-bottom: var(--space-2);
        font-size: var(--font-size-xs);
        color: var(--color-text-secondary);
        font-weight: 500;
    }
    .swatches { display: flex; flex-wrap: wrap; gap: var(--space-2); }
    .swatch { position: relative; display: inline-flex; cursor: pointer; }
    .swatch input {
        position: absolute;
        inset: 0;
        margin: 0;
        opacity: 0;
        cursor: pointer;
    }
    .swatch span {
        width: 24px;
        height: 24px;
        border-radius: 50%;
        border: 2px solid transparent;
        transition: transform 0.1s;
        pointer-events: none;
    }
    .swatch:hover span { transform: scale(1.1); border-color: var(--color-text-muted); }
    .swatch input:checked + span { border-color: var(--color-text-primary); }
    .swatch input:focus-visible + span { box-shadow: var(--focus-ring); }
</style>
