import {MODEL_NAMES} from './api.js';
import {NATIVE_IMAGE_PROVIDERS, nativeImageOptions} from './image-providers.js';

export const STUDIO_PAGES = {
    draw:'绘图', prompts:'提示词', styles:'画风', gallery:'历史', settings:'连接'
};

export const CANVASES = {'832x1216':'竖幅', '1216x832':'横幅', '1024x1024':'方形',
    '768x1344':'高竖幅', '1344x768':'宽横幅', '896x1152':'短竖幅', '1152x896':'短横幅'};

function nativeImageConnection(protocol) {
    const provider = NATIVE_IMAGE_PROVIDERS[protocol];
    const models = Object.entries(provider.models);
    const options = values => [...new Set(values)].map(value =>
        `<option value="${value}">${value === 'auto' ? '自动' : value}</option>`).join('');
    const capabilities = models.map(([id]) => nativeImageOptions(protocol,id));
    return `<div class="studio-stack" data-field="${protocol}Connection" hidden>
        <label>API 地址<input data-field="${protocol}Base" type="url" data-lock></label>
        <label>${protocol === 'grok' ? 'xAI' : 'Gemini'} API Key<input data-field="${protocol}Key" type="password" autocomplete="off" data-lock></label>
        <label>生图模型<select data-field="${protocol}Model" data-lock>${models.map(([id,label]) =>
            `<option value="${id}">${label}</option>`).join('')}</select></label>
        <div class="studio-grid">
            <label>画幅比例<select data-field="${protocol}Aspect" data-lock>${options(capabilities.flatMap(c => c.aspects))}</select></label>
            <label>分辨率<select data-field="${protocol}Resolution" data-lock>${options(capabilities.flatMap(c => c.resolutions))}</select></label>
            ${protocol === 'grok' ? '<label data-field="grokQualityRow">画质<select data-field="grokQuality" data-lock><option value="auto">随模型</option><option value="low">低</option><option value="medium">中</option></select></label>' : ''}
        </div>
    </div>`;
}

export function workshopPanel(samplers) {
    const tabButtons = Object.entries(STUDIO_PAGES).map(([key, label]) =>
        `<button data-tab="${key}" aria-pressed="false">${label}</button>`).join('');
    const sizes = Object.entries(CANVASES).map(([key,label]) =>
        `<option value="${key}">${label} · ${key.replace('x',' × ')}</option>`).join('');
    const samplerOptions = Object.entries(samplers).map(([key,label]) => `<option value="${key}">${label}</option>`).join('');
    const modelButtons = Object.entries(MODEL_NAMES).map(([id, label]) =>
        `<button type="button" data-nai-model="${id}" aria-pressed="false" data-lock>${label}</button>`).join('');
    return `
    <header><h2>AVS 视觉工坊</h2><button type="button" data-field="close">关闭</button></header>
    <nav class="studio-nav" aria-label="视觉工坊页面">${tabButtons}</nav>
    <div class="studio-scroll" data-field="scroll">
      <section data-page="draw">
        <fieldset class="studio-models" data-field="naiModelRow">
          <legend data-field="naiModelLabel">生图模型</legend>
          <div class="studio-model-buttons">${modelButtons}</div>
          <input type="hidden" data-field="naiModel">
        </fieldset>
        <p class="studio-note">出图画风 · 碧蓝航线式二维立绘</p>
        <h3>画面来源</h3>
        <div class="studio-grid">
          <label>绘图方式<select data-field="mode" data-lock><option value="scene">AI 楼层配图</option><option value="manual">手写提示词</option></select></label>
          <label data-field="floorGroup">目标楼层<select data-field="floor" data-lock></select></label>
        </div>
        <p class="studio-note" data-field="excerpt"></p>
        <label data-field="focusGroup">画面重点（可选）<input data-field="focus" maxlength="400" placeholder="例如只画雨后从桥上离开的背影" data-lock></label>
        <div class="studio-row studio-chips">
          <button type="button" data-jump="styles" data-field="styleLink">画风</button>
          <button type="button" data-jump="prompts">编辑提示词</button>
        </div>
        <details class="studio-card" open>
          <summary>画布与张数</summary>
          <div class="studio-grid">
            <label data-field="canvasRow">画幅<select data-field="canvas" data-lock>${sizes}<option value="custom">自定义</option></select></label>
            <label data-field="widthGroup">宽度<input type="number" data-field="width" step="64" min="64" max="2048" data-lock></label>
            <label data-field="heightGroup">高度<input type="number" data-field="height" step="64" min="64" max="2048" data-lock></label>
            <label>每次张数<select data-field="count" data-lock><option>1</option><option>2</option><option>3</option><option>4</option></select></label>
            <label data-field="seedRow">种子<input type="number" data-field="seed" min="0" max="4294967295" placeholder="留空为随机" data-lock></label>
          </div>
          <p class="studio-note" data-field="otherDraw" hidden></p>
        </details>
        <details class="studio-card" data-nai-only>
          <summary>绘图预设</summary>
          <div class="studio-row">
            <label class="studio-grow">选择预设<select data-field="drawPreset" data-lock></select></label>
            <button type="button" data-field="presetApply" data-lock>应用</button>
          </div>
          <label>自定义预设名称<input data-field="presetName" maxlength="50" data-lock placeholder="例如 暖调竖幅"></label>
          <div class="studio-row">
            <button type="button" data-field="presetSave" data-lock>保存当前参数</button>
            <button type="button" data-field="presetDelete" data-lock>删除自定义预设</button>
          </div>
        </details>
        <details class="studio-card" data-nai-only>
          <summary>采样与出图偏好</summary>
          <div class="studio-grid">
            <label>采样器<select data-field="sampler" data-lock>${samplerOptions}</select></label>
            <label>步数 <output data-field="stepsOut"></output><input type="range" data-field="steps" min="1" max="50" data-lock></label>
            <label>引导强度 <output data-field="scaleOut"></output><input type="range" data-field="scale" min="1" max="10" step="0.1" data-lock></label>
            <label>CFG Rescale <output data-field="rescaleOut"></output><input type="range" data-field="rescale" min="0" max="1" step="0.05" data-lock></label>
            <label class="studio-check"><input type="checkbox" data-field="quality" data-lock>NovelAI 自动质量标签</label>
            <button type="button" data-field="resetDraw" data-lock>恢复绘图默认值</button>
          </div>
        </details>
        <figure data-field="result" hidden>
          <figcaption data-field="caption"></figcaption>
          <button class="studio-image-button" type="button" data-field="zoom" aria-label="查看原图"><img data-field="image" alt="本次生成的插画"></button>
          <div class="studio-row"><a data-field="download">下载原图</a><button type="button" data-jump="gallery">查看历史</button></div>
        </figure>
      </section>

      <section data-page="prompts" hidden>
        <h3>提示词编辑</h3>
        <p class="studio-note" data-field="draftSource"></p>
        <div class="studio-row">
          <button type="button" data-field="plan" data-lock>从楼层提取草稿</button>
          <button type="button" data-field="copyPrompt">复制当前提示词</button>
        </div>
        <label>正面提示词<textarea data-field="positive" rows="4" data-lock placeholder="场景、人数、动作、镜头和光影"></textarea></label>
        <label>负面提示词<textarea data-field="negative" rows="2" data-lock></textarea></label>
        <label class="studio-check"><input type="checkbox" data-field="applyStyle" data-lock>叠加已选参考画风</label>
        <div class="studio-row"><h3>独立人物提示词</h3><button type="button" data-field="addRole" data-lock>添加人物</button></div>
        <div class="studio-stack" data-field="roles"></div>
        <button class="studio-secondary" type="button" data-field="drawDraft" data-lock>按这份提示词生成</button>
      </section>

      <section data-page="styles" hidden>
        <h3>画风库</h3>
        <label>当前画风<select data-field="styles" data-lock></select></label>
        <label class="studio-file">上传参考图并提取画风<input data-field="upload" type="file" accept="image/png,image/jpeg,image/webp" data-lock></label>
        <details class="studio-card" open>
          <summary>编辑或新建画风</summary>
          <label>预设名称<input data-field="styleName" maxlength="70" data-lock></label>
          <div class="studio-grid" data-field="styleFields"></div>
          <label>附加正面词／画师串<textarea data-field="stylePositive" rows="3" data-lock></textarea></label>
          <label>画风负面词<textarea data-field="styleNegative" rows="2" data-lock></textarea></label>
          <div class="studio-row">
            <button type="button" data-field="styleUpdate" data-lock>更新所选画风</button>
            <button type="button" data-field="styleNew" data-lock>另存为新画风</button>
            <button type="button" data-field="styleRemove" data-lock>删除所选画风</button>
          </div>
        </details>
      </section>

      <section data-page="gallery" hidden>
        <h3>所选画面的生图历史</h3>
        <p class="studio-note" data-field="historyLabel"></p>
        <div class="studio-gallery" data-field="history"></div>
        <figure data-field="historyDetail" hidden>
          <button class="studio-image-button" type="button" data-field="historyZoom" aria-label="查看原图"><img data-field="historyImage" alt="历史插画"></button>
          <p data-field="historyMeta"></p>
          <details class="studio-card" data-field="metadataBox">
            <summary>查看出图参数与提示词</summary>
            <dl class="studio-metadata" data-field="metadataValues"></dl>
            <pre class="studio-prompt-view" data-field="metadataPrompt"></pre>
          </details>
          <div class="studio-row">
            <a data-field="historyDownload">下载原图</a>
            <button type="button" data-field="reuse" data-lock>载入提示词与参数</button>
            <button type="button" data-field="removeImage" data-lock>删除记录</button>
          </div>
        </figure>
        <details class="studio-card" data-field="compareBox" hidden>
          <summary>并排比较生成结果</summary>
          <div class="studio-grid studio-compare">
            <figure>
              <label>左侧插画<select data-field="compareLeft"></select></label>
              <img data-field="compareLeftImage" alt="左侧插画">
              <figcaption data-field="compareLeftCaption"></figcaption>
            </figure>
            <figure>
              <label>右侧插画<select data-field="compareRight"></select></label>
              <img data-field="compareRightImage" alt="右侧插画">
              <figcaption data-field="compareRightCaption"></figcaption>
            </figure>
          </div>
        </details>
      </section>

      <section data-page="settings" hidden>
        <h3>API 连接</h3>
        <div class="studio-card studio-stack">
          <h4>视觉提示词 API</h4>
          <label>API 地址<input data-field="visionBase" type="url" data-lock></label>
          <div class="studio-row"><label class="studio-grow">视觉模型名<input data-field="visionModel" autocomplete="off" data-lock></label>
            <button type="button" data-field="models" data-lock>获取模型</button></div>
          <label>视觉 API 密钥<input data-field="visionKey" type="password" autocomplete="off" data-lock></label>
          <label class="studio-check"><input data-field="useVisionPreset" type="checkbox" data-lock>使用对话补全预设</label>
          <div class="studio-row" data-field="visionPresetRow" hidden>
            <label class="studio-grow">所选预设<input data-field="visionPresetName" readonly placeholder="请选预设"></label>
            <button type="button" data-field="chooseVisionPreset" data-lock>选择预设</button>
          </div>
          <h4>生图连接</h4>
          <label>使用的接口<select data-field="imageProvider" data-lock>
            <option value="official">NovelAI 官方生图 API</option>
            <option value="other">其它生图 API</option>
          </select></label>
          <div class="studio-stack" data-field="officialConnection">
            <label>API 地址<input data-field="naiBase" type="url" readonly></label>
            <label>NovelAI Token<input data-field="naiKey" type="password" autocomplete="off" data-lock></label>
          </div>
          <div class="studio-stack" data-field="otherConnection" hidden>
            <label>兼容协议<select data-field="otherProtocol" data-lock>
              <option value="openai">OpenAI 兼容图片生成</option>
              <option value="nai">NovelAI 兼容图片生成</option>
              <option value="grok">${NATIVE_IMAGE_PROVIDERS.grok.label}</option>
              <option value="gemini">${NATIVE_IMAGE_PROVIDERS.gemini.label}</option>
            </select></label>
            <div class="studio-stack" data-field="compatibleConnection">
              <label>API 地址<input data-field="otherBase" type="url" data-lock></label>
              <label>API 密钥<input data-field="otherKey" type="password" autocomplete="off" data-lock></label>
              <div class="studio-row"><label class="studio-grow">生图模型名<input data-field="otherModel" autocomplete="off" data-lock></label>
                <button type="button" data-field="otherModels" data-lock>获取模型</button></div>
              <label data-field="otherSizeRow">画幅<select data-field="otherSize" data-lock>
                <option value="auto">由服务商决定</option>
                <option value="1024x1024">方形 · 1024 × 1024</option>
                <option value="1024x1536">竖幅 · 1024 × 1536</option>
                <option value="1536x1024">横幅 · 1536 × 1024</option>
              </select></label>
            </div>
            ${nativeImageConnection('grok')}
            ${nativeImageConnection('gemini')}
          </div>
          <label class="studio-check"><input data-field="remember" type="checkbox" data-lock>在此浏览器记住密钥</label>
        </div>
        <div class="studio-card studio-stack">
          <h4>画面资料与通知</h4>
          <label><select data-field="contextCount" aria-label="前文范围" data-lock><option value="0">只读取目标楼层</option><option value="2">附带前两条 AI 回复作背景</option></select></label>
          <label class="studio-check"><input type="checkbox" data-field="useArchive" data-lock>有资料时参考 AVS 角色档案</label>
          <label class="studio-check"><input type="checkbox" data-field="toasts" data-lock>完成或失败时发送酒馆通知</label>
        </div>
        <button type="button" data-field="save" data-lock>保存连接与偏好</button>
      </section>
    </div>
    <footer>
      <div data-field="progressBox" class="studio-progress" hidden>
        <p data-field="progressText"></p>
        <progress data-field="progress" max="1" aria-label="生图任务进度"></progress>
      </div>
      <p data-field="status" role="status" aria-live="polite"></p>
      <div class="studio-row">
        <button type="button" class="studio-primary studio-grow" data-field="make" data-lock>生成插画</button>
        <button type="button" data-field="cancel" hidden>取消任务</button>
      </div>
    </footer>`;
}
