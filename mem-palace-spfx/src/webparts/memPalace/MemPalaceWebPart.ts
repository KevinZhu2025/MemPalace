import { Version } from '@microsoft/sp-core-library';
import {
  IPropertyPaneConfiguration,
  PropertyPaneTextField
} from '@microsoft/sp-property-pane';
import { BaseClientSideWebPart } from '@microsoft/sp-webpart-base';

import * as strings from 'MemPalaceWebPartStrings';
import styles from './MemPalaceWebPart.module.scss';

export interface IMemPalaceWebPartProps {
  assetBaseUrl: string;
  csvUrl: string;
}

interface IMemoryNode {
  id: string;
  parentId: string | null;
  level: number;
  prompt: string;
  imageUrl: string;
  knowledgeText: string;
  imageState: 'ready' | 'pending' | 'failed';
}

interface IMemoryState {
  nodes: Map<string, IMemoryNode>;
  children: Map<string | null, IMemoryNode[]>;
  roots: IMemoryNode[];
  currentId: string | null;
  detailNode: IMemoryNode | null;
}

interface IMemPalaceElements {
  app: HTMLElement | null;
  loading: HTMLElement | null;
  error: HTMLElement | null;
  errorMessage: HTMLElement | null;
  retry: HTMLButtonElement | null;
  hall: HTMLElement | null;
  room: HTMLElement | null;
  courseGrid: HTMLElement | null;
  courseCount: HTMLElement | null;
  roomTitle: HTMLElement | null;
  roomCaption: HTMLElement | null;
  roomAnchor: HTMLElement | null;
  nodeList: HTMLElement | null;
  emptyRoom: HTMLElement | null;
  breadcrumb: HTMLElement | null;
  back: HTMLButtonElement | null;
  brand: HTMLElement | null;
  drawer: HTMLElement | null;
  backdrop: HTMLElement | null;
  closeDetail: HTMLButtonElement | null;
  detailTitle: HTMLElement | null;
  detailText: HTMLElement | null;
  detailId: HTMLElement | null;
  detailImageStatus: HTMLElement | null;
  detailPrompt: HTMLElement | null;
}

const FIELD_NAMES: string[] = ['图像提示词', '图片位置', '图片层级', '图片编号', '上层图片', '知识点'];
const DEFAULT_ASSET_FOLDER = 'SiteAssets/MemPalace';
const DEFAULT_CSV_NAME = '知识点文档.csv';

export default class MemPalaceWebPart extends BaseClientSideWebPart<IMemPalaceWebPartProps> {
  private state: IMemoryState = {
    nodes: new Map<string, IMemoryNode>(),
    children: new Map<string | null, IMemoryNode[]>(),
    roots: [],
    currentId: null,
    detailNode: null
  };

  private elements: IMemPalaceElements | undefined;
  private styleElement: HTMLStyleElement | undefined;
  private readonly onHashChange = (): void => this.syncRoute();
  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') this.closeDetail();
  };

  public render(): void {
    this.ensureScopedStyles();
    this.domElement.innerHTML = this.renderShell();
    this.elements = this.getElements();
    this.bindEvents();
    void this.loadData();
  }

  protected onInit(): Promise<void> {
    window.addEventListener('hashchange', this.onHashChange);
    document.addEventListener('keydown', this.onKeyDown);
    return Promise.resolve();
  }

  protected onDispose(): void {
    window.removeEventListener('hashchange', this.onHashChange);
    document.removeEventListener('keydown', this.onKeyDown);
    this.styleElement?.remove();
  }

  private renderShell(): string {
    return `
      <div class="${styles.memPalace}">
        <div class="app-shell">
          <header class="topbar">
            <a class="brand" href="#" aria-label="返回 MemPalace 首页">
              <span class="brand-mark" aria-hidden="true">M</span>
              <span>
                <strong>MemPalace</strong>
                <small>记忆宫殿</small>
              </span>
            </a>
            <div class="topbar-meta">
              <span class="status-dot" aria-hidden="true"></span>
              <span>SharePoint 知识库</span>
            </div>
          </header>
          <main class="main" tabindex="-1">
            <section class="state-panel loading-state" aria-live="polite">
              <span class="loader" aria-hidden="true"></span>
              <p>正在点亮宫殿地图...</p>
            </section>
            <section class="state-panel error-state is-hidden" aria-live="assertive">
              <span class="state-icon" aria-hidden="true">!</span>
              <h1>知识库暂时无法打开</h1>
              <p class="error-message">请检查 CSV 文件格式后重试。</p>
              <button class="button button-primary retry-button" type="button">重新加载</button>
            </section>
            <section class="view hall-view is-hidden" aria-labelledby="hall-title">
              <div class="hero-copy">
                <p class="eyebrow"><span class="eyebrow-line"></span> YOUR MEMORY PALACE</p>
                <h1 id="hall-title">走进你的<br><em>知识宫殿</em></h1>
                <p class="hero-description">把抽象的知识放进一座可以漫游的城堡。每一扇门，都是一个值得记住的连接。</p>
              </div>
              <div class="hall-intro">
                <div>
                  <span class="section-kicker">COURSE ARCHIVE</span>
                  <h2>选择一座宫殿</h2>
                </div>
                <span class="count-label course-count">0 座课程</span>
              </div>
              <div class="course-grid" aria-live="polite"></div>
            </section>
            <section class="view room-view is-hidden" aria-labelledby="room-title">
              <nav class="breadcrumb" aria-label="页面路径"></nav>
              <div class="room-heading">
                <div>
                  <p class="eyebrow"><span class="eyebrow-line"></span> EXPLORATION ROOM</p>
                  <h1 id="room-title" class="room-title">记忆房间</h1>
                </div>
                <button class="button button-quiet back-button" type="button">
                  <span aria-hidden="true">←</span> 返回大厅
                </button>
              </div>
              <div class="room-stage">
                <div class="stage-lights" aria-hidden="true"></div>
                <div class="stage-copy">
                  <span class="stage-label">CURRENT CHAMBER</span>
                  <p class="room-caption">探索房间里的每一个记忆锚点</p>
                </div>
                <div class="room-anchor"></div>
                <div class="node-list" aria-label="房间中的记忆节点"></div>
                <div class="empty-room is-hidden">
                  <span class="empty-icon" aria-hidden="true">✦</span>
                  <p>这里暂时没有下一扇门。</p>
                  <span>回到大厅，继续探索另一座宫殿。</span>
                </div>
              </div>
            </section>
          </main>
          <aside class="detail-drawer" aria-labelledby="detail-title" aria-hidden="true">
            <button class="icon-button close-detail" type="button" aria-label="关闭知识点详情">×</button>
            <div class="detail-accent" aria-hidden="true"></div>
            <span class="section-kicker">MEMORY NOTE</span>
            <h2 id="detail-title" class="detail-title">知识点</h2>
            <p class="detail-text"></p>
            <div class="detail-divider"></div>
            <dl class="detail-meta">
              <div><dt>记忆编号</dt><dd class="detail-id">-</dd></div>
              <div><dt>图像状态</dt><dd class="detail-image-status">待生成</dd></div>
            </dl>
            <p class="detail-prompt"></p>
          </aside>
          <div class="drawer-backdrop is-hidden"></div>
        </div>
      </div>`;
  }

  private getElements(): IMemPalaceElements {
    const root = this.domElement;
    return {
      app: root.querySelector('.main'),
      loading: root.querySelector('.loading-state'),
      error: root.querySelector('.error-state'),
      errorMessage: root.querySelector('.error-message'),
      retry: root.querySelector('.retry-button'),
      hall: root.querySelector('.hall-view'),
      room: root.querySelector('.room-view'),
      courseGrid: root.querySelector('.course-grid'),
      courseCount: root.querySelector('.course-count'),
      roomTitle: root.querySelector('.room-title'),
      roomCaption: root.querySelector('.room-caption'),
      roomAnchor: root.querySelector('.room-anchor'),
      nodeList: root.querySelector('.node-list'),
      emptyRoom: root.querySelector('.empty-room'),
      breadcrumb: root.querySelector('.breadcrumb'),
      back: root.querySelector('.back-button'),
      brand: root.querySelector('.brand'),
      drawer: root.querySelector('.detail-drawer'),
      backdrop: root.querySelector('.drawer-backdrop'),
      closeDetail: root.querySelector('.close-detail'),
      detailTitle: root.querySelector('.detail-title'),
      detailText: root.querySelector('.detail-text'),
      detailId: root.querySelector('.detail-id'),
      detailImageStatus: root.querySelector('.detail-image-status'),
      detailPrompt: root.querySelector('.detail-prompt')
    };
  }

  private bindEvents(): void {
    this.elements?.retry?.addEventListener('click', () => void this.loadData());
    this.elements?.back?.addEventListener('click', () => this.goHome());
    this.elements?.brand?.addEventListener('click', (event: Event) => {
      event.preventDefault();
      this.goHome();
    });
    this.elements?.closeDetail?.addEventListener('click', () => this.closeDetail());
    this.elements?.backdrop?.addEventListener('click', () => this.closeDetail());
  }

  private parseCsv(text: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let value = '';
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
      } else if (character === ',' && !quoted) {
        row.push(value);
        value = '';
      } else if ((character === '\n' || character === '\r') && !quoted) {
        if (character === '\r' && next === '\n') index += 1;
        row.push(value);
        if (row.some((cell) => cell.trim() !== '')) rows.push(row);
        row = [];
        value = '';
      } else {
        value += character;
      }
    }

    if (value !== '' || row.length > 0) {
      row.push(value);
      if (row.some((cell) => cell.trim() !== '')) rows.push(row);
    }

    return rows;
  }

  private parseNodes(csvText: string): Pick<IMemoryState, 'nodes' | 'children' | 'roots'> {
    const rows = this.parseCsv(csvText);
    if (rows.length < 2) throw new Error('CSV 中没有可展示的知识点记录。');

    const headers = rows[0].map((value) => this.normalize(value));
    const missingHeaders = FIELD_NAMES.filter((name) => headers.indexOf(name) === -1);
    if (missingHeaders.length > 0) throw new Error(`CSV 缺少字段：${missingHeaders.join('、')}`);

    const indexOf = (name: string): number => headers.indexOf(name);
    const nodes = new Map<string, IMemoryNode>();
    const errors: string[] = [];

    rows.slice(1).forEach((row, rowIndex) => {
      const line = rowIndex + 2;
      const id = this.normalize(row[indexOf('图片编号')] || '');
      const parentValue = this.normalize(row[indexOf('上层图片')] || '');
      const parentId = parentValue === '无' ? null : parentValue;
      const levelText = this.normalize(row[indexOf('图片层级')] || '');
      const level = Number(levelText);
      const imageUrl = this.normalize(row[indexOf('图片位置')] || '');

      if (!id) errors.push(`第 ${line} 行缺少图片编号。`);
      if (!this.isPositiveInteger(level)) errors.push(`第 ${line} 行的图片层级无效。`);
      if (nodes.has(id)) errors.push(`第 ${line} 行的图片编号 ${id} 重复。`);

      nodes.set(id, {
        id,
        parentId,
        level,
        prompt: this.normalize(row[indexOf('图像提示词')] || ''),
        imageUrl,
        knowledgeText: this.normalize(row[indexOf('知识点')] || ''),
        imageState: imageUrl ? 'ready' : 'pending'
      });
    });

    if (errors.length > 0) throw new Error(errors.join(' '));

    const children = new Map<string | null, IMemoryNode[]>();
    nodes.forEach((node) => {
      if (node.parentId && !nodes.has(node.parentId)) {
        errors.push(`节点 ${node.id} 找不到父节点 ${node.parentId}。`);
      }
      if (!children.has(node.parentId)) children.set(node.parentId, []);
      children.get(node.parentId)?.push(node);
    });

    nodes.forEach((node) => {
      if (node.parentId) {
        const parent = nodes.get(node.parentId);
        if (parent && node.level !== parent.level + 1) errors.push(`节点 ${node.id} 与父节点层级不连续。`);
      }

      const visited = new Set<string>([node.id]);
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

    if (errors.length > 0) throw new Error(errors.join(' '));
    return { nodes, children, roots: children.get(null) || [] };
  }

  private normalize(value: string): string {
    return value.trim().replace(/^\uFEFF/, '');
  }

  private isPositiveInteger(value: number): boolean {
    return isFinite(value) && Math.floor(value) === value && value >= 1;
  }

  private shortTitle(node: IMemoryNode): string {
    if (node.id === '1') return '英语 · 英国古堡';
    const source = node.knowledgeText || node.prompt || `记忆节点 ${node.id}`;
    return source.length > 34 ? `${source.slice(0, 34)}...` : source;
  }

  private shortPreview(node: IMemoryNode): string {
    if (!node.knowledgeText) return node.imageState === 'pending' ? '图像尚未生成 · 点击查看提示词' : '暂无文字知识点';
    return node.knowledgeText.length > 95 ? `${node.knowledgeText.slice(0, 95)}...` : node.knowledgeText;
  }

  private addNodeImage(container: HTMLElement, node: IMemoryNode, className: string): void {
    if (!node.imageUrl) {
      container.classList.add('image-pending');
      return;
    }

    const image = document.createElement('img');
    image.className = className;
    image.src = this.resolveAssetUrl(node.imageUrl);
    image.alt = node.prompt || `记忆节点 ${node.id}`;
    image.loading = 'lazy';
    image.addEventListener('error', () => {
      node.imageState = 'failed';
      container.classList.add('image-failed');
      image.remove();
      const status = document.createElement('span');
      status.className = 'image-error-label';
      status.textContent = '图片加载失败';
      container.append(status);
    });
    container.append(image);
  }

  private setView(view: 'loading' | 'error' | 'hall' | 'room'): void {
    this.elements?.loading?.classList.toggle('is-hidden', view !== 'loading');
    this.elements?.error?.classList.toggle('is-hidden', view !== 'error');
    this.elements?.hall?.classList.toggle('is-hidden', view !== 'hall');
    this.elements?.room?.classList.toggle('is-hidden', view !== 'room');
  }

  private renderHall(): void {
    this.setView('hall');
    if (this.elements?.courseCount) this.elements.courseCount.textContent = `${this.state.roots.length} 座课程`;
    this.elements?.courseGrid?.replaceChildren();

    this.state.roots.forEach((node, index) => {
      const card = document.createElement('article');
      card.className = 'course-card';
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('aria-label', `进入${this.shortTitle(node)}`);
      button.addEventListener('click', () => this.navigate(node.id));
      const content = document.createElement('div');
      content.className = 'card-content';
      content.innerHTML = `<span class="card-number">0${index + 1}</span><h2 class="card-title">${this.escapeHtml(this.shortTitle(node))}</h2><span class="card-meta">${this.state.children.get(node.id)?.length || 0} 个记忆锚点 <span class="card-arrow" aria-hidden="true">↗</span></span>`;
      this.addNodeImage(card, node, 'card-image');
      button.append(content);
      card.append(button);
      this.elements?.courseGrid?.append(card);
    });
  }

  private renderRoom(node: IMemoryNode): void {
    this.setView('room');
    this.state.currentId = node.id;
    const childNodes = this.state.children.get(node.id) || [];

    if (this.elements?.roomTitle) this.elements.roomTitle.textContent = this.shortTitle(node);
    if (this.elements?.roomCaption) this.elements.roomCaption.textContent = node.knowledgeText || '探索房间里的每一个记忆锚点';
    this.elements?.roomAnchor?.setAttribute('aria-label', node.imageState === 'pending' ? '当前场景图片待生成' : '当前场景图片已就绪');
    this.elements?.roomAnchor?.replaceChildren();
    if (this.elements?.roomAnchor) this.addNodeImage(this.elements.roomAnchor, node, 'room-image');
    this.elements?.nodeList?.replaceChildren();
    this.elements?.emptyRoom?.classList.toggle('is-hidden', childNodes.length > 0);

    childNodes.forEach((child, index) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'node-card';
      const descendants = this.state.children.get(child.id)?.length || 0;
      card.setAttribute('aria-label', descendants ? `进入${this.shortTitle(child)}，有 ${descendants} 个子节点` : `查看${this.shortTitle(child)}知识点`);
      card.innerHTML = `<span class="node-index">${node.id}.${index + 1}</span><span class="node-state">${child.imageState === 'pending' ? '待生成' : '已就绪'}</span><strong class="node-title">${this.escapeHtml(this.shortTitle(child))}</strong><span class="node-preview">${this.escapeHtml(this.shortPreview(child))}</span>`;
      this.addNodeImage(card, child, 'node-image');
      card.addEventListener('click', () => descendants ? this.navigate(child.id) : this.openDetail(child));
      this.elements?.nodeList?.append(card);
    });

    this.renderBreadcrumbs(node);
  }

  private renderBreadcrumbs(node: IMemoryNode): void {
    const chain: IMemoryNode[] = [];
    let current: IMemoryNode | undefined = node;

    while (current) {
      chain.unshift(current);
      current = current.parentId ? this.state.nodes.get(current.parentId) : undefined;
    }

    this.elements?.breadcrumb?.replaceChildren();
    const home = document.createElement('button');
    home.type = 'button';
    home.textContent = '大厅';
    home.addEventListener('click', () => this.goHome());
    this.elements?.breadcrumb?.append(home);

    chain.forEach((item, index) => {
      const separator = document.createElement('span');
      separator.textContent = '/';
      separator.setAttribute('aria-hidden', 'true');
      this.elements?.breadcrumb?.append(separator);

      if (index === chain.length - 1) {
        const currentLabel = document.createElement('span');
        currentLabel.className = 'current';
        currentLabel.textContent = this.shortTitle(item);
        this.elements?.breadcrumb?.append(currentLabel);
      } else {
        const link = document.createElement('button');
        link.type = 'button';
        link.textContent = this.shortTitle(item);
        link.addEventListener('click', () => this.navigate(item.id));
        this.elements?.breadcrumb?.append(link);
      }
    });
  }

  private openDetail(node: IMemoryNode): void {
    this.state.detailNode = node;
    if (this.elements?.detailTitle) this.elements.detailTitle.textContent = this.shortTitle(node);
    if (this.elements?.detailText) this.elements.detailText.textContent = node.knowledgeText || '这个记忆锚点还没有添加知识点文字。';
    if (this.elements?.detailId) this.elements.detailId.textContent = node.id;
    if (this.elements?.detailImageStatus) this.elements.detailImageStatus.textContent = node.imageState === 'pending' ? '待生成' : '已就绪';
    if (this.elements?.detailPrompt) this.elements.detailPrompt.textContent = node.prompt ? `图像提示词：${node.prompt}` : '暂无图像提示词';
    this.elements?.drawer?.classList.add('is-open');
    this.elements?.drawer?.setAttribute('aria-hidden', 'false');
    this.elements?.backdrop?.classList.remove('is-hidden');
    this.elements?.closeDetail?.focus();
  }

  private closeDetail(): void {
    this.elements?.drawer?.classList.remove('is-open');
    this.elements?.drawer?.setAttribute('aria-hidden', 'true');
    this.elements?.backdrop?.classList.add('is-hidden');
  }

  private navigate(id: string): void {
    const node = this.state.nodes.get(id);
    if (!node) return;
    this.closeDetail();
    window.location.hash = `mem-palace/room/${encodeURIComponent(id)}`;
    this.renderRoom(node);
    this.elements?.app?.focus();
  }

  private goHome(): void {
    this.closeDetail();
    window.location.hash = 'mem-palace';
    this.state.currentId = null;
    this.renderHall();
    this.elements?.app?.focus();
  }

  private syncRoute(): void {
    const route = window.location.hash.slice(1);
    if (!route || route === 'mem-palace') {
      this.goHome();
      return;
    }

    const match = route.match(/^mem-palace\/room\/(.+)$/);
    const id = match ? decodeURIComponent(match[1]) : '';
    const node = this.state.nodes.get(id);
    if (node) this.renderRoom(node);
    else this.goHome();
  }

  private escapeHtml(value: string): string {
    return value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character] || character));
  }

  private async loadData(): Promise<void> {
    this.setView('loading');
    try {
      const dataUrl = this.resolveAssetUrl(this.properties.csvUrl || DEFAULT_CSV_NAME);
      const response = await fetch(dataUrl, { cache: 'no-store', credentials: 'same-origin' });
      if (!response.ok) throw new Error(`无法读取 ${dataUrl}（${response.status}）。`);
      const csvText = await response.text();
      const parsed = this.parseNodes(csvText);
      if (parsed.roots.length === 0) throw new Error('CSV 中没有层级为 1 的课程入口。');
      this.state.nodes = parsed.nodes;
      this.state.children = parsed.children;
      this.state.roots = parsed.roots;
      this.syncRoute();
    } catch (error) {
      if (this.elements?.errorMessage) this.elements.errorMessage.textContent = error instanceof Error ? error.message : '请检查 CSV 文件格式后重试。';
      this.setView('error');
    }
  }

  private resolveAssetUrl(pathOrUrl: string): string {
    const value = pathOrUrl.trim();
    if (!value) return value;
    if (/^https?:\/\//i.test(value) || value.indexOf('/') === 0) return value;

    const base = this.getAssetBaseUrl().replace(/\/$/, '');
    const encodedPath = value.split('/').map((segment) => encodeURIComponent(segment)).join('/');
    return `${base}/${encodedPath}`;
  }

  private getAssetBaseUrl(): string {
    if (this.properties.assetBaseUrl && this.properties.assetBaseUrl.trim()) return this.properties.assetBaseUrl.trim();
    const webUrl = this.context.pageContext.web.serverRelativeUrl.replace(/\/$/, '');
    return `${webUrl}/${DEFAULT_ASSET_FOLDER}`;
  }

  private ensureScopedStyles(): void {
    if (this.styleElement) return;
    this.styleElement = document.createElement('style');
    this.styleElement.textContent = this.getCss(`.${styles.memPalace}`);
    document.head.append(this.styleElement);
  }

  private getCss(scope: string): string {
    return `
${scope} { --ink: #f5efe3; --muted: #b8b09f; --quiet: #817b6f; --night: #11151a; --deep: #171d22; --panel: #202a2e; --line: rgba(231, 215, 180, .18); --gold: #d7a85d; --gold-bright: #f1c679; --red: #9c5144; --shadow: 0 24px 70px rgba(0, 0, 0, .32); position: relative; color: var(--ink); background: radial-gradient(circle at 16% 7%, rgba(156, 81, 68, .16), transparent 26rem), radial-gradient(circle at 86% 35%, rgba(215, 168, 93, .09), transparent 30rem), linear-gradient(125deg, #11151a 0%, #182126 48%, #101317 100%); font-family: "Noto Sans SC", sans-serif; line-height: 1.6; }
${scope}, ${scope} * { box-sizing: border-box; }
${scope}::before { position: absolute; inset: 0; z-index: 0; pointer-events: none; opacity: .22; content: ""; background-image: linear-gradient(rgba(255,255,255,.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.02) 1px, transparent 1px); background-size: 54px 54px; }
${scope} button, ${scope} a { font: inherit; }
${scope} button { cursor: pointer; }
${scope} a { color: inherit; text-decoration: none; }
${scope} .app-shell { position: relative; z-index: 1; min-height: 100vh; overflow: hidden; }
${scope} .topbar { display: flex; align-items: center; justify-content: space-between; width: min(100% - 72px, 1440px); margin: 0 auto; padding: 28px 0 18px; }
${scope} .brand { display: inline-flex; align-items: center; gap: 12px; }
${scope} .brand-mark { display: grid; width: 38px; height: 38px; place-items: center; border: 1px solid var(--gold); color: var(--gold-bright); font-family: Georgia, serif; font-size: 25px; font-weight: 700; }
${scope} .brand strong, ${scope} .brand small { display: block; line-height: 1.1; }
${scope} .brand strong { letter-spacing: .08em; font-family: Georgia, serif; font-size: 21px; }
${scope} .brand small { margin-top: 3px; color: var(--quiet); font-size: 10px; letter-spacing: .22em; }
${scope} .topbar-meta { color: var(--quiet); font-size: 11px; letter-spacing: .1em; text-transform: uppercase; }
${scope} .status-dot { display: inline-block; width: 7px; height: 7px; margin-right: 7px; border-radius: 50%; background: #7aa77b; box-shadow: 0 0 13px #7aa77b; }
${scope} .main { width: min(100% - 72px, 1440px); min-height: calc(100vh - 87px); margin: 0 auto; padding: 36px 0 80px; }
${scope} .view { animation: memPalaceReveal .55s ease both; }
${scope} .is-hidden { display: none !important; }
${scope} .hero-copy { max-width: 760px; padding: 58px 0 75px 8%; }
${scope} .eyebrow, ${scope} .section-kicker, ${scope} .stage-label { color: var(--gold); font-size: 11px; letter-spacing: .2em; text-transform: uppercase; }
${scope} .eyebrow { display: flex; align-items: center; gap: 11px; margin: 0 0 18px; }
${scope} .eyebrow-line { display: inline-block; width: 28px; height: 1px; background: var(--gold); }
${scope} h1, ${scope} h2, ${scope} p { margin-top: 0; }
${scope} h1, ${scope} h2 { font-family: Georgia, serif; font-weight: 600; line-height: .95; }
${scope} .hero-copy h1 { max-width: 640px; margin-bottom: 26px; font-size: clamp(58px, 8vw, 110px); letter-spacing: 0; }
${scope} .hero-copy h1 em { color: var(--gold-bright); font-style: normal; }
${scope} .hero-description { max-width: 390px; margin: 0; color: var(--muted); font-size: 15px; }
${scope} .hall-intro { display: flex; align-items: end; justify-content: space-between; border-top: 1px solid var(--line); padding: 28px 0 20px; }
${scope} .hall-intro h2 { margin: 8px 0 0; font-size: 35px; }
${scope} .count-label { color: var(--quiet); font-size: 13px; }
${scope} .course-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(270px, 1fr)); gap: 18px; }
${scope} .course-card { position: relative; min-height: 310px; padding: 26px; overflow: hidden; border: 1px solid var(--line); background: linear-gradient(145deg, rgba(68, 73, 67, .8), rgba(24, 31, 34, .96) 68%); box-shadow: var(--shadow); transition: transform .25s ease, border-color .25s ease; }
${scope} .course-card::before { position: absolute; inset: 0; content: ""; opacity: .55; background: linear-gradient(135deg, transparent 28%, rgba(215,168,93,.16), transparent 70%), repeating-linear-gradient(110deg, rgba(255,255,255,.03) 0 2px, transparent 2px 13px); }
${scope} .course-card:hover, ${scope} .course-card:focus-within { transform: translateY(-5px); border-color: var(--gold); }
${scope} .course-card button { position: absolute; inset: 0; z-index: 1; width: 100%; border: 0; background: transparent; color: inherit; text-align: left; }
${scope} .card-image { position: absolute; inset: 0; z-index: 0; width: 100%; height: 100%; object-fit: cover; opacity: .46; mix-blend-mode: screen; }
${scope} .course-card.image-failed::after, ${scope} .course-card.image-pending::after { position: absolute; top: 22px; right: 24px; color: var(--gold); content: "待生成"; font-size: 10px; letter-spacing: .12em; text-transform: uppercase; }
${scope} .course-card.image-failed::after { color: #d78271; content: "图片加载失败"; }
${scope} .card-content { position: absolute; right: 26px; bottom: 25px; left: 26px; z-index: 2; pointer-events: none; }
${scope} .card-number { color: var(--gold); font-family: Georgia, serif; font-size: 20px; }
${scope} .card-title { max-width: 310px; margin: 8px 0 11px; font-family: Georgia, serif; font-size: 34px; line-height: 1; }
${scope} .card-meta { color: var(--muted); font-size: 12px; }
${scope} .card-arrow { position: absolute; right: 0; bottom: 0; color: var(--gold-bright); font-size: 24px; }
${scope} .breadcrumb { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; min-height: 26px; color: var(--quiet); font-size: 12px; }
${scope} .breadcrumb button { padding: 0; border: 0; color: var(--muted); background: transparent; }
${scope} .breadcrumb button:hover { color: var(--gold-bright); }
${scope} .breadcrumb .current { color: var(--gold); }
${scope} .room-heading { display: flex; align-items: end; justify-content: space-between; gap: 24px; padding: 38px 0 28px; }
${scope} .room-heading h1 { margin: 0; font-size: clamp(48px, 6vw, 78px); }
${scope} .button { display: inline-flex; align-items: center; justify-content: center; gap: 9px; min-height: 42px; padding: 10px 17px; border: 1px solid var(--line); color: var(--ink); background: transparent; font-size: 13px; transition: .2s ease; }
${scope} .button:hover, ${scope} .button:focus-visible { border-color: var(--gold); color: var(--gold-bright); }
${scope} .button-primary { border-color: var(--gold); background: var(--gold); color: var(--night); }
${scope} .button-primary:hover, ${scope} .button-primary:focus-visible { background: var(--gold-bright); color: var(--night); }
${scope} .button-quiet { color: var(--muted); }
${scope} .room-stage { position: relative; min-height: 540px; overflow: hidden; border: 1px solid var(--line); background: radial-gradient(ellipse at 50% 78%, rgba(215,168,93,.19), transparent 24%), linear-gradient(180deg, rgba(36, 44, 45, .95), rgba(15, 19, 22, .98)); box-shadow: var(--shadow); }
${scope} .room-stage::before { position: absolute; inset: 0; content: ""; opacity: .42; background: repeating-linear-gradient(90deg, transparent 0 70px, rgba(255,255,255,.025) 70px 72px), linear-gradient(105deg, transparent 28%, rgba(255,255,255,.04) 29%, transparent 31%); }
${scope} .room-stage::after { position: absolute; right: 8%; bottom: -15%; left: 8%; height: 45%; border-radius: 50% 50% 0 0; border: 1px solid rgba(215,168,93,.23); content: ""; box-shadow: 0 0 0 26px rgba(215,168,93,.025), 0 0 80px rgba(215,168,93,.12); }
${scope} .stage-lights::before, ${scope} .stage-lights::after { position: absolute; top: 14%; width: 150px; height: 260px; border-radius: 50%; content: ""; filter: blur(28px); opacity: .16; background: var(--gold); }
${scope} .stage-lights::before { left: 10%; } ${scope} .stage-lights::after { right: 10%; opacity: .1; }
${scope} .stage-copy { position: absolute; top: 32px; left: 34px; z-index: 1; }
${scope} .stage-copy p { margin: 5px 0 0; color: var(--muted); font-size: 13px; }
${scope} .room-anchor { position: absolute; top: 37%; left: 50%; width: 142px; height: 142px; transform: translate(-50%, -50%) rotate(45deg); border: 1px solid rgba(215,168,93,.52); background: rgba(215,168,93,.06); box-shadow: 0 0 45px rgba(215,168,93,.11); }
${scope} .room-anchor::after { position: absolute; inset: 16px; border: 1px solid rgba(215,168,93,.28); content: ""; }
${scope} .room-image { position: absolute; inset: 0; z-index: 1; width: 100%; height: 100%; transform: rotate(-45deg) scale(1.08); object-fit: cover; opacity: .72; }
${scope} .room-anchor.image-pending::before { position: absolute; top: 50%; left: 50%; z-index: 2; transform: translate(-50%, -50%) rotate(-45deg); color: var(--gold); content: "待生成"; font-size: 10px; letter-spacing: .12em; text-transform: uppercase; white-space: nowrap; }
${scope} .room-anchor.image-failed::before { position: absolute; top: 50%; left: 50%; z-index: 2; transform: translate(-50%, -50%) rotate(-45deg); color: #d78271; content: "加载失败"; font-size: 10px; letter-spacing: .12em; text-transform: uppercase; white-space: nowrap; }
${scope} .node-list { position: absolute; right: 8%; bottom: 38px; left: 8%; z-index: 2; display: grid; grid-template-columns: repeat(auto-fit, minmax(205px, 1fr)); gap: 13px; }
${scope} .node-card { position: relative; min-height: 144px; padding: 18px 92px 18px 18px; overflow: hidden; border: 1px solid rgba(231,215,180,.22); background: rgba(21, 28, 30, .85); color: inherit; text-align: left; box-shadow: 0 12px 28px rgba(0,0,0,.2); transition: transform .22s ease, background .22s ease, border-color .22s ease; }
${scope} .node-card:hover, ${scope} .node-card:focus-visible { transform: translateY(-4px); border-color: var(--gold); background: rgba(40, 47, 46, .96); }
${scope} .node-image { position: absolute; top: 0; right: 0; bottom: 0; width: 78px; height: 100%; object-fit: cover; opacity: .7; }
${scope} .node-card.image-pending::after, ${scope} .node-card.image-failed::after { position: absolute; right: 17px; bottom: 17px; color: var(--gold); content: "待生成"; font-size: 9px; letter-spacing: .08em; text-transform: uppercase; }
${scope} .node-card.image-failed::after { color: #d78271; content: "加载失败"; }
${scope} .image-error-label { position: absolute; top: 50%; left: 50%; z-index: 2; transform: translate(-50%, -50%); color: #d78271; font-size: 10px; white-space: nowrap; }
${scope} .node-index { color: var(--gold); font-family: Georgia, serif; font-size: 20px; }
${scope} .node-title { display: -webkit-box; max-width: 270px; margin: 8px 0 8px; overflow: hidden; color: var(--ink); font-family: Georgia, serif; font-size: 21px; line-height: 1.05; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; }
${scope} .node-preview { display: -webkit-box; overflow: hidden; color: var(--muted); font-size: 11px; line-height: 1.45; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; }
${scope} .node-state { position: absolute; top: 17px; right: 17px; color: var(--gold); font-size: 10px; letter-spacing: .08em; text-transform: uppercase; }
${scope} .empty-room { position: absolute; top: 53%; left: 50%; z-index: 2; width: min(90%, 360px); transform: translate(-50%, -50%); text-align: center; }
${scope} .empty-icon { display: block; margin-bottom: 10px; color: var(--gold); font-size: 28px; }
${scope} .empty-room p { margin-bottom: 5px; font-family: Georgia, serif; font-size: 25px; }
${scope} .empty-room span { color: var(--muted); font-size: 13px; }
${scope} .state-panel { display: grid; min-height: 55vh; place-items: center; align-content: center; gap: 12px; color: var(--muted); text-align: center; }
${scope} .state-panel h1 { margin: 8px 0 0; color: var(--ink); font-size: 42px; }
${scope} .state-panel p { margin: 0; }
${scope} .state-icon { display: grid; width: 42px; height: 42px; place-items: center; border: 1px solid var(--red); color: #d78271; font-weight: 700; }
${scope} .loader { width: 28px; height: 28px; border: 1px solid rgba(215,168,93,.25); border-top-color: var(--gold); border-radius: 50%; animation: memPalaceSpin .8s linear infinite; }
${scope} .detail-drawer { position: fixed; top: 0; right: 0; bottom: 0; z-index: 10; width: min(430px, 100%); padding: 70px 38px 40px; transform: translateX(100%); overflow-y: auto; border-left: 1px solid var(--line); background: #1a2226; box-shadow: -20px 0 60px rgba(0,0,0,.28); transition: transform .35s ease; }
${scope} .detail-drawer.is-open { transform: translateX(0); }
${scope} .icon-button { position: absolute; top: 24px; right: 27px; width: 36px; height: 36px; border: 1px solid var(--line); color: var(--muted); background: transparent; font-size: 25px; line-height: 1; }
${scope} .icon-button:hover, ${scope} .icon-button:focus-visible { border-color: var(--gold); color: var(--gold); }
${scope} .detail-accent { width: 44px; height: 3px; margin-bottom: 34px; background: var(--gold); }
${scope} .detail-drawer h2 { margin: 12px 0 24px; font-size: 38px; }
${scope} .detail-text { color: var(--ink); font-size: 17px; line-height: 1.8; overflow-wrap: anywhere; }
${scope} .detail-divider { height: 1px; margin: 34px 0 24px; background: var(--line); }
${scope} .detail-meta { display: grid; gap: 13px; margin: 0; }
${scope} .detail-meta div { display: flex; justify-content: space-between; gap: 20px; font-size: 12px; }
${scope} .detail-meta dt { color: var(--quiet); } ${scope} .detail-meta dd { margin: 0; color: var(--gold-bright); text-align: right; }
${scope} .detail-prompt { margin-top: 28px; color: var(--quiet); font-size: 11px; line-height: 1.7; }
${scope} .drawer-backdrop { position: fixed; inset: 0; z-index: 9; background: rgba(0,0,0,.55); backdrop-filter: blur(3px); }
${scope} :focus-visible { outline: 2px solid var(--gold-bright); outline-offset: 3px; }
@keyframes memPalaceReveal { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
@keyframes memPalaceSpin { to { transform: rotate(360deg); } }
@media (max-width: 720px) { ${scope} .topbar, ${scope} .main { width: min(100% - 36px, 1440px); } ${scope} .topbar { padding-top: 20px; } ${scope} .topbar-meta { font-size: 9px; } ${scope} .main { padding-top: 15px; } ${scope} .hero-copy { padding: 55px 0 62px; } ${scope} .hero-copy h1 { font-size: clamp(55px, 17vw, 82px); } ${scope} .hero-description { font-size: 14px; } ${scope} .hall-intro { align-items: start; gap: 15px; flex-direction: column; } ${scope} .course-grid { grid-template-columns: 1fr; } ${scope} .course-card { min-height: 265px; } ${scope} .room-heading { align-items: start; flex-direction: column; padding-top: 25px; } ${scope} .room-heading h1 { font-size: 54px; } ${scope} .room-stage { min-height: 620px; } ${scope} .room-anchor { top: 28%; width: 110px; height: 110px; } ${scope} .node-list { right: 16px; bottom: 16px; left: 16px; grid-template-columns: 1fr; } ${scope} .node-card { min-height: 106px; padding-right: 92px; } ${scope} .node-title { margin: 5px 0; } ${scope} .node-preview { max-width: calc(100% - 20px); } ${scope} .detail-drawer { width: 100%; padding-right: 28px; padding-left: 28px; } }`;
  }

  protected get dataVersion(): Version {
    return Version.parse('1.0');
  }

  protected getPropertyPaneConfiguration(): IPropertyPaneConfiguration {
    return {
      pages: [
        {
          header: {
            description: strings.PropertyPaneDescription
          },
          groups: [
            {
              groupName: strings.BasicGroupName,
              groupFields: [
                PropertyPaneTextField('assetBaseUrl', {
                  label: strings.AssetBaseUrlFieldLabel,
                  description: '留空时默认使用当前站点的 /SiteAssets/MemPalace。'
                }),
                PropertyPaneTextField('csvUrl', {
                  label: strings.CsvUrlFieldLabel,
                  description: '留空时读取 assetBaseUrl 下的 知识点文档.csv。'
                })
              ]
            }
          ]
        }
      ]
    };
  }
}
