export function createAcademyFeedback(host) {
    const {document} = host;
    let activeConfirmation, activePicker, timer, toast, disposed = false;
    function button(message, emphasis) {
        const node = document.createElement('button');
        node.type = 'button';
        node.textContent = message;
        node.dataset.avsEmphasis = emphasis;
        return node;
    }
    function confirm(message, {title = '确认操作', accept = '确定', danger = false} = {}) {
        if (disposed || activeConfirmation) return Promise.resolve(false);
        return new Promise(resolve => {
            const opener = document.activeElement;
            const dialog = document.createElement('dialog');
            dialog.className = 'avs-academy-confirm';
            dialog.setAttribute('aria-labelledby', 'avs-academy-confirm-title');
            dialog.setAttribute('aria-describedby', 'avs-academy-confirm-message');
            dialog.innerHTML = `<header><h2 id="avs-academy-confirm-title"></h2></header>
                <div class="avs-academy-confirm-body"><p id="avs-academy-confirm-message"></p></div><footer></footer>`;
            dialog.querySelector('h2').textContent = title;
            dialog.querySelector('p').textContent = String(message);
            const cancel = button('取消','secondary');
            const proceed = button(accept,danger ? 'danger' : 'primary');
            cancel.autofocus = true;
            dialog.querySelector('footer').append(cancel,proceed);
            let finished = false;
            const finish = answer => {
                if (finished) return;
                finished = true;
                activeConfirmation = null;
                dialog.close?.();
                dialog.remove();
                if (opener?.isConnected) opener.focus({preventScroll:true});
                resolve(answer);
            };
            activeConfirmation = finish;
            cancel.onclick = () => finish(false);
            proceed.onclick = () => finish(true);
            dialog.addEventListener('cancel', event => { event.preventDefault(); finish(false); });
            dialog.addEventListener('close', () => finish(false));
            document.body.append(dialog);
            try { dialog.showModal(); }
            catch { finish(false); }
        });
    }
    function choose(title, values, selected) {
        if (disposed || activePicker || !values.length) return Promise.resolve(null);
        return new Promise(resolve => {
            const opener = document.activeElement;
            const dialog = document.createElement('dialog');
            dialog.className = 'avs-academy-confirm avs-academy-picker';
            dialog.setAttribute('aria-labelledby','avs-academy-picker-title');
            dialog.innerHTML = `<header><h2 id="avs-academy-picker-title"></h2></header>
                <label class="avs-picker-search">筛选<input type="search" autocomplete="off"></label>
                <div class="avs-academy-confirm-body avs-picker-rows" role="group" aria-label="可选项目"></div>`;
            dialog.querySelector('h2').textContent = title;
            const cancel = button('关闭','secondary');
            cancel.autofocus = true;
            dialog.querySelector('header').append(cancel);
            const input = dialog.querySelector('input');
            const rows = dialog.querySelector('.avs-picker-rows');
            let finished = false;
            const finish = value => {
                if (finished) return;
                finished = true;
                activePicker = null;
                if (dialog.open) dialog.close();
                dialog.remove();
                if (opener?.isConnected) opener.focus({preventScroll:true});
                resolve(value);
            };
            function render() {
                const filter = input.value.trim().toLowerCase();
                const buttons = values.filter(value => value.toLowerCase().includes(filter)).map(value => {
                    const row = button(value, 'secondary');
                    row.setAttribute('aria-pressed',String(value === selected));
                    row.onclick = () => finish(value);
                    return row;
                });
                if (!buttons.length) {
                    const empty = document.createElement('p');
                    empty.textContent = '没有匹配项。';
                    buttons.push(empty);
                }
                rows.replaceChildren(...buttons);
                rows.scrollTop = 0;
            }
            activePicker = finish;
            cancel.onclick = () => finish(null);
            input.oninput = render;
            dialog.addEventListener('cancel', event => { event.preventDefault(); finish(null); });
            dialog.addEventListener('close', () => finish(null));
            render();
            document.body.append(dialog);
            try { dialog.showModal(); }
            catch { finish(null); }
        });
    }
    function removeToast() {
        host.clearTimeout(timer);
        toast?.remove();
        toast = null;
    }
    function notice(message, type = 'info', title = 'AVS') {
        if (disposed) return false;
        removeToast();
        const level = ['success','warning','error'].includes(type) ? type : 'info';
        const box = document.createElement('aside');
        box.className = 'avs-academy-toast';
        box.dataset.level = level;
        box.setAttribute('role',level === 'error' ? 'alert' : 'status');
        box.setAttribute('popover','manual');
        const icon = document.createElement('span');
        icon.className = 'avs-academy-toast-icon';
        icon.setAttribute('aria-hidden','true');
        icon.textContent = ({success:'✓',warning:'!',error:'×',info:'i'})[level];
        const text = document.createElement('div');
        const heading = document.createElement('strong'), body = document.createElement('p');
        heading.textContent = title;
        body.textContent = message;
        text.append(heading,body);
        box.append(icon,text);
        document.body.append(box);
        toast = box;
        try { box.showPopover?.(); } catch { box.removeAttribute('popover'); }
        if (!box.showPopover) box.removeAttribute('popover');
        timer = host.setTimeout(removeToast,4000);
        return true;
    }
    return {confirm,choose,notice,dispose() { disposed = true; activeConfirmation?.(false); activePicker?.(null); removeToast(); }};
}
