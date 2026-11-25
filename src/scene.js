export function prose(message) {
    if (!message || message.is_user || message.is_system || message.extra?.isSmallSys) return '';
    return String(message.mes ?? '').replace(/<(think|thinking|reasoning)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
        .replace(/<(think|thinking|reasoning)\b[^>]*>[\s\S]*$/gi, '').replace(/<details\b[^>]*>([\s\S]*?)<\/details>/gi, (_, content) => {
            const title = content.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i)?.[1] ?? '';
            return /思考|推理|选项|状态栏|记忆|reasoning|options|status|memory/i.test(title) ? '' : content.replace(/<[^>]+>/g, ' ');
        }).trim();
}

export function sourceAt(ctx, selected = 'latest') {
    const chat = ctx?.chat ?? [];
    const index = selected === 'latest' ? chat.findLastIndex(m => prose(m)) : Number(selected);
    const m = chat[index];
    const text = prose(m);
    if (!Number.isInteger(index) || !text) throw Error('请选择一条已有正文的 AI 回复。');
    const chatId = ctx.chatId || ctx.getCurrentChatId?.();
    if (!chatId) throw Error('请先打开一个已保存的角色聊天。');
    const key = JSON.stringify([ctx.groupId ?? null, ctx.characterId ?? null, chatId, index, m.swipe_id ?? 0]);
    return {key, index, text, speaker: m.name || '', latest: index === chat.findLastIndex(m => prose(m))};
}

function appearance(groups) {
    const parts = [];
    for (const group of ['beauty', 'body', 'clothing', 'accessories', 'overview']) {
        for (const [field, rec] of Object.entries(groups?.[group] ?? {})) {
            if (typeof rec?.fact === 'string' && rec.fact.trim()) {
                parts.push([field, rec.fact.slice(0, 240)]);
            }
        }
    }
    return parts;
}

export async function optionalLooks(bridge, source, timeout = 1200) {
    if (!bridge?.fullInspector) return [];
    let timer;
    const read = async () => {
        const summary = await bridge.fullInspector();
        const people = (summary.characters ?? []).filter(p => !p.blocked && p.name &&
            (source.text.includes(p.name) || source.speaker === p.name));
        if (!people.length || summary.runtime?.rebuild_required || summary.runtime?.requires_sync) return [];
        const floor = summary.runtime?.last_processed_message_id;
        const current = source.latest && floor != null && Number(floor) === source.index;
        const history = current ? null : (await bridge.historyIndex?.())?.find(h => h.message_id === source.index);
        if (!current && !history) return [];
        const previous = history ? await bridge.historyDetail(history.node_key) : null;
        const results = await Promise.all(people.map(async p => {
            const view = current ? (await bridge.fullInspector(p.character_id)).selected :
                previous?.characters?.find(c => c.id === p.character_id);
            const facts = appearance((view?.visual59 ?? view?.v59 ?? view?.v58 ?? view?.visual58)?.groups);
            return facts.length ? {name: p.name, facts} : null;
        }));
        return results.filter(Boolean);
    };
    try {
        return await Promise.race([read(), new Promise(resolve => { timer = setTimeout(() => resolve([]), timeout); })]);
    } catch { return []; } finally { clearTimeout(timer); }
}
