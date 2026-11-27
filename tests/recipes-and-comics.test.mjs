import assert from 'node:assert/strict';
import {MODELS, planComic, makeImageRequest} from '../src/api.js';
import {snapshotRecipe, readRecipe, encodeRecipeFile, decodeRecipeFile, comparableRecipe} from '../src/recipes.js';
import {comicSpec, comicSourceKey, normalizeComicPlan, comicPanelOptions, drawComicPage} from '../src/comics.js';
import {createComicView} from '../src/comic-view.js';
import {workshopPanel} from '../src/panel.js';

const nai = {imageProtocol:'nai',imageProvider:'official',imageModel:MODELS[0],naiModel:MODELS[0],
    naiReference:{enabled:true,strength45:0.7,fidelity45:0.5,strength5:2},imageKey:'secret-token',imageBase:'https://private.test'};
const gpt = {imageProtocol:'openai',imageProvider:'other',imageModel:'gpt-image-2',otherSize:'1024x1536',otherReply:'default'};
const gemini = {imageProtocol:'gemini',imageProvider:'other',imageModel:'gemini-nano-banana-2.1',geminiAspect:'2:3',geminiResolution:'2K'};
const grok = {imageProtocol:'grok',imageProvider:'other',imageModel:'grok-imagine-image-2.0',grokAspect:'3:2',grokResolution:'2K',grokQuality:'medium'};
const draw = {width:832,height:1216,seed:900,count:4,steps:25,sampler:'k_euler_ancestral',scale:5,rescale:0.1,quality:true};
for (const connection of [nai,gpt,gemini,grok]) {
    const recipe = snapshotRecipe('青灯',connection,draw,{name:'微冷',color:'teal',light:'soft backlight',key:'secret-token'});
    const encoded = encodeRecipeFile({...recipe,key:'secret-token',config:{...recipe.config,base:'https://private.test'}});
    assert.doesNotMatch(encoded,/secret-token|private\.test|imageKey|imageBase/);
    assert.deepEqual(decodeRecipeFile(encoded),recipe);
    assert.equal(recipe.config.draw?.count,undefined);
    assert.equal(comparableRecipe({model:recipe.model,imageProtocol:connection.imageProtocol,
        imageProvider:connection.imageProvider,requestPlan:{}},connection),true);
}
const compat = {...nai,imageProvider:'other',imageModel:'nai-custom-alias'};
assert.equal(snapshotRecipe('别名',compat,draw,null).config.precise.enabled,false);
assert.equal(comparableRecipe({model:nai.imageModel,imageProtocol:'nai',imageProvider:'official',requestPlan:{}},
    {...nai,imageProvider:'other'}),false);
assert.throws(()=>readRecipe({name:'坏画幅',model:gemini.imageModel,route:'grok',
    config:{aspect:'2:3',resolution:'2K'}}),/不匹配/);
assert.throws(()=>decodeRecipeFile('{"format":"avs-workshop-recipe","version":22}'),/版本/);
console.log('PASS provider recipe round trips, validated route, deterministic comparison and credential omission');

const prose = ['今汐推窗。','风穿过檐铃。','她把灯递给同伴。'];
const source = {key:'chat-and-swipe',index:12,text:prose.join('\n'),visualText:prose.join('\n'),speaker:'Narrator'};
const spec = comicSpec('story',1);
assert.equal(comicSpec('four',3).count,12);
assert.throws(()=>comicSpec('six',3),/最多规划 12/);
assert.notEqual(comicSourceKey(source),comicSourceKey({...source,key:'other-swipe'}));
assert.notEqual(comicSourceKey(source),comicSourceKey({...source,passage:{start:0,end:3},text:source.text}));
assert.notEqual(comicSourceKey(source),comicSourceKey({...source,text:source.text+'更新'}));
const comicRaw = {title:'雨夜来信',panels:prose.map((sourceQuote,index)=>({
    scene:{sourceQuote,base:'a rainlit interior '+(index+1),negative:'',
        shot:{framing:'medium shot',camera:'eye level',layout:'clear foreground',focus:'the lantern',lighting:'soft'},
        characters:[],interactions:[]},
    letters:index===1 ? [{type:'sfx',anchor:'tl',text:'叮铃'}] :
        [{type:'dialogue',anchor:'tr',text:index===0 ? '听，起风了。':'把灯拿好。'}]
}))};
assert.throws(()=>normalizeComicPlan({...comicRaw,panels:comicRaw.panels.slice(1)},spec,source,[],6,false),/3 格/);
assert.throws(()=>normalizeComicPlan({...comicRaw,panels:[...comicRaw.panels].reverse()},spec,source,[],6,false),/正文/);
assert.throws(()=>normalizeComicPlan({...comicRaw,panels:comicRaw.panels.map(p=>({...p,letters:[{type:'html',anchor:'tl',text:'xx'}]}))},
    spec,source,[],6,false),/类型与位置/);
let plannerCalls=0;
globalThis.fetch = async (url,options) => {
    plannerCalls++;
    assert.equal(url,'https://vision.test/v1/chat/completions');
    const messages=JSON.parse(options.body).messages;
    assert.match(messages[0].content,/Simplified Chinese/);
    assert.match(messages[0].content,/Keep dialogue, captions, sound effects/);
    const input=JSON.parse(messages[1].content);
    assert.equal(input.selectedReply,source.visualText);
    assert.equal(input.requestedComic.panelCount,3);
    assert.deepEqual(input.requestedComic.readOrder,[1.33,0.67,0.67]);
    return Response.json({choices:[{message:{content:JSON.stringify(comicRaw)}}]});
};
const record=await planComic({...nai,visionBase:'https://vision.test/v1',visionModel:'demo'},'test',source,[],spec);
assert.equal(plannerCalls,1);
assert.equal(record.panels.length,3);
assert.equal(record.panels[1].letters[0].text,'叮铃');
for (const connection of [nai,gpt,gemini,grok]) {
    const panel = comicPanelOptions(connection,draw,spec.cells[1],1);
    const request=makeImageRequest(panel.connection,record.panels[1].scene,null,panel.draw);
    assert.equal(panel.draw.count,1);
    assert.equal(panel.draw.seed,901);
    assert.doesNotMatch(request.prompt,/叮铃/);
    assert.match(request.prompt,/Azur Lane/i);
}
console.log('PASS one storyboard request, chronology, simplified lettering and separate four-route panel payloads');

const texts=[], frameCalls=[], decoded=[];
const dummy = ()=>{};
const canvasContext = {
    save:dummy, restore:dummy, beginPath:dummy, clip:dummy, fillRect:dummy,
    roundRect:dummy, stroke:dummy, fill:dummy, strokeRect:dummy, setLineDash:dummy,
    moveTo:dummy,lineTo:dummy, closePath:dummy, strokeText:dummy,
    rect:(...args)=>frameCalls.push(args), drawImage: (...args)=>decoded.push(args),
    measureText:line=>({width:line.length*15}),fillText:(txt,x,y)=>texts.push({txt,x,y})
};
class Elements {
    value=''; hidden=false; disabled=false; textContent=''; children=[]; dataset={}; files=[];
    replaceChildren(...nodes) {
        this.children=nodes;
        if (nodes.length && Object.hasOwn(nodes[0],'value')) this.value=nodes[0].value;
    }
    append(...nodes) {this.children.push(...nodes);}
    setAttribute(){}
    getContext(){return canvasContext;}
    toBlob(resolve){resolve(new Blob(['mock-png'],{type:'image/png'}));}
}
const host={
    document:{createElement:()=>new Elements()},
    Option:class {constructor(text,value){this.text=text;this.value=value;}},
    URL:{createObjectURL:()=> 'blob:fixture',revokeObjectURL:dummy},
    Image:class {naturalWidth=832;naturalHeight=1216;async decode(){}}
};
const canvas=new Elements();
await assert.rejects(drawComicPage(host,canvas,spec,0,record.panels,()=>null,true),/全部画格/);
await drawComicPage(host,canvas,spec,0,record.panels,()=>null);
assert.equal(canvas.width,1200);
assert.equal(canvas.height,1800);
assert.deepEqual(new Set(texts.filter(x=>/起风|叮铃|拿好/.test(x.txt)).map(x=>x.txt)),
    new Set(['听，起风了。','叮铃','把灯拿好。']));
assert(frameCalls.every(([x,y,w,h])=>x>=0&&y>=0&&x+w<=1200&&y+h<=1800));
console.log('PASS visual page geometry and independent text overlay');

const fields=new Map();
const field=name=>{
    if (!fields.has(name)) fields.set(name,new Elements());
    return fields.get(name);
};
field('comicLayout').value='story';
field('comicPages').value='1';
let shownSource=source, stillValid=true, current, busy=false, failSecond=true, serial=0, draftCalls=0, downloadCount=0, savedWrites=[];
const art=new Map(), renderCalls=[], keys=[];
const mockLibrary={
    async getComic(key){keys.push(key);return current?.key===key ? structuredClone(current.value) : undefined;},
    async getComicArt(id){return art.get(id);},
    async commitComic(key,value,revision,pending){
        assert.equal(current?.value.revision ?? 0,revision);
        for (const [id,blob] of pending) art.set(id,blob);
        const saved={...structuredClone(value),revision:revision+1};
        current={key,value:saved};
        savedWrites.push(saved);
        return saved;
    }
};
const view=createComicView({host,field,library:mockLibrary,isActive:()=>true,busy:()=>busy,
    sceneSelection:()=>shownSource,matches:viewSource=>stillValid&&viewSource.key===shownSource.key,
    requestPlan:async ()=>{draftCalls++;return structuredClone(record);},
    renderImage:async (_,cell,index)=>{
        renderCalls.push(index); assert(cell.length===4);
        if (index===1 && failSecond) throw Error('simulated 429');
        return new Blob(['panel '+index],{type:'image/png'});
    },generationOptions:()=>({}),
    run:async action=>{
        busy=true;view.availability();
        try { return await action(new AbortController().signal);}
        finally {busy=false;view.availability();}
    },
    stage:dummy,status:dummy,confirm:async()=>true,uniqueId:()=> 'image-'+(++serial),
    download:(blob,name)=>{downloadCount++;assert.equal(blob.type,'image/png');assert.match(name,/page-1\.png$/);}
});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
view.bind();
await view.refresh();
assert.equal(field('comicEditor').hidden,true);
await field('comicPlan').onclick();
assert.equal(draftCalls,1);
assert.deepEqual(renderCalls,[]);
assert.equal(field('comicExport').disabled,true);
await assert.rejects(field('comicGenerate').onclick(),/429/);
assert.equal(current.value.panels.filter(panel=>panel.imageId).length,1);
assert.deepEqual(renderCalls,[0,1]);
failSecond=false;
await field('comicGenerate').onclick();
assert.deepEqual(renderCalls,[0,1,1,2]);
assert.equal(current.value.panels.filter(panel=>panel.imageId).length,3);
await field('comicExport').onclick();
assert.equal(downloadCount,1);
field('comicPanel').value='panel-2';
field('comicPanel').onchange();
const previous=current.value.panels[1].imageId;
await field('comicSingle').onclick();
assert.equal(current.value.panels[1].previousImageId,previous);
assert.deepEqual(renderCalls,[0,1,1,2,1]);
field('comicUndo').onclick();
await tick();
assert.equal(current.value.panels[1].imageId,previous);
field('comicAddLetter').onclick();
await tick();
assert.equal(current.value.panels[1].letters.length,2);
const textControl=field('comicLetters').children[1].children.find(node=>node.maxLength===60);
textControl.value='这里有风。';
await textControl.onchange();
assert.equal(current.value.panels[1].letters[1].text,'这里有风。');
assert.deepEqual(renderCalls,[0,1,1,2,1]);
field('comicEarlier').onclick();
await tick();
assert.equal(current.value.panels[0].id,'panel-2');
stillValid=false;
await assert.rejects(field('comicSingle').onclick(),/原楼层已变更/);
shownSource={...source,key:'edited-swipe'};
await view.refresh();
assert.equal(field('comicEditor').hidden,true);
assert.equal(keys.length,2);
assert(savedWrites.every((saved,index)=>saved.revision===index+1));
const markup=workshopPanel({euler:'Euler'});
for (const name of ['recipeList','recipeApply','recipeCompare','comicPage','comicSingle','comicExport','comicLetters']) {
    assert.equal(markup.split('data-field="'+name+'"').length,2,name);
}
console.log('PASS comic UI flow: confirmation, partial failure, resume, single redraw, undo, lettering, order, export and Swipe');
