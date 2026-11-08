import { TOUR_OPTION_CHOICES, TOUR_PRESETS, TourOptionField, TourPreset, TourStyle, TourCoverage, TourDepth } from '../src/tourOptions.ts';

/** Controls edit requested authoring intent, never the currently loaded tour. */
export function createTourOptionsControls(document, instanceId, onChange) {
    const root = document.createElement('section');
    root.className = 'workspace-tour-options';
    root.setAttribute('aria-label', 'Tour options');
    const fields = new Map();
    const descriptions = new Map();
    const preset = select('preset', 'Starting preset', [{ value: '', label: 'Custom' }, ...TOUR_PRESETS.map(item => ({ value: item.id, label: item.label }))]);
    const labels = { style: 'Story style', depth: 'Explanation depth', audience: 'Audience', familiarity: 'Codebase familiarity', coverage: 'Coverage' };
    for (const key of [TourOptionField.Style, TourOptionField.Depth, TourOptionField.Audience, TourOptionField.Familiarity, TourOptionField.Coverage]) {
        const input = select(key, labels[key], TOUR_OPTION_CHOICES[key]);
        fields.set(key, input);
        input.addEventListener('change', () => {
            current = { ...current, [key]: input.value, inferred: current.inferred?.filter(field => field !== key) };
            onChange(current, author.value);
        });
    }
    const emphasis = document.createElement('fieldset');
    const legend = document.createElement('legend');
    legend.textContent = 'Optional emphasis';
    emphasis.appendChild(legend);
    const emphasisInputs = new Map();
    for (const choice of TOUR_OPTION_CHOICES.emphasis) {
        const label = document.createElement('label');
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.value = choice.value;
        input.setAttribute('aria-label', choice.label);
        const text = document.createElement('span');
        text.textContent = choice.label;
        label.append(input, text);
        emphasis.appendChild(label);
        emphasisInputs.set(choice.value, input);
        input.addEventListener('change', () => {
            current = { ...current, emphasis: [...emphasisInputs].filter(([, check]) => check.checked).map(([value]) => value), inferred: current.inferred?.filter(field => field !== TourOptionField.Emphasis) };
            onChange(current, author.value);
        });
    }
    root.appendChild(emphasis);
    const notes = textInput('context', 'Audience / task context (optional)', 'input');
    const author = textInput('author', 'Human author name (if known)', 'input');
    author.autocomplete = 'off';
    const guidance = document.createElement('p');
    guidance.className = 'workspace-prompt-context';
    guidance.textContent = 'Untouched defaults guide inference; choose a preset or change a field to request it explicitly. The authoring agent records resolved settings, inferred choices, and its actual model details in the tour file. No model runs inside Bygone.';
    root.appendChild(guidance);
    const caveat = document.createElement('p');
    caveat.className = 'workspace-prompt-context';
    root.appendChild(caveat);
    let current = structuredOptions(TOUR_PRESETS[0].options);
    preset.addEventListener('change', () => {
        const selected = TOUR_PRESETS.find(item => item.id === preset.value);
        if (!selected) return;
        current = { ...structuredOptions(selected.options), ...(current.notes ? { notes: current.notes } : {}) };
        onChange(current, author.value);
    });
    notes.addEventListener('input', () => {
        const rest = { ...current };
        delete rest.notes;
        current = notes.value.trim() ? { ...rest, notes: notes.value } : rest;
        onChange(current, author.value);
    });
    author.addEventListener('input', () => onChange(current, author.value));
    return { root, preset, update };

    function update(options, humanAuthor = '') {
        current = structuredOptions(options);
        for (const [key, input] of fields) {
            input.value = options[key];
            descriptions.get(key).textContent = TOUR_OPTION_CHOICES[key].find(choice => choice.value === options[key])?.description || '';
        }
        for (const [value, input] of emphasisInputs) input.checked = options.emphasis?.includes(value) || false;
        const match = TOUR_PRESETS.find(item => [...fields.keys()].every(key => item.options[key] === options[key])
            && JSON.stringify(item.options.emphasis || []) === JSON.stringify(options.emphasis || []));
        preset.value = match?.id || '';
        notes.value = options.notes || '';
        author.value = humanAuthor;
        caveat.textContent = options.coverage === TourCoverage.Complete
            ? `${options.depth === TourDepth.Headlines ? 'A brief opening still needs a complete walkthrough; no tiny total reading-time promise. ' : ''}100% refers to the final-result inventory, including for Historical and Deconstructed tours. Completion must be verified, independently of correctness and reader progress.`
            : 'Selected changes only. Explanation depth does not imply complete coverage.';
    }
    function select(key, title, choices) {
        const label = document.createElement('label');
        label.className = 'workspace-tour-option';
        label.textContent = title;
        const input = document.createElement('select');
        input.id = `bygone-workspace-${instanceId}-option-${key}`;
        input.setAttribute('aria-label', title);
        input.setAttribute('data-tour-option', key);
        for (const choice of choices) {
            const option = document.createElement('option');
            option.value = choice.value;
            option.textContent = choice.label;
            input.appendChild(option);
        }
        label.appendChild(input);
        const description = document.createElement('span');
        description.className = 'workspace-tour-option-description';
        description.id = `${input.id}-description`;
        input.setAttribute('aria-describedby', description.id);
        label.appendChild(description);
        descriptions.set(key, description);
        root.appendChild(label);
        return input;
    }
    function textInput(key, title, tag) {
        const label = document.createElement('label');
        label.className = 'workspace-tour-option workspace-tour-option-wide';
        label.textContent = title;
        const input = document.createElement(tag);
        input.setAttribute('data-tour-option', key);
        input.setAttribute('aria-label', title);
        label.appendChild(input);
        root.appendChild(label);
        return input;
    }
}
export function defaultTourOptions(kind) {
    const preset = TOUR_PRESETS.find(item => item.id === (kind === TourStyle.Deconstructed ? TourPreset.Onboard : kind === TourStyle.Historical ? TourPreset.History : TourPreset.CatchUp));
    return { ...structuredOptions(preset.options), inferred: Object.values(TourOptionField).filter(field => field !== TourOptionField.Style) };
}
function structuredOptions(options) { return JSON.parse(JSON.stringify(options)); }
