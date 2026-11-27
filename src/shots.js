import {identityCaption} from './identity.js';

export const SHOT_FIELDS = {framing:'景别', camera:'视角与机位', layout:'构图', focus:'视觉焦点', lighting:'光线'};
export const SHOT_ROLE_FIELDS = {outfit:'这一幕的穿搭', pose:'动作与姿势', expression:'表情', gaze:'视线'};
export const SHOT_ACTION_FIELDS = {action:'发起者动作', response:'接收者动作', object:'互动道具', contact:'接触点与道具位置'};
export const SHOT_SIDES = {auto:'自动', left:'左', center:'中', right:'右'};
export const SHOT_DEPTHS = {auto:'自动', foreground:'前景', midground:'中景', background:'后景'};

const shotText = (value, max = 280) => typeof value === 'string' ? value.trim().replace(/\s+/g,' ').slice(0,max) : '';
const shotFields = (value, fields) => Object.fromEntries(Object.keys(fields).map(key => [key,shotText(value?.[key])]));
const shotOption = (value, choices) => Object.hasOwn(choices,value) ? value : 'auto';

export function normalizeShot(plan, characters) {
    if (!plan.shot) return {};
    const shot = shotFields(plan.shot,SHOT_FIELDS);
    if (!shot.framing || !shot.focus) throw Error('结构化镜头须包含景别和视觉焦点。');
    const ids = new Set();
    for (const [index, role] of characters.entries()) {
        const input = plan.characters[index];
        const id = shotText(input.id,16);
        if (!/^p[1-9][0-9]?$/.test(id) || ids.has(id)) throw Error('人物 ' + (index+1) + ' 的镜头编号缺失或重复。');
        ids.add(id);
        Object.assign(role,{id},shotFields(input,SHOT_ROLE_FIELDS),{
            side:shotOption(input.side,SHOT_SIDES),depth:shotOption(input.depth,SHOT_DEPTHS)
        });
    }
    if (!Array.isArray(plan.interactions) || plan.interactions.length > 12) throw Error('镜头互动关系须为数组，最多 12 条。');
    const interactions = plan.interactions.map((relation,index) => {
        const actor = shotText(relation?.actor,16), target = shotText(relation?.target,16);
        const details = shotFields(relation,SHOT_ACTION_FIELDS);
        if (!ids.has(actor) || target && (!ids.has(target) || target === actor) || !details.action) {
            throw Error('第 ' + (index+1) + ' 条互动关系缺少有效的人物或动作。');
        }
        const holder = shotText(relation?.holder,16);
        if (holder && holder !== 'scene' && !ids.has(holder)) throw Error('第 ' + (index+1) + ' 条互动的道具归属无效。');
        return {actor,target,holder,...details};
    });
    return {shot,interactions};
}

const shotList = (...parts) => parts.filter(Boolean).join(', ');
const shotSentences = parts => parts.filter(Boolean).map(part => part.trim().replace(/[.!?]+$/,'') + '.').join(' ');
const screenSide = role => role.side && role.side !== 'auto' ? role.side : '';
const screenDepth = role => role.depth && role.depth !== 'auto' ? role.depth : '';

export function renderShot(plan, protocol) {
    if (!plan.shot) return plan;
    const tagMode = protocol === 'nai';
    const {framing,camera,layout,focus,lighting} = plan.shot;
    const roles = new Map(plan.characters.map((role,index) => [role.id,{...role,number:index+1}]));
    const interactions = (plan.interactions ?? []).filter(rel => roles.has(rel.actor) && (!rel.target || roles.has(rel.target)));
    const subject = id => 'Subject ' + roles.get(id).number;
    const interactionsText = interactions.map(rel => shotSentences([
        subject(rel.actor) + ' ' + rel.action + (rel.target ? ' (directed toward ' + subject(rel.target) + ')' : ''),
        rel.target && rel.response && subject(rel.target) + ' ' + rel.response,
        rel.object && 'Object in this action: ' + rel.object + (roles.has(rel.holder) ? ' (held by ' + subject(rel.holder) + ')' : ''),
        rel.contact && 'Physical contact and object placement: ' + rel.contact
    ])).join(' ');
    const providerDirections = {
        openai: 'Keep each named subject and the specified interaction distinct. Respect the planned framing and keep requested contact and key props visible.',
        gemini: 'Maintain identity across changes in wardrobe and viewpoint. Use the depth and subject assignments when interpreting the scene and any attached references.',
        grok: 'Use the stated left-to-right and foreground-to-background arrangement. Make it clear who initiates each action and who receives it.'
    };
    const base = tagMode
        ? shotList(framing,camera,layout,plan.base,lighting,focus)
        : shotSentences([plan.base,...Object.entries({Framing:framing, Camera:camera, Layout:layout, Focus:focus, Lighting:lighting})
            .map(([label,value]) => value && label + ': ' + value), interactionsText,providerDirections[protocol]]);
    const characters = plan.characters.map(role => {
        const leftRight = screenSide(role), depth = screenDepth(role);
        const fixed = role.drawIdentity ? identityCaption(role.drawIdentity,role.positive,!tagMode,role.appearanceChanged) : role.positive;
        if (!tagMode) return {...role,positive:shotSentences([
            fixed, leftRight && 'Position in the frame: ' + leftRight, depth && 'Depth: ' + depth,
            role.outfit && 'Outfit at this instant: ' + role.outfit, role.pose && 'Pose and action: ' + role.pose,
            role.expression && 'Expression: ' + role.expression, role.gaze && 'Gaze: ' + role.gaze
        ])};
        const actions = interactions.filter(rel => rel.actor === role.id || rel.target === role.id).map(rel => {
            const outgoing = rel.actor === role.id;
            const other = roles.get(outgoing ? rel.target : rel.actor);
            const position = other && shotList(screenSide(other),screenDepth(other));
            const action = outgoing ? rel.action : rel.response;
            return shotList(action,action && position && 'interacting with the person at ' + position,
                rel.holder === role.id && rel.object, outgoing && rel.contact);
        });
        return {...role,positive:shotList(fixed,role.outfit,role.pose,role.expression,role.gaze,
            leftRight && (leftRight === 'center' ? 'centered in the frame' : 'on the ' + leftRight),depth && 'in the ' + depth,...actions)};
    });
    return {...plan,base,characters};
}
