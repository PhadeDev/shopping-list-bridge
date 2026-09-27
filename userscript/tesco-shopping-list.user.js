// ==UserScript==
// @name         Tesco Shopping List Reminder
// @namespace    phaderon.shopping-list-bridge
// @version      1.0.1
// @description  Keeps the active NAS shopping list visible on Tesco grocery pages.
// @match        https://www.tesco.com/shop/en-GB/*
// @match        https://www.tesco.com/groceries/en-GB/*
// @connect      192.168.0.200
// @downloadURL  https://raw.githubusercontent.com/PhadeDev/shopping-list-bridge/main/userscript/tesco-shopping-list.user.js
// @updateURL    https://raw.githubusercontent.com/PhadeDev/shopping-list-bridge/main/userscript/tesco-shopping-list.user.js
// @run-at       document-start
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

(function () {
    'use strict';

    const API_BASE = 'http://192.168.0.200:5057';
    const HOST_ID = 'phade-shopping-list-host';
    const REFRESH_MS = 15000;
    let host;
    let shadow;
    let items = [];
    let offline = false;
    let refreshTimer;

    function request(method, path, body) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method,
                url: `${API_BASE}${path}`,
                headers: body ? { 'Content-Type': 'application/json' } : {},
                data: body ? JSON.stringify(body) : undefined,
                timeout: 8000,
                onload(response) {
                    if (response.status >= 200 && response.status < 300) {
                        if (response.status === 204 || !response.responseText) return resolve(null);
                        try { resolve(JSON.parse(response.responseText)); }
                        catch (_error) { reject(new Error('The shopping list returned invalid data.')); }
                    } else {
                        reject(new Error(`Shopping list request failed (${response.status}).`));
                    }
                },
                ontimeout() { reject(new Error('The shopping list did not respond.')); },
                onerror() { reject(new Error('The shopping list is unavailable.')); },
            });
        });
    }

    function escapeHtml(value) {
        return String(value)
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#039;');
    }

    function icon(name) {
        if (name === 'trash') return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6l1 2h4v2H4V5h4l1-2Zm-2 6h10l-1 11H8L7 9Zm3 2v7h2v-7h-2Zm4 0v7h2v-7h-2Z"/></svg>';
        if (name === 'chevron') return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7.4 8.6 4.6 4.6 4.6-4.6L18 10l-6 6-6-6 1.4-1.4Z"/></svg>';
        return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 1 0 9 9h-2a7 7 0 1 1-2.05-4.95L14 10h7V3l-2.63 2.63A8.96 8.96 0 0 0 12 3Z"/></svg>';
    }

    function ensureMounted() {
        if (document.getElementById(HOST_ID)) return;
        host = document.createElement('div');
        host.id = HOST_ID;
        host.style.cssText = 'all:initial;position:fixed;z-index:2147483646;';
        document.documentElement.append(host);
        shadow = host.attachShadow({ mode: 'open' });
        shadow.innerHTML = `<style>${styles()}</style><div class="panel"></div>`;
        restorePosition();
        render();
        bindPanelEvents();
    }

    function styles() {
        return `
            :host { all: initial; }
            * { box-sizing: border-box; }
            .panel { width: 330px; max-height: min(560px, calc(100vh - 30px)); overflow: hidden; border: 1px solid rgba(255,255,255,.12); border-radius: 16px; background: #09271f; color: #f5fbf8; box-shadow: 0 18px 55px rgba(0,0,0,.32); font-family: Inter, system-ui, -apple-system, "Segoe UI", sans-serif; font-size: 14px; }
            .header { display:flex; align-items:center; gap:10px; padding:12px 12px 11px 14px; background:linear-gradient(135deg,#0f4435,#0a2f26); cursor:grab; user-select:none; touch-action:none; }
            .header:active { cursor:grabbing; }
            .title-wrap { min-width:0; flex:1; }
            .title { display:flex; align-items:center; gap:7px; margin:0; font-weight:800; font-size:14px; line-height:1.2; }
            .status { width:8px; height:8px; border-radius:50%; background:#52e1aa; box-shadow:0 0 0 3px rgba(82,225,170,.12); }
            .status.offline { background:#ff8b8b; box-shadow:0 0 0 3px rgba(255,139,139,.12); }
            .subtitle { display:block; margin-top:3px; color:#9bc1b2; font-size:11px; }
            button { font:inherit; }
            .icon-button { display:grid; place-items:center; width:32px; height:32px; padding:0; border:0; border-radius:9px; background:rgba(255,255,255,.07); color:#bad7cb; cursor:pointer; }
            .icon-button:hover { background:rgba(255,255,255,.13); color:#fff; }
            .icon-button svg { width:17px; fill:currentColor; }
            .collapse svg { transition:transform .18s ease; }
            .body { max-height:470px; overflow:auto; padding:8px; scrollbar-width:thin; scrollbar-color:#2b5d4d transparent; }
            .item { display:grid; grid-template-columns:auto minmax(0,1fr) auto; align-items:center; gap:10px; min-height:48px; padding:7px 6px 7px 8px; border-radius:11px; }
            .item + .item { border-top:1px solid rgba(255,255,255,.07); }
            .check { width:22px; height:22px; border:2px solid #55dda9; border-radius:50%; background:transparent; cursor:pointer; }
            .check:hover { background:rgba(85,221,169,.18); }
            .name { min-width:0; overflow-wrap:anywhere; font-weight:680; line-height:1.25; }
            .qty { color:#8db5a5; font-size:11px; font-weight:750; white-space:nowrap; }
            .delete { width:30px; height:30px; border:0; border-radius:8px; background:transparent; color:#729789; cursor:pointer; }
            .delete:hover { color:#ff9292; background:rgba(255,100,100,.1); }
            .delete svg { width:16px; fill:currentColor; }
            .empty { padding:28px 18px; color:#95b9aa; text-align:center; line-height:1.45; }
            .footer { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:8px 11px; border-top:1px solid rgba(255,255,255,.08); color:#739b8b; font-size:10px; }
            .refresh { display:flex; align-items:center; gap:5px; border:0; padding:4px 6px; border-radius:6px; background:transparent; color:#88ae9f; cursor:pointer; }
            .refresh:hover { color:#fff; background:rgba(255,255,255,.07); }
            .refresh svg { width:13px; fill:currentColor; }
            .panel.collapsed { width:auto; min-width:196px; }
            .panel.collapsed .body, .panel.collapsed .footer { display:none; }
            .panel.collapsed .header { cursor:pointer; }
            .panel.collapsed .collapse svg { transform:rotate(180deg); }
            @media (max-width: 560px) { .panel { width:min(330px, calc(100vw - 20px)); } }
        `;
    }

    function render() {
        if (!shadow) return;
        const panel = shadow.querySelector('.panel');
        const collapsed = GM_getValue('collapsed', false);
        panel.classList.toggle('collapsed', collapsed);
        const rows = items.length
            ? items.map((item) => `
                <div class="item" data-id="${item.id}">
                    <button class="check" type="button" data-action="complete" aria-label="Mark ${escapeHtml(item.name)} complete"></button>
                    <div class="name">${escapeHtml(item.name)}${item.quantity > 1 ? ` <span class="qty">× ${item.quantity}</span>` : ''}</div>
                    <button class="delete" type="button" data-action="delete" aria-label="Delete ${escapeHtml(item.name)}">${icon('trash')}</button>
                </div>`).join('')
            : `<div class="empty">${offline ? 'The NAS shopping list is unavailable.<br>It will retry automatically.' : 'Nothing left to pick up. Lovely.'}</div>`;

        panel.innerHTML = `
            <div class="header">
                <div class="title-wrap">
                    <div class="title"><span class="status ${offline ? 'offline' : ''}"></span> Shopping list</div>
                    <span class="subtitle">${offline ? 'Offline' : `${items.length} item${items.length === 1 ? '' : 's'} still needed`}</span>
                </div>
                <button class="icon-button collapse" type="button" data-action="collapse" aria-label="${collapsed ? 'Expand' : 'Minimise'} shopping list">${icon('chevron')}</button>
            </div>
            <div class="body">${rows}</div>
            <div class="footer"><span>Synced from the NAS</span><button class="refresh" type="button" data-action="refresh">${icon('refresh')} Refresh</button></div>`;
    }

    function bindPanelEvents() {
        shadow.addEventListener('click', async (event) => {
            const button = event.target.closest('button[data-action]');
            if (!button) return;
            const action = button.dataset.action;
            if (action === 'collapse') {
                GM_setValue('collapsed', !GM_getValue('collapsed', false));
                render();
                return;
            }
            if (action === 'refresh') return refresh();
            const row = button.closest('.item');
            const item = items.find((entry) => entry.id === Number(row?.dataset.id));
            if (!item) return;
            button.disabled = true;
            try {
                if (action === 'complete') await request('PATCH', `/api/items/${item.id}`, { completed: true });
                if (action === 'delete' && window.confirm(`Delete “${item.name}”?`)) await request('DELETE', `/api/items/${item.id}`);
                await refresh();
            } catch (error) {
                offline = true;
                render();
            }
        });
        enableDragging();
    }

    function enableDragging() {
        let drag;
        shadow.addEventListener('pointerdown', (event) => {
            const header = event.target.closest('.header');
            if (!header || event.target.closest('button') || GM_getValue('collapsed', false)) return;
            const rect = host.getBoundingClientRect();
            drag = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
            header.setPointerCapture(event.pointerId);
        });
        shadow.addEventListener('pointermove', (event) => {
            if (!drag) return;
            const rect = host.getBoundingClientRect();
            const left = Math.max(8, Math.min(window.innerWidth - rect.width - 8, drag.left + event.clientX - drag.x));
            const top = Math.max(8, Math.min(window.innerHeight - Math.min(rect.height, window.innerHeight - 16) - 8, drag.top + event.clientY - drag.y));
            Object.assign(host.style, { left: `${left}px`, top: `${top}px`, right: 'auto', bottom: 'auto' });
        });
        shadow.addEventListener('pointerup', () => {
            if (!drag) return;
            drag = null;
            GM_setValue('position', { left: parseFloat(host.style.left), top: parseFloat(host.style.top) });
        });
    }

    function restorePosition() {
        const position = GM_getValue('position', null);
        if (position && Number.isFinite(position.left) && Number.isFinite(position.top)) {
            const left = Math.max(8, Math.min(window.innerWidth - 210, position.left));
            const top = Math.max(8, Math.min(window.innerHeight - 70, position.top));
            Object.assign(host.style, { left: `${left}px`, top: `${top}px`, right: 'auto', bottom: 'auto' });
        } else {
            Object.assign(host.style, { right: '18px', bottom: '18px', left: 'auto', top: 'auto' });
        }
    }

    async function refresh() {
        try {
            const body = await request('GET', '/api/items?status=active');
            items = body.items;
            offline = false;
        } catch (_error) {
            offline = true;
        }
        render();
    }

    function start() {
        ensureMounted();
        refresh();
        refreshTimer = setInterval(refresh, REFRESH_MS);
        window.addEventListener('focus', refresh);
        window.addEventListener('resize', restorePosition);
        document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
        new MutationObserver(() => {
            if (!document.getElementById(HOST_ID)) {
                ensureMounted();
                refresh();
            }
        }).observe(document.documentElement, { childList: true });
    }

    if (document.documentElement) start();
    else document.addEventListener('readystatechange', () => { if (document.documentElement && !refreshTimer) start(); });
})();
