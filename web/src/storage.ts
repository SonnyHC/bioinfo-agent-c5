// User files and outputs are scoped to this browser origin, never a server home.
const DATABASE = 'bioinfobuddy-browser-v1';
const STORES = ['datasets', 'plans', 'runs', 'chats', 'skills'] as const;
export type Store = typeof STORES[number];
let opening: Promise<IDBDatabase> | undefined;

function database() {
  opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 2);
    request.onupgradeneeded = () => {
      for (const name of STORES) {
        if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => { request.result.close(); opening = undefined; };
      resolve(request.result);
    };
    request.onerror = () => { opening = undefined; reject(new Error('浏览器存储不可用，请允许此网站保存数据。')); };
    request.onblocked = () => { opening = undefined; reject(new Error('请关闭此网站的其他旧标签页后重试。')); };
  });
  return opening;
}

async function operation<T>(store: Store, mode: IDBTransactionMode, action: (table: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(store, mode);
    const request = action(transaction.objectStore(store));
    // Resolve on durable transaction completion, not merely request success.
    transaction.oncomplete = () => resolve(request.result);
    transaction.onabort = () => reject(new Error(transaction.error?.name === 'QuotaExceededError'
      ? '浏览器存储空间不足，请导出结果并清理不需要的网站数据。' : '本地保存失败，请检查浏览器存储设置。'));
    transaction.onerror = () => { /* onabort owns rejection */ };
  });
}

export async function save<T extends { id: string }>(store: Store, value: T): Promise<T> {
  await operation(store, 'readwrite', table => table.put(value));
  return value;
}
export async function read<T>(store: Store, id: string): Promise<T> {
  const value = await operation<T | undefined>(store, 'readonly', table => table.get(id));
  if (!value) throw new Error('此浏览器中找不到这条记录。');
  return value;
}
export async function list<T extends { createdAt: string }>(store: Store): Promise<T[]> {
  const values = await operation<T[]>(store, 'readonly', table => table.getAll());
  return values.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function remove(store: Store, id: string): Promise<void> {
  await operation(store, 'readwrite', table => table.delete(id));
}
