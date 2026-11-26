export function chatPresetManager(context) {
    return context.getPresetManager?.('openai');
}

export function presetNames(manager) {
    const names = manager?.getPresetList?.('openai')?.preset_names;
    return (Array.isArray(names) ? names : names ? Object.keys(names) : manager?.getAllPresets?.() ?? [])
        .filter(name => typeof name === 'string' && !!name.trim());
}

export function visionPreset(manager, name, context) {
    if (!name || !presetNames(manager).includes(name)) throw Error('请在「连接」选择仍存在的对话补全预设。');
    const preset = manager.getCompletionPresetByName(name);
    if (!preset) throw Error('未能读取所选对话补全预设。');
    const prompts = Array.isArray(preset.prompts) ? preset.prompts : [];
    const order = Array.isArray(preset.prompt_order) ? preset.prompt_order : [];
    const entry = order.find(item => String(item.character_id) === String(context.characterId))
        ?? order.find(item => item.character_id === 100001) ?? order.find(item => item.character_id === 100000) ?? order[0];
    const enabled = Array.isArray(entry?.order)
        ? entry.order.filter(row => row.enabled).map(row => prompts.find(prompt => prompt.identifier === row.identifier))
        : prompts.filter(prompt => prompt.enabled !== false);
    const instructions = enabled.filter(prompt => prompt?.role === 'system' && !prompt.marker && typeof prompt.content === 'string')
        .map(prompt => prompt.content.replace(/{{\s*(char|user)\s*}}/gi, (_, key) =>
            String((key.toLowerCase() === 'char' ? context.name2 : context.name1) ?? '')))
        .map(prompt => prompt.trim()).filter(Boolean);
    const sampling = {};
    for (const [key, limit] of [['temperature',2],['top_p',1]]) {
        if (typeof preset[key] === 'number' && Number.isFinite(preset[key]) && preset[key] >= 0 && preset[key] <= limit) sampling[key] = preset[key];
    }
    if (['none','minimal','low','medium','high','xhigh'].includes(preset.reasoning_effort)) {
        sampling.reasoning_effort = preset.reasoning_effort;
    }
    return {instructions,sampling};
}
