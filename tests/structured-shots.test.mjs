import assert from 'node:assert/strict';
import {MODELS,planScene,makeImageRequest,generate,identityImageLimit} from '../src/api.js';
import {normalizeScenePlan} from '../src/planning.js';
import {withPassage,passageRanges,sourceAt} from '../src/scene.js';
import {suggestedIdentity} from '../src/identity.js';
import {preciseReferenceGeometry,prepareNaiPortrait,NAI_REFERENCE_DEFAULTS} from '../src/nai-reference.js';
import {workshopPanel} from '../src/panel.js';

const planBase = {base:'two people at a carved table',shot:{
    framing:'medium close shot',camera:'eye level, three-quarter view',layout:'two faces at opposing sides of the frame',
    focus:'the faces and the hands at the handoff',lighting:'warm lantern key light'
},negative:''};
const image = {type:'image/jpeg',data:'YWJj',blob:new Blob(['abc'],{type:'image/jpeg'})};
const references = [1,2,3].map(subject=>({subject,image,naiData:'cG5n'}));
const character = (id,side,depth,positive,outfit,extra={}) => ({
    id,side,depth,positive,outfit,pose:'upright posture',expression:'concentrating',gaze:'looking at hands',...extra
});
const oldText = '今汐穿着一件青色斗篷。';
const newText = '今汐脱下斗篷搭在椅背，换上灰外套。';
const firstCtx = {chatId:'shoot',characterId:1,chat:[{mes:oldText+'\n'+newText,name:'Narrator'}]};
const floor = sourceAt(firstCtx);
const excerpts = passageRanges(floor.visualText).map(range=>withPassage(floor,range));
const identity = {...suggestedIdentity('今汐'),type:'fan',imageToken:'jinhsi-fixture'};
const looks = [{id:'jinhsi_id',name:'今汐',identity,facts:{},items:[]}];
const routes = [
    {imageProtocol:'nai',imageModel:MODELS[0],imageProvider:'official'},
    {imageProtocol:'nai',imageModel:MODELS[1],imageProvider:'official'},
    {imageProtocol:'openai',imageModel:'gpt-image-2'},
    {imageProtocol:'gemini',imageModel:'gemini-nano-banana-2.1'},
    {imageProtocol:'grok',imageModel:'grok-imagine-image-2.0'}
].map(config=>({...config,visionBase:'https://vision.test/v1',visionModel:'template-sim',imageBase:'https://images.test/v1'}));
const handoff = {
    ...planBase,sourceQuote:'阿澄用左手递出铜杯',
    characters:[
        character('p1','left','foreground','short black hair, blue eyes','indigo coat',{pose:'left arm extended'}),
        character('p2','right','midground','long auburn hair, gray eyes','ivory cardigan',{pose:'right hand reaching'})
    ],
    interactions:[{actor:'p1',target:'p2',action:'extends a hand toward the recipient',response:'reaches with the right hand',
        object:'brass cup',holder:'p1',contact:'left hand supports the base'}]
};
const cast = {
    ...planBase,sourceQuote:'前景的阿澄让开',
    base:'three people in a rainlit corridor',shot:{...planBase.shot,framing:'wide shot',focus:'figures at three depths'},
    characters:[
        character('p1','left','foreground','short black hair','teal wrap'),
        character('p2','center','midground','golden braided hair','white tunic'),
        character('p3','right','background','red hair tied back','navy trench coat')
    ],interactions:[]
};
const handoffSource = {visualText:'阿澄用左手递出铜杯，邻座用右手去接。'};
const castSource = {visualText:'前景的阿澄让开，走廊中段的人停下，门边的人远远望来。'};
let fixture, captured;
globalThis.fetch = async (_,options) => {
    const payload = JSON.parse(options.body);
    captured = JSON.parse(payload.messages[1].content);
    assert.match(payload.messages[0].content,/unique id p1/);
    return Response.json({choices:[{message:{content:JSON.stringify(fixture)}}]});
};

for (const config of routes) {
    const requests = [];
        for (const [index,source] of excerpts.entries()) {
        const outfit = index === 0 ? 'green travel cloak' : 'tailored gray coat';
        fixture = {...planBase,base:'one woman near a chair',sourceQuote:source.selectedText,
            characters:[character('p1','center','foreground','pale silver eyes',outfit,{archiveId:'jinhsi_id',evidence:'今汐'})],
            interactions:index ? [{actor:'p1',target:'',action:'stands next to the chair',object:'green travel cloak',
                holder:'scene',contact:'the removed cloak rests on the chair back'}] : []};
        const plan = await planScene(config,'vision',source,looks);
        assert.equal(captured.selectedReply,source.selectedText);
        assert.doesNotMatch(captured.selectedReply,index === 0 ? /灰外套/ : /穿着一件/);
        assert.equal(plan.characters[0].drawIdentity.romanName,'Jinhsi');
        assert.equal(plan.characters[0].outfit,outfit);
        requests.push(makeImageRequest(config,plan,null,{seed:12}));
    }
    const [before,after] = requests;
    const promptFor = request => request.body.parameters?.characterPrompts?.[0]?.prompt ?? request.prompt;
    assert.match(promptFor(before),/green travel cloak/i);
    assert.match(promptFor(after),/tailored gray coat/i);
    if (config.imageProtocol === 'nai') assert.doesNotMatch(promptFor(after),/green travel cloak/);
    assert.match(after.prompt,/azur lane/i);

    fixture = handoff;
    const plan = await planScene(config,'vision',handoffSource,[]);
    const request = makeImageRequest(config,plan,null,{seed:12},references.slice(0,2));
    if (config.imageProtocol === 'nai') {
        const {parameters:p} = request.body;
        assert.equal(p.use_coords,true);
        assert.deepEqual(p.characterPrompts.map(role=>role.center.x),[0.3,0.7]);
        assert.match(p.characterPrompts[0].prompt,/extends a hand.*brass cup.*left hand/);
        assert.match(p.characterPrompts[1].prompt,/reaches with the right hand/);
        assert.doesNotMatch(p.characterPrompts[1].prompt,/brass cup|indigo coat/);
        assert.equal(p.director_reference_images,undefined);
    } else {
        assert.match(request.prompt,/Subject 1 extends a hand.*toward Subject 2/);
        assert.match(request.prompt,/Subject 2 reaches with the right hand/);
        assert.match(request.prompt,/brass cup \(held by Subject 1\)/);
        assert.match(request.prompt,/image 1 depicts subject 1; image 2 depicts subject 2/i);
        if (config.imageProtocol === 'gemini') assert.match(request.body.input[4].text,/subject 2/);
        if (config.imageProtocol === 'grok') assert.equal(request.body.images.length,2);
        if (config.imageProtocol === 'openai') assert.equal(request.body.getAll('image[]').length,2);
    }

    fixture = cast;
    const scene = await planScene(config,'vision',castSource,[]);
    const layers = makeImageRequest(config,scene,null,{seed:12});
    if (config.imageProtocol === 'nai') {
        assert.deepEqual(layers.body.parameters.characterPrompts.map(role=>role.center.x),[0.3,0.5,0.7]);
        assert.match(layers.body.parameters.characterPrompts[0].prompt,/foreground/);
        assert.match(layers.body.parameters.characterPrompts[1].prompt,/midground/);
        assert.match(layers.body.parameters.characterPrompts[2].prompt,/background/);
    } else assert.match(layers.prompt,/Subject 1 in the scene.*Depth: foreground.*Subject 2 in the scene.*Depth: midground.*Subject 3 in the scene.*Depth: background/s);
    console.log('PASS scene contract and wardrobe, handoff, and depth requests · ' + config.imageModel);
}

assert.throws(()=>normalizeScenePlan({...handoff,characters:[handoff.characters[0],handoff.characters[0]]},handoff.sourceQuote,6),/编号/);
assert.throws(()=>normalizeScenePlan({...handoff,interactions:[{...handoff.interactions[0],target:'p9'}]},handoff.sourceQuote,6),/互动关系/);
assert.throws(()=>normalizeScenePlan({...handoff,interactions:[{...handoff.interactions[0],holder:'p9'}]},handoff.sourceQuote,6),/道具归属/);
const single = normalizeScenePlan({...cast,characters:[cast.characters[0]]},cast.sourceQuote,6);
const team = normalizeScenePlan(handoff,handoff.sourceQuote,6);
for (const config of routes.slice(0,2)) {
    const enabled = {...config,naiReference:{...NAI_REFERENCE_DEFAULTS,enabled:true}};
    const off = makeImageRequest(config,single,null,{seed:42},references).body.parameters;
    const on = makeImageRequest(enabled,single,null,{seed:42},references).body.parameters;
    const {director_reference_images,director_reference_descriptions,director_reference_information_extracted,
        director_reference_strength_values,director_reference_secondary_strength_values,...common} = on;
    assert.deepEqual(common,off);
    assert.equal(common.stream,'msgpack');
    assert.equal(makeImageRequest(enabled,single,null,{seed:42},references).path,'/ai/generate-image-stream');
    const compatible = makeImageRequest({...enabled,imageProvider:'other'},single,null,{seed:42},references);
    assert.equal(compatible.path,'/ai/generate-image');
    assert.equal(compatible.body.parameters.stream,undefined);
    assert.deepEqual(director_reference_images,['cG5n']);
    assert.equal(director_reference_descriptions[0].caption.base_caption,'character');
    assert.deepEqual(director_reference_information_extracted,[1]);
    assert.deepEqual(director_reference_strength_values,[config.imageModel === MODELS[1] ? 1.25 : 0.6]);
    assert.deepEqual(director_reference_secondary_strength_values,[config.imageModel === MODELS[1] ? 0 : 0.6]);
    assert.equal(makeImageRequest(enabled,team,null,{seed:42},references).body.parameters.director_reference_images,undefined);
    assert.equal(makeImageRequest({...enabled,imageProvider:'other'},single,null,{seed:42},references).body.parameters.director_reference_images,undefined);
    console.log('PASS same seed and prompt, precise reference only on official eligible single-subject request · ' + config.imageModel);
}

assert.equal(identityImageLimit({imageProtocol:'gemini',imageModel:'gemini-3.1-flash-lite-image'},3),1);
assert.equal(identityImageLimit({imageProtocol:'grok',imageModel:'grok-imagine-image'},3),1);
assert.deepEqual(preciseReferenceGeometry(900,1350,false),{width:1024,height:1536,drawWidth:1024,drawHeight:1536,left:0,top:0});
assert.deepEqual(preciseReferenceGeometry(832,1216,true),{width:832,height:1216,drawWidth:832,drawHeight:1216,left:0,top:0});
const draws=[];
const host={URL:{createObjectURL:()=> 'blob:fixture',revokeObjectURL:url=>draws.push(url)},
    Image:class {naturalWidth=720;naturalHeight=1080;async decode(){}},
    document:{createElement:()=>({getContext:()=>({fillRect:(...a)=>draws.push(a),drawImage:()=>draws.push('draw')}),
        toDataURL(type){assert.equal(type,'image/png');return 'data:image/png;base64,ZmFrZQ==';}})}};
assert.equal(await prepareNaiPortrait(host,image.blob,false),'ZmFrZQ==');
assert.deepEqual(draws,[[0,0,1024,1536],'draw','blob:fixture']);
console.log('PASS image cap, canvas fitting and portrait PNG adapter');

for (const route of routes.slice(0,2)) {
    const config = {...route,naiReference:{...NAI_REFERENCE_DEFAULTS,enabled:true}};
    const request = makeImageRequest(config,single,null,{seed:42},references);
    let posts=0;
    globalThis.fetch = async (url,options) => {
        posts++;
        assert.match(url,/\/ai\/generate-image(?:-stream)?$/);
        assert.equal(JSON.parse(options.body).parameters.director_reference_images[0],'cG5n');
        return new Response('Reference path simulated refusal',{status:400});
    };
    await assert.rejects(generate(config,'key',request,new AbortController().signal,()=>{}),/HTTP 400/);
    assert.equal(posts,1);
}
const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+b9ioAAAAASUVORK5CYII=','base64'));
const prefix = Buffer.from([0x82,0xaa,...Buffer.from('event_type'),0xa5,...Buffer.from('final'),0xa5,...Buffer.from('image'),0xc4,png.length]);
const frame = Buffer.alloc(4 + prefix.length + png.length);
frame.writeUInt32BE(frame.length-4,0);
prefix.copy(frame,4);
frame.set(png,4+prefix.length);
globalThis.fetch = async (url,options) => {
    assert.match(url,/\/ai\/generate-image-stream$/);
    assert.equal(JSON.parse(options.body).parameters.stream,'msgpack');
    return new Response(frame,{headers:{'Content-Type':'application/octet-stream'}});
};
const streamConfig = routes[0];
const streamed = await generate(streamConfig,'key',makeImageRequest(streamConfig,single,null,{seed:42}),
    new AbortController().signal,()=>{});
assert.equal(streamed.type,'image/png');
console.log('PASS official MessagePack route reaches final PNG frame');
const markup=workshopPanel({euler:'Euler'});
for (const name of ['shotDetails','shotFields','shotActions','naiReferencePanel','naiReferenceEnabled','naiStrength5','naiFidelity45']) {
    assert.equal(markup.split('data-field="'+name+'"').length,2,name);
}
console.log('PASS adapter error makes one request and preserves editing and opt-in controls');
