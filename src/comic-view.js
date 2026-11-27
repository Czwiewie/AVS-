import {comicSpec, comicSourceKey, drawComicPage, comicLettering, COMIC_MAX_TEXTS, COMIC_TEXT_TYPES, COMIC_TEXT_ANCHORS} from './comics.js';

export function createComicView({host,field,library,isActive,busy,sceneSelection,matches,requestPlan,renderImage,
    generationOptions,run,stage,status,confirm,uniqueId,download}) {
    const {document,Option} = host;
    let session, readVersion = 0, paintVersion = 0;
    const selected = target => target?.record?.panels.find(panel => panel.id === target.panel);
    const specOf = record => comicSpec(record.layout,record.pages);
    const paneActive = target => isActive() && target === session;
    const readImage = (target,id) => target.pending.get(id) ?? library.getComicArt(id);
    const rangeFor = target => {
        const columns = specOf(target.record).cells.length;
        const start = target.page*columns;
        return {start,end:start+columns};
    };

    function availability() {
        const current = selected(session), locked = busy();
        const record = session?.record;
        field('comicPlan').disabled = locked || !session || session.loading;
        if (!record || !current) return;
        const {start,end} = rangeFor(session), index = record.panels.indexOf(current);
        for (const [name,inactive] of Object.entries({
            comicGenerate:record.panels.every(panel => panel.imageId),
            comicSingle:false, comicUndo:!current.previousImageId,
            comicEarlier:index <= start,comicLater:index >= end-1,
            comicAddLetter:current.letters.length >= COMIC_MAX_TEXTS,
            comicExport:record.panels.slice(start,end).some(panel=>!panel.imageId)
        })) field(name).disabled = locked || inactive;
    }

    async function paint(target) {
        if (!paneActive(target) || !target.record) return;
        const version = ++paintVersion;
        const page = target.page;
        const canvas = document.createElement('canvas');
        try {
            await drawComicPage(host,canvas,specOf(target.record),page,target.record.panels,id=>readImage(target,id));
            if (version !== paintVersion || !paneActive(target)) return;
            const displayed = field('comicCanvas');
            displayed.width = canvas.width;
            displayed.height = canvas.height;
            displayed.getContext('2d')?.drawImage(canvas,0,0);
        } catch(error) {
            if (version === paintVersion && paneActive(target)) field('comicWorkStatus').textContent = '预览失败 · ' + error.message;
        }
    }

    function rowsForLetters(target,panel) {
        const rows = field('comicLetters');
        rows.replaceChildren(...panel.letters.map((entry,index) => {
            const row = document.createElement('fieldset'), label = document.createElement('legend');
            row.className = 'studio-card studio-grid';
            label.textContent = '文字 ' + (index+1);
            row.append(label);
            for (const [key,choices,name] of [['type',COMIC_TEXT_TYPES,'类型'],['anchor',COMIC_TEXT_ANCHORS,'位置']]) {
                const wrapper = document.createElement('label'), control = document.createElement('select');
                wrapper.textContent = name;
                control.replaceChildren(...Object.entries(choices).map(([id,title])=>new Option(title,id)));
                control.value = entry[key];
                control.dataset.lock = ''; control.disabled = busy();
                control.onchange = () => editLetter(target,panel.id,index,{[key]:control.value});
                wrapper.append(control); row.append(wrapper);
            }
            const input = document.createElement('textarea'), remove = document.createElement('button');
            input.rows = 2; input.maxLength = 60; input.value = entry.text;
            input.setAttribute('aria-label','漫画文字内容');
            input.dataset.lock = ''; input.disabled = busy();
            input.onchange = () => editLetter(target,panel.id,index,{text:input.value});
            remove.type = 'button'; remove.textContent = '移除此条';
            remove.dataset.lock = ''; remove.disabled = busy();
            remove.onclick = () => void editPanel(target,panel.id,row => ({...row,letters:row.letters.filter((_,i)=>i!==index)}),true);
            row.append(input,remove);
            return row;
        }));
    }

    function render(target,updateEditor=true) {
        if (!paneActive(target)) return;
        const record = target.record, current = selected(target);
        field('comicEditor').hidden = !record || !current;
        if (!record || !current) { availability(); return; }
        const done = record.panels.filter(panel=>panel.imageId).length;
        const left = record.panels.length-done;
        field('comicTitle').textContent = record.title || '漫画分镜';
        field('comicWorkStatus').textContent = '已画 ' + done + ' / ' + record.panels.length + ' 格'
            + (target.unsaved ? ' · 本次修改暂存在当前工坊' : '');
        field('comicGenerate').textContent = done ? '继续生成未画分格 · ' + left + ' 张' : '确认分镜并生成 · ' + left + ' 张';
        field('comicGenerate').hidden = !left;
        field('comicSingle').textContent = current.imageId ? '重画这格' : '生成这格';
        field('comicUndo').hidden = !current.previousImageId;
        field('comicPage').replaceChildren(...Array.from({length:record.pages},(_,i)=>new Option('第 '+(i+1)+' 页',String(i))));
        field('comicPage').value = String(target.page);
        const {start,end} = rangeFor(target);
        field('comicPanel').replaceChildren(...record.panels.slice(start,end).map((panel,i) =>
            new Option('第 '+(start+i+1)+' 格'+(panel.imageId ? ' · 已画' : ''),panel.id)));
        field('comicPanel').value = target.panel;
        field('comicQuote').textContent = current.scene.sourceQuote;
        if (updateEditor) {
            field('comicScene').value = current.scene.base;
            field('comicFraming').value = current.scene.shot.framing;
            rowsForLetters(target,current);
        }
        availability();
        void paint(target);
    }

    async function refresh(reopen = false) {
        if (!isActive()) return;
        const request = ++readVersion;
        let source;
        try {
            source = sceneSelection();
            if (source.index === null) throw Error('请到「绘图」选择 AI 楼层或正文片段。');
        } catch(error) {
            session = null;
            field('comicSource').textContent = error.message;
            field('comicEditor').hidden = true;
            availability();
            return;
        }
        const key = comicSourceKey(source);
        field('comicSource').textContent = '第 ' + source.index + ' 楼 · ' + (source.passage ? '已指定片段' : '整条回复');
        if (session?.key === key && !(reopen && session.conflict) && !session.loading) {
            render(session,false);
            return;
        }
        const target = {key,source,record:null,revision:0,pending:new Map(),write:Promise.resolve(),page:0,panel:'',loading:true};
        session = target;
        field('comicEditor').hidden = true;
        availability();
        try {
            const stored = await library.getComic(key);
            if (request !== readVersion || !paneActive(target)) return;
            if (stored) {
                target.record = stored;
                target.revision = stored.revision;
                target.panel = stored.panels[0].id;
                field('comicLayout').value = stored.layout;
                field('comicPages').value = String(stored.pages);
            }
        } catch {
            if (request === readVersion && paneActive(target)) status('漫画本机存储暂不可用。本次生成的页面仍可下载。','warning');
        } finally {
            target.loading = false;
            if (request === readVersion) render(target);
        }
    }

    function save(target,update,images=[],updateEditor=true) {
        const advance = async () => {
            if (!matches(target.source)) throw Error('回复已变更，请重新打开漫画。');
            const next = update(target.record);
            for (const [id,blob] of images) target.pending.set(id,blob);
            if (!target.conflict) {
                try {
                    target.record = await library.commitComic(target.key,next,target.revision,target.pending);
                    target.revision = target.record.revision;
                    target.pending.clear();
                    target.unsaved = false;
                    render(target,updateEditor);
                    return;
                } catch(error) {
                    target.conflict = !!error.comicConflict;
                    if (target.conflict) status(error.message,'warning');
                }
            }
            target.record = next;
            target.unsaved = true;
            const retain = new Set(next.panels.flatMap(panel=>[panel.imageId,panel.previousImageId]));
            for (const id of target.pending.keys()) if (!retain.has(id)) target.pending.delete(id);
            render(target,updateEditor);
        };
        const write = target.write.then(advance);
        target.write = write.catch(error=>status(error.message,'warning'));
        return write;
    }

    function editPanel(target,id,edit,updateEditor=false) {
        return save(target,record=>({...record,panels:record.panels.map(panel=>panel.id===id ? edit(panel) : panel)}),[],updateEditor)
            .catch(()=>{});
    }
    function editLetter(target,id,index,changes) {
        return editPanel(target,id,panel=>({...panel,
            letters:comicLettering(panel.letters.map((letter,i)=>i===index ? {...letter,...changes} : letter))}));
    }

    async function createPlan(signal) {
        const target = session;
        if (!target || target.loading) throw Error('请先选择漫画的正文来源。');
        await target.write;
        const spec = comicSpec(field('comicLayout').value,field('comicPages').value);
        if (target.record?.panels.some(panel=>panel.imageId) &&
            !await confirm('重新规划会用新分镜替换这份漫画草稿及画格。已经下载的页面可以继续使用。',{title:'重新规划漫画',accept:'重新规划'})) return;
        const source = sceneSelection();
        if (comicSourceKey(source) !== target.key) throw Error('正文已变更，请重新选择。');
        const record = await requestPlan(source,spec,signal);
        signal.throwIfAborted();
        target.page = 0;
        target.panel = record.panels[0].id;
        await save(target,()=>record);
        if (!target.unsaved) status('分镜已就绪，确认后开始出图。','success');
    }

    async function drawPanels(signal,single) {
        const target = session;
        if (!target?.record) throw Error('请先生成分镜草稿。');
        await target.write;
        const record = target.record, spec = specOf(record);
        const indices = single ? [record.panels.findIndex(panel=>panel.id===target.panel)] :
            record.panels.flatMap((panel,index)=>panel.imageId ? [] : [index]);
        if (!indices.length || indices[0]<0) return;
        const options = generationOptions();
        for (const [position,index] of indices.entries()) {
            signal.throwIfAborted();
            if (!matches(target.source)) throw Error('原楼层已变更，其余画格已停止。');
            const panel = record.panels[index];
            stage('生成第 '+(index+1)+' 格',position,indices.length);
            const blob = await renderImage(panel,spec.cells[index%spec.cells.length],index,options,signal);
            if (!matches(target.source)) throw Error('原楼层已变更，回图未写入其他楼层。');
            const id = uniqueId();
            await save(target,current=>({...current,panels:current.panels.map(cell=>cell.id===panel.id ?
                {...cell,imageId:id,previousImageId:cell.imageId} : cell)}),[[id,blob]],false);
            signal.throwIfAborted();
        }
        status('已完成 '+indices.length+' 格。'+(target.unsaved ? '本次修改暂存在当前工坊，可下载已完成页面。' : ''),'success');
    }

    async function exportPage(signal) {
        const target = session;
        if (!target?.record) return;
        await target.write;
        stage('排版并导出漫画页');
        const canvas = document.createElement('canvas');
        await drawComicPage(host,canvas,specOf(target.record),target.page,target.record.panels,id=>readImage(target,id),true);
        const blob = await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
        signal.throwIfAborted();
        if (!blob) throw Error('浏览器未能导出 PNG。');
        download(blob,'AVS-comic-'+target.source.index+'-page-'+(target.page+1)+'.png');
        status('已发起漫画页下载。','success');
    }

    function reorder(offset) {
        const target = session, current = selected(target);
        if (!current) return;
        const {start,end} = rangeFor(target);
        void save(target,record=>{
            const panels = [...record.panels], i = panels.findIndex(panel=>panel.id===current.id), next = i+offset;
            if (next >= start && next < end) [panels[i],panels[next]] = [panels[next],panels[i]];
            return {...record,panels};
        }).catch(()=>{});
    }

    function bind() {
        field('comicPlan').onclick = () => run(createPlan);
        field('comicGenerate').onclick = () => run(signal=>drawPanels(signal,false));
        field('comicSingle').onclick = () => run(signal=>drawPanels(signal,true));
        field('comicExport').onclick = () => run(exportPage);
        field('comicPage').onchange = () => {
            const target = session;
            target.page = Number(field('comicPage').value);
            target.panel = target.record.panels[rangeFor(target).start].id;
            render(target);
        };
        field('comicPanel').onchange = () => { session.panel=field('comicPanel').value; render(session); };
        field('comicScene').onchange = () => {
            const target = session, panel = selected(target), base = field('comicScene').value.trim();
            if (!base) { field('comicScene').value = panel.scene.base; return; }
            void editPanel(target,panel.id,entry=>({...entry,scene:{...entry.scene,base}}));
        };
        field('comicFraming').onchange = () => {
            const target = session, panel = selected(target), framing = field('comicFraming').value.trim();
            if (!framing) { field('comicFraming').value = panel.scene.shot.framing; return; }
            void editPanel(target,panel.id,entry=>({...entry,scene:{...entry.scene,shot:{...entry.scene.shot,framing}}}));
        };
        field('comicAddLetter').onclick = () => {
            const target = session, panel = selected(target);
            void editPanel(target,panel.id,entry=>entry.letters.length >= COMIC_MAX_TEXTS ? entry :
                {...entry,letters:[...entry.letters,{type:'dialogue',anchor:'tl',text:''}]},true);
        };
        field('comicUndo').onclick = () => {
            const target = session, panel = selected(target);
            if (panel.previousImageId) void editPanel(target,panel.id,entry=>({...entry,
                imageId:entry.previousImageId,previousImageId:entry.imageId}),false);
        };
        field('comicEarlier').onclick = () => reorder(-1);
        field('comicLater').onclick = () => reorder(1);
    }
    return {bind,refresh,availability};
}
