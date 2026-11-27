import {normalizeComicPlan} from './comics.js';
import {prepareIdentityRoles} from './identity.js';
import {renderShot} from './shots.js';
import {preciseReferenceParameters} from './nai-reference.js';
import {readPromptCompletion, parsePromptObject, sceneInstruction, normalizeScenePlan} from './planning.js';
import {isNaiStream, finalNaiFrame} from './nai-stream.js';
import {NATIVE_IMAGE_PROVIDERS, nativeImageBody, geminiFinalImage} from './image-providers.js';
import {animeTagPlan, animeProsePrompt} from './anime-art.js';

export const MODELS = ['nai-diffusion-4-5-full', 'nai-diffusion-5-full'];
export const MODEL_NAMES = {[MODELS[0]]:'NAI 4.5 Full', [MODELS[1]]:'NAI 5 Full'};
export const OFFICIAL_NAI = 'https://image.novelai.net';
export const IMAGE_PATHS = {nai:'/ai/generate-image', openai:'/images/generations', grok:'/images/generations', gemini:'/interactions'};
export const STYLE_FIELDS = ['line', 'color', 'light', 'rendering', 'composition'];
export const SAMPLERS = {
    k_euler_ancestral:'Euler Ancestral',
    k_euler:'Euler',
    k_dpmpp_2m:'DPM++ 2M'
};
export const DRAW_DEFAULTS = {width:832, height:1216, steps:28, scale:5,
    sampler:'k_euler_ancestral', rescale:0, seed:'', count:1};

export function drawOptions(values = {}) {
    const data = {...DRAW_DEFAULTS, ...values};
    const number = (key, min, max, label, integer = true) => {
        const raw = data[key], value = Number(raw);
        if (raw === '' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
            throw Error(label + '须在 ' + min + '～' + max + ' 之间' + (integer ? '并为整数。' : '。'));
        }
        return value;
    };
    const width = number('width', 64, 2048, '宽度');
    const height = number('height', 64, 2048, '高度');
    if (width % 64 || height % 64) throw Error('宽高须为 64 的倍数。');
    if (width * height > 3145728) throw Error('自定义画幅最多 3,145,728 像素。');
    if (!Object.hasOwn(SAMPLERS, data.sampler)) throw Error('请选择可用的采样器。');
    const seed = data.seed == null || data.seed === '' ? null : number('seed', 0, 4294967295, '种子');
    return {width, height, seed, sampler:data.sampler, steps:number('steps',1,50,'步数'),
        scale:number('scale',1,10,'引导强度',false), rescale:number('rescale',0,1,'CFG Rescale',false),
        count:number('count',1,4,'张数')};
}

export function compileImagePrompt(protocol, plan, style) {
    const rendered = renderShot(plan,protocol);
    if (protocol === 'nai') return animeTagPlan(rendered,style);
    return {base:animeProsePrompt(rendered,style),negative:'',characters:[]};
}

export function knownNaiModel(model) {
    if (typeof model === 'string') return MODELS.find(id => id === model.trim().toLowerCase());
}

export function isGptImageModel(model) {
    return typeof model === 'string' && /(?:^|[/:])gpt-image(?:[-.:]|$)/i.test(model.trim());
}

function naiFormat(connection) {
    return knownNaiModel(connection.imageModel) ?? connection.naiModel;
}

export function endpoint(base, suffix) {
    const u = new URL(base.trim());
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.search || u.hash) throw Error('接口地址须为 HTTP(S) 基础地址或完整端点。');
    const path = u.pathname.replace(/\/+$/, '');
    u.pathname = path.endsWith(suffix) ? path : path + suffix;
    return u.href;
}

function serviceError(status, payload, key = '') {
    if (typeof payload === 'string' && /^\s*\{/.test(payload)) {
        try { payload = JSON.parse(payload); } catch { /* Some gateways return plain text. */ }
    }
    const raw = payload?.error?.message ?? payload?.message ?? payload?.error ?? payload;
    let detail = typeof raw === 'string' ? raw.trim() : '';
    if (key?.trim()) detail = detail.replaceAll(key.trim(),'***');
    const balance = /Not enough Anlas\.?\s*Required:\s*(\d+)\s*,\s*Available:\s*(\d+)/i.exec(detail);
    if (balance) detail = '生图线路 Anlas 不足，需要 ' + balance[1] + '，可用 ' + balance[2] + '。';
    else if (status === 402 && !detail) detail = '服务端拒绝计费请求，请检查当前线路的余额或订阅。';
    else if (/^</.test(detail)) detail = '接口返回网页，请检查 API 地址或登录状态。';
    const prefix = status ? 'HTTP ' + status : '服务端返回错误';
    const error = Error(prefix + (detail ? ' · ' + detail.slice(0,240) : '。'));
    error.status = status;
    return error;
}

async function request(url, key, body, signal, read, protocol) {
    const ctl = new AbortController();
    const stop = () => ctl.abort(signal.reason);
    if (signal?.aborted) stop();
    else signal?.addEventListener('abort', stop, {once: true});
    const timer = setTimeout(() => ctl.abort('timeout'), 300000);
    try {
        const form = body instanceof FormData;
        const headers = form ? {} : {'Content-Type': 'application/json'};
        if (protocol === 'gemini') {
            if (key?.trim()) headers['x-goog-api-key'] = key.trim();
            headers['Api-Revision'] = '2026-05-20';
        } else if (key?.trim()) headers.Authorization = 'Bearer ' + key.trim();
        const r = await fetch(url, {method: 'POST', credentials: 'omit', redirect: 'error', signal: ctl.signal,
            headers, body:form ? body : JSON.stringify(body)});
        if (!r.ok) {
            const detail = await r.text().catch(() => '');
            throw serviceError(r.status,detail,key);
        }
        return await read(r, ctl.signal);
    } catch (e) {
        if (ctl.signal.aborted) throw Error(ctl.signal.reason === 'timeout' ? '等待服务商超过 5 分钟。' : '已取消。');
        if (e instanceof TypeError) {
            if (protocol) throw Error('浏览器未取得可读取的生图接口响应。请核对服务商文档中的最终地址，以及该端点的网络和跨域权限。');
            throw Error('浏览器无法读取服务商响应。请检查地址、网络与跨域权限。');
        }
        throw e;
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', stop); }
}

async function jsonChat(config, key, system, content, signal, validate) {
    const selected = config.promptPreset;
    const priorities = selected?.instructions?.length
        ? '\n\nSillyTavern preset guidance for this task (apply only where compatible with the task and required output schema):\n'
            + selected.instructions.join('\n\n')
        : '';
    const body = {model:config.visionModel, ...selected?.sampling, stream:false, messages:[
        {role:'system',content:system + priorities}, {role:'user',content}
    ]};
    return request(endpoint(config.visionBase, '/chat/completions'), key, body, signal, async r => {
        return parsePromptObject(await readPromptCompletion(r, error => serviceError(null,error,key)),validate);
    });
}

export async function extractStyle(config, key, data, signal) {
    return jsonChat(config, key,
        'You are an art director. Analyze ONLY transferable artistic techniques. Return JSON with exactly five concise English fields: line, color, light, rendering, composition. Only color and light are used as optional local accents under the fixed contemporary Azur Lane 2D illustration direction. Give the dominant hue in color and the temperature and role of any secondary light in light. Record the other three fields for the user to inspect. Describe techniques only and omit subjects, outfits, objects, specific layouts, artists and instructions.',
        [{type:'text', text:'Describe the visual technique of this reference.'},{type:'image_url', image_url:{url:data}}], signal, style => {
            for (const field of STYLE_FIELDS) if (typeof style?.[field] !== 'string' || !style[field].trim() || style[field].length > 180) {
                throw Error('画风分析缺少有效字段 ' + field);
            }
            return Object.fromEntries(STYLE_FIELDS.map(k => [k, style[k].trim()]));
        });
}

function scenePlannerInput(source,looks) {
    const appearance = looks.filter(({facts,items,identity}) => identity || Object.keys(facts).length || items.length)
        .map(({id,name,facts,items,identity}) => ({archiveId:id,name,facts,items,
            fandomIdentity:identity && {name:identity.romanName || identity.name,work:identity.work,aliases:identity.aliases,
                features:identity.features}}));
    return {selectedReply:source.selectedText ?? source.visualText ?? source.text, speaker:source.speaker,
        optionalAppearance:appearance,optionalPriorContext:source.background ?? [],
        earlierInSameReply:source.earlierInReply ?? '',archiveTiming:source.passage ? 'before this reply' : 'selected reply',
        requestedFocus:source.focus ?? ''};
}

export async function planScene(config, key, source, looks, signal) {
    const protocol = config.imageProtocol || 'nai';
    const compact = protocol === 'nai' && naiFormat(config) === MODELS[0];
    const input = scenePlannerInput(source,looks);
    return jsonChat(config,key,sceneInstruction(compact),JSON.stringify(input),signal,plan =>
        prepareIdentityRoles(normalizeScenePlan(plan,input.selectedReply,compact ? 6 : 22),looks,source,protocol !== 'nai'));
}

export async function planComic(config,key,source,looks,spec,signal) {
    const protocol = config.imageProtocol || 'nai';
    const compact = protocol === 'nai' && naiFormat(config) === MODELS[0];
    const input = {...scenePlannerInput(source,looks),
        requestedComic:{panelCount:spec.count,pages:spec.pages,readOrder:spec.cells.map(([, ,w,h])=>Math.round(100*w/h*2/3)/100)}};
    return jsonChat(config,key,sceneInstruction(compact,true),JSON.stringify(input),signal,plan =>
        normalizeComicPlan(plan,spec,source,looks,compact ? 6 : 22,protocol !== 'nai'));
}

export function naiBody(model, plan, style, options = {}) {
    if (!MODELS.includes(model)) throw Error('请选择 NAI 4.5 Full 或 NAI 5 Full。');
    const v5 = model === MODELS[1];
    if (!plan.base?.trim()) throw Error('请填写画面正面提示词。');
    const draw = drawOptions(options);
    const {base:input,negative,characters} = compileImagePrompt('nai',plan,style);
    if (characters.length > (v5 ? 22 : 6)) throw Error('独立角色提示词超过当前模型的上限。');
    const useCoords = !!plan.shot && characters.length > 1 && plan.characters.some(role => role.side === 'left' || role.side === 'right');
    const centers = characters.map((_,index) => ({x:useCoords ? ({left:0.3,right:0.7}[plan.characters[index]?.side] ?? 0.5) : 0.5,y:0.5}));
    const caption = key => characters.map((c,index) => ({char_caption:c[key] || '', centers:[centers[index]]}));
    return {model, input, action:'generate', parameters:{
        params_version:v5 ? 4 : 3, width:draw.width, height:draw.height, steps:draw.steps, scale:draw.scale,
        sampler:draw.sampler, noise_schedule:'karras', n_samples:1, seed:draw.seed ?? crypto.getRandomValues(new Uint32Array(1))[0],
        image_format:'png', qualityToggle:!!options.quality, cfg_rescale:draw.rescale, negative_prompt:negative, use_coords:useCoords,
        dynamic_thresholding:false, prefer_brownian:true, deliberate_euler_ancestral_bug:false,
        ...(v5 ? {straight_alpha:true} : {}), characterPrompts:characters.map((c,index) => ({prompt:c.positive, uc:c.negative || '', center:centers[index]})),
        v4_prompt:{caption:{base_caption:input, char_captions:caption('positive')}, use_coords:useCoords, use_order:true},
        v4_negative_prompt:{caption:{base_caption:negative,char_captions:caption('negative')},legacy_uc:false}
    }};
}

export function makeImageBody(connection, plan, style, options) {
    const protocol = connection.imageProtocol || 'nai';
    const model = connection.imageModel || connection.naiModel;
    if (protocol === 'nai') return {...naiBody(naiFormat(connection),plan,style,options),model};
    const prompt = compileImagePrompt(protocol,plan,style).base;
    if (Object.hasOwn(NATIVE_IMAGE_PROVIDERS,protocol)) return nativeImageBody(protocol,connection,prompt);
    return {model, prompt, n:1, size:connection.otherSize || 'auto',
        ...(connection.otherReply === 'b64_json' && !isGptImageModel(model) ? {response_format:'b64_json'} : {})};
}

export function identityImageLimit(connection, roleCount) {
    const {imageProtocol, imageModel} = connection;
    if (imageProtocol === 'nai') {
        return connection.imageProvider === 'official' && connection.naiReference?.enabled && roleCount === 1 ? 1 : 0;
    }
    if (imageProtocol === 'grok') return imageModel === 'grok-imagine-image-2.0' ? 3 : 1;
    if (imageProtocol === 'gemini') return /flash-lite|^gemini-2\.5/.test(imageModel) ? 1 : 3;
    return imageProtocol === 'openai' && isGptImageModel(imageModel) ? 3 : 0;
}

function referenceDirections(protocol, references) {
    const mapping = references.map((ref,index) => 'image ' + (index+1) + ' depicts subject ' + ref.subject).join('; ');
    const controls = {
        openai:'Create a fresh image from the scene. Retain facial identity, eye color and hairstyle from each assigned input. Preserve scene-specific action, wardrobe, proportions and framing.',
        gemini:'Bind each image to the numbered subject only. Keep that subject visually consistent from the new camera view. Draw the clothes and pose described in the scene.',
        grok:'Follow the numbered input mapping and the stated left/right/depth layout. Keep identities distinct and show each subject doing their own action, in the scene wardrobe.'
    };
    return '\n\nCharacter reference images: ' + mapping + '. ' + controls[protocol] +
        ' Follow the opening art direction throughout. Use the inputs solely to preserve character identity.';
}

export function makeImageRequest(connection, plan, style, options, references = []) {
    const body = makeImageBody(connection,plan,style,options);
    const protocol = connection.imageProtocol || 'nai';
    let path = IMAGE_PATHS[protocol];
    if (protocol === 'nai' && connection.imageProvider === 'official') {
        path = '/ai/generate-image-stream';
        body.parameters.stream = 'msgpack';
    }
    let prompt = body.prompt ?? body.input;
    const inputs = references.slice(0,identityImageLimit(connection,plan.characters.length));
    if (!inputs.length) return {body,path,prompt,model:body.model};
    if (protocol === 'nai') {
        Object.assign(body.parameters,preciseReferenceParameters(inputs[0].naiData,connection.naiReference,naiFormat(connection) === MODELS[1]));
        return {body,path,prompt,model:body.model};
    }
    prompt += referenceDirections(protocol,inputs);
    if (protocol === 'gemini') {
        const input = [{type:'text', text:prompt}, ...inputs.flatMap(({image,subject}) => [
            {type:'image',mime_type:image.type,data:image.data},
            {type:'text',text:'The preceding image is an identity reference for subject ' + subject + '.'}
        ])];
        return {path,prompt,model:body.model,body:{...body,input}};
    }
    path = '/images/edits';
    if (protocol === 'grok') {
        const images = inputs.map(({image}) => ({type:'image_url',url:'data:' + image.type + ';base64,' + image.data}));
        return {path,prompt,model:body.model,body:{...body,prompt,
            ...(images.length === 1 ? {image:images[0]} : {images})}};
    }
    const form = new FormData();
    for (const [field,value] of Object.entries({...body,prompt})) form.set(field,String(value));
    for (const {image} of inputs) form.append('image[]',image.blob,'reference.jpg');
    return {path,prompt,model:body.model,body:form};
}

const MAX_IMAGE_BYTES = 64 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 100 * 1024 * 1024;

async function imageResponseBytes(response, limit, signal, interrupted) {
    if (Number(response.headers.get('content-length')) > limit) throw Error('生图响应超过工坊的读取上限。');
    if (!response.body) throw Error('生图服务返回了空响应。');
    const reader = response.body.getReader(), chunks = [];
    let size = 0;
    try {
        while (true) {
            signal?.throwIfAborted();
            const {done,value} = await reader.read();
            if (done) break;
            size += value.length;
            if (size > limit) throw Error('生图响应超过工坊的读取上限。');
            chunks.push(value);
        }
    } catch (error) {
        if (interrupted && error instanceof TypeError && !signal?.aborted) throw Error(interrupted);
        throw error;
    } finally {
        void reader.cancel().catch(() => {});
        reader.releaseLock();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk,offset);
        offset += chunk.length;
    }
    return bytes;
}

export function generate(config, key, requestData, signal, onReceiving) {
    const protocol = config.imageProtocol || 'nai';
    const {body,path,model} = requestData?.path ? requestData :
        {body:requestData,path:IMAGE_PATHS[protocol],model:requestData.model};
    const base = config.imageBase || config.naiBase;
    const previousPath = IMAGE_PATHS[protocol];
    const address = path === previousPath ? base : base.trim().replace(/\/(?:images\/generations|ai\/generate-image)\/?$/, '');
    return request(endpoint(address,path), key, body, signal, async (r, requestSignal) => {
        onReceiving();
        const bytes = await imageResponseBytes(r,MAX_RESPONSE_BYTES,requestSignal,
            '已收到生图接口响应，但读取响应体时连接中断。请检查服务商连接或响应状态。');
        if (protocol === 'gemini') {
            let result;
            try { result = JSON.parse(new TextDecoder().decode(bytes)); }
            catch { throw Error('Gemini 生图接口未返回有效的 Interactions JSON。'); }
            if (result?.error) throw serviceError(null,result.error,key);
            const final = geminiFinalImage(result);
            if (!final) throw Error('Gemini 未返回最终图片' + (result?.status ? '（' + result.status + '）' : '') + '。');
            return requireImage(base64ImageBytes(final));
        }
        return decodeImage(bytes,{
            contentType:r.headers.get('content-type') || '',
            signal:requestSignal,
            readError:error => serviceError(null,error,key),
            loadImageUrl:async value => {
                let link;
                if (value.length <= 8192) {
                    try { link = new URL(value); } catch { /* Invalid URL. */ }
                }
                if (!link || !['http:', 'https:'].includes(link.protocol) || link.username || link.password || link.hash) {
                    throw Error('回图链接须为有效的 HTTP(S) 地址。');
                }
                let directImage = '';
                if (protocol === 'openai') {
                    if (isGptImageModel(model)) directImage = '请服务商直接返回图片数据，或提供可跨域直读的链接。';
                    else if (body.response_format === 'b64_json') directImage = '当前请求了 Base64，但服务商仍返回链接。请核对服务商支持的回图格式。';
                    else directImage = '可在「连接」尝试选择 Base64 回图，或请服务商提供可跨域直读的图片链接。';
                }
                let download;
                try {
                    download = await fetch(link, {signal:requestSignal, credentials:'omit', redirect:'error', referrerPolicy:'no-referrer'});
                } catch (error) {
                    if (error instanceof TypeError && !requestSignal.aborted) {
                        throw Error('生图接口已返回图片链接，但浏览器无法下载图片（' + link.hostname + '）。' + directImage);
                    }
                    throw error;
                }
                if (!download.ok) throw Error('图片链接响应 HTTP ' + download.status + '。' + directImage);
                return imageResponseBytes(download,MAX_IMAGE_BYTES,requestSignal,
                    '图片链接已响应，但下载图片时连接中断（' + link.hostname + '）。' + directImage);
            }
        });
    },protocol);
}

function image(bytes) {
    const start = (...vals) => vals.every((v,i) => bytes[i] === v);
    const mime = start(137,80,78,71,13,10,26,10) ? 'image/png' : start(255,216,255) ? 'image/jpeg' :
        start(82,73,70,70) && String.fromCharCode(...bytes.subarray(8,12)) === 'WEBP' ? 'image/webp' : '';
    return mime ? new Blob([bytes], {type:mime}) : null;
}

async function imageInZip(bytes,signal) {
    const dv = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    let tail = bytes.length - 22;
    const min = Math.max(0,bytes.length-65557);
    while (tail >= min && dv.getUint32(tail,true) !== 0x06054b50) tail--;
    if (tail < min) throw Error('图片 ZIP 不完整。');
    let pos = dv.getUint32(tail+16,true);
    const count = dv.getUint16(tail+10,true), entries = [];
    for (let i = 0; i < count; i++) {
        if (pos+46 > tail || dv.getUint32(pos,true)!==0x02014b50) throw Error('ZIP 目录损坏。');
        const nameLength = dv.getUint16(pos+28,true);
        const next = pos+46+nameLength+dv.getUint16(pos+30,true)+dv.getUint16(pos+32,true);
        if (next > tail) throw Error('ZIP 图片目录数据截断。');
        const name = new TextDecoder().decode(bytes.subarray(pos+46,pos+46+nameLength));
        if (/\.(png|webp|jpe?g)$/i.test(name)) entries.push({name,pos});
        pos = next;
    }
    const entry = entries.findLast(({name}) => /(?:^|[\/_-])final(?:[._-]|$)/i.test(name)) ?? entries.at(-1);
    if (!entry) throw Error('ZIP 内没有可识别的图片。');
    const p = entry.pos, offset = dv.getUint32(p+42,true);
    const size = dv.getUint32(p+20,true), method = dv.getUint16(p+10,true);
    if (offset+30 > p || dv.getUint32(offset,true)!==0x04034b50 || dv.getUint32(p+24,true)>MAX_IMAGE_BYTES) {
        throw Error('ZIP 中的图片无效或过大。');
    }
    const start = offset+30+dv.getUint16(offset+26,true)+dv.getUint16(offset+28,true);
    if (start+size > p) throw Error('ZIP 图片数据不完整。');
    let data = bytes.subarray(start,start+size);
    if (method === 8) {
        const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        data = await imageResponseBytes(new Response(stream),MAX_IMAGE_BYTES,signal);
    } else if (method !== 0) throw Error('不支持此 ZIP 压缩方式。');
    return requireImage(data);
}

function requireImage(bytes) {
    const blob = image(bytes);
    if (!blob || bytes.byteLength > MAX_IMAGE_BYTES) throw Error('回图数据无效或过大。');
    return blob;
}

function base64ImageBytes(text) {
    try {
        const body = text.replace(/^data:image\/[^;,]+;base64,/i,'').replace(/\s/g,'');
        if (body.length > MAX_RESPONSE_BYTES) throw Error('Too large');
        return Uint8Array.from(atob(body),c => c.charCodeAt(0));
    } catch { throw Error('生图服务返回的 Base64 图片无效或过大。'); }
}

function imageReference(payload) {
    for (let depth = 0; depth < 4; depth++) {
        if (typeof payload === 'string') return payload.trim();
        if (Array.isArray(payload)) payload = payload.at(-1);
        else if (payload && typeof payload === 'object') {
            payload = payload.b64_json ?? payload.base64 ?? payload.image ?? payload.url ?? payload.data ?? payload.images;
        } else break;
    }
    return typeof payload === 'string' ? payload.trim() : '';
}

export async function decodeImage(bytes, {contentType = '', readError = error => serviceError(null,error), signal, loadImageUrl} = {}) {
    signal?.throwIfAborted();
    const direct = image(bytes);
    if (direct) return requireImage(bytes);
    if (bytes[0] === 80 && bytes[1] === 75) return imageInZip(bytes,signal);
    if (isNaiStream(bytes,contentType)) {
        const frame = finalNaiFrame(bytes,readError);
        if (typeof frame === 'string') return requireImage(base64ImageBytes(frame));
        if (!(frame instanceof Uint8Array)) throw Error('NovelAI 最终帧的图片字段无效。');
        return requireImage(frame);
    }
    const text = new TextDecoder().decode(bytes).trim();
    let reference = text;
    if (/^[{\[]/.test(text)) {
        let payload;
        try { payload = JSON.parse(text); }
        catch { throw Error('生图服务返回了不完整的 JSON。'); }
        if (payload?.error || payload?.success === false) throw readError(payload.error || payload);
        reference = imageReference(payload);
    }
    if (/^https?:\/\//i.test(reference) && loadImageUrl) return requireImage(await loadImageUrl(reference));
    if (/^(?:data:image\/[^;]+;base64,|iVBOR|\/9j\/|UklGR|UEsDB)/.test(reference)) {
        const data = base64ImageBytes(reference);
        return data[0] === 80 && data[1] === 75 ? imageInZip(data,signal) : requireImage(data);
    }
    if (text.startsWith('<')) throw Error('生图接口返回了网页，请检查 API 地址或中转登录状态。');
    throw Error('响应没有可用的图片。请检查生图线路及回图格式。');
}

export async function availableModels(base, key, signal, suffix = '/chat/completions') {
    const completion = new URL(endpoint(base, suffix));
    completion.pathname = completion.pathname.slice(0, -suffix.length) + '/models';
    const headers = key ? {Authorization:'Bearer ' + key} : {};
    const r = await fetch(completion, {headers, signal:AbortSignal.any([signal,AbortSignal.timeout(25000)]),
        redirect:'error', credentials:'omit'});
    if (!r.ok) throw Error('模型列表响应 HTTP ' + r.status);
    const payload = await r.json();
    if (!Array.isArray(payload.data)) throw Error('接口未返回兼容的模型列表，可手填模型名。');
    return [...new Set(payload.data.map(item => item.id).filter(id => typeof id === 'string'))].sort();
}
