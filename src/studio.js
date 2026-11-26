import {sourceAt, prose, optionalLooks, priorContext} from './scene.js';
import {MODELS, MODEL_NAMES, OFFICIAL_NAI, IMAGE_PATHS, STYLE_FIELDS, SAMPLERS, DRAW_DEFAULTS, knownNaiModel, endpoint, extractStyle, planScene, generate, drawOptions, finishPrompt, makeImageBody, availableModels} from './api.js';
import {pictureLibrary} from './library.js';
import {createAcademyFeedback} from './theme.js';
import {chatPresetManager, presetNames, visionPreset} from './presets.js';
import {workshopPanel, CANVASES} from './panel.js';

export function installStudio(host, owner, kind, css) {
    const {document, Option, MutationObserver, Image, URL} = host;
    const slot = '__AVS_ILLUSTRATION_STUDIO__', legacy = '__AVS_VISUAL_WORKSHOP_R2__', version = '1.2.4';
    const existing = host[slot];
    if (existing) {
        const order = version.localeCompare(existing.version ?? '', 'en', {numeric:true});
        if (order < 0 || (order === 0 && (existing.kind === 'extension' || existing.owner === owner))) return existing;
    }
    existing?.dispose();
    const previousBridge = host[legacy];
    const listeners = [];
    const localStyle = css ? document.createElement('style') : null;
    if (localStyle) { localStyle.textContent = css; document.head.append(localStyle); }
    const viewportStyle = document.createElement('style');
    document.head.append(viewportStyle);
    const viewport = host.visualViewport;
    function syncDialogViewport() {
        const width = viewport?.width || host.innerWidth;
        const height = viewport?.height || host.innerHeight;
        viewportStyle.textContent = ':root {'
            + '--avs-visible-top:' + (viewport?.offsetTop ?? 0) + 'px;'
            + '--avs-visible-left:' + (viewport?.offsetLeft ?? 0) + 'px;'
            + '--avs-visible-width:' + width + 'px;'
            + '--avs-visible-height:' + height + 'px;}';
    }
    syncDialogViewport();
    host.addEventListener('resize', syncDialogViewport);
    for (const name of ['resize','scroll']) viewport?.addEventListener(name, syncDialogViewport);
    listeners.push(() => {
        host.removeEventListener('resize', syncDialogViewport);
        for (const name of ['resize','scroll']) viewport?.removeEventListener(name, syncDialogViewport);
        viewportStyle.remove();
    });
    const id = 'avs-illustration-studio';
    const defaults = {visionBase:'https://api.openai.com/v1', visionModel:'', naiBase:OFFICIAL_NAI,
        naiModel:MODELS[0], imageProvider:'official', otherProtocol:'openai', otherBase:'', otherModel:'', otherSize:'auto'};
    const styleNames = {line:'线条', color:'色彩', light:'光影', rendering:'渲染', composition:'构图'};
    const builtInPresets = [
        {id:'portrait', name:'剧情竖幅', draw:{width:832,height:1216}},
        {id:'landscape', name:'宽幅场景', draw:{width:1344,height:768}},
        {id:'draft', name:'快速构图', draw:{width:768,height:768,steps:16}},
    ];
    const pictures = pictureLibrary(host, id);
    const feedback = createAcademyFeedback(host);
    const uniqueId = () => host.crypto.randomUUID?.() ?? Array.from(host.crypto.getRandomValues(new Uint32Array(4)), n => n.toString(16).padStart(8,'0')).join('');
    const temporaryPictures = new Map();
    let dialog, observer, entry, job, phase, activePage = 'draw', disposed = false, refreshVersion = 0;
    let previewUrl, historyUrl, detail, rows = [], draftAnchor = null;
    const thumbnailUrls = [];
    const field = key => dialog.querySelector('[data-field="' + key + '"]');
    const text = key => field(key).value.trim();
    const checked = key => field(key).checked;
    const settings = () => (context().extensionSettings[id] ??= {...defaults});
    const save = () => context().saveSettingsDebounced();
    const setStatus = (message, level = 'info') => {
        field('status').textContent = message;
        field('status').dataset.level = level;
    };
    function context() {
        const current = host.SillyTavern?.getContext?.();
        if (!current) throw Error('酒馆页面尚未就绪，请等待聊天加载。');
        return current;
    }
    function notify(message, type = 'success') {
        setStatus(message, type);
        if (checked('toasts')) feedback.notice(message, type, 'AVS 视觉工坊');
    }
    function stage(name, complete = null, total = 1) {
        phase = name;
        field('progressBox').hidden = false;
        field('progressText').textContent = name;
        field('progress').max = total;
        if (complete === null) field('progress').removeAttribute('value');
        else field('progress').value = complete;
    }

    function keyStorage(storageName) {
        const fallback = new Map();
        return {
            get(key) { try { return host[storageName].getItem(key) ?? fallback.get(key); } catch { return fallback.get(key); } },
            set(key, value) {
                try {
                    if (value) host[storageName].setItem(key, value);
                    else host[storageName].removeItem(key);
                    fallback.delete(key);
                } catch {
                    if (value) fallback.set(key, value);
                    else fallback.delete(key);
                }
            }
        };
    }
    const sessionKeys = keyStorage('sessionStorage'), rememberedKeys = keyStorage('localStorage');
    const keyId = (kind, url) => id + '|' + kind + '|' + url.trim();
    function readKey(kind, url) {
        const name = keyId(kind, url);
        return sessionKeys.get(name) || rememberedKeys.get(name) || '';
    }
    function writeKey(kind, url, key) {
        const name = keyId(kind, url);
        sessionKeys.set(name,key);
        rememberedKeys.set(name,checked('remember') ? key : '');
    }
    function migrateImageConnection(stored) {
        if (stored.imageProvider || !stored.naiBase) return;
        let official = false;
        try { official = new URL(stored.naiBase).origin === OFFICIAL_NAI; } catch { /* Keep the prior address for editing. */ }
        if (stored.naiBase === OFFICIAL_NAI) return;
        const old = keyId('nai',stored.naiBase);
        if (!official) {
            stored.imageProvider = 'other';
            stored.otherProtocol = 'nai';
            stored.otherBase = stored.naiBase;
            stored.otherModel = stored.naiModel || MODELS[0];
        }
        const next = official ? keyId('nai', OFFICIAL_NAI) : keyId('other', stored.otherBase);
        if (!sessionKeys.get(next)) sessionKeys.set(next, sessionKeys.get(old) || '');
        if (!rememberedKeys.get(next)) rememberedKeys.set(next, rememberedKeys.get(old) || '');
        stored.naiBase = OFFICIAL_NAI;
        save();
    }
    function currentProtocol() {
        return text('imageProvider') === 'official' ? 'nai' : text('otherProtocol');
    }
    function thirdPartyNaiModel() {
        if (text('imageProvider') === 'other') return knownNaiModel(text('otherModel'));
    }
    function selectedNaiModel() {
        return thirdPartyNaiModel() ?? text('naiModel');
    }
    function selectNaiModel(model) {
        if (!MODELS.includes(model) || model === selectedNaiModel()) return;
        const stored = settings();
        if (thirdPartyNaiModel()) {
            field('otherModel').value = model;
            if (stored.imageProvider === 'other' && stored.otherBase === text('otherBase') &&
                stored.otherProtocol === currentProtocol()) stored.otherModel = model;
        } else {
            field('naiModel').value = model;
            stored.naiModel = model;
        }
        save();
        syncImageFields();
    }
    function syncImageFields() {
        const other = text('imageProvider') === 'other';
        const generic = other && currentProtocol() === 'openai';
        const explicitModel = thirdPartyNaiModel();
        field('officialConnection').hidden = other;
        field('otherConnection').hidden = !other;
        field('otherSizeRow').hidden = !generic;
        field('naiModelRow').hidden = generic && !explicitModel;
        field('naiModelLabel').textContent = other && !explicitModel ? 'NovelAI 参数格式' : '生图模型';
        const selected = selectedNaiModel();
        for (const button of dialog.querySelectorAll('[data-nai-model]')) {
            button.setAttribute('aria-pressed', String(button.dataset.naiModel === selected));
        }
        field('canvasRow').hidden = generic;
        field('seedRow').hidden = generic;
        for (const detail of dialog.querySelectorAll('[data-nai-only]')) detail.hidden = generic;
        field('otherDraw').hidden = !other;
        field('otherDraw').textContent = other
            ? '其它生图 API · ' + (text('otherModel') || '请在连接页选择模型') +
                (generic ? ' · 画幅：' + (text('otherSize') === 'auto' ? '自动' : text('otherSize')) : '')
            : '';
        drawLabels();
    }
    function readConnections({vision = false, image = false, persist = false} = {}) {
        const stored = settings();
        const connection = Object.fromEntries(Object.keys(defaults).map(key => [key, text(key)]));
        const other = connection.imageProvider === 'other';
        connection.visionKey = text('visionKey');
        connection.naiKey = text('naiKey');
        connection.otherKey = text('otherKey');
        connection.imageProtocol = currentProtocol();
        connection.imageBase = other ? connection.otherBase : OFFICIAL_NAI;
        connection.imageKey = other ? connection.otherKey : connection.naiKey;
        connection.imageModel = other ? connection.otherModel : connection.naiModel;
        if (vision || (persist && connection.visionBase)) endpoint(connection.visionBase,'/chat/completions');
        if (image || (persist && connection.imageBase)) endpoint(connection.imageBase,IMAGE_PATHS[connection.imageProtocol]);
        if (vision && checked('useVisionPreset')) {
            const ctx = context();
            connection.promptPreset = visionPreset(chatPresetManager(ctx), text('visionPresetName'), ctx);
        }
        if (persist) {
            for (const kind of ['vision','nai','other']) {
                const base = kind + 'Base';
                const oldKey = keyId(kind, stored[base] || defaults[base]);
                if (oldKey !== keyId(kind,connection[base])) {
                    sessionKeys.set(oldKey,''); rememberedKeys.set(oldKey,'');
                }
                writeKey(kind,connection[base],connection[kind + 'Key']);
            }
            for (const key of Object.keys(defaults)) stored[key] = connection[key];
            stored.preferences = {contextCount:Number(text('contextCount')), useArchive:checked('useArchive'), toasts:checked('toasts')};
            stored.useVisionPreset = checked('useVisionPreset');
            stored.visionPresetName = text('visionPresetName');
            save();
        }
        connection.naiModel = selectedNaiModel();
        return connection;
    }
    async function chooseVisionPreset() {
        const choices = presetNames(chatPresetManager(context()));
        if (!choices.length) throw Error('酒馆暂未提供可读的对话补全预设。');
        const name = await feedback.choose('选择对话补全预设',choices,text('visionPresetName'));
        if (name === null || disposed) return;
        field('visionPresetName').value = name;
        settings().visionPresetName = name;
        settings().useVisionPreset = true;
        save();
        setStatus('已使用预设：' + name);
    }
    function savedStyles() {
        const saved = settings();
        if (!Array.isArray(saved.styles)) {
            saved.styles = saved.style ? [{id:'previous', name:saved.styleName || '之前的参考画风', ...saved.style}] : [];
            saved.selectedStyle = saved.styles[0]?.id || '';
            save();
        }
        return saved.styles;
    }
    function activeStyle() { return savedStyles().find(style => style.id === settings().selectedStyle); }
    function populateStyles() {
        const styles = savedStyles(), selected = activeStyle();
        const options = [new Option('不叠加画风',''), ...styles.map(style => new Option(style.name, style.id))];
        field('styles').replaceChildren(...options);
        field('styles').value = selected?.id || '';
        field('styleName').value = selected?.name || '';
        field('stylePositive').value = selected?.positive || '';
        field('styleNegative').value = selected?.negative || '';
        field('styleUpdate').disabled = !selected || !!job;
        field('styleRemove').disabled = !selected || !!job;
        for (const key of STYLE_FIELDS) field('style-' + key).value = selected?.[key] || '';
        field('styleLink').textContent = selected ? '画风 · ' + selected.name : '选择或上传画风';
    }
    function addStyle(style, replace) {
        const saved = settings(), list = savedStyles();
        const previous = replace ? activeStyle() : null;
        const row = {...style, id:previous?.id || uniqueId()};
        const index = list.indexOf(previous);
        if (index >= 0) list[index] = row;
        else list.push(row);
        saved.selectedStyle = row.id;
        save();
        populateStyles();
    }
    function saveStyle(replace) {
        const name = text('styleName'), positive = text('stylePositive'), negative = text('styleNegative');
        const traits = Object.fromEntries(STYLE_FIELDS.map(key => [key, text('style-' + key)]));
        if (!name || ![positive, negative, ...Object.values(traits)].some(Boolean)) {
            throw Error('请为画风命名，并填写至少一项美术特征或提示词。');
        }
        addStyle({name, ...traits, positive, negative}, replace);
        notify(replace ? '已更新画风。' : '已保存新画风。');
    }

    function readDraw() {
        const values = Object.fromEntries(Object.keys(DRAW_DEFAULTS).map(key => [key,text(key)]));
        return {...drawOptions(values), quality:checked('quality')};
    }
    function drawLabels() {
        for (const key of ['steps','scale','rescale']) field(key + 'Out').textContent = text(key);
        const custom = currentProtocol() !== 'openai' && field('canvas').value === 'custom';
        field('widthGroup').hidden = !custom;
        field('heightGroup').hidden = !custom;
    }
    function setDraw(draw = {}) {
        const values = {...DRAW_DEFAULTS, ...draw};
        for (const [key,value] of Object.entries(DRAW_DEFAULTS)) field(key).value = values[key] ?? value;
        field('quality').checked = !!values.quality;
        const size = text('width') + 'x' + text('height');
        field('canvas').value = Object.hasOwn(CANVASES, size) ? size : 'custom';
        drawLabels();
    }
    function saveDraw() {
        settings().draw = readDraw();
        settings().naiModel = text('naiModel');
        save();
    }
    function drawingPresets() {
        return [...builtInPresets, ...(settings().drawingPresets ?? [])];
    }
    function populateDrawPresets(selected = field('drawPreset').value) {
        const presets = drawingPresets();
        const select = field('drawPreset');
        select.replaceChildren(...presets.map(preset => new Option(preset.name, preset.id)));
        select.value = presets.find(preset => preset.id === selected)?.id ?? presets[0].id;
        field('presetDelete').disabled = !!job || builtInPresets.some(preset => preset.id === select.value);
    }
    function storeDrawPreset() {
        const name = text('presetName');
        if (!name) throw Error('请输入自定义预设名称。');
        const saved = settings();
        const row = {id:uniqueId(), name, draw:readDraw(), model:selectedNaiModel()};
        saved.drawingPresets = [...(saved.drawingPresets ?? []), row];
        save();
        populateDrawPresets(row.id);
        field('presetName').value = '';
        notify('已保存绘图预设「' + name + '」。');
    }
    function applyDrawPreset() {
        const row = drawingPresets().find(preset => preset.id === text('drawPreset'));
        if (!row) return;
        if (row.model) selectNaiModel(row.model);
        setDraw(row.draw);
        saveDraw();
        setStatus('已应用绘图预设「' + row.name + '」。');
    }
    async function deleteDrawPreset() {
        const saved = settings();
        const row = saved.drawingPresets?.find(preset => preset.id === text('drawPreset'));
        if (!row || !(await feedback.confirm('删除绘图预设「' + row.name + '」？', {title:'删除绘图预设',accept:'删除',danger:true}))) return;
        saved.drawingPresets = saved.drawingPresets.filter(preset => preset.id !== row.id);
        save();
        populateDrawPresets();
        setStatus('已删除绘图预设。');
    }

    function selectedSource() {
        if (text('mode') === 'manual') return {key:'manual', text:'', index:null};
        return sourceAt(context(), text('floor') || 'latest');
    }
    function matches(source) {
        try {
            const current = source.index === null ? selectedSource() : sourceAt(context(), source.index);
            return current.key === source.key && current.text === source.text;
        } catch { return false; }
    }
    function isSelected(source) {
        try {
            const current = selectedSource();
            return current.key === source.key && current.text === source.text;
        } catch { return false; }
    }
    function floorLabel(index) { return index === null ? '手写提示词' : '第 ' + index + ' 楼'; }
    function portraitFile(row) { return 'AVS-' + (row.index ?? 'manual') + '-' + (row.seed ?? 'original') + '.' + row.blob.type.split('/')[1]; }

    function modelLabel(model) { return MODEL_NAMES[knownNaiModel(model)] ?? model; }
    function pictureLabel(row) {
        return row.model ? [
            modelLabel(row.model), (row.resultSize?.width ?? row.draw.width) + '×' + (row.resultSize?.height ?? row.draw.height), row.seed == null ? '' : '种子 ' + row.seed, row.styleName
        ].filter(Boolean).join(' · ') : '旧版预览';
    }
    function paintPreview(row, history = false) {
        const url = history ? historyUrl : previewUrl;
        if (url) URL.revokeObjectURL(url);
        const next = row?.blob ? URL.createObjectURL(row.blob) : null;
        if (history) historyUrl = next;
        else previewUrl = next;
        const holder = field(history ? 'historyDetail' : 'result');
        const image = field(history ? 'historyImage' : 'image');
        const link = field(history ? 'historyDownload' : 'download');
        holder.hidden = !next;
        if (!next) {
            image.removeAttribute('src'); link.removeAttribute('href'); return;
        }
        image.src = next;
        link.href = next;
        link.download = portraitFile(row);
        field(history ? 'historyMeta' : 'caption').textContent = floorLabel(row.index) + ' · ' + pictureLabel(row);
    }
    function clearThumbnails() {
        for (const url of thumbnailUrls.splice(0)) URL.revokeObjectURL(url);
    }
    function renderHistory() {
        if (activePage !== 'gallery') return;
        clearThumbnails();
        field('historyLabel').textContent = rows.length ? '最近 ' + rows.length + ' 张 · 点击查看或载入参数' : '此画面还没有保存的插画。';
        const cards = rows.map((row,index) => {
            const button = document.createElement('button');
            button.type = 'button';
            const thumb = document.createElement('img'), label = document.createElement('span');
            thumb.alt = ''; thumb.loading = 'lazy';
            const url = URL.createObjectURL(row.blob); thumbnailUrls.push(url); thumb.src = url;
            label.textContent = row.date ? (row.seed == null ? '图 ' + (index+1) : '种子 ' + row.seed) : '旧版预览';
            button.title = row.date ? new Date(row.date).toLocaleString() : '旧版预览';
            button.append(thumb,label);
            button.onclick = () => inspect(row);
            return button;
        });
        field('history').replaceChildren(...cards);
        inspect(detail && rows.includes(detail) ? detail : rows[0]);
        refreshComparison();
    }
    function refreshComparison() {
        const box = field('compareBox');
        box.hidden = rows.length < 2;
        for (const [position, defaultIndex] of [['Left',0], ['Right',1]]) {
            const select = field('compare' + position);
            const selection = select.selectedOptions[0]?.dataset.generation;
            if (box.hidden) {
                select.replaceChildren();
                field('compare' + position + 'Image').removeAttribute('src');
                continue;
            }
            const options = rows.map((row, index) => {
                const option = new Option('图 ' + (index + 1) + ' · ' + pictureLabel(row), String(index));
                option.dataset.generation = row.id ?? 'legacy';
                return option;
            });
            select.replaceChildren(...options);
            select.value = options.find(option => option.dataset.generation === selection)?.value ?? String(defaultIndex);
            renderComparison(position);
        }
    }
    function renderComparison(position) {
        const index = Number(field('compare' + position).value);
        const row = rows[index];
        if (!thumbnailUrls[index] || !row) return;
        field('compare' + position + 'Image').src = thumbnailUrls[index];
        field('compare' + position + 'Caption').textContent = pictureLabel(row);
    }
    function inspect(row) {
        detail = row;
        paintPreview(row, true);
        field('reuse').hidden = !row?.plan;
        field('removeImage').hidden = !row?.id;
        const box = field('metadataBox');
        box.hidden = !row?.plan;
        if (box.hidden) return;
        const params = row.imageProtocol === 'openai' ? [['接口','OpenAI 兼容'], ['请求画幅',row.otherSize]] : [
            ['采样器',SAMPLERS[row.draw.sampler]], ['步数',row.draw.steps],
            ['引导强度',row.draw.scale], ['CFG Rescale',row.draw.rescale],
            ['自动质量标签',row.draw.quality ? '开启' : '关闭']
        ];
        const cells = params.flatMap(([label, value]) => {
            const name = document.createElement('dt'), cell = document.createElement('dd');
            name.textContent = label;
            cell.textContent = value ?? '—';
            return [name, cell];
        });
        field('metadataValues').replaceChildren(...cells);
        const prompts = ['正面提示词', row.plan.base, '负面提示词', row.plan.negative || '—'];
        for (const [i, role] of row.plan.characters.entries()) {
            prompts.push('人物 ' + (i + 1), role.positive, '人物负面提示词', role.negative || '—');
        }
        field('metadataPrompt').textContent = prompts.join('\n');
    }
    async function refresh(reset = false) {
        if (!dialog?.open) return;
        const latestRequest = ++refreshVersion, select = field('floor');
        const chat = context().chat || [], prior = reset ? 'latest' : (select.value || 'latest');
        const options = [new Option('最新 AI 回复','latest')];
        for (let i=chat.length-1; i>=0; i--) {
            const body = prose(chat[i]);
            if (body) options.push(new Option('#' + i + ' · ' + body.replace(/\s+/g,' ').slice(0,42), String(i)));
        }
        select.replaceChildren(...options);
        select.value = options.some(item => item.value === prior) ? prior : 'latest';
        const manual = text('mode') === 'manual';
        field('floorGroup').hidden = manual;
        field('focusGroup').hidden = manual;
        field('plan').hidden = manual;
        let source;
        paintPreview(null); rows = []; detail = null; renderHistory();
        try {
            source = selectedSource();
            field('excerpt').textContent = manual ? '可直接填写场景、负面词和人物分栏。' :
                '#' + source.index + ' · ' + source.text.replace(/\s+/g, ' ').slice(0,160);
        } catch(error) {
            field('excerpt').textContent = error.message;
            return;
        }
        let saved = [];
        try { saved = await pictures.list(source); }
        catch { if (!job && latestRequest === refreshVersion) setStatus('本机图库暂不可用，仍可下载生成的原图。','warning'); }
        if (latestRequest !== refreshVersion || !dialog.open || !isSelected(source)) return;
        rows = [...(temporaryPictures.get(source.key) || []).filter(row => row.text === source.text), ...saved].slice(0,30);
        paintPreview(rows[0]); renderHistory();
    }
    function go(page) {
        activePage = page;
        for (const element of dialog.querySelectorAll('[data-page]')) element.hidden = element.dataset.page !== page;
        for (const button of dialog.querySelectorAll('[data-tab]')) button.setAttribute('aria-pressed', String(button.dataset.tab === page));
        const scroll = field('scroll'); scroll.scrollTop = 0;
        if (page === 'gallery') renderHistory();
        if (page !== 'gallery') { clearThumbnails(); if (historyUrl) paintPreview(null,true); }
    }

    function addRole(role = {}) {
        const count = field('roles').children.length, limit = currentProtocol() !== 'openai' && selectedNaiModel() === MODELS[0] ? 6 : 22;
        if (count >= limit) throw Error('当前模型最多支持 ' + limit + ' 个独立人物提示词。');
        const card = document.createElement('fieldset');
        card.className = 'studio-role studio-stack';
        card.innerHTML = `<legend>人物提示词</legend><label>人物正面词<textarea rows="2" data-role="positive" data-lock></textarea></label>
            <label>人物负面词<textarea rows="2" data-role="negative" data-lock></textarea></label>
            <button type="button" data-lock>移除此人物</button>`;
        for (const key of ['positive','negative']) card.querySelector('[data-role="'+key+'"]').value = role[key] || '';
        card.querySelector('button').onclick = () => card.remove();
        field('roles').append(card);
        if (job) for (const node of card.querySelectorAll('[data-lock]')) node.disabled = true;
    }
    function setDraft(plan, source = null, applyStyle = true) {
        draftAnchor = source;
        field('positive').value = plan.base;
        field('negative').value = plan.negative || '';
        field('roles').replaceChildren();
        for (const role of plan.characters) addRole(role);
        field('applyStyle').checked = applyStyle;
        field('draftSource').textContent = source ? '草稿来源 · ' + floorLabel(source.index) : '可直接填写，或从所选 AI 楼层提取再编辑。';
    }
    function getDraft() {
        const characters = Array.from(field('roles').children, card => ({
            positive:card.querySelector('[data-role="positive"]').value.trim(),
            negative:card.querySelector('[data-role="negative"]').value.trim()
        })).filter(role => role.positive || role.negative);
        if (characters.some(role => !role.positive)) throw Error('有人物分栏只填了负面词，请补上人物正面词。');
        return {base:text('positive'), negative:text('negative'), characters};
    }
    async function copyPrompt() {
        const draft = getDraft(), style = checked('applyStyle') ? activeStyle() : null;
        const value = JSON.stringify({
            ...draft, base:finishPrompt(draft,style),
            negative:[draft.negative,style?.negative].filter(Boolean).join(', ')
        }, null, 2);
        if (host.navigator.clipboard?.writeText) await host.navigator.clipboard.writeText(value);
        else {
            const box = document.createElement('textarea');
            box.value = value; dialog.append(box); box.select();
            try { if (!document.execCommand('copy')) throw Error('浏览器未授予复制权限。'); }
            finally { box.remove(); }
        }
        setStatus('已复制正负面词和人物分栏。');
    }
    function loadHistory() {
        if (!detail?.plan) return;
        const source = selectedSource();
        const {model, plan, draw, seed} = detail;
        field('imageProvider').value = detail.imageProvider || 'official';
        if (detail.imageProvider === 'other') {
            field('otherModel').value = model;
            field('otherProtocol').value = detail.imageProtocol;
            field('otherSize').value = detail.otherSize || 'auto';
        }
        field('naiModel').value = knownNaiModel(detail.naiModel) ?? knownNaiModel(model) ?? MODELS[0];
        setDraw({...draw, seed, count:1}); saveDraw();
        syncImageFields();
        setDraft(plan, source.index === null ? null : source, false);
        go('prompts');
        setStatus('已载入当时的提示词、参数与种子。');
    }
    async function removeHistory() {
        const record = detail;
        if (!record?.id || !(await feedback.confirm('删除这张本机历史图片？', {title:'删除历史插画',accept:'删除',danger:true}))) return;
        const temporary = temporaryPictures.get(record.source) ?? [];
        if (temporary.some(row => row.id === record.id)) {
            temporaryPictures.set(record.source, temporary.filter(row => row.id !== record.id));
        } else await pictures.drop(record.id);
        await refresh();
        setStatus('已删除选中记录。');
    }
    async function raster(file) {
        const url = URL.createObjectURL(file);
        try {
            const img = new Image(); img.src = url; await img.decode();
            const scale = Math.min(1, 1280 / Math.max(img.naturalWidth,img.naturalHeight));
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1,Math.round(img.naturalWidth * scale));
            canvas.height = Math.max(1,Math.round(img.naturalHeight * scale));
            const draw = canvas.getContext('2d'); draw.fillStyle = 'white';
            draw.fillRect(0,0,canvas.width,canvas.height); draw.drawImage(img,0,0,canvas.width,canvas.height);
            return canvas.toDataURL('image/jpeg',0.92);
        } finally { URL.revokeObjectURL(url); }
    }
    function lock(value) {
        for (const element of dialog.querySelectorAll('[data-lock]')) element.disabled = value;
        field('cancel').hidden = !value;
        if (!value) {
            field('styleRemove').disabled = !activeStyle();
            field('styleUpdate').disabled = !activeStyle();
            field('presetDelete').disabled = builtInPresets.some(preset => preset.id === text('drawPreset'));
        }
    }
    async function run(action) {
        if (job) return;
        job = new AbortController();
        lock(true);
        setStatus('');
        try {
            stage('读取设置');
            await action(job.signal);
        } catch(error) {
            if (!disposed) {
                if (job.signal.aborted) setStatus('已取消等待。此前已完成的图片保留。', 'warning');
                else notify(phase + '失败 · ' + error.message, 'error');
            }
        } finally {
            job = null;
            if (!disposed) { lock(false); field('progressBox').hidden = true; }
        }
    }
    async function analyze(file, signal) {
        const connection = readConnections({vision:true});
        if (!connection.visionModel || !connection.visionKey) throw Error('请在「连接」中填写视觉模型与密钥。');
        stage('读取参考图');
        const data = await raster(file);
        signal.throwIfAborted();
        stage('等待视觉模型提取画风');
        const extracted = await extractStyle(connection,connection.visionKey,data,signal);
        signal.throwIfAborted();
        const name = file.name.replace(/\.[^.]+$/, '').slice(0,70) || '参考图画风';
        addStyle({name,...extracted}, false);
        notify('已新建画风「' + name + '」。');
    }
    async function listModels(signal, kind = 'vision') {
        const modelField = kind + 'Model';
        const url = text(kind + 'Base'), key = text(kind + 'Key');
        const suffix = kind === 'vision' ? '/chat/completions' : IMAGE_PATHS[text('otherProtocol')];
        stage('等待接口返回模型列表');
        const models = await availableModels(url,key,signal,suffix);
        if (!models.length) {
            setStatus('接口返回空列表，可手填模型名。');
            return;
        }
        if (!dialog.open || disposed) return;
        field('progressBox').hidden = true;
        const model = await feedback.choose('选择' + (kind === 'vision' ? '视觉模型' : '生图模型') + ' · ' + models.length + ' 个',
            models,text(modelField));
        if (model === null || disposed || signal.aborted) return;
        field(modelField).value = model;
        const stored = settings();
        stored[kind + 'Base'] = url;
        stored[modelField] = model;
        if (kind === 'other') {
            stored.imageProvider = 'other';
            stored.otherProtocol = text('otherProtocol');
            stored.otherSize = text('otherSize');
        }
        writeKey(kind,url,key);
        save();
        syncImageFields();
        setStatus('已使用模型：' + model);
    }
    async function compile(source, connection, signal) {
        if (source.index === null) throw Error('请选择 AI 回复作为画面来源。');
        if (!connection.visionModel || !connection.visionKey) throw Error('请在「连接」中填写视觉模型与密钥。');
        stage('读取' + floorLabel(source.index) + '与角色资料');
        const looks = checked('useArchive') ? await optionalLooks(host.__AVS_V4_BRIDGE__,source) : [];
        signal.throwIfAborted();
        if (!matches(source)) throw Error('原楼层已变更，请重新选择。');
        stage('等待视觉模型编译提示词');
        const plan = await planScene(connection, connection.visionKey, {
            ...source, background:source.background, focus:source.focus
        }, looks, signal);
        if (!matches(source)) throw Error('原楼层已变更，请重新选择。');
        return plan;
    }
    function sceneSelection() {
        const source = selectedSource();
        if (source.index !== null) {
            source.background = priorContext(context(), source.index, Number(text('contextCount')));
            source.focus = text('focus');
        }
        return source;
    }
    async function createDraft(signal) {
        const source = sceneSelection(), connection = readConnections({vision:true});
        const plan = await compile(source,connection,signal);
        setDraft(plan,source);
        go('prompts');
        setStatus('草稿已就绪，可编辑后出图。');
    }
    async function illustrate(signal, edited = false) {
        const source = sceneSelection();
        const useDraft = edited || source.index === null;
        const connection = readConnections({vision:!useDraft, image:true});
        const draw = readDraw();
        if (connection.imageProvider === 'official' && !connection.imageKey) throw Error('请在「连接」中填写 NovelAI Token。');
        if (!connection.imageModel) throw Error('请在「连接」选择或填写生图模型。');
        if (edited && source.index !== null && draftAnchor && !isSelected(draftAnchor)) {
            throw Error('草稿来自另一条回复。请选择原楼层，或从当前楼层重新提取草稿。');
        }
        const style = checked('applyStyle') ? activeStyle() : null;
        const plan = useDraft ? getDraft() : await compile(source,connection,signal);
        if (!useDraft) setDraft(plan,source,checked('applyStyle'));
        saveDraw();
        if (isSelected(source)) go('draw');
        let completed = 0, storedCount = 0;
        try {
            for (let i=0; i<draw.count; i++) {
                signal.throwIfAborted();
                if (!matches(source)) throw Error('原楼层已变更，剩余图片已停止。');
                const seed = draw.seed === null ? '' : (draw.seed + i) % 4294967296;
                const body = makeImageBody(connection,plan,style,{...draw,seed});
                stage('等待 ' + modelLabel(body.model) + ' 返回第 ' + (i+1) + '/' + draw.count + ' 张', i, draw.count);
                const blob = await generate(connection,connection.imageKey,body,signal, () => stage('读取第 ' + (i+1) + ' 张回图',i,draw.count));
                const url = URL.createObjectURL(blob);
                const img = new Image();
                try { img.src=url; await img.decode(); }
                finally { URL.revokeObjectURL(url); }
                const native = connection.imageProtocol === 'nai';
                const row = {id:uniqueId(), source:source.key, text:source.text, index:source.index, blob,
                    date:Date.now(), model:body.model, naiModel:connection.naiModel, styleName:style?.name,
                    imageProvider:connection.imageProvider, imageProtocol:connection.imageProtocol, otherSize:connection.otherSize,
                    draw, resultSize:{width:img.naturalWidth,height:img.naturalHeight},
                    seed:body.parameters?.seed,
                    plan:native ? {base:body.input, negative:body.parameters.negative_prompt, characters:plan.characters} :
                        {base:body.prompt,negative:'',characters:[]}};
                try { await pictures.add(row); storedCount++; }
                catch { temporaryPictures.set(source.key, [row,...(temporaryPictures.get(source.key)||[])]); }
                completed++;
                stage('已收到 ' + completed + '/' + draw.count + ' 张',completed,draw.count);
                if (source.index !== null && matches(source) && !isSelected(source)) {
                    const old = field('floor').querySelector('option[value="' + source.index + '"]');
                    if (old) field('floor').value = old.value;
                }
                if (isSelected(source)) {
                    ++refreshVersion;
                    rows = [row, ...rows.filter(item => item.source === row.source || !item.source)].slice(0,30);
                    paintPreview(row); renderHistory();
                    if (activePage === 'draw' && dialog.open && completed === 1) {
                        field('result').scrollIntoView({block:'nearest'});
                    }
                }
            }
        } catch(error) {
            if (completed && !signal.aborted) throw Error(error.message + ' 已完成 ' + completed + ' 张。');
            throw error;
        }
        notify('已生成 ' + completed + ' 张插画。' + (storedCount < completed ? '部分图片仅保留在本页，请下载原图。' : ''));
    }

    function action(key, fn) {
        field(key).onclick = async () => {
            try { await fn(); }
            catch(error) { notify(error.message,'error'); }
        };
    }
    function build() {
        dialog = document.createElement('dialog');
        dialog.id = id;
        dialog.setAttribute('aria-label','AVS 视觉工坊');
        dialog.innerHTML = workshopPanel(SAMPLERS);
        document.body.append(dialog);
        for (const key of STYLE_FIELDS) {
            const label = document.createElement('label');
            label.textContent = styleNames[key];
            const input = document.createElement('input');
            input.dataset.field = 'style-' + key;
            input.dataset.lock = '';
            input.maxLength = 180;
            label.append(input); field('styleFields').append(label);
        }
        const stored = settings();
        migrateImageConnection(stored);
        for (const [key,value] of Object.entries(defaults)) field(key).value = stored[key] ?? value;
        field('naiModel').value = knownNaiModel(text('naiModel')) ?? MODELS[0];
        field('naiBase').value = OFFICIAL_NAI;
        for (const kind of ['vision','nai','other']) {
            const base = field(kind + 'Base'), key = field(kind + 'Key');
            key.value = readKey(kind,base.value);
            base.oninput = () => { key.value = readKey(kind,base.value); };
        }
        field('remember').checked = ['vision','nai','other'].some(kind => rememberedKeys.get(keyId(kind,field(kind+'Base').value)));
        field('contextCount').value = stored.preferences?.contextCount ?? 0;
        field('useArchive').checked = stored.preferences?.useArchive ?? true;
        field('toasts').checked = stored.preferences?.toasts ?? true;
        field('visionPresetName').value = stored.visionPresetName || '';
        field('useVisionPreset').checked = !!stored.useVisionPreset;
        field('visionPresetRow').hidden = !checked('useVisionPreset');
        setDraw(stored.draw);
        syncImageFields();
        populateDrawPresets();
        populateStyles();
        setDraft({base:'',negative:'',characters:[]});
        for (const button of dialog.querySelectorAll('[data-tab],[data-jump]')) {
            button.onclick = () => go(button.dataset.tab || button.dataset.jump);
        }
        for (const button of dialog.querySelectorAll('[data-nai-model]')) {
            button.onclick = () => {
                selectNaiModel(button.dataset.naiModel);
                setStatus('已选择 ' + modelLabel(button.dataset.naiModel) + '。');
            };
        }
        field('canvas').onchange = () => {
            const size = text('canvas');
            if (size !== 'custom') [field('width').value,field('height').value] = size.split('x');
            drawLabels();
        };
        for (const key of ['steps','scale','rescale']) field(key).oninput = drawLabels;
        field('useVisionPreset').onchange = () => {
            field('visionPresetRow').hidden = !checked('useVisionPreset');
            settings().useVisionPreset = checked('useVisionPreset');
            save();
        };
        for (const name of ['imageProvider','otherProtocol','otherSize']) field(name).onchange = syncImageFields;
        field('otherModel').oninput = syncImageFields;
        field('floor').onchange = () => refresh();
        field('mode').onchange = () => refresh();
        field('drawPreset').onchange = () => {
            field('presetDelete').disabled = builtInPresets.some(preset => preset.id === text('drawPreset'));
        };
        for (const position of ['Left','Right']) field('compare' + position).onchange = () => renderComparison(position);
        field('styles').onchange = () => {
            settings().selectedStyle = text('styles'); save(); populateStyles();
        };
        field('upload').onchange = event => {
            const file = event.target.files[0]; event.target.value = '';
            if (file) run(signal => analyze(file,signal));
        };
        action('close', () => dialog.close());
        action('cancel', () => job?.abort('user'));
        action('save', () => { readConnections({persist:true}); saveDraw(); notify('连接与偏好已保存。'); });
        action('resetDraw', () => { setDraw(); saveDraw(); setStatus('已恢复绘图默认值。'); });
        action('presetApply', applyDrawPreset);
        action('presetSave', storeDrawPreset);
        action('presetDelete', deleteDrawPreset);
        action('models', () => run(signal => listModels(signal)));
        action('otherModels', () => run(signal => listModels(signal,'other')));
        action('chooseVisionPreset', chooseVisionPreset);
        action('addRole', () => addRole());
        action('copyPrompt', copyPrompt);
        action('plan', () => run(createDraft));
        action('make', () => run(illustrate));
        action('drawDraft', () => run(signal => illustrate(signal,true)));
        action('styleUpdate', () => saveStyle(true));
        action('styleNew', () => saveStyle(false));
        action('styleRemove', async () => {
            const selected = activeStyle();
            if (!selected || !(await feedback.confirm('删除画风「' + selected.name + '」？', {title:'删除画风',accept:'删除',danger:true}))) return;
            const data = settings(); data.styles = savedStyles().filter(style => style.id !== selected.id);
            data.selectedStyle = data.styles.at(0)?.id || ''; save(); populateStyles(); setStatus('已删除画风。');
        });
        action('reuse', loadHistory);
        action('removeImage', removeHistory);
        action('zoom', () => { if (previewUrl) host.open(previewUrl,'_blank','noopener'); });
        action('historyZoom', () => { if (historyUrl) host.open(historyUrl,'_blank','noopener'); });
        dialog.addEventListener('close', () => { ++refreshVersion; clearThumbnails(); paintPreview(null); paintPreview(null,true); });
        const events = context();
        for (const name of ['CHAT_CHANGED','CHARACTER_MESSAGE_RENDERED','MESSAGE_SWIPED','MESSAGE_EDITED','MESSAGE_DELETED']) {
            const event = events.eventTypes?.[name];
            if (!event || !events.eventSource?.on) continue;
            const handler = () => refresh(name === 'CHAT_CHANGED');
            events.eventSource.on(event,handler);
            listeners.push(() => (events.eventSource.off ?? events.eventSource.removeListener)?.call(events.eventSource,event,handler));
        }
        go('draw');
    }
    function open() {
        if (disposed) return {ok:false,error:'该工坊实例已关闭。'};
        try {
            context();
            if (!dialog) build();
            if (!dialog.open) { syncDialogViewport(); dialog.showModal(); refresh(); }
            return {ok:true};
        } catch(error) { return {ok:false,error:error.message}; }
    }
    function visible() {
        if (!dialog?.open || !dialog.isConnected) return {ok:false,error:'工坊弹窗尚未打开。'};
        const bounds = dialog.getBoundingClientRect();
        const x = Math.max(0,Math.min(host.innerWidth-1,bounds.left+bounds.width/2));
        const y = Math.max(0,Math.min(host.innerHeight-1,bounds.top+bounds.height/2));
        const hit = document.elementFromPoint(x,y);
        return bounds.width>0 && bounds.height>0 && (hit===dialog || dialog.contains(hit)) ?
            {ok:true} : {ok:false,error:'工坊未显示在酒馆页面最上层。'};
    }
    function openFromMenu() {
        const result = open();
        if (!result.ok) feedback.notice(result.error,'error','AVS 视觉工坊');
        return result;
    }
    function mount() {
        const menu = document.querySelector('#extensionsMenu');
        if (!menu || entry?.isConnected) return;
        entry = document.createElement('button');
        entry.type = 'button'; entry.id = id + '-open';
        entry.className = 'list-group-item flex-container flexGap5 interactable';
        entry.innerHTML = '<i class="fa-solid fa-palette" aria-hidden="true"></i><span>AVS 插画工坊</span>';
        entry.onclick = openFromMenu; menu.append(entry);
    }
    const api = {kind,owner,version,open,openFromMenu,activate:visible,
        academyConfirm:feedback.confirm, academyNotice:feedback.notice,
        async verifyVisible() {
            await new Promise(resolve => host.requestAnimationFrame(() => host.requestAnimationFrame(resolve)));
            return visible();
        },
        close() { if (dialog?.open) dialog.close(); },
        dispose() {
            if (disposed) return;
            disposed = true; job?.abort('user'); observer?.disconnect(); feedback.dispose();
            for (const remove of listeners) remove();
            if (previewUrl) URL.revokeObjectURL(previewUrl);
            if (historyUrl) URL.revokeObjectURL(historyUrl);
            clearThumbnails();
            dialog?.remove(); entry?.remove(); localStyle?.remove(); pictures.close();
            if (host[slot] === api) delete host[slot];
            if (host[legacy] === api) {
                if (previousBridge) host[legacy] = previousBridge;
                else delete host[legacy];
            }
        }
    };
    host[slot] = api;
    host[legacy] = api;
    mount();
    if (!entry) {
        observer = new MutationObserver(() => { mount(); if (entry) observer.disconnect(); });
        observer.observe(document.documentElement,{subtree:true,childList:true});
    }
    return api;
}
