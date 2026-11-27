import {matchingCharacters} from './identity.js';

function legacyFloorText(message) {
    if (!message || message.is_user || message.is_system || message.extra?.isSmallSys) return '';
    return String(message.mes ?? '').replace(/<(think|thinking|reasoning)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
        .replace(/<(think|thinking|reasoning)\b[^>]*>[\s\S]*$/gi, '').replace(/<details\b[^>]*>([\s\S]*?)<\/details>/gi, (_, content) => {
            const title = content.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i)?.[1] ?? '';
            return /思考|推理|选项|状态栏|记忆|reasoning|options|status|memory/i.test(title) ? '' : content.replace(/<[^>]+>/g, ' ');
        }).trim();
}


export function prose(message) {
    return legacyFloorText(message)
        .replace(/<!--[\s\S]*?(?:-->|$)/g,'')
        .replace(/^[ \t]*(`{3,}|~{3,})[^\r\n]*\r?\n[\s\S]*?(?:^[ \t]*\1[ \t]*(?=\r?$)|(?![\s\S]))/gm,'')
        .replace(/<(script|style|template)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi,'')
        .replace(/<(wave_plan|planning|plan|analysis|summary|choices|options|status_bar|UpdateVariable)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,'')
        .replace(/<(?:wave_plan|planning|plan|analysis|summary|choices|options|status_bar|UpdateVariable)\b[^>]*>[\s\S]*$/gi,'')
        .replace(/<(?:now_plot|gametxt|story|narrative)\b[^>]*>|<\/(?:now_plot|gametxt|story|narrative)\s*>/gi,'')
        .replace(/<\/(?:p|div)\s*>|<br\s*\/?>/gi,'\n')
        .replace(/<\/?(?:p|div|em|strong|span|i|b)\b[^>]*>/gi,'')
        .trim();
}

export function sourceAt(ctx, selected = 'latest') {
    const chat = ctx?.chat ?? [];
    const index = selected === 'latest' ? chat.findLastIndex(m => prose(m)) : Number(selected);
    const m = chat[index];
    const visualText = prose(m);
    const text = legacyFloorText(m);
    if (!Number.isInteger(index) || !visualText) throw Error('请选择一条已有正文的 AI 回复。');
    const chatId = ctx.chatId || ctx.getCurrentChatId?.();
    if (!chatId) throw Error('请先打开一个已保存的角色聊天。');
    const key = JSON.stringify([ctx.groupId ?? null, ctx.characterId ?? null, chatId, index, m.swipe_id ?? 0]);
    return {key, index, text, visualText, speaker: m.name || '', latest: index === chat.findLastIndex(m => prose(m))};
}

export function passageRanges(text) {
    const sentences = new Intl.Segmenter('zh',{granularity:'sentence'});
    const ranges = [];
    const add = (part, offset) => {
        const value = part.trim();
        if (!value || !/[\p{L}\p{N}]/u.test(value)) return;
        const start = offset + part.indexOf(value);
        ranges.push({start,end:start + value.length,text:value});
    };
    for (const line of text.matchAll(/[^\r\n]+/g)) {
        if (line[0].length <= 260) add(line[0],line.index);
        else for (const sentence of sentences.segment(line[0])) add(sentence.segment,line.index + sentence.index);
    }
    return ranges;
}

export function withPassage(source, passage) {
    const {start,end} = passage;
    if (!Number.isInteger(start) || !Number.isInteger(end) ||
        start < 0 || end <= start || end > source.visualText?.length) throw Error('正文范围已失效，请重新选择。');
    const text = source.visualText.slice(start,end);
    if (text !== passage.text) throw Error('这段正文已变更，请重新选择。');
    return {...source,passage:{start,end,text},selectedText:text,
        earlierInReply:source.visualText.slice(0,start).trim().slice(-1800)};
}

const visualGroups = {
    overview:['种族','肤色与肌肤质感','风格与气质'],
    beauty:null, body:['身高与头身比','整体身形体态'], clothing:null, accessories:null, scene:null
};
const useful = (value, limit) => typeof value === 'string' ? value.trim().slice(0,limit) : '';

function appearance(view) {
    const {groups} = view?.visual59 ?? view?.v59 ?? view?.v58 ?? {};
    const assets = Array.isArray(view?.ng_items) ? view.ng_items : [];
    const itemSlots = new Set(assets.map(item => item.slot));
    const facts = {};
    for (const [group, fields] of Object.entries(visualGroups)) {
        for (const [field, rec] of Object.entries(groups?.[group] ?? {})) {
            if (fields && !fields.includes(field) || itemSlots.has(field)) continue;
            const fact = useful(rec?.fact, 240);
            if (fact) (facts[group] ??= {})[field] = fact;
        }
    }
    const items = assets.filter(item => item.name).sort((a,b) =>
        Number(b.wear_state === 'worn') - Number(a.wear_state === 'worn')).slice(0,32).map(item => ({
        slot:item.slot, name:item.name, wearState:item.wear_state || 'unknown',
        condition:item.condition, location:useful(item.location?.label,100),
        design:item.wear_state === 'worn' ? useful(item.design?.fact,230) || useful(item.design?.prose,180) : undefined
    }));
    return {facts, items};
}

export function archivePeople(summary) {
    return (summary?.characters ?? []).filter(person => !person.blocked && person.character_id && person.name)
        .map(person => ({id:person.character_id, name:person.name, active:person.active}));
}

export async function optionalLooks(bridge, source, bindings = {}, useArchive = true, timeout = 1800) {
    if (!bridge?.fullInspector || !useArchive && !Object.keys(bindings).length) return [];
    let timer;
    const read = async () => {
        const summary = await bridge.fullInspector();
        const runtime = summary?.runtime;
        const visible = source.selectedText ?? source.visualText ?? source.text;
        const active = archivePeople(summary);
        const blocked = new Set((summary?.characters ?? []).filter(person => person.blocked).map(person => person.character_id));
        const nodes = useArchive ? (await bridge.historyIndex?.()) ?? [] : [];
        // A reply's end state may contain changes that occur after the selected moment.
        const history = source.passage
            ? nodes.reduce((previous,node) => Number(node.message_id) < source.index &&
                (!previous || Number(node.message_id) > Number(previous.message_id)) ? node : previous,null)
            : nodes.find(node => Number(node.message_id) === source.index);
        const current = !source.passage && history?.current && source.latest && !runtime?.rebuild_required && !runtime?.requires_sync &&
            Number(runtime?.last_processed_message_id) === source.index &&
            (!runtime?.active_head || runtime.active_head === history.node_key);
        const snapshot = history && !current ? await bridge.historyDetail(history.node_key) : null;
        const historical = new Map((snapshot?.characters ?? []).filter(person => !blocked.has(person.id) &&
            !person.status?.user_blocked && !person.status?.detached_from_active_timeline).map(person => [person.id,person]));
        const people = new Map(active.filter(person => !snapshot || historical.has(person.id) || bindings[person.id]?.type === 'fan')
            .map(person => [person.id,person]));
        for (const [id, person] of historical) people.set(id,{id,name:person.name});
        const named = [...people.values()].map(person => ({...person, identity:bindings[person.id]}));
        // Candidate discovery keeps overlapping names so the final role check can detect ambiguity.
        const relevant = named.filter(person => matchingCharacters([person],visible,source.speaker).length ||
            (source.earlierInReply && matchingCharacters([person],source.earlierInReply).length))
            .sort((a,b) => Number(b.identity?.type === 'fan') - Number(a.identity?.type === 'fan'));
        const results = await Promise.all(relevant.slice(0,12).map(async ({id,name,identity}) => {
            const fan = identity?.type === 'fan' ? identity : undefined;
            const live = current ? await bridge.fullInspector(id) : null;
            const matchesFloor = live?.selected?.character_id === id &&
                Number(live.runtime?.last_processed_message_id) === source.index &&
                live.runtime?.active_head === runtime.active_head && !live.runtime?.requires_sync;
            const view = matchesFloor ? live.selected : historical.get(id);
            return {id,name,identity:fan,...appearance(view)};
        }));
        return results;
    };
    try {
        return await Promise.race([read(), new Promise(resolve => { timer = setTimeout(() => resolve([]), timeout); })]);
    } catch { return []; } finally { clearTimeout(timer); }
}

export function priorContext(ctx, index, count) {
    if (!count) return [];
    return ctx.chat.slice(0, index).map(m => prose(m)).filter(Boolean).slice(-count)
        .map(text => text.slice(-1800));
}
