const DATA_URL = "知识点文档.csv";
const FIELD_NAMES = ["图像提示词", "图片位置", "图片层级", "图片编号", "上层图片", "知识点"];

const state = {
  nodes: new Map(),
  children: new Map(),
  roots: [],
  currentId: null,
  breadcrumbs: [],
  detailNode: null
};

const elements = {
  loading: document.querySelector("#loading-state"),
  error: document.querySelector("#error-state"),
  errorMessage: document.querySelector("#error-message"),
  retry: document.querySelector("#retry-button"),
  hall: document.querySelector("#hall-view"),
  room: document.querySelector("#room-view"),
  courseGrid: document.querySelector("#course-grid"),
  courseCount: document.querySelector("#course-count"),
  roomTitle: document.querySelector("#room-title"),
  roomCaption: document.querySelector("#room-caption"),
  roomAnchor: document.querySelector("#room-anchor"),
  nodeList: document.querySelector("#node-list"),
  emptyRoom: document.querySelector("#empty-room"),
  breadcrumb: document.querySelector("#breadcrumb"),
  back: document.querySelector("#back-button"),
  brand: document.querySelector(".brand"),
  drawer: document.querySelector("#detail-drawer"),
  backdrop: document.querySelector("#drawer-backdrop"),
  closeDetail: document.querySelector("#close-detail"),
  detailTitle: document.querySelector("#detail-title"),
  detailText: document.querySelector("#detail-text"),
  detailId: document.querySelector("#detail-id"),
  detailImageStatus: document.querySelector("#detail-image-status"),
  detailPrompt: document.querySelector("#detail-prompt")
};

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];
    if (character === '"') {
      if (quoted && next === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      row.push(value);
      value = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && next === "\n") index += 1;
      row.push(value);
      if (row.some((cell) => cell.trim() !== "")) rows.push(row);
      row = [];
      value = "";
    } else {
      value += character;
    }
  }

  if (value !== "" || row.length > 0) {
    row.push(value);
    if (row.some((cell) => cell.trim() !== "")) rows.push(row);
  }
  return rows;
}

function normalize(value) {
  return value.trim().replace(/^\uFEFF/, "");
}

function parseNodes(csvText) {
  const rows = parseCsv(csvText);
  if (rows.length < 2) throw new Error("CSV 中没有可展示的知识点记录。");

  const headers = rows[0].map(normalize);
  const missingHeaders = FIELD_NAMES.filter((name) => !headers.includes(name));
  if (missingHeaders.length > 0) throw new Error(`CSV 缺少字段：${missingHeaders.join("、")}`);

  const indexOf = (name) => headers.indexOf(name);
  const nodes = new Map();
  const errors = [];

  rows.slice(1).forEach((row, rowIndex) => {
    const line = rowIndex + 2;
    const id = normalize(row[indexOf("图片编号")] || "");
    const parentValue = normalize(row[indexOf("上层图片")] || "");
    const parentId = parentValue === "无" ? null : parentValue;
    const levelText = normalize(row[indexOf("图片层级")] || "");
    const level = Number(levelText);
    if (!id) errors.push(`第 ${line} 行缺少图片编号。`);
    if (!Number.isInteger(level) || level < 1) errors.push(`第 ${line} 行的图片层级无效。`);
    if (nodes.has(id)) errors.push(`第 ${line} 行的图片编号 ${id} 重复。`);
    nodes.set(id, {
      id,
      parentId,
      level,
      prompt: normalize(row[indexOf("图像提示词")] || ""),
      imageUrl: normalize(row[indexOf("图片位置")] || ""),
      knowledgeText: normalize(row[indexOf("知识点")] || ""),
      imageState: normalize(row[indexOf("图片位置")] || "") ? "ready" : "pending"
    });
  });

  if (errors.length > 0) throw new Error(errors.join(" "));
  const children = new Map();
  nodes.forEach((node) => {
    if (node.parentId && !nodes.has(node.parentId)) {
      errors.push(`节点 ${node.id} 找不到父节点 ${node.parentId}。`);
    }
    if (!children.has(node.parentId)) children.set(node.parentId, []);
    children.get(node.parentId).push(node);
  });

  nodes.forEach((node) => {
    if (node.parentId) {
      const parent = nodes.get(node.parentId);
      if (parent && node.level !== parent.level + 1) errors.push(`节点 ${node.id} 与父节点层级不连续。`);
    }
    const visited = new Set([node.id]);
    let parentId = node.parentId;
    while (parentId) {
      if (visited.has(parentId)) {
        errors.push(`节点 ${node.id} 存在循环引用。`);
        break;
      }
      visited.add(parentId);
      parentId = nodes.get(parentId)?.parentId || null;
    }
  });

  if (errors.length > 0) throw new Error(errors.join(" "));
  return { nodes, children, roots: children.get(null) || [] };
}

function shortTitle(node) {
  if (node.id === "1") return "英语 · 英国古堡";
  const source = node.knowledgeText || node.prompt || `记忆节点 ${node.id}`;
  return source.length > 34 ? `${source.slice(0, 34)}…` : source;
}

function shortPreview(node) {
  if (!node.knowledgeText) return node.imageState === "pending" ? "图像尚未生成 · 点击查看提示词" : "暂无文字知识点";
  return node.knowledgeText.length > 95 ? `${node.knowledgeText.slice(0, 95)}…` : node.knowledgeText;
}

function addNodeImage(container, node, className) {
  if (!node.imageUrl) {
    container.classList.add("image-pending");
    return;
  }
  const image = document.createElement("img");
  image.className = className;
  image.src = node.imageUrl;
  image.alt = node.prompt || `记忆节点 ${node.id}`;
  image.loading = "lazy";
  image.addEventListener("error", () => {
    node.imageState = "failed";
    container.classList.add("image-failed");
    image.remove();
    const status = document.createElement("span");
    status.className = "image-error-label";
    status.textContent = "图片加载失败";
    container.append(status);
  });
  container.append(image);
}

function setView(view) {
  elements.loading.classList.add("is-hidden");
  elements.error.classList.toggle("is-hidden", view !== "error");
  elements.hall.classList.toggle("is-hidden", view !== "hall");
  elements.room.classList.toggle("is-hidden", view !== "room");
}

function renderHall() {
  setView("hall");
  elements.courseCount.textContent = `${state.roots.length} 座课程`;
  elements.courseGrid.replaceChildren();
  state.roots.forEach((node, index) => {
    const card = document.createElement("article");
    card.className = "course-card";
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("aria-label", `进入${shortTitle(node)}`);
    button.addEventListener("click", () => navigate(node.id));
    const content = document.createElement("div");
    content.className = "card-content";
    content.innerHTML = `<span class="card-number">0${index + 1}</span><h2 class="card-title">${escapeHtml(shortTitle(node))}</h2><span class="card-meta">${state.children.get(node.id)?.length || 0} 个记忆锚点 <span class="card-arrow" aria-hidden="true">↗</span></span>`;
    addNodeImage(card, node, "card-image");
    button.append(content);
    card.append(button);
    elements.courseGrid.append(card);
  });
}

function renderRoom(node) {
  setView("room");
  state.currentId = node.id;
  const childNodes = state.children.get(node.id) || [];
  elements.roomTitle.textContent = shortTitle(node);
  elements.roomCaption.textContent = node.knowledgeText || "探索房间里的每一个记忆锚点";
  elements.roomAnchor.setAttribute("aria-label", node.imageState === "pending" ? "当前场景图片待生成" : "当前场景图片已就绪");
  elements.roomAnchor.replaceChildren();
  addNodeImage(elements.roomAnchor, node, "room-image");
  elements.nodeList.replaceChildren();
  elements.emptyRoom.classList.toggle("is-hidden", childNodes.length > 0);

  childNodes.forEach((child, index) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "node-card";
    const descendants = state.children.get(child.id)?.length || 0;
    card.setAttribute("aria-label", descendants ? `进入${shortTitle(child)}，有 ${descendants} 个子节点` : `查看${shortTitle(child)}知识点`);
    card.innerHTML = `<span class="node-index">${node.id}.${index + 1}</span><span class="node-state">${child.imageState === "pending" ? "待生成" : "已就绪"}</span><strong class="node-title">${escapeHtml(shortTitle(child))}</strong><span class="node-preview">${escapeHtml(shortPreview(child))}</span>`;
    addNodeImage(card, child, "node-image");
    card.addEventListener("click", () => descendants ? navigate(child.id) : openDetail(child));
    elements.nodeList.append(card);
  });
  renderBreadcrumbs(node);
}

function renderBreadcrumbs(node) {
  const chain = [];
  let current = node;
  while (current) {
    chain.unshift(current);
    current = current.parentId ? state.nodes.get(current.parentId) : null;
  }
  elements.breadcrumb.replaceChildren();
  const home = document.createElement("button");
  home.type = "button";
  home.textContent = "大厅";
  home.addEventListener("click", () => goHome());
  elements.breadcrumb.append(home);
  chain.forEach((item, index) => {
    const separator = document.createElement("span");
    separator.textContent = "/";
    separator.setAttribute("aria-hidden", "true");
    elements.breadcrumb.append(separator);
    if (index === chain.length - 1) {
      const currentLabel = document.createElement("span");
      currentLabel.className = "current";
      currentLabel.textContent = shortTitle(item);
      elements.breadcrumb.append(currentLabel);
    } else {
      const link = document.createElement("button");
      link.type = "button";
      link.textContent = shortTitle(item);
      link.addEventListener("click", () => navigate(item.id));
      elements.breadcrumb.append(link);
    }
  });
}

function openDetail(node) {
  state.detailNode = node;
  elements.detailTitle.textContent = shortTitle(node);
  elements.detailText.textContent = node.knowledgeText || "这个记忆锚点还没有添加知识点文字。";
  elements.detailId.textContent = node.id;
  elements.detailImageStatus.textContent = node.imageState === "pending" ? "待生成" : "已就绪";
  elements.detailPrompt.textContent = node.prompt ? `图像提示词：${node.prompt}` : "暂无图像提示词";
  elements.drawer.classList.add("is-open");
  elements.drawer.setAttribute("aria-hidden", "false");
  elements.backdrop.classList.remove("is-hidden");
  elements.closeDetail.focus();
}

function closeDetail() {
  elements.drawer.classList.remove("is-open");
  elements.drawer.setAttribute("aria-hidden", "true");
  elements.backdrop.classList.add("is-hidden");
}

function navigate(id) {
  if (!state.nodes.has(id)) return;
  closeDetail();
  window.location.hash = `room/${encodeURIComponent(id)}`;
  renderRoom(state.nodes.get(id));
  elements.app?.focus();
}

function goHome() {
  closeDetail();
  window.location.hash = "";
  state.currentId = null;
  renderHall();
  elements.app?.focus();
}

function syncRoute() {
  const route = window.location.hash.slice(1);
  if (!route) {
    goHome();
    return;
  }
  const match = route.match(/^room\/(.+)$/);
  const id = match ? decodeURIComponent(match[1]) : "";
  if (state.nodes.has(id)) renderRoom(state.nodes.get(id));
  else goHome();
}

function escapeHtml(value) {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));
}

async function loadData() {
  setView("loading");
  try {
    const response = await fetch(DATA_URL, { cache: "no-store" });
    if (!response.ok) throw new Error(`无法读取 ${DATA_URL}（${response.status}）。`);
    const csvText = await response.text();
    const parsed = parseNodes(csvText);
    if (parsed.roots.length === 0) throw new Error("CSV 中没有层级为 1 的课程入口。");
    state.nodes = parsed.nodes;
    state.children = parsed.children;
    state.roots = parsed.roots;
    syncRoute();
  } catch (error) {
    elements.errorMessage.textContent = error.message || "请检查 CSV 文件格式后重试。";
    setView("error");
  }
}

elements.retry.addEventListener("click", loadData);
elements.back.addEventListener("click", goHome);
elements.brand.addEventListener("click", (event) => {
  event.preventDefault();
  goHome();
});
elements.closeDetail.addEventListener("click", closeDetail);
elements.backdrop.addEventListener("click", closeDetail);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeDetail();
});
window.addEventListener("hashchange", syncRoute);
loadData();
