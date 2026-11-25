import {sourceAt, prose, optionalLooks} from './scene.js';
import {MODELS, STYLE_FIELDS, endpoint, extractStyle, planScene, generate} from './api.js';

export function installStudio(host, owner, kind, css) {
const { document, Option, MutationObserver, Image, indexedDB, URL } = host;
const slot = '__AVS_ILLUSTRATION_STUDIO__';
const legacy = '__AVS_VISUAL_WORKSHOP_R2__';
const version = '1.0.2';
const existing = host[slot];
if (existing) {
    const order = version.localeCompare(existing.version ?? '', 'en', {numeric:true});
    if (order < 0 || (order === 0 && (existing.kind === 'extension' || existing.owner === owner))) return existing;
}
existing?.dispose();
const previousBridge = host[legacy];
const listeners = [];
let observer, disposed = false;
const style = css ? document.createElement('style') : null;
if (style) {
    style.textContent = css;
    document.head.append(style);
}
const id='avs-illustration-studio';
const ctx=()=>{const c=host.SillyTavern?.getContext?.();if(!c)throw Error('酒馆页面尚未就绪，请等待聊天加载。');return c;};
const defaults={visionBase:'https://api.openai.com/v1',visionModel:'',naiBase:'https://image.novelai.net',naiModel:MODELS[0]};
const settings=()=>(ctx().extensionSettings[id]??={...defaults});
const persist=()=>ctx().saveSettingsDebounced();
let dialog, dbPromise, job, phase, chosenUrl, refreshVersion=0;
const field=k=>dialog.querySelector('[data-field="'+k+'"]');
const say=t=>field('status').textContent=t;
function stage(t){phase=t;say(t+'…');}
function database(){
    if(!dbPromise)dbPromise=new Promise((resolve,reject)=>{
        const r=indexedDB.open(id,1);
        r.onupgradeneeded=()=>r.result.createObjectStore('images');
        r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
    }).catch(e=>{dbPromise=null;throw e;});
    return dbPromise;
}
async function stored(s,blob){
    const db=await database();
    return new Promise((resolve,reject)=>{
        const tx=db.transaction('images',blob?'readwrite':'readonly'), table=tx.objectStore('images');
        const req=blob?table.put({text:s.text,blob},s.key):table.get(s.key);
        tx.oncomplete=()=>resolve(blob || (req.result?.text===s.text?req.result.blob:null));
        tx.onerror=tx.onabort=()=>reject(tx.error);
    });
}
function show(blob,index){
    if(chosenUrl)URL.revokeObjectURL(chosenUrl);
    chosenUrl=blob?URL.createObjectURL(blob):null;
    field('result').hidden=!blob;
    if(!blob){field('image').removeAttribute('src');field('download').removeAttribute('href');return;}
    field('image').src=chosenUrl;field('download').href=chosenUrl;
    field('caption').textContent='第 '+index+' 楼插画';
    field('download').download='AVS-'+index+'.'+blob.type.split('/')[1];
}
function source(){return sourceAt(ctx(),field('floor').value||'latest');}
function same(s){try{const n=sourceAt(ctx(),s.index);return n.key===s.key&&n.text===s.text;}catch{return false;}}
function excerpt(s){field('excerpt').textContent='#'+s.index+' · '+s.text.replace(/\s+/g,' ').slice(0,160);}
async function refresh(reset=false){
    if(!dialog?.open)return;
    const version=++refreshVersion, select=field('floor'), chat=ctx().chat||[];
    const choice=reset?'latest':select.value||'latest', options=[new Option('最新 AI 回复','latest')];
    for(let i=chat.length-1;i>=0;i--){
        const t=prose(chat[i]);
        if(t)options.push(new Option('#'+i+' · '+t.replace(/\s+/g,' ').slice(0,42),String(i)));
    }
    select.replaceChildren(...options);
    select.value=options.some(o=>o.value===choice)?choice:'latest';
    let s;show(null);
    try{s=source();excerpt(s);}catch(e){field('excerpt').textContent=e.message;return;}
    try{const blob=await stored(s);if(version===refreshVersion&&dialog.open&&same(s))show(blob,s.index);}
    catch{if(version===refreshVersion&&!job)say('本机预览存储不可用，生成后可下载图片。');}
}
const keyId=(kind,url)=>id+'|'+kind+'|'+url.trim();
function storage(name) {
    const fallback = new Map();
    return {
        getItem(k){try{return host[name].getItem(k) ?? fallback.get(k) ?? null;}catch{return fallback.get(k) ?? null;}},
        setItem(k,v){try{host[name].setItem(k,v);}catch{fallback.set(k,v);}},
        removeItem(k){fallback.delete(k);try{host[name].removeItem(k);}catch{}}
    };
}
const sessionStorage=storage('sessionStorage'), localStorage=storage('localStorage');
function getKey(kind,url){const k=keyId(kind,url);return sessionStorage.getItem(k)||localStorage.getItem(k)||'';}
function styleLabel(){const s=settings();field('styleName').textContent=s.style?'已保存 · '+s.styleName:'尚未选择参考图';field('traits').textContent=s.style?STYLE_FIELDS.map(k=>s.style[k]).join(' · '):'';}
function populate(){
    const s=settings();
    for(const k of Object.keys(defaults))field(k).value=s[k]??defaults[k];
    for(const k of ['vision','nai'])field(k+'Key').value=getKey(k,field(k+'Base').value);
    field('remember').checked=['vision','nai'].some(k=>localStorage.getItem(keyId(k,field(k+'Base').value)));
    styleLabel();
}
function config(){
    const s=settings();
    const v=Object.fromEntries(Object.keys(defaults).map(k=>[k,field(k).value.trim()]));
    endpoint(v.visionBase,'/chat/completions');endpoint(v.naiBase,'/ai/generate-image');
    for(const kind of ['vision','nai']){
        const base=kind+'Base', key=field(kind+'Key').value.trim(), name=keyId(kind,v[base]);
        const old=keyId(kind,s[base]||defaults[base]);
        if(old!==name){sessionStorage.removeItem(old);localStorage.removeItem(old);}
        if(key)sessionStorage.setItem(name,key);else sessionStorage.removeItem(name);
        if(key&&field('remember').checked)localStorage.setItem(name,key);else localStorage.removeItem(name);
    }
    Object.assign(s,v);persist();
    return {...v,visionKey:field('visionKey').value.trim(),naiKey:field('naiKey').value.trim(),style:s.style};
}
async function raster(file){
    const url=URL.createObjectURL(file);
    try{
        const img=new Image();img.src=url;await img.decode();
        const scale=Math.min(1,1280/Math.max(img.naturalWidth,img.naturalHeight));
        const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
        const draw=canvas.getContext('2d');draw.fillStyle='white';draw.fillRect(0,0,canvas.width,canvas.height);draw.drawImage(img,0,0,canvas.width,canvas.height);
        return canvas.toDataURL('image/jpeg',0.92);
    }finally{URL.revokeObjectURL(url);}
}
function lock(value){
    for(const el of dialog.querySelectorAll('input,select,[data-work]'))el.disabled=value;
    field('cancel').hidden=!value;
}
async function run(action){
    if(job)return;
    job=new AbortController();lock(true);
    try{stage('读取设置');await action(job.signal);}
    catch(e){say(job.signal.aborted?'已取消。':phase+'失败 · '+e.message);}
    finally{job=null;lock(false);}
}
async function analyze(file,signal){
    const c=config();
    if(!c.visionModel||!c.visionKey)throw Error('请先填写视觉提示词模型与密钥。');
    stage('读取参考图');const data=await raster(file);
    stage('提取画风');const style=await extractStyle(c,c.visionKey,data,signal);
    if(signal.aborted)return;
    Object.assign(settings(),{style,styleName:file.name});persist();styleLabel();say('画风已保存，可以生成插画。');
}
async function illustrate(signal){
    const c=config(),s=source();
    if(!c.visionModel||!c.visionKey||!c.naiKey)throw Error('请完整填写两组 API 设置。');
    if(!c.style)throw Error('请先上传参考图并完成画风提取。');
    stage('读取第 '+s.index+' 楼');const looks=await optionalLooks(host.__AVS_V4_BRIDGE__,s);
    stage('编译第 '+s.index+' 楼提示词');const plan=await planScene(c,c.visionKey,s,looks,signal);
    if(!same(s))throw Error('原楼层已变更，请重新选择。');
    stage('请求 '+c.naiModel);
    const blob=await generate(c,c.naiKey,plan,c.style,signal,()=>stage('解析图片'));
    const url=URL.createObjectURL(blob);try{const img=new Image();img.src=url;await img.decode();}finally{URL.revokeObjectURL(url);}
    if(signal.aborted)return;
    let saved=true;try{await stored(s,blob);}catch{saved=false;}
    if(same(s)){
        ++refreshVersion;
        if(field('floor').value==='latest'&&source().index!==s.index)field('floor').value=String(s.index);
        excerpt(s);show(blob,s.index);
        say(saved?'已生成并保存到此楼的工坊预览。':'已生成，本机预览保存失败，请下载原图。');
    }else if(saved)say('已保存到发起生成时的聊天与楼层。');
    else{show(blob,s.index);say('原聊天已切换且本机存储失败，请下载这张插画。');}
}
function build(){
    dialog=document.createElement('dialog');dialog.id=id;
    dialog.innerHTML=`<header><h2>插画工坊</h2><button data-field="close">关闭</button></header>
    <div class="studio-scroll"><details data-field="config"><summary>API 设置</summary><div class="studio-fields">
    <label>视觉提示词 API 地址<input data-field="visionBase" type="url"></label>
    <label>视觉模型名<input data-field="visionModel" placeholder="支持图片输入的模型"></label>
    <label>视觉提示词 API 密钥<input data-field="visionKey" type="password" autocomplete="off"></label>
    <label>NovelAI 原生 API 地址<input data-field="naiBase" type="url"></label>
    <label>生图模型<select data-field="naiModel"><option value="nai-diffusion-4-5-full">NAI 4.5 Full</option><option value="nai-diffusion-5-full">NAI 5 Full</option></select></label>
    <label>NovelAI Token<input data-field="naiKey" type="password" autocomplete="off"></label>
    <label class="studio-check"><input data-field="remember" type="checkbox">在此浏览器记住密钥（本机明文保存）</label>
    <button data-field="save" data-work>保存设置</button></div></details>
    <section><h3>参考画风</h3><label class="studio-file">选择参考图<input data-field="upload" type="file" accept="image/png,image/jpeg,image/webp"></label><p data-field="styleName"></p><small data-field="traits"></small></section>
    <section><label>配图楼层<select data-field="floor"></select></label><p data-field="excerpt"></p></section>
    <button class="studio-primary" data-field="make" data-work>生成插画</button><button data-field="cancel" hidden>取消任务</button>
    <p role="status" aria-live="polite" data-field="status"></p><figure data-field="result" hidden><figcaption data-field="caption"></figcaption><img data-field="image" alt="楼层插画"><a data-field="download">下载原图</a></figure></div>`;
    document.body.append(dialog);
    field('save').onclick=()=>{try{config();say('设置已保存。');}catch(e){say('配置有误 · '+e.message);}};
    for(const k of ['vision','nai'])field(k+'Base').oninput=()=>{field(k+'Key').value=getKey(k,field(k+'Base').value);};
    field('close').onclick=()=>dialog.close();field('cancel').onclick=()=>job?.abort('user');
    field('floor').onchange=()=>refresh();
    field('upload').onchange=e=>{const f=e.target.files[0];e.target.value='';if(f)run(s=>analyze(f,s));};
    field('make').onclick=()=>run(illustrate);
    dialog.addEventListener('close',()=>{++refreshVersion;show(null);});
    const eventsHost=ctx();
    for(const name of ['CHAT_CHANGED','CHARACTER_MESSAGE_RENDERED','MESSAGE_SWIPED','MESSAGE_EDITED','MESSAGE_DELETED']){
        if(eventsHost.eventTypes?.[name] && eventsHost.eventSource?.on) {
            const event=eventsHost.eventTypes[name], fn=()=>refresh(name==='CHAT_CHANGED');
            eventsHost.eventSource.on(event,fn);
            listeners.push(()=>{(eventsHost.eventSource.off ?? eventsHost.eventSource.removeListener)?.call(eventsHost.eventSource,event,fn);});
        }
    }
}
function open(){
    if(disposed)return {ok:false,error:'该工坊实例已关闭。'};
    try {
        ctx();
        if(!dialog)build();
        if(!dialog.open) {
            populate();dialog.showModal();
            if(!settings().visionModel)field('config').open=true;
            refresh(true);
        }
        return {ok:true};
    } catch(e) {return {ok:false,error:e.message};}
}
function visible(){
    if(!dialog?.open || !dialog.isConnected)return {ok:false,error:'工坊弹窗尚未打开。'};
    const r=dialog.getBoundingClientRect();
    const x=Math.max(0,Math.min(host.innerWidth-1,r.left+r.width/2)),y=Math.max(0,Math.min(host.innerHeight-1,r.top+r.height/2));
    const hit=document.elementFromPoint(x,y);
    return r.width>0 && r.height>0 && (hit===dialog||dialog.contains(hit)) ? {ok:true} : {ok:false,error:'工坊未显示在酒馆页面最上层。'};
}
function openFromMenu(){
    const result=open();
    if(!result.ok) {
        if(host.toastr?.error)host.toastr.error(result.error,'AVS 插画工坊');
        else host.alert(result.error);
    }
    return result;
}
let entry;
function mount(){
    const menu=document.querySelector('#extensionsMenu');
    if(!menu || entry?.isConnected)return;
    entry=document.createElement('button');entry.type='button';entry.id=id+'-open';
    entry.className='list-group-item flex-container flexGap5 interactable';
    entry.innerHTML='<i class="fa-solid fa-palette" aria-hidden="true"></i><span>AVS 插画工坊</span>';
    entry.onclick=openFromMenu;menu.append(entry);
}
const api={kind,owner,version,open,openFromMenu,activate:visible,
    async verifyVisible(){
        await new Promise(resolve=>host.requestAnimationFrame(()=>host.requestAnimationFrame(resolve)));
        return visible();
    },
    close(){if(dialog?.open)dialog.close();},
    dispose(){
        if(disposed)return;disposed=true;job?.abort('user');observer?.disconnect();
        for(const remove of listeners)remove();
        if(chosenUrl)URL.revokeObjectURL(chosenUrl);
        dialog?.remove();entry?.remove();style?.remove();
        if(host[slot]===api)delete host[slot];
        if(host[legacy]===api){if(previousBridge)host[legacy]=previousBridge;else delete host[legacy];}
        dbPromise?.then(db=>db.close()).catch(()=>{});
    }
};
host[slot]=api;
host[legacy]=api;
mount();
if(!entry){
    observer=new MutationObserver(()=>{mount();if(entry)observer.disconnect();});
    observer.observe(document.documentElement,{subtree:true,childList:true});
}
return api;
}
