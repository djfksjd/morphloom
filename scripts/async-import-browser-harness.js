// Test boundary only: original File.text reads actual bytes; completion order is controlled.
(() => {
  if (window.__morphloomImportTest) window.__morphloomImportTest.restore();
  const original = File.prototype.text, pending = new Map(), setTimer = window.setTimeout, clearTimer = window.clearTimeout;
  let expiry;
  window.setTimeout = function (callback, delay, ...args) { const id = setTimer.call(window, callback, delay, ...args); if (delay === 1800000 && typeof callback === 'function') expiry = { id, run: () => callback(...args) }; return id; };
  window.clearTimeout = function (id) { if (expiry?.id === id) expiry = undefined; return clearTimer.call(window, id); };
  File.prototype.text = function () {
    const file = this, read = original.call(file);
    if (!file.name.startsWith('async-')) return read;
    return read.then(text => new Promise((resolve, reject) => {
      if (pending.size >= 2 || pending.has(file.name)) throw new Error('Test pending-read budget exceeded');
      pending.set(file.name, { release: () => resolve(text), fail: () => reject(new Error('Delayed fixture read failure')) });
    }));
  };
  const finish = (name, fail) => { const request = pending.get(name); if (!request) throw new Error('Fixture not pending'); pending.delete(name); fail ? request.fail() : request.release(); };
  window.__morphloomImportTest = { release: name => finish(name, false), fail: name => finish(name, true), pending: () => Array.from(pending.keys()), fireExpiry: () => { if (!expiry) throw new Error('No live import TTL timer'); const task = expiry; expiry = undefined; clearTimer.call(window, task.id); task.run(); }, restore: () => { if (pending.size) throw new Error('Resolve test reads before cleanup'); File.prototype.text = original; window.setTimeout = setTimer; window.clearTimeout = clearTimer; } };
  return 'Only actual File.text completion order is controlled; no React state injection';
})()
