const ANIME_TAGS = [
    '2d anime illustration', 'azur lane style', 'anime game key visual', 'fine tapered lineart',
    'layered cel shading', 'painted fabric highlights', 'graphic hair highlights'
];
const ANIME_EXCLUSIONS = [
    '3d render', 'cgi', 'photorealistic', 'live action', 'realistic skin texture',
    'skin pores', 'plastic skin', 'doll-like face', 'plastic figurine'
];
const ART_DIRECTION = 'Create one original, hand-drawn 2D anime illustration with the visual finish of contemporary Azur Lane female character splash art.';
const ART_FINISH = 'Draw fine, tapered contours and clearly shaped cel shadows with selective hand-painted color transitions. Render hair in deliberate ribbon-like locks with graphic highlights. Use matte, gently colored skin, illustrated eyes with a defined iris design, and small expressive facial planes. Describe cloth by the rhythm of its folds, embroidery by clear placement, and metal by narrow graphic highlights. Keep the face, hands, and important action readable, with one dominant focal point. Render environment and all characters in the same 2D drawing style.';
const ART_EXCLUSIONS = 'Exclude photorealism, live-action photography, 3D or CGI rendering, game-engine lighting, plastic figurine surfaces, visible skin pores, and realistic skin shaders.';
const CONFLICTING_MEDIUM = /\b(?:photo[ -]?realism|photo[ -]?realistic|hyper[ -]?realism|hyper[ -]?realistic|live[ -]?action|3d (?:render\w*|cg|model\w*|animation)|cgi|octane(?: render)?|unreal engine|subsurface scattering|skin pores|realistic skin(?: texture| shaders?)?|dslr)\b|写实\s*3d|三维渲染|真人摄影|真人写实|照片级写实|皮肤毛孔/i;
const OPPOSING_EXCLUSION = /^(?:2d|anime|anime style|anime illustration|2d anime illustration|azur lane style|lineart|cel shading|二次元|赛璐璐)$/i;

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

export function filterPositiveMedium(text = '', style = false) {
    const value = text.trim();
    if (!value || value.startsWith(ART_DIRECTION)) return value;
    return mediumFragments(value).filter((part,index) => {
        if (index % 2) return true;
        const tag = mediumTag(part);
        if (style) return !CONFLICTING_MEDIUM.test(tag) && !/^(?:3d|photograph|photography|写实|3d风格)$/i.test(tag);
        const words = tag.split(/\s+/);
        return !((CONFLICTING_MEDIUM.test(tag) && words.length <= 5) || /^(?:3d|photograph|photography|写实|3d风格)$/i.test(tag));
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
    const positive = filterPositiveMedium(role.positive);
    if (!positive) throw Error('第 ' + (index+1) + ' 个人物分栏缺少可画的人物描述。');
    return positive;
}

export function animeTagPlan(plan, styles, styleNegative) {
    const base = filterPositiveMedium(plan.base);
    if (!base) throw Error('请填写明确的场景或画面主体。');
    const prefix = ANIME_TAGS.join(', ');
    const extras = styles.map(value => filterPositiveMedium(value,true)).filter(Boolean);
    return {
        base:[base.startsWith(prefix) ? base : prefix + ', ' + base, ...extras].join(', '),
        negative:artTags([...ANIME_EXCLUSIONS,approvedNegative(plan.negative),approvedNegative(styleNegative)]),
        characters:plan.characters.map((role,index) => ({
            positive:visibleSubject(role,index),
            negative:approvedNegative(role.negative)
        }))
    };
}

export function animeProsePrompt(plan, styles, styleNegative) {
    const base = filterPositiveMedium(plan.base);
    if (!base) throw Error('请填写明确的场景或画面主体。');
    const extras = styles.map(value => filterPositiveMedium(value,true)).filter(Boolean);
    const negatives = [approvedNegative(plan.negative),approvedNegative(styleNegative)].filter(Boolean);
    const characters = plan.characters.map((role,index) => {
        const positive = visibleSubject(role,index);
        const negative = approvedNegative(role.negative);
        return ['Subject ' + (index+1) + ' in the scene. ' + positive, negative && 'Avoid for this subject: ' + negative]
            .filter(Boolean).join(' ');
    }).filter(Boolean);
    const authored = [extras.length && 'Additional compatible art cues: ' + extras.join(', '),
        ...characters, negatives.length && 'Scene exclusions: ' + negatives.join(', ')].filter(Boolean);
    if (base.startsWith(ART_DIRECTION)) return [base,...authored].join('\n\n');
    return [ART_DIRECTION, 'Scene to illustrate: ' + base, ...authored, ART_FINISH, ART_EXCLUSIONS].join('\n\n');
}
