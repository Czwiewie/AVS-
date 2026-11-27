import {drawOptions, MODELS, knownNaiModel} from './api.js';
import {nativeImageOptions, NATIVE_IMAGE_PROVIDERS} from './image-providers.js';
import {NAI_REFERENCE_DEFAULTS} from './nai-reference.js';

export const RECIPE_ROUTES = {'nai-official':'NovelAI 官方', 'nai-compatible':'NovelAI 兼容',
    openai:'OpenAI 兼容', gemini:'Gemini Nano Banana', grok:'Grok Imagine'};

export function recipeRoute(connection) {
    return connection.imageProtocol === 'nai' ? 'nai-' + (connection.imageProvider === 'official' ? 'official' : 'compatible') : connection.imageProtocol;
}

const recipeText = (value,max) => typeof value === 'string' ? value.trim().slice(0,max) : '';
const recipeImageSizes = ['auto','1024x1024','1024x1536','1536x1024'];

function clampRecipeOption(value,fallback,max) {
    const n = Number(value ?? fallback);
    return Number.isFinite(n) && n >= 0 && n <= max ? n : fallback;
}

export function readRecipe(raw) {
    const name = recipeText(raw?.name,60), model = recipeText(raw?.model,140), route = raw?.route;
    if (!name || !model || !Object.hasOwn(RECIPE_ROUTES,route)) throw Error('配方缺少名称、模型或可识别的生图线路。');
    const value = raw.config ?? {};
    const color = recipeText(raw.style?.color,180), light = recipeText(raw.style?.light,180);
    const style = color || light ? {name:recipeText(raw.style?.name,60) || name,color,light} : null;
    let config;
    if (route.startsWith('nai-')) {
        const format = knownNaiModel(model) || knownNaiModel(value.format);
        if (!format || route === 'nai-official' && !MODELS.includes(model)) throw Error('配方的 NovelAI 模型格式无效。');
        const {count,...draw} = drawOptions({...value.draw,count:1});
        const precise = value.precise ?? {};
        config = {format,draw:{...draw,quality:value.draw?.quality === true},
            precise:{enabled:route === 'nai-official' && precise.enabled === true,
                strength45:clampRecipeOption(precise.strength45,NAI_REFERENCE_DEFAULTS.strength45,1) || NAI_REFERENCE_DEFAULTS.strength45,
                fidelity45:clampRecipeOption(precise.fidelity45,NAI_REFERENCE_DEFAULTS.fidelity45,1),
                strength5:clampRecipeOption(precise.strength5,NAI_REFERENCE_DEFAULTS.strength5,5) || NAI_REFERENCE_DEFAULTS.strength5}};
    } else if (Object.hasOwn(NATIVE_IMAGE_PROVIDERS,route)) {
        if (!Object.hasOwn(NATIVE_IMAGE_PROVIDERS[route].models,model)) throw Error('配方模型与原生线路不匹配。');
        const {aspects,resolutions,qualities} = nativeImageOptions(route,model);
        if (!aspects.includes(value.aspect) || !resolutions.includes(value.resolution)) throw Error('配方画幅或分辨率不适用于该模型。');
        config = {aspect:value.aspect,resolution:value.resolution};
        if (qualities.length) config.quality = qualities.includes(value.quality) ? value.quality : 'auto';
    } else {
        if (!recipeImageSizes.includes(value.size)) throw Error('配方画幅不受当前兼容线路支持。');
        config = {size:value.size,reply:value.reply === 'b64_json' ? 'b64_json' : 'default'};
    }
    return {name,route,model,config,style};
}

export function snapshotRecipe(name,connection,draw,style) {
    const route = recipeRoute(connection);
    const p = connection.imageProtocol;
    const config = p === 'nai' ? {format:connection.naiModel,draw,precise:connection.naiReference}
        : {aspect:connection[p+'Aspect'], resolution:connection[p+'Resolution'], quality:connection.grokQuality,
            size:connection.otherSize, reply:connection.otherReply};
    return readRecipe({name,route,model:connection.imageModel,config,style});
}

export function decodeRecipeFile(input) {
    if (input.length > 65536) throw Error('配方文件超过读取上限。');
    let data;
    try { data = JSON.parse(input); } catch { throw Error('配方文件不是有效 JSON。'); }
    if (data?.format !== 'avs-workshop-recipe' || data.version !== 1) throw Error('此文件不属于支持的 AVS 配方版本。');
    return readRecipe(data.recipe);
}

export function encodeRecipeFile(recipe) {
    return JSON.stringify({format:'avs-workshop-recipe',version:1,recipe:readRecipe(recipe)},null,2);
}

export function comparableRecipe(record,connection) {
    return !!record?.requestPlan && record.model === connection.imageModel &&
        recipeRoute({imageProtocol:record.imageProtocol || 'nai',imageProvider:record.imageProvider || 'official'}) === recipeRoute(connection);
}
