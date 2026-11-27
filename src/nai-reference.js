const NAI_REFERENCE_CANVASES_45 = [[1024,1536],[1472,1472],[1536,1024]];
const NAI_REFERENCE_CANVASES_5 = [[704,1472],[768,1344],[832,1216],[896,1152],[1024,1024],
    [1152,896],[1216,832],[1344,768],[1472,704]];

export const NAI_REFERENCE_DEFAULTS = {enabled:false,strength45:0.6,fidelity45:0.4,strength5:1.25};

export function preciseReferenceGeometry(width,height,v5) {
    if (!(width > 0 && height > 0)) throw Error('无法读取人物参考图的尺寸。');
    const ratio = Math.log(width/height);
    const buckets = v5 ? NAI_REFERENCE_CANVASES_5 : NAI_REFERENCE_CANVASES_45;
    const difference = ([w,h]) => Math.abs(Math.log(w/h) - ratio);
    const [w,h] = buckets.reduce((best,candidate) => difference(candidate) < difference(best) ? candidate : best);
    const contain = Math.min(w/width,h/height);
    const cover = Math.max(w/width,h/height);
    const scale = v5 && contain/cover >= 0.87 ? cover : contain;
    const drawWidth = Math.round(width*scale), drawHeight = Math.round(height*scale);
    return {width:w,height:h,drawWidth,drawHeight,left:Math.round((w-drawWidth)/2),top:Math.round((h-drawHeight)/2)};
}

export async function prepareNaiPortrait(host,source,v5) {
    const url = host.URL.createObjectURL(source);
    try {
        const image = new host.Image();
        image.src = url;
        await image.decode();
        const {width,height,drawWidth,drawHeight,left,top} = preciseReferenceGeometry(image.naturalWidth,image.naturalHeight,v5);
        const canvas = host.document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d',{alpha:false});
        if (!context) throw Error('无法创建 NAI 参考图画布。');
        context.fillStyle = '#000';
        context.fillRect(0,0,width,height);
        context.imageSmoothingQuality = 'high';
        context.drawImage(image,left,top,drawWidth,drawHeight);
        const encoded = canvas.toDataURL('image/png');
        if (!encoded.startsWith('data:image/png;base64,')) throw Error('无法编码 NAI 参考图。');
        return encoded.slice('data:image/png;base64,'.length);
    } finally { host.URL.revokeObjectURL(url); }
}

export function preciseReferenceParameters(data,options,v5) {
    const max = v5 ? 5 : 1;
    const strength = Number(v5 ? options.strength5 : options.strength45);
    const fidelity = v5 ? 1 : Number(options.fidelity45);
    if (typeof data !== 'string' || !data || !Number.isFinite(strength) || strength <= 0 || strength > max ||
        !Number.isFinite(fidelity) || fidelity < 0 || fidelity > 1) throw Error('NAI 精确参考的图片或参数无效。');
    return {
        director_reference_images:[data],
        director_reference_descriptions:[{caption:{base_caption:'character',char_captions:[]},legacy_uc:false}],
        director_reference_information_extracted:[1],
        director_reference_strength_values:[strength],
        director_reference_secondary_strength_values:[v5 ? 0 : Number((1-fidelity).toFixed(3))]
    };
}
