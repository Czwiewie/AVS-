import {normalizeScenePlan} from './planning.js';
import {prepareIdentityRoles} from './identity.js';
import {nativeImageOptions, NATIVE_IMAGE_PROVIDERS} from './image-providers.js';

const comicGrid = (rows,columns) => Array.from({length:rows*columns},(_,i) =>
    [i%columns/columns,Math.floor(i/columns)/rows,1/columns,1/rows]);
export const COMIC_LAYOUTS = {
    story:{name:'三格 · 大图开场',cells:[[0,0,1,0.5],[0,0.5,0.5,0.5],[0.5,0.5,0.5,0.5]]},
    two:{name:'两格 · 上下大图',cells:comicGrid(2,1)},
    four:{name:'四格 · 双列',cells:comicGrid(2,2)},
    six:{name:'六格 · 双列',cells:comicGrid(3,2)}
};
export const COMIC_TEXT_TYPES = {dialogue:'对白',thought:'心声',caption:'旁白',sfx:'拟声'};
export const COMIC_TEXT_ANCHORS = {tl:'左上',tr:'右上',bl:'左下',br:'右下'};
export const COMIC_MAX_TEXTS = 4;
const COMIC_PAGE_WIDTH = 1200;
const COMIC_PAGE_HEIGHT = 1800;
const comicString = (value,max) => typeof value === 'string' ? Array.from(value.trim()).slice(0,max).join('') : '';

export function comicSpec(layout,pages) {
    const n = Number(pages);
    if (!Object.hasOwn(COMIC_LAYOUTS,layout) || ![1,2,3].includes(n)) throw Error('请选择画格版式和页数。');
    const cells = COMIC_LAYOUTS[layout].cells;
    if (cells.length*n > 12) throw Error('一次最多规划 12 格。请选择较少页数或格数。');
    return {layout,pages:n,cells,count:cells.length*n};
}

export function comicSourceKey(source) {
    return JSON.stringify([source.key,source.passage?.start ?? null,source.passage?.end ?? null,source.text]);
}

export function comicLettering(raw) {
    if (!Array.isArray(raw) || raw.length > COMIC_MAX_TEXTS) throw Error('一格最多有四条文字。');
    return raw.map(entry => {
        if (!Object.hasOwn(COMIC_TEXT_TYPES,entry?.type) || !Object.hasOwn(COMIC_TEXT_ANCHORS,entry?.anchor)) {
            throw Error('漫画文字需要有效的类型与位置。');
        }
        return {type:entry.type,anchor:entry.anchor,text:comicString(entry.text,60)};
    });
}

export function normalizeComicPlan(raw,spec,source,looks,limit,natural) {
    if (!Array.isArray(raw?.panels) || raw.panels.length !== spec.count) {
        throw Error('分镜应包含 ' + spec.count + ' 格。可重试，或减少页数。');
    }
    const visible = source.selectedText ?? source.visualText;
    let lastOffset = 0;
    const panels = raw.panels.map((entry,index) => {
        const scene = normalizeScenePlan(entry?.scene,visible,limit);
        const offset = scene.sourceQuote && visible.indexOf(scene.sourceQuote,lastOffset);
        if (!scene.shot || !scene.sourceQuote || offset < 0) {
            throw Error('第 ' + (index+1) + ' 格缺少有效的镜头方案或顺序对应的正文。');
        }
        lastOffset = offset;
        prepareIdentityRoles(scene,looks,source,natural);
        const characters = scene.characters.map(role => {
            const {identity,useReferenceImage,...visibleRole} = role;
            return {...visibleRole,imageToken:useReferenceImage ? identity?.imageToken : undefined};
        });
        return {id:'panel-'+(index+1),scene:{...scene,characters},letters:comicLettering(entry.letters ?? [])};
    });
    return {layout:spec.layout,pages:spec.pages,title:comicString(raw.title,54),panels};
}

function nearestComicAspect(candidates,ratio) {
    const error = value => {
        const [w,h] = value.split(/[:x]/).map(Number);
        return Math.abs(Math.log(w/h/ratio));
    };
    return candidates.reduce((best,candidate) => error(candidate) < error(best) ? candidate : best);
}

export function comicPanelOptions(connection,draw,cell,index) {
    const ratio = cell[2]*COMIC_PAGE_WIDTH/(cell[3]*COMIC_PAGE_HEIGHT);
    const protocol = connection.imageProtocol;
    const seed = draw.seed == null ? null : (draw.seed+index) % 4294967296;
    let config = connection, options = {...draw,seed,count:1};
    if (protocol === 'nai') {
        const size = nearestComicAspect(['832x1216','1024x1024','1216x832','1344x768','1472x704','768x1344'],ratio);
        const [width,height] = size.split('x').map(Number);
        options = {...options,width,height};
    } else if (Object.hasOwn(NATIVE_IMAGE_PROVIDERS,protocol)) {
        const {aspects} = nativeImageOptions(protocol,connection.imageModel);
        config = {...connection,[protocol+'Aspect']:nearestComicAspect(aspects.filter(aspect=>aspect!=='auto'),ratio)};
    } else {
        config = {...connection,otherSize:nearestComicAspect(['1024x1024','1024x1536','1536x1024'],ratio)};
    }
    return {connection:config,draw:options};
}

const comicTextStyle = {
    dialogue:{fill:'#fff',border:'#111827'},thought:{fill:'#fff',border:'#475569'},
    caption:{fill:'#fff1c8',border:'#573f1d'},sfx:{fill:'#fff',border:'#111827'}
};

function comicLines(ctx,text,width) {
    const lines = [];
    for (const paragraph of text.split(/\r?\n/)) {
        let line = '';
        for (const char of Array.from(paragraph)) {
            if (line && ctx.measureText(line+char).width > width) {
                lines.push(line.trimEnd());
                line = '';
            }
            line += char;
        }
        lines.push(line);
    }
    return lines;
}

function measureComicLetters(ctx,entries,font,width,margin) {
    const lineHeight = Math.ceil(font*1.27);
    return entries.map(entry => {
        const face = (entry.type === 'sfx' ? 'italic 800 ' : '650 ') + font + 'px "Noto Sans CJK SC","Noto Sans SC","Microsoft YaHei",sans-serif';
        ctx.font = face;
        const lines = comicLines(ctx,entry.text,width);
        const boxWidth = Math.max(...lines.map(line=>ctx.measureText(line).width)) + margin*1.3;
        return {...entry,face,lines,boxWidth,boxHeight:lines.length*lineHeight+margin,lineHeight};
    });
}

function drawComicLetters(ctx,letters,x,y,w,h) {
    const visible = letters.filter(entry=>entry.text);
    if (!visible.length) return;
    const margin = Math.round(Math.min(w,h)*0.025), gap = Math.ceil(margin*0.5);
    const maxWidth = Math.floor(w*0.44)-margin;
    const maxHeight = h-2*margin-gap;
    let font = Math.max(14,Math.min(32,Math.floor(Math.min(w,h)*0.056)));
    let boxes = measureComicLetters(ctx,visible,font,maxWidth,margin);
    const sideHeight = (side) => boxes.filter(box=>box.anchor.endsWith(side)).reduce((sum,box)=>sum+box.boxHeight+gap,0);
    while (font > 10 && Math.max(sideHeight('l'),sideHeight('r')) > maxHeight) {
        font--;
        boxes = measureComicLetters(ctx,visible,font,maxWidth,margin);
    }
    for (const anchor of Object.keys(COMIC_TEXT_ANCHORS)) {
        const group = boxes.filter(box=>box.anchor===anchor);
        const bottom = anchor.startsWith('b'), right = anchor.endsWith('r');
        let top = bottom ? y+h-margin-group.reduce((sum,box)=>sum+box.boxHeight+gap,0)+gap : y+margin;
        for (const {type,face,lines,boxWidth,boxHeight,lineHeight} of group) {
            const t = comicTextStyle[type];
            const left = right ? x+w-margin-boxWidth : x+margin;
            ctx.font = face;
            ctx.lineWidth = Math.max(2,Math.round(font/12));
            if (type !== 'sfx') {
                ctx.beginPath();
                ctx.roundRect(left,top,boxWidth,boxHeight,type === 'caption' ? 4 : margin*0.62);
                ctx.fillStyle = t.fill;
                ctx.fill();
                ctx.strokeStyle = t.border;
                if (type === 'thought') ctx.setLineDash([5,4]);
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.fillStyle = '#101827';
            } else {
                ctx.lineWidth = Math.max(3,Math.round(font/6));
                ctx.strokeStyle = t.border;
                ctx.fillStyle = t.fill;
            }
            ctx.textBaseline = 'middle';
            for (const [i,line] of lines.entries()) {
                const dx = left+margin*0.65, dy = top+margin/2+lineHeight*(i+0.5);
                if (type === 'sfx') ctx.strokeText(line,dx,dy);
                ctx.fillText(line,dx,dy);
            }
            top += boxHeight+gap;
        }
    }
}

async function comicImage(host,blob) {
    const url = host.URL.createObjectURL(blob);
    try {
        const image = new host.Image();
        image.src = url;
        await image.decode();
        return image;
    } finally { host.URL.revokeObjectURL(url); }
}

export async function drawComicPage(host,canvas,spec,page,panels,loadImage,strict=false) {
    const inset = 22, gap = 15;
    const pageWidth = COMIC_PAGE_WIDTH, pageHeight = COMIC_PAGE_HEIGHT;
    const areaWidth = pageWidth-2*inset+gap, areaHeight = pageHeight-2*inset+gap;
    const first = page*spec.cells.length;
    const cells = panels.slice(first,first+spec.cells.length);
    const images = await Promise.all(cells.map(async panel => {
        if (!panel.imageId) return null;
        const blob = await loadImage(panel.imageId);
        return blob ? comicImage(host,blob) : null;
    }));
    if (strict && (images.length !== spec.cells.length || images.some(image=>!image))) throw Error('请先生成这页的全部画格。');
    canvas.width = pageWidth; canvas.height = pageHeight;
    const ctx = canvas.getContext('2d',{alpha:false});
    if (!ctx) throw Error('当前浏览器无法绘制漫画页。');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0,0,pageWidth,pageHeight);
    spec.cells.forEach(([px,py,pw,ph],index) => {
        const x = Math.round(inset+px*areaWidth), y = Math.round(inset+py*areaHeight);
        const w = Math.round(pw*areaWidth-gap), h = Math.round(ph*areaHeight-gap);
        ctx.save();
        ctx.beginPath();
        ctx.rect(x,y,w,h);
        ctx.clip();
        ctx.fillStyle = '#eaf3fc';
        ctx.fillRect(x,y,w,h);
        const image = images[index];
        if (image) {
            const scale = Math.min(w/image.naturalWidth,h/image.naturalHeight);
            const dw = image.naturalWidth*scale, dh = image.naturalHeight*scale;
            ctx.fillStyle = '#172334';
            ctx.fillRect(x,y,w,h);
            ctx.drawImage(image,x+(w-dw)/2,y+(h-dh)/2,dw,dh);
        } else {
            ctx.font = '650 34px "Noto Sans SC",sans-serif';
            ctx.fillStyle = '#395b7c';
            ctx.textBaseline = 'middle';
            ctx.fillText('第 '+(first+index+1)+' 格',x+24,y+h/2);
        }
        drawComicLetters(ctx,cells[index]?.letters ?? [],x,y,w,h);
        ctx.strokeStyle = '#172334';
        ctx.lineWidth = 4;
        ctx.strokeRect(x,y,w,h);
        ctx.restore();
    });
}
