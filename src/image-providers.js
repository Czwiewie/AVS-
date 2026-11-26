export const NATIVE_IMAGE_PROVIDERS = {
    grok: {
        label:'xAI 原生 · Grok Imagine',
        base:'https://api.x.ai/v1',
        models:{
            'grok-imagine-image-2.0':'Grok Imagine Image 2.0',
            'grok-imagine-image':'Grok Imagine Image'
        }
    },
    gemini: {
        label:'Google 原生 · Gemini Nano Banana',
        base:'https://generativelanguage.googleapis.com/v1beta',
        models:{
            'gemini-nano-banana-2.1':'Nano Banana 2.1',
            'gemini-3.1-flash-image':'Nano Banana 2',
            'gemini-3.1-flash-lite-image':'Nano Banana 2 Lite',
            'gemini-3-pro-image':'Nano Banana Pro',
            'gemini-2.5-flash-image':'Nano Banana'
        }
    }
};

const CORE_ASPECTS = ['1:1','2:3','3:2','3:4','4:3','9:16','16:9'];
const GEMINI_ASPECTS = [...CORE_ASPECTS,'4:5','5:4','21:9'];
const GEMINI_WIDE_ASPECTS = [...GEMINI_ASPECTS,'1:4','4:1','1:8','8:1'];
const GROK_ASPECTS = ['auto',...CORE_ASPECTS,'2:1','1:2','19.5:9','9:19.5','20:9','9:20'];

export function nativeImageOptions(protocol, model) {
    if (protocol === 'grok') {
        const latest = model === 'grok-imagine-image-2.0';
        return {aspects:latest ? [...GROK_ASPECTS,'21:9','5:2'] : GROK_ASPECTS,
            resolutions:['1K','2K'], qualities:latest ? ['auto','low','medium'] : []};
    }
    const legacy = model === 'gemini-2.5-flash-image';
    const pro = model === 'gemini-3-pro-image';
    const small = model === 'gemini-3.1-flash-image' || model === 'gemini-3.1-flash-lite-image';
    return {aspects:(legacy || pro) ? GEMINI_ASPECTS : GEMINI_WIDE_ASPECTS,
        resolutions:legacy ? ['1K'] : small ? ['0.5K','1K','2K','4K'] : ['1K','2K','4K'], qualities:[]};
}

export function nativeImageBody(protocol, connection, prompt) {
    const model = connection.imageModel;
    if (!Object.hasOwn(NATIVE_IMAGE_PROVIDERS[protocol].models,model)) {
        throw Error('请选择当前生图协议支持的模型。');
    }
    const {aspects,resolutions,qualities} = nativeImageOptions(protocol,model);
    const aspect = connection[protocol + 'Aspect'] || '2:3';
    const resolution = connection[protocol + 'Resolution'] || '1K';
    const quality = connection.grokQuality || 'auto';
    if (!aspects.includes(aspect) || !resolutions.includes(resolution)) throw Error('当前生图模型不支持所选画幅或分辨率。');
    if (protocol === 'grok') {
        if (qualities.length && !qualities.includes(quality)) throw Error('请选择当前 Grok 模型支持的画质。');
        return {model, prompt, n:1, aspect_ratio:aspect, resolution:resolution.toLowerCase(), response_format:'b64_json',
            ...(qualities.length ? {quality} : {})};
    }
    return {model, input:prompt, store:false, response_format:{
        type:'image', aspect_ratio:aspect, ...(model === 'gemini-2.5-flash-image' ? {} : {image_size:resolution})
    }};
}

export function geminiFinalImage(payload) {
    if (payload?.status && payload.status !== 'completed') return null;
    const steps = Array.isArray(payload?.steps) ? payload.steps : [];
    for (const step of steps) {
        if (step?.type !== 'model_output' || !Array.isArray(step.content)) continue;
        for (const part of step.content) {
            if (part?.type === 'image' && typeof part.data === 'string' && part.data.trim()) return part.data;
        }
    }
    return null;
}
