const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const test = require('node:test');

function makeElement() {
  return {
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    replaceChildren() {},
    append() {},
    setAttribute() {},
    addEventListener() {},
    focus() {},
    textContent: '',
    innerHTML: '',
    className: '',
    style: {},
    value: '',
    removeAttribute() {}
  };
}

const appSource = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
const documentStub = {
  querySelector(selector) {
    const ids = [
      'loading-state', 'error-state', 'error-message', 'retry-button',
      'hall-view', 'room-view', 'course-grid', 'course-count', 'room-title',
      'room-caption', 'room-anchor', 'node-list', 'empty-room', 'breadcrumb',
      'back-button', 'detail-drawer', 'drawer-backdrop', 'close-detail',
      'detail-title', 'detail-text', 'detail-id', 'detail-image-status',
      'detail-prompt', 'image-lightbox', 'lightbox-image', 'lightbox-caption', 'close-lightbox'
    ];
    if (selector === '.brand') return makeElement();
    const key = selector.startsWith('#') ? selector.slice(1) : selector;
    return ids.includes(key) ? makeElement() : null;
  },
  addEventListener() {}
};

const windowStub = {
  location: { hash: '' },
  addEventListener() {}
};

const context = {
  console,
  document: documentStub,
  window: windowStub,
  fetch: async () => ({ ok: true, text: async () => '' }),
  setTimeout,
  clearTimeout
};

vm.createContext(context);
vm.runInContext(appSource.replace(/loadData\(\);\s*$/, ''), context);

const csvText = [
  '图像提示词,图片位置,图片层级,图片编号,上层图片,知识点,显示方式',
  '英国古堡大门,gallery/1.png,1,1,无,英语,固定',
  '"老旧扶手椅上坐着一位官僚，胸前贴着姓名“DYH""",gallery/1.1.png,2,1.1,1,Clumsy bureaucracy  institutionalized by constitution causes systemic dysfunction and leads the country into the mire.,悬浮'
].join('\n');

test('CSV parser accepts display mode and keeps prompt text internal', () => {
  const parsed = context.parseNodes(csvText);
  assert.equal(parsed.nodes.get('1').displayMode, '固定');
  assert.equal(parsed.nodes.get('1.1').displayMode, '悬浮');
  assert.equal(parsed.nodes.get('1').prompt, '英国古堡大门');
  assert.equal(parsed.roots.map((node) => node.id).join(','), '1');
});
