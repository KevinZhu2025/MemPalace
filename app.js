const DATA_URL = "知识点文档.csv";
const FIELD_NAMES = ["图像提示词", "图片位置", "图片层级", "图片编号", "上层图片", "知识点", "显示方式"];
const API_BASE_URL = window.MEMPALACE_API_BASE_URL || "/api";
const GENERATION_POLL_INTERVAL_MS = 3000;
const GENERATION_POLL_TIMEOUT_MS = 15 * 60 * 1000;

// 图片统一由后端从数据库读取：/api/images/<图片编号>。
// 兼容历史数据：gallery/xxx.png 或其它旧路径会被转换为数据库端点。
function resolveImageUrl(id, rawLocation) {
  if (!rawLocation) return "";
  if (rawLocation.startsWith("/api/images/")) return rawLocation;
  return `${API_BASE_URL}/images/${id}`;
}

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
  imageLightbox: document.querySelector("#image-lightbox"),
  lightboxImage: document.querySelector("#lightbox-image"),
  lightboxCaption: document.querySelector("#lightbox-caption"),
  closeLightbox: document.querySelector("#close-lightbox"),
  knowledgeForm: document.querySelector("#knowledge-form"),
  knowledgeInput: document.querySelector("#knowledge-input"),
  knowledgeImage: document.querySelector("#knowledge-image"),
  uploadName: document.querySelector("#upload-name"),
  composerStatus: document.querySelector("#composer-status")
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
  const missingHeaders = FIELD_NAMES.filter((name) => name !== "显示方式" && !headers.includes(name));
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
    const displayMode = normalize(row[indexOf("显示方式")] || "") || "固定";
    if (!id) errors.push(`第 ${line} 行缺少图片编号。`);
    if (!Number.isInteger(level) || level < 1) errors.push(`第 ${line} 行的图片层级无效。`);
    if (nodes.has(id)) errors.push(`第 ${line} 行的图片编号 ${id} 重复。`);
    const rawLocation = normalize(row[indexOf("图片位置")] || "");
    nodes.set(id, {
      id,
      parentId,
      level,
      prompt: normalize(row[indexOf("图像提示词")] || ""),
      imageUrl: resolveImageUrl(id, rawLocation),
      knowledgeText: normalize(row[indexOf("知识点")] || ""),
      displayMode,
      imageState: rawLocation ? "ready" : "pending"
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

  // 排序：同一上层图片下，按图片编号“数值段”升序（从左到右）。
  // 例如 1.2 < 1.3 < ... < 1.10，避免按字符串把 1.10 排到 1.2 前面。
  const compareImageIds = (a, b) => {
    const pa = String(a).split(".");
    const pb = String(b).split(".");
    const length = Math.max(pa.length, pb.length);
    for (let i = 0; i < length; i += 1) {
      const sa = pa[i] ?? "";
      const sb = pb[i] ?? "";
      const na = Number(sa);
      const nb = Number(sb);
      if (sa !== "" && sb !== "" && Number.isInteger(na) && Number.isInteger(nb)) {
        if (na !== nb) return na - nb;
      } else {
        const diff = sa.localeCompare(sb, "zh-Hans-CN", { numeric: true });
        if (diff !== 0) return diff;
      }
    }
    return String(a).localeCompare(String(b));
  };

  children.forEach((list) => list.sort((x, y) => compareImageIds(x.id, y.id)));
  const roots = (children.get(null) || []).sort((x, y) => compareImageIds(x.id, y.id));
  return { nodes, children, roots };
}

function parseApiNodes(records) {
  if (!Array.isArray(records) || records.length === 0) {
    throw new Error("数据库中没有可展示的知识点记录。");
  }
  const escapeCsvValue = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const csvText = [FIELD_NAMES, ...records.map((record) => FIELD_NAMES.map((field) => record[field] ?? ""))]
    .map((row) => row.map(escapeCsvValue).join(","))
    .join("\n");
  return parseNodes(csvText);
}

function shortTitle(node) {
  const source = node.knowledgeText || node.prompt || `记忆节点 ${node.id}`;
  return source.length > 34 ? `${source.slice(0, 34)}…` : source;
}

function shortPreview(node) {
  if (!node.knowledgeText) return node.imageState === "pending" ? "图像尚未生成" : "暂无文字知识点";
  return node.knowledgeText.length > 95 ? `${node.knowledgeText.slice(0, 95)}…` : node.knowledgeText;
}

function setComposerStatus(message, isError = false) {
  if (!elements.composerStatus) return;
  elements.composerStatus.textContent = message;
  elements.composerStatus.classList.toggle("is-error", isError);
}

function wait(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

async function waitForGeneration(jobId) {
  const deadline = Date.now() + GENERATION_POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await wait(GENERATION_POLL_INTERVAL_MS);
    const response = await fetch(`${API_BASE_URL}/generations/${encodeURIComponent(jobId)}`);
    const job = await response.json();
    if (!response.ok) throw new Error(job.error || `生成任务不可用（${response.status}）`);
    if (job.status === "completed") return job.result;
    if (job.status === "failed") throw new Error(job.error || "图片生成失败");
  }
  throw new Error("图片生成时间过长，请稍后刷新页面查看是否已保存。");
}

async function submitKnowledge(event) {
  event.preventDefault();
  const knowledge = elements.knowledgeInput?.value.trim();
  const imageFile = elements.knowledgeImage?.files?.[0];
  if (!knowledge) return;

  const formData = new FormData();
  formData.append("knowledge", knowledge);
  if (imageFile) formData.append("image", imageFile);
  setComposerStatus("正在登记知识点...");
  try {
    const response = await fetch(`${API_BASE_URL}/generate`, { method: "POST", body: formData });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `服务暂不可用（${response.status}）`);
    if (response.status === 202) {
      setComposerStatus("正在生成图片，预计需要数分钟，请保持此页面打开...");
      const completedResult = await waitForGeneration(result.jobId);
      setComposerStatus("已保存到知识库，正在宫殿中展示");
      elements.knowledgeForm.reset();
      elements.uploadName.textContent = "未选择图片";
      await loadData();
      navigate(completedResult.id);
      return;
    }
    setComposerStatus("已保存到知识库，正在宫殿中展示");
    elements.knowledgeForm.reset();
    elements.uploadName.textContent = "未选择图片";
    await loadData();
    navigate(result.id);
  } catch (error) {
    setComposerStatus(error.message || "保存失败，请稍后重试", true);
  }
}

function getCaptionMode(node) {
  return /(悬浮|hover|float)/i.test(node.displayMode || "") ? "hover" : "fixed";
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
  image.tabIndex = 0;
  image.setAttribute("role", "button");
  image.setAttribute("aria-label", `放大查看${image.alt}`);
  image.addEventListener("error", () => {
    node.imageState = "failed";
    container.classList.add("image-failed");
    image.remove();
    const status = document.createElement("span");
    status.className = "image-error-label";
    status.textContent = "图片加载失败";
    container.append(status);
  });
  image.addEventListener("click", (event) => {
    event.stopPropagation();
    openImageLightbox(node);
  });
  image.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      event.stopPropagation();
      openImageLightbox(node);
    }
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
    addNodeImage(card, node, "card-image", "card-caption");
    button.append(content);
    card.append(button);
    elements.courseGrid.append(card);
  });
}

function renderRoom(node) {
  setView("room");
  state.currentId = node.id;
  const childNodes = (state.children.get(node.id) || []).filter((child) => child.parentId === node.id && child.level === node.level + 1);
  elements.roomTitle.textContent = shortTitle(node);
  elements.roomCaption.textContent = "探索房间里的每一个记忆锚点";
  const hideRoomAnchor = node.id === "1" || node.id === "2";
  elements.roomAnchor.classList.toggle("is-hidden", hideRoomAnchor);
  elements.roomAnchor.setAttribute("aria-label", node.imageState === "pending" ? "当前场景图片待生成" : "当前场景图片已就绪");
  elements.roomAnchor.replaceChildren();
  if (!hideRoomAnchor) addNodeImage(elements.roomAnchor, node, "room-image");
  elements.nodeList.replaceChildren();
  elements.emptyRoom.classList.toggle("is-hidden", childNodes.length > 0);

  childNodes.forEach((child, index) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "node-card";
    const descendants = state.children.get(child.id)?.length || 0;
    card.setAttribute("aria-label", descendants ? `进入${shortTitle(child)}，有 ${descendants} 个子节点` : `查看${shortTitle(child)}知识点`);
    card.innerHTML = `<span class="node-index">${node.id}.${index + 1}</span><span class="node-state">${child.imageState === "pending" ? "待生成" : "已就绪"}</span>`;
    addNodeImage(card, child, "node-image", "node-caption");
    card.addEventListener("click", () => { if (child.imageUrl) openImageLightbox(child); });
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

function openImageLightbox(node) {
  if (!node?.imageUrl) return;
  elements.lightboxImage.src = node.imageUrl;
  elements.lightboxImage.alt = node.prompt || `记忆节点 ${node.id}`;
  elements.lightboxCaption.textContent = node.knowledgeText || "";
  elements.lightboxCaption.classList.toggle("is-hidden", !node.knowledgeText);
  elements.imageLightbox.classList.add("is-open");
  elements.imageLightbox.setAttribute("aria-hidden", "false");
  document.body.classList.add("lightbox-open");
  elements.closeLightbox.focus();
}
function closeImageLightbox() {
  elements.imageLightbox.classList.remove("is-open");
  elements.imageLightbox.setAttribute("aria-hidden", "true");
  elements.lightboxImage.removeAttribute("src");
  elements.lightboxCaption.textContent = "";
  elements.lightboxCaption.classList.add("is-hidden");
  document.body.classList.remove("lightbox-open");
}

function openDetail(node) {
  state.detailNode = node;
  elements.detailTitle.textContent = shortTitle(node);
  elements.detailText.textContent = node.knowledgeText || "这个记忆锚点还没有添加知识点文字。";
  elements.detailId.textContent = node.id;
  elements.detailImageStatus.textContent = node.imageState === "pending" ? "待生成" : "已就绪";
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
    let parsed;
    let sourceLabel = "Azure SQL 知识库";
    try {
      const databaseResponse = await fetch(`${API_BASE_URL}/knowledge`, { cache: "no-store" });
      if (!databaseResponse.ok) throw new Error(`数据库接口返回 ${databaseResponse.status}`);
      parsed = parseApiNodes(await databaseResponse.json());
    } catch (databaseError) {
      sourceLabel = "本地 CSV 备用数据源";
      const csvResponse = await fetch(DATA_URL, { cache: "no-store" });
      if (!csvResponse.ok) throw new Error(`数据库和 ${DATA_URL} 均无法读取。`);
      parsed = parseNodes(await csvResponse.text());
    }
    if (parsed.roots.length === 0) throw new Error("CSV 中没有层级为 1 的课程入口。");
    state.nodes = parsed.nodes;
    state.children = parsed.children;
    state.roots = parsed.roots;
    const syncStatus = document.querySelector("#sync-status");
    if (syncStatus) syncStatus.textContent = sourceLabel;
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
elements.closeLightbox.addEventListener("click", closeImageLightbox);
elements.imageLightbox.addEventListener("click", (event) => { if (event.target === elements.imageLightbox) closeImageLightbox(); });
elements.knowledgeForm?.addEventListener("submit", submitKnowledge);
elements.knowledgeImage?.addEventListener("change", () => {
  const file = elements.knowledgeImage.files?.[0];
  elements.uploadName.textContent = file ? file.name : "未选择图片";
  setComposerStatus(file ? "图片已就绪，可提交" : "准备接收新的知识点");
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") { closeDetail(); closeImageLightbox(); }
});
window.addEventListener("hashchange", syncRoute);
loadData();
