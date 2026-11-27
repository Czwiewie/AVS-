const JINHSI = {
    name:'今汐', romanName:'Jinhsi', work:'Wuthering Waves', workLabel:'鸣潮',
    aliases:['今汐','Jinhsi','こんし'],
    tags:'silver-white hair, very long hair, looped low twintails, pale turquoise hair accents, pale silver eyes, beauty mark on right cheek',
    features:'Very long silver-white hair with pale turquoise accents, usually gathered into low looped twin tails, pale silver eyes, fair skin and a small beauty mark high on her right cheek.',
    source:'https://wutheringwaves.kurogames.com/en/main/news/detail/965',
    portrait:'https://mc.kurogames.com/static4.0/assets/jinxi-422f1400.png'
};

const aliasKey = value => String(value ?? '').normalize('NFKC').trim().toLowerCase();

export function suggestedIdentity(name) {
    return JINHSI.aliases.some(alias => aliasKey(name) === aliasKey(alias)) ? JINHSI : null;
}

export function archiveScope(ctx) {
    const chat = ctx.chatId || ctx.getCurrentChatId?.();
    return chat ? JSON.stringify([ctx.groupId ?? null, ctx.characterId ?? null, chat]) : '';
}

export function publicSource(value) {
    if (!value) return '';
    let url;
    try { url = new URL(value); } catch { /* The input still needs to be corrected. */ }
    if (url?.protocol !== 'https:' || url.username || url.password) throw Error('原作来源须为有效的 HTTPS 链接。');
    return url.href;
}

function aliasSpans(line, alias) {
    const plainWord = /^[a-z0-9][a-z0-9 ._'’-]*$/i.test(alias);
    const wordChar = /[a-z0-9_]/;
    const spans = [];
    for (let start = line.indexOf(alias); start !== -1; start = line.indexOf(alias,start + 1)) {
        const end = start + alias.length;
        if (plainWord && (wordChar.test(line[start-1] ?? '') || wordChar.test(line[end] ?? ''))) continue;
        spans.push({start,end});
    }
    return spans;
}

export function matchingCharacters(people, sentence, speaker = '') {
    const names = people.flatMap(person => {
        const identity = person.identity;
        return [...new Set([person.name,...(person.aliases ?? []),identity?.name,identity?.romanName,...(identity?.aliases ?? [])].map(aliasKey).filter(Boolean))]
            .map(name => ({id:person.id,name}));
    });
    const line = aliasKey(sentence);
    const mentioned = names.flatMap(({id,name}) => aliasSpans(line,name).map(span => ({id,...span})));
    const ids = new Set(mentioned.filter(({start,end}) => !mentioned.some(other =>
        other.start <= start && other.end >= end && (other.start < start || other.end > end))).map(({id}) => id));
    if (!ids.size && speaker) {
        for (const {id,name} of names) if (aliasKey(speaker) === name) ids.add(id);
    }
    return [...ids];
}

export function prepareIdentityRoles(plan, looks, source, natural) {
    const visible = source.selectedText ?? source.visualText ?? source.text;
    const people = looks.filter(person => person.identity?.type === 'fan');
    const verified = new Set();
    for (const role of plan.characters) {
        const person = people.find(candidate => candidate.id === role.archiveId);
        const quote = role.evidence;
        if (!person || verified.has(person.id) || !quote || !visible.includes(quote)) continue;
        const matches = matchingCharacters(looks,quote,source.speaker);
        if (matches.length !== 1 || matches[0] !== person.id) continue;
        verified.add(person.id);
        role.identity = person.identity;
        role.label = person.name;
        const localChange = role.appearanceChange && visible.includes(role.appearanceChange);
        role.useReferenceImage = !localChange;
        role.positive = identityCaption(person.identity,role.positive,natural,localChange);
    }
    return plan;
}

export function identityCaption(identity, positive, natural, localChange = false) {
    const {name,romanName,work,features,tags} = identity;
    const who = (romanName || name) + ' (' + work + ')';
    if (!natural) return [who.toLowerCase(), localChange ? '' : tags || features, positive].filter(Boolean).join(', ');
    return ['Portray ' + who + '.', !localChange && features && 'Character identity cues: ' + features,
        'The selected scene determines any changes to appearance, apparel, pose and setting. ' + positive].filter(Boolean).join(' ');
}
