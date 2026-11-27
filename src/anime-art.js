const LEGACY_TAGS = '2d anime illustration, azur lane style, anime game key visual, fine tapered lineart, layered cel shading, painted fabric highlights, graphic hair highlights';
const ANIME_TAGS = [
    '2d anime illustration', 'azur lane style', 'polished anime game key visual', 'clear character silhouette',
    'fine tapered lineart', 'colored inner outlines', 'layered cel shading', 'soft painted color transitions',
    'detailed anime eyes', 'layered hair locks', 'graphic hair highlights', 'painted textile folds',
    'controlled material highlights', 'readable hands', 'character focal point'
];
const ANIME_EXCLUSIONS = [
    '3d render', 'cgi', 'photorealistic', 'live action', 'realistic skin texture', 'skin pores',
    'plastic skin', 'doll-like face', 'plastic figurine', 'flat vector art', 'thick uniform outlines',
    'muddy shading', 'uniform detail density'
];
const ART_DIRECTION = 'Create one original, hand-drawn 2D anime illustration with the visual finish of contemporary Azur Lane female character splash art.';
const ART_PRIORITY = 'Apply this art direction at highest priority across the entire picture. The scene and each subject describe who and what to draw. Optional reference accents may lightly tint the palette or local illumination within this finish.';
const ART_FINISH = 'Draw a clean, readable silhouette with tapered contours, colored inner lines and fine facial features. Shape light with crisp cel shadows, selective soft painted color transitions and reflected color. Group hair into layered locks with narrow graphic highlights and a few fine loose strands. Draw clear anime irises, subtle matte skin tones and legible hands. Give major cloth folds a clear rhythm, keep seams and decorations attached to visible garment panels, and distinguish fabric, metal and translucent materials by their illustrated edges and highlights. Concentrate the finest detail and sharpest contrast on the face, expression and important action. Keep background layers and peripheral effects subordinate, while preserving the setting and framing. Apply the same 2D finish to every character.';
const ART_EXCLUSIONS = 'Exclude photography, realistic 3D or CGI rendering, game-engine lighting, plastic figurine surfaces, visible skin pores, realistic skin shaders, and styles that replace the fine drawn lines or shaped shadows.';
const REFERENCE_LABEL = 'Optional reference accents: ';
const NAI_REFERENCE_WEIGHT = '0.75::';
const CONFLICTING_MEDIUM = /\b(?:photo[ -]?realism|photo[ -]?realistic|hyper[ -]?realism|hyper[ -]?realistic|live[ -]?action|3d[ -]?(?:render\w*|cg|model\w*|animation|style)|cgi|octane(?: render)?|unreal engine|subsurface scattering|skin pores|realistic skin(?: texture| shaders?)?|plastic figurine(?: surfaces)?|dslr|western comic style|pixel art|flat vector(?: art)?|watercolou?r (?:painting|style))\b|写实\s*3d|三维渲染|真人摄影|真人写实|照片级写实|皮肤毛孔|像素画风|欧美漫画风|扁平矢量风/gi;
const OPPOSING_EXCLUSION = /^(?:2d|anime|anime style|anime illustration|2d anime illustration|azur lane(?: style)?|(?:fine tapered )?line ?art|(?:layered )?cel shad(?:ing|ows)|anime eyes|二次元|赛璐璐(?:阴影)?|细线稿)$/i;

const PALETTES = [
    [/\b(?:teal|jade|turquoise|cyan)\b|青绿|青蓝|蓝绿/i, 'muted teal accents'],
    [/\b(?:blue|indigo|navy)\b|冷蓝|靛蓝|深蓝/i, 'cool blue accents'],
    [/\b(?:crimson|burgundy|warm red|red palette)\b|暖红|酒红|绯红/i, 'muted warm red accents'],
    [/\b(?:violet|lavender|purple)\b|紫调|薰衣草紫/i, 'muted violet accents'],
    [/\b(?:gold|golden|amber)\b|金色|琥珀/i, 'restrained golden accents']
];
const LIGHT_ACCENTS = [
    [/\b(?:cool|blue)\b.*\b(?:rim|edge)\b|冷色轮廓光/i, 'subtle cool rim light'],
    [/\b(?:warm|golden|amber)\b.*\b(?:rim|edge|glow|light)\b|暖光|暖色轮廓光/i, 'subtle warm accent light'],
    [/\b(?:soft backlight|soft ambient light|diffuse light)\b|柔和逆光|柔和环境光/i, 'soft secondary light']
];

function referenceAccents(style) {
    return [[PALETTES, style?.color], [LIGHT_ACCENTS, style?.light]].flatMap(([choices, value]) => {
        const match = typeof value === 'string' && choices.find(([pattern]) => pattern.test(value));
        return match ? [match[1]] : [];
    });
}

function savedAccents(value = '') {
    const choices = value.split(', ');
    return [PALETTES,LIGHT_ACCENTS].map(group => group.find(([,phrase]) => choices.includes(phrase))?.[1]).filter(Boolean);
}

function mediumTag(tag) {
    return tag.trim().replace(/^(?:[+-]?\d+(?:\.\d+)?::|[\[{])+|(?:::|[\]}])+$/g,'').trim();
}

function mediumFragments(value) {
    const fragments = [];
    let start = 0, depth = 0, emphasized = false;
    for (let i = 0; i < value.length; i++) {
        const char = value[i];
        if (char === '\\') { i++; continue; }
        if (char === ':' && value[i+1] === ':' &&
            (emphasized || /(?:^|[\s(\[{])[-+]?\d+(?:\.\d+)?$/.test(value.slice(start,i)))) {
            emphasized = !emphasized;
            i++;
            continue;
        }
        if (emphasized) continue;
        if ('([{'.includes(char)) depth++;
        if (')]}'.includes(char)) depth = Math.max(0,depth-1);
        if (!depth && ',，;；\n'.includes(char)) {
            fragments.push(value.slice(start,i),char);
            start = i+1;
        }
    }
    fragments.push(value.slice(start));
    return fragments;
}

function cleanScene(text = '') {
    return mediumFragments(text).map((fragment,index) => {
        if (index % 2) return fragment;
        let value = fragment.replace(CONFLICTING_MEDIUM,'');
        if (value !== fragment) value = value.replace(/[ \t]{2,}/g,' ').trim();
        const tag = mediumTag(value);
        if (!tag || /^(?:3d|photograph|photography|写实|3d风格|by\s+[^,]+|artist\s*[:：].*|作画风格\s*[:：].*)$/i.test(tag)) return '';
        return value;
    }).join('').replace(/(?:\s*[,，;；]\s*){2,}/g,', ').replace(/^[\s,，;；]+|[\s,，;；]+$/g,'');
}

function artTags(values) {
    return [...new Set(values.flatMap(value => mediumFragments(value || '').filter((_,index) => index % 2 === 0))
        .map(tag => tag.trim()).filter(Boolean))].join(', ');
}

function approvedNegative(value = '') {
    const tags = mediumFragments(value).filter((_,index) => index % 2 === 0);
    return tags.map(tag => tag.trim()).filter(tag => tag && !OPPOSING_EXCLUSION.test(mediumTag(tag))).join(', ');
}

function visibleSubject(role,index) {
    const positive = cleanScene(role.positive);
    if (!positive) throw Error('第 ' + (index+1) + ' 个人物分栏缺少可画的人物描述。');
    return positive;
}

function unpackArtPlan(plan) {
    const tagPrefix = [ANIME_TAGS.join(', '), LEGACY_TAGS].find(prefix => plan.base?.startsWith(prefix + ', '));
    if (tagPrefix) {
        const base = plan.base.slice(tagPrefix.length + 2);
        const suffix = ', ' + NAI_REFERENCE_WEIGHT;
        const tail = base.lastIndexOf(suffix);
        if (tail === -1 || !base.endsWith('::')) return {...plan,base};
        const prior = base.slice(tail + suffix.length,-2);
        const accents = savedAccents(prior);
        return accents.length && accents.join(', ') === prior ? {...plan,base:base.slice(0,tail),accents} : {...plan,base};
    }
    if (!plan.base?.startsWith(ART_DIRECTION + '\n\n')) return plan;
    const blocks = plan.base.split(/\n\n+/).slice(1);
    const sceneIndex = blocks.findIndex(block => block.startsWith('Scene to illustrate: '));
    if (sceneIndex === -1) return plan;
    const sceneEnd = blocks.findIndex((block,index) => index > sceneIndex &&
        /^(?:Subject \d+ in the scene\.|Additional compatible art cues:|Optional reference accents:|Scene exclusions:|Draw |Exclude )/.test(block));
    const scene = blocks.slice(sceneIndex,sceneEnd === -1 ? blocks.length : sceneEnd).join('\n\n');
    const characters = blocks.flatMap(block => {
        const subject = /^Subject \d+ in the scene\. ([\s\S]+)$/.exec(block);
        if (!subject) return [];
        const [positive, negative = ''] = subject[1].split(' Avoid for this subject: ');
        return [{positive,negative}];
    });
    const negative = blocks.find(block => block.startsWith('Scene exclusions: '))?.slice('Scene exclusions: '.length);
    const prior = blocks.find(block => block.startsWith(REFERENCE_LABEL))?.slice(REFERENCE_LABEL.length);
    return {...plan, base:scene.slice('Scene to illustrate: '.length), characters:[...characters,...plan.characters],
        negative:artTags([negative,plan.negative]), accents:savedAccents(prior)};
}

export function animeTagPlan(input, style) {
    const plan = unpackArtPlan(input);
    const base = cleanScene(plan.base);
    if (!base) throw Error('请填写明确的场景或画面主体。');
    const accents = style ? referenceAccents(style) : plan.accents ?? [];
    return {
        base:artTags([...ANIME_TAGS,base,accents.length ? NAI_REFERENCE_WEIGHT + accents.join(', ') + '::' : '']),
        negative:artTags([...ANIME_EXCLUSIONS,approvedNegative(plan.negative)]),
        characters:plan.characters.map((role,index) => ({
            positive:visibleSubject(role,index), negative:approvedNegative(role.negative)
        }))
    };
}

export function animeProsePrompt(input, style) {
    const plan = unpackArtPlan(input);
    const base = cleanScene(plan.base);
    if (!base) throw Error('请填写明确的场景或画面主体。');
    const accents = style ? referenceAccents(style) : plan.accents ?? [];
    const negatives = approvedNegative(plan.negative);
    const characters = plan.characters.map((role,index) => {
        const positive = visibleSubject(role,index);
        const negative = approvedNegative(role.negative);
        return 'Subject ' + (index+1) + ' in the scene. ' + positive + (negative ? ' Avoid for this subject: ' + negative : '');
    });
    return [ART_DIRECTION, ART_PRIORITY, 'Scene to illustrate: ' + base, ...characters, ART_FINISH,
        accents.length && REFERENCE_LABEL + accents.join(', '),
        negatives && 'Scene exclusions: ' + negatives, ART_EXCLUSIONS].filter(Boolean).join('\n\n');
}
