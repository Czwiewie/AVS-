/* Adapted from AVS R2.10's NovelAI MessagePack decoder. */
const NAI_FRAME_LIMIT = 64 * 1024 * 1024;

function readNaiValue(bytes) {
    let cursor = 0, nodes = 0;
    const view = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    const decoder = new TextDecoder();
    function take(length) {
        if (length > bytes.length - cursor) throw Error('NovelAI 图像帧数据截断。');
        const part = bytes.subarray(cursor,cursor+length);
        cursor += length;
        return part;
    }
    function number(length, accessor) {
        const offset = cursor;
        take(length);
        return Number(view[accessor](offset,false));
    }
    function string(length) { return decoder.decode(take(length)); }
    function array(length, depth) {
        if (length > 100000) throw Error('NovelAI 图像帧数组过大。');
        return Array.from({length}, () => read(depth + 1));
    }
    function map(length, depth) {
        if (length > 10000) throw Error('NovelAI 图像帧对象过大。');
        const value = Object.create(null);
        for (let i = 0; i < length; i++) {
            const key = read(depth+1);
            if (typeof key !== 'string') throw Error('NovelAI 图像帧的字段无效。');
            value[key] = read(depth+1);
        }
        return value;
    }
    function read(depth = 0) {
        if (depth > 30 || ++nodes > 200000) throw Error('NovelAI 图像帧结构过深。');
        const code = number(1,'getUint8');
        if (code < 0x80) return code;
        if (code < 0x90) return map(code-0x80,depth);
        if (code < 0xa0) return array(code-0x90,depth);
        if (code < 0xc0) return string(code-0xa0);
        if (code >= 0xe0) return code-0x100;
        switch (code) {
            case 0xc0: return null;
            case 0xc2: return false;
            case 0xc3: return true;
            case 0xc4: return take(number(1,'getUint8'));
            case 0xc5: return take(number(2,'getUint16'));
            case 0xc6: return take(number(4,'getUint32'));
            case 0xca: return number(4,'getFloat32');
            case 0xcb: return number(8,'getFloat64');
            case 0xcc: return number(1,'getUint8');
            case 0xcd: return number(2,'getUint16');
            case 0xce: return number(4,'getUint32');
            case 0xcf: return number(8,'getBigUint64');
            case 0xd0: return number(1,'getInt8');
            case 0xd1: return number(2,'getInt16');
            case 0xd2: return number(4,'getInt32');
            case 0xd3: return number(8,'getBigInt64');
            case 0xd9: return string(number(1,'getUint8'));
            case 0xda: return string(number(2,'getUint16'));
            case 0xdb: return string(number(4,'getUint32'));
            case 0xdc: return array(number(2,'getUint16'),depth);
            case 0xdd: return array(number(4,'getUint32'),depth);
            case 0xde: return map(number(2,'getUint16'),depth);
            case 0xdf: return map(number(4,'getUint32'),depth);
            default: throw Error('NovelAI 图像帧包含未支持的 MessagePack 字段。');
        }
    }
    const value = read();
    if (cursor !== bytes.length) throw Error('NovelAI 图像帧包含多余数据。');
    return value;
}

export function isNaiStream(bytes, contentType) {
    if (/msgpack/i.test(contentType)) return true;
    // Length-prefixed event map, including relays returning octet-stream.
    if (bytes.length < 5) return false;
    const length = new DataView(bytes.buffer,bytes.byteOffset,4).getUint32(0);
    if (!length || length > NAI_FRAME_LIMIT) return false;
    const marker = bytes[4];
    return (marker >= 0x80 && marker <= 0x8f) || marker === 0xde || marker === 0xdf;
}

export function finalNaiFrame(bytes, readError) {
    const view = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    let cursor = 0, final;
    while (cursor < bytes.length) {
        if (bytes.length - cursor < 4) throw Error('NovelAI 图像流未完整结束。');
        const length = view.getUint32(cursor);
        if (!length || length > NAI_FRAME_LIMIT) throw Error('NovelAI 图像流帧长度无效。');
        cursor += 4;
        if (length > bytes.length - cursor) throw Error('NovelAI 图像流结束前有帧被截断。');
        const event = readNaiValue(bytes.subarray(cursor,cursor+length));
        cursor += length;
        if (event?.error || event?.event_type === 'error') throw readError(event.error || event);
        if (event?.event_type === 'final' && event.image) final = event.image;
    }
    if (!final) throw Error('NovelAI 图像流缺少最终帧，未保存预览图。');
    return final;
}
