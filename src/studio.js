import {archiveScope, publicSource, suggestedIdentity} from './identity.js';
import {sourceAt, prose, optionalLooks, priorContext, archivePeople, passageRanges, withPassage} from './scene.js';
import {MODELS, MODEL_NAMES, OFFICIAL_NAI, IMAGE_PATHS, STYLE_FIELDS, SAMPLERS, DRAW_DEFAULTS, knownNaiModel, isGptImageModel, endpoint, extractStyle, planScene, generate, drawOptions, compileImagePrompt, makeImageRequest, supportsIdentityImages, availableModels} from './api.js';
import {NATIVE_IMAGE_PROVIDERS, nativeImageOptions} from './image-providers.js';
import {pictureLibrary} from './library.js';
import {createAcademyFeedback} from './theme.js';
import {chatPresetManager, presetNames, visionPreset} from './presets.js';
import {workshopPanel, CANVASES} from './panel.js';

export function installStudio(host, owner, kind, css) {
    const {document, Option, MutationObserver, Image, URL} = host;
    const slot = '__AVS_ILLUSTRATION_STUDIO__', legacy = '__AVS_VISUAL_WORKSHOP_R2__', version = '1.2.11';
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
        naiModel:MODELS[0], imageProvider:'official', otherProtocol:'openai', otherBase:'', otherModel:'', otherSize:'auto', otherReply:'default',
        grokBase:NATIVE_IMAGE_PROVIDERS.grok.base, grokModel:'grok-imagine-image-2.0', grokAspect:'2:3', grokResolution:'1K', grokQuality:'auto',
        geminiBase:NATIVE_IMAGE_PROVIDERS.gemini.base, geminiModel:'gemini-nano-banana-2.1', geminiAspect:'2:3', geminiResolution:'1K'};
    const nativeProtocols = Object.keys(NATIVE_IMAGE_PROVIDERS);
    const keyKinds = ['vision','nai','other',...nativeProtocols];
    const styleNames = {line:'线条（仅保存）', color:'局部色彩', light:'辅助光', rendering:'渲染（仅保存）', composition:'构图（仅保存）'};
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
    let previewUrl, historyUrl, detail, previewRow, rows = [], draftAnchor = null;
    let pickedPassage, pickingSource, retrySource, passageStart = -1;
    const thumbnailUrls = [];
    const roleBindings = new WeakMap();
    let identityRequest = 0, identityPreview = 0, identityPeople = [], identityScope = '', suggested = null;
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
        return text('imageProvider') === 'official' ? 'nai' : text('otherProtocol') || 'openai';
    }
    function thirdPartyNaiModel() {
        if (text('imageProvider') === 'other' && !nativeProtocols.includes(currentProtocol())) return knownNaiModel(text('otherModel'));
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
        const protocol = currentProtocol(), native = nativeProtocols.includes(protocol);
        const generic = other && protocol === 'openai';
        const nai = protocol === 'nai';
        const explicitModel = thirdPartyNaiModel();
        field('officialConnection').hidden = other;
        field('otherConnection').hidden = !other;
        field('compatibleConnection').hidden = native;
        for (const kind of nativeProtocols) field(kind + 'Connection').hidden = protocol !== kind;
        if (native) {
            const allowed = nativeImageOptions(protocol,text(protocol + 'Model'));
            for (const [suffix, values] of [['Aspect',allowed.aspects],['Resolution',allowed.resolutions]]) {
                const name = protocol + suffix, select = field(name), current = text(name);
                select.replaceChildren(...values.map(value => new Option(value === 'auto' ? '自动' : value,value)));
                select.value = values.includes(current) ? current : defaults[name];
            }
            field('grokQualityRow').hidden = protocol !== 'grok' || !allowed.qualities.length;
        }
        field('otherSizeRow').hidden = !generic;
        const gptImage = generic && isGptImageModel(text('otherModel'));
        field('otherReplyRow').hidden = !generic || gptImage;
        field('gptReplyNote').hidden = !gptImage;
        field('naiModelRow').hidden = !nai && !explicitModel;
        field('naiModelLabel').textContent = other && !explicitModel ? 'NovelAI 参数格式' : '生图模型';
        const selected = selectedNaiModel();
        for (const button of dialog.querySelectorAll('[data-nai-model]')) {
            button.setAttribute('aria-pressed', String(button.dataset.naiModel === selected));
        }
        field('canvasRow').hidden = !nai;
        field('seedRow').hidden = !nai;
        for (const detail of dialog.querySelectorAll('[data-nai-only]')) detail.hidden = !nai;
        field('otherDraw').hidden = !other;
        field('otherDraw').textContent = other
            ? (native ? modelLabel(text(protocol + 'Model')) + ' · ' + text(protocol + 'Aspect') + ' · ' + text(protocol + 'Resolution')
                : '其它生图 API · ' + (text('otherModel') || '请在连接页选择模型') +
                    (generic ? ' · 画幅：' + (text('otherSize') === 'auto' ? '自动' : text('otherSize')) : ''))
            : '';
        drawLabels();
    }
    function readConnections({vision = false, image = false, persist = false} = {}) {
        const stored = settings();
        const connection = Object.fromEntries(Object.keys(defaults).map(key => [key, text(key)]));
        const other = connection.imageProvider === 'other';
        for (const kind of keyKinds) connection[kind + 'Key'] = text(kind + 'Key');
        connection.imageProtocol = currentProtocol();
        const imageKind = nativeProtocols.includes(connection.imageProtocol) ? connection.imageProtocol : other ? 'other' : 'nai';
        connection.imageBase = connection[imageKind + 'Base'];
        connection.imageKey = connection[imageKind + 'Key'];
        connection.imageModel = connection[imageKind + 'Model'];
        if (vision || (persist && connection.visionBase)) endpoint(connection.visionBase,'/chat/completions');
        if (image || (persist && connection.imageBase)) endpoint(connection.imageBase,IMAGE_PATHS[connection.imageProtocol]);
        if (vision && checked('useVisionPreset')) {
            const ctx = context();
            connection.promptPreset = visionPreset(chatPresetManager(ctx), text('visionPresetName'), ctx);
        }
        if (persist) {
            for (const kind of keyKinds) {
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
        const options = [new Option('不使用附加参考',''), ...styles.map(style => new Option(style.name, style.id))];
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
        const custom = currentProtocol() === 'nai' && field('canvas').value === 'custom';
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

    const sameFloor = (first, second) => first?.key === second?.key && first?.text === second?.text;
    function selectedFloor() {
        if (text('mode') === 'manual') return {key:'manual', text:'', index:null};
        return sourceAt(context(), text('floor') || 'latest');
    }
    function selectedSource() {
        const source = selectedFloor();
        return sameFloor(source,pickedPassage) ? withPassage(source,pickedPassage.passage) : source;
    }
    function matches(source) {
        try {
            const current = source.index === null ? selectedFloor() : sourceAt(context(),source.index);
            return sameFloor(current,source);
        } catch { return false; }
    }
    function isSelectedFloor(source) {
        try { return sameFloor(selectedFloor(),source); }
        catch { return false; }
    }
    function isSelected(source) {
        if (!isSelectedFloor(source)) return false;
        const passage = selectedSource().passage;
        return passage?.start === source.passage?.start && passage?.end === source.passage?.end;
    }
    function showSource(source) {
        const manual = source.index === null;
        const passage = source.passage;
        field('excerpt').textContent = manual ? '手写模式 · 在「提示词」填写画面。' :
            '#' + source.index + ' · ' + (passage ? '已指定片段 · ' : '') +
            (source.selectedText ?? source.visualText).replace(/\s+/g,' ').slice(0,150);
        field('clearPassage').hidden = !passage;
        field('make').textContent = manual ? '按手写提示词生成' : passage ? '画这一段' :
            text('floor') === 'latest' ? '一键画当前回复' : '一键画所选楼层';
        field('retryDrawing').hidden = !retrySource || !isSelected(retrySource);
    }
    function closePassagePicker() {
        pickingSource = null;
        passageStart = -1;
        field('passagePicker').hidden = true;
        field('pickPassage').setAttribute('aria-expanded','false');
        field('passageRows').replaceChildren();
    }
    function openPassagePicker() {
        if (pickingSource) { closePassagePicker(); return; }
        const source = selectedSource();
        const segments = passageRanges(source.visualText);
        if (!segments.length) throw Error('当前回复没有可选的正文片段。');
        pickingSource = source;
        passageStart = -1;
        field('passagePicker').hidden = false;
        field('pickPassage').setAttribute('aria-expanded','true');
        const hint = field('passageHelp');
        hint.textContent = '轻点起点，再点终点。单段可点同一项两次。';
        const container = field('passageRows');
        const buttons = segments.map((segment,index) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.dataset.lock = '';
            button.textContent = segment.text;
            button.setAttribute('aria-pressed','false');
            button.onclick = () => {
                if (!isSelectedFloor(source)) { closePassagePicker(); setStatus('回复已变更，请重新选择片段。','warning'); return; }
                if (passageStart < 0) {
                    passageStart = index;
                    button.setAttribute('aria-pressed','true');
                    hint.textContent = '已选起点。点终点完成，点同一项只画这一段。';
                    return;
                }
                const start = segments[Math.min(passageStart,index)].start;
                const end = segments[Math.max(passageStart,index)].end;
                pickedPassage = withPassage(source,{start,end,text:source.visualText.slice(start,end)});
                closePassagePicker();
                showSource(pickedPassage);
                field('make').focus({preventScroll:true});
            };
            return button;
        });
        container.replaceChildren(...buttons);
    }
    function floorLabel(index) { return index === null ? '手写提示词' : '第 ' + index + ' 楼'; }
    function portraitFile(row) { return 'AVS-' + (row.index ?? 'manual') + '-' + (row.seed ?? 'original') + '.' + row.blob.type.split('/')[1]; }

    function modelLabel(model) {
        return MODEL_NAMES[knownNaiModel(model)] ?? NATIVE_IMAGE_PROVIDERS.grok.models[model] ??
            NATIVE_IMAGE_PROVIDERS.gemini.models[model] ?? model;
    }
    function pictureLabel(row) {
        return row.model ? [
            modelLabel(row.model), (row.resultSize?.width ?? row.draw.width) + '×' + (row.resultSize?.height ?? row.draw.height), row.seed == null ? '' : '种子 ' + row.seed, row.styleName
        ].filter(Boolean).join(' · ') : '旧版预览';
    }
    const versionSeries = row => row?.id ? rows.filter(item =>
        (item.seriesId || item.id) === (row.seriesId || row.id)) : [];
    function paintPreview(row, history = false) {
        const url = history ? historyUrl : previewUrl;
        if (url) URL.revokeObjectURL(url);
        const next = row?.blob ? URL.createObjectURL(row.blob) : null;
        if (history) historyUrl = next;
        else {
            previewUrl = next;
            previewRow = row;
            field('redrawPreview').hidden = !row?.plan;
            const versions = versionSeries(row);
            const index = versions.indexOf(row);
            field('previewVersions').hidden = versions.length < 2 || index < 0;
            field('olderPreview').hidden = index >= versions.length - 1;
            field('newerPreview').hidden = index <= 0;
            field('versionLabel').textContent = (versions.length - index) + ' / ' + versions.length;
        }
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
        field(history ? 'historyMeta' : 'caption').textContent = floorLabel(row.index) +
            (row.passage ? ' · ' + row.passage.text.replace(/\s+/g,' ').slice(0,32) : '') + ' · ' + pictureLabel(row);
    }
    function changePreviewVersion(offset) {
        if (!previewRow) return;
        const versions = versionSeries(previewRow);
        const next = versions[versions.indexOf(previewRow) + offset];
        if (next) paintPreview(next);
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
        field('redrawHistory').hidden = !row?.plan;
        field('removeImage').hidden = !row?.id;
        const box = field('metadataBox');
        box.hidden = !row?.plan;
        if (box.hidden) return;
        const native = NATIVE_IMAGE_PROVIDERS[row.imageProtocol];
        const params = native ? [['接口',native.label],['画幅比例',row.nativeOptions?.aspect],
            ['分辨率',row.nativeOptions?.resolution],...(row.nativeOptions?.quality ? [['画质',row.nativeOptions.quality]] : [])]
            : row.imageProtocol === 'openai' ? [['接口','OpenAI 兼容'], ['请求画幅',row.otherSize],
                ['请求回图格式',row.otherReply === 'b64_json' ? 'Base64' : '服务商默认']] : [
            ['采样器',SAMPLERS[row.draw.sampler]], ['步数',row.draw.steps],
            ['引导强度',row.draw.scale], ['CFG Rescale',row.draw.rescale],
            ['自动质量标签',row.draw.quality ? '开启' : '关闭']
        ];
        if (row.identityImages?.length) params.push(['人物参考图',row.identityImages.join('、')]);
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
        field('passageActions').hidden = manual;
        let source;
        paintPreview(null); rows = []; detail = null; renderHistory();
        try {
            const floor = selectedFloor();
            if (!sameFloor(floor,pickedPassage)) pickedPassage = null;
            if (pickingSource && !sameFloor(floor,pickingSource)) closePassagePicker();
            source = selectedSource();
            showSource(source);
        } catch(error) {
            closePassagePicker();
            field('passageActions').hidden = true;
            field('retryDrawing').hidden = true;
            field('excerpt').textContent = error.message;
            return;
        }
        let saved = [];
        try { saved = await pictures.list(source); }
        catch { if (!job && latestRequest === refreshVersion) setStatus('本机图库暂不可用，仍可下载生成的原图。','warning'); }
        if (latestRequest !== refreshVersion || !dialog.open || !isSelectedFloor(source)) return;
        rows = [...(temporaryPictures.get(source.key) || []).filter(row => row.text === source.text), ...saved].slice(0,30);
        paintPreview(rows[0]); renderHistory();
    }
    function go(page) {
        activePage = page;
        for (const element of dialog.querySelectorAll('[data-page]')) element.hidden = element.dataset.page !== page;
        for (const button of dialog.querySelectorAll('[data-tab]')) button.setAttribute('aria-pressed', String(button.dataset.tab === page));
        const scroll = field('scroll'); scroll.scrollTop = 0;
        if (page === 'gallery') renderHistory();
        if (page !== 'draw') closePassagePicker();
        if (page === 'identity') void refreshIdentities();
        if (page !== 'gallery') { clearThumbnails(); if (historyUrl) paintPreview(null,true); }
    }

    const readBindings = scope => settings().identityBindings?.[scope] ?? {};
    const imageKey = (scope, id) => JSON.stringify([scope,id]);
    const selectedIdentity = () => identityPeople.find(person => person.id === text('identityPerson'));
    function currentIdentity() {
        const person = selectedIdentity();
        const scope = archiveScope(context());
        if (!person || scope !== identityScope) throw Error('聊天已切换，请重新选择档案角色。');
        return {person, scope, record:readBindings(scope)[person.id]};
    }
    function writeIdentity(scope, id, record) {
        const all = settings().identityBindings ??= {};
        (all[scope] ??= {})[id] = record;
        save();
    }
    function setLink(key, url) {
        const link = field(key);
        link.hidden = !url;
        if (url) link.href = url;
        else link.removeAttribute('href');
    }
    function setIdentityInputs(record = {}) {
        field('identityName').value = record.name ?? '';
        field('identityWork').value = record.work ?? '';
        field('identityRoman').value = record.romanName ?? '';
        field('identityAliases').value = (record.aliases ?? []).join(', ');
        field('identityFeatures').value = record.features ?? '';
        field('identityTags').value = record.tags ?? '';
        field('identitySource').value = record.source ?? '';
    }
    function syncIdentityForm() {
        const person = selectedIdentity();
        const record = person && readBindings(identityScope)[person.id];
        const fan = text('identityType') === 'fan';
        const saved = fan && record?.type === 'fan';
        suggested = person && suggestedIdentity(person.name);
        field('fanFields').hidden = !fan;
        field('identitySave').disabled = !!job || !text('identityType');
        field('identitySuggestion').hidden = !suggested;
        if (suggested) field('identitySuggestion').textContent = '使用候选 · ' + suggested.workLabel + '／' + suggested.name;
        if (person) setLink('identitySearch','https://zh.moegirl.org.cn/index.php?search=' + encodeURIComponent(person.name));
        setLink('identitySourceLink',saved ? record.source : '');
        field('identityImageBox').hidden = !saved;
        field('identityOfficialImage').hidden = !saved || !record.portrait;
        setLink('identityPortraitLink',saved && record.portrait);
        field('identityRemoveImage').hidden = !saved || !record.imageToken;
    }
    async function showIdentity() {
        const preview = ++identityPreview;
        const person = selectedIdentity(), image = field('identityImage');
        image.hidden = true;
        image.removeAttribute('src');
        field('identityForm').hidden = !person;
        if (!person) return;
        const record = readBindings(identityScope)[person.id];
        field('identityType').value = record?.type ?? '';
        setIdentityInputs(record);
        syncIdentityForm();
        if (record?.type !== 'fan' || !record.imageToken) return;
        const data = await pictures.getIdentityImage(imageKey(identityScope,person.id));
        if (preview !== identityPreview || disposed) return;
        if (data?.token === record.imageToken) {
            image.src = 'data:' + data.type + ';base64,' + data.data;
            image.hidden = false;
        } else field('identityStatus').textContent = '本机参考图不可用，可以重新保存。';
    }
    async function refreshIdentities(reset = false) {
        const request = ++identityRequest, select = field('identityPerson');
        const scope = archiveScope(context()), previous = !reset && identityScope === scope ? select.value : '';
        const bridge = host.__AVS_V4_BRIDGE__;
        const status = field('identityStatus');
        identityScope = scope;
        identityPeople = [];
        ++identityPreview;
        field('identityForm').hidden = true;
        select.replaceChildren(new Option('读取档案角色…',''));
        status.textContent = '';
        try {
            const summary = scope ? await bridge?.fullInspector?.() : null;
            if (request !== identityRequest || disposed || scope !== archiveScope(context())) return;
            identityPeople = archivePeople(summary).sort((a,b) => Number(b.active) - Number(a.active));
            select.replaceChildren(...identityPeople.map(person => new Option(person.name,person.id)));
            if (!identityPeople.length) {
                select.replaceChildren(new Option('暂无可绑定的档案角色',''));
                status.textContent = scope ? '请先在当前聊天录入角色，再绑定原作身份。' : '请先打开一条已保存的聊天。';
            } else if (identityPeople.some(person => person.id === previous)) select.value = previous;
            await showIdentity();
        } catch (error) {
            if (request === identityRequest && !disposed) status.textContent = '读取角色参考失败 · ' + error.message;
        }
    }
    async function saveIdentity() {
        const {person,scope,record} = currentIdentity();
        const type = text('identityType');
        if (type === 'original') writeIdentity(scope,person.id,{...record,type});
        else {
            const name = text('identityName'), work = text('identityWork'), features = text('identityFeatures');
            if (type !== 'fan' || !name || !work || !features) throw Error('请填写原作角色名、作品名和可辨认的外貌特征。');
            const source = publicSource(text('identitySource'));
            const romanName = text('identityRoman');
            const samePerson = record?.name === name && record?.work === work;
            const builtin = suggestedIdentity(romanName || name);
            const portrait = builtin && builtin.source === source &&
                [builtin.work,builtin.workLabel].includes(work) && [builtin.name,builtin.romanName].includes(name) ? builtin.portrait : '';
            const aliases = text('identityAliases').split(/[,，]/).map(value => value.trim()).filter(Boolean);
            writeIdentity(scope,person.id,{type,name,work,romanName,features,aliases,
                tags:text('identityTags'),source,portrait,imageToken:samePerson ? record.imageToken : undefined});
            if (record?.imageToken && !samePerson) await pictures.dropIdentityImage(imageKey(scope,person.id));
        }
        await showIdentity();
        setStatus('已保存「' + person.name + '」的角色类型与资料。','success');
    }
    async function saveIdentityImage(file, signal) {
        const {person,scope,record} = currentIdentity();
        if (record?.type !== 'fan') throw Error('请先保存已确认同人角色的原作资料。');
        stage('读取人物参考图');
        if (!file) {
            if (!record.portrait) throw Error('该角色暂无官方人物图。');
            try {
                const response = await fetch(record.portrait,{credentials:'omit',referrerPolicy:'no-referrer',
                    signal:AbortSignal.any([signal,AbortSignal.timeout(15000)])});
                if (!response.ok) throw Error('HTTP ' + response.status);
                file = await response.blob();
            } catch {
                signal.throwIfAborted();
                throw Error('浏览器无法直接读取官方人物图。可打开原图并保存到设备后上传。');
            }
        }
        if (file.size > 16 * 1024 * 1024 || !['image/png','image/jpeg','image/webp'].includes(file.type)) {
            throw Error('请使用 16 MB 内的 PNG、JPEG 或 WebP 人物参考图。');
        }
        const encoded = await raster(file);
        const data = encoded.slice(encoded.indexOf(',') + 1);
        const token = uniqueId();
        signal.throwIfAborted();
        if (scope !== archiveScope(context()) || readBindings(scope)[person.id] !== record) {
            throw Error('角色资料已变更，请重新选择人物参考图。');
        }
        const blob = new Blob([Uint8Array.from(atob(data), char => char.charCodeAt(0))],{type:'image/jpeg'});
        await pictures.putIdentityImage(imageKey(scope,person.id),{token,type:blob.type,data,blob});
        writeIdentity(scope,person.id,{...record,imageToken:token});
        if (scope === archiveScope(context())) await showIdentity();
        setStatus('已保存「' + person.name + '」的人物参考图。','success');
    }
    async function removeIdentityImage() {
        const {person,scope,record} = currentIdentity();
        if (!record?.imageToken) return;
        await pictures.dropIdentityImage(imageKey(scope,person.id));
        writeIdentity(scope,person.id,{...record,imageToken:undefined});
        if (scope === archiveScope(context())) await showIdentity();
        setStatus('已移除人物参考图。');
    }
    async function identityImages(plan, connection, scope) {
        if (!supportsIdentityImages(connection)) return [];
        const chosen = plan.characters.map((role,index) => ({role,index})).filter(({role}) => role.imageToken).slice(0,3);
        return Promise.all(chosen.map(async ({role,index}) => {
            const current = readBindings(scope)[role.archiveId];
            const image = await pictures.getIdentityImage(imageKey(scope,role.archiveId));
            if (current?.type !== 'fan' || current.imageToken !== role.imageToken || image?.token !== role.imageToken) {
                throw Error('「' + role.label + '」的人物参考图已变更，请重新提取草稿，或在人物分栏取消发送参考图。');
            }
            return {subject:index+1, name:role.label, image};
        }));
    }

    function addRole(role = {}) {
        const count = field('roles').children.length, limit = currentProtocol() === 'nai' && selectedNaiModel() === MODELS[0] ? 6 : 22;
        if (count >= limit) throw Error('当前模型最多支持 ' + limit + ' 个独立人物提示词。');
        const card = document.createElement('fieldset');
        card.className = 'studio-role studio-stack';
        card.innerHTML = `<legend>人物提示词</legend><label>人物正面词<textarea rows="2" data-role="positive" data-lock></textarea></label>
            <label>人物负面词<textarea rows="2" data-role="negative" data-lock></textarea></label>
            <button type="button" data-lock>移除此人物</button>`;
        for (const key of ['positive','negative']) card.querySelector('[data-role="'+key+'"]').value = role[key] || '';
        if (role.label) card.querySelector('legend').textContent = role.label + ' · 原作身份已绑定';
        if (role.identity?.imageToken) {
            const label = document.createElement('label'), check = document.createElement('input');
            label.className = 'studio-check';
            check.type = 'checkbox'; check.checked = role.useReferenceImage; check.dataset.lock = ''; check.dataset.role = 'image';
            label.append(check,'发送人物参考图（支持的线路）');
            card.append(label);
        }
        if (role.identity) roleBindings.set(card,role);
        card.querySelector('button').onclick = () => card.remove();
        field('roles').append(card);
        if (job) for (const node of card.querySelectorAll('[data-lock]')) node.disabled = true;
    }
    function setDraft(plan, source = null, applyStyle = true) {
        draftAnchor = source;
        retrySource = null;
        field('retryDrawing').hidden = true;
        field('positive').value = plan.base;
        field('negative').value = plan.negative || '';
        field('roles').replaceChildren();
        for (const role of plan.characters) addRole(role);
        field('applyStyle').checked = applyStyle;
        const confirmed = plan.characters.filter(role => role.label).map(role => role.label);
        field('draftIdentities').hidden = !confirmed.length;
        field('draftIdentities').textContent = confirmed.length ? '已匹配原作身份 · ' + confirmed.join('、') : '';
        field('draftSource').textContent = source ? '草稿来源 · ' + floorLabel(source.index)
            + (source.passage ? ' · 指定片段' : '') + (plan.sourceQuote ? ' · ' + plan.sourceQuote.slice(0,100) : '') : '可直接填写，或从所选 AI 楼层提取再编辑。';
    }
    function getDraft() {
        const characters = Array.from(field('roles').children, card => {
            const role = roleBindings.get(card);
            return {positive:card.querySelector('[data-role="positive"]').value.trim(),
                negative:card.querySelector('[data-role="negative"]').value.trim(),
                archiveId:role?.archiveId, label:role?.label,
                imageToken:card.querySelector('[data-role="image"]')?.checked ? role?.identity.imageToken : undefined};
        }).filter(role => role.positive || role.negative);
        if (characters.some(role => !role.positive)) throw Error('有人物分栏只填了负面词，请补上人物正面词。');
        return {base:text('positive'), negative:text('negative'), characters};
    }
    async function copyPrompt() {
        const draft = getDraft(), style = checked('applyStyle') ? activeStyle() : null;
        const protocol = currentProtocol(), compiled = compileImagePrompt(protocol,draft,style);
        const value = protocol === 'nai' ? JSON.stringify(compiled,null,2) : compiled.base;
        if (host.navigator.clipboard?.writeText) await host.navigator.clipboard.writeText(value);
        else {
            const box = document.createElement('textarea');
            box.value = value; dialog.append(box); box.select();
            try { if (!document.execCommand('copy')) throw Error('浏览器未授予复制权限。'); }
            finally { box.remove(); }
        }
        setStatus('已复制实际生图提示词。');
    }
    function loadHistory() {
        if (!detail?.plan) return;
        const floor = selectedFloor();
        pickedPassage = detail.passage ? withPassage(floor,detail.passage) : null;
        const source = selectedSource();
        showSource(source);
        const {model, plan, draw, seed} = detail;
        field('imageProvider').value = detail.imageProvider || 'official';
        if (detail.imageProvider === 'other') {
            const protocol = detail.imageProtocol || 'openai';
            field('otherProtocol').value = protocol;
            if (nativeProtocols.includes(protocol)) {
                field(protocol + 'Model').value = model;
                syncImageFields();
                field(protocol + 'Aspect').value = detail.nativeOptions?.aspect ?? defaults[protocol + 'Aspect'];
                field(protocol + 'Resolution').value = detail.nativeOptions?.resolution ?? defaults[protocol + 'Resolution'];
                if (protocol === 'grok') field('grokQuality').value = detail.nativeOptions?.quality ?? 'auto';
            } else {
                field('otherModel').value = model;
                field('otherSize').value = detail.otherSize || 'auto';
                if (!isGptImageModel(model)) field('otherReply').value = detail.otherReply || defaults.otherReply;
            }
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
            syncIdentityForm();
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
            stored.otherReply = text('otherReply');
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
        const scope = archiveScope(context());
        const looks = await optionalLooks(host.__AVS_V4_BRIDGE__,source,readBindings(scope),checked('useArchive'));
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
    function redrawConnection(record) {
        const connection = readConnections();
        const imageProtocol = record.imageProtocol || 'nai';
        const imageProvider = record.imageProvider || 'official';
        const kind = nativeProtocols.includes(imageProtocol) ? imageProtocol : imageProvider === 'other' ? 'other' : 'nai';
        const imageBase = connection[kind + 'Base'];
        endpoint(imageBase,IMAGE_PATHS[imageProtocol]);
        return {...connection,imageProtocol,imageProvider,imageBase,imageKey:connection[kind + 'Key'],imageModel:record.model,
            naiModel:record.naiModel || knownNaiModel(record.model) || connection.naiModel,otherSize:record.otherSize,
            otherReply:record.otherReply,
            [imageProtocol + 'Aspect']:record.nativeOptions?.aspect,
            [imageProtocol + 'Resolution']:record.nativeOptions?.resolution,
            ...(imageProtocol === 'grok' ? {grokQuality:record.nativeOptions?.quality ?? 'auto'} : {})};
    }
    async function illustrate(signal, edited = false, previous = null) {
        let source = sceneSelection();
        if (previous) {
            if (previous.source !== source.key || previous.text !== source.text) throw Error('原回复已切换，请从原楼层的历史重画。');
            if (previous.identityImages?.length && !previous.requestPlan) {
                throw Error('此旧图使用了人物参考图。请从原文重新提取草稿，以应用当前保存的参考图。');
            }
            source = previous.passage ? withPassage(source,previous.passage) : selectedFloor();
        }
        const useDraft = edited || !!previous || source.index === null;
        const connection = previous ? redrawConnection(previous) : readConnections({vision:!useDraft, image:true});
        const draw = previous ? {...previous.draw,seed:null,count:1} : readDraw();
        if (connection.imageProvider === 'official' && !connection.imageKey) throw Error('请在「连接」中填写 NovelAI Token。');
        const provider = NATIVE_IMAGE_PROVIDERS[connection.imageProtocol];
        if (provider && !connection.imageKey) throw Error('请在「连接」中填写 ' + provider.label + ' 的 API Key。');
        if (!connection.imageModel) throw Error('请在「连接」选择或填写生图模型。');
        if (edited && draftAnchor && !isSelected(draftAnchor)) {
            throw Error('草稿来自另一条回复。请选择原楼层，或从当前楼层重新提取草稿。');
        }
        const style = previous ? previous.requestStyle : checked('applyStyle') ? activeStyle() : null;
        if (!useDraft) setDraft(await compile(source,connection,signal),source,checked('applyStyle'));
        const plan = previous ? previous.requestPlan ?? previous.plan : getDraft();
        const references = await identityImages(plan,connection,archiveScope(context()));
        if (!previous) saveDraw();
        if (isSelectedFloor(source) && activePage !== 'draw') go('draw');
        let completed = 0, storedCount = 0;
        try {
            for (let i=0; i<draw.count; i++) {
                signal.throwIfAborted();
                if (!matches(source)) throw Error('原楼层已变更，剩余图片已停止。');
                const seed = draw.seed === null ? '' : (draw.seed + i) % 4294967296;
                const request = makeImageRequest(connection,plan,style,{...draw,seed},references);
                const {body,model} = request;
                stage('等待 ' + modelLabel(model) + ' 返回第 ' + (i+1) + '/' + draw.count + ' 张', i, draw.count);
                const blob = await generate(connection,connection.imageKey,request,signal, () => stage('读取第 ' + (i+1) + ' 张回图',i,draw.count));
                const url = URL.createObjectURL(blob);
                const img = new Image();
                try { img.src=url; await img.decode(); }
                finally { URL.revokeObjectURL(url); }
                const native = connection.imageProtocol === 'nai';
                const nativeOptions = provider ? {
                    aspect:connection[connection.imageProtocol + 'Aspect'], resolution:connection[connection.imageProtocol + 'Resolution'],
                    ...(body.quality ? {quality:body.quality} : {})
                } : undefined;
                const pictureId = uniqueId();
                const row = {id:pictureId, seriesId:previous?.seriesId || previous?.id || pictureId,
                    source:source.key, text:source.text, index:source.index, passage:source.passage, blob,
                    requestPlan:plan, requestStyle:style, date:Date.now(), model, naiModel:connection.naiModel, styleName:style?.name,
                    imageProvider:connection.imageProvider, imageProtocol:connection.imageProtocol, otherSize:connection.otherSize,
                    otherReply:body.response_format === 'b64_json' && connection.imageProtocol === 'openai' ? 'b64_json' : undefined,
                    draw, nativeOptions, identityImages:references.map(ref => ref.name), resultSize:{width:img.naturalWidth,height:img.naturalHeight},
                    seed:body.parameters?.seed,
                    plan:native ? {base:body.input, negative:body.parameters.negative_prompt,
                        characters:body.parameters.characterPrompts.map(role => ({positive:role.prompt,negative:role.uc}))} :
                        {base:request.prompt,negative:'',characters:[]}};
                try { await pictures.add(row); storedCount++; }
                catch { temporaryPictures.set(source.key, [row,...(temporaryPictures.get(source.key)||[])]); }
                completed++;
                stage('已收到 ' + completed + '/' + draw.count + ' 张',completed,draw.count);
                if (isSelectedFloor(source)) {
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
            if (!useDraft && !signal.aborted && matches(source)) {
                retrySource = source;
                field('retryDrawing').hidden = !isSelected(source);
                throw Error(error.message + ' 提示词已保留。');
            }
            throw error;
        }
        if (!previous) {
            retrySource = null;
            field('retryDrawing').hidden = true;
        }
        const target = !isSelectedFloor(source) && source.index !== null ? '，见' + floorLabel(source.index) + '的历史' : '';
        notify('已生成 ' + completed + ' 张插画' + target + '。' + (storedCount < completed ? '部分图片仅保留在本页，请下载原图。' : ''));
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
        for (const kind of keyKinds) {
            const base = field(kind + 'Base'), key = field(kind + 'Key');
            key.value = readKey(kind,base.value);
            base.oninput = () => { key.value = readKey(kind,base.value); };
        }
        field('remember').checked = keyKinds.some(kind => rememberedKeys.get(keyId(kind,field(kind+'Base').value)));
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
        for (const name of ['imageProvider','otherProtocol','otherSize','grokModel','grokAspect','grokResolution',
            'geminiModel','geminiAspect','geminiResolution']) field(name).onchange = syncImageFields;
        field('otherModel').oninput = syncImageFields;
        for (const name of ['floor','mode']) field(name).onchange = () => {
            pickedPassage = null;
            closePassagePicker();
            return refresh();
        };
        field('drawPreset').onchange = () => {
            field('presetDelete').disabled = builtInPresets.some(preset => preset.id === text('drawPreset'));
        };
        for (const position of ['Left','Right']) field('compare' + position).onchange = () => renderComparison(position);
        field('styles').onchange = () => {
            settings().selectedStyle = text('styles'); save(); populateStyles();
        };
        field('identityPerson').onchange = () => showIdentity().catch(error => notify(error.message,'error'));
        field('identityType').onchange = syncIdentityForm;
        field('identityUpload').onchange = event => {
            const file = event.target.files[0]; event.target.value = '';
            if (file) run(signal => saveIdentityImage(file,signal));
        };
        action('identitySuggestion', () => { if (suggested) setIdentityInputs(suggested); });
        action('identitySave', () => run(saveIdentity));
        action('identityOfficialImage', () => run(signal => saveIdentityImage(null,signal)));
        action('identityRemoveImage', () => run(removeIdentityImage));
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
        action('pickPassage', openPassagePicker);
        action('clearPassage', () => { pickedPassage = null; closePassagePicker(); showSource(selectedFloor()); });
        action('redrawPreview', () => run(signal => illustrate(signal,false,previewRow)));
        action('redrawHistory', () => run(signal => illustrate(signal,false,detail)));
        action('olderPreview', () => changePreviewVersion(1));
        action('newerPreview', () => changePreviewVersion(-1));
        action('drawDraft', () => run(signal => illustrate(signal,true)));
        action('retryDrawing', () => run(signal => illustrate(signal,true)));
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
        dialog.addEventListener('close', () => { ++refreshVersion; closePassagePicker(); clearThumbnails(); paintPreview(null); paintPreview(null,true); });
        const events = context();
        for (const name of ['CHAT_CHANGED','CHARACTER_MESSAGE_RENDERED','MESSAGE_SWIPED','MESSAGE_EDITED','MESSAGE_DELETED']) {
            const event = events.eventTypes?.[name];
            if (!event || !events.eventSource?.on) continue;
            const handler = () => {
                if (name === 'CHAT_CHANGED') {
                    pickedPassage = null;
                    closePassagePicker();
                    if (draftAnchor) setDraft({base:'',negative:'',characters:[]});
                    if (activePage === 'identity') void refreshIdentities(true);
                }
                return refresh(name === 'CHAT_CHANGED');
            };
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
            if (!dialog.open) {
                syncDialogViewport();
                dialog.showModal();
                refresh();
                if (activePage === 'identity') void refreshIdentities();
            }
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
