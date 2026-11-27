export function pictureLibrary(host, name) {
    let database;
    function openDatabase() {
        database ??= new Promise((resolve, reject) => {
            const request = host.indexedDB.open(name, 3);
            request.onupgradeneeded = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains('images')) db.createObjectStore('images');
                if (!db.objectStoreNames.contains('gallery')) {
                    db.createObjectStore('gallery', {keyPath:'id'}).createIndex('bySource', ['source', 'date', 'id']);
                }
                db.createObjectStore('identityImages');
            };
            request.onsuccess = () => {
                const db = request.result;
                db.onversionchange = () => { db.close(); database = undefined; };
                resolve(db);
            };
            request.onerror = () => reject(request.error);
            request.onblocked = () => reject(Error('请刷新其它已打开的酒馆页面，再读取历史。'));
        }).catch(error => { database = undefined; throw error; });
        return database;
    }
    async function operation(store, mode, handle) {
        const db = await openDatabase();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(store, mode);
            let result;
            handle(transaction.objectStore(store), value => { result = value; });
            transaction.oncomplete = () => resolve(result);
            transaction.onabort = () => reject(transaction.error ?? Error('本机图库操作失败。'));
        });
    }
    return {
        async list(source) {
            const rows = await operation('gallery', 'readonly', (store, result) => {
                const matches = [];
                const bounds = host.IDBKeyRange.bound([source.key, 0, ''], [source.key, Number.MAX_SAFE_INTEGER, '\uffff']);
                const request = store.index('bySource').openCursor(bounds, 'prev');
                request.onsuccess = () => {
                    const cursor = request.result;
                    if (!cursor || matches.length >= 30) return result(matches);
                    if (cursor.value.text === source.text) matches.push(cursor.value);
                    cursor.continue();
                };
            });
            if (rows.length) return rows;
            const old = await operation('images', 'readonly', (store, result) => {
                const request = store.get(source.key);
                request.onsuccess = () => result(request.result);
            });
            return old?.blob && old.text === source.text ? [{...old, index:source.index}] : [];
        },
        add(record) {
            return operation('gallery', 'readwrite', store => store.put(record));
        },
        drop(id) {
            return operation('gallery', 'readwrite', store => store.delete(id));
        },
        getIdentityImage(key) {
            return operation('identityImages','readonly',(store, result) => {
                const request = store.get(key);
                request.onsuccess = () => result(request.result);
            });
        },
        putIdentityImage(key, image) {
            return operation('identityImages','readwrite',store => store.put(image,key));
        },
        dropIdentityImage(key) {
            return operation('identityImages','readwrite',store => store.delete(key));
        },
        close() { database?.then(db => db.close()).catch(() => {}); }
    };
}
